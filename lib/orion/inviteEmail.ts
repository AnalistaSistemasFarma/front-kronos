/**
 * Correo de invitación a firmar vía API_EMAIL / sapsend/sendMessage.
 *
 * El mailer SAPSEND (mbx) arma el cuerpo con `title` + `table` + `outro`
 * (HTML permitido en outro). Ignora plantillas html/htmlBody propias.
 * Remitente: notificador@gsslatam.com (forzado).
 */

const DEFAULT_LOGO = 'https://farmalogica.com.co/imagenes/logos/logo20.png';
/** Remitente corporativo GSS — no usar farmalogica. */
const FROM_EMAIL = 'notificador@gsslatam.com';
const FROM_DISPLAY = `GSS LATAM <${FROM_EMAIL}>`;

function escapeHtml(value: string): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Botón CTA en HTML (SAPSEND renderiza HTML dentro de `outro`). */
function buildCtaOutro(inviteUrl: string): string {
  const url = escapeHtml(inviteUrl);
  return `
<div style="margin:28px 0 20px;text-align:center;">
  <a href="${url}"
     style="display:inline-block;padding:14px 32px;background:#0f3d68;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;border-radius:8px;letter-spacing:0.02em;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    Firma ya
  </a>
</div>
<p style="margin:0 0 12px;font-size:14px;line-height:1.55;color:#374151;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  Pulse el botón <strong>Firma ya</strong> para revisar y firmar el documento.
  Si el botón no funciona, copie este enlace en su navegador:
</p>
<p style="margin:0;font-size:12px;word-break:break-all;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <a href="${url}" style="color:#0f3d68;">${url}</a>
</p>
<p style="margin:18px 0 0;font-size:12px;color:#9ca3af;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  Grupo Shared Services LATAM · ${FROM_EMAIL}<br/>
  Si usted no esperaba este mensaje, puede ignorarlo.
</p>`.trim();
}

export async function sendExternalSignerInviteEmail(params: {
  to: string;
  signerName?: string | null;
  documentTitle?: string | null;
  requestSubject?: string | null;
  inviteUrl: string;
  expiresAt?: string | null;
}): Promise<void> {
  const base = (process.env.API_EMAIL ?? '').trim().replace(/\/+$/, '');
  if (!base) {
    throw new Error('El servicio de correo no está configurado (falta API_EMAIL).');
  }

  const to = String(params.to || '')
    .trim()
    .toLowerCase();
  if (!to || !to.includes('@')) {
    throw new Error('Correo del firmante inválido.');
  }

  const name = params.signerName?.trim() || to;
  const doc = params.documentTitle?.trim() || 'documento';
  const subject = params.requestSubject?.trim();
  const expiresLabel = params.expiresAt
    ? (() => {
        const t = Date.parse(params.expiresAt);
        return Number.isFinite(t)
          ? new Date(t).toLocaleString('es-CO', { timeZone: 'America/Bogota' })
          : params.expiresAt;
      })()
    : null;

  const logoUrl =
    process.env.ORION_INVITE_LOGO || process.env.PORTAL_TH_LOGO || DEFAULT_LOGO;
  const fromOverride = String(process.env.ORION_INVITE_FROM || '')
    .trim()
    .toLowerCase();
  const fromEmail =
    fromOverride.endsWith('@gsslatam.com') ? fromOverride : FROM_EMAIL;
  const fromDisplay =
    fromEmail === FROM_EMAIL ? FROM_DISPLAY : `GSS LATAM <${fromEmail}>`;

  const inviteUrl = String(params.inviteUrl || '').trim();
  if (!inviteUrl) {
    throw new Error('Falta la URL de firma para el correo.');
  }

  const outro = buildCtaOutro(inviteUrl);

  const res = await fetch(`${base}/sapsend/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userEmail: to,
      from: fromDisplay,
      fromEmail,
      fromMail: fromEmail,
      sender: fromEmail,
      senderEmail: fromEmail,
      mailFrom: fromEmail,
      replyTo: fromEmail,
      title: `Invitación a firmar: ${doc}`,
      table: [
        { Firmante: name },
        { Documento: doc },
        ...(subject ? [{ Solicitud: subject }] : []),
        ...(expiresLabel ? [{ 'Válido hasta': expiresLabel }] : []),
      ],
      outro,
      logoUrl,
    }),
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) {
    const detalle = (await res.text().catch(() => '')).slice(0, 200);
    throw new Error(`El servicio de correo respondió ${res.status}. ${detalle}`);
  }
}
