import React from 'react';
import Panel from '../components/Panel.jsx';
import Nodes from '../components/Nodes.jsx';
export default function Lab({ cluster, busy, action, quorum, setQuorum, onApplyQuorum }) {
  const choices = cluster ? Array.from({ length: cluster.configuredCount - cluster.minimumQuorum + 1 }, (_, i) => cluster.minimumQuorum + i) : [];
  return <>
    <div className="grid gap-4 md:grid-cols-2">
      <Panel title="Criar e administrar nós">
        <p className="muted mb-4">Ative um contêiner reserva, renomeie ou retire um membro. {cluster?.configuredCount ?? '—'} de {cluster?.capacity ?? '—'} membros habilitados.</p>
        <button className="btn primary" disabled={busy || !cluster || cluster.configuredCount >= cluster.capacity} onClick={() => action('nodeCreate')}>＋ Criar nó</button>
      </Panel>
      <Panel title="Quórum de escrita">
        <p className="muted mb-3">Mínimo seguro: {cluster?.minimumQuorum ?? '—'} de {cluster?.configuredCount ?? '—'}. Atual: {cluster?.quorum ?? '—'}.</p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="field">Mínimo de confirmações
            <select value={quorum} onChange={e => setQuorum(e.target.value)} disabled={!cluster}>
              {choices.map(q => <option key={q} value={q}>{q} de {cluster.configuredCount}</option>)}
            </select>
          </label>
          <button className="btn" disabled={busy || !choices.includes(Number(quorum))} onClick={onApplyQuorum}>Aplicar quórum</button>
        </div>
      </Panel>
    </div>
    <Nodes cluster={cluster} busy={busy} onAction={action} />
    <div className="grid gap-4 md:grid-cols-2">
      <Panel title="Experimento A · Troca de liderança"><p className="muted">Com três membros ativos, pause o líder (normalmente Nó 3), observe o Nó 2 assumir e restaure o Nó 3.</p></Panel>
      <Panel title="Experimento B · Quórum e consistência"><p className="muted">Pause membros até perder o quórum e tente enviar um lance. A escrita deve ser bloqueada. A simulação não desliga os contêineres reais.</p></Panel>
    </div>
  </>;
}
