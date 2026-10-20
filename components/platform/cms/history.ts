'use client';
import { useCallback, useRef, useState } from 'react';
import { normalizeDocument, type SiteDocument } from '@/components/site/theme';

export function useDocumentHistory() {
  const [current, setCurrent] = useState<ReturnType<
    typeof normalizeDocument
  > | null>(null);
  const previous = useRef<SiteDocument[]>([]);
  const next = useRef<SiteDocument[]>([]);
  const live = useRef<SiteDocument | null>(null);
  const last = useRef({ group: '', time: 0 });
  const [revision, setRevision] = useState(0);
  const reset = useCallback((document: SiteDocument) => {
    previous.current = [];
    next.current = [];
    live.current = normalizeDocument(document);
    setCurrent(normalizeDocument(document));
    setRevision((n) => n + 1);
  }, []);
  const change = useCallback(
    (
      mutate: (document: ReturnType<typeof normalizeDocument>) => void,
      group = '',
    ) => {
      if (!live.current) return;
      const before = live.current;
      const document = normalizeDocument(structuredClone(before));
      mutate(document);
      if (JSON.stringify(document) === JSON.stringify(before)) return;
      if (
        !group ||
        group !== last.current.group ||
        Date.now() - last.current.time > 900
      )
        previous.current = [...previous.current.slice(-59), before];
      next.current = [];
      last.current = { group, time: Date.now() };
      live.current = document;
      setCurrent(document);
      setRevision((n) => n + 1);
    },
    [],
  );
  const undo = useCallback(() => {
    const item = previous.current.pop();
    if (!item || !live.current) return;
    next.current.push(live.current);
    live.current = item;
    last.current.group = '';
    setCurrent(normalizeDocument(item));
    setRevision((n) => n + 1);
  }, []);
  const redo = useCallback(() => {
    const item = next.current.pop();
    if (!item || !live.current) return;
    previous.current.push(live.current);
    live.current = item;
    last.current.group = '';
    setCurrent(normalizeDocument(item));
    setRevision((n) => n + 1);
  }, []);
  const acceptSaved = useCallback((sent: SiteDocument, saved: SiteDocument) => {
    if (JSON.stringify(live.current) !== JSON.stringify(sent)) return;
    live.current = normalizeDocument(saved);
    setCurrent(normalizeDocument(saved));
    setRevision((n) => n + 1);
  }, []);
  return {
    current,
    reset,
    change,
    undo,
    redo,
    acceptSaved,
    canUndo: previous.current.length > 0,
    canRedo: next.current.length > 0,
    revision,
  };
}
