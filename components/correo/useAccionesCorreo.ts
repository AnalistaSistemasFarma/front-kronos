'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { correoApi, type AccionAgenteCorreo } from './correoClient';

/**
 * Propuestas del agente (tarjetas de «Consultar a un agente») de UN chat directo, por id de mensaje.
 * Se vuelve a pedir cuando cambia `senal` (llegó o se envió un mensaje): así la tarjeta aparece en
 * cuanto el agente propone. Si la persona no tiene el módulo Correo, el servidor responde vacío.
 */
export function useAccionesCorreo(idChat: number | null, senal: string) {
  const [porMensaje, setPorMensaje] = useState<Map<number, AccionAgenteCorreo>>(new Map());
  const pedido = useRef<AbortController | null>(null);

  const cargar = useCallback(async () => {
    if (!idChat) return;
    pedido.current?.abort();
    const ctrl = new AbortController();
    pedido.current = ctrl;
    try {
      const r = await correoApi.acciones(idChat, ctrl.signal);
      if (pedido.current !== ctrl) return;
      const nuevas = r.acciones.filter((a) => a.idChatMessage);
      // Mismo resultado ⇒ mismo Map: cada mensaje nuevo vuelve a pedir las
      // acciones y, con un Map nuevo (casi siempre vacío), se redibujaba el
      // hilo sin necesidad (2026-10-22).
      setPorMensaje((prev) =>
        prev.size === nuevas.length &&
        nuevas.every((a) => JSON.stringify(prev.get(a.idChatMessage as number)) === JSON.stringify(a))
          ? prev
          : new Map(nuevas.map((a) => [a.idChatMessage as number, a]))
      );
    } catch {
      /* sin el módulo o sin red: el mensaje del agente se muestra tal cual */
    }
  }, [idChat]);

  useEffect(() => {
    setPorMensaje((prev) => (prev.size === 0 ? prev : new Map()));
  }, [idChat]);

  useEffect(() => {
    void cargar();
  }, [cargar, senal]);

  useEffect(() => () => pedido.current?.abort(), []);

  return { porMensaje, refrescar: cargar };
}
