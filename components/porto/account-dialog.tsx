'use client';

import { useState } from 'react';
import { CheckCircle2, KeyRound, Loader2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { MODAL_BODY_CLASS, MODAL_DESCRIPTION_CLASS, MODAL_FOOTER_CLASS, MODAL_HEADER_CLASS, MODAL_TITLE_CLASS, ModalNotice } from '@/components/modal-kit';
import { cn } from '@/lib/utils';
import type { LoginResult, PortoApi } from './use-porto';

const inputClass = 'h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20';

/** "123.456.789-01" while typing, whatever the person pastes. */
const formatCpf = (value: string) => {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  return digits.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
};

/**
 * The CPF and the password of the Portal do Prestador. "Salvar e testar" saves and tries the login at once, so the
 * person leaves the window knowing whether it works instead of finding out on the next night's run.
 */
export function AccountDialog({ api, onClose, onSaved }: { api: PortoApi; onClose: () => void; onSaved: (message: string) => void }) {
  const hasPassword = api.config.has_password;
  const [cpf, setCpf] = useState(formatCpf(api.config.cpf));
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<LoginResult | null>(null);

  async function submit() {
    setError('');
    setResult(null);
    const digits = cpf.replace(/\D/g, '');
    if (digits.length !== 11) return setError('Informe o CPF com 11 números.');
    if (!hasPassword && !password) return setError('Informe a senha do Porto.');

    setBusy(true);
    try {
      await api.save({ cpf: digits, password });
      const login = await api.testLogin();
      setResult(login);
      if (login.success) onSaved('Conta conectada. O login no Porto funcionou.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível salvar.');
    } finally {
      setBusy(false);
    }
  }

  const connected = result?.success === true;

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md">
        <DialogHeader className={MODAL_HEADER_CLASS}>
          <DialogTitle className={MODAL_TITLE_CLASS}>{hasPassword ? 'Conta do Porto' : 'Conectar a conta do Porto'}</DialogTitle>
          <DialogDescription className={MODAL_DESCRIPTION_CLASS}>O CPF e a senha que você usa para entrar no Portal do Prestador. A senha fica guardada com criptografia.</DialogDescription>
        </DialogHeader>

        <div className={cn(MODAL_BODY_CLASS, 'space-y-4')}>
          {error ? <ModalNotice tone="error">{error}</ModalNotice> : null}
          {result ? (
            <ModalNotice tone={connected ? 'success' : 'error'}>
              <span className="flex items-start gap-2">
                {connected ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" />}
                <span>
                  {connected ? 'O login no Porto funcionou.' : result.message}
                  {!connected && result.screenshotUrl ? (
                    <>
                      {' '}
                      <a href={result.screenshotUrl} target="_blank" rel="noreferrer" className="underline">
                        Ver a tela do Porto
                      </a>
                    </>
                  ) : null}
                </span>
              </span>
            </ModalNotice>
          ) : null}

          <div>
            <label htmlFor="porto-cpf" className="mb-1.5 block text-sm font-medium">
              CPF
            </label>
            <input id="porto-cpf" inputMode="numeric" autoComplete="off" value={cpf} onChange={(event) => setCpf(formatCpf(event.target.value))} placeholder="000.000.000-00" className={inputClass} />
          </div>
          <div>
            <label htmlFor="porto-password" className="mb-1.5 block text-sm font-medium">
              Senha
            </label>
            <div className="relative">
              <input
                id="porto-password"
                type={reveal ? 'text' : 'password'}
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={hasPassword ? 'Deixe em branco para manter a atual' : 'A senha do Portal do Prestador'}
                className={cn(inputClass, 'pr-20')}
              />
              <button type="button" onClick={() => setReveal((value) => !value)} className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-primary hover:underline">
                {reveal ? 'Ocultar' : 'Mostrar'}
              </button>
            </div>
          </div>
        </div>

        <DialogFooter className={cn(MODAL_FOOTER_CLASS, 'flex-col-reverse sm:flex-row sm:justify-end')}>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {connected ? 'Fechar' : 'Cancelar'}
          </Button>
          {!connected ? (
            <Button type="button" onClick={submit} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
              {busy ? 'Entrando no Porto…' : 'Salvar e testar o login'}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
