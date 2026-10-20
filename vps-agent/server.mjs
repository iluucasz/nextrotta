// NextRotta VPS agent: what the owner panel needs to see and maintain the shared VPS, and nothing
// more. Plain Node (no dependencies), talks to the Docker Engine API over its unix socket and reads
// the host's /proc and disk through a read-only bind mount of `/` at /host.
//
// The Docker socket is root on the host, so this agent never runs arbitrary commands: only the fixed
// list of actions below, each checked against who owns the container or image (ownerOf):
//   - nextrotta  (label com.nextrotta.owner=nextrotta): restart allowed;
//   - production (porto-worker, porto-worker-<sha7>, porto-worker:* images): read only;
//   - shared     (evolution-*): restart only with confirm=evolution (it takes the WhatsApp of
//                 every system down for a moment);
//   - unknown    (anything else, e.g. other systems on the VPS): read only.
// The cleanup only removes what the rules in planCleanup name — the same rules as the
// /usr/local/sbin/vps-cleanup.sh it replaces, plus the NextRotta images.

import { createServer, request as httpRequest } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFile, readdir, stat, statfs, truncate, unlink } from 'node:fs/promises';
import { join } from 'node:path';

const PORT = Number(process.env.VPS_AGENT_PORT ?? 8092);
const SECRET = process.env.VPS_AGENT_SECRET ?? '';
const DOCKER_SOCKET = process.env.DOCKER_SOCKET ?? '/var/run/docker.sock';
const HOST_ROOT = process.env.HOST_ROOT ?? '/host';
const APT_ARCHIVES = process.env.APT_ARCHIVES ?? '/var/cache/apt/archives';
/** First rollout: everything readable (the cleanup preview included), nothing changed. */
const READ_ONLY = process.env.VPS_AGENT_READ_ONLY === '1';

const DAY_MS = 24 * 60 * 60 * 1000;
const LOG_TRUNCATE_BYTES = 200 * 1024 * 1024;
const BUILD_CACHE_MAX_AGE_MS = 72 * 60 * 60 * 1000;
/** Production's August baseline image, kept on purpose. */
const PRODUCTION_KEPT_IMAGES = new Set(['porto-worker:prev-20260831']);
const NEXTROTTA_REPOSITORIES = ['nextrotta-worker', 'nextrotta-vps-agent'];
const OWNER_LABEL = 'com.nextrotta.owner';

// ---------------------------------------------------------------------------------------------
// Docker Engine API
// ---------------------------------------------------------------------------------------------

