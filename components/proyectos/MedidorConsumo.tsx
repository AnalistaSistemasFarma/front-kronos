'use client';

import { useEffect, useState } from 'react';
import { Box, Group, Progress, Stack, Text, Tooltip } from '@mantine/core';
import { IconGauge } from '@tabler/icons-react';
import { vistaCuota, type CuotaAgenteDto, type VistaBarra } from '../../lib/proyectos/consumo-anthropic';
import { apiGet } from './api';
import css from './proyectos.module.css';

/** Cada cuánto se vuelve a leer el cupo (el puente lo refresca cada 5 min sin turnos, o en cada turno). */
export const SONDEO_CONSUMO_MS = 60_000;

/**
 * Cupo de Anthropic de los agentes del proyecto, al día: lee
 * GET /api/proyectos/<id>/consumo al abrir y cada 60 s mientras la pestaña está
 * visible (y al volver a ella). Una falla deja el último dato que hubo.
 */
export function useConsumoAnthropic(idProject: number): { agentes: CuotaAgenteDto[]; cargado: boolean } {
  const [agentes, setAgentes] = useState<CuotaAgenteDto[]>([]);
  const [cargado, setCargado] = useState(false);
  useEffect(() => {
    if (!idProject) return;
    let vivo = true;
    let ctrl: AbortController | null = null;
    const cargar = async () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      ctrl?.abort();
      ctrl = new AbortController();
      const r = await apiGet<{ agents?: CuotaAgenteDto[] }>(`/api/proyectos/${idProject}/consumo`, '', ctrl.signal);
      if (!vivo || r.status === 0) return;
      if (r.ok) setAgentes(Array.isArray(r.data.agents) ? r.data.agents : []);
      setCargado(true);
    };
    void cargar();
    const id = window.setInterval(() => void cargar(), SONDEO_CONSUMO_MS);
    const alVolver = () => {
      if (document.visibilityState === 'visible') void cargar();
    };
    document.addEventListener('visibilitychange', alVolver);
    return () => {
      vivo = false;
      ctrl?.abort();
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', alVolver);
    };
  }, [idProject]);
  return { agentes, cargado };
}

function Barra({ barra, testId }: { barra: VistaBarra; testId: string }) {
  return (
    <div style={{ minWidth: 0 }} data-testid={testId}>
      <Group justify='space-between' gap={6} wrap='nowrap'>
        <Text size='xs' fw={600} className={css.truncar}>
          {barra.etiqueta}
        </Text>
        <Text size='xs' fw={700} c={barra.color === 'gray' ? 'dimmed' : `${barra.color}.7`} className={css.medidorPorcentaje}>
          {barra.porcentaje}
        </Text>
      </Group>
      <Progress value={barra.valor} color={barra.color} size={6} radius='xl' mt={4} aria-label={`${barra.etiqueta}: ${barra.porcentaje} usado`} />
      {barra.detalle && (
        <Text size='xs' c='dimmed' mt={2} lineClamp={2}>
          {barra.detalle}
        </Text>
      )}
    </div>
  );
}

/**
 * MEDIDOR DEL CONSUMO DE ANTHROPIC en el encabezado de cada proyecto (2026-10-22):
 * «Semanal» con el % y cuándo se reinicia, y «Ventana de 5 h» con el % y a qué
 * hora se libera. Verde; amarillo desde el 70 %; rojo desde el 90 %.
 *
 * `compacto` (celular y tableta): las dos barras lado a lado para no robar alto.
 *
 * FIJO Y SIEMPRE VISIBLE (aclaración de Nicolás, 2026-10-22: «es algo estático,
 * para que todos los integrantes del grupo puedan verlo»): va en el encabezado,
 * fuera de menús y pestañas, igual para todos los miembros sin mirar el rol. Sin
 * dato todavía, muestra la caja con «Sin medición todavía» en vez de esconderse.
 * Lo esencial (porcentajes, reinicios y «token compartido») está a la vista; el
 * tooltip solo agrega la hora exacta de la medición.
 */
export default function MedidorConsumo({ agentes, compacto = false, cargado = true }: { agentes: CuotaAgenteDto[]; compacto?: boolean; cargado?: boolean }) {
  // Repinta cada minuto: el «hace X min» y el «se reinició» dependen de la hora.
  const [ahora, setAhora] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setAhora(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const varios = agentes.length > 1;

  if (agentes.length === 0) {
    return (
      <Box className={`${compacto ? css.medidorCompacto : css.medidor}`} data-testid='medidor-consumo'>
        <Box className={css.medidorCaja} data-testid='medidor-consumo-vacio'>
          <Group gap={6} wrap='nowrap'>
            <IconGauge size={14} color='var(--mantine-color-dimmed)' aria-hidden />
            <Text size='xs' c='dimmed' className={css.truncar}>
              Consumo de Anthropic · {cargado ? 'sin medición todavía' : 'cargando…'}
            </Text>
          </Group>
        </Box>
      </Box>
    );
  }

  return (
    <Stack gap={8} className={compacto ? css.medidorCompacto : css.medidor} data-testid='medidor-consumo'>
      {agentes.map((a) => {
        const v = vistaCuota(a, ahora);
        const tip = (
          <Stack gap={2}>
            <Text size='xs' fw={600}>
              Consumo del token del agente (compartido)
            </Text>
            <Text size='xs'>{v.medicion}</Text>
            {v.vieja && <Text size='xs'>La medición está desactualizada: el puente no ha reportado en los últimos minutos.</Text>}
          </Stack>
        );
        return (
          <Tooltip key={a.code} label={tip} withArrow multiline w={280} events={{ hover: true, focus: true, touch: true }} position='bottom-start'>
            <Box tabIndex={0} aria-label={`Consumo de Anthropic de ${a.displayName}`} className={css.medidorCaja} data-testid={`medidor-consumo-${a.code}`}>
              <Group gap={6} wrap='nowrap' mb={6}>
                <IconGauge size={14} color='var(--mantine-color-dimmed)' aria-hidden />
                <Text size='xs' c='dimmed' className={css.truncar}>
                  Consumo de Anthropic{varios ? ` · ${a.displayName}` : ''} · token compartido
                  {v.vieja ? ' · desactualizado' : ''}
                </Text>
              </Group>
              <div className={compacto ? css.medidorBarrasLado : css.medidorBarras}>
                {v.semanal && <Barra barra={v.semanal} testId='medidor-semanal' />}
                {v.cinco && <Barra barra={v.cinco} testId='medidor-5h' />}
              </div>
            </Box>
          </Tooltip>
        );
      })}
    </Stack>
  );
}
