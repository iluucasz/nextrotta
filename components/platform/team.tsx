'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { api, date, errorMessage, ORGANIZATION_STATUS_LABELS, useOrganizationHost, useResource, type OrganizationStatusKey } from './api';
import { useNotify } from './notice';
import { Badge, Confirm, DataTable, Editor, ErrorState, Loading, Metric, Panel, Title } from './ui';

type Member = { id: string; name: string; email: string; role: 'platform_owner' | 'platform_support'; status: 'active' | 'inactive'; lastLoginAt: string | null; createdAt: string; mustChangePassword: boolean; isYou: boolean; isFounder: boolean };

const ROLE_TEXT = { platform_owner: 'Admin', platform_support: 'Atendente' };

/** The NextRotta's own team (admins only): who may enter the panel and what each one sees. */
export function Team() {
  const notify = useNotify();
  const { data, error, loading, reload } = useResource<{ team: Member[] }>('/team');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);
  const [resetting, setResetting] = useState<Member | null>(null);
  const [toggling, setToggling] = useState<Member | null>(null);
  const [shown, setShown] = useState<{ name: string; email: string; password: string } | null>(null);

  const rows = (data?.team ?? []).map((member) => ({ ...member, roleText: ROLE_TEXT[member.role], statusText: member.status === 'active' ? 'Ativo' : 'Inativo', last: member.lastLoginAt ?? '' }));

  return (
    <>
      <Title title="Equipe" action={<button className="nr-btn primary" onClick={() => setCreating(true)}>Novo membro</button>} />
      <div className="nr-metrics">
        <Metric label="Admins ativos" value={rows.filter((row) => row.role === 'platform_owner' && row.status === 'active').length} detail="acesso total" />
        <Metric label="Atendentes ativos" value={rows.filter((row) => row.role === 'platform_support' && row.status === 'active').length} detail="Reports e Livechat" />
      </div>
      <Panel title="Quem entra no painel" description="Admin tem acesso total, inclusive a esta tela. Atendente vê só Reports, Livechat e as empresas (sem valores, planos nem entrar na conta delas).">
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : (
          <DataTable
            rows={rows}
            defaultSort="roleText"
            filters={[{ key: 'statusText', label: 'Situação', options: ['Ativo', 'Inativo'] }]}
            columns={[
              { key: 'name', label: 'Pessoa', render: (row) => <span>{row.name}<small className="block">{row.email}</small></span> },
              { key: 'roleText', label: 'Papel' },
              { key: 'statusText', label: 'Situação', render: (row) => <span><Badge>{row.statusText}</Badge>{row.mustChangePassword ? <small className="block">Senha temporária</small> : null}</span> },
              { key: 'last', label: 'Último acesso', render: (row) => date(row.lastLoginAt, true) },
            ]}
            actions={(row) =>
              row.isYou || row.isFounder ? (
                <span className="text-xs text-muted-foreground">{row.isYou ? 'Você' : 'Primeiro admin'}</span>
              ) : (
                <>
                  <button className="nr-btn" onClick={() => setEditing(row)}>Editar</button>
                  <button className="nr-btn" onClick={() => setResetting(row)}>Nova senha</button>
                  <button className="nr-btn" onClick={() => setToggling(row)}>{row.status === 'active' ? 'Desativar' : 'Reativar'}</button>
                </>
              )
            }
          />
        )}
      </Panel>

      {creating && (
        <Editor
          title="Novo membro da equipe"
          description="A senha temporária aparece uma vez; no primeiro acesso a pessoa escolhe a própria."
          fields={[{ key: 'name', label: 'Nome', required: true }, { key: 'email', label: 'E-mail de acesso', type: 'email', required: true }, { key: 'role', label: 'Papel', type: 'select', required: true, options: [{ value: 'platform_support', label: 'Atendente (Reports, Livechat e empresas)' }, { value: 'platform_owner', label: 'Admin (acesso total)' }] }]}
          initial={{ name: '', email: '', role: 'platform_support' }}
          submit="Criar membro"
          onClose={() => setCreating(false)}
          onSave={async (values) => {
            const result = await api<{ user: { name: string; email: string }; temporaryPassword: string }>('/team', { body: { name: values.name, email: values.email, role: values.role } });
            setShown({ name: result.user.name, email: result.user.email, password: result.temporaryPassword });
            reload();
          }}
        />
      )}
      {editing && (
        <Editor
          title="Editar membro"
          fields={[{ key: 'name', label: 'Nome', required: true }, { key: 'email', label: 'E-mail de acesso', type: 'email', required: true }]}
          initial={{ name: editing.name, email: editing.email }}
          onClose={() => setEditing(null)}
          onSave={async (values) => {
            await api(`/team/${editing.id}`, { method: 'PATCH', body: { name: values.name, email: values.email } });
            notify('Dados salvos.');
            reload();
          }}
        />
      )}
      {resetting && (
        <Confirm
          title="Gerar nova senha"
          description={`${resetting.name} passa a ter uma senha temporária e escolhe outra no próximo acesso. A senha atual deixa de valer.`}
          onClose={() => setResetting(null)}
          onConfirm={async () => {
            try {
              const result = await api<{ temporaryPassword: string }>(`/team/${resetting.id}/password`, { body: {} });
              setShown({ name: resetting.name, email: resetting.email, password: result.temporaryPassword });
              reload();
            } catch (reason) {
              notify(errorMessage(reason));
              throw reason;
            }
          }}
        />
      )}
      {toggling && (
        <Confirm
          title={toggling.status === 'active' ? 'Desativar membro' : 'Reativar membro'}
          description={toggling.status === 'active' ? `${toggling.name} perde o acesso agora, mesmo com a sessão aberta. Nada é apagado: dá para reativar depois.` : `${toggling.name} volta a entrar no painel com a senha que já tem.`}
          onClose={() => setToggling(null)}
          onConfirm={async () => {
            await api(`/team/${toggling.id}`, { method: 'PATCH', body: { status: toggling.status === 'active' ? 'inactive' : 'active' } });
            notify(toggling.status === 'active' ? 'Pessoa desativada.' : 'Pessoa reativada.');
            reload();
          }}
        />
      )}
      {shown && (
        <Editor
          title="Senha temporária"
          description={`Entregue a ${shown.name} (${shown.email}). Ela não aparece de novo.`}
          fields={[{ key: 'password', label: 'Senha temporária' }]}
          initial={{ password: shown.password }}
          submit="Fechar"
          onClose={() => setShown(null)}
          onSave={() => true}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// What the support user sees of the companies
// ---------------------------------------------------------------------------------------------

type SupportOrganization = {
  id: string; name: string; legalName: string | null; slug: string; status: OrganizationStatusKey; email: string | null; phone: string | null; city: string | null; state: string | null;
  createdAt: string; lifetime: boolean; test: boolean; planName: string | null; activeTechnicians: number; openTickets: number;
};

const statusText = (status: string) => ORGANIZATION_STATUS_LABELS[status as OrganizationStatusKey] ?? status;

export function SupportOrganizations() {
  const { data, error, loading, reload } = useResource<{ organizations: SupportOrganization[] }>('/organizations');
  const host = useOrganizationHost();
  const rows = (data?.organizations ?? []).map((organization) => ({ ...organization, statusText: statusText(organization.status), plan: organization.planName ?? 'Sem plano' }));
  return (
    <>
      <Title title="Organizações" />
      <Panel title="Empresas">
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : (
          <DataTable
            rows={rows}
            defaultSort="createdAt"
            defaultDescending
            filters={[{ key: 'statusText', label: 'Estado', options: Object.values(ORGANIZATION_STATUS_LABELS) }]}
            columns={[
              { key: 'name', label: 'Organização', render: (row) => <Link className="nr-company" href={`/plataforma/organizacoes/${row.id}`}><span>{row.name}<small>{host(row.slug)}</small></span></Link> },
              { key: 'plan', label: 'Plano' },
              { key: 'statusText', label: 'Estado', render: (row) => <span><Badge>{row.statusText}</Badge>{row.test ? <small className="block">Conta de teste</small> : null}</span> },
              { key: 'openTickets', label: 'Chamados abertos' },
              { key: 'activeTechnicians', label: 'Técnicos' },
            ]}
          />
        )}
      </Panel>
    </>
  );
}

type SupportDetail = { organization: SupportOrganization & { statusReason: string | null; cycle: string | null }; users: Array<{ id: string; name: string; email: string; role: string; status: string; lastLoginAt: string | null }> };

export function SupportOrganizationDetail({ id }: { id: string }) {
  const { data, error, loading, reload } = useResource<SupportDetail>(`/organizations/${id}`);
  const host = useOrganizationHost();
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorState message={error || 'Não foi possível carregar.'} onRetry={reload} />;
  const { organization: org, users } = data;
  return (
    <>
      <Title title={org.name} action={<Link className="nr-btn" href="/plataforma/organizacoes"><ArrowLeft size={16} />Voltar</Link>} />
      <div className="nr-metrics">
        <Metric label="Estado" value={statusText(org.status)} detail={org.statusReason ?? undefined} />
        <Metric label="Chamados abertos" value={org.openTickets} />
        <Metric label="Técnicos ativos" value={org.activeTechnicians} />
      </div>
      <div className="nr-equal nr-grid-2">
        <Panel title="Contato">
          <div className="nr-pad">
            {[
              ['Razão social', org.legalName],
              ['Endereço', host(org.slug)],
              ['E-mail', org.email],
              ['Telefone', org.phone],
              ['Cidade', [org.city, org.state].filter(Boolean).join(' / ')],
              ['Plano', org.planName],
              ['Cliente desde', date(org.createdAt)],
            ].map(([label, value]) => (
              <div className="nr-detail-row" key={label}><span>{label}</span><span>{value || '—'}</span></div>
            ))}
          </div>
        </Panel>
        <Panel title="Usuários da empresa">
          <div className="nr-pad">
            {users.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum usuário.</p> : users.map((user) => (
              <div className="nr-detail-row" key={user.id}><span>{user.name}<small>{user.email}</small></span><Badge>{user.status === 'active' ? 'Ativo' : 'Inativo'}</Badge></div>
            ))}
          </div>
        </Panel>
      </div>
    </>
  );
}
