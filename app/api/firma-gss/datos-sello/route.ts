import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { prisma } from '../../../../lib/prisma';
import { synerlinkPasswordVerifier } from '../../../../lib/auth/verifyPassword';
import { readClientOrigin } from '../../../../lib/chat/client-origin';
import { assertNoBloqueado, limiteReautenticacion } from '../../../../lib/bitacora-proceso/firmas';
import { isOtError } from '../../../../lib/bitacora-proceso/rules';
import { DatosSelloError, guardarDatosSello, parseDatosSello } from '../../../../lib/firma-gss/datosSello';
import { consultarDatosSello, datosSelloDeps } from '../../../../lib/firma-gss/server';

export const dynamic = 'force-dynamic';

/**
 * «DATOS DEL SELLO» en GSS Firma (perfil, junto a «Mi firma»).
 *
 * GET — nombre, documento, cargo y consentimiento de la persona de la SESIÓN.
 * PUT { fullName, idDocumentType, idNumber, jobTitle, acceptedTerms?, password }
 *     — los guarda en GSS Firma (Orión) tras reautenticarse con la contraseña de
 *       SynerLink. Con estos datos, autorizar una firma la deja firmada sin modal.
 * El correo NUNCA se toma del cuerpo: si viene uno distinto, 403.
 */
const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' } as const;
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

async function sesion(): Promise<{ email: string; idUser: string } | NextResponse> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.trim();
  if (!email) return json({ error: 'No autorizado' }, 401);
  const u = await prisma.user.findFirst({ where: { email, isActive: true }, select: { id: true } });
  if (!u) return json({ error: 'No autorizado' }, 403);
  return { email, idUser: u.id };
}

export async function GET() {
  try {
    const s = await sesion();
    if (s instanceof Response) return s;
    return json(await consultarDatosSello(s.email));
  } catch (error) {
    console.error('[firma-gss/datos-sello GET]', error);
    return json({ error: 'No se pudieron consultar sus datos del sello.' }, 500);
  }
}

export async function PUT(request: Request) {
  try {
    const s = await sesion();
    if (s instanceof Response) return s;
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') return json({ error: 'Petición inválida' }, 400);
    if (body.email !== undefined && String(body.email).trim().toLowerCase() !== s.email.toLowerCase()) {
      return json({ error: 'Solo puede registrar sus propios datos.' }, 403);
    }
    const datos = parseDatosSello(body);
    const password = typeof body.password === 'string' ? body.password : '';
    if (!password || password.length > 200) {
      return json({ error: 'Escriba su contraseña de SynerLink para guardar sus datos.' }, 400);
    }

    assertNoBloqueado(limiteReautenticacion, s.email);
    const ok = await synerlinkPasswordVerifier(prisma)(s.email, password);
    if (!ok) {
      limiteReautenticacion.registrarFallo(s.email);
      return json({ error: 'Contraseña incorrecta: los datos no se guardaron.' }, 403);
    }
    limiteReautenticacion.limpiar(s.email);

    const { clientIp, userAgent } = readClientOrigin(request);
    const r = await guardarDatosSello(datosSelloDeps(), { idUser: s.idUser, email: s.email, datos, ip: clientIp, userAgent });
    return json({ ok: true, consentimientoGuardado: r.consentimientoGuardado });
  } catch (error) {
    if (error instanceof DatosSelloError) return json({ error: error.message }, error.status);
    if (isOtError(error)) return json({ error: error.message }, error.status);
    console.error('[firma-gss/datos-sello PUT]', error);
    return json({ error: 'No se pudieron guardar sus datos del sello.' }, 500);
  }
}
