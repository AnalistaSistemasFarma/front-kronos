/**
 * Correo del SGC (avisos de vencimiento) por el servicio de correo COMPARTIDO
 * de SynerLink (`API_EMAIL`, el mismo que usa /api/email/send): el plan lo
 * permite como utilidad compartida («notificaciones push/correo — Reutiliza»).
 * Este módulo solo arma el mensaje y lo entrega del lado del servidor (el
 * programador corre sin sesión, así que no puede pasar por /api/email/send).
 *
 * Nunca rompe el aviso: si el servicio no está configurado o falla, devuelve
 * el resultado por destinatario para dejarlo en la auditoría.
 */

export interface SgcEmailMessage {
  to: string;
  title: string;
  /** Filas «etiqueta → valor» que el servicio pinta como tabla. */
  rows: { label: string; value: string }[];
  outro: string;
}

export type SgcEmailResult = { to: string; ok: true } | { to: string; ok: false; error: string };

export type SgcMailer = (messages: SgcEmailMessage[]) => Promise<SgcEmailResult[]>;

const FROM_DEFAULT = 'notificador@gsslatam.com';
const LOGO = 'https://farmalogica.com.co/imagenes/logos/logo20.png';

/** Escapa HTML (el servicio de correo pinta la tabla como HTML). */
export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Cuerpo para el servicio de correo (mismo formato que /api/email/send). */
export function buildEmailPayload(message: SgcEmailMessage, from: string = FROM_DEFAULT) {
  const table = `<table>${message.rows.map((r) => `<tr><td><b>${escapeHtml(r.label)}</b></td><td>${escapeHtml(r.value)}</td></tr>`).join('')}</table>`;
  return {
    userEmail: message.to,
    title: message.title,
    table,
    outro: message.outro,
    logoUrl: LOGO,
    from: `GSS LATAM <${from}>`,
    fromEmail: from,
    sender: from,
    mailFrom: from,
  };
}

export function emailServiceUrl(base: string): string {
  return `${base.trim().replace(/\/+$/, '')}/sapsend/sendMessage`;
}

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number }>;

/** Mailer real (o con `fetch` simulado en pruebas). */
export function createSgcMailer(env: Record<string, string | undefined> = process.env as Record<string, string | undefined>, fetcher: Fetch = fetch as unknown as Fetch): SgcMailer {
  return async (messages) => {
    if (!env.API_EMAIL) return messages.map((m) => ({ to: m.to, ok: false as const, error: 'Servicio de correo no configurado (API_EMAIL).' }));
    const url = emailServiceUrl(env.API_EMAIL);
    const results: SgcEmailResult[] = [];
    for (const m of messages) {
      try {
        const res = await fetcher(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildEmailPayload(m, env.SGC_EMAIL_FROM || FROM_DEFAULT)),
          signal: AbortSignal.timeout(20_000),
        });
        results.push(res.ok ? { to: m.to, ok: true } : { to: m.to, ok: false, error: `El servicio de correo respondió ${res.status}.` });
      } catch (error) {
        results.push({ to: m.to, ok: false, error: error instanceof Error ? error.message.slice(0, 200) : 'Error de red' });
      }
    }
    return results;
  };
}

/** No envía nada (pruebas). */
export const noopMailer: SgcMailer = async (messages) => messages.map((m) => ({ to: m.to, ok: true as const }));
