export async function api(route, method = 'GET', data) {
  const response = await fetch(route, {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data),
    signal: AbortSignal.timeout(11000)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && !route.startsWith('/api/auth/')) {
      window.dispatchEvent(new Event('atrio:unauthorized'));
    }
    throw Object.assign(new Error(result.error || 'Erro HTTP ' + response.status), { status: response.status });
  }
  return result;
}

export const brl = value => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0);
export const when = time => time ? new Date(time).toLocaleTimeString('pt-BR') : '—';
