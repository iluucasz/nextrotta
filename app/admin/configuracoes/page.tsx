import { redirect } from 'next/navigation';

// Settings are split by subject (see the sidebar); the first one is where "Configurações" lands.
export default function ConfiguracoesPage() {
  redirect('/admin/configuracoes/pagamento');
}
