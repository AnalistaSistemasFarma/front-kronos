import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '../api/auth/[...nextauth]/route';
import { resolvePersonalHomeUrl } from '../../lib/request-general/dashboardAccess';

/** Resolver de inicio: Mis procesos > Solicitante > hub. */
export default async function HomePage() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;

  if (!email) {
    redirect('/login?callbackUrl=%2Fhome');
  }

  const homeUrl = await resolvePersonalHomeUrl(email, '/process');
  redirect(homeUrl);
}
