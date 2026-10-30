'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Group, Progress, Stack, Text } from '@mantine/core';
import { IconEraser } from '@tabler/icons-react';
import { apiGet, apiSend } from '../proyectos/api';
import {
  colorDeContexto,
  contextoRancio,
  textoEstadoOrden,
  tokensCortos,
  type ContextoAgenteDto,
  type OrdenDto,
} from '../../lib/chat/agent-context';

/** Cada cuánto se relee el contexto (el ejecutor lo publica cada minuto). */
const SONDEO_MS = 60_000;
/** Mientras hay una orden activa, más seguido para ver el resultado. */
const SONDEO_ORDEN_MS = 10_000;

export interface EstadoContexto {
  contexto: ContextoAgenteDto | null;
  puedeLimpiar: boolean;
  ocupado: boolean;
  orden: OrdenDto | null;
}

const VACIO: EstadoContexto = { contexto: null, puedeLimpiar: false, ocupado: false, orden: null };

/**
 * Contexto de la sesión del agente para el hilo abierto (2026-10-29):
 * GET /api/chat/agents/<code>/contexto?conversacion=<id>, al abrir y cada 60 s
 * (cada 10 s si hay una orden de limpiar en curso). Una falla deja el último dato.
 */
export function useContextoAgente(code: string, idConversacion: number | null) {
  const [estado, setEstado] = useState<EstadoContexto>(VACIO);
  const url = `/api/chat/agents/${encodeURIComponent(code)}/contexto${idConversacion ? `?conversacion=${idConversacion}` : ''}`;
  const activa = estado.orden?.status === 'pendiente' || estado.orden?.status === 'en_curso';
  const ctrlRef = useRef<AbortController | null>(null);

  const cargar = useCallback(async () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    ctrlRef.current?.abort();
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    const r = await apiGet<Partial<EstadoContexto>>(url, '', ctrl.signal);
    if (!r.ok || ctrl.signal.aborted) return;
    setEstado({
      contexto: r.data.contexto ?? null,
      puedeLimpiar: Boolean(r.data.puedeLimpiar),
      ocupado: Boolean(r.data.ocupado),
      orden: r.data.orden ?? null,
    });
  }, [url]);

  useEffect(() => {
    setEstado(VACIO);
  }, [url]);

  useEffect(() => {
    void cargar();
    const id = window.setInterval(() => void cargar(), activa ? SONDEO_ORDEN_MS : SONDEO_MS);
    const alVolver = () => {
      if (document.visibilityState === 'visible') void cargar();
    };
    document.addEventListener('visibilitychange', alVolver);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', alVolver);
    };
  }, [cargar, activa]);

  useEffect(() => () => ctrlRef.current?.abort(), []);

  return { ...estado, recargar: cargar, setOrden: (orden: OrdenDto | null) => setEstado((e) => ({ ...e, orden })) };
}

function porcentajeTexto(p: number | null): string {
  return p === null ? '—' : `${Math.round(p).toLocaleString('es-CO')} %`;
}

const COLOR_ORDEN: Record<OrdenDto['status'], string> = {
  pendiente: 'blue',
  en_curso: 'blue',
  ok: 'teal',
  ocupado: 'yellow',
  error: 'red',
  vencida: 'yellow',
};

/**
 * DETALLE DEL CONTEXTO dentro del popover de consumo: barra 🟢 < 60 %,
 * 🟡 60–85 %, 🔴 ≥ 85 %, tokens usados / ventana, modelo y hora de la medición.
 * Para administradores, el botón «Limpiar contexto» con confirmación en dos
 * pasos (no se puede si el agente está trabajando o ya hay una orden en curso).
 */
