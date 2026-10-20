'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, ImageOff, Keyboard, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export const inputClassName =
  'min-h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none transition focus:ring-2 focus:ring-ring disabled:opacity-60';

/** inputClassName with overrides that win (e.g. 'w-auto', 'pl-9'). */
export function inputClass(extra: string) {
  return cn(inputClassName, extra);
}

/** fetch + JSON; throws an Error with the API's message. */
export async function partsApi<T = Record<string, unknown>>(url: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const response = await fetch(url, {
    cache: 'no-store',
    ...rest,
    ...(json !== undefined ? { body: JSON.stringify(json), headers: { 'Content-Type': 'application/json', ...(rest.headers ?? {}) } } : {}),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String((body as { error?: string }).error ?? `Erro ${response.status}`));
  return body as T;
}

/** Loads a GET endpoint; `reload()` fetches again. */
export function useParts<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(Boolean(url));
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!url) return;
    let active = true;
    setLoading(true);
    partsApi<T>(url)
      .then((body) => {
        if (!active) return;
        setData(body);
        setError('');
      })
      .catch((reason: Error) => active && setError(reason.message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [url, version]);

  const reload = useCallback(() => setVersion((value) => value + 1), []);
  return { data, error, loading, reload, setData };
}

export function Alert({ tone = 'danger', children, className }: { tone?: 'danger' | 'success' | 'warning' | 'info'; children: React.ReactNode; className?: string }) {
  const tones = {
    danger: 'border-rose-200 bg-rose-50 text-rose-900',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    warning: 'border-amber-200 bg-amber-50 text-amber-950',
    info: 'border-sky-200 bg-sky-50 text-sky-900',
  };
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cn('whitespace-pre-line rounded-lg border px-3 py-2 text-sm', tones[tone], className)}>
      {children}
    </div>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn('grid gap-1.5 text-sm', className)}>
      <span className="font-medium text-foreground">{label}</span>
      {children}
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

export function PartImage({ src, alt, className }: { src: string | null; alt: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div className={cn('flex shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground', className ?? 'h-12 w-12')}>
        <ImageOff className="h-4 w-4" aria-hidden />
        <span className="sr-only">Sem imagem</span>
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} className={cn('shrink-0 rounded-md bg-muted object-cover', className ?? 'h-12 w-12')} />;
}

/** Shrinks a photo to at most `max` px and JPEG, so a phone picture costs ~100 KB of storage. */
export async function resizeImage(file: File, max = 800): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob ?? file), 'image/jpeg', 0.82));
}

type DetectorLike = { detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>> };

const DETECTOR_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code'];
type DetectorConstructor = new (options?: { formats?: string[] }) => DetectorLike;

/**
 * The browser's own BarcodeDetector (Chrome on Android/macOS) or, where it doesn't exist (Chrome on
 * Windows, Safari, Firefox), the ZXing WebAssembly ponyfill, loaded only when needed.
 */
async function createDetector(): Promise<DetectorLike | null> {
  try {
    let Detector = (globalThis as unknown as { BarcodeDetector?: DetectorConstructor }).BarcodeDetector;
    if (!Detector) {
      Detector = (await import('barcode-detector/ponyfill')).BarcodeDetector as unknown as DetectorConstructor;
    }
    return new Detector({ formats: DETECTOR_FORMATS });
  } catch {
    return null;
  }
}

/** Whether the page can open a camera (needs a camera and a secure context: https or localhost). */
export function cameraScanSupported() {
  return typeof window !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
}

/**
 * Reads barcodes with the camera (continuous: each new code calls onDetect; the same code needs
 * 1.5 s before counting again) and always offers typing — which is also how USB/Bluetooth readers
 * work (they type the code and press Enter).
 */
