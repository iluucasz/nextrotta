'use client';

import { useEffect, useState } from 'react';
import { ArrowLeftRight, BarChart3, ChartNoAxesCombined, ClipboardCheck, Package, Receipt, Settings2, Truck, Wallet } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { LoadingShell } from '@/components/page-skeleton';
import { PageHeader } from '@/components/page-header';
import { AccountTab } from '@/components/parts/admin/account-tab';
import { CatalogTab } from '@/components/parts/admin/catalog-tab';
import { FinanceTab } from '@/components/parts/admin/finance-tab';
import { InventoryTab } from '@/components/parts/admin/inventory-tab';
import { MovementsTab } from '@/components/parts/admin/movements-tab';
import { OverviewTab } from '@/components/parts/admin/overview-tab';
import { SalesTab } from '@/components/parts/admin/sales-tab';
import { SettingsTab } from '@/components/parts/admin/settings-tab';
import { TabVideoButton } from '@/components/parts/admin/tab-video';
import { TechniciansTab } from '@/components/parts/admin/technicians-tab';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAppSession } from '@/hooks/use-app-session';

const TABS = [
  { value: 'overview', label: 'Resumo', icon: BarChart3 },
  { value: 'sales', label: 'Vendas', icon: Receipt },
  { value: 'catalog', label: 'Peças', icon: Package },
  { value: 'movements', label: 'Movimentações', icon: ArrowLeftRight },
  { value: 'technicians', label: 'Técnicos', icon: Truck },
  { value: 'inventory', label: 'Inventário', icon: ClipboardCheck },
  { value: 'account', label: 'Acerto', icon: Wallet },
  { value: 'finance', label: 'Financeiro', icon: ChartNoAxesCombined },
  { value: 'settings', label: 'Ajustes', icon: Settings2 },
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
      <PageHeader title="Venda de Peças">
        <TabVideoButton key={tab} tab={tab} />
      </PageHeader>
      <Tabs value={tab} onValueChange={changeTab} className="gap-6">
        <div className="-mx-1 overflow-x-auto px-1">
          <TabsList className="h-14 w-full min-w-max gap-1 rounded-xl p-1.5">
            {TABS.map(({ value, label, icon: Icon }) => (
              <TabsTrigger key={value} value={value} className="gap-2 rounded-lg px-5 text-base">
                <Icon className="h-5 w-5" />
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent value="overview">{tab === 'overview' ? <OverviewTab onNavigate={changeTab} /> : null}</TabsContent>
        <TabsContent value="catalog">{tab === 'catalog' ? <CatalogTab /> : null}</TabsContent>
        <TabsContent value="movements">{tab === 'movements' ? <MovementsTab /> : null}</TabsContent>
        <TabsContent value="technicians">{tab === 'technicians' ? <TechniciansTab /> : null}</TabsContent>
        <TabsContent value="sales">{tab === 'sales' ? <SalesTab /> : null}</TabsContent>
        <TabsContent value="inventory">{tab === 'inventory' ? <InventoryTab /> : null}</TabsContent>
        <TabsContent value="account">{tab === 'account' ? <AccountTab /> : null}</TabsContent>
        <TabsContent value="finance">{tab === 'finance' ? <FinanceTab onNavigate={changeTab} /> : null}</TabsContent>
        <TabsContent value="settings">{tab === 'settings' ? <SettingsTab /> : null}</TabsContent>
      </Tabs>
    </AppShell>
  );
}
