'use client';

import { useEffect, useId, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Flame, ShieldAlert, Sparkles, Target, Trophy } from 'lucide-react';

interface ProgressGaugeProps {
  title: string;
  value: number;
  subtitle?: string;
  active?: boolean;
  onClick?: () => void;
  celebrationLevel?: 'goal' | 'mega';
  celebrationLabel?: string;
  /**
   * OS goals, ascending — Configurações → Prêmio por produção. The first is the gauge's target;
   * the last (when there are several) is the "turbo" one. Red/yellow bands sit at 50%/75% of the
   * target (40/60 for the original 80).
   */
  goals?: number[];
}

const DEFAULT_GOALS = [80, 160];
const COUNT_UP_DURATION = 6000;

type GaugeThresholds = { danger: number; warning: number; target: number; turbo: number };

function resolveThresholds(goals: number[]): GaugeThresholds {
  const sorted = [...goals].filter((goal) => goal > 0).sort((a, b) => a - b);
  const target = sorted[0] ?? DEFAULT_GOALS[0];
  return {
    danger: Math.round(target * 0.5),
    warning: Math.round(target * 0.75),
    target,
    turbo: sorted.length > 1 ? sorted[sorted.length - 1] : Number.POSITIVE_INFINITY,
  };
}

type GaugeTone = {
  label: string;
  icon: LucideIcon;
  accent: string;
  badgeClass: string;
  surfaceClass: string;
};

function pointOnArc(angle: number, radius: number) {
  const radians = Math.PI - (angle * Math.PI) / 180;

  return {
    x: 90 + radius * Math.cos(radians),
    y: 86 - radius * Math.sin(radians),
  };
}

