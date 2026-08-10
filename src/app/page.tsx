import { redirect } from 'next/navigation';
import { getPageStaffSession } from '../lib/server/page-session';

export default async function Home() {
  const session = await getPageStaffSession();
  redirect(session ? '/painel' : '/login');
}
