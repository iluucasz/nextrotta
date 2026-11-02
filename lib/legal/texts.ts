import { LEGAL_DOCUMENTS, type LegalDocument } from './versions';

// The text of the public legal documents. They live in code (not in the site editor) because what a company accepts
// must be exactly what was shown, tied to the version in versions.ts: change a text here, change its version there.
//
// IMPORTANT: these are drafts ("minutas") written to be reviewed by a lawyer who knows Brazilian law before the commercial
// launch. While `LEGAL_REVIEWED` is false every document says so at the top. After the review, adjust the texts, bump the
// versions (companies are asked to accept again) and set it to true.
export const LEGAL_REVIEWED = false;

/** Who the company behind the platform is. Empty fields show as a visible blank, never an invented value. */
export type LegalCompany = { legalName: string; cnpj: string; email: string; address?: string; city?: string };

const blank = (value: string | undefined, label: string) => (value && value.trim() ? value.trim() : `[${label} a informar]`);

const NOTICE =
  '**Versão preliminar, em revisão jurídica.** Este texto será revisado por advogado antes do lançamento comercial e pode mudar; cada mudança relevante exige novo aceite.';

function header(document: LegalDocument, title: string): string {
  const version = LEGAL_DOCUMENTS[document].version;
  return `# ${title}\n\nVersão ${version}${LEGAL_REVIEWED ? '' : `\n\n${NOTICE}`}\n`;
}

function who(company: LegalCompany) {
  return `${blank(company.legalName, 'razão social')}, inscrita no CNPJ sob o nº ${blank(company.cnpj, 'CNPJ')}, que opera a plataforma NextRotta (“NextRotta”)`;
}

