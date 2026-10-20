'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  HomeContent,
  SiteShell,
  Pricing,
  Faq,
  MarketingContact,
  MarketingNews,
} from '@/components/site/site';
import { RichText } from '@/components/platform/ui';
import type { CanvasControls } from '@/components/site/page-renderer';
import type { SiteDocument } from '@/components/site/theme';

export type EditorPage =
  | 'home'
  | 'plans'
  | 'terms'
  | 'privacy'
  | 'contact'
  | 'custom'
  | 'news';
export function Canvas({
  document: content,
  device,
  zoom,
  editor,
  page,
  onSelectGlobal,
}: {
  document: SiteDocument;
  device: 'desktop' | 'mobile';
  zoom: number | 'fit';
  editor?: CanvasControls;
  page: EditorPage;
  onSelectGlobal: (id: string) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const [bounds, setBounds] = useState({ width: 900, height: 800 });
  const [srcDoc, setSrcDoc] = useState('');
  const width = device === 'mobile' ? 390 : 1280;
  const scale =
    zoom === 'fit' ? Math.min(1, (bounds.width - 48) / width) : zoom / 100;
  const height = Math.max(500, (bounds.height - 48) / Math.max(0.1, scale));
  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      const box = entries[0].contentRect;
      setBounds({ width: box.width, height: box.height });
    });
    if (container.current) observer.observe(container.current);
    const styles = [...document.querySelectorAll('link[rel="stylesheet"]')]
      .map(
        (node) =>
          `<link rel="stylesheet" href="${(node as HTMLLinkElement).href.replace(/"/g, '&quot;')}">`,
      )
      .join('');
    setSrcDoc(
      `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${styles}<style>html,body{margin:0;min-height:100%;scroll-behavior:smooth}*{box-sizing:border-box}body>div{min-height:100vh}.nr-marketing{overflow-x:hidden}.nr-theme-page{min-height:0}a,button{-webkit-user-drag:none}::-webkit-scrollbar{width:6px}::-webkit-scrollbar-thumb{background:#c5cec7;border-radius:8px}</style></head><body class="${document.body.className.replace(/"/g, '&quot;')}"><div id="canvas-root"></div></body></html>`,
    );
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!root || !editor?.selected || editor.selected.startsWith('@')) return;
    const section = [
      ...root.querySelectorAll<HTMLElement>('[data-section-id]'),
    ].find((node) => node.dataset.sectionId === editor.selected);
    section?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [editor?.selected, root]);
  return (
    <div ref={container} className="cms-canvas-scroll">
      <div
        className={`cms-canvas-device ${device}`}
        style={{ width: width * scale, height: height * scale }}
      >
        <iframe
          ref={frame}
          title={`Prévia do site — ${device === 'mobile' ? 'celular' : 'desktop'}`}
          srcDoc={srcDoc}
          onLoad={() =>
            setRoot(
              frame.current?.contentDocument?.getElementById('canvas-root') ||
                null,
            )
          }
          style={{
            width,
            height,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
        />
        {root &&
          createPortal(
            <div
              onSubmitCapture={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onClickCapture={(event) => {
                const target = event.target as HTMLElement;
                if (target.closest('a')) event.preventDefault();
                if (!editor) return;
                if (target.closest('.nr-public-header')) {
                  event.preventDefault();
                  event.stopPropagation();
                  onSelectGlobal('@header');
                }
                if (target.closest('.nr-public-footer')) {
                  event.preventDefault();
                  event.stopPropagation();
                  onSelectGlobal('@footer');
                }
              }}
            >
              <SiteShell content={content}>
                {page === 'home' ? (
                  <HomeContent content={content} editor={editor} />
                ) : page === 'plans' ? (
                  <>
                    <Pricing content={content} full />
                    <Faq content={content} />
                  </>
                ) : page === 'contact' || page === 'custom' ? (
                  <MarketingContact custom={page === 'custom'} />
                ) : page === 'news' ? (
                  <MarketingNews />
                ) : (
                  <section
                    className="nr-public-section nr-legal"
                    onClick={() =>
                      onSelectGlobal(page === 'terms' ? '@terms' : '@privacy')
                    }
                  >
                    <RichText
                      text={page === 'terms' ? content.terms : content.privacy}
                    />
                  </section>
                )}
              </SiteShell>
            </div>,
            root,
          )}
      </div>
    </div>
  );
}