export function BarcodeScanner({
  onDetect,
  onClose,
  continuous = false,
  title = 'Ler código de barras',
  showClose = true,
}: {
  onDetect: (code: string) => void | Promise<void>;
  onClose: () => void;
  continuous?: boolean;
  title?: string;
  /** False inside a dialog, which already has its own close button. */
  showClose?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [mode, setMode] = useState<'camera' | 'typing'>(cameraScanSupported() ? 'camera' : 'typing');
  const [cameraError, setCameraError] = useState('');
  const [typed, setTyped] = useState('');
  const lastRead = useRef<{ code: string; at: number }>({ code: '', at: 0 });
  const onDetectRef = useRef(onDetect);
  onDetectRef.current = onDetect;

  useEffect(() => {
    if (mode !== 'camera') return;
    let stream: MediaStream | null = null;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const start = async () => {
      const detector = await createDetector();
      if (stopped) return;
      if (!detector) {
        setCameraError('Não foi possível carregar o leitor de código de barras. Digite o código.');
        setMode('typing');
        return;
      }

      const tick = async () => {
        if (stopped) return;
        const video = videoRef.current;
        if (video && video.readyState >= 2) {
          try {
            const codes = await detector.detect(video);
            const code = codes[0]?.rawValue?.trim();
            const now = Date.now();
            if (code && (code !== lastRead.current.code || now - lastRead.current.at > 1500)) {
              lastRead.current = { code, at: now };
              navigator.vibrate?.(60);
              await onDetectRef.current(code);
              if (!continuous) return;
            }
          } catch {
            // A frame that couldn't be read: try the next one.
          }
        }
        timer = setTimeout(tick, 200);
      };

      navigator.mediaDevices
        .getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
        .then((media) => {
          if (stopped) {
            media.getTracks().forEach((track) => track.stop());
            return;
          }
          stream = media;
          if (videoRef.current) {
            videoRef.current.srcObject = media;
            void videoRef.current.play().catch(() => undefined);
          }
          tick();
        })
        .catch(() => {
          setCameraError('Não foi possível abrir a câmera. Permita o acesso à câmera ou digite o código.');
          setMode('typing');
        });
    };

    void start();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [mode, continuous]);

  async function submitTyped(event: React.FormEvent) {
    event.preventDefault();
    const code = typed.trim();
    if (!code) return;
    setTyped('');
    await onDetect(code);
  }

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">{title}</p>
        {showClose ? (
          <Button type="button" size="sm" variant="ghost" onClick={onClose} aria-label="Fechar leitor">
            <X className="h-4 w-4" />
          </Button>
        ) : null}
      </div>
      {mode === 'camera' ? (
        <div className="relative overflow-hidden rounded-lg bg-black">
          <video ref={videoRef} playsInline muted className="aspect-[4/3] w-full object-cover" />
          <div className="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 -translate-y-1/2 bg-rose-500/80" />
          <p className="absolute inset-x-0 bottom-2 text-center text-xs text-white/90">Aponte para o código de barras</p>
        </div>
      ) : null}
      {cameraError ? <Alert tone="warning">{cameraError}</Alert> : null}
      {!cameraScanSupported() && !cameraError ? (
        <p className="text-xs text-muted-foreground">
          Este navegador não lê código pela câmera. Digite o código ou use um leitor USB/Bluetooth.
        </p>
      ) : null}
      <form onSubmit={submitTyped} className="flex gap-2">
        <input
          className={inputClassName}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          placeholder="Digite ou leia o código"
          inputMode="numeric"
          autoFocus={mode === 'typing'}
          aria-label="Código de barras"
        />
        <Button type="submit" variant="outline">
          OK
        </Button>
      </form>
      {cameraScanSupported() ? (
        <Button type="button" variant="ghost" size="sm" onClick={() => setMode(mode === 'camera' ? 'typing' : 'camera')}>
          {mode === 'camera' ? <Keyboard className="h-4 w-4" /> : <Camera className="h-4 w-4" />}
          {mode === 'camera' ? 'Digitar o código' : 'Usar a câmera'}
        </Button>
      ) : null}
    </div>
  );
}

export function Spinner({ label = 'Carregando...' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label}
    </div>
  );
}

export function currentMonthKey() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
  return `${parts.find((part) => part.type === 'year')?.value}-${parts.find((part) => part.type === 'month')?.value}`;
}

export function formatDateTime(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
}
