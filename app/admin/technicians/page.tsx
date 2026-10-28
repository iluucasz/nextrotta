'use client';

import { useEffect, useMemo, useState } from 'react';
import { Eye, MoreHorizontal, Pencil, Power, Search, Trash2, UserPlus, Users, WalletCards } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { DataPanel } from '@/components/data-panel';
import { EmptyState } from '@/components/empty-state';
import { LoadingShell } from '@/components/page-skeleton';
import { MetricCard } from '@/components/metric-card';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatCurrency, formatPercent, normalizeText } from '@/lib/formatters';
import type { Technician, TechnicianStatus } from '@/lib/types';
import { useAppSession } from '@/hooks/use-app-session';
import { useOrganizationSettings } from '@/hooks/use-organization-settings';
import { DEFAULT_ORGANIZATION_SETTINGS, type OrganizationSettings } from '@/lib/organization-settings';
import { PhoneInput } from '@/components/phone-input';
import { formatPhoneInput, validatePhone } from '@/lib/whatsapp/phone';

const initialFormData = {
  qra: '',
  porto_name_hint: '',
  name: '',
  email: '',
  phone: '',
  password: '',
  commission_percentage: DEFAULT_ORGANIZATION_SETTINGS.commissionPercentage,
  base_salary: DEFAULT_ORGANIZATION_SETTINGS.baseSalary,
  va_allowance: DEFAULT_ORGANIZATION_SETTINGS.vaAllowance,
  vr_allowance: DEFAULT_ORGANIZATION_SETTINGS.vrAllowance,
  status: 'active' as TechnicianStatus,
};

type TechnicianFormData = typeof initialFormData;

/** A new technician starts with the organization's default commission, salary, VA and VR. */
function createInitialFormData(settings: OrganizationSettings = DEFAULT_ORGANIZATION_SETTINGS): TechnicianFormData {
  return {
    ...initialFormData,
    commission_percentage: settings.commissionPercentage,
    base_salary: settings.baseSalary,
    va_allowance: settings.vaAllowance,
    vr_allowance: settings.vrAllowance,
  };
}

function createFormDataFromTechnician(technician: Technician): TechnicianFormData {
  return {
    qra: technician.qra || '',
    porto_name_hint: technician.porto_name_hint || '',
    name: technician.name,
    email: technician.email || '',
    phone: technician.phone ? formatPhoneInput(technician.phone) : '',
    password: '',
    commission_percentage: Number(technician.commission_percentage),
    base_salary: Number(technician.base_salary),
    va_allowance: Number(technician.va_allowance),
    vr_allowance: Number(technician.vr_allowance),
    status: technician.status,
  };
}

