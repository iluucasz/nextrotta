'use client';
export default function PlatformError({ reset }: { reset: () => void }) { return <div className="nr-empty" role="alert"><h2>Não foi possível abrir esta tela.</h2><p>Tente novamente para retomar sua operação.</p><button className="nr-btn primary" onClick={reset}>Tentar novamente</button></div>; }
