'use client';

import { useActionState } from 'react';
import { login } from './actions';

export default function LoginPage() {
  const [state, action, pending] = useActionState(login, undefined);

  return (
    <main className="min-h-screen bg-zinc-950 flex items-center justify-center p-8 text-zinc-100">
      <form action={action} className="w-full max-w-sm rounded-xl border border-zinc-800 bg-zinc-900 p-8 space-y-4">
        <div>
          <p className="text-sm font-semibold text-amber-400">Caseirinhas Engine</p>
          <h1 className="mt-1 text-xl font-bold">Acesso da equipe</h1>
        </div>

        <div className="space-y-1">
          <label htmlFor="email" className="text-sm text-zinc-400">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="username"
            className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2 text-sm text-zinc-100 focus:border-amber-400 focus:outline-none"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="password" className="text-sm text-zinc-400">
            Senha
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2 text-sm text-zinc-100 focus:border-amber-400 focus:outline-none"
          />
        </div>

        {state?.error && <p className="text-sm text-red-400">{state.error}</p>}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-amber-400 p-2 text-sm font-bold text-zinc-950 transition-opacity disabled:opacity-60"
        >
          {pending ? 'Entrando...' : 'Entrar'}
        </button>

        <p className="text-xs text-zinc-500">
          Sem conta? Peça a um owner para criar seu acesso no Supabase Auth e conceder o papel correto em `profiles`.
        </p>
      </form>
    </main>
  );
}
