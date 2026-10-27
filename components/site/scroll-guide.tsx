'use client';
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { ArrowUp } from 'lucide-react';
import './scroll-guide.css';

type Stop = { id: string; name: string };

const reducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Right-edge section guide (one dot per page section, the current one highlighted) and the
 * back-to-top button that shows up near the end of the page. Sections come from the rendered
 * page (`data-section-id` + `data-section-name`), so it follows whatever the owner published.
 * Does nothing inside the site editor canvas.
 */
export function ScrollGuide() {
  const pathname = usePathname();
  const [stops, setStops] = useState<Stop[]>([]);
  const [active, setActive] = useState(0);
  const [nearEnd, setNearEnd] = useState(false);
  const frame = useRef(0);

  useEffect(() => {
    const collect = () =>
      Array.from(
        document.querySelectorAll<HTMLElement>(
          '.nr-theme-page:not(.is-editing) > [data-section-id]',
        ),
      ).filter((el) => el.dataset.sectionType !== 'spacer');

    let sections = collect();
    setStops(
      sections.map((el) => ({
        id: el.dataset.sectionId ?? '',
        name: el.dataset.sectionName ?? '',
      })),
    );

    const update = () => {
      frame.current = 0;
      const line = window.innerHeight * 0.4;
      let current = 0;
      sections.forEach((el, i) => {
        if (el.getBoundingClientRect().top <= line) current = i;
      });
      setActive(current);
      const root = document.documentElement;
      const remaining = root.scrollHeight - (window.scrollY + window.innerHeight);
      setNearEnd(
        window.scrollY > 400 &&
          remaining <= Math.max(500, window.innerHeight * 0.6),
      );
    };
    const schedule = () => {
      if (!frame.current) frame.current = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    // Content that loads later (plans, images, fonts) moves the sections without any scroll.
    const resizeObserver = new ResizeObserver(schedule);
    resizeObserver.observe(document.body);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (frame.current) cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [pathname]);

  const behavior = (): ScrollBehavior => (reducedMotion() ? 'auto' : 'smooth');
  const goTo = (id: string) =>
    document
      .querySelector(`[data-section-id="${CSS.escape(id)}"]`)
      ?.scrollIntoView({ behavior: behavior(), block: 'start' });

  return (
    <>
      {stops.length > 1 && (
        <nav className="nr-guide" aria-label="Seções da página">
          {stops.map((stop, i) => (
            <button
              key={stop.id}
              type="button"
              className={i === active ? 'active' : ''}
              aria-label={stop.name || `Seção ${i + 1}`}
              aria-current={i === active ? 'true' : undefined}
              onClick={() => goTo(stop.id)}
            >
              <span className="nr-guide-label">{stop.name}</span>
              <i aria-hidden="true" />
            </button>
          ))}
        </nav>
      )}
      <button
        type="button"
        className={`nr-top ${nearEnd ? 'show' : ''}`}
        aria-label="Voltar ao topo"
        tabIndex={nearEnd ? 0 : -1}
        onClick={() => window.scrollTo({ top: 0, behavior: behavior() })}
      >
        <ArrowUp size={20} />
      </button>
    </>
  );
}
