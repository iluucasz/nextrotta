'use client';
import { type CSSProperties, type ReactNode } from 'react';
import { Battery, Check, FileText, Lightbulb, Lock, Send, Sparkles } from 'lucide-react';
import './news-art.css';
import { Stage, useReplay } from './visuals';
import { Click, Count, Pill, d } from './tour-scenes';

/**
 * Ilustrações animadas para dentro das novidades: o sistema desenhado de forma abstrata, na mesma
 * linguagem do tour da home (tour-scenes.tsx). Os dados são inventados. Uma cena entra no texto da
 * novidade com `[[cena:nome]]` numa linha só (ver lib/news-scenes.ts). Para mudar uma cena, edite só a
 * função dela aqui; para criar uma, acrescente-a em SCENES.
 */

const BARCODE = [1, 2, 1, 3, 1, 1, 2, 1, 3, 1, 2, 1, 1, 3];
const Barcode = ({ shift = 0 }: { shift?: number }) => (
  <div className="nrn-bars" aria-hidden>
    {BARCODE.map((_, i) => <i key={i} style={{ width: `${BARCODE[(i + shift) % BARCODE.length] * 0.13}em` }} />)}
  </div>
);

// ---------------------------------------------------------------------------------------------
// Venda de Peças
// ---------------------------------------------------------------------------------------------
function PecasRemessa() {
  const central = [['Bateria 60Ah', '12 un'], ['Lâmpada H7', '30 un'], ['Pastilha de freio', '18 un']];
  const tech = [['Bateria 60Ah', 3], ['Lâmpada H7', 6], ['Pastilha de freio', 4]] as const;
  return (
    <>
      <div className="nrt-title nrt-rise" style={d(0)}>Remessa de peças<Pill style={d(0.2)}>consignação</Pill></div>
      <div className="nrt-panel nrt-rise" style={{ ...d(0.3), top: '4.4em', left: '1.2em', width: '14em' }}>
        <div className="nrt-panel-title">Estoque central</div>
        {central.map(([name, qty]) => (
          <div className="nrt-line" key={name}><span>{name}</span><em className="nrt-money">{qty}</em></div>
        ))}
      </div>
      <svg className="nrn-svg" viewBox="0 0 440 240" aria-hidden>
        <path d="M156 92 C 200 92, 232 92, 276 92" fill="none" stroke="rgba(127,224,181,.3)" strokeWidth="2" strokeDasharray="3 6" />
        {Array.from({ length: 4 }, (_, i) => (
          <g key={i} opacity="0">
            <rect x="-7" y="-7" width="14" height="14" rx="3" fill="#7fe0b5" />
            <animateMotion dur="2s" begin={`${1.2 + i * 0.5}s`} repeatCount="indefinite" path="M156 92 C 200 92, 232 92, 276 92" />
            <animate attributeName="opacity" dur="2s" begin={`${1.2 + i * 0.5}s`} repeatCount="indefinite" values="0;1;1;0" keyTimes="0;0.12;0.85;1" />
          </g>
        ))}
      </svg>
      <div className="nrt-panel nrt-rise" style={{ ...d(0.5), top: '4.4em', left: '28em', width: '14.8em', height: '17.4em' }}>
        <div className="nrt-panel-title nrn-head"><i className="nrt-avatar">RM</i>Estoque do Rafael</div>
        {tech.map(([name, qty], i) => (
          <div className="nrt-line" key={name}><span>{name}</span><em className="nrt-money"><Count to={qty} delay={2.2 + i * 0.4} dur={0.7} suffix=" un" /></em></div>
        ))}
        <div className="nrn-status">
          <Pill tone="plain"><span className="nrt-swap" style={d(4.8)}><s>Aguardando</s><u>Confirmada</u></span></Pill>
        </div>
        <button type="button" className="nrt-btn nrt-btn-press" tabIndex={-1} style={{ position: 'absolute', left: '1em', right: '1em', bottom: '1em', '--d': '4.4s' } as CSSProperties}>Confirmar recebimento</button>
      </div>
      <Click from={[22, 23]} to={[34.8, 19.0]} delay={3.0} />
      <div className="nrt-toast nrt-rise" style={{ ...d(5.6), left: '1.2em', bottom: '1.2em' }}><FileText size={14} /> Termo de remessa pronto para imprimir</div>
    </>
  );
}

