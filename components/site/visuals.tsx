'use client';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowUpRight, Check, CheckCircle2, Clock3, DatabaseBackup, Download, Headset, Layers3, Lock, MessageCircle, ShieldCheck, Sparkles, Users } from 'lucide-react';
import './visuals.css';
import { Click, Count, Pill, d } from './tour-scenes';

/**
 * Ilustrações animadas das seções da home (hero, IA, passos, segurança, novidades, benefícios e
 * fecho). Mesma linguagem do tour: o sistema desenhado de forma abstrata, em movimento, dados
 * inventados. As cenas começam quando entram na tela e recomeçam a cada nova entrada.
 */

// ---------------------------------------------------------------------------------------------
// Infra
// ---------------------------------------------------------------------------------------------
/** `run` é 0 enquanto o elemento está fora da tela e sobe a cada vez que ele entra (para recomeçar a cena). */
export function useReplay(threshold = 0.35) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState({ run: 0, visible: false });
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (typeof IntersectionObserver === 'undefined') {
      setState({ run: 1, visible: true });
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setState((current) => (entry.isIntersecting ? { run: current.run + (current.visible ? 0 : 1), visible: true } : { ...current, visible: false })),
      { threshold },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [threshold]);
  return { ref, run: state.visible ? state.run : 0 };
}

