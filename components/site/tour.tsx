'use client';
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { Bot, CalendarClock, ChartNoAxesCombined, LayoutDashboard, Package, Sparkles, Users, WalletCards, type LucideIcon } from 'lucide-react';
import './tour.css';
import { SceneDashboard, SceneEquipe, SceneHoras, SceneFolha, SceneIA, SceneOperacao, ScenePorto } from './tour-scenes';
import { ScenePecas } from './news-scenes';

/**
 * O "tour" da home: uma rota com as paradas da rotina (à esquerda) e, ao lado, uma janela que mostra o
 * sistema de forma abstrata e animada. A linha da rota se preenche sozinha e leva à próxima parada;
 * passar o mouse pausa; clicar numa parada vai direto a ela. Com "menos movimento" nada anda sozinho.
 */
type Stop = {
  id: string;
  feature: string; // recurso do plano que dá acesso (para mostrar "a partir do plano X")
  icon: LucideIcon;
  title: string;
  promise: string;
  text: string;
  Scene: () => React.JSX.Element;
};

const STOPS: Stop[] = [
  { id: 'operacao', feature: 'services', icon: LayoutDashboard, title: 'Operação', promise: 'O mês inteiro numa tela', text: 'Valor produzido, ordens de serviço, folha e pendências, sem caçar informação.', Scene: SceneOperacao },
  { id: 'equipe', feature: 'technicians', icon: Users, title: 'Equipe e serviços', promise: 'Cada técnico, cada OS', text: 'Cadastre a equipe com comissão e benefícios e importe as ordens de serviço com prévia.', Scene: SceneEquipe },
  { id: 'porto', feature: 'porto', icon: Bot, title: 'Robô do Porto', promise: 'Trabalha enquanto você dorme', text: 'Entra no Portal do Prestador toda noite, importa serviços e horas, lê a escala e avisa se algo falhar.', Scene: ScenePorto },
  { id: 'horas', feature: 'schedule', icon: CalendarClock, title: 'Escala e horas', promise: 'Previsto, realizado e saldo', text: 'A escala fica visível para todos e o banco de horas de cada técnico está sempre em dia.', Scene: SceneHoras },
  { id: 'folha', feature: 'payroll', icon: WalletCards, title: 'Folha e WhatsApp', promise: 'Folha pronta, aviso enviado', text: 'Comissão, adiantamentos e prêmios calculados. Ao fechar, cada técnico recebe o resumo no WhatsApp.', Scene: SceneFolha },
  { id: 'dashboard', feature: 'management_dashboard', icon: ChartNoAxesCombined, title: 'Dashboard gerencial', promise: 'O negócio visto de cima', text: 'Faturamento, margem, ticket médio e ranking de prestadores, com 12 meses de evolução.', Scene: SceneDashboard },
  { id: 'ia', feature: 'ai', icon: Sparkles, title: 'Assistente de IA', promise: 'Pergunte e ele responde', text: 'Consulta os dados da sua empresa e responde na hora: quem produziu mais, quanto faturamos, como está a folha.', Scene: SceneIA },
  { id: 'pecas', feature: 'parts', icon: Package, title: 'Peças no celular', promise: 'Venda com Pix na hora', text: 'Peças em consignação com cada técnico, venda pelo celular, estoque e acerto do mês.', Scene: ScenePecas },
];

export const TOUR_FEATURES = ['services', 'technicians', 'porto', 'schedule', 'hours', 'service_import', 'payroll', 'whatsapp', 'management_dashboard', 'ai', 'parts'];

export function FeatureTour({ planOf, others = [] }: { planOf: (feature: string) => string | undefined; others?: string[] }) {
  const [active, setActive] = useState(0);
  const [inView, setInView] = useState(true);
  const root = useRef<HTMLDivElement>(null);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const stop = STOPS[active];
  const next = (step: number) => setActive((current) => (current + step + STOPS.length) % STOPS.length);

  useEffect(() => {
    const node = root.current;
    if (!node || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.25 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  function onKey(event: KeyboardEvent) {
    const move = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 0;
    if (!move) return;
    event.preventDefault();
    const target = (active + move + STOPS.length) % STOPS.length;
    setActive(target);
    tabs.current[target]?.focus();
  }

  return (
    <div ref={root} className="nrt" data-inview={inView} style={{ '--nrt-time': '8.5s' } as CSSProperties}>
      <div className="nrt-wrap">
        <div className="nrt-rail" role="tablist" aria-label="Partes do sistema" onKeyDown={onKey}>
          {STOPS.map((item, index) => {
            const on = index === active;
            const Icon = item.icon;
            const plan = planOf(item.feature);
            return (
              <button
                key={item.id}
                ref={(node) => {
                  tabs.current[index] = node;
                }}
                role="tab"
                id={`nrt-tab-${item.id}`}
                aria-selected={on}
                aria-controls="nrt-stage"
                tabIndex={on ? 0 : -1}
                className="nrt-stop"
                onClick={() => setActive(index)}
              >
                <span className="nrt-pin" aria-hidden><Icon size={14} /></span>
                <span className="nrt-seg" aria-hidden>{on && <i key={active} className="nrt-fill" onAnimationEnd={() => next(1)} />}</span>
                <span className="nrt-stop-head">
                  <strong>{item.title}</strong>
                  <small>{item.promise}</small>
                </span>
                <span className="nrt-more">
                  <span>
                    <span className="nrt-text">{item.text}</span>
                    {plan && <span className="nrt-plan">A partir do plano {plan}</span>}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="nrt-window" id="nrt-stage" role="tabpanel" aria-labelledby={`nrt-tab-${stop.id}`}>
          <div className="nrt-bar" aria-hidden>
            <i /><i /><i />
            <span>NextRotta · {stop.title}</span>
          </div>
          <div className="nrt-body">
            <div className="nrt-side" aria-hidden>
              {STOPS.map((item, index) => {
                const Icon = item.icon;
                return <span key={item.id} className={index === active ? 'on' : ''}><Icon size={15} /></span>;
              })}
            </div>
            <div className="nrt-canvas" aria-hidden>
              <div className="nrt-scene" key={active}>
                <stop.Scene />
              </div>
            </div>
          </div>
        </div>
        <p className="nrt-mobile-text">{stop.text}</p>
      </div>
      {others.length > 0 && (
        <p className="nrt-others">
          <span>E também:</span> {others.join(' · ')}
        </p>
      )}
    </div>
  );
}
