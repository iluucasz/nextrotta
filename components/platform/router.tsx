'use client';
import { AuditScreen } from './audit';
import { Bugs } from './bugs';
import { Coupons } from './coupons';
import { AiCredits } from './credits';
import { FeatureCatalog } from './features';
import { Leads } from './leads';
import { News } from './news';
import { OperationsScreen } from './operations';
import { Organizations, OrganizationWizard, OrganizationDetail, Provisioning } from './organizations';
import { Dashboard, Finance } from './overview';
import { Plans } from './plans';
import { PlatformSettings } from './settings';
import { SiteEditor } from './site-editor';
import { Empty } from './ui';

/** Every screen reads real data from /api/platform. */
export function PlatformRouter({ segments = [] }: { segments?: string[] }) {
  const [section, id, view] = segments;
  switch (section) {
    case undefined: return <Dashboard />;
    case 'organizacoes': return !id ? <Organizations /> : id === 'nova' ? <OrganizationWizard /> : view === 'provisionamento' ? <Provisioning id={id} /> : <OrganizationDetail id={id} />;
    case 'financeiro': return <Finance />;
    case 'planos': return <Plans />;
    case 'cupons': return <Coupons id={id} />;
    case 'creditos-ia': return <AiCredits id={id} />;
    case 'recursos': return <FeatureCatalog id={id} />;
    case 'bugs':
    case 'reports': return <Bugs id={id} />;
    case 'leads': return <Leads />;
    case 'novidades': return <News id={id} />;
    case 'site': return <SiteEditor preview={id === 'preview'} />;
    case 'operacao': return <OperationsScreen />;
    case 'auditoria': return <AuditScreen />;
    case 'configuracoes': return <PlatformSettings />;
    default: return <Empty title="Página não encontrada" text="Use o menu ao lado para navegar pelo painel." />;
  }
}
