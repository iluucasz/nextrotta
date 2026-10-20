/**
 * Panel sections reachable at /plataforma/<section>. The catch-all page (server) validates against
 * this list and PlatformRouter (client) renders them — keep both in sync by adding new sections here.
 */
export const PLATFORM_SECTIONS = [
  'organizacoes', 'financeiro', 'planos', 'cupons', 'creditos-ia', 'recursos', 'reports', 'bugs', 'leads',
  'novidades', 'site', 'operacao', 'auditoria', 'configuracoes',
];