/** `tall`: a mesma cena na janela mais alta do tour da home (44 × 28). */
export function PecasVenda({ tall = false }: { tall?: boolean }) {
  const off = tall ? 1.8 : 0;
  const steps: [string, string, number][] = [
    ['Escolhe a peça', 'Bateria 60Ah, direto do estoque dele', 0.8],
    ['Define o preço', 'R$ 480,00, o técnico decide', 2.7],
    ['Cobra com Pix', 'QR Code na tela do celular', 4.3],
    ['Recebe e baixa o estoque', 'Recibo enviado no WhatsApp', 5.9],
  ];
  return (
    <>
      <div className="nrt-title nrt-rise" style={d(0)}>Venda pelo celular<Pill style={d(0.2)}>Pix</Pill></div>
      <div className="nrt-panel nrt-rise nrn-steps" style={{ ...d(0.3), top: `${4.4 + off}em`, left: '1.2em', width: '25em' }}>
        {steps.map(([title, text, at], i) => (
          <div className="nrn-step" key={title} style={d(at)}>
            <i><b>{i + 1}</b><Check size={13} strokeWidth={3} /></i>
            <div><strong>{title}</strong><small>{text}</small></div>
          </div>
        ))}
      </div>
      <div className="nrt-phone nrt-pop nrn-phone" style={{ ...d(0.2), top: `${2.2 + off}em` }}>
        <div className="nrn-ps">
          <div className="nrn-screen" style={{ ...d(0.4), '--dur': '2.3s' } as CSSProperties}>
            <small>Minhas peças</small>
            <div className="nrn-tiles">
              <div className="nrn-tile nrn-tile-hit" style={d(1.2)}><Battery size={20} /><b>Bateria</b><em>2 un</em></div>
              <div className="nrn-tile"><Lightbulb size={20} /><b>Lâmpada</b><em>4 un</em></div>
            </div>
          </div>
          <div className="nrn-screen" style={{ ...d(2.7), '--dur': '1.6s' } as CSSProperties}>
            <small>Bateria 60Ah</small>
            <div className="nrn-price"><Count to={480} delay={2.9} dur={0.8} prefix="R$ " />,00</div>
            <span className="nrn-cta">Cobrar com Pix</span>
          </div>
          <div className="nrn-screen" style={{ ...d(4.3), '--dur': '1.6s' } as CSSProperties}>
            <div className="nrn-qr">{Array.from({ length: 49 }, (_, i) => <i key={i} className={(i * 7 + (i % 5)) % 3 === 0 ? 'on' : ''} />)}</div>
            <small>Aguardando o pagamento…</small>
          </div>
          <div className="nrn-screen nrn-screen-keep" style={d(5.9)}>
            <span className="nrn-ok"><Check size={26} strokeWidth={3} /></span>
            <strong>Pago</strong>
            <small>Recibo enviado no WhatsApp</small>
          </div>
        </div>
      </div>
      <div className="nrt-toast nrt-rise" style={{ ...d(6.6), left: '1.2em', bottom: '1.2em' }}><Check size={14} strokeWidth={3} /> Estoque da Bateria: 2 → 1 un</div>
    </>
  );
}

export const ScenePecas = () => <PecasVenda tall />;

