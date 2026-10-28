'use client';
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Check, CheckCheck, Clock3, FileUp, Moon, Send, Sparkles } from 'lucide-react';

/**
 * Cenas animadas do "tour" da home: o sistema desenhado de forma abstrata, em movimento. Tudo é CSS
 * (animações com atraso `--d`) dentro de uma tela de 44 colunas (1em = 1/44 da largura), então escala
 * sozinho. Quem prefere menos movimento vê o quadro final parado (ver tour.css). Nenhum dado é real.
 */

export const d = (seconds: number): CSSProperties => ({ '--d': `${seconds}s` }) as CSSProperties;
export const at = (x: number, y: number, seconds = 0): CSSProperties => ({ left: `${x}em`, top: `${y}em`, '--d': `${seconds}s` }) as CSSProperties;

/** Número que sobe de 0 ao valor, depois de `delay` segundos. */
export function Count({ to, delay = 0, dur = 1.1, prefix = '', suffix = '', decimals = 0 }: { to: number; delay?: number; dur?: number; prefix?: string; suffix?: string; decimals?: number }) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setValue(to);
      return;
    }
    let raf = 0;
    const timer = window.setTimeout(() => {
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / (dur * 1000));
        setValue(to * (1 - Math.pow(1 - t, 3)));
        if (t < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }, delay * 1000);
    return () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
  }, [to, delay, dur]);
  return (
    <>
      {prefix}
      {value.toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
      {suffix}
    </>
  );
}

/** Cursor que vai de um ponto a outro, clica (com onda) e some. Posições em em. */
export function Click({ from, to, delay }: { from: [number, number]; to: [number, number]; delay: number }) {
  return (
    <>
      <span className="nrt-cursor" aria-hidden style={{ '--fx': `${from[0]}em`, '--fy': `${from[1]}em`, '--tx': `${to[0]}em`, '--ty': `${to[1]}em`, '--d': `${delay}s` } as CSSProperties}>
        <svg viewBox="0 0 24 24" width="1.7em" height="1.7em">
          <path d="M5 3l14 8-6.2 1.6L9.6 19z" fill="#fff" stroke="#0b2118" strokeWidth="1.4" strokeLinejoin="round" />
        </svg>
      </span>
      <span className="nrt-ripple" aria-hidden style={{ left: `${to[0]}em`, top: `${to[1]}em`, '--d': `${delay + 1.4}s` } as CSSProperties} />
    </>
  );
}

export const Pill = ({ children, tone = 'mint', style }: { children: ReactNode; tone?: 'mint' | 'amber' | 'plain'; style?: CSSProperties }) => (
  <span className={`nrt-pill nrt-pill-${tone}`} style={style}>{children}</span>
);