function terms(company: LegalCompany): string {
  const contact = blank(company.email, 'e-mail de contato');
  return `${header('terms', 'Termos de uso e contrato de assinatura')}
## 1. Quem somos e o que este contrato cobre
Este contrato é firmado entre ${who(company)}, e a empresa que contrata a plataforma (“Empresa”), representada por quem faz o cadastro, que declara ter poderes para isso. A NextRotta é um sistema online (SaaS) para organizar equipes técnicas: técnicos, ordens de serviço, escala, horas, folha, financeiro e recursos opcionais conforme o plano contratado.
## 2. Cadastro e acessos
**2.1** A Empresa responde pela veracidade dos dados do cadastro e por todos os usuários que criar. **2.2** Cada pessoa usa seu próprio acesso; a senha é pessoal e não deve ser compartilhada. **2.3** A Empresa deve desativar o acesso de quem sair. **2.4** Tudo o que for feito com os acessos da Empresa é considerado feito por ela.
## 3. Planos, preços e pagamento
**3.1** Os planos, os módulos opcionais, os limites e os preços são os informados no momento da contratação e ficam registrados na assinatura. **3.2** A implantação é cobrada à parte, uma vez. **3.3** A mensalidade (ou anuidade) é cobrada pelo meio de pagamento escolhido, no dia de vencimento combinado. **3.4** Mudanças de preço valem para novas contratações; quem já contratou mantém o preço da assinatura, salvo reajuste previsto na assinatura ou comunicado com antecedência mínima de 30 dias. **3.5** A Empresa que ultrapassar os limites do plano pode contratar mais capacidade ou mudar de plano.
## 4. Atraso e suspensão
**4.1** O não pagamento não apaga dados. Primeiro há um período de carência; depois a conta passa a funcionar apenas para consulta, com as automações pausadas e a exportação dos dados liberada. **4.2** Suspensa ou cancelada, a Empresa continua podendo consultar tudo, em modo somente leitura, pelo período definido nas configurações da plataforma; depois disso só consegue baixar seus dados. **4.3** Pagando o que estiver em aberto, o acesso completo volta. **4.4** A NextRotta pode suspender imediatamente contas usadas para fraude, ataque ou violação grave destes termos.
## 5. A Empresa e os dados que ela cadastra
**5.1** Os dados que a Empresa registra (técnicos, serviços, horas, folha, clientes etc.) continuam sendo dela. A NextRotta recebe apenas a licença necessária para operar o serviço. **5.2** A Empresa declara ter base legal para cadastrar dados de seus empregados e prestadores, e para os usos que fizer deles na plataforma, e deve informá-los como exige a lei. **5.3** Em relação a esses dados, a Empresa é controladora e a NextRotta é operadora, conforme o Acordo de Tratamento de Dados (DPA), parte integrante deste contrato. **5.4** A Empresa pode exportar seus dados a qualquer momento.
## 6. Cálculos, folha e obrigações da Empresa
**6.1** A plataforma é uma ferramenta de apoio. Os cálculos seguem as regras que a própria Empresa configura (comissão, jornada, adicionais, descontos). **6.2** A Empresa é responsável por conferir os resultados antes de pagar qualquer pessoa, por suas obrigações trabalhistas, previdenciárias, fiscais e contábeis e por validar as regras com seu contador ou assessoria. **6.3** A NextRotta não presta consultoria jurídica, trabalhista, contábil ou fiscal.
## 7. Integrações com terceiros
**7.1** Portal do prestador (robô do Porto): a Empresa declara ter autorização para usar as credenciais informadas e para automatizar a consulta aos seus dados nesse portal, e responde pelo cumprimento dos termos dele. A NextRotta não tem vínculo com o portal; mudanças ou bloqueios feitos por ele podem interromper a integração. **7.2** WhatsApp: o envio usa o número da Empresa por meio de uma API que não é oficial da Meta. Existe risco de restrição ou bloqueio do número pelo WhatsApp; a Empresa assume esse risco e deve usar o canal de acordo com as regras do aplicativo e com o consentimento de quem recebe. **7.3** Pagamentos (Asaas, Mercado Pago e similares): regidos pelos termos de cada provedor. **7.4** Cada integração pode ser ligada, desligada ou testada pela Empresa.
## 8. Inteligência artificial
**8.1** O assistente de IA usa créditos do plano. **8.2** As respostas podem conter erros e devem ser conferidas antes de qualquer decisão. **8.3** Para responder, a pergunta e os dados que o assistente consulta são enviados a um provedor de IA fora do Brasil; a Empresa só usa o assistente depois de concordar expressamente com isso (Política de privacidade, seção “Inteligência artificial”). **8.4** Os dados enviados não são usados pela NextRotta para treinar modelos.
## 9. Disponibilidade, backups e segurança
**9.1** A NextRotta mantém a plataforma com esforço razoável de disponibilidade, mas não garante funcionamento ininterrupto; manutenções programadas são avisadas quando possível. **9.2** São feitas cópias de segurança diárias de cada empresa, guardadas pelo prazo do plano, que a administração pode baixar ou restaurar pela plataforma. **9.3** A NextRotta adota medidas técnicas e administrativas de segurança descritas no DPA. **9.4** A Empresa deve manter seus equipamentos e acessos seguros.
## 10. Responsabilidade
**10.1** A NextRotta responde pelos danos diretos que causar por falha comprovada do serviço, limitados ao valor pago pela Empresa nos 12 meses anteriores ao fato. **10.2** Não respondemos por lucros cessantes, perda de oportunidade, danos indiretos, decisões tomadas sem conferência, indisponibilidade de terceiros (portal, WhatsApp, meios de pagamento, provedor de IA) nem por uso em desacordo com estes termos. **10.3** Nada neste contrato limita responsabilidade que a lei não permita limitar.
## 11. Propriedade intelectual
O software, as marcas, os textos e os desenhos da NextRotta pertencem a ela. A Empresa recebe um direito de uso, não exclusivo e intransferível, enquanto o contrato durar.
## 12. Duração e encerramento
**12.1** O contrato vale por prazo indeterminado, no ciclo escolhido (mensal ou anual). **12.2** A Empresa pode cancelar pelo suporte; o cancelamento vale ao fim do ciclo já pago e valores já pagos não são devolvidos, salvo previsão legal. **12.3** Se a Empresa for consumidora nos termos do Código de Defesa do Consumidor, valem os direitos dele, inclusive o de arrependimento em 7 dias nas contratações a distância. **12.4** Encerrado o contrato, os dados ficam disponíveis para exportação pelo período indicado na seção 4 e depois são tratados como descrito no DPA.
## 13. Mudanças nestes termos
Podemos atualizar este texto. Mudanças relevantes são comunicadas na plataforma e exigem novo aceite do administrador, que fica registrado com versão, data e origem.
## 14. Lei e foro
Este contrato é regido pela lei brasileira. Fica eleito o foro ${blank(company.city, 'comarca do foro')}, salvo quando a lei determinar outro.
## 15. Contato
Dúvidas, suporte e assuntos de privacidade: ${contact}. Pedidos de titulares de dados: página “Privacidade e seus direitos”.`;
}

