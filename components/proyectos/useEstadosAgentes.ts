'use client';

import { useEffect, useRef, useState } from 'react';
import {
  EVENTO_ESTADO_PROYECTOS,
  estadosDelEvento,
  mapaDeEstados,
  mezclarEstados,
  vistaEstadoAgente,
  type EstadoAgenteProyectoDto,
} from '../../lib/proyectos/estado-agente';

/** Cada cuánto se vuelve a pintar mientras alguien trabaja, para que un estado rancio deje de decir «trabajando». */
const REPINTAR_MS = 60_000;

/**
 * Estado en vivo de los agentes en conversaciones de proyecto (2026-10-20).
 *
 * Arranca con lo que trajo la API al cargar (`semilla`) y se mantiene al día
 * con EVENTO_ESTADO_PROYECTOS, que emite ChatPulse con lo que llega por el
 * long-poll que ya existe. No hace ninguna petición propia. `filtro` deja
 * pasar solo lo de esta pantalla (por ejemplo, un proyecto).
 *
 * Mientras haya alguien trabajando, se vuelve a pintar cada minuto (sin red):
 * así un «trabajando» que se quedó sin refrescar (sesión caída) se apaga solo
 * con la misma regla del chat (estado rancio).
 */
export function useEstadosAgentes(
  semilla: readonly EstadoAgenteProyectoDto[] | null | undefined,
  filtro?: (e: EstadoAgenteProyectoDto) => boolean
): ReadonlyMap<number, EstadoAgenteProyectoDto> {
  const [mapa, setMapa] = useState<ReadonlyMap<number, EstadoAgenteProyectoDto>>(() => mapaDeEstados(semilla));
  const filtroRef = useRef(filtro);
  filtroRef.current = filtro;

  // Una semilla nueva (la pantalla recargó) se mezcla: gana lo más reciente.
  useEffect(() => {
    if (!semilla) return;
    setMapa((actual) => mezclarEstados(actual, semilla));
  }, [semilla]);

  useEffect(() => {
    const alEstado = (ev: Event) => {
      const f = filtroRef.current;
      const estados = estadosDelEvento((ev as CustomEvent).detail).filter((e) => (f ? f(e) : true));
      if (estados.length > 0) setMapa((actual) => mezclarEstados(actual, estados));
    };
    window.addEventListener(EVENTO_ESTADO_PROYECTOS, alEstado);
    return () => window.removeEventListener(EVENTO_ESTADO_PROYECTOS, alEstado);
  }, []);

  const alguien = [...mapa.values()].some((e) => vistaEstadoAgente(e, e.agent.displayName).trabajando);
  const [, setTic] = useState(0);
  useEffect(() => {
    if (!alguien) return;
    const id = window.setInterval(() => setTic((n) => n + 1), REPINTAR_MS);
    return () => window.clearInterval(id);
  }, [alguien]);

  return mapa;
}
