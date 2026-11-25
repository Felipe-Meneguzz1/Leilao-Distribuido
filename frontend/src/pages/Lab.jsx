import React from 'react';
import Panel from '../components/Panel.jsx';
import Nodes from '../components/Nodes.jsx';

export default function Lab({ cluster, busy, action, quorum, setQuorum, onApplyQuorum }) {
  const choices = cluster ? Array.from({ length: Math.min(5, cluster.capacity) }, (_, i) => i + 1) : [];
  const selected = Number(quorum);
  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="Criar e administrar nós">
          <p className="muted mb-4">Ative, reative, renomeie ou desative um membro. {cluster?.configuredCount ?? 'N/D'} de {cluster?.capacity ?? 'N/D'} membros habilitados.</p>
          <button className="btn primary" disabled={busy || !cluster || cluster.configuredCount >= cluster.capacity} onClick={() => action('nodeCreate')}>
            Criar nó
          </button>
        </Panel>
        <Panel title="Quórum de escrita">
          <p className="muted mb-3">Selecione de 1 a {Math.min(5, cluster?.capacity ?? 5)} confirmações. Atual: {cluster?.quorum ?? 'N/D'}. Membros ativos: {cluster?.configuredCount ?? 'N/D'}.</p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="field">
              Mínimo de confirmações
              <select value={quorum} onChange={e => setQuorum(e.target.value)} disabled={!cluster}>
                {choices.map(q => <option key={q} value={q}>{q}</option>)}
              </select>
            </label>
            <button className="btn" disabled={busy || !choices.includes(selected)} onClick={onApplyQuorum}>
              Aplicar quórum
            </button>
          </div>
          {cluster && selected > cluster.configuredCount && (
            <p className="mt-3 text-sm text-amber-800" role="status">O quórum supera o total de membros ativos. Escritas serão bloqueadas até reativar membros ou reduzir o quórum.</p>
          )}
          {cluster && selected >= 1 && selected < Math.floor(cluster.configuredCount / 2) + 1 && (
            <p className="mt-3 text-sm text-amber-800" role="status">Quórum abaixo da maioria. Em caso de falhas, pode haver perda de dados ou divergência entre os nós.</p>
          )}
        </Panel>
      </div>
      <Nodes cluster={cluster} busy={busy} onAction={action} />
      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="Experimento A: Troca de liderança">
          <p className="muted">Com três membros ativos, pause o líder (normalmente Nó 3), observe o Nó 2 assumir e restaure o Nó 3.</p>
        </Panel>
        <Panel title="Experimento B: Quórum e consistência">
          <p className="muted">Pause membros até perder o quórum e tente enviar um lance. A escrita deve ser bloqueada. A simulação não desliga os contêineres reais.</p>
        </Panel>
      </div>
    </>
  );
}
