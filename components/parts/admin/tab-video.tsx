'use client';

import { useEffect, useRef, useState } from 'react';
import { Maximize, Minimize, Pause, Play, RotateCcw, Settings, Volume2, VolumeX, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

/**
 * One tutorial per tab of Venda de Peças (YouTube, unlisted). Keys are the tab values of the admin page.
 * An empty `id` hides the "Ver vídeo" button of that tab: NextRotta has no tutorial videos yet (the ones
 * of the Central Operacional show another brand), so fill the ids in as they are recorded.
 */
const TAB_VIDEOS: Record<string, { id: string; label: string }> = {
  overview: { id: '', label: 'Resumo' },
  sales: { id: '', label: 'Vendas' },
  catalog: { id: '', label: 'Peças' },
  movements: { id: '', label: 'Movimentações' },
  technicians: { id: '', label: 'Técnicos' },
  inventory: { id: '', label: 'Inventário' },
  account: { id: '', label: 'Acerto' },
  finance: { id: '', label: 'Financeiro' },
  settings: { id: '', label: 'Ajustes' },
};

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

// ---------------------------------------------------------------- YouTube IFrame API (just what the player needs)

interface YouTubePlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  mute(): void;
  unMute(): void;
  setPlaybackRate(rate: number): void;
  destroy(): void;
}

interface YouTubeApi {
  Player: new (
    element: HTMLElement,
    options: {
      videoId: string;
      host?: string;
      width?: string;
      height?: string;
      playerVars?: Record<string, string | number>;
      events?: { onReady?: (event: { target: YouTubePlayer }) => void; onStateChange?: (event: { data: number }) => void; onError?: (event: { data: number }) => void };
    },
  ) => YouTubePlayer;
}

declare global {
  interface Window {
    YT?: YouTubeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YouTubeApi> | null = null;

/** Loads the IFrame API once for the whole page. */
function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  apiPromise ??= new Promise<YouTubeApi>((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT) resolve(window.YT);
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = () => {
      apiPromise = null;
      reject(new Error('Não foi possível carregar o player de vídeo.'));
    };
    document.head.appendChild(script);
  });
  return apiPromise;
}

