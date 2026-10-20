'use client';

import { useEffect, useState } from 'react';
import { BarChart3, ClipboardCheck, Package, Receipt, Settings2, Truck, Wallet } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { LoadingShell } from '@/components/page-skeleton';
import { PageHeader } from '@/components/page-header';
import { AccountTab } from '@/components/parts/admin/account-tab';
import { CatalogTab } from '@/components/parts/admin/catalog-tab';
import { InventoryTab } from '@/components/parts/admin/inventory-tab';
import { OverviewTab } from '@/components/parts/admin/overview-tab';
import { SalesTab } from '@/components/parts/admin/sales-tab';
import { SettingsTab } from '@/components/parts/admin/settings-tab';
import { TechniciansTab } from '@/components/parts/admin/technicians-tab';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAppSession } from '@/hooks/use-app-session';

const TABS = [
  { value: 'overview', label: 'Visão geral', icon: BarChart3 },
  { value: 'catalog', label: 'Peças e estoque', icon: Package },
  { value: 'technicians', label: 'Técnicos', icon: Truck },
  { value: 'sales', label: 'Vendas', icon: Receipt },
  { value: 'inventory', label: 'Inventário', icon: ClipboardCheck },
  { value: 'account', label: 'Acerto', icon: Wallet },
  { value: 'settings', label: 'Configurações', icon: Settings2 },
] as const;

type TabValue = (typeof TABS)[number]['value'];

export default function AdminPartsPage() {
  const { user, loading } = useAppSession();
  const [tab, setTab] = useState<TabValue>('overview');

  // The tab lives in the URL hash, so a reload (or a link) opens the same one.
  useEffect(() => {
    const sync = () => {
      const fromHash = window.location.hash.slice(1);
      if (TABS.some((item) => item.value === fromHash)) setTab(fromHash as TabValue);
    };
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  function changeTab(value: string) {
    setTab(value as TabValue);
    window.history.replaceState(null, '', `#${value}`);
  }

  if (loading || !user) return <LoadingShell role="admin" />;

  return (
    <AppShell role="admin" userName={user.name || user.email}>
      <PageHeader
        eyebrow="Vendas"
        title="Controle de Peças"
        description="Peças em consignação com os técnicos: estoque central, remessas, vendas pelo celular, inventário e acerto mensal. Fica fora da folha."
      />
      <Tabs value={tab} onValueChange={changeTab} className="gap-5">
        <div className="-mx-1 overflow-x-auto px-1">
          <TabsList>
            {TABS.map(({ value, label, icon: Icon }) => (
              <TabsTrigger key={value} value={value}>
                <Icon className="h-4 w-4" />
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent value="overview">{tab === 'overview' ? <OverviewTab onNavigate={changeTab} /> : null}</TabsContent>
        <TabsContent value="catalog">{tab === 'catalog' ? <CatalogTab /> : null}</TabsContent>
        <TabsContent value="technicians">{tab === 'technicians' ? <TechniciansTab /> : null}</TabsContent>
        <TabsContent value="sales">{tab === 'sales' ? <SalesTab /> : null}</TabsContent>
        <TabsContent value="inventory">{tab === 'inventory' ? <InventoryTab /> : null}</TabsContent>
        <TabsContent value="account">{tab === 'account' ? <AccountTab /> : null}</TabsContent>
        <TabsContent value="settings">{tab === 'settings' ? <SettingsTab /> : null}</TabsContent>
      </Tabs>
    </AppShell>
  );
}