function privacy(company: LegalCompany): string {
  const contact = blank(company.email, 'e-mail de contato');
  return `${header('privacy', 'Política de privacidade')}
## 1. Quem é responsável
${who(company)} trata dados pessoais de duas formas: como **controladora**, dos dados da conta, da cobrança e do uso da plataforma; e como **operadora**, dos dados que cada empresa cliente cadastra sobre seus técnicos, empregados e clientes (nesse caso a empresa cliente é a controladora e decide como os dados são usados; veja o DPA). Contato do responsável pelo tratamento de dados pessoais (encarregado): ${contact}.
## 2. Quais dados tratamos
**Conta e contratação:** nome, e-mail, telefone, CNPJ/CPF, endereço, cargo do administrador, dados de cobrança. **Uso da plataforma:** acessos, endereço IP, navegador, data e hora, ações sensíveis (registro de auditoria). **Dados operacionais da empresa cliente:** técnicos (nome, e-mail, telefone, QRA, valores de salário, comissão e benefícios, horas, escala, advertências), serviços e ordens de serviço, folha, descontos, financeiro, peças vendidas e documentos que a empresa enviar. **Suporte:** o que for escrito nos chamados. **Pedidos de titulares:** nome, e-mail e o conteúdo do pedido.
## 3. Para que usamos e em que base legal
Prestar o serviço contratado e cumprir o contrato (art. 7º, V da LGPD); cobrar e emitir documentos fiscais, guardar registros pelos prazos da lei (art. 7º, II); manter a segurança, prevenir fraudes e auditar acessos (art. 7º, IX, legítimo interesse); atender pedidos de titulares e a autoridades (art. 7º, II); enviar avisos operacionais do serviço. Não vendemos dados e não usamos dados dos clientes para publicidade.
## 4. Com quem compartilhamos
Usamos prestadores (operadores e suboperadores) apenas para operar o serviço: hospedagem do aplicativo e armazenamento de arquivos (Vercel), banco de dados (Neon), servidor próprio para as automações (VPS), cobrança (Asaas), pagamentos de vendas de peças (Mercado Pago, na conta do próprio técnico), envio de mensagens por WhatsApp (servidor Evolution, com o número da empresa) e inteligência artificial (DeepSeek). A lista atualizada está no DPA. Também podemos compartilhar por obrigação legal ou ordem de autoridade.
## 5. Inteligência artificial
O assistente envia ao provedor de IA a pergunta e os dados que ele precisa consultar para responder (por exemplo, técnicos, serviços, horas e folha). O provedor fica fora do Brasil, o que configura transferência internacional de dados (art. 33 da LGPD), feita com base no contrato e no consentimento específico da empresa, que só pode usar o assistente depois de concordar. Não usamos esses dados para treinar modelos. A empresa pode não usar o assistente: o restante da plataforma funciona sem ele.
## 6. Por quanto tempo guardamos
Enquanto a assinatura estiver ativa e, depois dela, pelo período de consulta e exportação previsto nos Termos. A plataforma não apaga dados por falta de pagamento: o que é excluído pelo usuário fica na lixeira e pode ser restaurado. Cópias de segurança diárias são guardadas pelo prazo do plano e depois removidas. Dados de cobrança e fiscais são mantidos pelos prazos legais. Registros de auditoria são mantidos para a segurança do serviço. Pedidos de eliminação seguem o DPA e a lei, que permite manter dados necessários a obrigações legais e ao exercício de direitos.
## 7. Seus direitos
A LGPD (art. 18) garante a você, titular, confirmar que tratamos seus dados, acessá-los, corrigi-los, pedir anonimização, bloqueio ou eliminação do que for desnecessário ou excessivo, portabilidade, informação sobre compartilhamentos, revogar consentimento e se opor a um tratamento. Para exercer, use a página **Privacidade e seus direitos** ou escreva para ${contact}. Respondemos em até 15 dias. Se você é técnico ou funcionário de uma empresa que usa a NextRotta, a controladora dos seus dados é essa empresa; encaminhamos seu pedido a ela quando for o caso. Você também pode reclamar à Autoridade Nacional de Proteção de Dados (ANPD).
## 8. Segurança
Usamos conexão criptografada, senhas armazenadas com hash, isolamento dos dados de cada empresa, controle de acesso por papel, proteção contra tentativas repetidas de login, registro de ações sensíveis, cópias de segurança e armazenamento privado de arquivos. Nenhum sistema é 100% seguro. Em caso de incidente que possa causar risco ou dano relevante, comunicaremos as empresas afetadas e a ANPD nos termos da lei.
## 9. Cookies e tecnologias semelhantes
Veja a Política de cookies.
## 10. Crianças
A plataforma é voltada a empresas e profissionais; não é destinada a menores de 18 anos.
## 11. Mudanças
Atualizações relevantes são comunicadas na plataforma, com a data da versão no topo.
## 12. Fale com a gente
${contact}.`;
}