export function DetalleContexto({
  code,
  displayName,
  idConversacion,
  estado,
  onOrden,
}: {
  code: string;
  displayName: string;
  idConversacion: number | null;
  estado: EstadoContexto & { recargar: () => Promise<void> };
  onOrden: (orden: OrdenDto | null) => void;
}) {
  const { contexto, puedeLimpiar, ocupado, orden } = estado;
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<{ color: string; texto: string } | null>(null);

  if (!contexto) return null;

  const color = colorDeContexto(contexto.percent);
  const rancio = contextoRancio(contexto);
  const ordenActiva = orden?.status === 'pendiente' || orden?.status === 'en_curso';
  const deshabilitado = ocupado || ordenActiva || enviando;
  const alcance =
    contexto.alcance === 'agente'
      ? `Es la sesión única de ${displayName}: limpiarla afecta todas sus conversaciones (guarda antes sus pendientes).`
      : 'Es la sesión de esta conversación: las demás conversaciones del agente no se tocan.';

  const limpiar = async () => {
    setEnviando(true);
    setAviso(null);
    const r = await apiSend<{ orden?: OrdenDto }>('POST', `/api/chat/agents/${encodeURIComponent(code)}/contexto`, {
      conversacion: idConversacion,
      confirmar: true,
    });
    setEnviando(false);
    setConfirmando(false);
    if (r.ok) {
      onOrden(r.data.orden ?? null);
      setAviso({ color: 'blue', texto: 'Orden registrada. La máquina del agente la toma en menos de un minuto.' });
    } else {
      setAviso({ color: r.status === 409 ? 'yellow' : 'red', texto: r.error });
    }
    void estado.recargar();
  };

  return (
    <Stack gap={6} data-testid='detalle-contexto' data-color={color} data-rancio={rancio || undefined}>
      {aviso && (
        <Alert color={aviso.color} variant='light' p='xs' data-testid='contexto-aviso'>
          <Text size='xs'>{aviso.texto}</Text>
        </Alert>
      )}
      <Group justify='space-between' wrap='nowrap' gap='xs'>
        <Text size='xs' fw={600}>
          Contexto de la sesión
        </Text>
        <Text size='xs' fw={700} c={color === 'gray' ? 'dimmed' : `${color}.7`} data-testid='contexto-porcentaje'>
          {porcentajeTexto(contexto.percent)}
        </Text>
      </Group>
      <Progress value={contexto.percent ?? 0} color={color} size={6} radius='xl' aria-hidden />
      <Text size='xs' c='dimmed'>
        {contexto.tokens === null
          ? 'Sesión nueva: todavía sin turnos.'
          : `${tokensCortos(contexto.tokens)} de ${tokensCortos(contexto.window)} tokens`}
        {contexto.model ? ` · ${contexto.model}` : ''}
      </Text>
      <Text size='xs' c='dimmed'>
        Medido {new Date(contexto.measuredAt).toLocaleString('es-CO', { hour: 'numeric', minute: '2-digit', day: 'numeric', month: 'short' })}
      </Text>
      {rancio && (
        <Text size='xs' c='yellow.8'>
          La medición está desactualizada: la máquina del agente no ha reportado en los últimos minutos.
        </Text>
      )}

      {orden && (
        <Alert color={COLOR_ORDEN[orden.status]} variant='light' p='xs' data-testid='contexto-orden' data-estado={orden.status}>
          <Text size='xs'>
            {textoEstadoOrden(orden.status)}
            {orden.result && orden.status !== 'ok' ? ` ${orden.result}` : ''}
          </Text>
          <Text size='xs' c='dimmed'>
            Pedida por {orden.requestedBy} ·{' '}
            {new Date(orden.requestedAt).toLocaleString('es-CO', { hour: 'numeric', minute: '2-digit', day: 'numeric', month: 'short' })}
          </Text>
        </Alert>
      )}

      {puedeLimpiar &&
        (confirmando ? (
          <Stack gap={6} data-testid='contexto-confirmacion'>
            <Text size='xs'>
              ¿Limpiar el contexto de {displayName}? {alcance} El historial del chat no se borra.
            </Text>
            <Group gap='xs' justify='flex-end'>
              <Button size='compact-xs' variant='default' onClick={() => setConfirmando(false)} disabled={enviando}>
                Cancelar
              </Button>
              <Button size='compact-xs' color='red' onClick={() => void limpiar()} loading={enviando} data-testid='contexto-confirmar'>
                Sí, limpiar
              </Button>
            </Group>
          </Stack>
        ) : (
          <Button
            size='compact-xs'
            variant='light'
            color={color === 'red' ? 'red' : 'gray'}
            leftSection={<IconEraser size={14} />}
            onClick={() => {
              setAviso(null);
              setConfirmando(true);
            }}
            disabled={deshabilitado}
            data-testid='contexto-limpiar'
            title={ocupado ? `${displayName} está trabajando; espere a que termine.` : ordenActiva ? 'Ya hay una orden en curso.' : undefined}
          >
            {ocupado ? 'Trabajando… no se puede limpiar' : 'Limpiar contexto'}
          </Button>
        ))}
    </Stack>
  );
}