function formatTime(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- player

/**
 * A player with our own controls (play, progress line, volume, speed, full screen) on top of the YouTube
 * IFrame API. YouTube's own controls are turned off, so there is no title, channel, share or "watch on
 * YouTube" in the way. The frame is taller than the visible box and shifted up, so whatever YouTube draws
 * over the top of a video (title, channel) falls outside the box and is clipped.
 */
function VideoPlayer({ videoId, vertical = false, onUnavailable }: { videoId: string; vertical?: boolean; onUnavailable?: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YouTubePlayer | null>(null);
  const [ready, setReady] = useState(false);
  const [started, setStarted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [menuOpen, setMenuOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [failed, setFailed] = useState('');

  const onUnavailableRef = useRef(onUnavailable);
  onUnavailableRef.current = onUnavailable;

  useEffect(() => {
    let cancelled = false;
    const mount = mountRef.current;
    if (!mount) return;
    const host = document.createElement('div');
    mount.appendChild(host);
    // A new video starts from zero (the player is rebuilt when the video changes).
    setReady(false);
    setStarted(false);
    setPlaying(false);
    setEnded(false);
    setCurrent(0);
    setDuration(0);
    setFailed('');

    loadYouTubeApi()
      .then((YT) => {
        if (cancelled) return;
        new YT.Player(host, {
          videoId,
          host: 'https://www.youtube-nocookie.com',
          width: '100%',
          height: '100%',
          playerVars: { controls: 0, rel: 0, modestbranding: 1, iv_load_policy: 3, playsinline: 1, disablekb: 1, fs: 0, autoplay: 1, origin: window.location.origin },
          events: {
            onReady: (event) => {
              if (cancelled) return;
              playerRef.current = event.target;
              setDuration(event.target.getDuration());
              setReady(true);
              event.target.playVideo();
            },
            onStateChange: (event) => {
              if (cancelled) return;
              if (event.data === 1) {
                setStarted(true);
                setPlaying(true);
                setEnded(false);
              } else if (event.data === 2) {
                setPlaying(false);
              } else if (event.data === 0) {
                setPlaying(false);
                setEnded(true);
              }
            },
            // 100 (not found or private), 101/150 (the owner does not allow embedding), 2/5 (bad id, player error).
            onError: () => {
              if (cancelled) return;
              if (onUnavailableRef.current) onUnavailableRef.current();
              else setFailed('Não foi possível carregar este vídeo agora. Tente de novo mais tarde.');
            },
          },
        });
      })
      .catch((reason) => !cancelled && setFailed(reason instanceof Error ? reason.message : String(reason)));

    return () => {
      cancelled = true;
      try {
        playerRef.current?.destroy();
      } catch {
        // the frame may already be gone
      }
      playerRef.current = null;
      mount.innerHTML = '';
    };
  }, [videoId]);

  // The progress line follows the player while it is ready.
  useEffect(() => {
    if (!ready) return;
    const timer = setInterval(() => {
      const player = playerRef.current;
      if (!player) return;
      setCurrent(player.getCurrentTime());
      const length = player.getDuration();
      if (length) setDuration(length);
    }, 250);
    return () => clearInterval(timer);
  }, [ready]);

  useEffect(() => {
    const sync = () => setFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  function togglePlay() {
    const player = playerRef.current;
    if (!player) return;
    setMenuOpen(false);
    if (ended) {
      player.seekTo(0, true);
      player.playVideo();
    } else if (playing) {
      player.pauseVideo();
    } else {
      player.playVideo();
    }
  }

  function seek(value: number) {
    playerRef.current?.seekTo(value, true);
    setCurrent(value);
    setEnded(false);
  }

  function toggleMute() {
    const player = playerRef.current;
    if (!player) return;
    if (muted) player.unMute();
    else player.mute();
    setMuted(!muted);
  }

  function changeSpeed(value: number) {
    playerRef.current?.setPlaybackRate(value);
    setSpeed(value);
    setMenuOpen(false);
  }

  function toggleFullscreen() {
    const container = containerRef.current;
    if (!container) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void container.requestFullscreen?.();
  }

  const covered = !started || !playing; // loading, paused or ended: hide what YouTube draws then
  const controlsHeight = '3.25rem';

  return (
    <div ref={containerRef} className={cn('flex w-full flex-col bg-black', fullscreen && 'h-screen justify-center')}>
      <div
        className={cn('relative mx-auto w-full overflow-hidden bg-black', vertical ? 'aspect-9/16' : 'aspect-video')}
        style={
          fullscreen
            ? { width: `min(100vw, calc((100vh - ${controlsHeight}) * ${vertical ? '9 / 16' : '16 / 9'}))` }
            : // a vertical video must fit the screen's height too (window header and controls take about 7 rem)
              vertical
              ? { maxWidth: 'calc((100dvh - 9rem) * 9 / 16)' }
              : undefined
        }
      >
        <div
          ref={mountRef}
          className="pointer-events-none absolute left-0 w-full [&_iframe]:h-full [&_iframe]:w-full"
          style={{ top: '-30%', height: '160%' }}
          aria-hidden="true"
        />
        <button
          type="button"
          onClick={togglePlay}
          disabled={!ready}
          aria-label={ended ? 'Assistir de novo' : playing ? 'Pausar' : 'Reproduzir'}
          className={cn('absolute inset-0 grid place-content-center transition', covered ? (started ? 'bg-black/55 backdrop-blur-2xl' : 'bg-black') : 'bg-transparent')}
        >
          {failed ? (
            <span className="max-w-xs px-4 text-center text-sm text-white/80">{failed}</span>
          ) : !started && !ready ? (
            <span className="text-sm text-white/70">Carregando vídeo…</span>
          ) : covered ? (
            <span className="grid h-16 w-16 place-content-center rounded-full bg-white/95 text-[#211f32] shadow-lg">
              {ended ? <RotateCcw className="h-7 w-7" /> : <Play className="h-7 w-7 translate-x-0.5" />}
            </span>
          ) : null}
        </button>
      </div>

      <div className="relative flex items-center gap-2 bg-[#211f32] px-3 text-white" style={{ height: controlsHeight }}>
        <button type="button" onClick={togglePlay} disabled={!ready} aria-label={playing ? 'Pausar' : 'Reproduzir'} className="grid h-9 w-9 shrink-0 place-content-center rounded-md hover:bg-white/10 disabled:opacity-40">
          {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
        </button>
        <span className="w-10 shrink-0 text-right text-xs tabular-nums text-white/80">{formatTime(current)}</span>
        <input
          type="range"
          min={0}
          max={duration || 1}
          step={0.1}
          value={Math.min(current, duration || 1)}
          onChange={(event) => seek(Number(event.target.value))}
          disabled={!ready}
          aria-label="Posição do vídeo"
          className="h-1.5 min-w-0 flex-1 cursor-pointer accent-[#7161ef] disabled:opacity-40"
        />
        <span className="w-10 shrink-0 text-xs tabular-nums text-white/60">{formatTime(duration)}</span>
        <button type="button" onClick={toggleMute} disabled={!ready} aria-label={muted ? 'Ativar o som' : 'Silenciar'} className="grid h-9 w-9 shrink-0 place-content-center rounded-md hover:bg-white/10 disabled:opacity-40">
          {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
        </button>
        <div className="relative shrink-0">
          <button type="button" onClick={() => setMenuOpen((value) => !value)} disabled={!ready} aria-label="Configurações" aria-expanded={menuOpen} className="grid h-9 w-9 place-content-center rounded-md hover:bg-white/10 disabled:opacity-40">
            <Settings className="h-5 w-5" />
          </button>
          {menuOpen ? (
            <div role="menu" aria-label="Velocidade" className="absolute right-0 bottom-11 z-10 w-40 rounded-lg border border-white/10 bg-[#2b2940] p-1 text-sm shadow-xl">
              <p className="px-3 py-1.5 text-xs text-white/60">Velocidade</p>
              {SPEEDS.map((value) => (
                <button
                  key={value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={speed === value}
                  onClick={() => changeSpeed(value)}
                  className={cn('flex w-full items-center justify-between rounded-md px-3 py-1.5 text-left hover:bg-white/10', speed === value && 'font-semibold text-[#b7aefc]')}
                >
                  {value === 1 ? 'Normal' : `${String(value).replace('.', ',')}x`}
                  {speed === value ? <span aria-hidden="true">✓</span> : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <button type="button" onClick={toggleFullscreen} aria-label={fullscreen ? 'Sair da tela cheia' : 'Tela cheia'} className="grid h-9 w-9 shrink-0 place-content-center rounded-md hover:bg-white/10">
          {fullscreen ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- button + modal

/** The tutorial of the technician's "Minhas peças" screen: one video for the computer and a vertical one for phones. Empty hides the button. */
const TECHNICIAN_VIDEO = { desktop: '', mobile: '' };

/**
 * A "Ver vídeo" button that opens a tutorial in a modal. The player is only created while the modal is open, so
 * nothing is loaded from YouTube until someone asks for it, and closing the modal stops the video.
 * With a `mobile` video, phones (narrow screens) get that one, in a vertical player.
 */
function VideoModalButton({ title, description, desktop, mobile }: { title: string; description: string; desktop: string; mobile?: string }) {
  const [open, setOpen] = useState(false);
  const [vertical, setVertical] = useState(false);

  function show() {
    setVertical(Boolean(mobile) && window.matchMedia('(max-width: 767px)').matches);
    setOpen(true);
  }

  return (
    <>
      <Button type="button" variant="outline" size="lg" onClick={show}>
        <Play className="h-4 w-4" />
        Ver vídeo
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent showCloseButton={false} className={cn('w-full grid-cols-[minmax(0,1fr)] gap-0 overflow-hidden border-0 bg-black p-0', vertical ? 'sm:max-w-md' : 'sm:max-w-4xl')}>
          <div className="flex items-center justify-between gap-3 bg-[#211f32] px-4 py-3 text-white">
            <DialogTitle className="text-sm font-semibold">{title}</DialogTitle>
            <DialogClose className="grid h-8 w-8 place-content-center rounded-md hover:bg-white/10" aria-label="Fechar vídeo">
              <X className="h-5 w-5" />
            </DialogClose>
          </div>
          <DialogDescription className="sr-only">{description}</DialogDescription>
          {/* If the vertical video cannot be shown (embedding turned off, removed), phones fall back to the other one. */}
          <VideoPlayer videoId={vertical && mobile ? mobile : desktop} vertical={vertical} onUnavailable={vertical ? () => setVertical(false) : undefined} />
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * The "Ver vídeo" button for the title bar of Venda de Peças (administrator): the tutorial of the current tab.
 * Render it with `key={tab}`.
 */
export function TabVideoButton({ tab }: { tab: string }) {
  const video = TAB_VIDEOS[tab];
  if (!video?.id) return null;
  return (
    <VideoModalButton
      title={`Como usar a aba ${video.label}`}
      description={`Vídeo curto que mostra, passo a passo, como usar a aba ${video.label} de Venda de Peças.`}
      desktop={video.id}
    />
  );
}

/** The "Ver vídeo" button for the title bar of the technician's "Minhas peças". */
export function TechnicianVideoButton() {
  if (!TECHNICIAN_VIDEO.desktop) return null;
  return (
    <VideoModalButton
      title="Como usar a área Minhas peças"
      description="Vídeo curto que mostra, passo a passo, como vender as peças do carro, acompanhar as vendas e ver a sua conta."
      desktop={TECHNICIAN_VIDEO.desktop}
      mobile={TECHNICIAN_VIDEO.mobile}
    />
  );
}