function dpa(company: LegalCompany): string {
  const contact = blank(company.email, 'e-mail de contato');
  return `${header('dpa', 'Acordo de tratamento de dados (DPA)')}
Este acordo faz parte do contrato entre a empresa cliente (“Controladora”) e ${who(company)} (“Operadora”), e segue a Lei nº 13.709/2018 (LGPD).
## 1. Objeto e papéis
**1.1** A Operadora trata dados pessoais por conta e conforme as instruções da Controladora, para fornecer a plataforma. **1.2** Quanto aos dados da conta, da cobrança e do uso da plataforma, a NextRotta é controladora (Política de privacidade).
## 2. Dados e titulares
**Titulares:** técnicos, empregados, prestadores, usuários e clientes finais da Controladora. **Dados:** identificação e contato, QRA, valores de salário, comissão e benefícios, horas trabalhadas, escala, advertências, ordens de serviço e endereços de atendimento, dados de vendas de peças, conteúdo enviado pela Controladora. Não é objetivo da plataforma tratar dados pessoais sensíveis; a Controladora deve evitar cadastrá-los.
## 3. Instruções e finalidade
A Operadora só trata os dados para prestar o serviço contratado e para as instruções dadas pela Controladora por meio da plataforma, e não os usa para outra finalidade. A Operadora avisará se uma instrução parecer violar a lei.
## 4. Obrigações da Controladora
Ter base legal para os dados que cadastra, informar os titulares, manter os acessos de seus usuários seguros, decidir sobre guarda, correção e eliminação dos dados e responder aos titulares como controladora.
## 5. Confidencialidade
O acesso aos dados é restrito a quem precisa dele para prestar o serviço, com dever de sigilo. O acesso do dono da plataforma às contas é registrado em auditoria (com motivo, em caso de entrada na conta da empresa).
## 6. Segurança
A Operadora mantém, no mínimo: isolamento lógico dos dados por empresa; conexão criptografada; senhas armazenadas com hash; controle de acesso por papel; limite de tentativas de login; registro de ações sensíveis; exclusão lógica com lixeira e restauração; cópia de segurança diária por empresa; armazenamento privado de arquivos; acesso administrativo restrito e auditado.
## 7. Suboperadores
**7.1** A Controladora autoriza, de forma geral, o uso dos suboperadores abaixo para operar o serviço: hospedagem e arquivos (Vercel), banco de dados (Neon), servidor de automações (VPS contratada pela NextRotta), cobrança (Asaas, Brasil), mensagens (servidor Evolution/WhatsApp), pagamentos de peças (Mercado Pago, na conta do próprio técnico) e inteligência artificial (DeepSeek, fora do Brasil, somente se a Controladora aceitar o envio de dados ao provedor de IA). **7.2** A Operadora exige deles proteção compatível e avisará a Controladora, com antecedência razoável, sobre mudanças relevantes na lista, que poderá se opor ou deixar de usar o recurso envolvido.
## 8. Transferência internacional
Alguns suboperadores armazenam ou processam dados fora do Brasil. A transferência é feita com amparo no art. 33 da LGPD (cláusulas contratuais, garantias do fornecedor e, quanto à IA, consentimento específico da Controladora).
## 9. Direitos dos titulares
A Operadora ajuda a Controladora a responder aos titulares: oferece exportação dos dados, correção e anonimização de cadastros. Pedidos feitos diretamente à Operadora sobre dados da Controladora são encaminhados a ela.
## 10. Incidentes de segurança
A Operadora comunicará à Controladora, sem demora injustificada e, sempre que possível, em até 48 horas depois de tomar ciência, incidente que afete seus dados, com o que se sabe sobre natureza, dados envolvidos, medidas tomadas e riscos, para que a Controladora cumpra o art. 48 da LGPD perante a ANPD e os titulares.
## 11. Auditoria e informações
Mediante pedido por escrito, a Operadora presta as informações necessárias para demonstrar o cumprimento deste acordo, uma vez por ano, ou após incidente.
## 12. Fim do contrato
Ao fim do contrato, a Controladora pode exportar seus dados durante o período de consulta previsto nos Termos. Depois dele, a Operadora elimina ou anonimiza os dados, salvo os que precise guardar por obrigação legal, e as cópias de segurança são removidas no fim do prazo de retenção do plano. A eliminação definitiva é feita a pedido ou conforme o prazo informado.
## 13. Responsabilidade
Cada parte responde conforme a LGPD e o contrato, sujeita aos limites de responsabilidade dos Termos, quando a lei permitir.
## 14. Contato do encarregado
${contact}.`;
}

function cookies(company: LegalCompany): string {
  const contact = blank(company.email, 'e-mail de contato');
  return `${header('privacy', 'Política de cookies')}
## O que usamos
**Cookies essenciais**, sem os quais a plataforma não funciona: o cookie de sessão (mantém você conectado), o cookie que lembra a última empresa acessada neste navegador (somente o endereço, sem dados de acesso) e indicadores de modo (por exemplo, quando o dono da plataforma está dentro da conta de uma empresa). **Armazenamento do navegador**, para preferências de tela, como menus recolhidos. **Medição de visitas**, em produção, por ferramenta de análise agregada da hospedagem, sem cookies de publicidade e sem identificar você.
## O que não usamos
Não usamos cookies de publicidade, de remarketing nem de redes sociais.
## Como controlar
Você pode apagar cookies e dados do site nas configurações do navegador; sem os essenciais, será preciso entrar de novo.
## Contato
${contact}.`;
}

export function legalText(document: 'terms' | 'privacy' | 'dpa' | 'cookies', company: LegalCompany): string {
  if (document === 'terms') return terms(company);
  if (document === 'privacy') return privacy(company);
  if (document === 'dpa') return dpa(company);
  return cookies(company);
}
