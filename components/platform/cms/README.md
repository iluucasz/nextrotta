# Editor visual do site

Entrada: `/plataforma/site`. A página usa o mesmo `HomeContent` e `SiteShell` do site público, dentro de um iframe com largura real de 1280 px (desktop) ou 390 px (celular). O zoom altera apenas a apresentação do canvas.

- Arrastar seções na árvore ou no canvas; componentes da biblioteca também podem ser arrastados.
- Seleção diretamente na página, propriedades, cores por seção, paleta global, fontes, espaçamentos e formas.
- Inserção de texto, imagem, texto com imagem, banner, espaçamento e seções prontas do produto.
- Duplicação, ocultação, arquivamento e restauração sem exclusão definitiva.
- Histórico de edição com desfazer/refazer; restauração de uma versão sempre entra como rascunho.
- Recuperação local de alterações, separada do rascunho salvo e da versão publicada.
- Prévia das páginas inicial, planos, contato, sob medida, novidades e textos legais. Formulários e links não enviam dados nem navegam para fora do canvas.

## Contrato de persistência

O editor preserva `GET /api/platform/site`, `PUT` para rascunho e `POST` para publicar. O corpo contém os campos existentes de `SiteContent`, acrescidos de `design`, definido em `components/site/theme.ts`:

```ts
design: {
  schemaVersion: 1,
  theme: { primary, background, text, muted, surface, accent, font, radius, buttonRadius },
  sections: [{ id, type, name, hidden, archived, settings }],
  header?: { ctaLabel, ctaHref },
  footer?: { tagline, signature }
}
```

Seções antigas recebem a configuração padrão em `designFor`, sem alterar seu conteúdo. `settings.items` permite duplicar e editar listas de uma seção sem mudar outra cópia.

A resposta do editor pode trazer `designSupported: true` e `versions: SiteVersion[]`. Versões têm `id`, `label`, `createdAt`, `kind` (`draft` ou `published`) e `content`. O site público já renderiza `design` quando presente no conteúdo fornecido pelo layout.

O servidor valida e salva o documento completo, incluindo `design`. Os tipos compartilhados ficam em `lib/site/content.ts`. As últimas 30 versões ficam no JSONB do rascunho, em `_cmsVersions`, sem migração. Esse campo é controlado pelo servidor e removido do conteúdo público e dos documentos retornados ao editor. Salvar rascunho preserva a publicação; publicar grava o documento completo e preserva as versões anteriores. A gravação de conteúdo e histórico é atômica, com repetição em caso de alteração concorrente. Recuperar uma versão apenas a carrega no editor até o próximo salvamento/publicação.

## Verificação

`npx tsc --noEmit`.

`node --test components/platform/cms/persistence.test.mjs` executa o código real de persistência com o adaptador de banco substituído em memória. Verifica validação, tema completo, separação entre rascunho e publicado, histórico, restauração, retenção, compatibilidade com conteúdo antigo e conflitos concorrentes. Não acessa o banco real.

`validate.mjs` usa Chrome via CDP, um servidor de desenvolvimento isolado e respostas de API interceptadas. Valida o canvas, edição em tempo real, desfazer/refazer, cores, inserção, duplicação, arquivamento, restauração, drag-and-drop, payload completo de rascunho, versão publicada independente e apresentação móvel. Nenhuma mutação de API chega ao servidor real nesse teste.

O `validate.mjs` gera capturas de tela (`editor-*.png`) nesta pasta; elas não são versionadas. A autorização de acesso continua sob responsabilidade do middleware e do layout existentes.
