import React, { useEffect, useState } from 'react';
import { api } from './services/api.js';
import Login from './pages/Login.jsx';
import AdminDashboard from './pages/AdminDashboard.jsx';
import ClientDashboard from './pages/ClientDashboard.jsx';

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const expired = () => {
      setUser(null);
      setError('Sessão expirada. Entre novamente.');
    };
    window.addEventListener('atrio:unauthorized', expired);
    api('/api/auth/me')
      .then(result => setUser(result.user))
      .catch(err => {
        if (err.status !== 401) setError('Não foi possível verificar a sessão.');
      })
      .finally(() => setLoading(false));
    return () => window.removeEventListener('atrio:unauthorized', expired);
  }, []);

  async function logout() {
    if (logoutBusy) return;
    setLogoutBusy(true);
    setError('');
    try {
      await api('/api/auth/logout', 'POST', {});
      setUser(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLogoutBusy(false);
    }
  }

  if (loading) {
    return <main className="grid min-h-screen place-items-center">Verificando sessão…</main>;
  }
  if (!user) {
    return <Login initialError={error} onLogin={value => { setError(''); setUser(value); }} />;
  }

  const Dashboard = user.role === 'admin' ? AdminDashboard : ClientDashboard;
  return (
    <>
      {error && <p role="alert" className="bg-red-100 p-3 text-center text-red-800">{error}</p>}
      <Dashboard key={user.id} user={user} onLogout={logout} logoutBusy={logoutBusy} />
    </>
  );
}
