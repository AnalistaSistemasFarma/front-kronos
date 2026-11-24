'use client';

import { useEffect, useState } from 'react';
import { Group, Text } from '@mantine/core';
import { IconClock } from '@tabler/icons-react';
import { fmtHora } from './otClient';

/** Desfase (ms) a partir del cual se avisa que el reloj del equipo no coincide con el servidor. */
export const OT_DESFASE_AVISO_MS = 60_000;

/**
 * Reloj VIVO con la hora del servidor (reunión de mejoras con Farmalógica, 2026-11-24): los
 * registros llevan la hora del servidor, pero algunos equipos de planta tienen el reloj
 * corrido 2 o 3 minutos y el batch record manual no cuadraba. El servidor manda su hora en
 * cada consulta del detalle; aquí se calcula el desfase con el reloj del equipo y se muestra
 * la hora del servidor segundo a segundo, para copiar ESA hora en los formatos manuales.
 */
export default function OtRelojServidor({ ahoraServidor }: { ahoraServidor: string | null | undefined }) {
  const [desfase, setDesfase] = useState<number | null>(null);
  const [ahora, setAhora] = useState<number | null>(null);

  useEffect(() => {
    const t = ahoraServidor ? Date.parse(ahoraServidor) : NaN;
    if (Number.isFinite(t)) setDesfase(t - Date.now());
  }, [ahoraServidor]);

  useEffect(() => {
    if (desfase === null) return;
    const tick = () => setAhora(Date.now() + desfase);
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [desfase]);

  if (desfase === null || ahora === null) return null;
  const minutos = Math.round(Math.abs(desfase) / 60_000);
  return (
    <div data-testid='ot-reloj-servidor'>
      <Group gap={6} wrap='nowrap'>
        <IconClock size={16} />
        <Text size='sm'>
          Hora del servidor: <b data-testid='ot-reloj-servidor-hora'>{fmtHora(new Date(ahora).toISOString())}</b>
        </Text>
      </Group>
      {Math.abs(desfase) >= OT_DESFASE_AVISO_MS && (
        <Text size='xs' c='orange.8' fw={600} data-testid='ot-reloj-desfase'>
          El reloj de este equipo está {minutos >= 1 ? `${minutos} min` : 'unos segundos'} {desfase > 0 ? 'atrasado' : 'adelantado'} frente al servidor. Use la hora del servidor y avise a Tecnología.
        </Text>
      )}
    </div>
  );
}
