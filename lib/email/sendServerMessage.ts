
export const DEFAULT_EMAIL_LOGO = 'https://farmalogica.com.co/imagenes/logos/logo20.png';

export type EmailTableRow = Record<string, string | number | null | undefined>;

export interface ServerMessage {
  userEmail: string;
  title: string;
  table?: EmailTableRow[];
  outro?: string;
  logoUrl?: string;
}

export interface ServerMessageResponse {
  status: number;
  body: string;
}

export class EmailServiceError extends Error {
  status?: number;
  details?: string;

  constructor(message: string, status?: number, details?: string) {
    super(message);
    this.name = 'EmailServiceError';
    this.status = status;
    this.details = details;
  }
}

export function buildEmailTargetUrl(apiEmailBase: string): string {
  const base = String(apiEmailBase).trim().replace(/\/+$/, '');
  return `${base}/sapsend/sendMessage`;
}

export async function postToEmailService(
  targetUrl: string,
  payload: ServerMessage
): Promise<ServerMessageResponse> {
  const res = await fetch(targetUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20000),
  });

  const body = await res.text();
  return { status: res.status, body };
}

export async function sendServerMessage(message: ServerMessage): Promise<ServerMessageResponse> {
  const apiEmail = process.env.API_EMAIL;
  if (!apiEmail) {
    throw new EmailServiceError('Servicio de correo no configurado (API_EMAIL)');
  }
  if (!message.userEmail || !String(message.userEmail).trim()) {
    throw new EmailServiceError('Destinatario (userEmail) requerido');
  }

  const targetUrl = buildEmailTargetUrl(apiEmail);
  const response = await postToEmailService(targetUrl, {
    userEmail: message.userEmail,
    title: message.title,
    table: message.table,
    outro: message.outro,
    logoUrl: message.logoUrl || DEFAULT_EMAIL_LOGO,
  });

  if (response.status < 200 || response.status >= 300) {
    console.error(`[sendServerMessage] ${targetUrl} respondió ${response.status}: ${response.body}`);
    throw new EmailServiceError('El servicio de correo rechazó el envío', response.status, response.body);
  }

  return response;
}