function PecasInventario() {
  const rows = [
    ['Bateria 60Ah', '1 de 2', false, 0],
    ['Lâmpada H7', '4 de 4', true, 3],
    ['Pastilha de freio', '3 de 3', true, 7],
  ] as const;
  return (
    <>
      <div className="nrt-title nrt-rise" style={d(0)}>Inventário<Pill style={d(0.2)}>código de barras</Pill></div>
      <div className="nrt-panel nrt-rise" style={{ ...d(0.3), top: '4.4em', left: '1.2em', width: '25em', height: '14.6em' }}>
        <div className="nrt-panel-title">Conferência do Rafael</div>
        {rows.map(([name, count, ok, shift], i) => (
          <div className="nrt-line nrn-scanrow" key={name}>
            <Barcode shift={shift} />
            <span>{name}</span>
            <em className="nrt-money">{count}</em>
            {ok ? (
              <Pill style={d(1.6 + i * 1.1)}><Check size={11} strokeWidth={3} /> Ok</Pill>
            ) : (
              <Pill tone="amber" style={d(1.6 + i * 1.1)}>Falta 1</Pill>
            )}
          </div>
        ))}
        <i className="nrn-scan" style={d(0.9)} />
      </div>
      <div className="nrt-panel nrt-rise" style={{ ...d(0.6), top: '4.4em', left: '28.6em', width: '14.2em', height: '14.6em' }}>
        <div className="nrt-panel-title">Acerto de outubro</div>
        <div className="nrt-line nrt-fade" style={d(4.4)}><span>Peças vendidas</span><em className="nrt-money"><Count to={1620} delay={4.5} dur={0.8} prefix="R$ " /></em></div>
        <div className="nrt-line nrt-fade" style={d(4.8)}><span>Parcela da falta</span><em className="nrt-money"><Count to={40} delay={4.9} dur={0.6} prefix="R$ " /></em></div>
        <div className="nrt-line nrt-fade nrn-total" style={d(5.2)}><span>Total do mês</span><em className="nrt-money"><Count to={1660} delay={5.3} dur={0.8} prefix="R$ " /></em></div>
      </div>
      <div className="nrt-toast nrt-rise" style={{ ...d(6.4), left: '1.2em', bottom: '1.2em' }}><Check size={14} strokeWidth={3} /> Falta parcelada em 3x no acerto</div>
    </>
  );
}

