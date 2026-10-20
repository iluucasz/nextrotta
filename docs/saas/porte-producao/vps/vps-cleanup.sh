#!/bin/sh
# Daily disk cleanup for the Central Operacional pieces of this VPS. Installed at
# /usr/local/sbin/vps-cleanup.sh, run by the vps-cleanup.timer systemd unit, logs to
# /var/log/vps-cleanup.log.
#
# The VPS is SHARED with other systems (the SaaS clone, /opt/prumo, ...). Everything that deletes
# is scoped to this system's exact names: the `porto-worker` container, rollback containers named
# `porto-worker-<7-char git sha>` and images of the `porto-worker` repository. Other systems must
# use their own names. Never touches running containers, Docker volumes or /opt.

LOG=/var/log/vps-cleanup.log
log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" >> "$LOG"; }

before=$(df --output=pcent / | tail -1 | tr -d ' %')
log "start: disk ${before}%"

# 1. Our old rollback containers (porto-worker-<sha>, stopped): keep only the newest one.
docker ps -a --filter "status=exited" --format '{{.CreatedAt}}|{{.Names}}|{{.Image}}' \
  | grep -E '^[^|]*\|porto-worker-[0-9a-f]{7}\|porto-worker:' \
  | sort -r | tail -n +2 | cut -d'|' -f2 | while read -r name; do
    docker rm "$name" >/dev/null && log "removed old rollback container $name"
  done

# 2. Images of the porto-worker repository that no container uses (~2.4 GB each), older than a
#    day (an image just built for a deploy in progress is left alone). The August baseline stays.
used_ids=$(docker ps -a --format '{{.Image}}' | xargs -r docker image inspect --format '{{.Id}}' 2>/dev/null | sort -u)
day_ago=$(date -u -d '1 day ago' +%s)
docker images porto-worker --format '{{.Repository}}:{{.Tag}}' | while read -r ref; do
  [ "$ref" = "porto-worker:prev-20260831" ] && continue
  full=$(docker image inspect --format '{{.Id}}' "$ref" 2>/dev/null) || continue
  echo "$used_ids" | grep -qx "$full" && continue
  created=$(date -u -d "$(docker image inspect --format '{{.Created}}' "$ref")" +%s 2>/dev/null) || continue
  [ "$created" -gt "$day_ago" ] && continue
  docker image rm "$ref" >/dev/null 2>&1 && log "removed image $ref"
done

# 3. Leftovers that belong to no one: untagged images no container uses, and build cache older
#    than 3 days (only a speed-up for the next build — any system just rebuilds it if needed).
docker image prune -f >/dev/null 2>&1
docker builder prune -af --filter until=72h >/dev/null 2>&1

# 4. Logs of the containers this system runs or relies on (the Evolution ones have no rotation):
#    empty any above 200 MB. Other systems' container logs are not touched.
for name in porto-worker evolution-api evolution-postgres evolution-redis; do
  f=$(docker inspect --format '{{.LogPath}}' "$name" 2>/dev/null) || continue
  [ -f "$f" ] || continue
  size=$(stat -c %s "$f")
  if [ "$size" -gt 209715200 ]; then
    truncate -s 0 "$f" && log "truncated log of $name ($((size / 1048576)) MB)"
  fi
done

# 5. System journal (also capped in /etc/systemd/journald.conf.d/size.conf) and apt cache.
journalctl --vacuum-size=200M >/dev/null 2>&1
apt-get clean >/dev/null 2>&1

after=$(df --output=pcent / | tail -1 | tr -d ' %')
log "done: disk ${after}%"
[ "$after" -ge 85 ] && log "WARNING: disk still at ${after}% after cleanup"

# Keep this log small.
tail -n 500 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
exit 0
