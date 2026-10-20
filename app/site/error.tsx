'use client';
export default function SiteError({ reset }: { reset: () => void }) { return <div className="nr-empty" role="alert"><h1>Não foi possível carregar esta página.</h1><p>Tente novamente em instantes.</p><button className="nr-btn primary" onClick={reset}>Tentar novamente</button></div>; }
