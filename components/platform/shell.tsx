'use client';
import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Activity, ArrowUpRight, Blocks, BookOpen, Building2, CircleDollarSign, CreditCard, Gauge, Globe, History, LayoutDashboard, Menu, MessageSquare, Sparkles, TicketPercent, X } from 'lucide-react';
import { BrandLogo } from '@/components/brand-logo';
import { NoticeProvider } from './notice';
import { ScreenState } from './ui';
import './platform.css';
import { ProfileMenu, type OwnerProfile } from './profile-menu';

export const navigation = [
  { label: 'Visão geral', path: '', icon: LayoutDashboard, group: 'GESTÃO' },
  { label: 'Organizações', path: '/organizacoes', icon: Building2 },
  { label: 'Financeiro', path: '/financeiro', icon: CircleDollarSign },
  { label: 'Planos', path: '/planos', icon: CreditCard },
  { label: 'Cupons e descontos', path: '/cupons', icon: TicketPercent },
  { label: 'Créditos de IA', path: '/creditos-ia', icon: Sparkles },
  { label: 'Catálogo de recursos', path: '/recursos', icon: Blocks },
  { label: 'Reports', path: '/reports', icon: MessageSquare, group: 'RELACIONAMENTO' },
  { label: 'Leads', path: '/leads', icon: Gauge },
  { label: 'Novidades', path: '/novidades', icon: BookOpen },
  { label: 'Conteúdo do site', path: '/site', icon: Globe },
  { label: 'Operação', path: '/operacao', icon: Activity, group: 'PLATAFORMA' },
  { label: 'Auditoria', path: '/auditoria', icon: History },
];
/** Pages reached from the header instead of the menu (they still need a breadcrumb label). */
const headerPages = [{ label: 'Configurações', path: '/configuracoes' }];
export function Brand() { return <BrandLogo className="nr-logo" />; }
function Shell({ children, owner }: { children: ReactNode; owner: OwnerProfile }) {
  const path = usePathname(); const [open, setOpen] = useState(false);
  return <div className="nr-platform">{open && <button className="nr-overlay" aria-label="Fechar navegação" onClick={() => setOpen(false)} />}<aside className={`nr-sidebar ${open ? 'open' : ''}`}><Link href="/plataforma" className="nr-brand-link"><Brand /></Link><nav aria-label="Navegação da plataforma">{navigation.map(item => <div key={item.path}>{item.group && <p className="nr-nav-group">{item.group}</p>}<Link onClick={() => setOpen(false)} href={`/plataforma${item.path}`} aria-current={path === `/plataforma${item.path}` || item.path && path.startsWith(`/plataforma${item.path}/`) ? 'page' : undefined}><item.icon size={18} />{item.label}</Link></div>)}</nav></aside><div className="nr-main"><header className="nr-topbar"><button className="nr-menu" aria-label="Abrir navegação" onClick={() => setOpen(true)}>{open ? <X /> : <Menu />}</button><span>Painel do dono <span className="nr-topbar-divider">/</span> {[...navigation, ...headerPages].find(i => i.path && path.startsWith(`/plataforma${i.path}`))?.label || 'Visão geral'}</span><div><a className="nr-topbar-action" href="/" target="_blank" rel="noopener noreferrer" title="Abrir o site público em outra aba"><Globe size={18} /><span>Site público</span><ArrowUpRight size={14} /></a><span className="nr-topbar-separator" aria-hidden="true" /><ProfileMenu owner={owner} active={path.startsWith('/plataforma/configuracoes')} /></div></header><main className="nr-content"><ScreenState key={path}>{children}</ScreenState></main><footer className="nr-panel-footer">NextRotta · Painel do dono<span>Horário de Brasília</span></footer></div></div>;
}
export function PlatformShell({ children, owner }: { children: ReactNode; owner: OwnerProfile }) { return <NoticeProvider><Shell owner={owner}>{children}</Shell></NoticeProvider>; }