// ---------------------------------------------------------------------------------------------
// Operação
// ---------------------------------------------------------------------------------------------
export function SceneOperacao() {
  const kpis = [
    ['Valor produzido', <Count key="a" to={193} delay={0.5} prefix="R$ " suffix=" mil" />],
    ['Ordens de serviço', <Count key="b" to={864} delay={0.65} />],
    ['Folha do mês', <Count key="c" to={59} delay={0.8} prefix="R$ " suffix=" mil" />],
    ['Folhas fechadas', <Count key="d" to={100} delay={0.95} suffix="%" />],
  ] as const;
  return (
    <>
      <div className="nrt-title nrt-rise" style={d(0)}>Visão geral<Pill style={d(0.2)}>Outubro</Pill></div>
      <div className="nrt-kpis">
        {kpis.map(([label, value], i) => (
          <div key={label} className="nrt-tile nrt-pop" style={d(0.25 + i * 0.15)}>
            <small>{label}</small>
            <b>{value}</b>
          </div>
        ))}
      </div>
      <div className="nrt-panel nrt-rise" style={{ ...d(1.1), top: '13.4em', left: '1.2em', right: '1.2em' }}>
        <div className="nrt-panel-title">O que precisa de atenção</div>
        <div className="nrt-line"><i className="nrt-dot-amber" /><span>Folhas pendentes</span><Pill tone="amber" style={d(1.4)}>3 a fechar</Pill><span className="nrt-link" style={{ '--d': '3.6s' } as CSSProperties}>Abrir folha</span></div>
        <div className="nrt-line nrt-fade" style={d(1.8)}><i className="nrt-dot-ok"><Check size={11} strokeWidth={3} /></i><span>Resultado negativo</span><Pill>Ok</Pill></div>
        <div className="nrt-line nrt-fade" style={d(2.0)}><i className="nrt-dot-ok"><Check size={11} strokeWidth={3} /></i><span>Técnicos sem OS</span><Pill>Ok</Pill></div>
      </div>
      <Click from={[30, 24]} to={[39.2, 17.1]} delay={2.2} />
      <div className="nrt-toast nrt-rise" style={{ ...d(4.7), right: '1.2em', bottom: '1.2em' }}><Check size={14} strokeWidth={3} /> Folha de outubro aberta</div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Equipe e serviços
// ---------------------------------------------------------------------------------------------
export function SceneEquipe() {
  const rows = [
    ['RM', 'Rafael', 82, '30%'],
    ['CN', 'Carlos', 71, '30%'],
    ['BL', 'Bruno', 64, '28%'],
    ['DF', 'Diego', 58, '30%'],
    ['TB', 'Thiago', 77, '30%'],
  ] as const;
  return (
    <>
      <div className="nrt-title nrt-rise" style={d(0)}>Técnicos<Pill style={d(0.2)}>10 ativos</Pill></div>
      <div className="nrt-panel" style={{ top: '4em', left: '1.2em', width: '27em' }}>
        {rows.map(([ini, name, w, c], i) => (
          <div className="nrt-person nrt-rise" key={ini} style={d(0.3 + i * 0.16)}>
            <i className="nrt-avatar">{ini}</i>
            <span>{name}</span>
            <div className="nrt-meter"><s style={{ ...d(1.4 + i * 0.12), width: `${w}%` }} className="nrt-grow" /></div>
            <Pill style={d(0.8 + i * 0.16)}>{c}</Pill>
          </div>
        ))}
      </div>
      <div className="nrt-panel nrt-rise" style={{ ...d(0.5), top: '4em', right: '1.2em', width: '12.5em', height: '15.2em' }}>
        <div className="nrt-panel-title">Importar OS</div>
        <div className="nrt-drop"><FileUp size={22} /><small>planilha.xlsx</small></div>
        <div className="nrt-progress"><s className="nrt-grow nrt-fill-x" style={d(3.7)} /></div>
        <button type="button" className="nrt-btn nrt-btn-press" tabIndex={-1} style={{ position: 'absolute', left: '1em', bottom: '1em', '--d': '3.2s' } as CSSProperties}>Importar</button>
      </div>
      <Click from={[24, 10]} to={[37, 18.4]} delay={1.8} />
      <div className="nrt-toast nrt-rise" style={{ ...d(5.2), right: '1.2em', bottom: '1.2em' }}><Check size={14} strokeWidth={3} /> 86 ordens importadas</div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Robô do Porto
// ---------------------------------------------------------------------------------------------
export function ScenePorto() {
  const steps = ['Entra no portal', 'Importa os serviços', 'Calcula as horas', 'Lê a escala do mês'];
  return (
    <>
      <div className="nrt-title nrt-rise" style={d(0)}>Automação do Porto<Pill style={d(0.2)}><Moon size={11} /> 22:00 · toda noite</Pill></div>
      <svg className="nrt-net" viewBox="0 0 440 200" aria-hidden style={{ top: '3.2em' }}>
        <path id="nrt-route" d="M62 118 C 130 30, 200 190, 262 104" fill="none" stroke="rgba(127,224,181,.28)" strokeWidth="2" strokeDasharray="3 6" />
        <g className="nrt-node-a nrt-pop" style={d(0.3)}>
          <circle cx="62" cy="118" r="26" fill="rgba(87,182,255,.12)" stroke="#57b6ff" strokeWidth="2" />
          <circle cx="62" cy="118" r="10" fill="#bfe5ff" />
        </g>
        <g className="nrt-node-b nrt-pop" style={d(0.5)}>
          <circle cx="262" cy="104" r="34" fill="rgba(31,157,116,.2)" stroke="#1f9d74" strokeWidth="2.4" />
          <circle cx="262" cy="104" r="15" fill="#1f9d74" />
          <g className="nrt-orbit">
            {Array.from({ length: 8 }, (_, i) => (
              <circle key={i} cx={262 + Math.cos((i / 8) * Math.PI * 2) * 52} cy={104 + Math.sin((i / 8) * Math.PI * 2) * 52} r="4.5" fill="#7fe0b5" className="nrt-orbit-dot" style={{ animationDelay: `${1.4 + i * 0.35}s` }} />
            ))}
          </g>
        </g>
        {Array.from({ length: 5 }, (_, i) => (
          <circle key={i} r="4.5" fill="#fff" opacity="0" className="nrt-packet">
            <animateMotion dur="2.6s" begin={`${1 + i * 0.52}s`} repeatCount="indefinite" path="M62 118 C 130 30, 200 190, 262 104" />
            <animate attributeName="opacity" dur="2.6s" begin={`${1 + i * 0.52}s`} repeatCount="indefinite" values="0;1;1;0" keyTimes="0;0.12;0.88;1" />
          </circle>
        ))}
        <text x="62" y="170" textAnchor="middle" className="nrt-svg-label">Portal do Prestador</text>
        <text x="262" y="176" textAnchor="middle" className="nrt-svg-label nrt-svg-strong">NextRotta</text>
      </svg>
      <div className="nrt-panel nrt-rise" style={{ ...d(0.7), top: '4em', right: '1.2em', width: '13.4em' }}>
        {steps.map((step, i) => (
          <div key={step} className="nrt-line nrt-fade" style={d(1.4 + i * 1.0)}>
            <i className="nrt-dot-ok nrt-tick" style={d(1.9 + i * 1.0)}><Check size={11} strokeWidth={3} /></i>
            <span>{step}</span>
          </div>
        ))}
      </div>
      <div className="nrt-panel nrt-rise" style={{ ...d(0.9), top: '17.2em', left: '1.2em', width: '29em' }}>
        <div className="nrt-panel-title">Histórico de execuções</div>
        <div className="nrt-line nrt-fade" style={d(4.6)}><i className="nrt-dot-ok"><Check size={11} strokeWidth={3} /></i><span>Horas importadas</span><Pill>22:06 · 10 técnicos</Pill></div>
        <div className="nrt-line nrt-fade" style={d(5.4)}><i className="nrt-dot-ok"><Check size={11} strokeWidth={3} /></i><span>Escala do mês atualizada</span><Pill>23:04</Pill></div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Escala e horas
// ---------------------------------------------------------------------------------------------
export function SceneHoras() {
  const days = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
  const grid = [
    [0, 1, 1, 1, 1, 1, 0],
    [1, 1, 0, 1, 1, 1, 2],
    [0, 2, 1, 1, 1, 0, 1],
    [1, 0, 1, 1, 2, 1, 1],
  ];
  return (
    <>
      <div className="nrt-title nrt-rise" style={d(0)}>Escala da semana<Pill style={d(0.2)}>automática</Pill></div>
      <div className="nrt-panel" style={{ top: '4em', left: '1.2em', width: '29em' }}>
        <div className="nrt-week nrt-days">{days.map((x, i) => <b key={i}>{x}</b>)}</div>
        {grid.map((row, r) => (
          <div key={r} className="nrt-week">
            {row.map((cell, c) => (
              <i key={c} className={`nrt-shift nrt-shift-${cell} nrt-pop`} style={d(0.4 + (r * 7 + c) * 0.06)} />
            ))}
          </div>
        ))}
      </div>
      <div className="nrt-panel nrt-rise" style={{ ...d(1.2), top: '4em', right: '1.2em', width: '11.4em' }}>
        <div className="nrt-panel-title">Banco de horas</div>
        <div className="nrt-hbar"><small>Previsto</small><div className="nrt-meter"><s className="nrt-grow nrt-plain" style={{ ...d(1.8), width: '70%' }} /></div></div>
        <div className="nrt-hbar"><small>Realizado</small><div className="nrt-meter"><s className="nrt-grow" style={{ ...d(2.2), width: '86%' }} /></div></div>
        <Pill style={{ ...d(3.6), marginTop: '.6em' }}>Saldo +4,5 h</Pill>
      </div>
      <div className="nrt-toast nrt-rise" style={{ ...d(4.6), right: '1.2em', bottom: '1.2em' }}><Clock3 size={14} /> Horas importadas do Porto</div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Folha e WhatsApp
// ---------------------------------------------------------------------------------------------
export function SceneFolha() {
  const rows = [['Rafael', '6.307,70'], ['Carlos', '5.484,24'], ['Bruno', '5.174,38'], ['Diego', '4.579,89']];
  return (
    <>
      <div className="nrt-title nrt-rise" style={d(0)}>Folha de outubro<Pill tone="plain" style={d(0.2)}><span className="nrt-swap" style={d(3.4)}><s>em aberto</s><u>fechada</u></span></Pill></div>
      <div className="nrt-panel" style={{ top: '4em', left: '1.2em', width: '24em', height: '16.4em' }}>
        {rows.map(([name, value], i) => (
          <div className="nrt-line nrt-rise" key={name} style={d(0.3 + i * 0.15)}>
            <span>{name}</span>
            <em className="nrt-money">R$ {value}</em>
            <Pill tone="plain"><span className="nrt-swap" style={d(2.6 + i * 0.25)}><s>Aguardando</s><u>Fechada</u></span></Pill>
          </div>
        ))}
        <button type="button" className="nrt-btn nrt-btn-press" tabIndex={-1} style={{ position: 'absolute', right: '1em', bottom: '1em', '--d': '2.4s' } as CSSProperties}>Fechar folha</button>
      </div>
      <Click from={[8, 24]} to={[20.8, 18.2]} delay={0.9} />
      <div className="nrt-wa nrt-rise" style={{ ...d(4.2), right: '1.2em', top: '5em' }}>
        <header><i /> Rota Sul</header>
        <p>Olá, Rafael! Sua folha de <b>outubro</b> foi fechada.<br />Valor em conta: <b>R$ 6.307,70</b></p>
        <footer>09:00 <CheckCheck size={13} className="nrt-checks" /></footer>
      </div>
      <div className="nrt-toast nrt-rise" style={{ ...d(5.6), left: '1.2em', bottom: '1.2em' }}><Send size={14} /> Resumo enviado no WhatsApp</div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------------------------
export function SceneDashboard() {
  const ranks = [['Rafael', 100], ['Thiago', 96], ['Carlos', 88], ['Bruno', 84]] as const;
  return (
    <>
      <div className="nrt-title nrt-rise" style={d(0)}>Dashboard gerencial<Pill style={d(0.2)}>12 meses</Pill></div>
      <div className="nrt-panel nrt-rise" style={{ ...d(0.3), top: '4em', left: '1.2em', width: '26em', height: '14em' }}>
        <div className="nrt-panel-title">Evolução do resultado</div>
        <svg viewBox="0 0 260 100" className="nrt-chart" aria-hidden>
          <defs>
            <linearGradient id="nrt-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#1f9d74" stopOpacity=".45" /><stop offset="1" stopColor="#1f9d74" stopOpacity="0" /></linearGradient>
          </defs>
          <path className="nrt-area nrt-fade" style={d(1.8)} d="M0 86 C30 80 50 70 80 66 S130 62 160 48 S215 30 260 12 L260 100 L0 100 Z" fill="url(#nrt-area)" />
          <path className="nrt-draw" style={d(0.6)} d="M0 86 C30 80 50 70 80 66 S130 62 160 48 S215 30 260 12" fill="none" stroke="#7fe0b5" strokeWidth="2.6" strokeLinecap="round" />
          <circle className="nrt-pop" style={d(2.1)} cx="260" cy="12" r="4.5" fill="#fff" stroke="#1f9d74" strokeWidth="2" />
        </svg>
        <Pill style={{ ...d(2.3), position: 'absolute', right: '1em', top: '.9em' }}>+16%</Pill>
      </div>
      <div className="nrt-panel nrt-rise" style={{ ...d(0.6), top: '4em', right: '1.2em', width: '13.2em', height: '14em' }}>
        <div className="nrt-panel-title">Ranking</div>
        {ranks.map(([name, w], i) => (
          <div key={name} className="nrt-rank">
            <small>{name}</small>
            <div className="nrt-meter"><s className="nrt-grow" style={{ ...d(1.2 + i * 0.2), width: `${w}%` }} /></div>
          </div>
        ))}
      </div>
      <div className="nrt-kpis nrt-kpis-3" style={{ top: '19em' }}>
        {[['Faturamento', <Count key="a" to={193.7} delay={1.0} decimals={1} prefix="R$ " suffix=" mil" />], ['Margem', <Count key="b" to={45.7} delay={1.2} decimals={1} suffix="%" />], ['Ticket médio', <Count key="c" to={224} delay={1.4} prefix="R$ " />]].map(([label, value], i) => (
          <div className="nrt-tile nrt-pop" key={String(label)} style={d(0.9 + i * 0.15)}><small>{label}</small><b>{value}</b></div>
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Assistente de IA
// ---------------------------------------------------------------------------------------------
export function SceneIA() {
  return (
    <>
      <div className="nrt-title nrt-rise" style={d(0)}><Sparkles size={15} /> Assistente de IA</div>
      <div className="nrt-chat">
        <div className="nrt-bubble nrt-bubble-me nrt-rise" style={d(0.2)}>
          <span className="nrt-type" style={{ ...d(0.7), '--n': 30, '--t': '1.2s' } as CSSProperties}>Quem produziu mais este mês?</span>
        </div>
        <div className="nrt-think nrt-think-show" style={d(2.0)}><i /><i /><i /></div>
        <div className="nrt-bubble nrt-bubble-ai nrt-rise" style={d(2.9)}>
          <p><b>Rafael</b> lidera o mês: R$ 22,8 mil em 100 atendimentos.</p>
          {[['Rafael', 100, '22,8'], ['Thiago', 97, '22,2'], ['Carlos', 90, '20,4']].map(([name, w, v], i) => (
            <div className="nrt-rank nrt-rank-ai" key={String(name)}>
              <small>{name}</small>
              <div className="nrt-meter"><s className="nrt-grow" style={{ ...d(3.3 + i * 0.25), width: `${w}%` }} /></div>
              <em>{v}</em>
            </div>
          ))}
        </div>
        <div className="nrt-sugg">
          {['Compare com setembro', 'E a comissão de cada um?'].map((q, i) => (
            <Pill key={q} tone="plain" style={d(4.4 + i * 0.2)}>{q}</Pill>
          ))}
        </div>
      </div>
      <div className="nrt-input nrt-rise" style={d(0.1)}><span>Pergunte sobre a operação…</span><i className="nrt-send nrt-btn-press" style={{ '--d': '2.0s' } as CSSProperties}><Send size={13} /></i></div>
      <Click from={[30, 15]} to={[40.9, 24.7]} delay={0.6} />
    </>
  );
}
