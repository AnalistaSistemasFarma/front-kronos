/**
 * FORMACIÓN — INVITAR A ALGUIEN A UN CURSO POR CORREO (Cristian Baldión, 2026-10-14).
 *
 * En «Vista formador» → «Progreso de los estudiantes» → «Invitar al Curso»: se escribe un correo, se le envía un mensaje que
 * lo lleva a Formación (`/portal/formacion?curso=N`) y el curso queda abierto al ingresar; además la persona queda
 * inscrita, así que aparece de una vez en el progreso del curso.
 *
 * El correo sale por el MISMO servicio que el código de ingreso al portal (`API_EMAIL` → `/sapsend/sendMessage`): no se
 * inventa otro mailer. Lanza si el servicio no está configurado o rechaza el envío: decir «invitación enviada» sin que
 * haya salido nada es mentirle a quien invitó.
 *
 * ABUSO: esta ruta hace que el portal escriba, con la cara de GSS, a un correo que escribe una persona. Por eso (1) solo
 * pueden usarla administradores/formadores, (2) el correo tiene que poder entrar al portal (dominio del grupo o
 * «Cuentas Autorizadas»), y (3) hay topes por invitador y por persona (abajo).
 */

const LOGO_POR_DEFECTO = 'https://farmalogica.com.co/imagenes/logos/logo20.png';
const ACENTO = '#1a3c6e';

/** Invitaciones por invitador en una hora, y espera entre dos invitaciones a la MISMA persona al MISMO curso. */
export const MAX_INVITACIONES_POR_HORA = 30;
export const ESPERA_MISMA_PERSONA_MS = 10 * 60_000;
const HORA_MS = 60 * 60_000;

/** Dirección pública del portal (para el enlace del correo), sin barra final ni ruta. null si no hay ninguna configurada. */
export function urlPublicaDelPortal(env: NodeJS.ProcessEnv = process.env): string | null {
  const candidatas = [env.PORTAL_TH_URL_PUBLICA, env.NEXT_PUBLIC_APP_URL, env.APP_URL, env.NEXTAUTH_URL];
  for (const c of candidatas) {
    const t = (c ?? '').trim();
    if (!t) continue;
    try {
      const u = new URL(t);
      if (u.protocol === 'https:' || u.protocol === 'http:') return u.origin;
    } catch {
      // Una variable mal escrita no tumba el envío: se prueba la siguiente.
    }
  }
  return null;
}

/** El enlace que lleva al curso: Formación abre ese curso al ingresar. */
export const urlDelCurso = (base: string, cursoId: number): string => `${base}/portal/formacion?curso=${cursoId}`;

const escapar = (t: string) =>
  t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Sin saltos de línea ni caracteres de control: el título del curso va en el asunto y en el cuerpo. */
const linea = (t: string, max: number) => t.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

export interface DatosInvitacion {
  correo: string;
  cursoTitulo: string;
  urlCurso: string;
  /** Nombre de quien invita (se muestra tal cual en el mensaje). */
  invitadoPor?: string | null;
}

/** El cuerpo HTML del mensaje: botón y, debajo, el enlace en texto por si el botón no abre. */
export function cuerpoInvitacion(d: Pick<DatosInvitacion, 'cursoTitulo' | 'urlCurso' | 'invitadoPor'>): string {
  const url = escapar(d.urlCurso);
  const curso = escapar(linea(d.cursoTitulo, 255));
  const quien = d.invitadoPor ? escapar(linea(d.invitadoPor, 120)) : '';
  const fuente = 'font-family:Segoe UI,Arial,sans-serif;';
  return `
<p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#1f2937;${fuente}">
  ${quien ? `<strong>${quien}</strong> lo invitó` : 'Lo invitaron'} al curso <strong>${curso}</strong> en el Portal de Talento Humano de Group Shared Services Latinoamérica.
</p>
<div style="margin:24px 0;text-align:center;">
  <a href="${url}" style="display:inline-block;padding:14px 32px;background:${ACENTO};color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;border-radius:8px;${fuente}">Ir al curso</a>
</div>
<p style="margin:0 0 12px;font-size:13px;line-height:1.5;color:#4b5563;${fuente}">
  Para entrar, el portal le enviará un código a este mismo correo. El curso se abrirá apenas ingrese.
</p>
<p style="margin:0;font-size:13px;line-height:1.5;color:#6b7280;${fuente}">
  Si el botón no abre, copie este enlace en su navegador:<br/>
  <a href="${url}" style="color:${ACENTO};word-break:break-all;">${url}</a>
</p>
<p style="margin:16px 0 0;font-size:12px;line-height:1.5;color:#9ca3af;${fuente}">
  Si usted no esperaba esta invitación, puede ignorar este mensaje.
</p>`;
}

