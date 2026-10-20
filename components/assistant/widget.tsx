'use client';

import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Expand, Minimize2, Minus, Sparkles } from 'lucide-react';
import './assistant.css';

const Workspace = dynamic(
  () => import('./workspace').then((module) => module.AssistantWorkspace),
  {
    ssr: false,
    loading: () => (
      <p className="ai-widget-loading" role="status">
        Carregando assistente…
      </p>
    ),
  },
);

export function AssistantWidget() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) close.current?.focus();
  }, [open]);
  if (pathname === '/admin/assistente') return null;
  function minimize() {
    setOpen(false);
    trigger.current?.focus();
  }
  return (
    <div className="ai-widget">
      {mounted && (
        <section
          id="nextrotta-chat"
          className={`ai-widget-panel ${expanded ? 'is-expanded' : ''}`}
          role="dialog"
          aria-label="Chat com o Assistente NextRotta"
          hidden={!open}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              minimize();
            }
          }}
        >
          <header className="ai-widget-heading">
            <span>
              <Sparkles size={22} />
              <strong>Assistente NextRotta</strong>
            </span>
            <div>
              <button
                onClick={() => setExpanded((value) => !value)}
                title={expanded ? 'Reduzir chat' : 'Ampliar chat'}
                aria-label={expanded ? 'Reduzir chat' : 'Ampliar chat'}
              >
                {expanded ? <Minimize2 size={19} /> : <Expand size={19} />}
              </button>
              <button
                ref={close}
                onClick={minimize}
                title="Minimizar chat"
                aria-label="Minimizar chat"
              >
                <Minus size={21} />
              </button>
            </div>
          </header>
          <Workspace compact />
        </section>
      )}
      <button
        ref={trigger}
        className="ai-widget-trigger"
        aria-expanded={open}
        aria-controls={mounted ? 'nextrotta-chat' : undefined}
        aria-label={
          open ? 'Minimizar assistente de IA' : 'Abrir assistente de IA'
        }
        onClick={() => {
          if (open) minimize();
          else {
            setMounted(true);
            setOpen(true);
          }
        }}
      >
        <Sparkles size={23} />
        <span>Assistente IA</span>
      </button>
    </div>
  );
}
