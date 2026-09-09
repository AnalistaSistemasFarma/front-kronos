import { NextRequest, NextResponse } from 'next/server';
import { firmarSesion, normalizarCorreo, verificarCodigo } from '../../../../lib/portal/auth';
import { COOKIE_SESION, SESION_HORAS } from '../../../../lib/portal/config';

/**
 * Comprueba el código y abre la sesión del portal.
 *
 *   POST /api/portal/verify   { "email": "...", "code": "123456" }
 */
const MENSAJES: Record<string, string> = {
  'sin-codigo': 'No hay un código pendiente para ese correo. Pida uno nuevo.',
  vencido: 'El código venció. Pida uno nuevo.',
  agotado: 'Demasiados intentos con ese código. Pida uno nuevo.',
  incorrecto: 'El código no coincide.',
};

export async function POST(request: NextRequest) {
  try {
    const cuerpo = (await request.json().catch(() => null)) as
      | { email?: unknown; code?: unknown }
      | null;

    const correo = normalizarCorreo(cuerpo?.email);
    const codigo = typeof cuerpo?.code === 'string' ? cuerpo.code.trim() : '';
    if (!correo || !/^\d{6}$/.test(codigo)) {
      return NextResponse.json({ error: 'Escriba el correo y los seis dígitos.' }, { status: 400 });
    }

    const resultado = await verificarCodigo(correo, codigo);
    if (!resultado.ok) {
      return NextResponse.json(
        { error: MENSAJES[resultado.motivo] ?? 'No se pudo validar el código.' },
        { status: 401 }
      );
    }

    const respuesta = NextResponse.json({ ok: true, email: correo });
    respuesta.cookies.set({
      name: COOKIE_SESION,
      value: firmarSesion(correo),
      httpOnly: true,
      sameSite: 'lax',
      // `secure` solo fuera de desarrollo: en local el portal se abre por http
      // y una cookie segura nunca llegaría.
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: SESION_HORAS * 3600,
    });
    return respuesta;
  } catch (error) {
    console.error('[portal] POST /api/portal/verify', error);
    return NextResponse.json({ error: 'No se pudo validar el código.' }, { status: 500 });
  }
}
