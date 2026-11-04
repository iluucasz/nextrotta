'use client';

import { useEffect, useState } from 'react';
import { KeyRound, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MODAL_BODY_CLASS, MODAL_DESCRIPTION_CLASS, MODAL_FOOTER_CLASS, MODAL_HEADER_CLASS, MODAL_TITLE_CLASS, ModalNotice } from '@/components/modal-kit';
import { cn } from '@/lib/utils';

const MIN_LENGTH = 8;

// Kept for the session: the menu is rebuilt on every page, and the question is asked until it is answered.
let cleared = false;

/**
 * After the platform owner resets a password (or creates an admin), the password the person has is temporary. Until they
 * choose their own, this window stays open and can't be dismissed. It waits for `enabled`, so the terms window
 * ("Antes de continuar") always comes first.
 */
export function PasswordGate({ enabled }: { enabled: boolean }) {
  const [required, setRequired] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!enabled || cleared) return;
    let active = true;
    fetch('/api/auth/password', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) return;
        const data = await response.json();
        if (!active) return;
        if (data.mustChange) setRequired(true);
        else cleared = true;
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [enabled]);

  if (!enabled || !required) return null;

  const tooShort = password.length > 0 && password.length < MIN_LENGTH;
  const mismatch = confirm.length > 0 && confirm !== password;
  const ready = password.length >= MIN_LENGTH && confirm === password;

  async function save() {
    if (!ready) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/auth/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword: password }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || 'Não foi possível salvar a nova senha.');
      cleared = true;
      setRequired(false);
      setPassword('');
      setConfirm('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível salvar a nova senha.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md" onInteractOutside={(event) => event.preventDefault()} onEscapeKeyDown={(event) => event.preventDefault()} showCloseButton={false}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <DialogHeader className={MODAL_HEADER_CLASS}>
            <DialogTitle className={cn(MODAL_TITLE_CLASS, 'flex items-center gap-2')}>
              <KeyRound className="h-5 w-5 text-primary" />
              Defina sua nova senha
            </DialogTitle>
            <DialogDescription className={MODAL_DESCRIPTION_CLASS}>
              Você entrou com uma senha temporária. Escolha uma senha só sua para continuar.
            </DialogDescription>
          </DialogHeader>
          <div className={cn(MODAL_BODY_CLASS, 'space-y-4')}>
            <div className="space-y-1.5">
              <Label htmlFor="new-password">Nova senha</Label>
              <Input id="new-password" type="password" autoComplete="new-password" autoFocus value={password} onChange={(event) => setPassword(event.target.value)} />
              <p className={cn('text-xs', tooShort ? 'text-destructive' : 'text-muted-foreground')}>Mínimo de {MIN_LENGTH} caracteres.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm-password">Repita a nova senha</Label>
              <Input id="confirm-password" type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} />
              {mismatch ? <p className="text-xs text-destructive">As senhas não são iguais.</p> : null}
            </div>
            {error ? <ModalNotice tone="error">{error}</ModalNotice> : null}
          </div>
          <DialogFooter className={cn(MODAL_FOOTER_CLASS, 'sm:justify-end')}>
            <Button type="submit" disabled={!ready || busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Salvar e continuar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
