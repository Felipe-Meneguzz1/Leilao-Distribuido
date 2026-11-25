import React from 'react';
import Panel from '../components/Panel.jsx';
import Auctions from '../components/Auctions.jsx';
import Nodes from '../components/Nodes.jsx';
import Events from '../components/Events.jsx';
export default function Overview({ auctions, cluster, events, busy, action, setView }) {
  return (
    <div className="grid gap-5 xl:grid-cols-[3fr_2fr]">
      <div className="space-y-5">
        <Panel title="Leilões em andamento" action={<button className="btn" onClick={() => setView('auctions')}>Ver todos ↗</button>}>
          <Auctions auctions={auctions.slice(0, 3)} busy={busy} onAction={action} />
        </Panel>
        <Panel title="Saúde do cluster" action={<span className="tag">{cluster?.majority ? 'Quórum ativo' : cluster ? 'Sem quórum' : 'Verificando'}</span>}>
          <Nodes cluster={cluster} compact />
          <button className="btn mt-4" onClick={() => setView('lab')}>Abrir laboratório ↗</button>
        </Panel>
      </div>
      <div className="space-y-5">
        <div className="rounded-2xl bg-emerald-900 p-6 text-white">
          <p className="text-xs font-semibold uppercase text-emerald-200">Teste guiado</p>
          <h2 className="my-3 text-2xl font-bold">Veja o distribuído em ação.</h2>
          <p className="mb-4 text-emerald-100">Crie lances, interrompa o líder e observe o cluster se reorganizar.</p>
          <button className="btn text-stone-900" onClick={() => setView('lab')}>Abrir laboratório ↗</button>
        </div>
        <Panel title="Log de eventos" action={<button className="btn" onClick={() => setView('events')}>Ver histórico ↗</button>}>
          <Events events={events.slice(0, 5)} />
        </Panel>
      </div>
    </div>
  );
}
