/**
 * PORTAL DE TALENTO HUMANO — envío del código por correo.
 *
 * Reutiliza el MISMO servicio de correo que ya usa la plataforma (`API_EMAIL`
 * → `/sapsend/sendMessage`), el de las notificaciones de casos. No se inventa
 * un mailer ni un SMTP: uno más sería otra cosa que se cae por su cuenta y que
 * hay que configurar en cada entorno.
 */
import { CODIGO_VIGENCIA_MINUTOS } from './config';

const LOGO_POR_DEFECTO = 'https://farmalogica.com.co/imagenes/logos/logo20.png';

/**
 * Manda el código de ingreso.
 *
 * Lanza si el servicio no está configurado o rechaza el envío: si el correo no
 * salió, decirle al usuario "le enviamos un código" es mentirle y lo deja
 * esperando algo que nunca llega.
 */
export async function enviarCodigo(correo: string, codigo: string): Promise<void> {
  const base = (process.env.API_EMAIL ?? '').trim().replace(/\/+$/, '');
  if (!base) throw new Error('El servicio de correo no está configurado (falta API_EMAIL).');

  const res = await fetch(`${base}/sapsend/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userEmail: correo,
      title: 'Su código para entrar al Portal de Talento Humano',
      // El servicio arma el cuerpo a partir de `table`; se manda el código en
      // una sola fila para que quede grande y separado del resto del texto.
      table: [{ 'Código de ingreso': codigo }],
      outro: `El código vence en ${CODIGO_VIGENCIA_MINUTOS} minutos y sirve una sola vez. Si usted no lo pidió, ignore este mensaje: sin el código nadie puede entrar con su correo.`,
      logoUrl: process.env.PORTAL_TH_LOGO || LOGO_POR_DEFECTO,
    }),
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) {
    const detalle = (await res.text().catch(() => '')).slice(0, 200);
    throw new Error(`El servicio de correo respondió ${res.status}. ${detalle}`);
  }
}
