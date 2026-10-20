'use client';

import { useEffect, useRef } from 'react';

interface FireworksOverlayProps {
  duration?: number;
  onDone: () => void;
}

type Spark = {
  x: number;
  y: number;
  previousX: number;
  previousY: number;
  velocityX: number;
  velocityY: number;
  size: number;
  life: number;
  maxLife: number;
  color: string;
};

const fireworkColors = ['#f97316', '#facc15', '#22c55e', '#38bdf8', '#a78bfa', '#fb7185', '#ffffff'];
const BURST_INTERVAL = 620;
const MAX_SPARKS = 420;
const FRAME_INTERVAL = 32;

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function createBurst(width: number, height: number): Spark[] {
  const x = randomBetween(width * 0.06, width * 0.94);
  const y = randomBetween(height * 0.08, height * 0.72);
  const color = fireworkColors[Math.floor(Math.random() * fireworkColors.length)];
  const sparkCount = Math.floor(randomBetween(30, 44));

  return Array.from({ length: sparkCount }, (_, index) => {
    const angle = (Math.PI * 2 * index) / sparkCount + randomBetween(-0.12, 0.12);
    const speed = randomBetween(2.8, 7.4);

    return {
      x,
      y,
      previousX: x,
      previousY: y,
      velocityX: Math.cos(angle) * speed,
      velocityY: Math.sin(angle) * speed,
      size: randomBetween(1.8, 3.6),
      life: 0,
      maxLife: randomBetween(76, 118),
      color,
    };
  });
}

export function FireworksOverlay({ duration = 6000, onDone }: FireworksOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const onDoneRef = useRef(onDone);

  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (!canvas || !context || reduceMotion) {
      onDoneRef.current();
      return;
    }

    let animationFrame = 0;
    let lastBurst = 0;
    let completed = false;
    let width = 0;
    let height = 0;
    let lastFrame = 0;
    const startedAt = performance.now();
    const sparks: Spark[] = [];

    const resize = () => {
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.25);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * pixelRatio;
      canvas.height = height * pixelRatio;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    };

    const launchBurst = () => {
      if (sparks.length > MAX_SPARKS) return;
      sparks.push(...createBurst(width, height));
    };

    const animate = (currentTime: number) => {
      if (currentTime - lastFrame < FRAME_INTERVAL) {
        animationFrame = requestAnimationFrame(animate);
        return;
      }

      lastFrame = currentTime;
      const elapsed = currentTime - startedAt;

      context.clearRect(0, 0, width, height);
      context.globalCompositeOperation = 'lighter';

      if (elapsed < duration && currentTime - lastBurst > BURST_INTERVAL) {
        launchBurst();
        if (Math.random() > 0.62) {
          launchBurst();
        }
        lastBurst = currentTime;
      }

      for (let index = sparks.length - 1; index >= 0; index -= 1) {
        const spark = sparks[index];
        spark.life += 1;
        spark.previousX = spark.x;
        spark.previousY = spark.y;
        spark.velocityX *= 0.988;
        spark.velocityY = spark.velocityY * 0.988 + 0.028;
        spark.x += spark.velocityX;
        spark.y += spark.velocityY;

        const opacity = Math.max(1 - spark.life / spark.maxLife, 0);

        context.globalAlpha = opacity;
        context.strokeStyle = spark.color;
        context.lineWidth = spark.size;
        context.shadowBlur = 0;
        context.beginPath();
        context.moveTo(spark.previousX, spark.previousY);
        context.lineTo(spark.x, spark.y);
        context.stroke();

        context.globalAlpha = opacity * 0.76;
        context.beginPath();
        context.arc(spark.x, spark.y, spark.size * 0.9, 0, Math.PI * 2);
        context.fillStyle = spark.color;
        context.fill();

        if (spark.life >= spark.maxLife) {
          sparks.splice(index, 1);
        }
      }

      context.globalAlpha = 1;
      context.globalCompositeOperation = 'source-over';

      if (elapsed < duration || sparks.length > 0) {
        animationFrame = requestAnimationFrame(animate);
        return;
      }

      if (!completed) {
        completed = true;
        onDoneRef.current();
      }
    };

    resize();
    launchBurst();
    launchBurst();
    window.addEventListener('resize', resize);
    animationFrame = requestAnimationFrame(animate);

    return () => {
      completed = true;
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animationFrame);
    };
  }, [duration]);

  return <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none fixed inset-0 z-100 h-screen w-screen" />;
}
