# LGPD, segurança e contratos

Pacote de proteção para operar o NextRotta com várias empresas. **Não é parecer jurídico e não impede processo**: reduz o risco com controles técnicos e textos-base (minutas) que **um advogado brasileiro precisa revisar antes do lançamento comercial**.

## Papéis na LGPD

- **Empresa cliente = controladora** dos dados de seus técnicos, empregados e clientes; **NextRotta = operadora** (age por instrução dela). Contrato: DPA.
- **NextRotta = controladora** dos dados da conta, cobrança e uso (administradores, contato, IP, auditoria).
- Pedido de titular que chega à NextRotta sobre dados de uma empresa: o dono responde ou encaminha à empresa e registra no painel.

## O que existe no sistema

| Tema | Onde |
| --- | --- |
| Proteção do login contra tentativa repetida (5 erros em 15 min travam e-mail+endereço por 15 min; 40 por endereço; 20 por e-mail) e resposta igual para e-mail inexistente | `lib/security/throttle.ts`, `app/api/auth/login/route.ts`, tabela `auth_throttle` |
| Cabeçalhos de segurança (HSTS, nosniff, frame-ancestors, referrer, permissions, COOP) | `next.config.mjs` |
| Versão e aceite dos documentos (termos, privacidade, DPA, IA) com versão, data, IP, origem; aceite no cadastro pelo site | `lib/legal/versions.ts`, `acceptance.ts`, tabela `legal_acceptances` |
| Janela "Antes de continuar" para o admin quando a versão muda | `components/legal-gate.tsx`, `/api/organization/legal` |
| Consentimento específico para o assistente de IA (envio ao provedor fora do Brasil); sem aceite, o assistente não responde (servidor confere) | `lib/ai/assistant.ts` (`checkAvailability`), `components/assistant/consent.tsx` |
| Textos públicos: `/termos`, `/privacidade`, `/dpa`, `/cookies` (versionados no código, dados da empresa vêm de Conteúdo do site) | `lib/legal/texts.ts`, `components/site/site.tsx` |
| Canal do titular `/titular` → pedidos com prazo de 15 dias, aviso ao dono (WhatsApp de alertas) e tela **Privacidade** no painel | `lib/privacy/requests.ts`, `/api/public/privacy-requests`, `/api/platform/privacy-requests`, `components/platform/privacy.tsx`, tabela `data_subject_requests` |
| Cópia dos dados e anonimização de técnico (menu do técnico → "Dados pessoais"); mantém horas/serviços/folha, remove nome, contato, QRA e acesso; auditado | `lib/privacy/technician-data.ts`, `/api/technicians/[id]/privacy` |
| Já existiam | isolamento por `organization_id`, exclusão lógica, lixeira, auditoria, backup diário com restauração, exportação, entrada na conta com motivo auditado, Blob privado |

Testes: `node scripts/test-legal.cjs`. Para mudar um texto: edite `lib/legal/texts.ts` **e** suba a versão em `lib/legal/versions.ts` (todas as empresas voltam a ver a janela de aceite). Depois da revisão do advogado, ponha `LEGAL_REVIEWED = true` em `texts.ts` (some o aviso de "versão preliminar").

## O que o advogado precisa revisar

1. Termos de uso e contrato: teto de responsabilidade (12 meses de mensalidade), reajuste, cancelamento e devolução, foro, direito de arrependimento (CDC) se o cliente puder ser consumidor, SLA/disponibilidade, cláusula sobre folha/cálculos.
2. Política de privacidade: bases legais por finalidade, prazos de retenção (cobrança/fiscal), papel de controlador × operador.
3. DPA: prazo de aviso de incidente (48 h é proposta), lista de suboperadores, transferência internacional, eliminação ao fim do contrato.
4. Se há cobrança "à parte" da implantação e o cliente é pequeno: enquadramento no CDC.
5. Notas fiscais e CNAE da atividade (SaaS) — com o contador.

## Decisões do dono (preencher em Conteúdo do site e no painel)

- Razão social, CNPJ, e-mail de contato e do encarregado (DPO), foro (cidade). Enquanto vazios, os textos mostram "[... a informar]" — nunca valores inventados.
- Prazo de resposta a incidentes que será prometido; teto de responsabilidade.
- Política de eliminação ao fim do contrato (hoje: nada é apagado por falta de pagamento; exclusão definitiva só a pedido e das cópias vencidas).

## Riscos conhecidos (honestos)

- **DeepSeek (China)**: dados da empresa vão a provedor fora do Brasil. Há consentimento específico, mas a transferência internacional (LGPD art. 33) é ponto de atenção; avaliar provedor com região/contrato de proteção de dados equivalente.
- **Vercel Hobby**: o plano gratuito é para uso não comercial. Migrar para Pro antes de cobrar clientes.
- **WhatsApp via Evolution (API não oficial)**: risco de bloqueio do número; está nos Termos (a empresa assume), mas é risco de reclamação.
- **Credenciais do Porto**: a empresa declara ter autorização (Termos 7.1); sem isso o robô pode violar os termos do portal.
- **Retenção × "nada é apagado"**: o direito de eliminação (art. 18) é atendido por anonimização; dados que a empresa precisa guardar por lei ficam. Manter isso claro nas respostas.
- **Sem 2FA**; **CSP completo não está ativo** (só `frame-ancestors`/`base-uri`/`form-action`/`object-src`); **papel do Postgres sem DELETE/DDL ainda não criado**; **sem backup da plataforma inteira (Neon)** — só por empresa.
- **Restaurar uma cópia de segurança anterior a uma anonimização devolve os dados da pessoa**; depois de restaurar, repetir a anonimização dos pedidos já atendidos. As cópias guardam dados pelo prazo do plano (90/180 dias) e só então somem.
- Mensagens de "excluir" na UI do sistema ainda dizem excluir (é arquivar).
- Contas de teste e "kappa" têm aceites de desenvolvimento gravados.

## Fluxo de um pedido de titular

1. Pessoa envia em `/titular` → registro com prazo de 15 dias e alerta no WhatsApp do dono.
2. Dono abre **Privacidade** no painel, identifica a empresa (se for dado de técnico, a empresa é a controladora).
3. Acesso/portabilidade: a empresa baixa a cópia em Técnicos → ⋯ → Dados pessoais. Eliminação: anonimizar o mesmo cadastro.
4. Dono registra o que respondeu e marca como respondido (ou recusa com justificativa).

## Incidente de segurança

Comunicar empresas afetadas em até 48 h após a ciência (DPA) e, se houver risco ou dano relevante, à ANPD e aos titulares (LGPD art. 48; a ANPD pede aviso em 3 dias úteis). Guardar: o que aconteceu, dados envolvidos, medidas tomadas. A auditoria (`audit_events`) e os logs da Vercel/Neon são a fonte.
