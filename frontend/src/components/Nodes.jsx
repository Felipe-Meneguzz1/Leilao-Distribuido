import React from 'react';

function status(n) {
  return !n.connected ? 'Contêiner offline' : !n.member ? 'Inativo' : n.paused ? 'Falha simulada' : n.reachable ? 'Operacional' : 'Sincronizando';
}
export default function Nodes({ cluster, busy, onAction, compact = false }) {
  const nodes = (cluster?.nodes || []).filter(n => !compact || n.member);
  return (
    <div className={'grid gap-3 ' + (compact ? 'sm:grid-cols-2 xl:grid-cols-3' : 'md:grid-cols-2 xl:grid-cols-3')}>
      {nodes.map(n => (
        <article key={n.id} className={'rounded-xl border border-stone-200 bg-white p-4 ' + (!n.member ? 'opacity-75' : '')}>
          <p className="muted text-xs">NODE_{String(n.id).padStart(2, '0')}</p>
          <h3 className="my-2 break-words font-bold">{n.name} (#{n.id}) {cluster.leaderId === n.id && (
            <span className="tag bg-emerald-100 text-emerald-800">Líder</span>
          )}</h3>
          <span className={'tag ' + (n.member && n.reachable ? 'bg-emerald-100 text-emerald-800' : '')}>{status(n)}</span>
          <div className="my-3 grid grid-cols-2 gap-2 text-sm">
            <div>Mandato <b>{n.term ?? 'N/D'}</b></div>
            <div>Seq. <b>{n.seq ?? 'N/D'}</b></div>
            {!compact && <>
              <div>Lamport <b>{n.lamport ?? 'N/D'}</b></div>
              <div>Papel <b>{!n.member ? 'Reserva' : cluster.leaderId === n.id ? 'Líder' : 'Seguidor'}</b></div>
            </>}
          </div>
          {!compact && (
            <div className="flex flex-wrap gap-2">
              <button className="btn" disabled={busy} onClick={() => onAction('nodeRename', n.id)}>Renomear</button>
              {n.member ? <>
                <button className="btn" disabled={busy || n.paused === null} onClick={() => onAction('failure', n.id, !n.paused)}>
                  {n.paused === null ? 'Contêiner inacessível' : n.paused ? 'Restaurar' : 'Simular falha'}
                </button>
                <button className="btn text-red-700" disabled={busy || cluster.configuredCount <= 2} onClick={() => onAction('deactivate', n.id)}>
                  Desativar membro
                </button>
              </> : (
                <button type="button" className="btn primary" disabled={busy || !n.connected} onClick={() => onAction('activate', n.id)}>
                  Reativar nó
                </button>
              )}
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
