/**
 * Correo de invitación a firmar vía API_EMAIL / sapsend/sendMessage.
 *
 * El mailer SAPSEND (mbx) arma el cuerpo con `title` + `table` + `outro`
 * (HTML permitido en outro). El pie “© SAPSEND” lo añade el mailer; no es
 * la marca del producto de firma (SynerLink / GSS Firma).
 *
 * Remitente: notificador@gsslatam.com (forzado).
 */

const DEFAULT_LOGO = 'https://farmalogica.com.co/imagenes/logos/logo20.png';
/** Remitente corporativo GSS — no usar farmalogica. */
const FROM_EMAIL = 'notificador@gsslatam.com';
const FROM_DISPLAY = `GSS LATAM <${FROM_EMAIL}>`;

const BRAND = 'SynerLink';
const PRODUCT = 'GSS Firma';
const COMPANY = 'Grupo Shared Services LATAM';
const ACCENT = '#0f3d68';
const HEADING = '#1e1b4b';

const FONT =
  "font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;";

function escapeHtml(value: string): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function resolvePublicBaseUrl(): string {
  const raw =
    process.env.ORION_INVITE_APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    process.env.NEXTAUTH_URL ||
    '';
  return String(raw).trim().replace(/\/+$/, '');
}

function footerLink(href: string, label: string): string {
  return `<a href="${escapeHtml(href)}" style="color:${ACCENT};text-decoration:underline;font-size:13px;line-height:1.8;${FONT}">${escapeHtml(label)}</a>`;
}

/**
 * CTA + aviso de seguridad + atribución + enlaces.
 * Sin “código de acceso” (no hay portal DocuSign-style para ingresarlo).
 */
function buildInviteOutro(params: {
  inviteUrl: string;
  documentTitle?: string | null;
  invitedByName?: string | null;
  invitedByEmail?: string | null;
}): string {
  const url = escapeHtml(params.inviteUrl);
  const doc = String(params.documentTitle || '').trim();

  const base = resolvePublicBaseUrl();
  const contactUrl =
    process.env.ORION_INVITE_CONTACT_URL?.trim() ||
    `mailto:${FROM_EMAIL}?subject=${encodeURIComponent(`Consulta firma ${BRAND}`)}`;
  const privacyUrl =
    process.env.ORION_INVITE_PRIVACY_URL?.trim() ||
    (base ? `${base}/` : `mailto:${FROM_EMAIL}`);
  const supportUrl =
    process.env.ORION_INVITE_SUPPORT_URL?.trim() ||
    `mailto:${FROM_EMAIL}?subject=${encodeURIComponent('Soporte firma electrónica')}`;
  const termsUrl =
    process.env.ORION_INVITE_TERMS_URL?.trim() ||
    (base ? `${base}/` : `mailto:${FROM_EMAIL}`);
  const reportUrl =
    process.env.ORION_INVITE_REPORT_URL?.trim() ||
    `mailto:${FROM_EMAIL}?subject=${encodeURIComponent('Informar correo de firma')}`;

  const senderName =
    String(params.invitedByName || '').trim() ||
    String(params.invitedByEmail || '').trim() ||
    COMPANY;
  const senderEmail = String(params.invitedByEmail || '').trim();
  const year = new Date().getFullYear();

  return `
<div style="margin:28px 0 20px;text-align:center;">
  <a href="${url}"
     style="display:inline-block;padding:14px 32px;background:${ACCENT};color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;border-radius:8px;letter-spacing:0.02em;${FONT}">
    Revisar y firmar
  </a>
</div>
<p style="margin:0 0 8px;font-size:14px;line-height:1.55;color:#374151;${FONT}">
  Pulse el botón para abrir el documento en
  <strong>${escapeHtml(PRODUCT)}</strong> (${escapeHtml(BRAND)}) y firmarlo.
</p>
${
  doc
    ? `<p style="margin:0 0 16px;font-size:13px;line-height:1.5;color:#4b5563;${FONT}">
  Documento: <strong>${escapeHtml(doc)}</strong>
</p>`
    : ''
}
<p style="margin:0 0 24px;font-size:13px;line-height:1.5;color:#6b7280;${FONT}">
  Si el botón no funciona, copie este enlace en su navegador:<br/>
  <a href="${url}" style="color:${ACCENT};word-break:break-all;">${url}</a>
</p>

<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />

<p style="margin:0 0 6px;font-size:15px;font-weight:700;color:${HEADING};${FONT}">
  No comparta este correo electrónico
</p>
<p style="margin:0 0 20px;font-size:14px;line-height:1.55;color:#111827;${FONT}">
  Este mensaje contiene un enlace seguro a ${escapeHtml(PRODUCT)} (${escapeHtml(BRAND)}).
  No comparta este correo electrónico ni el enlace con otras personas.
</p>

<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />

<p style="margin:0 0 14px;font-size:12px;line-height:1.5;color:#6b7280;${FONT}">
  Copyright © ${year} ${escapeHtml(COMPANY)}. Todos los derechos reservados.
  Servicio de firma electrónica ${escapeHtml(BRAND)} / ${escapeHtml(PRODUCT)}.
</p>

<p style="margin:0 0 20px;font-size:13px;line-height:1.55;color:#374151;${FONT}">
  Este mensaje se lo ha enviado <strong>${escapeHtml(senderName)}</strong>${
    senderEmail ? ` (${escapeHtml(senderEmail)})` : ''
  }, que utiliza el servicio de firma electrónica ${escapeHtml(BRAND)}.
  Si prefiere no recibir mensajes de este remitente, envíele una solicitud o escriba a
  <a href="mailto:${FROM_EMAIL}" style="color:${ACCENT};">${FROM_EMAIL}</a>.
</p>

<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:520px;">
  <tr>
    <td style="width:50%;vertical-align:top;padding:0 12px 0 0;">
      ${footerLink(contactUrl, 'Póngase en contacto con nosotros')}<br/>
      ${footerLink(privacyUrl, 'Privacidad')}<br/>
      ${footerLink(supportUrl, 'Servicio de asistencia')}
    </td>
    <td style="width:50%;vertical-align:top;padding:0;">
      ${footerLink(termsUrl, 'Condiciones de uso')}<br/>
      ${footerLink(reportUrl, 'Informar de correo electrónico')}
    </td>
  </tr>
</table>
`.trim();
}

export async function sendExternalSignerInviteEmail(params: {
  to: string;
  signerName?: string | null;
  documentTitle?: string | null;
  requestSubject?: string | null;
  inviteUrl: string;
  expiresAt?: string | null;
  /** Quién solicitó la firma (sesión Kronos). */
  invitedByName?: string | null;
  invitedByEmail?: string | null;
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

  const outro = buildInviteOutro({
    inviteUrl,
    documentTitle: doc,
    invitedByName: params.invitedByName,
    invitedByEmail: params.invitedByEmail,
  });

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
