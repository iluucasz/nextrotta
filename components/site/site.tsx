'use client';
import Link from 'next/link';
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Layers3,
  Menu,
  MessageCircle,
  Route,
  ShieldCheck,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import { BrandLogo } from '@/components/brand-logo';
import {
  Badge,
  Fields,
  RichText,
  type FormValues,
} from '@/components/platform/ui';
import type { PlanLimits } from '@/lib/plans';
import {
  FEATURE_DESCRIPTIONS,
  siteContent,
  type SiteContent,
} from '@/lib/site/content';

/** The published content (from the platform panel), provided by the site layout. */
const SiteContentContext = createContext<SiteContent>(siteContent);
const useSiteContent = () => useContext(SiteContentContext);
import './marketing.css';
import { FeatureTour, TOUR_FEATURES } from './tour';
import { VideoShowcase } from './video';
import {
  AiDemo,
  BenefitArt,
  HeroPreview,
  RouteArt,
  SecIcon,
  ShieldArt,
  StepArt,
  UpdatesFeed,
} from './visuals';
import { ThemePage, type CanvasControls } from './page-renderer';
import {
  themeStyle,
  contentForSection,
  designFor,
  safeLink,
  type SectionType,
  type SiteDocument,
  type ThemeSection,
} from './theme';
import '@/components/platform/platform.css';

const money = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
    value,
  );
const CYCLES = [
  { value: 'monthly', label: 'Mensal' },
  { value: 'annual', label: 'Anual' },
] as const;
type Cycle = (typeof CYCLES)[number]['value'];

type PublicPlan = {
  key: string;
  name: string;
  description: string | null;
  monthlyPrice: number;
  annualPrice: number;
  extraTechnicianPrice: number;
  setupFee: number;
  onRequest: boolean;
  featured: boolean;
  includedTechnicians: number;
  limits: PlanLimits;
  backupRetentionDays: number | null;
  ai: boolean;
  features: string[];
};

type PublicFeature = { key: string; name: string; description: string | null };

/** "Monte o seu": the base plan plus the modules the company can add, each with its own price. */
type PublicBuilder = Omit<PublicPlan, 'onRequest' | 'featured' | 'ai'> & {
  modules: Array<{
    key: string;
    name: string;
    description: string | null;
    monthlyPrice: number;
    annualPrice: number;
    setupFee: number;
  }>;
};

let cachedPlans: Promise<{
  plans: PublicPlan[];
  builder: PublicBuilder | null;
  features: PublicFeature[];
}> | null = null;

/** The plans published on the site, straight from the platform (fetched once per page load). */
function usePublicPlans() {
  const [plans, setPlans] = useState<PublicPlan[] | null>(null);
  const [builder, setBuilder] = useState<PublicBuilder | null>(null);
  const [features, setFeatures] = useState<PublicFeature[]>([]);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!cachedPlans) {
      cachedPlans = fetch('/api/public/plans', { cache: 'no-store' })
        .then((response) =>
          response.ok
            ? response.json()
            : Promise.reject(new Error(String(response.status))),
        )
        .then(
          (data: {
            plans: PublicPlan[];
            builder?: PublicBuilder | null;
            features: PublicFeature[];
          }) => ({ ...data, builder: data.builder ?? null }),
        )
        .catch((reason) => {
          cachedPlans = null;
          throw reason;
        });
    }
    let active = true;
    cachedPlans
      .then((value) => {
        if (active) {
          setPlans(value.plans);
          setBuilder(value.builder);
          setFeatures(value.features);
        }
      })
      .catch(() => active && setError(true));
    return () => {
      active = false;
    };
  }, []);
  const featureName = (key: string) =>
    features.find((feature) => feature.key === key)?.name ?? key;
  return { plans, builder, features, featureName, error };
}

const whatsappLink = (number: string) => {
  const digits = number.replace(/\D/g, '');
  return `https://wa.me/${digits.length <= 11 ? `55${digits}` : digits}`;
};

export function SiteBrand() {
  return <BrandLogo className="nr-logo" />;
}

