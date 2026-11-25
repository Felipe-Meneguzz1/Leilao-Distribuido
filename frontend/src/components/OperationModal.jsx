import React, { useEffect } from 'react';
import { brl, when } from '../services/api.js';

export default function OperationModal({ modal, auction, node, cluster, busy, onClose, onSubmit, client }) {
  const action = modal.action;
  const title = {
    create: 'Criar novo leilão',
    bid: 'Novo lance · ' + (auction?.item || ''),
    history: 'Histórico · ' + (auction?.item || ''),
    nodeCreate: 'Criar novo nó',
    nodeRename: 'Renomear · ' + (node?.name || '')
  }[action];
  useEffect(() => {
    const handler = e => {
      if (e.key === 'Escape' && !busy)
        onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [busy, onClose]);
  const submit = e => {
    e.preventDefault();
    if (action !== 'history')
      onSubmit(Object.fromEntries(new FormData(e.currentTarget)));
  };
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/50 p-4"
      onClick={e => {
        if (e.target === e.currentTarget && !busy)
          onClose();
      }}
    >
      <section
        className="panel max-h-[90vh] w-full max-w-lg overflow-y-auto"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <div className="mb-5 flex items-center justify-between gap-3">
          <h2 id="modal-title" className="text-xl font-bold">{title}</h2>
          <button
            className="btn"
            disabled={busy}
            aria-label="Fechar"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <form onSubmit={submit} className="space-y-4">
          {action === 'create' && (
            <>
              <label className="field">
                Nome do produto
                <input
                  autoFocus
                  name="item"
                  minLength={3}
                  maxLength={90}
                  required
                  placeholder="Ex.: Notebook gamer"
                />
              </label>
              <label className="field">
                Descrição (opcional)
                <textarea
                  name="description"
                  rows={3}
                  maxLength={300}
                />
              </label>
              <label className="field">
                Lance inicial (R$)
                <input
                  name="openingBid"
                  type="number"
                  min="0.01"
                  step="0.01"
                  defaultValue="100.00"
                  required
                />
              </label>
            </>
          )}
          {action === 'bid' && (
            <>
              {client ? (
                <p className="muted">Lance em nome de <b>{client.name}</b>.</p>
              ) : (
                <label className="field">
                  Seu nome
                  <input
                    autoFocus
                    name="bidder"
                    maxLength={60}
                    required
                  />
                </label>
              )}
              <label className="field">
                Valor do lance (R$)
                <input
                  name="amount"
                  type="number"
                  min={(Math.round((auction?.highestBid || 0) * 100) + 1) / 100}
                  step="0.01"
                  defaultValue={((auction?.highestBid || 0) + 10).toFixed(2)}
                  required
                />
              </label>
              {!client && (
                <>
                  <label className="field">
                    Enviar pelo nó
                    <select name="receiverNode">
                      <option value="">Automaticamente (líder)</option>
                      {(cluster?.nodes || []).filter(n => n.member && n.reachable).map(n => (
                        <option key={n.id} value={n.id}>{n.name} (#{n.id})</option>
                      ))}
                    </select>
                  </label>
                  <p className="muted">Escolher um seguidor demonstra o encaminhamento REST ao líder.</p>
                </>
              )}
            </>
          )}
          {(action === 'nodeCreate' || action === 'nodeRename') && (
            <>
              <label className="field">
                Nome exibido
                <input
                  autoFocus
                  name="name"
                  minLength={2}
                  maxLength={40}
                  defaultValue={action === 'nodeRename' ? node?.name : 'Nó ' + (cluster?.nodes.find(n => !n.member)?.id || 4)}
                  required
                />
              </label>
              <p className="muted">
                {action === 'nodeRename' ? 'O ID fixo e o endereço do contêiner não serão alterados.' : 'Um contêiner reserva será incluído no cluster.'}
              </p>
            </>
          )}
          {action === 'history' && ((auction?.bids || []).length ? (
            <div className="divide-y">
              {auction.bids.map(b => (
                <div key={b.seq} className="py-3">
                  <p className="font-semibold">{b.bidder} · {brl(b.amount)}</p>
                  <p className="muted">Seq. {b.seq} · Term {b.term} · Lamport {b.lamport} · {when(b.at)}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">Nenhum lance registrado.</p>
          ))}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={onClose}
            >
              {action === 'history' ? 'Fechar' : 'Cancelar'}
            </button>
            {action !== 'history' && (
              <button
                className="btn primary"
                disabled={busy}
                type="submit"
              >
                {busy ? 'Processando…' : 'Confirmar'}
              </button>
            )}
          </div>
        </form>
      </section>
    </div>
  );
}
