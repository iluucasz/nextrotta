import { AppShell } from './app-shell';

interface SidebarProps {
  role: 'admin' | 'technician';
  userName?: string;
  children?: React.ReactNode;
}

export function Sidebar({ role, userName, children }: SidebarProps) {
  return (
    <AppShell role={role} userName={userName}>
      {children}
    </AppShell>
  );
}
