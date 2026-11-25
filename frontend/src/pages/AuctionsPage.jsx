import React from 'react';
import Panel from '../components/Panel.jsx';
import Auctions from '../components/Auctions.jsx';
export default function AuctionsPage({ auctions, busy, action }) {
  return <Panel title="Todos os leilões"><Auctions auctions={auctions} busy={busy} onAction={action} /></Panel>;
}
