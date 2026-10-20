'use client';

import { useState } from 'react';

export function LogoutButton() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleLogout() {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' });
      if (!response.ok) throw new Error('logout');
      window.location.assign('/login');
    } catch {
      setLoading(false);
      setError('Não foi possível sair. Tente novamente.');
    }
  }

  return (
    <><button
      type="button"
      onClick={handleLogout}
      disabled={loading}
      className="nr-btn"
    >
      {loading ? 'Saindo...' : 'Sair'}
    </button>{error && <span role="alert" className="nr-error">{error}</span>}</>
  );
}