/** Envía la invitación. Lanza si el servicio de correo no está configurado o rechaza el envío. */
export async function enviarInvitacionCurso(d: DatosInvitacion): Promise<void> {
  const base = (process.env.API_EMAIL ?? '').trim().replace(/\/+$/, '');
  if (!base) throw new Error('El servicio de correo no está configurado (falta API_EMAIL).');
  const curso = linea(d.cursoTitulo, 255);

  const res = await fetch(`${base}/sapsend/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userEmail: d.correo,
      title: `Lo invitaron al curso: ${curso}`,
      table: [{ Curso: curso }, ...(d.invitadoPor ? [{ 'Lo invitó': linea(d.invitadoPor, 120) }] : [])],
      outro: cuerpoInvitacion(d),
      logoUrl: process.env.PORTAL_TH_LOGO || LOGO_POR_DEFECTO,
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    // Solo el código: el detalle del servicio puede traer el correo del destinatario y no se registra.
    throw new Error(`El servicio de correo respondió ${res.status}.`);
  }
}

/* ───────────────────────────── Topes (en memoria) ─────────────────────────── */

const porInvitador = new Map<string, number[]>();
const porPersona = new Map<string, number>();

export function _reiniciarLimitesInvitacion() {
  porInvitador.clear();
  porPersona.clear();
}

export type ResultadoLimite = { ok: true } | { ok: false; motivo: 'hora' | 'reciente'; esperaMs: number };

/**
 * ¿Se puede enviar ya? Cada instancia del servidor lleva su propia cuenta: es un freno contra el abuso y los clics
 * repetidos, no una cuota exacta. NO registra nada: el envío exitoso llama a `registrarInvitacion`.
 */
export function puedeInvitar(invitador: string, cursoId: number, correo: string, ahora = Date.now()): ResultadoLimite {
  const reciente = porPersona.get(`${cursoId}|${correo}`);
  if (reciente !== undefined && ahora - reciente < ESPERA_MISMA_PERSONA_MS) {
    return { ok: false, motivo: 'reciente', esperaMs: ESPERA_MISMA_PERSONA_MS - (ahora - reciente) };
  }
  const horas = (porInvitador.get(invitador) ?? []).filter((t) => ahora - t < HORA_MS);
  if (horas.length >= MAX_INVITACIONES_POR_HORA) {
    return { ok: false, motivo: 'hora', esperaMs: HORA_MS - (ahora - horas[0]) };
  }
  return { ok: true };
}

export function registrarInvitacion(invitador: string, cursoId: number, correo: string, ahora = Date.now()) {
  const horas = (porInvitador.get(invitador) ?? []).filter((t) => ahora - t < HORA_MS);
  horas.push(ahora);
  porInvitador.set(invitador, horas);
  porPersona.set(`${cursoId}|${correo}`, ahora);
  // Limpieza: no crecer sin fin.
  if (porPersona.size > 5000) for (const [k, t] of porPersona) if (ahora - t >= ESPERA_MISMA_PERSONA_MS) porPersona.delete(k);
}
