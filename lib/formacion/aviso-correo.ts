/**
 * MÓDULO FORMACIÓN — aviso por correo de una divulgación (2026-10-26).
 * Solo a quien NO tiene usuario de SynerLink (los demás lo ven en el ícono del
 * header). Mismo servicio de correo que la invitación a un curso.
 */
import 'server-only';
import { urlDelCurso, urlPublicaDelPortal } from '../portal/invitar-curso';

const LOGO_POR_DEFECTO = 'https://farmalogica.com.co/imagenes/logos/logo20.png';
/** Tope de correos por divulgación: un freno, no una cuota. */
export const MAX_CORREOS_POR_DIVULGACION = 300;

const linea = (t: string, max: number) => t.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

export async function avisarDivulgacionPorCorreo(d: {
  correos: string[];
  cursoId: number;
  cursoTitulo: string;
  material: string | null;
  mensaje: string | null;
}): Promise<{ enviados: number; fallidos: number }> {
  const base = (process.env.API_EMAIL ?? '').trim().replace(/\/+$/, '');
  const portal = urlPublicaDelPortal();
  if (!base || !portal) return { enviados: 0, fallidos: d.correos.length };
  const curso = linea(d.cursoTitulo, 255);
  const que = d.material ? `Nuevo material en el curso ${curso}: ${linea(d.material, 255)}` : `Nuevo curso: ${curso}`;
  let enviados = 0;
  let fallidos = 0;
  for (const correo of d.correos.slice(0, MAX_CORREOS_POR_DIVULGACION)) {
    try {
      const res = await fetch(`${base}/sapsend/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userEmail: correo,
          title: que,
          table: [{ Curso: curso }, ...(d.material ? [{ Material: linea(d.material, 255) }] : [])],
          outro: `${d.mensaje ? linea(d.mensaje, 1000) + '\n\n' : ''}Ingrese a Formación para verlo: ${urlDelCurso(portal, d.cursoId)}`,
          logoUrl: process.env.PORTAL_TH_LOGO || LOGO_POR_DEFECTO,
        }),
        signal: AbortSignal.timeout(20000),
      });
      if (res.ok) enviados++;
      else fallidos++;
    } catch {
      fallidos++;
    }
  }
  return { enviados, fallidos };
}