function PublicShell({ children }: { children: ReactNode }) {
  const [menu, setMenu] = useState(false);
  const content = useSiteContent();
  const design = designFor(content);
  return (
    <div className="nr-marketing" style={themeStyle(content)}>
      <header className="nr-public-header">
        <Link href="/" aria-label="NextRotta, início">
          <SiteBrand />
        </Link>
        <button
          className="nr-public-menu"
          aria-label="Abrir menu"
          onClick={() => setMenu(!menu)}
        >
          {menu ? <X /> : <Menu />}
        </button>
        <nav className={menu ? 'open' : ''} aria-label="Navegação do site">
          {[
            ['/#funcionalidades', 'Funcionalidades'],
            ['/planos', 'Planos'],
            ['/novidades', 'Novidades'],
            ['/contato', 'Contato'],
          ].map(([href, label]) => (
            <Link key={href} href={href} onClick={() => setMenu(false)}>
              {label}
            </Link>
          ))}
        </nav>
        <div className="nr-public-header-actions">
          <Link href="/login">Entrar</Link>
          <Link
            className="nr-btn primary"
            href={safeLink(design.header?.ctaHref)}
          >
            {design.header?.ctaLabel || 'Vamos conversar'}
            <ArrowUpRight size={15} />
          </Link>
        </div>
      </header>
      <main>{children}</main>
      <footer className="nr-public-footer">
        <div>
          <Link href="/">
            <SiteBrand />
          </Link>
          <p>
            Mais clareza na gestão.
            <br />
            Mais tempo para ir além.
          </p>
          <small>
            {content.legalName}
            {content.cnpj && (
              <>
                <br />
                CNPJ {content.cnpj}
              </>
            )}
          </small>
        </div>
        <div>
          <h3>Produto</h3>
          <Link href="/planos">Planos</Link>
          <Link href="/planos#planos">Monte o seu plano</Link>
          <Link href="/novidades">Novidades</Link>
          <Link href="/login">Entrar no sistema</Link>
        </div>
        <div>
          <h3>Vamos conversar</h3>
          {content.email && (
            <a href={`mailto:${content.email}`}>{content.email}</a>
          )}
          {content.whatsapp && (
            <a
              href={whatsappLink(content.whatsapp)}
              target="_blank"
              rel="noreferrer"
            >
              {content.phone || content.whatsapp}
            </a>
          )}
          <Link href="/contato">Formulário de contato</Link>
          <p>{content.hours}</p>
          {content.socials
            .filter((url) => /^https:\/\//.test(url))
            .map((url, i) => (
              <a key={url} href={url} target="_blank" rel="noreferrer">
                Rede social {i + 1}
                <ArrowUpRight size={12} className="inline ml-1" />
              </a>
            ))}
        </div>
        <div>
          <h3>Transparência</h3>
          <Link href="/termos">Termos de uso</Link>
          <Link href="/privacidade">Política de privacidade</Link>
        </div>
        <div className="nr-public-footer-bottom">
          <span>
            © {new Date().getFullYear()} NextRotta. Todos os direitos
            reservados.
          </span>
          <span>
            {design.footer?.signature || 'Feito para quem faz acontecer.'}
          </span>
        </div>
      </footer>
    </div>
  );
}
export function SiteShell({
  children,
  content,
}: {
  children: ReactNode;
  content: SiteContent;
}) {
  return (
    <SiteContentContext.Provider value={content}>
      <PublicShell>{children}</PublicShell>
    </SiteContentContext.Provider>
  );
}

export function Faq({ content }: { content: SiteContent }) {
  return (
    <section className="nr-public-section nr-faq">
      <div>
        <p className="nr-kicker">SEM PONTAS SOLTAS</p>
        <h2>Ficou alguma dúvida?</h2>
        <p>
          A gente ajuda você a encontrar
          <br />o caminho mais simples.
        </p>
        <Link href="/contato">
          Falar com a equipe <ArrowUpRight size={16} className="inline" />
        </Link>
      </div>
      <div>
        {content.faq
          .filter((item) => item.visible !== false)
          .map((item) => (
            <details key={item.id}>
              <summary>
                {item.title}
                <ChevronDown size={17} />
              </summary>
              <p>{item.text}</p>
            </details>
          ))}
      </div>
    </section>
  );
}

const integer = (value: number) => new Intl.NumberFormat('pt-BR').format(value);
const unlimited = (value: number | null) =>
  value === null ? 'Ilimitado' : integer(value);
const storageLabel = (mb: number | null) =>
  mb === null
    ? 'Ilimitado'
    : mb >= 1024
      ? `${integer(Math.round((mb / 1024) * 10) / 10)} GB`
      : `${integer(mb)} MB`;
const retentionLabel = (days: number | null) =>
  days === null
    ? 'até ilimitado'
    : days % 30 === 0
      ? `${days / 30} ${days / 30 === 1 ? 'mês' : 'meses'}`
      : `${days} dias`;

/** The third card: the company ticks the modules it wants and the price adds up. */
function BuilderCard({
  builder,
  cycle,
  orderedFeatures,
}: {
  builder: PublicBuilder;
  cycle: Cycle;
  orderedFeatures: PublicFeature[];
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const chosen = builder.modules.filter((module) =>
    selected.includes(module.key),
  );
  const price =
    (cycle === 'annual' ? builder.annualPrice : builder.monthlyPrice) +
    chosen.reduce(
      (total, module) =>
        total + (cycle === 'annual' ? module.annualPrice : module.monthlyPrice),
      0,
    );
  const setupFee =
    builder.setupFee +
    chosen.reduce((total, module) => total + module.setupFee, 0);
  const toggle = (key: string) =>
    setSelected((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key],
    );
  return (
    <article className="nr-public-plan nr-builder">
      <h3>{builder.name}</h3>
      <p>{builder.description}</p>
      <div className="nr-public-price">
        {chosen.length ? '' : 'A partir de '}
        {money(price)}
        <small>/{cycle === 'annual' ? 'ano' : 'mês'}</small>
      </div>
      <small>
        {chosen.length
          ? `Base + ${chosen.length} ${chosen.length === 1 ? 'módulo' : 'módulos'}${cycle === 'annual' ? ` · equivale a ${money(price / 12)}/mês` : ''}`
          : 'Marque abaixo só o que a sua operação precisa'}
      </small>
      <Link
        href={`/contratar?plano=${builder.key}&ciclo=${cycle}${selected.length ? `&modulos=${selected.join(',')}` : ''}`}
        className="nr-btn"
      >
        {chosen.length ? 'Contratar meu plano' : 'Montar meu plano'}
        <ArrowRight size={15} />
      </Link>
      <ul>
        <li>
          <Check size={16} />
          Até {builder.includedTechnicians} técnicos
        </li>
        <li>
          <Check size={16} />
          {money(builder.extraTechnicianPrice)}/mês por técnico extra
        </li>
        <li>
          <Check size={16} />
          Implantação única de {money(setupFee)}
        </li>
        <li>
          <Check size={16} />
          Backup diário: {retentionLabel(builder.backupRetentionDays)}
        </li>
        {orderedFeatures.map(({ key, name }) => {
          const module = builder.modules.find(
            (candidate) => candidate.key === key,
          );
          if (module) {
            const on = selected.includes(key);
            return (
              <li key={key} className="nr-builder-module">
                <label>
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggle(key)}
                  />
                  <span>{name}</span>
                  <small>
                    +
                    {money(
                      cycle === 'annual'
                        ? module.annualPrice
                        : module.monthlyPrice,
                    )}
                    /{cycle === 'annual' ? 'ano' : 'mês'}
                  </small>
                </label>
              </li>
            );
          }
          const included = builder.features.includes(key);
          return (
            <li key={key} className={included ? undefined : 'nr-feature-off'}>
              {included ? (
                <Check size={16} aria-label="Incluído" />
              ) : (
                <X size={16} aria-label="Não incluído" />
              )}
              {name}
            </li>
          );
        })}
      </ul>
      <div className="nr-plan-note" />
    </article>
  );
}

export function Pricing({
  content,
  full = false,
}: {
  content: SiteContent;
  full?: boolean;
}) {
  const { plans, builder, features, error } = usePublicPlans();
  const [cycle, setCycle] = useState<Cycle>(content.defaultCycle);
  const header = (
    <div className="nr-section-center">
      <p className="nr-kicker">UM PLANO PARA CADA MOMENTO</p>
      <h2>Seu próximo passo começa aqui.</h2>
      <p>Escolha o que faz sentido para a sua equipe.</p>
      <div className="nr-cycle" aria-label="Ciclo de cobrança">
        {CYCLES.map((c) => (
          <button
            key={c.value}
            aria-pressed={cycle === c.value}
            onClick={() => setCycle(c.value)}
          >
            {c.label}
            {c.value === 'annual' && <small>2 meses grátis</small>}
          </button>
        ))}
      </div>
    </div>
  );
  if (!plans)
    return (
      <section className="nr-public-section" id="planos">
        {header}
        <p className="py-10 text-center">
          {error ? (
            <>
              Não foi possível carregar os planos agora.{' '}
              <Link className="nr-text-link" href="/contato">
                Fale com a gente
              </Link>
              .
            </>
          ) : (
            'Carregando planos…'
          )}
        </p>
      </section>
    );
  // One shared order keeps each feature on the same row across the plans.
  // Common features come first; upgrades (and the entry plan's crosses) follow.
  const orderedFeatures = [...features].sort(
    (a, b) =>
      plans.filter((plan) => plan.features.includes(b.key)).length -
      plans.filter((plan) => plan.features.includes(a.key)).length,
  );
  return (
    <section className="nr-public-section" id="planos">
      {header}
      <div
        className="nr-grid-3 nr-pricing-grid"
        style={
          {
            '--pricing-rows': orderedFeatures.length + 10,
            '--pricing-benefit-rows': orderedFeatures.length + 4,
          } as CSSProperties
        }
      >
        {plans.map((p) => (
          <article
            className={`nr-public-plan ${p.featured ? 'featured' : ''}`}
            key={p.key}
          >
            {p.featured && <span className="nr-popular">O MAIS ESCOLHIDO</span>}
            <h3>{p.name}</h3>
            <p>{p.description}</p>
            <div className="nr-public-price">
              {p.onRequest
                ? 'Vamos conversar'
                : money(cycle === 'annual' ? p.annualPrice : p.monthlyPrice)}
              {!p.onRequest && (
                <small>/{cycle === 'annual' ? 'ano' : 'mês'}</small>
              )}
            </div>
            <small>
              {p.onRequest
                ? 'Condições definidas para sua operação'
                : cycle === 'annual'
                  ? `Equivale a ${money(p.annualPrice / 12)}/mês · economize ${money(p.monthlyPrice * 12 - p.annualPrice)}`
                  : 'Flexibilidade para acompanhar sua operação'}
            </small>
            <Link
              href={
                p.onRequest
                  ? '/sob-medida'
                  : `/contratar?plano=${p.key}&ciclo=${cycle}`
              }
              className={`nr-btn ${p.featured ? 'primary' : ''}`}
            >
              {p.onRequest ? 'Fale conosco' : `Contratar ${p.name}`}
              <ArrowRight size={15} />
            </Link>
            <ul>
              <li>
                <Check size={16} />
                {p.onRequest
                  ? 'Quantidade de técnicos negociada'
                  : `Até ${p.includedTechnicians} técnicos`}
              </li>
              <li>
                <Check size={16} />
                {p.onRequest
                  ? 'Técnicos extras: valor negociado'
                  : `${money(p.extraTechnicianPrice)}/mês por técnico extra`}
              </li>
              <li>
                <Check size={16} />
                {p.onRequest
                  ? 'Implantação: valor negociado'
                  : `Implantação única de ${money(p.setupFee)}`}
              </li>
              <li>
                <Check size={16} />
                Backup diário: {retentionLabel(p.backupRetentionDays)}
              </li>
              {orderedFeatures.map(({ key, name }) => {
                const included = p.features.includes(key);
                return (
                  <li
                    key={key}
                    className={included ? undefined : 'nr-feature-off'}
                  >
                    {included ? (
                      <Check size={16} aria-label="Incluído" />
                    ) : (
                      <X size={16} aria-label="Não incluído" />
                    )}
                    {name}
                  </li>
                );
              })}
            </ul>
            <div className="nr-plan-note">
              {p.ai && (
                <div className="nr-plan-ai">
                  <Sparkles size={18} />
                  <p>
                    Créditos de IA inclusos todo mês. Precisa de mais? Compre
                    créditos extras quando quiser.
                  </p>
                </div>
              )}
            </div>
          </article>
        ))}
        {builder && (
          <BuilderCard
            builder={builder}
            cycle={cycle}
            orderedFeatures={orderedFeatures}
          />
        )}
      </div>
      <p className="nr-price-footnote">{content.pricingFootnote}</p>
      {full ? (
        <div className="nr-compare">
          <h3>Todos os detalhes, lado a lado.</h3>
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Funcionalidade</th>
                  {plans.map((p) => (
                    <th key={p.key}>{p.name}</th>
                  ))}
                  {builder && <th>{builder.name}</th>}
                </tr>
              </thead>
              <tbody>
                {orderedFeatures.map(({ key: f, name }) => (
                  <tr key={f}>
                    <td>{name}</td>
                    {plans.map((p) => (
                      <td key={p.key}>
                        {p.features.includes(f) ? (
                          <Check aria-label="Incluído" size={17} />
                        ) : (
                          <span aria-label="Não incluído">—</span>
                        )}
                      </td>
                    ))}
                    {builder && (
                      <td>
                        {builder.features.includes(f) ? (
                          <Check aria-label="Incluído" size={17} />
                        ) : builder.modules.some(
                            (module) => module.key === f,
                          ) ? (
                          'Módulo opcional'
                        ) : (
                          <span aria-label="Não incluído">—</span>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
                <tr>
                  <td>Técnicos incluídos</td>
                  {plans.map((p) => (
                    <td key={p.key}>
                      {p.onRequest ? 'Negociado' : p.includedTechnicians}
                    </td>
                  ))}
                  {builder && <td>{builder.includedTechnicians}</td>}
                </tr>
                {(
                  [
                    ['maxUsers', 'Usuários', null],
                    ['storageMb', 'Armazenamento', null],
                    [
                      'whatsappMessagesMonth',
                      'Mensagens de WhatsApp por mês',
                      'whatsapp',
                    ],
                    ['portoRunsMonth', 'Execuções do Porto por mês', 'porto'],
                  ] as const
                ).map(([key, label, feature]) => (
                  <tr key={key}>
                    <td>{label}</td>
                    {plans.map((p) => (
                      <td key={p.key}>
                        {/* A limit only means something when the plan has the feature it limits. */}
                        {feature && !p.features.includes(feature) ? (
                          <span aria-label="Não incluído">—</span>
                        ) : p.onRequest ? (
                          'Negociado'
                        ) : key === 'storageMb' ? (
                          storageLabel(p.limits[key])
                        ) : (
                          unlimited(p.limits[key])
                        )}
                      </td>
                    ))}
                    {builder && (
                      <td>
                        {feature && !builder.features.includes(feature) ? (
                          <span aria-label="Depende do módulo">
                            {builder.modules.some(
                              (module) => module.key === feature,
                            )
                              ? 'Com o módulo'
                              : '—'}
                          </span>
                        ) : key === 'storageMb' ? (
                          storageLabel(builder.limits[key])
                        ) : (
                          unlimited(builder.limits[key])
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="text-center mt-8">
          <Link href="/planos" className="nr-text-link">
            Comparar todos os recursos
            <ArrowUpRight size={16} />
          </Link>
        </div>
      )}
    </section>
  );
}

function ProductPreview() {
  return (
    <div
      className="nr-product-preview"
      aria-label="Ilustração da visão operacional do NextRotta"
    >
      <div className="nr-preview-sidebar">
        <Route size={23} />
        <div className="active">
          <Layers3 size={15} />
        </div>
        <div>
          <Users size={15} />
        </div>
        <div>
          <Clock3 size={15} />
        </div>
        <div>
          <Sparkles size={15} />
        </div>
      </div>
      <div className="nr-preview-main">
        <div className="nr-preview-top">
          Visão da operação <span className="nr-avatar">MC</span>
        </div>
        <div className="nr-preview-heading">
          <div>
            <small>QUINTA-FEIRA, 1 DE OUTUBRO</small>
            <h3>
              Bom dia, Marina <span>☀</span>
            </h3>
            <p>Um novo dia para fazer acontecer.</p>
          </div>
          <span className="nr-preview-period">Este mês⌄</span>
        </div>
        <div className="nr-preview-metrics">
          <div>
            <small>Serviços realizados</small>
            <strong>
              248<span>↗ 18%</span>
            </strong>
            <p>Mais clientes bem atendidos</p>
          </div>
          <div>
            <small>Receita do mês</small>
            <strong>R$ 42.850</strong>
            <p>↗ 12% em relação ao mês anterior</p>
          </div>
        </div>
        <div className="nr-preview-chart">
          <div>
            <strong>Uma operação em movimento</strong>
            <small>Serviços por semana</small>
          </div>
          <div className="nr-chart-bars">
            {[35, 52, 46, 66, 60, 83, 72, 96, 82, 100, 91, 115].map(
              (height, i) => (
                <span key={i} style={{ height }} />
              ),
            )}
          </div>
          <div className="nr-chart-labels">
            <span>Semana 1</span>
            <span>Semana 2</span>
            <span>Semana 3</span>
            <span>Semana 4</span>
          </div>
        </div>
        <div className="nr-preview-bottom">
          <div className="nr-preview-check">
            <Check size={15} />
          </div>
          <div>
            <strong>Tudo pronto para o fechamento</strong>
            <small>Horas conferidas. Comissões calculadas.</small>
          </div>
          <ArrowUpRight size={17} />
        </div>
      </div>
      <div className="nr-floating-note">
        <span>
          <CheckCircle2 size={20} />
        </span>
        <div>
          Menos planilhas.
          <br />
          <strong>Mais tranquilidade.</strong>
        </div>
      </div>
    </div>
  );
}

/**
 * The features section: an animated tour of the system (route on the left, abstract moving
 * screens on the right). Features the tour doesn't show come as a short "E também" line.
 */
function FeatureGrid() {
  const { plans, features } = usePublicPlans();
  const firstPlan = (feature: string) =>
    plans?.find((p) => !p.onRequest && p.features.includes(feature))?.name;
  return (
    <FeatureTour
      planOf={firstPlan}
      others={features
        .filter((feature) => !TOUR_FEATURES.includes(feature.key))
        .map((feature) => feature.name)}
    />
  );
}

/** The old card grid (kept for pages that may still want a plain list of features). */
export function FeatureCards() {
  const { plans, features } = usePublicPlans();
  const firstPlan = (feature: string) =>
    plans?.find((p) => !p.onRequest && p.features.includes(feature))?.name;
  return (
    <div className="nr-feature-grid">
      {features.map(({ key: feature, name, description }, i) => {
        const Icon = [Users, Layers3, Clock3, ShieldCheck, Route, Sparkles][
          i % 6
        ];
        const plan = firstPlan(feature);
        return (
          <article key={feature}>
            <Icon size={24} />
            {plan && <span>{plan}</span>}
            <h3>{name}</h3>
            <p>
              {description ??
                FEATURE_DESCRIPTIONS[
                  feature as keyof typeof FEATURE_DESCRIPTIONS
                ] ??
                ''}
            </p>
          </article>
        );
      })}
    </div>
  );
}

export function BuiltinHomeSection({
  type,
  content,
  settings = {},
}: {
  type: SectionType;
  content: SiteContent;
  settings?: ThemeSection['settings'];
}) {
  switch (type) {
    case 'hero':
      return (
        <section className="nr-hero">
          <div className="nr-hero-copy">
            <span className="nr-hero-label">
              <span />
              PARA QUEM FAZ ACONTECER, EM CAMPO
            </span>
            <h1>
              {(() => {
                let word = 0;
                return content.title.split('\n').map((line, i) => (
                  <span key={i} className={i > 0 ? 'green' : ''}>
                    {line.split(' ').map((part, j) => (
                      <span
                        key={j}
                        className="nrh-w"
                        style={{ '--w': word++ } as CSSProperties}
                      >
                        {part}
                        {'\u00a0'}
                      </span>
                    ))}
                    <br />
                  </span>
                ));
              })()}
            </h1>
            <p>{content.subtitle}</p>
            <div className="nr-hero-actions">
              <Link className="nr-btn primary" href="/planos">
                {content.primary}
                <ArrowRight size={17} />
              </Link>
              <Link className="nr-btn" href="/contato">
                {content.secondary}
                <ArrowUpRight size={17} />
              </Link>
            </div>
            <div className="nr-hero-trust">
              <p>
                Feito para equipes que
                <br />
                <strong>não param de se movimentar.</strong>
              </p>
            </div>
          </div>
          <div className="nr-hero-visual">
            <div className="nr-orbit one" />
            <div className="nr-orbit two" />
            <HeroPreview />
            <span className="nr-hero-caption">
              DO CAMPO AO ESCRITÓRIO, TUDO CONECTADO.
            </span>
          </div>
        </section>
      );
    case 'benefits':
      return (
        <>
          <section className="nr-benefits-strip">
            {content.benefits
              .filter((item) => item.visible !== false)
              .map((b, i) => {
                return (
                  <div key={b.id}>
                    <span>
                      <BenefitArt index={i} />
                    </span>
                    <div>
                      <h3>{b.title}</h3>
                      <p>{b.text}</p>
                    </div>
                  </div>
                );
              })}
          </section>
          <VideoShowcase />
        </>
      );
    case 'ai':
      return (
        <section className="nr-public-section nr-ai-section">
          <div>
            <p className="nr-kicker">
              <Sparkles size={14} /> INTELIGÊNCIA QUE TRABALHA COM VOCÊ
            </p>
            <h2>{content.aiTitle}</h2>
            <p>{content.aiText}</p>
            <Link className="nr-text-link" href="/planos">
              Conheça o plano Pro
              <ArrowUpRight size={16} />
            </Link>
          </div>
          <AiDemo />
        </section>
      );
    case 'features':
      return (
        <section className="nr-public-section" id="funcionalidades">
          <div className="nr-section-center">
            <p className="nr-kicker">CADA PARTE DA ROTINA, NO LUGAR CERTO</p>
            <h2>Um sistema. Toda a sua operação.</h2>
            <p>As ferramentas certas para simplificar o dia a dia.</p>
          </div>
          <FeatureGrid />
        </section>
      );
    case 'steps':
      return (
        <section className="nr-how nr-how-band">
          <div className="nr-how-inner">
            <div className="nr-section-center">
              <p className="nr-kicker">DA ESCOLHA À PRIMEIRA ROTA</p>
              <h2>Começar pode ser simples.</h2>
            </div>
            <div className="nrv-steps">
            {content.steps
              .filter((item) => item.visible !== false)
              .map((step, i) => (
                <article key={step.id}>
                  <StepArt index={i} />
                  <h3>
                    <span className="nrv-num">{i + 1}</span>
                    {step.title}
                  </h3>
                  <p>{step.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
      );
    case 'updates':
      return (
        <section className="nr-update-section">
          <div>
            <p className="nr-kicker">SEMPRE EM MOVIMENTO</p>
            <h2>{content.updatesTitle}</h2>
            <p>{content.updatesText}</p>
            <Link href="/novidades" className="nr-btn">
              Veja o que há de novo
              <ArrowUpRight size={17} />
            </Link>
          </div>
          <UpdatesFeed />
        </section>
      );
    case 'security':
      return (
        <section className="nr-security">
          <div className="nrv-sec-band">
            <div>
              <h2>{content.securityTitle}</h2>
              <ShieldArt />
            </div>
            <ul className="nrv-sec-list">
              {content.security
                .filter((item) => item.visible !== false)
                .map((s, i) => (
                  <li key={s.id} style={{ '--i': i } as CSSProperties}>
                    <span className="nrv-sec-ico">
                      <SecIcon index={i} />
                    </span>
                    <div>
                      <h3>{s.title}</h3>
                      <p>{s.text}</p>
                    </div>
                    <span className="nrv-ok">
                      <Check size={14} strokeWidth={3} />
                    </span>
                  </li>
                ))}
            </ul>
          </div>
        </section>
      );
    case 'pricing':
      return <Pricing content={content} />;
    case 'testimonials':
      return (
        content.testimonials.some((t) => t.visible !== false) && (
          <section className="nr-public-section nr-testimonials">
            <p className="nr-kicker">QUEM ESTÁ EM CAMPO, CONTA</p>
            <h2>Uma rotina melhor faz diferença.</h2>
            <div className="nr-grid-2 nr-equal">
              {content.testimonials
                .filter((t) => t.visible !== false)
                .map((t) => (
                  <blockquote key={t.id}>
                    <span>“</span>
                    <p>{t.text}</p>
                    <footer>
                      {t.image && <img src={t.image} alt="" />}
                      <strong>{t.title}</strong>
                    </footer>
                  </blockquote>
                ))}
            </div>
          </section>
        )
      );
    case 'faq':
      return <Faq content={content} />;
    case 'cta':
      return (
        <section className="nr-final-cta">
          <RouteArt />
          <div>
            <p className="nr-kicker">VAMOS DAR O PRÓXIMO PASSO?</p>
            <h2>
              Mais controle na gestão.
              <br />
              Mais espaço para crescer.
            </h2>
          </div>
          <div className="nr-hero-actions">
            <Link href="/contratar" className="nr-btn primary">
              Assinar agora
              <ArrowRight size={18} />
            </Link>
            <Link href="/contato" className="nr-btn">
              Falar com a gente
              <ArrowUpRight size={18} />
            </Link>
          </div>
        </section>
      );
    default:
      return null;
  }
}
export function HomeContent({
  content,
  editor,
}: {
  content: SiteDocument;
  editor?: CanvasControls;
}) {
  return (
    <ThemePage
      content={content}
      editor={editor}
      renderBuiltin={(type, section) => (
        <BuiltinHomeSection
          type={type}
          content={contentForSection(content, section)}
          settings={section.settings}
        />
      )}
    />
  );
}
export function MarketingHome() {
  return <HomeContent content={useSiteContent()} />;
}
export function MarketingPlans() {
  const content = useSiteContent();
  return (
    <>
      <Pricing content={content} full />
      <Faq content={content} />
    </>
  );
}

/** Contact and sign-up forms: each submission becomes a lead in the platform panel. */
export function MarketingContact({ custom = false }: { custom?: boolean }) {
  const content = useSiteContent();
  const [values, setValues] = useState<FormValues>({
    name: '',
    company: '',
    email: '',
    phone: '',
    technicians: 5,
    message: '',
    website: '',
  });
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  async function submit() {
    setSending(true);
    setError('');
    try {
      const response = await fetch('/api/public/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...values,
          origin: custom ? 'sob_medida' : 'contato',
          ...(custom ? { plan: 'sob_medida' } : {}),
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setError(
          data?.error || 'Não foi possível enviar agora. Tente de novo.',
        );
        return;
      }
      setSent(true);
    } catch {
      setError(
        'Não foi possível enviar agora. Verifique sua conexão e tente de novo.',
      );
    } finally {
      setSending(false);
    }
  }
  return (
    <section className="nr-public-section nr-contact">
      <div>
        <p className="nr-kicker">
          {custom ? 'SUA OPERAÇÃO É ÚNICA' : 'UMA BOA CONVERSA MUDA TUDO'}
        </p>
        <h1>
          {custom
            ? 'Seu jeito de trabalhar.\nSeu NextRotta.'
            : 'Vamos encontrar a melhor rota para sua equipe.'}
        </h1>
        <p>
          {custom
            ? 'Desenvolvemos funcionalidades para as necessidades da sua operação. Recursos exclusivos, isolados para a sua empresa, com toda a base do plano Pro.'
            : 'Conte um pouco sobre sua operação. A gente ajuda a escolher o plano e cuida dos primeiros passos com você.'}
        </p>
        <div className="nr-contact-links">
          {content.whatsapp && (
            <a
              href={whatsappLink(content.whatsapp)}
              target="_blank"
              rel="noreferrer"
            >
              <MessageCircle size={19} />
              {content.phone || content.whatsapp}
              <ArrowUpRight size={16} />
            </a>
          )}
          {content.email && (
            <a href={`mailto:${content.email}`}>
              {content.email}
              <ArrowUpRight size={16} />
            </a>
          )}
          <small>{content.hours}</small>
        </div>
        {!custom && (
          <div
            style={{
              marginTop: 36,
              background: '#fff',
              border: '1px solid #e0e8d6',
              borderRadius: 14,
              padding: 22,
            }}
          >
            <strong style={{ fontSize: 17, color: '#1c392e' }}>
              Já sabe o que quer? Assine agora.
            </strong>
            <p style={{ marginTop: 8, fontSize: 14, lineHeight: 1.7 }}>
              Escolha o plano, crie a conta da sua empresa e pague só a
              implantação. A primeira mensalidade vem no mês seguinte, no dia
              que você escolher.
            </p>
            <Link
              className="nr-btn primary"
              href="/contratar"
              style={{ marginTop: 16 }}
            >
              Assinar agora
              <ArrowRight size={16} />
            </Link>
          </div>
        )}
      </div>
      <div className="nr-contact-form">
        {sent ? (
          <div className="nr-contact-success" role="status">
            <CheckCircle2 size={44} />
            <h2>Mensagem recebida!</h2>
            <p>
              Obrigado pelo contato. Vamos falar com você em breve pelo e-mail
              ou WhatsApp informados.
            </p>
            <Link className="nr-btn primary" href="/">
              Voltar ao início
            </Link>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <h2>{custom ? 'Conte o que você precisa' : 'Conte com a gente'}</h2>
            <Fields
              fields={[
                { key: 'name', label: 'Seu nome', required: true },
                { key: 'company', label: 'Empresa', required: true },
                {
                  key: 'email',
                  label: 'E-mail',
                  type: 'email',
                  required: true,
                },
                { key: 'phone', label: 'WhatsApp', required: true },
                {
                  key: 'technicians',
                  label: 'Número de técnicos',
                  type: 'number',
                  min: 1,
                  required: true,
                },
                {
                  key: 'message',
                  label: custom
                    ? 'Descreva a sua necessidade'
                    : 'Como podemos ajudar?',
                  type: 'textarea',
                  required: custom,
                },
              ]}
              values={values}
              setValues={setValues}
            />
            <input
              type="text"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              className="hidden"
              value={String(values.website)}
              onChange={(e) =>
                setValues({ ...values, website: e.target.value })
              }
            />
            {error && (
              <p className="nr-error" role="alert">
                {error}
              </p>
            )}
            <button className="nr-btn primary mt-6 w-full" disabled={sending}>
              {sending ? 'Enviando…' : 'Enviar mensagem'}
              <ArrowRight size={16} />
            </button>
            <p className="nr-form-privacy">
              Ao enviar, você concorda com nossa{' '}
              <Link href="/privacidade">Política de privacidade</Link>.
            </p>
          </form>
        )}
      </div>
    </section>
  );
}

type NewsPost = {
  id: string;
  title: string;
  publishedOn: string;
  category: 'feature' | 'improvement' | 'fix';
  body: string;
  imageUrl: string | null;
};
const NEWS_CATEGORIES = {
  feature: 'Novo recurso',
  improvement: 'Melhoria',
  fix: 'Correção',
};
const newsDate = (value: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'long',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(`${value}T12:00:00-03:00`));

/** Release notes published by the platform owner for the site. */
export function MarketingNews({ id }: { id?: string }) {
  const [posts, setPosts] = useState<NewsPost[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    fetch('/api/public/news', { cache: 'no-store' })
      .then((response) =>
        response.ok
          ? response.json()
          : Promise.reject(new Error(String(response.status))),
      )
      .then((data: { posts: NewsPost[] }) => active && setPosts(data.posts))
      .catch(() => active && setError(true));
    return () => {
      active = false;
    };
  }, []);
  if (id) {
    const post = posts?.find((p) => p.id === id);
    return (
      <section className="nr-public-section nr-legal">
        <Link href="/novidades" className="nr-text-link">
          ← Todas as novidades
        </Link>
        {!posts && !error ? (
          <p className="mt-8">Carregando…</p>
        ) : post ? (
          <article className="mt-8">
            <p className="nr-kicker">
              {NEWS_CATEGORIES[post.category]} · {newsDate(post.publishedOn)}
            </p>
            <h1>{post.title}</h1>
            {post.imageUrl && (
              <img
                className="my-6 max-h-96 rounded-xl"
                src={post.imageUrl}
                alt=""
              />
            )}
            <RichText text={post.body} />
          </article>
        ) : (
          <p className="mt-8">Publicação não encontrada.</p>
        )}
      </section>
    );
  }
  return (
    <section className="nr-public-section nr-news">
      <div className="nr-section-center">
        <p className="nr-kicker">O PRÓXIMO PASSO NUNCA PARA</p>
        <h1>Novidades que fazem diferença.</h1>
        <p>
          Novos recursos, melhorias e pequenos detalhes para uma rotina melhor.
        </p>
      </div>
      {error ? (
        <p className="py-12 text-center">
          Não foi possível carregar as novidades agora.
        </p>
      ) : !posts ? (
        <p className="py-12 text-center">Carregando…</p>
      ) : posts.length ? (
        <div className="nr-grid-3 mt-10">
          {posts.map((post) => (
            <article key={post.id} className="nr-public-plan">
              <p className="nr-kicker">
                {NEWS_CATEGORIES[post.category]} · {newsDate(post.publishedOn)}
              </p>
              <h3>{post.title}</h3>
              <p>
                {post.body.replace(/[#*]/g, '').slice(0, 160)}
                {post.body.length > 160 ? '…' : ''}
              </p>
              <Link className="nr-text-link" href={`/novidades/${post.id}`}>
                Ler mais
                <ArrowUpRight size={15} />
              </Link>
            </article>
          ))}
        </div>
      ) : (
        <p className="py-12 text-center">
          As primeiras novidades chegam em breve.
        </p>
      )}
    </section>
  );
}
export function MarketingLegal({ privacy = false }: { privacy?: boolean }) {
  const content = useSiteContent();
  return (
    <section className="nr-public-section nr-legal">
      <RichText text={privacy ? content.privacy : content.terms} />
    </section>
  );
}
