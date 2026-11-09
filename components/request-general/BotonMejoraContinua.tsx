'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Badge, Button, Tooltip } from '@mantine/core';
import { IconTrendingUp } from '@tabler/icons-react';
import type { Calificacion } from '../../lib/workflow/mejora-continua-rules';
import { COLOR_ESTADO, TITULO_ESTADO } from './EstadoFlujo';

/**
 * Botón «Mejora continua» del editor de flujos (2026-11-09; Nicolás Rivera: «hazlo un botón que
 * abra otra página»): muestra el estado del flujo y cuántas sugerencias hay por revisar, y abre
 * la página /process/request-general/mejora-continua. Sin permiso o sin la función en la
 * empresa, no aparece.
 */
export default function BotonMejoraContinua({ idProcessCategory }: { idProcessCategory: number }) {
  const [info, setInfo] = useState<{ calificacion: Calificacion; pendientes: number } | null>(null);

  useEffect(() => {
    let vivo = true;
    fetch(`/api/requests-general/mejora-continua?id_process_category=${idProcessCategory}`, { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) return;
        const j = (await r.json().catch(() => null)) as {
          habilitado?: boolean;
          calificacion?: Calificacion;
          diagnostico?: { sugerencias: { clave: string }[] };
          decisiones?: { clave: string }[];
        } | null;
        if (!vivo || !j?.habilitado || !j.calificacion || !j.diagnostico) return;
        const decididas = new Set((j.decisiones ?? []).map((d) => d.clave));
        setInfo({ calificacion: j.calificacion, pendientes: j.diagnostico.sugerencias.filter((s) => !decididas.has(s.clave)).length });
      })
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, [idProcessCategory]);

  if (!info) return null;
  return (
    <Tooltip label={info.calificacion.motivos.join(' ') || 'Ver cómo funciona este flujo y qué se puede mejorar'} withArrow multiline w={320}>
      <Button
        component={Link}
        href={`/process/request-general/mejora-continua?id=${idProcessCategory}`}
        size='sm'
        variant='light'
        color='teal'
        leftSection={<IconTrendingUp size={16} />}
        rightSection={
          <Badge size='sm' color={COLOR_ESTADO[info.calificacion.estado]} variant='filled'>
            {info.pendientes > 0 ? `${info.pendientes} por revisar` : TITULO_ESTADO[info.calificacion.estado]}
          </Badge>
        }
        data-testid='boton-mejora-continua'
      >
        Mejora continua
      </Button>
    </Tooltip>
  );
}
