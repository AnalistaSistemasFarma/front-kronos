import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { prisma } from '../../../../lib/prisma';
import { synerlinkPasswordVerifier } from '../../../../lib/auth/verifyPassword';
import { readClientOrigin } from '../../../../lib/chat/client-origin';
import { assertNoBloqueado, limiteReautenticacion } from '../../../../lib/bitacora-proceso/firmas';
import { isOtError } from '../../../../lib/bitacora-proceso/rules';
import { FirmaImagenError } from '../../../../lib/firma-gss/png';
import { parseFirmaNueva, registrarFirmaGss } from '../../../../lib/firma-gss/miFirma';
import { consultarFirmaGss, firmaGssDeps } from '../../../../lib/firma-gss/server';

export const dynamic = 'force-dynamic';

/**
 * «MI FIRMA» en GSS Firma (maestro de firmas compartido de SynerLink).
 *
 * GET  — la firma registrada de la persona de la SESIÓN.
 * POST { imagen: data:image/png;base64,…, metodo: 'drawn'|'uploaded', password }
 *      — registra la firma PROPIA (dibujada o imagen de su firma manuscrita)
 *        tras reautenticarse con la contraseña de SynerLink. La imagen se
 *        valida y se recodifica en el servidor y queda auditada.
 * El correo NUNCA se toma del cuerpo: si viene uno distinto, 403.
 * No toca el SGC (tiene su propio maestro y su interruptor «firma propia»).
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
    return json(await consultarFirmaGss(s.email));
  } catch (error) {
    console.error('[firma-gss/mi-firma GET]', error);
    return json({ error: 'No se pudo consultar su firma.' }, 500);
  }
}

export async function POST(request: Request) {
  try {
    const s = await sesion();
    if (s instanceof Response) return s;
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') return json({ error: 'Petición inválida' }, 400);
    if (body.email !== undefined && String(body.email).trim().toLowerCase() !== s.email.toLowerCase()) {
      return json({ error: 'Solo puede registrar su propia firma.' }, 403);
    }
    const firma = parseFirmaNueva({ imagen: body.imagen, metodo: body.metodo });
    const password = typeof body.password === 'string' ? body.password : '';
    if (!password || password.length > 200) return json({ error: 'Escriba su contraseña de SynerLink para guardar su firma.' }, 400);

    assertNoBloqueado(limiteReautenticacion, s.email);
    const ok = await synerlinkPasswordVerifier(prisma)(s.email, password);
    if (!ok) {
      limiteReautenticacion.registrarFallo(s.email);
      return json({ error: 'Contraseña incorrecta: la firma no se guardó.' }, 403);
    }
    limiteReautenticacion.limpiar(s.email);

    const { clientIp, userAgent } = readClientOrigin(request);
    const r = await registrarFirmaGss(firmaGssDeps(), { idUser: s.idUser, email: s.email, firma: firma!, origen: 'perfil', ip: clientIp, userAgent });
    if (!r.guardada) return json({ error: `No se pudo guardar la firma en GSS Firma: ${r.error ?? 'sin respuesta'}` }, 502);
    return json({ ok: true, hasSignature: true, dataUrl: r.dataUrl, method: firma!.metodo }, 201);
  } catch (error) {
    if (error instanceof FirmaImagenError) return json({ error: error.message }, 400);
    if (isOtError(error)) return json({ error: error.message }, error.status);
    console.error('[firma-gss/mi-firma POST]', error);
    return json({ error: 'No se pudo guardar su firma.' }, 500);
  }
}
