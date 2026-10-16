import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { resolveUserIdByEmail } from '../../../../lib/request-general/dashboardAccess';
import {
  StartPageStoreUnavailableError,
  getSavedStartPage,
  isValidStartPageUrl,
  listStartPageOptions,
  saveStartPage,
} from '../../../../lib/profile/startPage';

/**
 * Página de inicio personalizada (Perfil → Accesibilidad).
 * GET → { available, current, options }   · current = null es "automático".
 * PUT { url: string | null } → guarda (o vuelve a automático con null).
 * La persona sale siempre de la sesión; la URL debe estar entre SUS opciones.
 */

async function sessionUser() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return null;
  const userId = await resolveUserIdByEmail(email);
  return userId ? { email, userId } : null;
}

export async function GET() {
  try {
    const user = await sessionUser();
    if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

    const options = await listStartPageOptions(user.email, user.userId);
    let current: string | null = null;
    let available = true;
    try {
      current = await getSavedStartPage(user.userId);
    } catch (err) {
      if (!(err instanceof StartPageStoreUnavailableError)) throw err;
      available = false;
    }
    // Si ya no tiene acceso a la guardada, se muestra como automático.
    if (current && !options.some((o) => o.url === current)) current = null;

    return NextResponse.json({ available, current, options }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Error GET /api/profile/start-page:', error);
    return NextResponse.json({ error: 'No se pudo cargar la página de inicio' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const user = await sessionUser();
    if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

    const body = (await req.json().catch(() => null)) as { url?: unknown } | null;
    const url = body?.url ?? null;
    if (url !== null && !isValidStartPageUrl(url)) {
      return NextResponse.json({ error: 'Página no válida' }, { status: 400 });
    }
    if (url !== null) {
      const options = await listStartPageOptions(user.email, user.userId);
      if (!options.some((o) => o.url === url)) {
        return NextResponse.json({ error: 'No tienes acceso a esa página' }, { status: 403 });
      }
    }

    await saveStartPage(user.userId, url);
    return NextResponse.json({ ok: true, current: url });
  } catch (error) {
    if (error instanceof StartPageStoreUnavailableError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    console.error('Error PUT /api/profile/start-page:', error);
    return NextResponse.json({ error: 'No se pudo guardar la página de inicio' }, { status: 500 });
  }
}
