import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getPageStaffSession } from '../../lib/server/page-session';
import { logout } from '../login/actions';

export default async function PainelLayout({ children }: { children: React.ReactNode }) {
  const session = await getPageStaffSession();
  if (!session) redirect('/login');

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 bg-zinc-900">
        <div className="mx-auto flex max-w-6xl items-center justify-between p-4">
          <div className="flex items-center gap-6">
            <span className="text-sm font-bold text-amber-400">Caseirinhas Engine</span>
            <nav className="flex gap-4 text-sm text-zinc-300">
              <Link href="/painel" className="hover:text-amber-400">
                Leads
              </Link>
              <Link href="/painel/campanhas" className="hover:text-amber-400">
                Campanhas
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-3 text-xs text-zinc-400">
            <span>
              {session.email} · <span className="uppercase text-amber-400">{session.role}</span>
            </span>
            <form action={logout}>
              <button type="submit" className="rounded border border-zinc-700 px-2 py-1 hover:border-amber-400">
                Sair
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-6">{children}</main>
    </div>
  );
}