function PecasPainel() {
  const tabs = ['Resumo', 'Vendas', 'Peças', 'Movimentações', 'Técnicos', 'Inventário', 'Acerto', 'Financeiro'];
  const bars = [38, 52, 44, 66, 58, 80, 100];
  return (
    <>
      <div className="nrt-title nrt-rise" style={d(0)}>Painel do administrador</div>
      <div className="nrn-tabs">
        {tabs.map((tab, i) => (
          <span key={tab} className={`nrn-tab ${i === tabs.length - 1 ? 'nrn-tab-last' : ''}`} style={d(0.6 + i * 0.5)}>{tab}</span>
        ))}
      </div>
      <div className="nrn-kpi-row">
        {[['Vendido no mês', <Count key="a" to={12.4} decimals={1} delay={4.6} prefix="R$ " suffix=" mil" />], ['Peças em campo', <Count key="b" to={186} delay={4.8} />], ['A receber', <Count key="c" to={3.9} decimals={1} delay={5} prefix="R$ " suffix=" mil" />]].map(([label, value], i) => (
          <div className="nrt-tile nrt-pop" key={String(label)} style={d(4.4 + i * 0.15)}><small>{label}</small><b>{value}</b></div>
        ))}
      </div>
      <div className="nrt-panel nrt-rise" style={{ ...d(4.6), top: '13.6em', left: '1.2em', right: '1.2em', height: '8em' }}>
        <div className="nrt-panel-title">Vendas por semana</div>
        <div className="nrn-col">
          {bars.map((h, i) => <i key={i} style={{ height: `${h}%`, ...d(5.2 + i * 0.1) }} />)}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Assistente de IA
// ---------------------------------------------------------------------------------------------
function IaConversa() {
  const asks = ['Compare com setembro', 'E a comissão de cada um?'];
  return (
    <>
      <div className="nrt-title nrt-rise" style={d(0)}><Sparkles size={15} /> Assistente de IA</div>
      <div className="nrt-chat">
        <div className="nrt-bubble nrt-bubble-me nrt-rise" style={d(0.2)}>
          <span className="nrt-type" style={{ ...d(0.5), '--n': 28, '--t': '1s' } as CSSProperties}>Quem produziu mais este mês?</span>
        </div>
        <div className="nrt-think nrt-think-show" style={d(1.8)}><i /><i /><i /></div>
        <div className="nrt-bubble nrt-bubble-ai nrt-rise" style={d(2.4)}>
          <p><b>Rafael</b> lidera o mês: R$ 22,8 mil em 100 atendimentos.</p>
          {[['Rafael', 100, '22,8'], ['Thiago', 97, '22,2'], ['Carlos', 90, '20,4']].map(([name, w, v], i) => (
            <div className="nrt-rank nrt-rank-ai" key={String(name)}>
              <small>{name}</small>
              <div className="nrt-meter"><s className="nrt-grow" style={{ ...d(2.8 + i * 0.2), width: `${w}%` }} /></div>
              <em>{v}</em>
            </div>
          ))}
        </div>
        <div className="nrt-sugg">
          {asks.map((q, i) => (
            <Pill key={q} tone="plain" style={d(3.6 + i * 0.2)}>{q}</Pill>
          ))}
        </div>
      </div>
      <div className="nrt-input nrt-rise" style={d(0.1)}>
        <span className="nrt-swap nrn-input-swap" style={d(5.4)}><s>Pergunte sobre a operação…</s><u>E a comissão de cada um?</u></span>
        <i className="nrt-send nrt-btn-press" style={{ '--d': '1.6s' } as CSSProperties}><Send size={13} /></i>
      </div>
      <Click from={[36, 12]} to={[16.5, 17.2]} delay={4.0} />
    </>
  );
}

function IaFontes() {
  const sources = ['Técnicos', 'Produção', 'Ordens de serviço', 'Folha', 'Horas e escala'];
  const rows = sources.map((_, i) => 5.6 + i * 3.8);
  return (
    <>
      <div className="nrt-title nrt-rise" style={d(0)}>De onde vêm as respostas</div>
      <svg className="nrn-svg" viewBox="0 0 440 240" aria-hidden>
        {rows.map((y, i) => {
          const path = `M124 ${y * 10} C 156 ${y * 10}, 152 134, 186 134`;
          return (
            <g key={i}>
              <path d={path} fill="none" stroke="rgba(127,224,181,.28)" strokeWidth="2" strokeDasharray="3 6" />
              <circle r="4" fill="#fff" opacity="0">
                <animateMotion dur="2.2s" begin={`${0.9 + i * 0.45}s`} repeatCount="indefinite" path={path} />
                <animate attributeName="opacity" dur="2.2s" begin={`${0.9 + i * 0.45}s`} repeatCount="indefinite" values="0;1;1;0" keyTimes="0;0.12;0.85;1" />
              </circle>
            </g>
          );
        })}
        <path d="M254 134 L 290 134" fill="none" stroke="rgba(127,224,181,.4)" strokeWidth="2" strokeDasharray="3 6" />
        <circle r="4.5" fill="#7fe0b5" opacity="0">
          <animateMotion dur="1.2s" begin="3.2s" repeatCount="indefinite" path="M254 134 L 290 134" />
          <animate attributeName="opacity" dur="1.2s" begin="3.2s" repeatCount="indefinite" values="0;1;1;0" keyTimes="0;0.15;0.8;1" />
        </circle>
      </svg>
      {sources.map((name, i) => (
        <span key={name} className="nrn-chip nrt-rise" style={{ top: `${rows[i] - 1.3}em`, ...d(0.3 + i * 0.14) }}><span>{name}</span></span>
      ))}
      <div className="nrn-hub nrt-pop" style={d(0.5)}><Sparkles size={22} /></div>
      <div className="nrt-panel nrt-rise" style={{ ...d(3.0), top: '6em', left: '29em', width: '13.8em' }}>
        <div className="nrt-panel-title">Resposta</div>
        {[['Rafael', 100], ['Thiago', 92], ['Carlos', 84]].map(([name, w], i) => (
          <div key={String(name)} className="nrt-rank">
            <small>{name}</small>
            <div className="nrt-meter"><s className="nrt-grow" style={{ ...d(3.4 + i * 0.2), width: `${w}%` }} /></div>
          </div>
        ))}
      </div>
      <div className="nrn-lock nrt-rise" style={d(1.6)}><Lock size={13} /> Somente leitura · só os dados da sua empresa</div>
    </>
  );
}

function IaCreditos() {
  const ledger: [string, string, number][] = [
    ['Cota mensal do plano', '+300', 0.6],
    ['Bônus de entrada', '+100', 0.9],
    ['Créditos extras', '+50', 1.2],
    ['Resposta do assistente', '−1', 3.2],
    ['Resposta do assistente', '−1', 4.0],
  ];
  return (
    <>
      <div className="nrt-title nrt-rise" style={d(0)}><Sparkles size={15} /> Créditos de IA<Pill style={d(0.2)}>por empresa</Pill></div>
      <div className="nrt-panel nrt-rise" style={{ ...d(0.3), top: '4.4em', left: '1.2em', width: '18em', height: '14.6em' }}>
        <div className="nrt-panel-title">Saldo</div>
        <div className="nrn-balance"><span className="nrt-swap" style={d(4.6)}><s>450</s><u>448</u></span></div>
        <small className="nrn-sub">créditos disponíveis</small>
        <div className="nrt-meter nrn-meter"><s className="nrt-grow" style={{ ...d(1.0), width: '88%' }} /></div>
        <button type="button" className="nrt-btn nrt-btn-press" tabIndex={-1} style={{ position: 'absolute', left: '1em', bottom: '1em', '--d': '6s' } as CSSProperties}>Comprar créditos</button>
      </div>
      <div className="nrt-panel nrt-rise" style={{ ...d(0.5), top: '4.4em', left: '21.4em', width: '21.4em', height: '14.6em' }}>
        <div className="nrt-panel-title">Extrato</div>
        {ledger.map(([label, value, at], i) => (
          <div key={i} className="nrt-line nrt-rise" style={d(at)}>
            <span>{label}</span>
            <em className={`nrt-money ${value.startsWith('−') ? 'nrn-neg' : 'nrn-pos'}`}>{value}</em>
          </div>
        ))}
      </div>
      <div className="nrt-toast nrt-rise" style={{ ...d(5.0), left: '1.2em', bottom: '1.2em' }}><Check size={14} strokeWidth={3} /> Cada resposta debita do saldo</div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Registro: nome usado em [[cena:nome]]
// ---------------------------------------------------------------------------------------------
type SceneDef = { title: string; caption: string; aspect: string; Scene: (props: { tall?: boolean }) => ReactNode };

export const NEWS_SCENES: Record<string, SceneDef> = {
  'pecas-remessa': { title: 'Remessa de peças', caption: 'Da central ao carro: o técnico confirma o recebimento e o termo sai pronto para imprimir.', aspect: '44 / 24', Scene: PecasRemessa },
  'pecas-venda': { title: 'Venda pelo celular', caption: 'No celular, o técnico escolhe a peça, cobra com Pix e o estoque baixa sozinho.', aspect: '44 / 24', Scene: PecasVenda },
  'pecas-inventario': { title: 'Inventário e acerto', caption: 'Inventário por código de barras: a falta vira débito parcelado no acerto do mês.', aspect: '44 / 24', Scene: PecasInventario },
  'pecas-painel': { title: 'Painel do administrador', caption: 'Nove abas para acompanhar vendas, estoque, movimentações e o financeiro.', aspect: '44 / 24', Scene: PecasPainel },
  'ia-conversa': { title: 'Assistente NextRotta', caption: 'Pergunte como falaria com uma pessoa: a resposta vem com números e sugestões de próximas perguntas.', aspect: '44 / 24', Scene: IaConversa },
  'ia-fontes': { title: 'Assistente NextRotta', caption: 'Ele consulta os dados da sua empresa, só para leitura, e nunca altera nada.', aspect: '44 / 24', Scene: IaFontes },
  'ia-creditos': { title: 'Créditos de IA', caption: 'Cota mensal do plano, bônus de entrada e créditos extras, com extrato de cada resposta.', aspect: '44 / 24', Scene: IaCreditos },
};

/** Uma cena dentro da novidade: janela escura com a animação (recomeça ao entrar na tela) e legenda. */
export function NewsFigure({ name }: { name: string }) {
  const def = NEWS_SCENES[name];
  const { ref, run } = useReplay(0.35);
  if (!def) return null;
  return (
    <figure ref={ref} className="nrv nrn-fig">
      <div className="nrt-window nrv-window">
        <div className="nrt-bar" aria-hidden>
          <i /><i /><i />
          <span>{def.title}</span>
        </div>
        <Stage run={run} aspect={def.aspect}>
          <def.Scene />
        </Stage>
      </div>
      <figcaption>
        {def.caption}
        <small>Ilustração com dados fictícios.</small>
      </figcaption>
    </figure>
  );
}