function docker(method, path, { body, raw = false, timeoutMs = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = httpRequest(
      {
        socketPath: DOCKER_SOCKET,
        method,
        path,
        headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          if (res.statusCode >= 400) {
            reject(new Error(`Docker ${method} ${path}: ${res.statusCode} ${buffer.toString('utf8').slice(0, 300)}`));
            return;
          }
          if (raw) return resolve(buffer);
          const text = buffer.toString('utf8');
          try {
            resolve(text ? JSON.parse(text) : null);
          } catch {
            resolve(text);
          }
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error(`Docker ${method} ${path}: tempo esgotado`)));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const q = (value) => encodeURIComponent(typeof value === 'string' ? value : JSON.stringify(value));

// ---------------------------------------------------------------------------------------------
// Ownership
// ---------------------------------------------------------------------------------------------

function containerName(container) {
  return String(container.Names?.[0] ?? container.Name ?? '').replace(/^\//, '');
}

function ownerOf({ name = '', image = '', labels = {} }) {
  if (labels?.[OWNER_LABEL] === 'nextrotta') return 'nextrotta';
  if (name === 'porto-worker' || /^porto-worker-[0-9a-f]{7}$/.test(name) || /^porto-worker(:|$)/.test(image)) return 'production';
  if (name.startsWith('evolution-')) return 'shared';
  return 'unknown';
}

function imageOwner(tags, labels) {
  if (labels?.[OWNER_LABEL] === 'nextrotta' || tags.some((tag) => NEXTROTTA_REPOSITORIES.includes(tag.split(':')[0]))) return 'nextrotta';
  if (tags.some((tag) => tag.startsWith('porto-worker:'))) return 'production';
  if (tags.some((tag) => /^evoapicloud\/evolution-api:|^postgres:15-alpine$|^redis:7-alpine$/.test(tag))) return 'shared';
  return 'unknown';
}

// ---------------------------------------------------------------------------------------------
// Host metrics
// ---------------------------------------------------------------------------------------------

const hostPath = (path) => join(HOST_ROOT, path);

async function readCpuTimes() {
  const line = (await readFile(hostPath('proc/stat'), 'utf8')).split('\n')[0];
  const values = line.trim().split(/\s+/).slice(1).map(Number);
  const idle = values[3] + (values[4] ?? 0);
  const total = values.reduce((sum, value) => sum + value, 0);
  return { idle, total };
}

async function cpuPercent() {
  const first = await readCpuTimes();
  await new Promise((resolve) => setTimeout(resolve, 500));
  const second = await readCpuTimes();
  const total = second.total - first.total;
  return total > 0 ? Math.round((1 - (second.idle - first.idle) / total) * 1000) / 10 : 0;
}

async function memory() {
  const info = Object.fromEntries(
    (await readFile(hostPath('proc/meminfo'), 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [key, value] = line.split(':');
        return [key.trim(), Number(value.trim().split(/\s+/)[0]) * 1024];
      }),
  );
  return { total: info.MemTotal ?? 0, available: info.MemAvailable ?? 0, used: (info.MemTotal ?? 0) - (info.MemAvailable ?? 0), swapTotal: info.SwapTotal ?? 0 };
}

async function network() {
  // pid 1 of the host: /proc/net would be this container's own network namespace.
  const text = await readFile(hostPath('proc/1/net/dev'), 'utf8').catch(() => '');
  let rx = 0;
  let tx = 0;
  for (const line of text.split('\n').slice(2)) {
    const [name, rest] = line.split(':');
    if (!rest || name.trim() === 'lo' || name.trim().startsWith('veth') || name.trim().startsWith('docker') || name.trim().startsWith('br-')) continue;
    const fields = rest.trim().split(/\s+/).map(Number);
    rx += fields[0];
    tx += fields[8];
  }
  return { rxBytes: rx, txBytes: tx };
}

async function disk() {
  const info = await statfs(HOST_ROOT);
  const total = info.blocks * info.bsize;
  const free = info.bavail * info.bsize;
  const used = total - info.bfree * info.bsize;
  return { total, used, free, percent: total ? Math.round((used / (used + free)) * 1000) / 10 : 0 };
}

async function osRelease() {
  const text = await readFile(hostPath('etc/os-release'), 'utf8').catch(() => '');
  return text.match(/^PRETTY_NAME="?([^"\n]*)"?/m)?.[1] ?? null;
}

async function hostInfo() {
  const [cpu, load, uptime, mem, net, diskInfo, os, cores] = await Promise.all([
    cpuPercent(),
    readFile(hostPath('proc/loadavg'), 'utf8').then((text) => text.split(' ').slice(0, 3).map(Number)),
    readFile(hostPath('proc/uptime'), 'utf8').then((text) => Math.round(Number(text.split(' ')[0]))),
    memory(),
    network(),
    disk(),
    osRelease(),
    readFile(hostPath('proc/cpuinfo'), 'utf8').then((text) => (text.match(/^processor\s*:/gm) ?? []).length || null),
  ]);
  return { checkedAt: new Date().toISOString(), cpu: { percent: cpu, cores, load }, memory: mem, disk: diskInfo, network: net, uptimeSeconds: uptime, os };
}

// ---------------------------------------------------------------------------------------------
// Containers and images
// ---------------------------------------------------------------------------------------------

async function logSize(logPath) {
  if (!logPath) return null;
  const info = await stat(logPath).catch(() => stat(hostPath(logPath)).catch(() => null));
  return info ? info.size : null;
}

function cpuPercentFromStats(stats) {
  const cpuDelta = (stats.cpu_stats?.cpu_usage?.total_usage ?? 0) - (stats.precpu_stats?.cpu_usage?.total_usage ?? 0);
  const systemDelta = (stats.cpu_stats?.system_cpu_usage ?? 0) - (stats.precpu_stats?.system_cpu_usage ?? 0);
  const cpus = stats.cpu_stats?.online_cpus ?? stats.cpu_stats?.cpu_usage?.percpu_usage?.length ?? 1;
  return systemDelta > 0 && cpuDelta > 0 ? Math.round((cpuDelta / systemDelta) * cpus * 1000) / 10 : 0;
}

async function listContainers() {
  const containers = await docker('GET', '/containers/json?all=1&size=1');
  return Promise.all(
    containers.map(async (container) => {
      const name = containerName(container);
      const details = await docker('GET', `/containers/${container.Id}/json`).catch(() => null);
      const running = container.State === 'running';
      const stats = running ? await docker('GET', `/containers/${container.Id}/stats?stream=false`, { timeoutMs: 10_000 }).catch(() => null) : null;
      const memoryUsage = stats ? (stats.memory_stats?.usage ?? 0) - (stats.memory_stats?.stats?.inactive_file ?? stats.memory_stats?.stats?.cache ?? 0) : null;
      return {
        id: container.Id.slice(0, 12),
        name,
        owner: ownerOf({ name, image: container.Image, labels: container.Labels }),
        image: container.Image,
        state: container.State,
        status: container.Status,
        createdAt: new Date(container.Created * 1000).toISOString(),
        startedAt: details?.State?.StartedAt ?? null,
        restartCount: details?.RestartCount ?? 0,
        restartPolicy: details?.HostConfig?.RestartPolicy?.Name ?? null,
        ports: (container.Ports ?? []).map((port) => `${port.IP ?? ''}${port.PublicPort ? `:${port.PublicPort}->` : ''}${port.PrivatePort}/${port.Type}`),
        sizeRw: container.SizeRw ?? null,
        sizeRootFs: container.SizeRootFs ?? null,
        cpuPercent: stats ? cpuPercentFromStats(stats) : null,
        memoryBytes: memoryUsage,
        memoryLimitBytes: details?.HostConfig?.Memory || null,
        logBytes: await logSize(details?.LogPath),
        logRotation: details?.HostConfig?.LogConfig?.Config ?? {},
      };
    }),
  );
}

async function listImages() {
  const [images, containers] = await Promise.all([docker('GET', '/images/json'), docker('GET', '/containers/json?all=1')]);
  return images.map((image) => {
    const tags = (image.RepoTags ?? []).filter((tag) => tag !== '<none>:<none>');
    const usedBy = containers.filter((container) => container.ImageID === image.Id).map(containerName);
    return {
      id: image.Id.replace('sha256:', '').slice(0, 12),
      tags,
      sizeBytes: image.Size,
      createdAt: new Date(image.Created * 1000).toISOString(),
      usedBy,
      owner: imageOwner(tags, image.Labels),
    };
  });
}

/** Demultiplexes Docker's log stream (8-byte headers) when the container has no TTY. */
function demuxLogs(buffer) {
  const lines = [];
  let offset = 0;
  while (offset + 8 <= buffer.length && (buffer[offset] === 1 || buffer[offset] === 2) && buffer[offset + 1] === 0) {
    const length = buffer.readUInt32BE(offset + 4);
    lines.push(buffer.subarray(offset + 8, offset + 8 + length).toString('utf8'));
    offset += 8 + length;
  }
  return offset ? lines.join('') : buffer.toString('utf8');
}

async function containerLogs(name, tail) {
  const lines = Math.min(Math.max(Number(tail) || 200, 1), 2000);
  const buffer = await docker('GET', `/containers/${q(name)}/logs?stdout=1&stderr=1&timestamps=1&tail=${lines}`, { raw: true });
  return demuxLogs(buffer);
}

async function dirSize(path, depth = 3) {
  let total = 0;
  const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const full = join(path, entry.name);
    if (entry.isFile()) total += (await stat(full).catch(() => ({ size: 0 }))).size;
    else if (entry.isDirectory() && depth > 0) total += await dirSize(full, depth - 1);
  }
  return total;
}

async function diskReport() {
  const df = await docker('GET', '/system/df');
  const knownDirs = ['opt', 'var/log', 'var/log/journal', 'var/cache/apt/archives', 'home'];
  const dirs = await Promise.all(knownDirs.map(async (dir) => ({ path: `/${dir}`, bytes: await dirSize(hostPath(dir), dir === 'opt' ? 2 : 4) })));
  const cleanupLog = await readFile(hostPath('var/log/vps-cleanup.log'), 'utf8').catch(() => '');
  return {
    disk: await disk(),
    docker: {
      imagesBytes: (df.Images ?? []).reduce((sum, image) => sum + (image.Size ?? 0), 0),
      containersBytes: (df.Containers ?? []).reduce((sum, container) => sum + (container.SizeRw ?? 0), 0),
      volumesBytes: (df.Volumes ?? []).reduce((sum, volume) => sum + (volume.UsageData?.Size ?? 0), 0),
      buildCacheBytes: (df.BuildCache ?? []).reduce((sum, item) => sum + (item.Size ?? 0), 0),
    },
    directories: dirs,
    legacyCleanupLog: cleanupLog.split('\n').filter(Boolean).slice(-40),
  };
}

// ---------------------------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------------------------

/** Everything the cleanup would remove, with the reason and the space it frees. Removes nothing. */
async function planCleanup() {
  const now = Date.now();
  const [containers, images, df] = await Promise.all([
    docker('GET', '/containers/json?all=1'),
    docker('GET', '/images/json?all=0'),
    docker('GET', '/system/df'),
  ]);
  const actions = [];

  // 1. Production rollback containers (porto-worker-<sha>, stopped): keep only the newest one.
  const rollbacks = containers
    .filter((container) => container.State === 'exited' && /^porto-worker-[0-9a-f]{7}$/.test(containerName(container)) && String(container.Image).startsWith('porto-worker:'))
    .sort((a, b) => b.Created - a.Created);
  const removedContainers = new Set(rollbacks.slice(1).map((container) => container.Id));
  for (const container of rollbacks.slice(1)) {
    actions.push({ kind: 'container', target: containerName(container), id: container.Id, bytes: 0, reason: 'Container antigo de volta-atrás da produção (fica só o mais novo).' });
  }
  // Images still used by a container that stays (the removed rollbacks no longer count).
  const usedImageIds = new Set(containers.filter((container) => !removedContainers.has(container.Id)).map((container) => container.ImageID));

  // 2. Production images no container uses, older than a day (a deploy in progress is left alone).
  for (const image of images) {
    const tags = (image.RepoTags ?? []).filter((tag) => tag.startsWith('porto-worker:'));
    if (!tags.length || usedImageIds.has(image.Id) || now - image.Created * 1000 < DAY_MS) continue;
    for (const tag of tags) {
      if (PRODUCTION_KEPT_IMAGES.has(tag)) continue;
      actions.push({ kind: 'image', target: tag, id: image.Id, bytes: image.Size, reason: 'Imagem da produção sem uso há mais de 1 dia.' });
    }
  }

  // 3. NextRotta images: the one in use and the previous one stay; older unused ones go.
  for (const repository of NEXTROTTA_REPOSITORIES) {
    const own = images
      .filter((image) => (image.RepoTags ?? []).some((tag) => tag.startsWith(`${repository}:`)))
      .sort((a, b) => b.Created - a.Created);
    const unused = own.filter((image) => !usedImageIds.has(image.Id));
    for (const image of unused.slice(1)) {
      for (const tag of (image.RepoTags ?? []).filter((tag) => tag.startsWith(`${repository}:`))) {
        actions.push({ kind: 'image', target: tag, id: image.Id, bytes: image.Size, reason: 'Imagem antiga do NextRotta (ficam a atual e a anterior).' });
      }
    }
  }

  // 4. Untagged images no container uses, and build cache older than 3 days.
  const dangling = await docker('GET', `/images/json?filters=${q({ dangling: ['true'] })}`);
  const danglingBytes = dangling.filter((image) => !usedImageIds.has(image.Id)).reduce((sum, image) => sum + image.Size, 0);
  if (danglingBytes) actions.push({ kind: 'dangling_images', target: 'imagens sem nome', bytes: danglingBytes, reason: 'Imagens sem tag que nenhum container usa.' });
  const oldCache = (df.BuildCache ?? []).filter((item) => !item.InUse && now - new Date(item.LastUsedAt ?? item.CreatedAt).getTime() > BUILD_CACHE_MAX_AGE_MS);
  const cacheBytes = oldCache.reduce((sum, item) => sum + (item.Size ?? 0), 0);
  if (cacheBytes) actions.push({ kind: 'build_cache', target: 'cache de build', bytes: cacheBytes, reason: 'Cache de build com mais de 72h (só acelera o próximo build).' });

  // 5. Logs above 200 MB of the containers this platform runs or relies on.
  for (const container of containers) {
    const name = containerName(container);
    const owner = ownerOf({ name, image: container.Image, labels: container.Labels });
    if (!(name === 'porto-worker' || owner === 'shared' || owner === 'nextrotta')) continue;
    const details = await docker('GET', `/containers/${container.Id}/json`).catch(() => null);
    const size = await logSize(details?.LogPath);
    if (size !== null && size > LOG_TRUNCATE_BYTES) {
      actions.push({ kind: 'log', target: name, path: details.LogPath, bytes: size, reason: 'Log do container acima de 200 MB (é zerado).' });
    }
  }

  // 6. apt's downloaded packages (what `apt-get clean` removes).
  const debs = (await readdir(APT_ARCHIVES).catch(() => [])).filter((file) => file.endsWith('.deb'));
  let debBytes = 0;
  for (const file of debs) debBytes += (await stat(join(APT_ARCHIVES, file)).catch(() => ({ size: 0 }))).size;
  if (debBytes) actions.push({ kind: 'apt_cache', target: `${debs.length} pacote(s) do apt`, bytes: debBytes, reason: 'Pacotes baixados pelo apt (o mesmo que apt-get clean).' });

  return { actions, totalBytes: actions.reduce((sum, action) => sum + action.bytes, 0), disk: await disk() };
}

async function runCleanup() {
  const plan = await planCleanup();
  const results = [];
  for (const action of plan.actions) {
    try {
      if (action.kind === 'container') await docker('DELETE', `/containers/${action.id}`);
      else if (action.kind === 'image') await docker('DELETE', `/images/${q(action.target)}`);
      else if (action.kind === 'dangling_images') await docker('POST', `/images/prune?filters=${q({ dangling: ['true'] })}`);
      else if (action.kind === 'build_cache') await docker('POST', `/build/prune?all=1&filters=${q({ until: ['72h'] })}`, { timeoutMs: 120_000 });
      else if (action.kind === 'log') await truncate(action.path, 0);
      else if (action.kind === 'apt_cache') {
        for (const file of (await readdir(APT_ARCHIVES)).filter((name) => name.endsWith('.deb'))) await unlink(join(APT_ARCHIVES, file));
      }
      results.push({ ...action, ok: true });
    } catch (error) {
      results.push({ ...action, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { results, freedBytes: results.filter((result) => result.ok).reduce((sum, result) => sum + result.bytes, 0), diskBefore: plan.disk, diskAfter: await disk() };
}

// ---------------------------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------------------------

async function restartContainer(name, confirm) {
  const details = await docker('GET', `/containers/${q(name)}/json`);
  const owner = ownerOf({ name: details.Name.replace(/^\//, ''), image: details.Config?.Image ?? '', labels: details.Config?.Labels ?? {} });
  if (owner === 'shared' && confirm !== 'evolution') {
    return { status: 409, body: { error: 'Este container é compartilhado com a produção (WhatsApp). Confirme com confirm=evolution: o WhatsApp de todos os sistemas cai por alguns segundos.' } };
  }
  if (owner !== 'nextrotta' && owner !== 'shared') {
    return { status: 403, body: { error: `Este container é ${owner === 'production' ? 'da produção' : 'de outro sistema'}: só leitura.` } };
  }
  await docker('POST', `/containers/${q(name)}/restart?t=20`, { timeoutMs: 60_000 });
  return { status: 200, body: { ok: true, name, owner } };
}

// ---------------------------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------------------------

function isAuthorized(req) {
  if (!SECRET) return false;
  const header = req.headers.authorization ?? '';
  if (!header.startsWith('Bearer ')) return false;
  const token = Buffer.from(header.slice(7));
  const expected = Buffer.from(SECRET);
  return token.length === expected.length && timingSafeEqual(token, expected);
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;

const server = createServer((req, res) => {
  void (async () => {
    try {
      if (!isAuthorized(req)) return send(res, 401, { error: 'Unauthorized' });
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
      const path = url.pathname.replace(/\/+$/, '') || '/';

      if (req.method === 'GET' && path === '/health') return send(res, 200, { ok: true, readOnly: READ_ONLY });
      const changes = req.method === 'POST' && !(path === '/cleanup' && url.searchParams.get('dryRun') === '1');
      if (changes && READ_ONLY) return send(res, 403, { error: 'O agente da VPS está em modo somente leitura.' });
      if (req.method === 'GET' && path === '/host') return send(res, 200, await hostInfo());
      if (req.method === 'GET' && path === '/containers') return send(res, 200, { containers: await listContainers() });
      if (req.method === 'GET' && path === '/images') return send(res, 200, { images: await listImages() });
      if (req.method === 'GET' && path === '/disk') return send(res, 200, await diskReport());
      if (req.method === 'POST' && path === '/cleanup') {
        return send(res, 200, url.searchParams.get('dryRun') === '1' ? { dryRun: true, ...(await planCleanup()) } : { dryRun: false, ...(await runCleanup()) });
      }

      const logs = path.match(/^\/containers\/([^/]+)\/logs$/);
      if (req.method === 'GET' && logs) {
        if (!NAME_PATTERN.test(logs[1])) return send(res, 400, { error: 'Nome inválido.' });
        return send(res, 200, { name: logs[1], logs: await containerLogs(logs[1], url.searchParams.get('tail')) });
      }
      const restart = path.match(/^\/containers\/([^/]+)\/restart$/);
      if (req.method === 'POST' && restart) {
        if (!NAME_PATTERN.test(restart[1])) return send(res, 400, { error: 'Nome inválido.' });
        const result = await restartContainer(restart[1], url.searchParams.get('confirm'));
        return send(res, result.status, result.body);
      }

      send(res, 404, { error: 'Not found' });
    } catch (error) {
      console.error('[vps-agent]', error);
      send(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  })();
});

if (!SECRET) {
  console.error('[vps-agent] VPS_AGENT_SECRET não configurado — o agente não vai iniciar.');
  process.exit(1);
}

server.listen(PORT, () => console.log(`[vps-agent] ouvindo na porta ${PORT}${READ_ONLY ? ' (somente leitura)' : ''}`));
