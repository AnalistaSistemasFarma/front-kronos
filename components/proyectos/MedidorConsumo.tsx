'use client';

import { useEffect, useState } from 'react';
import { Group, Progress, Stack, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { IconGauge } from '@tabler/icons-react';
import { lineasDetalleCuota, vistaCuota, type CuotaAgenteDto, type VistaBarra } from '../../lib/proyectos/consumo-anthropic';
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

/** «Semanal ▬▬ 42 %»: etiqueta corta, mini barra y porcentaje con su color. */
function Indicador({ barra, corta, testId }: { barra: VistaBarra; corta: string; testId: string }) {
  return (
    <Group gap={6} wrap='nowrap' className={css.medidorIndicador} data-testid={testId}>
      <Text size='xs' c='dimmed' fw={500} span>
        {corta}
      </Text>
      <Progress value={barra.valor} color={barra.color} size={5} radius='xl' w={34} aria-hidden />
      <Text size='xs' fw={700} c={barra.color === 'gray' ? 'dimmed' : `${barra.color}.7`} span className={css.medidorPorcentaje}>
        {barra.porcentaje}
      </Text>
    </Group>
  );
}

/**
 * MEDIDOR DEL CONSUMO DE ANTHROPIC (2026-10-22), COMPACTO Y EN UNA LÍNEA.
 *
 * Ajuste de Nicolás: «este sidebar ya está muy cargado, quiero dejarlo más bien
 * cerca a la miga de pan, lado superior derecho». Va en la barra superior de la
 * página (a la derecha de la miga en escritorio; en el encabezado compacto en
 * celular y en la cabecera del hilo a pantalla completa) como una píldora con
 * «Semanal 42 %» y «5 h 31 %» (verde; amarillo desde 70 %; rojo desde 90 %).
 *
 * El detalle (cuándo se reinicia, a qué hora se libera, «token compartido» y la
 * hora de la medición) va en el tooltip, que abre al pasar el cursor, con el
 * teclado o al tocar la píldora (es un botón: el toque le da el foco).
 *
 * FIJO Y PARA TODOS (aclaración del 2026-10-22, «es algo estático»): nunca se
 * esconde. Sin dato todavía, la píldora dice «sin medición». No mira el rol.
 */
export default function MedidorConsumo({ agentes, cargado = true }: { agentes: CuotaAgenteDto[]; cargado?: boolean }) {
  // Repinta cada minuto: el «hace X min» y el «se reinició» dependen de la hora.
  const [ahora, setAhora] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setAhora(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  if (agentes.length === 0) {
    return (
      <Tooltip label='Consumo de Anthropic del token del agente (compartido). El asistente aún no ha reportado su medición.' withArrow multiline w={260} events={{ hover: true, focus: true, touch: true }} position='bottom-end'>
        <UnstyledButton className={css.medidorPildora} aria-label='Consumo de Anthropic: sin medición todavía' data-testid='medidor-consumo'>
          <Group gap={6} wrap='nowrap' data-testid='medidor-consumo-vacio'>
            <IconGauge size={14} color='var(--mantine-color-dimmed)' aria-hidden />
            <Text size='xs' c='dimmed' span>
              {cargado ? 'Consumo: sin medición' : 'Consumo…'}
            </Text>
          </Group>
        </UnstyledButton>
      </Tooltip>
    );
  }

  const varios = agentes.length > 1;
  return (
    <Group gap={6} wrap='nowrap' className={css.medidorFila} data-testid='medidor-consumo'>
      {agentes.map((a) => {
        const v = vistaCuota(a, ahora);
        const lineas = lineasDetalleCuota(v);
        const tip = (
          <Stack gap={2}>
            <Text size='xs' fw={600}>
              Consumo de Anthropic{varios ? ` · ${a.displayName}` : ''}
            </Text>
            {lineas.map((l) => (
              <Text key={l} size='xs'>
                {l}
              </Text>
            ))}
          </Stack>
        );
        const etiqueta = [`Consumo de Anthropic${varios ? ` de ${a.displayName}` : ''}`, ...lineas].join('. ');
        return (
          <Tooltip key={a.code} label={tip} withArrow multiline w={320} events={{ hover: true, focus: true, touch: true }} position='bottom-end'>
            <UnstyledButton className={css.medidorPildora} aria-label={etiqueta} data-testid={`medidor-consumo-${a.code}`} data-vieja={v.vieja || undefined}>
              <Group gap={10} wrap='nowrap'>
                {varios ? (
                  <Text size='xs' fw={600} span className={css.truncar} maw={70}>
                    {a.displayName}
                  </Text>
                ) : (
                  <IconGauge size={14} color='var(--mantine-color-dimmed)' aria-hidden />
                )}
                {v.semanal && <Indicador barra={v.semanal} corta='Semanal' testId='medidor-semanal' />}
                {v.cinco && <Indicador barra={v.cinco} corta='5 h' testId='medidor-5h' />}
              </Group>
            </UnstyledButton>
          </Tooltip>
        );
      })}
    </Group>
  );
}
