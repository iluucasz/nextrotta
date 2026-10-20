import Link from 'next/link';
export default function NotFound() { return <div className="nr-empty"><h1>Página não encontrada</h1><p>Escolha uma seção na navegação para continuar.</p><Link className="nr-btn primary" href="/plataforma">Voltar ao painel</Link></div>; }
