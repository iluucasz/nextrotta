import { recordAudit } from '../audit';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { sql } from '../db';
import { PlatformError, type Actor } from '../platform/errors';
import {
  siteContent,
  type SiteContent,
  type SiteItem,
  type SiteVersion,
} from './content';

const safeUrl = (value: string) =>
  !/[\s\\]/.test(value) &&
  (/^https:\/\/[^/]+/.test(value) || /^\/(?!\/)/.test(value));
const imageUrl = z
  .string()
  .max(2048)
  .refine(
    (value) => !value || safeUrl(value),
    'Use uma imagem https ou um caminho do site.',
  );
const linkUrl = z
  .string()
  .max(2048)
  .refine(
    (value) =>
      !value ||
      safeUrl(value) ||
      /^mailto:[^\s]+@[^\s]+$/.test(value) ||
      /^#[a-zA-Z][\w-]*$/.test(value),
    'Use um link válido.',
  );
const color = z
  .string()
  .regex(/^#[0-9a-f]{6}$/i, 'Use uma cor hexadecimal com seis dígitos.');
const text = z.string().max(20000);
const itemSchema = z.object({
  id: z.string().min(1).max(120),
  title: text,
  text,
  image: imageUrl.optional(),
  visible: z.boolean().optional(),
});
const designSchema = z.object({
  schemaVersion: z.literal(1),
  theme: z.object({
    primary: color,
    background: color,
    text: color,
    muted: color,
    surface: color,
    accent: color,
    font: z.enum(['geist', 'serif', 'system']),
    radius: z.number().min(0).max(32),
    buttonRadius: z.number().min(0).max(32),
  }),
  sections: z
    .array(
      z.object({
        id: z.string().min(1).max(120),
        type: z.enum([
          'hero',
          'benefits',
          'ai',
          'features',
          'steps',
          'updates',
          'security',
          'pricing',
          'testimonials',
          'faq',
          'cta',
          'text',
          'image',
          'banner',
          'cards',
          'spacer',
        ]),
        name: z.string().min(1).max(200),
        hidden: z.boolean(),
        archived: z.boolean(),
        settings: z.object({
          title: text.optional(),
          text: text.optional(),
          eyebrow: text.optional(),
          image: imageUrl.optional(),
          alt: text.optional(),
          buttonLabel: text.optional(),
          buttonHref: linkUrl.optional(),
          background: color.optional(),
          color: color.optional(),
          align: z.enum(['left', 'center', 'right']).optional(),
          padding: z.number().min(0).max(160).optional(),
          width: z.enum(['contained', 'full']).optional(),
          imageFit: z.enum(['cover', 'contain']).optional(),
          height: z.number().min(16).max(240).optional(),
          items: z.array(itemSchema).max(200).optional(),
        }),
      }),
    )
    .max(200)
    .refine(
      (sections) =>
        new Set(sections.map((section) => section.id)).size === sections.length,
      'As seções precisam ter identificadores únicos.',
    ),
  header: z.object({ ctaLabel: text, ctaHref: linkUrl }).optional(),
  footer: z.object({ tagline: text, signature: text }).optional(),
});

// Keep history inside the existing draft JSONB, without requiring a schema migration.
// It is server-owned metadata and is never accepted from the request or sent to the public site.
const HISTORY_KEY = '_cmsVersions';
const HISTORY_LIMIT = 30;
type SiteRow = {
  draft?: unknown;
  published?: unknown;
  draft_updated_at?: string | Date | null;
  published_at?: string | Date | null;
};

const TEXT_KEYS = [
  'title',
  'subtitle',
  'primary',
  'secondary',
  'aiTitle',
  'aiText',
  'updatesTitle',
  'updatesText',
  'securityTitle',
  'pricingFootnote',
  'whatsapp',
  'email',
  'phone',
  'hours',
  'legalName',
  'cnpj',
  'seoTitle',
  'seoDescription',
  'terms',
  'privacy',
] as const satisfies ReadonlyArray<keyof SiteContent>;

export const LIST_KEYS = [
  'benefits',
  'steps',
  'security',
  'testimonials',
  'faq',
] as const satisfies ReadonlyArray<keyof SiteContent>;

const REQUIRED: Array<keyof SiteContent> = [
  'title',
  'subtitle',
  'primary',
  'secondary',
  'legalName',
  'seoTitle',
  'seoDescription',
];

/** Stored content over the code defaults, so a field added later never comes out empty. */
function withDefaults(stored: unknown): SiteContent {
  const { [HISTORY_KEY]: _history, ...data } = (
    stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {}
  ) as Partial<SiteContent> & Record<string, unknown>;
  return { ...siteContent, ...data };
}

function cleanItems(value: unknown, label: string): SiteItem[] {
  if (!Array.isArray(value))
    throw new PlatformError(`${label}: lista inválida.`);
  return value.map((raw, index) => {
    const item = (raw ?? {}) as Record<string, unknown>;
    const title = String(item.title ?? '').trim();
    const text = String(item.text ?? '').trim();
    if (!title || !text)
      throw new PlatformError(
        `${label}, item ${index + 1}: preencha título e texto.`,
      );
    const image = String(item.image ?? '').trim();
    if (image && !/^https:\/\//.test(image))
      throw new PlatformError(
        `${label}, item ${index + 1}: a imagem precisa de um endereço https.`,
      );
    return {
      id: String(item.id ?? '').trim() || `i${Date.now().toString(36)}${index}`,
      title,
      text,
      ...(image ? { image } : {}),
      visible: item.visible !== false,
    };
  });
}

const LIST_LABELS: Record<(typeof LIST_KEYS)[number], string> = {
  benefits: 'Benefícios',
  steps: 'Como funciona',
  security: 'Segurança',
  testimonials: 'Depoimentos',
  faq: 'Perguntas frequentes',
};

function validate(input: Record<string, unknown>): SiteContent {
  const content = withDefaults(null);
  if ('design' in input) {
    const result = designSchema.safeParse(input.design);
    if (!result.success)
      throw new PlatformError(
        `Tema inválido: ${result.error.issues[0].message}`,
      );
    content.design = result.data;
  }
  for (const key of TEXT_KEYS) {
    if (key in input)
      (content as unknown as Record<string, unknown>)[key] = String(
        input[key] ?? '',
      ).trim();
  }
  for (const key of LIST_KEYS) {
    if (key in input) content[key] = cleanItems(input[key], LIST_LABELS[key]);
  }
  if ('defaultCycle' in input)
    content.defaultCycle =
      input.defaultCycle === 'annual' ? 'annual' : 'monthly';
  if ('socials' in input) {
    const socials = (
      Array.isArray(input.socials)
        ? input.socials
        : String(input.socials ?? '').split('\n')
    )
      .map((url) => String(url).trim())
      .filter(Boolean);
    const invalid = socials.find((url) => !/^https:\/\/\S+$/.test(url));
    if (invalid)
      throw new PlatformError(
        `Rede social inválida: ${invalid} (use um endereço https).`,
      );
    content.socials = socials;
  }
  const missing = REQUIRED.find((key) => !String(content[key] ?? '').trim());
  if (missing)
    throw new PlatformError(
      'Preencha os campos obrigatórios: título, subtítulo, botões, razão social e SEO.',
    );
  if (content.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(content.email))
    throw new PlatformError('E-mail de contato inválido.');
  if (content.cnpj && content.cnpj.replace(/\D/g, '').length !== 14)
    throw new PlatformError('CNPJ inválido: são 14 dígitos.');
  return content;
}

/** What the public site shows. */
export async function getPublishedSiteContent(): Promise<SiteContent> {
  try {
    const rows = await sql`SELECT published FROM site_content WHERE id`;
    return withDefaults(rows[0]?.published);
  } catch (error) {
    // The site must render even if the database hiccups: fall back to the code defaults.
    console.error('[site] failed to load the published content:', error);
    return withDefaults(null);
  }
}

/** The editor's state: the draft (or the published version when there's no draft yet). */
export async function getSiteEditorState() {
  const rows = await sql`SELECT * FROM site_content WHERE id`;
  return editorState(rows[0] ?? {});
}

function storedVersions(row: SiteRow): SiteVersion[] {
  const value = (row.draft as Record<string, unknown> | null)?.[HISTORY_KEY];
  return Array.isArray(value)
    ? (value.slice(0, HISTORY_LIMIT) as SiteVersion[])
    : [];
}

function editorState(row: SiteRow) {
  const draft = withDefaults(row.draft ?? row.published);
  const published = withDefaults(row.published);
  return {
    draft,
    published,
    designSupported: true,
    versions: storedVersions(row),
    hasUnpublishedChanges: JSON.stringify(draft) !== JSON.stringify(published),
    draftUpdatedAt: row.draft_updated_at
      ? new Date(row.draft_updated_at).toISOString()
      : null,
    publishedAt: row.published_at
      ? new Date(row.published_at).toISOString()
      : null,
  };
}

export async function saveSiteDraft(
  input: Record<string, unknown>,
  actor: Actor,
) {
  const { state } = await persist(input, actor, false);
  await recordAudit({
    organizationId: null,
    actorId: actor.id,
    actorRole: 'platform_owner',
    action: 'site.draft_saved',
    targetType: 'site',
    targetId: null,
    details: null,
  });
  return state;
}

/** Publishes the given content (saving it as the draft too). */
export async function publishSite(
  input: Record<string, unknown>,
  actor: Actor,
) {
  const { state, before } = await persist(input, actor, true);
  const changed = [
    ...TEXT_KEYS,
    ...LIST_KEYS,
    'defaultCycle',
    'socials',
    'design',
  ] as const;
  await recordAudit({
    organizationId: null,
    actorId: actor.id,
    actorRole: 'platform_owner',
    action: 'site.published',
    targetType: 'site',
    targetId: null,
    details: {
      changedFields: changed.filter(
        (key) =>
          JSON.stringify(before[key]) !== JSON.stringify(state.published[key]),
      ),
    },
  });
  return state;
}

async function persist(
  input: Record<string, unknown>,
  actor: Actor,
  publish: boolean,
) {
  const validated = validate(input);
  // Retry when another request changes the row between reading and writing. The conditional
  // update commits content and history together, so concurrent saves cannot drop snapshots.
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = (await sql`SELECT * FROM site_content WHERE id`)[0] as
      | SiteRow
      | undefined;
    if (!row)
      throw new PlatformError(
        'O conteúdo do site ainda não foi inicializado.',
        503,
      );
    const currentDraft = withDefaults(row.draft ?? row.published);
    const before = withDefaults(row.published);
    const content = { ...validated };
    // Older text-only clients must not erase a theme already saved by the visual editor.
    if (!('design' in input) && (currentDraft.design || before.design))
      content.design = currentDraft.design || before.design;
    if (Buffer.byteLength(JSON.stringify(content), 'utf8') > 512_000)
      throw new PlatformError(
        'O conteúdo excede o limite de 500 KB. Reduza os textos ou a quantidade de componentes.',
      );
    const now = new Date().toISOString();
    const snapshot = (
      document: SiteContent,
      kind: SiteVersion['kind'],
      label: string,
      createdAt = now,
    ): SiteVersion => ({
      id: randomUUID(),
      label,
      createdAt,
      content: document,
      kind,
    });
    let versions = storedVersions(row);
    if (!versions.length) {
      versions = [
        snapshot(
          before,
          'published',
          'Site anterior',
          row.published_at ? new Date(row.published_at).toISOString() : now,
        ),
      ];
      if (row.draft && JSON.stringify(currentDraft) !== JSON.stringify(before))
        versions.unshift(
          snapshot(
            currentDraft,
            'draft',
            'Rascunho anterior',
            row.draft_updated_at
              ? new Date(row.draft_updated_at).toISOString()
              : now,
          ),
        );
    }
    // The previous public page must remain restorable even after many draft-only saves.
    if (
      publish &&
      !versions
        .slice(0, HISTORY_LIMIT - 1)
        .some(
          (version) =>
            version.kind === 'published' &&
            JSON.stringify(version.content) === JSON.stringify(before),
        )
    )
      versions.unshift(
        snapshot(
          before,
          'published',
          'Site anterior',
          row.published_at ? new Date(row.published_at).toISOString() : now,
        ),
      );
    versions = [
      snapshot(
        content,
        publish ? 'published' : 'draft',
        publish ? 'Site publicado' : 'Rascunho salvo',
      ),
      ...versions,
    ].slice(0, HISTORY_LIMIT);
    const draft = { ...content, [HISTORY_KEY]: versions };
    const rows = await sql`
      UPDATE site_content
      SET draft = ${JSON.stringify(draft)}::jsonb, draft_updated_at = NOW(),
          published = CASE WHEN ${publish} THEN ${JSON.stringify(content)}::jsonb ELSE published END,
          published_at = CASE WHEN ${publish} THEN NOW() ELSE published_at END,
          published_by = CASE WHEN ${publish} THEN ${actor.id}::uuid ELSE published_by END
      WHERE id
        AND draft IS NOT DISTINCT FROM ${row.draft == null ? null : JSON.stringify(row.draft)}::jsonb
        AND published IS NOT DISTINCT FROM ${row.published == null ? null : JSON.stringify(row.published)}::jsonb
      RETURNING *
    `;
    if (rows.length) return { state: editorState(rows[0]), before };
  }
  throw new PlatformError(
    'O site foi alterado em outra sessão. Tente salvar novamente; suas alterações continuam no editor.',
    409,
  );
}
