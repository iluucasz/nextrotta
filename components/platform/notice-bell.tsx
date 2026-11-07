'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { api } from './api';
import './notice-inbox.css';

type Summary = { bySeverity: { critical: number; warning: number; success: number; info: number }; unread: number };

/** The bell in the panel's header: unread notices for this person, red when something critical is waiting. */
export function NoticeBell() {
  const [summary, setSummary] = useState<Summary | null>(null);

  const load = useCallback(async (check: boolean) => {
    try {
      // `check` also lets the platform checks run (the server only starts them every so often, and only in production).
      const data = await api<{ summary: Summary }>(`/notices?summary=1${check ? '&check=1' : ''}`);
      setSummary(data.summary);
    } catch {
      // A bell that cannot load stays quiet: the inbox itself shows the error.
    }
  }, []);

  useEffect(() => {
    void load(true);
    const timer = setInterval(() => void load(true), 60_000);
    const changed = () => void load(false);
    window.addEventListener('nr-notices-changed', changed);
    return () => {
      clearInterval(timer);
      window.removeEventListener('nr-notices-changed', changed);
    };
  }, [load]);

  const unread = summary?.unread ?? 0;
  const urgent = (summary?.bySeverity.critical ?? 0) > 0;
  return (
    <Link
      href="/plataforma/notificacoes"
      className={`nr-bell ${urgent ? 'urgent' : ''}`}
      aria-label={unread ? `Notificações: ${unread} não lida${unread > 1 ? 's' : ''}` : 'Notificações'}
      title="Notificações"
    >
      <Bell size={18} />
      {unread > 0 && <b>{unread > 99 ? '99+' : unread}</b>}
    </Link>
  );
}
