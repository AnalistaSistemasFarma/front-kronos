import 'server-only';
import { NABUCO_MODULE_NAME } from './constants';

/**
 * Alertas por correo del módulo. Usa el MISMO servicio de correo de la plataforma
 * (`API_EMAIL` → `/sapsend/sendMessage`), igual que el Portal TH y Orion. Nunca incluye
 * contraseñas ni tokens.
 */
const LOGO_POR_DEFECTO = 'https://farmalogica.com.co/imagenes/logos/logo20.png';

export async function enviarAlerta(destinatarios: string[], titulo: string, filas: Record<string, string>[], outro: string): Promise<number> {
  const base = (process.env.API_EMAIL ?? '').trim().replace(/\/+$/, '');
  if (!base) {
    console.warn('[transferencias-nabuco] Alerta no enviada: falta API_EMAIL.');
    return 0;
  }
  let enviados = 0;
  for (const to of destinatarios) {
    try {
      const res = await fetch(`${base}/sapsend/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userEmail: to, title: `${NABUCO_MODULE_NAME} · ${titulo}`, table: filas, outro, logoUrl: LOGO_POR_DEFECTO }),
        signal: AbortSignal.timeout(20000),
      });
      if (res.ok) enviados += 1;
      else console.warn(`[transferencias-nabuco] El servicio de correo respondió ${res.status} al alertar.`);
    } catch (e) {
      console.warn('[transferencias-nabuco] No se pudo enviar la alerta:', e instanceof Error ? e.message : e);
    }
  }
  return enviados;
}
