'use client';

import { FormEvent, useEffect, useState } from 'react';
import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail, ShieldCheck } from 'lucide-react';
import { BrandLogo } from '@/components/brand-logo';
import Link from 'next/link';
import '@/components/site/login.css';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [recoverySent, setRecoverySent] = useState(false);

  // The organization subdomain sends people back here when a login link is invalid or expired.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('erro') === 'link') {
      setError('O link de acesso expirou. Entre novamente.');
    }
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setLoading(true);
    let redirecting = false;

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const contentType = response.headers.get('content-type') || '';
        const data = contentType.includes('application/json') ? await response.json() : null;
        setError(data?.error || 'Não foi possível entrar.');
        return;
      }

      // Organization users land on their company's subdomain; the platform owner on the panel.
      const data = await response.json();
      redirecting = true;
      setIsRedirecting(true);
      window.location.assign(data.redirectTo);
    } catch (loginError) {
      console.error('[login] error:', loginError);
      setError('Erro ao conectar. Tente novamente.');
    } finally {
      if (!redirecting) setLoading(false);
    }
  }

  return (
    <main className="nr-login">
      <div className="nr-login-brand">
        <Link href="/" className="nr-login-logo" aria-label="NextRotta, início"><BrandLogo className="nr-logo" accent="#6fd3a8" /></Link>
        <div><span className="nr-login-eyebrow">SEU PRÓXIMO PASSO COMEÇA AQUI</span><h2>Sua equipe em campo.<br /><span>Você no controle.</span></h2><p>Mais clareza para decidir. Mais tempo para crescer.<br />Toda a sua operação, conectada.</p><div className="nr-login-route" aria-hidden="true"><i /><span /><i /><span /><i /></div></div>
        <p className="nr-login-security"><ShieldCheck size={16} />Seus dados são seus. Sempre.</p>
      </div>
      <div className="nr-login-form-area">
      <Link href="/" className="nr-login-back">← Voltar ao site</Link>
      <section className="nr-login-card">
        <div className="mb-8">
          <p className="nr-login-eyebrow">BEM-VINDO AO NEXTROTTA</p>
          <h1 className="mt-3 text-3xl font-semibold">{forgot ? 'Recuperar acesso' : 'Bom ter você por aqui.'}</h1>
          <p className="mt-3 text-sm text-muted-foreground">{forgot ? 'Informe o e-mail usado na sua conta.' : 'Entre para acompanhar a operação da sua empresa.'}</p>
        </div>

        {error && !forgot ? <div role="alert" className="mb-4 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div> : null}

        {forgot ? <form className="space-y-4" onSubmit={e => { e.preventDefault(); setRecoverySent(true); }}>{recoverySent ? <div role="status" className="nr-login-recovery"><strong>Confira sua caixa de entrada.</strong><p>Na versão integrada, você receberá um link para criar uma nova senha. Esta é uma prévia visual; nenhum e-mail foi enviado.</p></div> : <><label className="block text-sm">E-mail<input className="nr-login-input" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} /></label><button className="nr-login-submit" type="submit">Solicitar link de recuperação<ArrowRight size={16} /></button></>}<button type="button" className="nr-login-forgot" onClick={() => { setForgot(false); setRecoverySent(false); }}>Voltar ao login</button></form> : <form onSubmit={handleSubmit} className="space-y-5">
          <label className="block text-sm">
            <span className="mb-2 block font-medium">E-mail</span>
            <div className="flex min-h-11 items-center gap-2 rounded-md border border-input bg-background px-3 focus-within:ring-2 focus-within:ring-ring">
              <Mail className="h-4 w-4 text-muted-foreground" />
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder="voce@empresa.com.br" className="w-full bg-transparent outline-none" required />
            </div>
          </label>
          <label className="block text-sm">
            <span className="mb-2 flex justify-between font-medium">Senha<button type="button" className="nr-login-forgot" onClick={() => setForgot(true)}>Esqueci minha senha</button></span>
            <div className="flex min-h-11 items-center gap-2 rounded-md border border-input bg-background px-3 focus-within:ring-2 focus-within:ring-ring">
              <LockKeyhole className="h-4 w-4 text-muted-foreground" />
              <input type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" placeholder="sua senha" className="w-full bg-transparent outline-none" required />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                aria-pressed={showPassword}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </label>
          <button type="submit" disabled={loading} className="nr-login-submit">
            {isRedirecting ? 'Redirecionando…' : loading ? 'Entrando…' : 'Entrar no sistema'}<ArrowRight size={16} />
          </button>
        </form>}

        <p className="mt-7 text-center text-xs text-muted-foreground">O acesso é liberado pelo administrador da plataforma.<br /><Link href="/contato" className="nr-login-forgot">Ainda não conhece o NextRotta? Fale com a gente.</Link></p>
      </section>
      </div>
    </main>
  );
}
