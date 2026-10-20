'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ChevronDown, LoaderCircle, LogOut, Settings2, UserRound } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export type OwnerProfile = { name: string; email: string };

/** The owner's profile in the header: one button that opens settings, account and sign-out. */
export function ProfileMenu({ owner, active }: { owner: OwnerProfile; active: boolean }) {
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState('');
  const initial = owner.name.trim()[0]?.toUpperCase() ?? 'D';

  async function logout() {
    setLeaving(true);
    setError('');
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' });
      if (!response.ok) throw new Error('logout');
      window.location.assign('/login');
    } catch {
      setLeaving(false);
      setError('Não foi possível sair. Tente novamente.');
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger className="nr-profile-trigger" data-active={active || undefined} aria-label="Abrir menu do perfil">
          <span className="nr-profile-avatar">{initial}</span>
          <span className="nr-profile-text">
            {owner.name}
            <small>Dono da plataforma</small>
          </span>
          <ChevronDown size={16} className="nr-profile-chevron" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={8} className="nr-profile-menu">
          <div className="nr-profile-menu-head">
            <span className="nr-profile-avatar">{initial}</span>
            <span>
              {owner.name}
              <small>{owner.email}</small>
            </span>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/plataforma/configuracoes">
              <Settings2 size={17} />
              Configurações da plataforma
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/plataforma/configuracoes?aba=conta">
              <UserRound size={17} />
              Minha conta e senha
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="nr-profile-logout"
            disabled={leaving}
            onSelect={(event) => {
              event.preventDefault();
              void logout();
            }}
          >
            {leaving ? <LoaderCircle size={17} className="animate-spin" /> : <LogOut size={17} />}
            {leaving ? 'Saindo…' : 'Sair'}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {error && (
        <span role="alert" className="nr-error">
          {error}
        </span>
      )}
    </>
  );
}
