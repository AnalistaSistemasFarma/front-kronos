import { NextRequest, NextResponse } from 'next/server';
import { correoAutorizado, emitirCodigo, normalizarCorreo } from '../../../../lib/portal/auth';
import { enviarCodigo } from '../../../../lib/portal/correo';

/**
 * Pide un código de ingreso al Portal de Talento Humano.
 *
 *   POST /api/portal/login   { "email": "persona@gsslatam.com" }
 *
 * ⚠️ RESPONDE LO MISMO ESTÉ O NO AUTORIZADO EL CORREO.
 *
 * Si dijera "ese correo no está autorizado", el portal se convertiría en una
 * forma cómoda de averiguar quién trabaja en el grupo: se prueban correos y el
 * que responda distinto es empleado. Por eso el mensaje es siempre el mismo y
 * el código solo se envía de verdad cuando corresponde. Quien no esté
 * autorizado simplemente nunca lo recibe.
 */
export async function POST(request: NextRequest) {
  try {
    const cuerpo = (await request.json().catch(() => null)) as { email?: unknown } | null;
    const correo = normalizarCorreo(cuerpo?.email);
    if (!correo) {
      return NextResponse.json({ error: 'Escriba un correo válido.' }, { status: 400 });
    }

    const respuesta = NextResponse.json({
      ok: true,
      mensaje: 'Si su correo está autorizado, le llegará un código en unos segundos.',
    });

    if (!(await correoAutorizado(correo))) {
      console.warn(`[portal] intento de ingreso con correo no autorizado: ${correo}`);
      return respuesta;
    }

    const codigo = await emitirCodigo(correo);
    await enviarCodigo(correo, codigo);
    return respuesta;
  } catch (error) {
    // El fallo del CORREO sí se cuenta: el usuario tiene que saber que no le
    // va a llegar nada, en vez de quedarse esperando.
    console.error('[portal] POST /api/portal/login', error);
    return NextResponse.json(
      { error: 'No pudimos enviar el código. Intente de nuevo en un momento.' },
      { status: 502 }
    );
  }
}
