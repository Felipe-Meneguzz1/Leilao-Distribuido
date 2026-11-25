import React from 'react';
export default function Panel({ title, action, children }) {
  return <section className="panel"><div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-bold">{title}</h2>{action}</div>{children}</section>;
}
