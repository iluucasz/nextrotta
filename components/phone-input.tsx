'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, CircleAlert, Loader2, XCircle } from 'lucide-react';
import { formatPhoneInput, PHONE_EXAMPLE, toNationalDigits, validatePhone } from '@/lib/whatsapp/phone';

interface WhatsAppCheck {
  whatsapp: boolean | null;
  message: string;
}

// Per page load: re-typing a number already checked doesn't hit Evolution again.
const checkCache = new Map<string, WhatsAppCheck>();
const CHECK_DELAY_MS = 700;

interface PhoneInputProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  id?: string;
  /** Also ask Evolution whether the number has WhatsApp (admin screens only — the route is admin-only). */
  checkWhatsApp?: boolean;
  /** Hint under the field when there's nothing to report. Pass null to hide it. */
  hint?: React.ReactNode;
}

/**
 * Brazilian phone field. Accepts any way of typing it — `11979713590`, `+55 11 97971-3590`,
 * `(11) 97971 3590`, `011 97971-3590` — and shows it as `(11) 97971-3590`.
 */
export function PhoneInput({ value, onChange, className, id, checkWhatsApp = false, hint }: PhoneInputProps) {
  const [touched, setTouched] = useState(false);
  const [check, setCheck] = useState<WhatsAppCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const validation = validatePhone(value);
  const e164 = validation.status === 'valid' ? validation.e164 : null;

  useEffect(() => {
    setCheck(null);
    if (!checkWhatsApp || !e164) return;

    const cached = checkCache.get(e164);
    if (cached) {
      setCheck(cached);
      return;
    }

    let active = true;
    const timer = setTimeout(async () => {
      setChecking(true);
      try {
        const response = await fetch(`/api/whatsapp/check-number?phone=${encodeURIComponent(e164)}`);
        const data = await response.json().catch(() => null);
        const result: WhatsAppCheck = response.ok
          ? { whatsapp: data?.whatsapp ?? null, message: data?.message ?? '' }
          : { whatsapp: null, message: 'Não foi possível verificar no WhatsApp agora.' };

        // Only a definite answer is cached; a failed check should be retried next time.
        if (result.whatsapp !== null) checkCache.set(e164, result);
        if (active) setCheck(result);
      } catch {
        if (active) setCheck({ whatsapp: null, message: 'Não foi possível verificar no WhatsApp agora.' });
      } finally {
        if (active) setChecking(false);
      }
    }, CHECK_DELAY_MS);

    return () => {
      active = false;
      clearTimeout(timer);
      setChecking(false);
    };
  }, [checkWhatsApp, e164]);

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const raw = event.target.value;
    let digits = toNationalDigits(raw);

    // Backspacing over a mask character ("-", ")", " ") removes no digit, so the mask would put it
    // straight back and the cursor would feel stuck. Treat it as deleting the digit before it.
    if (raw.length < value.length && digits === toNationalDigits(value)) {
      digits = digits.slice(0, -1);
    }

    onChange(formatPhoneInput(digits));
  }

  const showProblem = (validation.status === 'invalid' || (validation.status === 'incomplete' && touched));

  let feedback: React.ReactNode = null;
  if (showProblem && 'message' in validation) {
    feedback = (
      <span className="flex items-start gap-1.5 text-rose-700">
        <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {validation.message}
      </span>
    );
  } else if (validation.status === 'valid' && checkWhatsApp) {
    if (checking) {
      feedback = (
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Verificando no WhatsApp...
        </span>
      );
    } else if (check?.whatsapp === true) {
      feedback = (
        <span className="flex items-center gap-1.5 text-emerald-700">
          <CheckCircle2 className="h-3.5 w-3.5" />
          {check.message}
        </span>
      );
    } else if (check) {
      feedback = (
        <span className={`flex items-start gap-1.5 ${check.whatsapp === false ? 'text-amber-700' : 'text-muted-foreground'}`}>
          <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {check.message}
        </span>
      );
    }
  }

  return (
    <>
      <input
        id={id}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        value={value}
        onChange={handleChange}
        onBlur={() => setTouched(true)}
        placeholder={PHONE_EXAMPLE}
        aria-invalid={showProblem || undefined}
        className={`${className ?? ''} ${showProblem ? 'border-rose-400 focus:ring-rose-300' : ''}`}
      />
      <span className="mt-1.5 block text-xs leading-5">
        {feedback ?? (hint === null ? null : <span className="text-muted-foreground">{hint ?? `Ex.: ${PHONE_EXAMPLE}. Pode digitar com ou sem +55, espaços ou traços.`}</span>)}
      </span>
    </>
  );
}
