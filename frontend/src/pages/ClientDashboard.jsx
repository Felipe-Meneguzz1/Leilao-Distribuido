import React, { useCallback, useEffect, useRef, useState } from 'react';
import Auctions from '../components/Auctions.jsx';
import OperationModal from '../components/OperationModal.jsx';
import { api, brl } from '../services/api.js';

export default function ClientDashboard({ user, onLogout, logoutBusy }) {
  const [auctions, setAuctions] = useState([]);
  const [modal, setModal] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [stale, setStale] = useState(false);
  const [loading, setLoading] = useState(true);
  const running = useRef(false);
  const fetching = useRef(null);
  const closeModal = useCallback(() => setModal(null), []);

  const refresh = useCallback(() => {
    if (fetching.current) return fetching.current;
    const request = (async () => {
      try {
        const result = await api('/api/auctions');
        setAuctions(result.auctions || []);
        setStale(!!result.stale);
      } catch {
        setStale(true);
      } finally {
        setLoading(false);
      }
    })();
    fetching.current = request;
    request.finally(() => { fetching.current = null; });
    return request;
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(() => { if (!running.current) refresh(); }, 2200);
    return () => clearInterval(timer);
  }, [refresh]);

  function action(type, id) {
    if (type === 'bid' || type === 'history') {
      setMessage(null);
      setModal({ action: type, id });
    }
  }

  async function submit(data) {
    if (running.current || modal?.action !== 'bid') return;
    running.current = true;
    setBusy(true);
    setMessage(null);
    try {
      if (fetching.current) await fetching.current;
      const result = await api('/api/auctions/' + encodeURIComponent(modal.id) + '/bids', 'POST', {
        amount: Number(data.amount),
        requestId: crypto.randomUUID()
      });
      closeModal();
      setMessage({ text: 'Lance confirmado: ' + brl(result.auction.highestBid), error: false });
      await refresh();
    } catch (err) {
      setMessage({ text: err.message, error: true });
      await refresh();
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-stone-200 bg-white px-5 py-4 sm:px-10">
        <div>
          <p className="text-3xl font-black tracking-tight">átrio<span className="text-emerald-600">.</span></p>
          <p className="muted">Área do cliente</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="tag">{user.name}</span>
          <button className="btn" disabled={logoutBusy || busy} onClick={onLogout}>Sair</button>
        </div>
      </header>
      <main className="mx-auto max-w-5xl space-y-6 p-5 sm:p-10">
        <div className="rounded-2xl bg-emerald-900 p-6 text-white sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-wider text-emerald-200">Marketplace</p>
          <h1 className="my-3 text-3xl font-bold">Leilões disponíveis</h1>
          <p className="text-emerald-100">Olá, {user.name}! Escolha um item e faça seu lance.</p>
        </div>
        <section className="grid gap-3 sm:grid-cols-2">
          <article className="panel"><p className="muted">Leilões abertos</p><p className="mt-2 text-2xl font-bold">{auctions.filter(a => a.status === 'aberto').length}</p></article>
          <article className="panel"><p className="muted">Leilões encerrados</p><p className="mt-2 text-2xl font-bold">{auctions.filter(a => a.status === 'encerrado').length}</p></article>
        </section>
        {stale && <p role="status" className="rounded-lg bg-amber-50 p-3 text-amber-900">Sistema temporariamente indisponível para novos lances. Aguarde a recuperação.</p>}
        <section className="panel">
          <h2 className="mb-5 text-xl font-bold">Todos os leilões</h2>
          {loading ? <p className="muted">Carregando leilões…</p> : <Auctions auctions={auctions} busy={busy || stale} onAction={action} client />}
        </section>
      </main>
      {modal && (
        <OperationModal key={modal.action + ':' + modal.id} modal={modal} auction={auctions.find(a => a.id === modal.id)} busy={busy} onClose={closeModal} onSubmit={submit} client={user} />
      )}
      {message && <div role={message.error ? 'alert' : 'status'} className={'fixed bottom-5 right-5 z-[60] max-w-[calc(100%-2.5rem)] rounded-xl px-5 py-3 text-sm font-semibold text-white shadow-lg ' + (message.error ? 'bg-red-800' : 'bg-emerald-900')}><span>{message.text}</span><button type="button" className="ml-4" aria-label="Fechar aviso" onClick={() => setMessage(null)}>×</button></div>}
    </div>
  );
}
