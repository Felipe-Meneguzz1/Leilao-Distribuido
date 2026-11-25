import React from 'react';
export default function Metric({ title, value, detail, accent }) {
  return <article className={'panel ' + (accent ? 'bg-emerald-50 border-emerald-200' : '')}><p className="muted text-xs font-semibold uppercase">{title}</p><p className="my-2 break-words text-2xl font-bold">{value}</p><p className="muted">{detail}</p></article>;
}
