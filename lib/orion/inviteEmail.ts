/**
 * Correo de invitación a firmar (socio externo) vía API_EMAIL / sendMessage.
 */

const DEFAULT_LOGO = 'https://farmalogica.com.co/imagenes/logos/logo20.png';

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

  const res = await fetch(`${base}/sapsend/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userEmail: to,
      title: `Invitación a firmar: ${doc}`,
      table: [
        { Firmante: name },
        { Documento: doc },
        ...(subject ? [{ Solicitud: subject }] : []),
        { 'Enlace de firma': params.inviteUrl },
        ...(expiresLabel ? [{ 'Válido hasta': expiresLabel }] : []),
      ],
      outro:
        'Abra el enlace para revisar y firmar el documento. Si usted no esperaba este mensaje, ignore el correo.',
      logoUrl: process.env.ORION_INVITE_LOGO || process.env.PORTAL_TH_LOGO || DEFAULT_LOGO,
    }),
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) {
    const detalle = (await res.text().catch(() => '')).slice(0, 200);
    throw new Error(`El servicio de correo respondió ${res.status}. ${detalle}`);
  }
}
