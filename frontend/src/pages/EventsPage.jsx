import React from 'react';
import Panel from '../components/Panel.jsx';
import Events from '../components/Events.jsx';
export default function EventsPage({ events }) {
  return <Panel title="Eventos do cluster"><Events events={events} /></Panel>;
}
