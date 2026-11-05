import 'server-only';
import { horasEntreAvisos, notificacionActiva, parsePublicacion } from './errors';
import { ambienteServidor, ErroresNoDisponibles, publicarErrores, resolverHuellas, type ResultadoPublicacion } from './errors-db';
import { leerParaAvisos } from './scheduled-db';
import { planAvisos } from './scheduled-avisos';

export interface ResultadoAvisos {
  /** false si el panel de Errores de IA no está en este ambiente (no falla la publicación). */
  disponible: boolean;
  muertas: number;
  fallando: number;
  resueltos: number;
  notificacionActiva: boolean;
  notificar: ResultadoPublicacion['notificar'];
}

/**
 * Tras publicar el inventario: evalúa la salud de las automatizaciones de los
 * equipos leídos y registra las muertas o fallando en «Errores de IA». Nunca
 * hace fallar la publicación del inventario.
 */
export async function avisarSalud(hostsLeidos: string[]): Promise<ResultadoAvisos> {
  const vacio: ResultadoAvisos = {
    disponible: false,
    muertas: 0,
    fallando: 0,
    resueltos: 0,
    notificacionActiva: notificacionActiva(),
    notificar: [],
  };
  try {
    const jobs = await leerParaAvisos(hostsLeidos);
    const ambiente = await ambienteServidor();
    const plan = planAvisos(jobs, ambiente);
    const notificar = notificacionActiva();
    const pub = await publicarErrores(parsePublicacion({ host: 'Recolector de automatizaciones', eventos: plan.eventos }), {
      notificar,
      horas: horasEntreAvisos(),
    });
    const resueltos = await resolverHuellas(plan.resolver, 'recolector (la automatización volvió a correr bien o se pausó)');
    return {
      disponible: true,
      muertas: jobs.filter((j) => j.salud === 'muerta').length,
      fallando: jobs.filter((j) => j.salud === 'fallando').length,
      resueltos,
      notificacionActiva: notificar,
      notificar: pub.notificar,
    };
  } catch (e) {
    if (e instanceof ErroresNoDisponibles) return vacio;
    console.error('[agent-audit/programadas] no se pudo registrar el aviso de salud:', e);
    return vacio;
  }
}
