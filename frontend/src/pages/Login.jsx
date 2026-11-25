import React, { useState } from 'react';
import { api } from '../services/api.js';

export default function Login({ initialError, onLogin }) {
  const [register, setRegister] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    const data = Object.fromEntries(new FormData(event.currentTarget));
    setBusy(true);
    setError('');
    try {
      const result = await api(register ? '/api/auth/register' : '/api/auth/login', 'POST', data);
      onLogin(result.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="flex flex-col justify-between bg-stone-950 p-8 text-white sm:p-12">
        <div>
          <p className="text-4xl font-black tracking-tight">átrio<span className="text-emerald-400">.</span></p>
          <p className="mt-2 text-xs uppercase tracking-widest text-stone-400">Distributed auctions</p>
        </div>
        <div className="my-12 max-w-lg">
          <p className="text-xs font-semibold uppercase tracking-wider text-emerald-300">Sistema de leilão distribuído</p>
          <h1 className="mt-4 text-4xl font-black sm:text-5xl">Seu próximo lance começa aqui.</h1>
          <p className="mt-5 text-stone-300">Acompanhe os leilões e faça suas ofertas em uma plataforma distribuída.</p>
        </div>
        <p className="text-sm text-stone-400">Projeto acadêmico · Sistemas Distribuídos</p>
      </section>
      <section className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-md">
          <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">Acesso à plataforma</p>
          <h2 className="my-3 text-3xl font-bold">{register ? 'Criar conta' : 'Entrar na sua conta'}</h2>
          <p className="muted mb-6">{register ? 'Cadastre-se como cliente para participar dos leilões.' : 'Entre com seu e-mail e senha.'}</p>
          <form key={String(register)} onSubmit={submit} className="space-y-4">
            {register && (
              <label className="field">
                Nome completo
                <input name="name" autoComplete="name" minLength={2} maxLength={60} required />
              </label>
            )}
            <label className="field">
              E-mail
              <input name="email" type="email" autoComplete="email" maxLength={254} required />
            </label>
            <label className="field">
              Senha
              <input name="password" type="password" autoComplete={register ? 'new-password' : 'current-password'} minLength={8} maxLength={128} required />
            </label>
            {(error || initialError) && <p role="alert" className="rounded-lg bg-red-100 p-3 text-sm text-red-800">{error || initialError}</p>}
            <button type="submit" className="btn primary w-full" disabled={busy}>
              {busy ? 'Aguarde…' : register ? 'Criar minha conta' : 'Entrar'}
            </button>
          </form>
          <button type="button" className="mt-5 text-sm font-semibold text-emerald-800 underline" disabled={busy} onClick={() => { setRegister(!register); setError(''); }}>
            {register ? 'Já tenho uma conta. Entrar' : 'Não tem conta? Cadastre-se'}
          </button>
        </div>
      </section>
    </main>
  );
}
