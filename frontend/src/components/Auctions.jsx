import React from 'react';
import { brl } from '../services/api.js';

export default function Auctions({ auctions, busy, onAction, client = false }) {
  if (!auctions.length)
    return (
      <div className="py-10 text-center">
        <p className="font-semibold">Nenhum leilão por aqui</p>
        <p className="muted my-2">{client ? 'Aguarde a criação de novos leilões.' : 'Crie um item ou simule uma rodada.'}</p>
        {!client && (
          <button
            className="btn primary"
            disabled={busy}
            onClick={() => onAction('create')}
          >
            Criar primeiro leilão
          </button>
        )}
      </div>
    );
  return (
    <div className="space-y-3">
      {auctions.map(a => (
        <article key={a.id} className="rounded-xl border border-stone-200 p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="muted break-all">{a.id}</span>
            <span className={'tag ' + (a.status === 'aberto' ? 'bg-emerald-100 text-emerald-800' : '')}>
              {a.status === 'aberto' ? 'Aberto' : 'Encerrado'}
            </span>
          </div>
          <div className="my-3 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-bold">{a.item}</h3>
              <p className="muted break-words">
                {a.description || 'Leilão distribuído · registros replicados'}
              </p>
            </div>
            <div>
              <p className="text-xl font-bold">{brl(a.highestBid)}</p>
              <p className="muted">{a.bids.length ? 'Maior lance atual' : 'Lance inicial'}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="muted">{a.bids.length} lance(s) · {a.winner ? 'Líder: ' + a.winner : 'Sem vencedor'}</p>
            <div className="flex flex-wrap gap-2">
              <button
                className="btn"
                disabled={busy}
                onClick={() => onAction('history', a.id)}
              >
                Histórico
              </button>
              {a.status === 'aberto' && (
                <>
                  {!client && (
                    <button
                      className="btn"
                      disabled={busy}
                      onClick={() => onAction('close', a.id)}
                    >
                      Encerrar
                    </button>
                  )}
                  <button
                    className="btn primary"
                    disabled={busy}
                    onClick={() => onAction('bid', a.id)}
                  >
                    Dar lance
                  </button>
                </>
              )}
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
