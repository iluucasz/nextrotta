'use client';

import { useEffect, useMemo, useState } from 'react';
import { Search, Wrench } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { DataPanel } from '@/components/data-panel';
import { LoadingShell } from '@/components/page-skeleton';
import { MetricCard } from '@/components/metric-card';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { demoServices, demoTechnicians } from '@/lib/demo-data';
import { formatCurrency, formatDate, normalizeText } from '@/lib/formatters';
import type { Service } from '@/lib/types';
import { useAppSession } from '@/hooks/use-app-session';

export default function TechnicianServicesPage() {
  const { user, loading } = useAppSession();
  const [services, setServices] = useState<Service[]>([]);
  const [query, setQuery] = useState('');

  useEffect(() => {
    async function loadServices() {
      if (!user) return;
      const technicianId = user.technicianId ?? user.userId;
      const response = await fetch(`/api/services?technicianId=${technicianId}`);
      if (response.ok) {
        const data = await response.json();
        setServices(data.services ?? []);
      }
    }

    loadServices();
  }, [user]);

  const fallbackTechnician = demoTechnicians[0];
  const visibleServices = services.length ? services : demoServices.filter((service) => service.technician_id === fallbackTechnician.id);
  const filteredServices = useMemo(() => {
    return visibleServices.filter((service) => {
      const haystack = normalizeText(`${service.order_code} ${service.service_type} ${service.competence_month}`);
      return !query || haystack.includes(normalizeText(query));
    });
  }, [query, visibleServices]);

  if (loading || !user) {
    return <LoadingShell role="technician" />;
  }

  const totalValue = filteredServices.reduce((total, service) => total + Number(service.value), 0);
  const averageValue = totalValue / Math.max(filteredServices.length, 1);
  const typeCount = new Set(filteredServices.map((service) => service.service_type)).size;

  return (
    <AppShell role="technician" userName={user.name || user.email}>
      <PageHeader eyebrow="Minha produção" title="Serviços realizados" description="Histórico de ordens de serviço, tipos, competências e valores brutos." />

      <div className="grid gap-3 md:grid-cols-3">
        <MetricCard title="Ordens" value={filteredServices.length} hint="No filtro atual" icon={Wrench} />
        <MetricCard title="Valor bruto" value={formatCurrency(totalValue)} hint={`Media ${formatCurrency(averageValue)}`} icon={Wrench} tone="success" />
        <MetricCard title="Tipos atendidos" value={typeCount} hint="Categorias distintas" icon={Wrench} />
      </div>

      <div className="mt-5">
        <DataPanel
          title="Tabela de OS"
          description={`${filteredServices.length} registro(s).`}
          action={
            <div className="flex min-h-10 items-center gap-2 rounded-md border border-border bg-background px-3">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar OS ou tipo" className="w-56 bg-transparent text-sm outline-none" />
            </div>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                  <th className="py-3 pr-4 font-medium">Código</th>
                  <th className="py-3 pr-4 font-medium">Tipo</th>
                  <th className="py-3 pr-4 font-medium">Competência</th>
                  <th className="py-3 pr-4 font-medium">Data</th>
                  <th className="py-3 font-medium">Valor</th>
                </tr>
              </thead>
              <tbody>
                {filteredServices.map((service) => (
                  <tr key={service.id} className="border-b border-border last:border-0">
                    <td className="py-3 pr-4 font-mono text-xs">{service.order_code}</td>
                    <td className="py-3 pr-4">{service.service_type}</td>
                    <td className="py-3 pr-4">
                      <StatusBadge tone="info">{service.competence_month}</StatusBadge>
                    </td>
                    <td className="py-3 pr-4 text-muted-foreground">{formatDate(service.date_performed)}</td>
                    <td className="py-3">{formatCurrency(service.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DataPanel>
      </div>
    </AppShell>
  );
}
