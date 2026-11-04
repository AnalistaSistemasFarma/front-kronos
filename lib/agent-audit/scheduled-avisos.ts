import { calcularHuella } from './errors';
import type { Ambiente } from './errors-catalog';
import type { Salud } from './scheduled-salud';

/**
 * AVISO de automatizaciones «muertas» o «fallando» (2026-11-04). Parte PURA.
 *
 * No hay un canal de avisos nuevo: cada automatización con problema se registra
 * como un error del panel «Errores de IA» (tipo 'automatizacion', severidad
 * alta) y usa SU mecanismo de notificación a Nicolás: agrupado en un solo
 * mensaje y como máximo un aviso por error cada AGENT_ERRORS_NOTIFY_HOURS.
 *   - Cada hora programada que no se cumplió (o cada corrida fallida) es una
 *     ocurrencia nueva; la misma no se cuenta dos veces (clave del evento).
 *   - Cuando la automatización vuelve a correr bien (o se pausa a propósito), su
 *     error abierto se da por resuelto; si vuelve a fallar, se reabre y avisa.
 */

export interface JobParaAviso {
  code: string;
  host: string;
  clave: string;
  nombre: string;
  salud: Salud;
  saludDetalle: string | null;
  esperada: string | null;
  ultimaCorrida: string | null;
  vistoAt: string | null;
}

const EQUIPO: Record<string, string> = {
  local: 'Mac de Horus',
  jorge: 'Mac de Jorge',
  pedro: 'Mac de Pedro',
  lisa: 'Mac de Lisa',
  cosmo: 'Mac de Cosmo',
};

export const tituloMuerta = (j: Pick<JobParaAviso, 'nombre' | 'host'>) =>
  `La automatización «${j.nombre}» (${EQUIPO[j.host] ?? j.host}) no corrió a su hora`;
export const tituloFallando = (j: Pick<JobParaAviso, 'nombre' | 'host'>) =>
  `La automatización «${j.nombre}» (${EQUIPO[j.host] ?? j.host}) está fallando`;

export interface PlanAvisos {
  /** Eventos crudos para parsePublicacion (errors.ts). */
  eventos: Record<string, unknown>[];
  /** Huellas a dar por resueltas (la automatización está bien o pausada). */
  resolver: string[];
}

export function planAvisos(jobs: JobParaAviso[], ambiente: Ambiente): PlanAvisos {
  const eventos: Record<string, unknown>[] = [];
  const resolver: string[] = [];
  for (const j of jobs) {
    const base = { agente: j.code, tipo: 'automatizacion', severidad: 'alta', ambiente, host: EQUIPO[j.host] ?? j.host };
    if (j.salud === 'muerta') {
      const cuando = j.esperada ?? j.ultimaCorrida ?? j.vistoAt;
      if (!cuando) continue;
      eventos.push({
        ...base,
        titulo: tituloMuerta(j),
        detalle: j.saludDetalle,
        clave: `prog|${j.clave}|muerta|${cuando}`,
        ocurrioEn: cuando,
      });
    } else if (j.salud === 'fallando') {
      const cuando = j.ultimaCorrida ?? j.vistoAt;
      if (!cuando) continue;
      eventos.push({
        ...base,
        titulo: tituloFallando(j),
        detalle: j.saludDetalle,
        clave: `prog|${j.clave}|falla|${cuando}`,
        ocurrioEn: cuando,
      });
    } else if (j.salud === 'ok' || j.salud === 'pausada') {
      resolver.push(calcularHuella(j.code, 'automatizacion', ambiente, tituloMuerta(j)));
      resolver.push(calcularHuella(j.code, 'automatizacion', ambiente, tituloFallando(j)));
    }
  }
  return { eventos, resolver };
}
