/**
 * PORTAL DE TALENTO HUMANO — quién entra y cómo se comprueba.
 *
 * El portal NO usa la sesión de SynerLink. Entra cualquier colaborador del
 * grupo, tenga o no usuario en la plataforma, y por eso la identidad se
 * comprueba con un código de un solo uso enviado a su correo.
 *
 * Cristian pidió al principio aceptar CUALQUIER correo. No se hizo, y la razón
 * está aquí escrita para que no se deshaga por descuido: un código enviado a
 * un correo cualquiera prueba que la persona es dueña de ese buzón, no que
 * trabaje en el grupo. Con eso, el portal sería público con un paso de más —y
 * adentro hay anuncios internos y cumpleaños, que son datos de personas—. La
 * salida acordada fue esta: dominios del grupo automáticos, más una lista de
 * excepciones que Talento Humano mantiene para quien no tiene correo
 * corporativo.
 */
import { createHash, createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { prisma } from '../prisma';
import {
  CODIGO_MAX_INTENTOS,
  CODIGO_VIGENCIA_MINUTOS,
  SESION_HORAS,
  dominiosAutorizados,
} from './config';
import { leerExcepciones } from './sharepoint';

const hash = (v: string) => createHash('sha256').update(v).digest('hex');

/** Normaliza un correo: minúsculas y sin espacios. */
export function normalizarCorreo(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  const correo = valor.trim().toLowerCase();
  // Deliberadamente simple: la comprobación de verdad es que el código llegue.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo) || correo.length > 255) return null;
  return correo;
}

/** ¿Este correo puede entrar? Por dominio del grupo, o por excepción. */
export async function correoAutorizado(correo: string): Promise<boolean> {
  const dominio = correo.split('@')[1] ?? '';
  if (dominiosAutorizados().includes(dominio)) return true;
  return (await leerExcepciones()).has(correo);
}

/**
 * Emite un código y devuelve el valor en claro para poder enviarlo.
 *
 * El valor en claro NO se guarda: en la base queda solo su SHA-256. Quien lea
 * la tabla —o un respaldo— no puede entrar con lo que ve.
 *
 * Los códigos anteriores de ese correo se marcan usados: pedir uno nuevo tiene
 * que invalidar el viejo, o quien se quedó con el correo anterior sigue
 * teniendo una llave válida.
 */
export async function emitirCodigo(correo: string): Promise<string> {
  const codigo = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const ahora = new Date();

  await prisma.$transaction([
    prisma.portalAccessCode.updateMany({
      where: { email: correo, used_at: null },
      data: { used_at: ahora },
    }),
    prisma.portalAccessCode.create({
      data: {
        email: correo,
        code_hash: hash(codigo),
        created_at: ahora,
        expires_at: new Date(ahora.getTime() + CODIGO_VIGENCIA_MINUTOS * 60_000),
      },
    }),
  ]);

  return codigo;
}

export type ResultadoVerificacion =
  | { ok: true }
  | { ok: false; motivo: 'sin-codigo' | 'vencido' | 'agotado' | 'incorrecto' };

/**
 * Comprueba el código del correo.
 *
 * Se cuentan los intentos y a los cinco el código muere: seis dígitos son un
 * millón de combinaciones y sin tope se prueban en minutos. Y se usa
 * comparación de tiempo constante — no por paranoia, sino porque no cuesta
 * nada y evita tener que razonar sobre si el `===` filtra algo.
 */
export async function verificarCodigo(
  correo: string,
  codigo: string
): Promise<ResultadoVerificacion> {
  const fila = await prisma.portalAccessCode.findFirst({
    where: { email: correo, used_at: null },
    orderBy: { id: 'desc' },
  });

  if (!fila) return { ok: false, motivo: 'sin-codigo' };
  if (fila.expires_at.getTime() < Date.now()) return { ok: false, motivo: 'vencido' };
  if (fila.attempts >= CODIGO_MAX_INTENTOS) return { ok: false, motivo: 'agotado' };

  const esperado = Buffer.from(fila.code_hash, 'utf8');
  const recibido = Buffer.from(hash(String(codigo).trim()), 'utf8');
  const coincide = esperado.length === recibido.length && timingSafeEqual(esperado, recibido);

  if (!coincide) {
    await prisma.portalAccessCode.update({
      where: { id: fila.id },
      data: { attempts: { increment: 1 } },
    });
    return { ok: false, motivo: 'incorrecto' };
  }

  await prisma.portalAccessCode.update({
    where: { id: fila.id },
    data: { used_at: new Date() },
  });
  return { ok: true };
}

/* ─────────────────────────── Sesión del portal ─────────────────────────── */

/**
 * El secreto con el que se firma la sesión.
 *
 * Se reutiliza el de NextAuth para no agregar una variable más que alguien
 * tenga que acordarse de poner en cada entorno. Si falta, se lanza: es
 * preferible que el portal no arranque a que firme con una cadena vacía y
 * cualquiera pueda fabricarse una sesión.
 */
function secreto(): string {
  const s = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? '';
  if (!s) throw new Error('Falta NEXTAUTH_SECRET: el portal no puede firmar sesiones.');
  return s;
}

/**
 * Ficha de sesión: `correo.vencimiento.firma`.
 *
 * Firmada y no cifrada a propósito: adentro solo va el correo de quien entró,
 * que esa misma persona ya conoce. Lo que hay que impedir es que se la
 * fabrique, y para eso basta la firma.
 */
export function firmarSesion(correo: string): string {
  const vence = Date.now() + SESION_HORAS * 3_600_000;
  const cuerpo = `${Buffer.from(correo, 'utf8').toString('base64url')}.${vence}`;
  const firma = createHmac('sha256', secreto()).update(cuerpo).digest('base64url');
  return `${cuerpo}.${firma}`;
}

/** Devuelve el correo de una ficha válida, o null. */
export function leerSesion(ficha: string | undefined | null): string | null {
  if (!ficha) return null;
  const partes = ficha.split('.');
  if (partes.length !== 3) return null;

  const [correoB64, venceTxt, firma] = partes;
  const cuerpo = `${correoB64}.${venceTxt}`;
  const esperada = createHmac('sha256', secreto()).update(cuerpo).digest('base64url');

  const a = Buffer.from(firma, 'utf8');
  const b = Buffer.from(esperada, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const vence = Number(venceTxt);
  if (!Number.isFinite(vence) || vence < Date.now()) return null;

  return Buffer.from(correoB64, 'base64url').toString('utf8') || null;
}