function Stage({ run, aspect = '44 / 28', children }: { run: number; aspect?: string; children: ReactNode }) {
  return (
    <div className="nrv-stage" style={{ aspectRatio: aspect }} aria-hidden>
      <div className="nrt-scene" key={run}>
        {run > 0 ? children : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Hero: a prévia do sistema ganha vida
// ---------------------------------------------------------------------------------------------
export function HeroPreview() {
  return (
    <div className="nr-product-preview nrh" aria-label="Ilustração animada da visão operacional do NextRotta">
      <div className="nr-preview-sidebar">
        <Layers3 size={23} />
        <div className="active"><Layers3 size={15} /></div>
        <div><Users size={15} /></div>
        <div><Clock3 size={15} /></div>
        <div><Sparkles size={15} /></div>
      </div>
      <div className="nr-preview-main">
        <div className="nr-preview-top">
          Visão da operação <span className="nr-avatar">MC</span>
        </div>
        <div className="nr-preview-heading">
          <div>
            <small>QUINTA-FEIRA, 1 DE OUTUBRO</small>
            <h3>Bom dia, Marina <span className="nrh-sun">☀</span></h3>
            <p>Um novo dia para fazer acontecer.</p>
          </div>
          <span className="nr-preview-period">Este mês⌄</span>
        </div>
        <div className="nr-preview-metrics">
          <div className="nrt-rise" style={d(0.35)}>
            <small>Serviços realizados</small>
            <strong><Count to={248} delay={0.6} dur={1.3} /><span>↗ 18%</span></strong>
            <p>Mais clientes bem atendidos</p>
          </div>
          <div className="nrt-rise" style={d(0.5)}>
            <small>Receita do mês</small>
            <strong><Count to={42850} delay={0.75} dur={1.4} prefix="R$ " /></strong>
            <p>↗ 12% em relação ao mês anterior</p>
          </div>
        </div>
        <div className="nr-preview-chart">
          <div>
            <strong>Uma operação em movimento</strong>
            <small>Serviços por semana</small>
          </div>
          <div className="nr-chart-bars">
            {[35, 52, 46, 66, 60, 83, 72, 96, 82, 100, 91, 115].map((height, i) => (
              <span key={i} style={{ height, '--i': i } as CSSProperties} />
            ))}
          </div>
          <div className="nr-chart-labels"><span>Semana 1</span><span>Semana 2</span><span>Semana 3</span><span>Semana 4</span></div>
        </div>
        <div className="nr-preview-bottom">
          <div className="nr-preview-check nrh-check">
            <Clock3 size={15} className="nrh-wait" />
            <Check size={15} className="nrh-done" />
          </div>
          <div>
            <strong>Tudo pronto para o fechamento</strong>
            <small>Horas conferidas. Comissões calculadas.</small>
          </div>
          <ArrowUpRight size={17} />
        </div>
      </div>
      <div className="nr-floating-note nrh-note-1">
        <span><CheckCircle2 size={20} /></span>
        <div>Menos planilhas.<br /><strong>Mais tranquilidade.</strong></div>
      </div>
      <div className="nrh-note-2">
        <span><MessageCircle size={16} /></span>
        <div><strong>Folha fechada</strong><small>Resumo enviado a 10 técnicos</small></div>
      </div>
      <Click from={[34, 20]} to={[42.4, 36.6]} delay={2.4} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// IA: pergunte, a resposta aparece (as 3 perguntas são clicáveis)
// ---------------------------------------------------------------------------------------------
const Typed = ({ text, delay, className = '' }: { text: string; delay: number; className?: string }) => (
  <div className={`nrt-bubble nrt-bubble-me nrt-rise ${className}`} style={d(delay - 0.5)}>
    <span className="nrt-type" style={{ ...d(delay), '--n': text.length } as CSSProperties}>{text}</span>
  </div>
);
const Thinking = ({ delay }: { delay: number }) => <div className="nrt-think" style={d(delay)}><i /><i /><i /></div>;

function AskFolha() {
  const q = 'Quanto gastei com folha este mês?';
  return (
    <div className="nrt-chat" style={{ top: '1.6em', bottom: '1.4em' }}>
      <Typed text={q} delay={0.7} />
      <Thinking delay={2.9} />
      <div className="nrt-bubble nrt-bubble-ai nrt-rise" style={{ ...d(3.8), width: '33em' }}>
        <p>A folha de outubro soma <b>R$ 51,3 mil</b> em 10 técnicos.</p>
        <div className="nrv-stack">
          <s className="nrt-grow" style={{ ...d(4.2), width: '47%', background: 'var(--emerald)' }} />
          <s className="nrt-grow" style={{ ...d(4.5), width: '38%', background: 'var(--mint)' }} />
          <s className="nrt-grow" style={{ ...d(4.8), width: '15%', background: 'var(--amber)' }} />
        </div>
        <div className="nrv-legend">
          <Pill style={d(5.1)}><i style={{ background: 'var(--emerald)' }} />Salário base · R$ 24,1 mil</Pill>
          <Pill style={d(5.3)}><i style={{ background: 'var(--mint)' }} />Comissão · R$ 19,5 mil</Pill>
          <Pill style={d(5.5)}><i style={{ background: 'var(--amber)' }} />VA e VR · R$ 7,7 mil</Pill>
        </div>
      </div>
    </div>
  );
}

function AskProducao() {
  const rows = [['Rafael', 100, '11,6'], ['Thiago', 96, '11,1'], ['Carlos', 90, '10,4'], ['Bruno', 84, '9,7']] as const;
  return (
    <div className="nrt-chat" style={{ top: '1.6em', bottom: '1.4em' }}>
      <Typed text="Qual técnico mais produziu na Q1?" delay={0.7} />
      <Thinking delay={2.9} />
      <div className="nrt-bubble nrt-bubble-ai nrt-rise" style={{ ...d(3.8), width: '33em' }}>
        <p><b>Rafael</b> lidera a primeira quinzena: R$ 11,6 mil em 52 OS.</p>
        {rows.map(([name, w, v], i) => (
          <div className="nrt-rank nrt-rank-ai" key={name}>
            <small>{name}</small>
            <div className="nrt-meter"><s className="nrt-grow" style={{ ...d(4.2 + i * 0.25), width: `${w}%` }} /></div>
            <em>{v}</em>
          </div>
        ))}
      </div>
    </div>
  );
}

function AskEstranho() {
  const flags = ['Bruno: horas extras 40% acima da média', 'Diego: adiantamento sem recibo anexado'];
  return (
    <div className="nrt-chat" style={{ top: '1.6em', bottom: '1.4em' }}>
      <Typed text="Tem algo estranho na folha de setembro?" delay={0.7} />
      <Thinking delay={3.2} />
      <div className="nrt-bubble nrt-bubble-ai nrt-rise" style={{ ...d(4.1), width: '33em' }}>
        <p>Encontrei <b>2 pontos</b> para revisar:</p>
        {flags.map((flag, i) => (
          <div className="nrt-line nrt-fade" key={flag} style={d(4.5 + i * 0.5)}><i className="nrt-dot-amber" /><span>{flag}</span></div>
        ))}
        <Pill tone="amber" style={{ ...d(5.8), marginTop: '0.4em' }}>Revisar folha</Pill>
      </div>
    </div>
  );
}

const ASKS = [
  { q: 'Quanto gastei com folha este mês?', Scene: AskFolha },
  { q: 'Qual técnico mais produziu na Q1?', Scene: AskProducao },
  { q: 'Tem algo estranho na folha de setembro?', Scene: AskEstranho },
];

export function AiDemo() {
  const { ref, run } = useReplay(0.3);
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [bump, setBump] = useState(0);
  const Scene = ASKS[active].Scene;

  // Passa sozinho para a próxima pergunta depois de ~9 s (parado enquanto o mouse está em cima).
  useEffect(() => {
    if (run === 0 || paused || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = window.setTimeout(() => {
      setActive((current) => (current + 1) % ASKS.length);
      setBump((current) => current + 1);
    }, 9500);
    return () => window.clearTimeout(timer);
  }, [run, active, bump, paused]);

  return (
    <div ref={ref} className="nrv nrv-ai" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <div className="nrt-window nrv-window">
        <div className="nrt-bar" aria-hidden>
          <i /><i /><i />
          <span>Assistente NextRotta</span>
          <em className="nrv-badge">Plano Pro</em>
        </div>
        <Stage run={run === 0 ? 0 : run * 1000 + active * 100 + bump} aspect="44 / 24">
          <Scene />
        </Stage>
      </div>
      <div className="nrv-asks" role="group" aria-label="Perguntas de exemplo">
        {ASKS.map((ask, index) => (
          <button
            key={ask.q}
            type="button"
            className={index === active ? 'on' : ''}
            aria-pressed={index === active}
            onClick={() => {
              setActive(index);
              setBump((current) => current + 1);
            }}
          >
            {ask.q}
            <ArrowUpRight size={14} />
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Passos: da escolha à primeira rota
// ---------------------------------------------------------------------------------------------
function StepPlano() {
  const tiles = [['Essencial', 4.2], ['Pro', 15.6], ['Monte o seu', 27]] as const;
  return (
    <>
      {tiles.map(([name, x], i) => (
        <div key={name} className={`nrv-plan nrt-rise ${i === 1 ? 'nrv-pick' : ''} ${i === 2 ? 'nrv-dashed' : ''}`} style={{ left: `${x}em`, top: '4.6em', ...d(0.2 + i * 0.18) }}>
          <b>{name}</b>
          <i /><i /><i />
          {i === 1 && <span className="nrv-check nrt-pop" style={d(2.5)}><Check size={13} strokeWidth={3} /></span>}
        </div>
      ))}
      <Click from={[36, 25]} to={[22, 13.4]} delay={1.0} />
      <div className="nrt-toast nrt-rise" style={{ ...d(3.0), left: '12.5em', bottom: '2em' }}><Check size={14} strokeWidth={3} /> Plano escolhido</div>
    </>
  );
}

function StepImplantacao() {
  const items = ['Importamos suas OS', 'Cadastramos a equipe', 'Treinamos o time'];
  return (
    <>
      <svg className="nrv-ring" viewBox="0 0 100 100" aria-hidden style={{ left: '2.4em', top: '4.4em' }}>
        <circle cx="50" cy="50" r="40" fill="none" stroke="rgba(255,255,255,.1)" strokeWidth="9" />
        <circle className="nrv-ring-fill" cx="50" cy="50" r="40" fill="none" stroke="#7fe0b5" strokeWidth="9" strokeLinecap="round" transform="rotate(-90 50 50)" style={d(0.5)} />
        <text x="50" y="57" textAnchor="middle" className="nrv-ring-text">100%</text>
      </svg>
      <div className="nrt-panel nrt-rise" style={{ ...d(0.3), left: '17em', top: '4.2em', width: '24.4em' }}>
        {items.map((item, i) => (
          <div key={item} className="nrt-line nrt-fade" style={d(0.8 + i * 0.9)}>
            <i className="nrt-dot-ok nrt-tick" style={d(1.3 + i * 0.9)}><Check size={11} strokeWidth={3} /></i>
            <span>{item}</span>
          </div>
        ))}
      </div>
      <div className="nrv-duo nrt-rise" style={{ ...d(3.4), left: '17em', bottom: '2.4em' }}>
        <i><Headset size={15} /></i><s />
        <i><Users size={15} /></i>
        <Pill style={{ marginLeft: '0.8em', ...d(3.8) }}>Pronto para usar</Pill>
      </div>
    </>
  );
}

function StepRotina() {
  const rows = [['08:00', 'Escala publicada'], ['18:00', 'Horas conferidas'], ['22:00', 'Robô do Porto roda']] as const;
  return (
    <>
      <div className="nrt-title nrt-rise" style={d(0)}>Seu primeiro dia<Pill style={d(0.2)}>tudo no lugar</Pill></div>
      <div className="nrv-day">
        {rows.map(([time, label], i) => (
          <div key={time} className="nrv-day-row nrt-rise" style={d(0.5 + i * 0.7)}>
            <b>{time}</b>
            <span className="nrv-day-dot nrt-pop" style={d(0.8 + i * 0.7)}><Check size={11} strokeWidth={3} /></span>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <div className="nrt-toast nrt-rise" style={{ ...d(3.1), right: '1.8em', bottom: '1.8em' }}><Check size={14} strokeWidth={3} /> Primeira folha fechada</div>
    </>
  );
}

export function StepArt({ index }: { index: number }) {
  const { ref, run } = useReplay(0.4);
  const Scene = [StepPlano, StepImplantacao, StepRotina][index] ?? StepRotina;
  return (
    <div ref={ref} className="nrv nrv-art">
      <Stage run={run} aspect="44 / 26"><Scene /></Stage>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Segurança
// ---------------------------------------------------------------------------------------------
export function SecIcon({ index }: { index: number }) {
  const Icon = [ShieldCheck, Download, DatabaseBackup][index % 3];
  return <Icon size={20} />;
}

export function ShieldArt() {
  const { ref, run } = useReplay(0.4);
  return (
    <div ref={ref} className="nrv-shield" aria-hidden>
      {run > 0 && <ShieldDrawing key={run} />}
    </div>
  );
}

function ShieldDrawing() {
  return (
    <>
      <div className="nrv-orbit">
        <span style={{ '--a': '0deg' } as CSSProperties}><Lock size={16} /></span>
        <span style={{ '--a': '120deg' } as CSSProperties}><DatabaseBackup size={16} /></span>
        <span style={{ '--a': '240deg' } as CSSProperties}><Clock3 size={16} /></span>
      </div>
      <svg viewBox="0 0 120 140" width="120" height="140">
        <path className="nrv-shield-line" d="M60 8 L108 26 V68 C108 98 88 122 60 132 C32 122 12 98 12 68 V26 Z" fill="rgba(31,157,116,.14)" stroke="#7fe0b5" strokeWidth="3" strokeLinejoin="round" />
        <path className="nrv-shield-check" d="M38 70 L54 86 L84 52" fill="none" stroke="#fff" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Novidades: um feed que anda
// ---------------------------------------------------------------------------------------------
type FeedItem = { id: string; title: string; tag: string; date: string };
const FALLBACK_FEED: FeedItem[] = [
  { id: 'f1', title: 'Monte o seu plano: escolha só os módulos de que precisa', tag: 'Novo', date: 'Out' },
  { id: 'f2', title: 'Venda de Peças pelo celular, com Pix na hora', tag: 'Novo', date: 'Out' },
  { id: 'f3', title: 'Prazo do laudo no robô do Porto', tag: 'Melhoria', date: 'Out' },
  { id: 'f4', title: 'Datas sempre no horário de Brasília', tag: 'Correção', date: 'Out' },
];
const TAGS: Record<string, string> = { feature: 'Novo', improvement: 'Melhoria', fix: 'Correção' };

export function UpdatesFeed() {
  const [items, setItems] = useState<FeedItem[]>(FALLBACK_FEED);
  useEffect(() => {
    let active = true;
    fetch('/api/public/news', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { posts?: Array<{ id: string; title: string; category: string; publishedOn: string }> } | null) => {
        const posts = data?.posts?.slice(0, 6) ?? [];
        if (!active || posts.length < 3) return;
        setItems(posts.map((post) => ({ id: post.id, title: post.title, tag: TAGS[post.category] ?? 'Novo', date: new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', timeZone: 'UTC' }).format(new Date(`${post.publishedOn}T00:00:00Z`)).replace('.', '') })));
      })
      .catch(() => null);
    return () => {
      active = false;
    };
  }, []);
  const loop = [...items, ...items];
  return (
    <div className="nrv-feed" aria-hidden>
      <div className="nrv-feed-track" style={{ '--n': items.length } as CSSProperties}>
        {loop.map((item, i) => (
          <div key={`${item.id}-${i}`} className="nrv-feed-card">
            <span className={`nrv-feed-tag nrv-tag-${item.tag}`}>{item.tag}</span>
            <b>{item.title}</b>
            <small>{item.date}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Benefícios: três mini-ilustrações
// ---------------------------------------------------------------------------------------------
export function BenefitArt({ index }: { index: number }) {
  if (index % 3 === 0)
    return (
      <svg viewBox="0 0 32 32" width="30" height="30" aria-hidden className="nrv-b nrv-b-sheets">
        <rect className="s1" x="4" y="6" width="14" height="18" rx="2.5" /><rect className="s2" x="9" y="4" width="14" height="18" rx="2.5" /><rect className="s3" x="14" y="8" width="14" height="18" rx="2.5" />
      </svg>
    );
  if (index % 3 === 1)
    return (
      <svg viewBox="0 0 32 32" width="30" height="30" aria-hidden className="nrv-b nrv-b-check">
        <circle cx="16" cy="16" r="12" fill="none" strokeWidth="2.6" /><path d="M10 16.5 L14.5 21 L22 11.5" fill="none" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  return (
    <svg viewBox="0 0 32 32" width="30" height="30" aria-hidden className="nrv-b nrv-b-route">
      <path d="M5 24 C 11 24, 11 8, 17 8 S 23 24, 28 12" fill="none" strokeWidth="2.4" strokeDasharray="3 3.5" strokeLinecap="round" /><circle cx="5" cy="24" r="3" /><circle cx="17" cy="8" r="3" /><circle cx="28" cy="12" r="3" />
    </svg>
  );
}

// ---------------------------------------------------------------------------------------------
// Fecho: a rota chega ao botão
// ---------------------------------------------------------------------------------------------
export function RouteArt() {
  return (
    <svg className="nrv-route" viewBox="0 0 1150 220" preserveAspectRatio="none" aria-hidden>
      <path id="nrv-path" d="M-20 150 C 160 40, 300 210, 520 120 S 860 30, 1170 110" fill="none" stroke="rgba(31,157,116,.35)" strokeWidth="2.4" strokeDasharray="4 9" strokeLinecap="round" />
      <circle r="6" fill="#1f9d74">
        <animateMotion dur="9s" repeatCount="indefinite" path="M-20 150 C 160 40, 300 210, 520 120 S 860 30, 1170 110" />
      </circle>
    </svg>
  );
}