function describeArc(startAngle: number, endAngle: number, radius: number) {
  const start = pointOnArc(startAngle, radius);
  const end = pointOnArc(endAngle, radius);
  const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';

  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

function easeOutCubic(progress: number) {
  return 1 - Math.pow(1 - progress, 3);
}

function getGaugeTone(value: number, thresholds: GaugeThresholds): GaugeTone {
  if (value < thresholds.danger) {
    return {
      label: 'Risco',
      icon: ShieldAlert,
      accent: '#ef4444',
      badgeClass: 'border-rose-200 bg-rose-100/90 text-rose-700',
      surfaceClass: 'bg-[radial-gradient(circle_at_top,rgba(254,226,226,0.88),transparent_62%)]',
    };
  }

  if (value < thresholds.warning) {
    return {
      label: 'Aquecendo',
      icon: Flame,
      accent: '#f59e0b',
      badgeClass: 'border-amber-200 bg-amber-100/90 text-amber-800',
      surfaceClass: 'bg-[radial-gradient(circle_at_top,rgba(254,243,199,0.88),transparent_62%)]',
    };
  }

  if (value < thresholds.target) {
    return {
      label: 'Reta final',
      icon: Target,
      accent: '#22c55e',
      badgeClass: 'border-emerald-200 bg-emerald-100/90 text-emerald-800',
      surfaceClass: 'bg-[radial-gradient(circle_at_top,rgba(220,252,231,0.9),transparent_62%)]',
    };
  }

  if (value < thresholds.turbo) {
    return {
      label: `Meta ${thresholds.target}`,
      icon: Trophy,
      accent: '#10b981',
      badgeClass: 'border-emerald-200 bg-emerald-100/90 text-emerald-800',
      surfaceClass: 'bg-[radial-gradient(circle_at_top,rgba(209,250,229,0.9),transparent_62%)]',
    };
  }

  return {
    label: 'Turbo',
    icon: Sparkles,
    accent: '#0f766e',
    badgeClass: 'border-teal-200 bg-teal-100/90 text-teal-900',
    surfaceClass: 'bg-[radial-gradient(circle_at_top,rgba(204,251,241,0.92),transparent_62%)]',
  };
}

const confettiPieces = [
  { left: '8%', top: '14%', delay: '0ms', className: 'bg-amber-300' },
  { left: '18%', top: '8%', delay: '180ms', className: 'bg-emerald-400' },
  { left: '30%', top: '12%', delay: '320ms', className: 'bg-sky-400' },
  { left: '44%', top: '5%', delay: '120ms', className: 'bg-rose-400' },
  { left: '58%', top: '10%', delay: '420ms', className: 'bg-lime-300' },
  { left: '70%', top: '6%', delay: '260ms', className: 'bg-amber-400' },
  { left: '82%', top: '12%', delay: '520ms', className: 'bg-emerald-300' },
  { left: '90%', top: '18%', delay: '360ms', className: 'bg-cyan-300' },
];

export function ProgressGauge({
  title,
  value,
  subtitle,
  active,
  onClick,
  celebrationLevel,
  celebrationLabel,
  goals = DEFAULT_GOALS,
}: ProgressGaugeProps) {
  const thresholds = resolveThresholds(goals);
  const goalBadges = [...goals].filter((goal) => goal > 0).sort((a, b) => a - b);
  const TARGET_THRESHOLD = thresholds.target;
  const DANGER_THRESHOLD = thresholds.danger;
  const WARNING_THRESHOLD = thresholds.warning;
  const normalizedValue = Math.max(value, 0);
  const [animatedValue, setAnimatedValue] = useState(0);
  const [showCelebration, setShowCelebration] = useState(false);
  const animatedNormalizedValue = Math.max(animatedValue, 0);
  const resolvedCelebration = celebrationLevel ?? (normalizedValue >= TARGET_THRESHOLD ? 'goal' : undefined);
  const shouldCelebrate = resolvedCelebration === 'goal' || resolvedCelebration === 'mega';
  const isGoalCelebration = showCelebration && shouldCelebrate;
  const isMegaCelebration = showCelebration && resolvedCelebration === 'mega';
  const clampedValue = Math.min(animatedNormalizedValue, TARGET_THRESHOLD);
  const currentAngle = (clampedValue / TARGET_THRESHOLD) * 180;
  const redAngle = (DANGER_THRESHOLD / TARGET_THRESHOLD) * 180;
  const greenStartAngle = (WARNING_THRESHOLD / TARGET_THRESHOLD) * 180;
  const pointerTip = pointOnArc(currentAngle, 48);
  const tone = getGaugeTone(normalizedValue, thresholds);
  const Icon = isGoalCelebration ? Sparkles : tone.icon;
  const gaugeId = useId().replace(/:/g, '');
  const progressPercent = Math.min((animatedNormalizedValue / TARGET_THRESHOLD) * 100, 100);
  const dangerStop = (DANGER_THRESHOLD / TARGET_THRESHOLD) * 100;
  const warningStop = (WARNING_THRESHOLD / TARGET_THRESHOLD) * 100;
  const gaugeProgressClip = `inset(0 ${100 - progressPercent}% 0 0)`;
  const progressGradient = `linear-gradient(90deg, #ef4444 0%, #f97316 ${dangerStop}%, #f59e0b ${dangerStop}%, #fbbf24 ${warningStop}%, #10b981 ${warningStop}%, #22c55e 100%)`;
  const displayValue = Math.round(animatedNormalizedValue);
  const displayProgress = Math.round(progressPercent);
  const celebrationText = celebrationLabel ?? '1Q e 2Q bateram a meta.';
  const visibleConfetti = isMegaCelebration ? confettiPieces : confettiPieces.slice(0, 4);

  useEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reduceMotion || normalizedValue === 0) {
      setAnimatedValue(normalizedValue);
      setShowCelebration(reduceMotion && normalizedValue > 0 && shouldCelebrate);
      return;
    }

    let frameId = 0;
    const startTime = performance.now();

    setAnimatedValue(0);
    setShowCelebration(false);

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / COUNT_UP_DURATION, 1);
      const easedProgress = easeOutCubic(progress);

      setAnimatedValue(normalizedValue * easedProgress);

      if (progress < 1) {
        frameId = requestAnimationFrame(animate);
      } else {
        setAnimatedValue(normalizedValue);
        setShowCelebration(shouldCelebrate);
      }
    };

    frameId = requestAnimationFrame(animate);

    return () => cancelAnimationFrame(frameId);
  }, [normalizedValue, shouldCelebrate]);

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative w-full rounded-2xl border p-4 text-left shadow-[0_14px_40px_rgba(15,23,42,0.08)] transition-all duration-300 ${
        isMegaCelebration
          ? 'gauge-mega-celebration overflow-visible border-orange-400/90 bg-[linear-gradient(180deg,rgba(255,247,237,0.98),rgba(255,255,255,0.96))] shadow-[0_22px_60px_rgba(249,115,22,0.24)]'
          : isGoalCelebration
            ? 'gauge-goal-celebration overflow-hidden border-emerald-300/80 bg-[linear-gradient(180deg,rgba(240,253,244,0.98),rgba(255,255,255,0.96))] shadow-[0_18px_48px_rgba(34,197,94,0.16)]'
          : 'overflow-hidden bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.98))]'
      } ${active ? 'border-primary ring-2 ring-primary/20' : 'border-border hover:-translate-y-1 hover:border-primary/50'}`}
    >
      <div className={`absolute inset-0 rounded-2xl opacity-90 transition-opacity duration-300 group-hover:opacity-100 ${tone.surfaceClass}`} />

      {isGoalCelebration
        ? visibleConfetti.map((piece, index) => (
            <span
              key={`${title}-${index}`}
              aria-hidden="true"
              className={`gauge-confetti-piece absolute z-20 h-3 w-1.5 rounded-full ${piece.className}`}
              style={{ left: piece.left, top: piece.top, animationDelay: piece.delay }}
            />
          ))
        : null}

      <div className="relative z-10 flex items-start justify-between gap-3">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-primary">{title}</p>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${
            isMegaCelebration
              ? 'gauge-badge-float border-orange-300 bg-orange-100/95 text-orange-950 shadow-[0_8px_18px_rgba(249,115,22,0.22)]'
              : isGoalCelebration
                ? 'gauge-badge-float border-emerald-300 bg-emerald-100/95 text-emerald-900'
                : tone.badgeClass
          }`}
        >
          <Icon className="h-3.5 w-3.5" />
          {isMegaCelebration ? 'Explodiu' : isGoalCelebration ? 'Parabens' : tone.label}
        </span>
      </div>

      <div className="relative z-10 mt-4">
        {isGoalCelebration ? <div className="gauge-ring absolute left-1/2 top-4 h-24 w-24 -translate-x-1/2 rounded-full border border-emerald-400/40" /> : null}
        <div className="flex justify-center">
          <svg viewBox="0 0 180 108" className="h-32 w-full max-w-60 drop-shadow-[0_10px_18px_rgba(15,23,42,0.12)]">
            <defs>
              <linearGradient id={`${gaugeId}-red`} x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#f87171" />
                <stop offset="100%" stopColor="#ef4444" />
              </linearGradient>
              <linearGradient id={`${gaugeId}-yellow`} x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#fbbf24" />
                <stop offset="100%" stopColor="#f59e0b" />
              </linearGradient>
              <linearGradient id={`${gaugeId}-green`} x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#34d399" />
                <stop offset="100%" stopColor="#0f766e" />
              </linearGradient>
            </defs>

            <path d={describeArc(0, 180, 66)} fill="none" stroke="rgba(148,163,184,0.16)" strokeWidth="16" strokeLinecap="round" />
            <path d={describeArc(0, redAngle, 66)} fill="none" stroke={`url(#${gaugeId}-red)`} strokeWidth="16" strokeLinecap="round" />
            <path d={describeArc(redAngle, greenStartAngle, 66)} fill="none" stroke={`url(#${gaugeId}-yellow)`} strokeWidth="16" strokeLinecap="round" />
            <path d={describeArc(greenStartAngle, 180, 66)} fill="none" stroke={`url(#${gaugeId}-green)`} strokeWidth="16" strokeLinecap="round" />

            {isGoalCelebration ? (
              <path
                d={describeArc(greenStartAngle, 180, 66)}
                fill="none"
                stroke="rgba(255,255,255,0.85)"
                strokeWidth="4"
                strokeLinecap="round"
                strokeDasharray="10 12"
                className="gauge-shine"
              />
            ) : null}

            <g className="gauge-needle-boost">
              <line x1="90" y1="86" x2={pointerTip.x} y2={pointerTip.y} stroke={tone.accent} strokeWidth="5" strokeLinecap="round" />
              <circle cx={pointerTip.x} cy={pointerTip.y} r="4.5" fill={tone.accent} opacity="0.95" />
            </g>
            <circle cx="90" cy="86" r="13" fill="rgba(255,255,255,0.95)" />
            <circle cx="90" cy="86" r="8" fill={tone.accent} />
            <circle cx="90" cy="86" r="18" fill="none" stroke={isGoalCelebration ? 'rgba(16,185,129,0.26)' : 'rgba(15,23,42,0.08)'} strokeWidth="2" />
          </svg>
        </div>

        <div className="-mt-3 text-center">
          <p className="text-4xl font-black tracking-tight text-foreground">{displayValue}</p>
          <p className="mt-1 text-xs font-black uppercase tracking-[0.18em] text-muted-foreground">{subtitle ?? 'ordens'}</p>
        </div>
      </div>

      <div className="relative z-10 mt-4">
        <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">
          <span>Meta {TARGET_THRESHOLD}</span>
          <span>{displayProgress}%</span>
        </div>
        <div className="relative mt-2 h-3 overflow-hidden rounded-full bg-slate-200/70">
          <div className="absolute inset-0 opacity-20" style={{ background: progressGradient }} />
          <div className="absolute inset-0 overflow-hidden rounded-full" style={{ clipPath: gaugeProgressClip }}>
            <div className="h-full w-full" style={{ background: progressGradient }} />
            {isGoalCelebration ? <div className="gauge-bar-flash absolute inset-y-0 right-0 w-16 bg-linear-to-l from-white/85 via-amber-100/70 to-transparent" /> : null}
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between text-[10px] font-black uppercase tracking-[0.18em]">
          <span className="text-rose-600">0-{DANGER_THRESHOLD - 1}</span>
          <span className="text-amber-600">{DANGER_THRESHOLD}-{WARNING_THRESHOLD - 1}</span>
          <span className="text-emerald-700">{WARNING_THRESHOLD}-{TARGET_THRESHOLD}</span>
        </div>
      </div>

      <div className="relative z-10 mt-4 flex flex-wrap gap-2">
        {goalBadges.map((goal, index) => (
          <span
            key={goal}
            className={`rounded-full border px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.16em] ${
              value >= goal
                ? index === goalBadges.length - 1 && goalBadges.length > 1
                  ? 'border-teal-200 bg-teal-50 text-teal-800'
                  : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-border bg-background/80 text-muted-foreground'
            }`}
          >
            Meta {goal}
          </span>
        ))}
      </div>

      {isMegaCelebration ? (
        <div className="relative z-10 mt-4 rounded-2xl border border-orange-300/80 bg-[linear-gradient(135deg,rgba(255,247,237,0.96),rgba(254,252,232,0.96))] px-3 py-2.5 text-center text-xs font-black uppercase tracking-[0.18em] text-orange-950 shadow-[0_12px_24px_rgba(249,115,22,0.16)]">
          {celebrationText}
        </div>
      ) : null}
    </button>
  );
}