export default function TechniciansPage() {
  const { user, loading } = useAppSession();
  const { settings: organizationSettings } = useOrganizationSettings();
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [techniciansLoading, setTechniciansLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [isFormDialogOpen, setIsFormDialogOpen] = useState(false);
  const [editingTechnician, setEditingTechnician] = useState<Technician | null>(null);
  const [deletingTechnician, setDeletingTechnician] = useState<Technician | null>(null);
  const [formData, setFormData] = useState<TechnicianFormData>(() => createInitialFormData());
  const [formError, setFormError] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    async function loadTechnicians() {
      if (!user) return;
      setTechniciansLoading(true);
      setLoadError('');

      try {
        const response = await fetch('/api/technicians', { cache: 'no-store' });
        if (response.ok) {
          const data = await response.json();
          setTechnicians(data.technicians ?? []);
        } else {
          // Not the same as "no technicians": say it failed instead of showing an empty list.
          setLoadError('Não foi possível carregar os técnicos.');
        }
      } catch {
        setLoadError('Não foi possível carregar os técnicos. Verifique a conexão.');
      } finally {
        setTechniciansLoading(false);
      }
    }

    loadTechnicians();
  }, [user, reloadKey]);

  const filteredTechnicians = useMemo(() => {
    return technicians.filter((technician) => {
      const haystack = normalizeText(`${technician.name} ${technician.email ?? ''} ${technician.qra ?? ''}`);
      return !query || haystack.includes(normalizeText(query));
    });
  }, [query, technicians]);

  function resetForm() {
    setEditingTechnician(null);
    setFormData(createInitialFormData(organizationSettings));
    setFormError('');
  }

  function handleFormDialogChange(open: boolean) {
    setIsFormDialogOpen(open);

    if (!open) {
      resetForm();
    }
  }

  function openCreateDialog() {
    resetForm();
    setIsFormDialogOpen(true);
  }

  function openEditDialog(technician: Technician) {
    setEditingTechnician(technician);
    setFormData(createFormDataFromTechnician(technician));
    setFormError('');
    setIsFormDialogOpen(true);
  }

  function upsertTechnician(savedTechnician: Technician) {
    setTechnicians((current) => {
      const next = current.some((technician) => technician.id === savedTechnician.id)
        ? current.map((technician) => (technician.id === savedTechnician.id ? savedTechnician : technician))
        : [...current, savedTechnician];

      return next.sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'));
    });
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError('');

    const phoneValidation = validatePhone(formData.phone);
    if (phoneValidation.status === 'incomplete' || phoneValidation.status === 'invalid') {
      setFormError(`WhatsApp: ${phoneValidation.message}`);
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch(editingTechnician ? `/api/technicians?id=${editingTechnician.id}` : '/api/technicians', {
        method: editingTechnician ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        setFormError(data?.error || 'Não foi possível salvar o técnico.');
        return;
      }

      const savedTechnician = await response.json();
      upsertTechnician(savedTechnician);
      handleFormDialogChange(false);
    } catch {
      setFormError('Não foi possível salvar o técnico. Verifique a conexão e tente de novo.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleToggleStatus(technician: Technician) {
    if (togglingId) return;
    const nextStatus = technician.status === 'active' ? 'inactive' : 'active';
    // The phone is left out on purpose: the API keeps the stored one when it isn't sent, so a number
    // saved in an older format can't block changing the status.
    const { phone: _phone, ...fields } = createFormDataFromTechnician(technician);
    setTogglingId(technician.id);

    try {
      const response = await fetch(`/api/technicians?id=${technician.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...fields, status: nextStatus }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        window.alert(data?.error || 'Não foi possível atualizar o status do técnico.');
        return;
      }

      const updatedTechnician = await response.json();
      upsertTechnician(updatedTechnician);
    } catch {
      window.alert('Não foi possível atualizar o status do técnico. Verifique a conexão e tente de novo.');
    } finally {
      setTogglingId(null);
    }
  }

  async function handleStartPreview(technician: Technician) {
    try {
      const response = await fetch('/api/auth/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ technicianId: technician.id }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        window.alert(data?.error || 'Não foi possível abrir o modo preview.');
        return;
      }
    } catch {
      window.alert('Não foi possível abrir o modo preview. Verifique a conexão e tente de novo.');
      return;
    }

    // Full reload, not a router push: the session cookie now belongs to a different user, so any
    // client-side cache from the admin session has to be dropped.
    window.location.href = '/dashboard';
  }

  async function handleDelete() {
    if (!deletingTechnician) {
      return;
    }

    setDeleteError('');
    setIsDeleting(true);

    try {
      const response = await fetch(`/api/technicians?id=${deletingTechnician.id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        setDeleteError(data?.error || 'Não foi possível excluir o técnico.');
        return;
      }

      setTechnicians((current) => current.filter((technician) => technician.id !== deletingTechnician.id));
      setDeletingTechnician(null);
    } catch {
      setDeleteError('Não foi possível excluir o técnico. Verifique a conexão e tente de novo.');
    } finally {
      setIsDeleting(false);
    }
  }

  if (loading || !user || techniciansLoading) {
    return <LoadingShell role="admin" />;
  }

  const activeTechnicians = technicians.filter((technician) => technician.status === 'active');
  const activeCount = activeTechnicians.length;
  const averageCommission =
    activeTechnicians.reduce((total, technician) => total + Number(technician.commission_percentage), 0) /
    Math.max(activeTechnicians.length, 1);
  const totalBaseSalary = activeTechnicians.reduce((total, technician) => total + Number(technician.base_salary), 0);
  const isEditing = Boolean(editingTechnician);
  const modalTitle = isEditing ? 'Editar técnico' : 'Novo técnico';
  const passwordHint = isEditing
    ? 'Preencha apenas se quiser trocar a senha atual.'
    : 'Defina a senha do usuário criado pelo administrador.';
  const inputClassName = 'min-h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm outline-none transition focus:ring-2 focus:ring-ring';

  return (
    <AppShell role="admin" userName={user.name || user.email}>
      <PageHeader
        eyebrow="Equipe"
        title="Técnicos"
        description="Cadastro de colaboradores, QRA, comissão, benefícios e status operacional."
      >
        <Button type="button" onClick={openCreateDialog}>
          <UserPlus className="h-4 w-4" />
          Novo técnico
        </Button>
      </PageHeader>

      {loadError ? (
        <div role="alert" className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          <span>{loadError}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => setReloadKey((key) => key + 1)}>
            Tentar novamente
          </Button>
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-3">
        <MetricCard title="Ativos" value={`${activeCount}/${technicians.length}`} hint="Técnicos em operação" icon={Users} />
        <MetricCard title="Comissão média" value={formatPercent(averageCommission)} hint="Base dos ativos" icon={WalletCards} />
        <MetricCard title="Salários base" value={formatCurrency(totalBaseSalary)} hint="Somatório dos ativos" icon={WalletCards} tone="warning" />
      </div>

      <Dialog open={isFormDialogOpen} onOpenChange={handleFormDialogChange}>
        <DialogContent className="max-h-[88vh] overflow-hidden p-0 sm:max-w-4xl">
          <div className="flex max-h-[88vh] min-h-0 flex-col">
              <DialogHeader className="border-b border-border/70 px-6 py-5 sm:px-8">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1.5">
                    <DialogTitle className="text-xl sm:text-2xl">{modalTitle}</DialogTitle>
                    <DialogDescription className="max-w-2xl text-sm leading-6 text-muted-foreground">
                      Atualize dados operacionais, financeiros, acesso e status do colaborador.
                    </DialogDescription>
                  </div>

                  <div className="hidden rounded-full border border-border bg-muted/60 px-3 py-1 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground lg:inline-flex">
                    {isEditing ? 'Modo edição' : 'Novo cadastro'}
                  </div>
                </div>
              </DialogHeader>

              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6 sm:px-8">
                {formError ? <div className="mb-5 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{formError}</div> : null}

                <form id="technician-form" onSubmit={handleSubmit} className="space-y-6">
                  <section className="rounded-2xl border border-border/70 bg-card/70 p-5 shadow-sm sm:p-6">
                    <div className="mb-5 space-y-1">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Identificação e acesso</p>
                      <h3 className="text-base font-semibold text-foreground">Dados principais do colaborador</h3>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <label className="text-sm md:col-span-2">
                        <span className="mb-1.5 block font-medium">Nome</span>
                        <input
                          type="text"
                          value={formData.name}
                          onChange={(event) =>
                            setFormData((current) => ({
                              ...current,
                              name: event.target.value,
                            }))
                          }
                          className={inputClassName}
                          required
                        />
                      </label>

                      <label className="text-sm">
                        <span className="mb-1.5 block font-medium">Email</span>
                        <input
                          type="email"
                          value={formData.email}
                          onChange={(event) =>
                            setFormData((current) => ({
                              ...current,
                              email: event.target.value,
                            }))
                          }
                          className={inputClassName}
                          required
                        />
                      </label>

                      <label className="text-sm">
                        <span className="mb-1.5 block font-medium">Senha</span>
                        <input
                          type="password"
                          value={formData.password}
                          onChange={(event) =>
                            setFormData((current) => ({
                              ...current,
                              password: event.target.value,
                            }))
                          }
                          className={inputClassName}
                          required={!isEditing}
                          minLength={8}
                        />
                        <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{passwordHint}</p>
                      </label>
                    </div>
                  </section>

                  <section className="rounded-2xl border border-border/70 bg-card/70 p-5 shadow-sm sm:p-6">
                    <div className="mb-5 space-y-1">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Operação</p>
                      <h3 className="text-base font-semibold text-foreground">Controle interno do cadastro</h3>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <label className="text-sm">
                        <span className="mb-1.5 block font-medium">QRA</span>
                        <input
                          type="text"
                          value={formData.qra}
                          onChange={(event) =>
                            setFormData((current) => ({
                              ...current,
                              qra: event.target.value,
                            }))
                          }
                          className={inputClassName}
                        />
                      </label>

                      <label className="text-sm">
                        <span className="mb-1.5 block font-medium">WhatsApp (opcional)</span>
                        <PhoneInput
                          value={formData.phone}
                          onChange={(phone) => setFormData((current) => ({ ...current, phone }))}
                          className={inputClassName}
                          checkWhatsApp
                          hint="Ex.: (11) 97971-3590 — pode digitar com ou sem +55, espaços ou traços. Recebe as notificações automáticas; sem número, o técnico não recebe mensagens."
                        />
                      </label>

                      <label className="text-sm md:col-span-2">
                        <span className="mb-1.5 block font-medium">Nome no Porto (opcional)</span>
                        <input
                          type="text"
                          value={formData.porto_name_hint}
                          onChange={(event) =>
                            setFormData((current) => ({
                              ...current,
                              porto_name_hint: event.target.value,
                            }))
                          }
                          placeholder="Só preencha se o nome cadastrado aqui for diferente do exibido no Porto"
                          className={inputClassName}
                        />
                        <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
                          Usado pra achar o apontamento de horas desse técnico no Portal do
                          Prestador (Porto Seguro), quando o nome cadastrado aqui não bate com o
                          nome exibido lá (apelido, nome social, etc). Deixe em branco pra usar o
                          nome acima.
                        </p>
                      </label>

                      <label className="text-sm">
                        <span className="mb-1.5 block font-medium">Status</span>
                        <select
                          value={formData.status}
                          onChange={(event) =>
                            setFormData((current) => ({
                              ...current,
                              status: event.target.value as TechnicianStatus,
                            }))
                          }
                          className={inputClassName}
                        >
                          <option value="active">Ativo</option>
                          <option value="inactive">Inativo</option>
                        </select>
                      </label>
                    </div>
                  </section>

                  <section className="rounded-2xl border border-border/70 bg-card/70 p-5 shadow-sm sm:p-6">
                    <div className="mb-5 space-y-1">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Financeiro</p>
                      <h3 className="text-base font-semibold text-foreground">Comissão, salário e benefícios</h3>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                      <label className="text-sm">
                        <span className="mb-1.5 block font-medium">Comissão %</span>
                        <input
                          type="number"
                          value={formData.commission_percentage}
                          onChange={(event) =>
                            setFormData((current) => ({
                              ...current,
                              commission_percentage: Number(event.target.value),
                            }))
                          }
                          className={inputClassName}
                        />
                      </label>

                      <label className="text-sm">
                        <span className="mb-1.5 block font-medium">Salário base</span>
                        <input
                          type="number"
                          value={formData.base_salary}
                          onChange={(event) =>
                            setFormData((current) => ({
                              ...current,
                              base_salary: Number(event.target.value),
                            }))
                          }
                          className={inputClassName}
                        />
                      </label>

                      <label className="text-sm">
                        <span className="mb-1.5 block font-medium">VA</span>
                        <input
                          type="number"
                          value={formData.va_allowance}
                          onChange={(event) =>
                            setFormData((current) => ({
                              ...current,
                              va_allowance: Number(event.target.value),
                            }))
                          }
                          className={inputClassName}
                        />
                      </label>

                      <label className="text-sm">
                        <span className="mb-1.5 block font-medium">VR</span>
                        <input
                          type="number"
                          value={formData.vr_allowance}
                          onChange={(event) =>
                            setFormData((current) => ({
                              ...current,
                              vr_allowance: Number(event.target.value),
                            }))
                          }
                          className={inputClassName}
                        />
                      </label>
                    </div>
                  </section>
                </form>
              </div>

              <DialogFooter className="border-t border-border/70 bg-background/95 px-6 py-4 sm:px-8">
                <Button type="button" variant="outline" onClick={() => handleFormDialogChange(false)}>
                  Cancelar
                </Button>
                <Button type="submit" form="technician-form" disabled={isSubmitting} className="min-w-40">
                  {isSubmitting ? 'Salvando...' : isEditing ? 'Salvar alterações' : 'Salvar técnico'}
                </Button>
              </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(deletingTechnician)}
        onOpenChange={(open) => {
          if (!open) {
            setDeletingTechnician(null);
            setDeleteError('');
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir técnico</AlertDialogTitle>
            <AlertDialogDescription>
              {deletingTechnician
                ? `${deletingTechnician.name} e o usuário de acesso serão arquivados e deixarão de aparecer. O histórico (serviços, horas, escala e folha) é mantido e o técnico pode ser restaurado depois.`
                : 'O técnico e o usuário de acesso serão arquivados e deixarão de aparecer. O histórico (serviços, horas, escala e folha) é mantido e o técnico pode ser restaurado depois.'}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {deleteError ? <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{deleteError}</div> : null}

          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteError('')}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={async (event) => {
                event.preventDefault();
                await handleDelete();
              }}
            >
              {isDeleting ? 'Excluindo...' : 'Excluir técnico'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="mt-5">
        <DataPanel
          title="Lista de técnicos"
          description={`${filteredTechnicians.length} registro(s) encontrados.`}
          action={
            <div className="flex min-h-10 items-center gap-2 rounded-md border border-border bg-background px-3">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar técnico" className="w-56 bg-transparent text-sm outline-none" />
            </div>
          }
        >
          {filteredTechnicians.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                    <th className="py-3 pr-4 font-medium">QRA</th>
                    <th className="py-3 pr-4 font-medium">Nome</th>
                    <th className="py-3 pr-4 font-medium">Email</th>
                    <th className="py-3 pr-4 font-medium">Comissão</th>
                    <th className="py-3 pr-4 font-medium">Salário</th>
                    <th className="py-3 pr-4 font-medium">VA</th>
                    <th className="py-3 pr-4 font-medium">VR</th>
                    <th className="py-3 pr-4 font-medium">Status</th>
                    <th className="py-3 text-right font-medium">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTechnicians.map((technician) => (
                    <tr key={technician.id} className="border-b border-border last:border-0">
                      <td className="py-3 pr-4 font-mono text-xs">{technician.qra || '-'}</td>
                      <td className="py-3 pr-4 font-medium">{technician.name}</td>
                      <td className="py-3 pr-4 text-muted-foreground">
                        {technician.email || '-'}
                        {technician.phone ? <span className="block text-xs">{technician.phone}</span> : null}
                      </td>
                      <td className="py-3 pr-4">{formatPercent(technician.commission_percentage)}</td>
                      <td className="py-3 pr-4">{formatCurrency(technician.base_salary)}</td>
                      <td className="py-3 pr-4">{formatCurrency(technician.va_allowance)}</td>
                      <td className="py-3 pr-4">{formatCurrency(technician.vr_allowance)}</td>
                      <td className="py-3 pr-4">
                        <StatusBadge tone={technician.status === 'active' ? 'success' : 'danger'}>
                          {technician.status === 'active' ? 'Ativo' : 'Inativo'}
                        </StatusBadge>
                      </td>
                      <td className="py-3 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button type="button" variant="ghost" size="icon-sm" aria-label={`Ações para ${technician.name}`}>
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => openEditDialog(technician)}>
                              <Pencil className="h-4 w-4" />
                              Editar
                            </DropdownMenuItem>
                            <DropdownMenuItem disabled={togglingId !== null} onSelect={() => void handleToggleStatus(technician)}>
                              <Power className="h-4 w-4" />
                              {technician.status === 'active' ? 'Inativar' : 'Ativar'}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={technician.status !== 'active'}
                              onSelect={() => void handleStartPreview(technician)}
                            >
                              <Eye className="h-4 w-4" />
                              Modo preview
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={() => {
                                setDeleteError('');
                                setDeletingTechnician(technician);
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                              Excluir
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              icon={Users}
              title={query ? 'Nenhum técnico encontrado' : 'Nenhum técnico cadastrado'}
              description={query ? 'Tente ajustar o termo da busca.' : 'Use o botão "Novo técnico" para criar o primeiro cadastro.'}
            />
          )}
        </DataPanel>
      </div>
    </AppShell>
  );
}
