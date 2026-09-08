'use client';

import { useEffect, useRef } from 'react';
import { describeAgentStatus, type ChatStatusDto } from '../../lib/chat/client';

/**
 * Pone en la PESTAÑA del navegador lo que están haciendo los asistentes.
 *
 * Pedido de Nicolás (2026-09-08): "me gustaría que si respondes, en el texto
 * del tab nos puedas dar status, de lo que vas haciendo". El caso de uso es
 * claro: uno le escribe, se va a trabajar en otra pestaña y quiere saber si el
 * asistente sigue ocupado sin tener que volver a mirar.
 *
 * Se monta en la barra de avatares, que vive en el encabezado de TODA la
 * aplicación: así el estado se ve desde cualquier pantalla, no solo desde el
 * chat.
 *
 * Prioridad de lo que se muestra:
 *   1. Alguien trabajando  → "⚙️ Orus: Consultando SAP… · <título>"
 *   2. Mensajes sin leer   → "(3) <título>"
 *   3. Nada                → el título de la página, intacto
 *
 * CUIDADO CON EL TÍTULO BASE: lo pone Next.js por ruta, y aquí lo estamos
 * sobrescribiendo. Para no quedarnos con un título viejo al navegar, se guarda
 * aparte el último valor que escribimos NOSOTROS: si el que hay en el
 * documento no es ese, es porque lo puso la aplicación y pasa a ser la base.
 */

/** Un `label` de agente puede ser larguísimo (nombres de archivo, rutas). */
const MAX_ETIQUETA = 40;

function recortar(texto: string): string {
  const limpio = texto.replace(/\s+/g, ' ').trim();
  return limpio.length > MAX_ETIQUETA ? `${limpio.slice(0, MAX_ETIQUETA - 1)}…` : limpio;
}

export function useTituloDeEstado(
  agentes: { idAgent: number; displayName: string }[],
  estadoPorAgente: Map<number, ChatStatusDto | null>,
  sinLeer: number
) {
  const baseRef = useRef<string>('');
  const nuestroRef = useRef<string>('');

  // Los ocupados, con su etiqueta. Se calcula en el efecto para no depender de
  // memos del componente que lo llama.
  useEffect(() => {
    if (typeof document === 'undefined') return;

    if (document.title !== nuestroRef.current) {
      baseRef.current = document.title;
    }
    const base = baseRef.current || 'SynerLink';

    const ocupados = agentes
      .map((agente) => ({ agente, vista: describeAgentStatus(estadoPorAgente.get(agente.idAgent) ?? null) }))
      .filter((x) => x.vista.busy);

    let siguiente = base;
    if (ocupados.length === 1) {
      const { agente, vista } = ocupados[0];
      siguiente = `⚙️ ${agente.displayName}: ${recortar(vista.label)} · ${base}`;
    } else if (ocupados.length > 1) {
      siguiente = `⚙️ ${ocupados.length} asistentes trabajando · ${base}`;
    } else if (sinLeer > 0) {
      siguiente = `(${sinLeer > 99 ? '99+' : sinLeer}) ${base}`;
    }

    if (document.title !== siguiente) {
      document.title = siguiente;
      nuestroRef.current = siguiente;
    }
  }, [agentes, estadoPorAgente, sinLeer]);

  // Al desmontar, devolver el título de la página. Una pestaña que se queda
  // diciendo "⚙️ trabajando" cuando ya no hay nada corriendo miente.
  useEffect(
    () => () => {
      if (typeof document === 'undefined') return;
      if (baseRef.current && document.title === nuestroRef.current) {
        document.title = baseRef.current;
      }
    },
    []
  );
}
