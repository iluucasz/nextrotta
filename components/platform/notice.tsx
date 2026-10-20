'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

/** The panel's toast ("Plano salvo.", "Link copiado."): a short message that fades after 5 s. */
const NoticeContext = createContext<((text: string) => void) | null>(null);

export function NoticeProvider({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  return (
    <NoticeContext.Provider value={setNotice}>
      {children}
      {notice && (
        <div role="status" className="nr-toast">
          {notice}
          <button aria-label="Fechar aviso" onClick={() => setNotice('')}>
            ×
          </button>
        </div>
      )}
    </NoticeContext.Provider>
  );
}

export function useNotify() {
  const notify = useContext(NoticeContext);
  if (!notify) throw new Error('NoticeProvider ausente');
  return notify;
}
