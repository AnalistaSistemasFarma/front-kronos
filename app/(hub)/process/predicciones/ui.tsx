'use client';

import React, { useMemo } from 'react';
import { Card, Group, List, Stack, Text, Title } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconArrowRight, IconBulb } from '@tabler/icons-react';
import type { ChartOptions, ChartType } from 'chart.js';
import { mergeChartOptionsForTheme } from '../../../../lib/charts/chartColorScheme';
import { useTheme } from '../../../../components/providers';

/**
 * Piezas visuales compartidas por las pestañas de Predicciones (ventas,
 * cartera, lotes). Solo presentación: los textos y cifras llegan ya
 * redactados en el snapshot.
 *
 * Claro/oscuro: los colores de estado son variables CSS (--pred-*, en
 * app/globals.css) que cambian con la clase .dark; las gráficas pasan por
 * mergeChartOptionsForTheme, el mismo ajuste que usa ChartBox en el tablero.
 */

export type Semaforo = 'verde' | 'amarillo' | 'rojo';
export type Prioridad = 'alta' | 'media' | 'baja';
type Tono = 'ok' | 'warn' | 'danger' | 'neutral';

export const SEMAFORO: Record<Semaforo, { tono: Tono; texto: string }> = {
  verde: { tono: 'ok', texto: 'Bien' },
  amarillo: { tono: 'warn', texto: 'Revisar' },
  rojo: { tono: 'danger', texto: 'Actuar' },
};

export const PRIORIDAD: Record<Prioridad, { tono: Tono; texto: string }> = {
  alta: { tono: 'danger', texto: 'Urgente' },
  media: { tono: 'warn', texto: 'Pronto' },
  baja: { tono: 'neutral', texto: 'Informativo' },
};

export function tonoClase(tono: Tono): string {
  return `pred-tone--${tono}`;
}

/** Pastilla de estado: punto relleno + texto. */
export function EstadoPill({ tono, texto }: { tono: Tono; texto: string }) {
  return (
    <span className={`pred-pill ${tonoClase(tono)}`}>
      <span className="pred-pill__dot" aria-hidden />
      {texto}
    </span>
  );
}

export function SemaforoPill({ semaforo }: { semaforo: Semaforo }) {
  const s = SEMAFORO[semaforo];
  return <EstadoPill tono={s.tono} texto={s.texto} />;
}

export interface TarjetaKpi {
  id: string;
  titulo: string;
  valor: string;
  detalle: string;
  semaforo: Semaforo;
  frase: string;
}

/** Tarjeta de indicador con acento de semáforo a la izquierda. */
export function KpiCard({ t }: { t: TarjetaKpi }) {
  return (
    <Card withBorder radius="md" p="md" className={`pred-accent ${tonoClase(SEMAFORO[t.semaforo].tono)}`}>
      <div className="pred-kpi">
        <Group justify="space-between" wrap="nowrap" align="flex-start" gap="xs">
          <span className="pred-kpi__label">{t.titulo}</span>
          <SemaforoPill semaforo={t.semaforo} />
        </Group>
        <span className="pred-kpi__value">{t.valor}</span>
        <Text size="sm">{t.frase}</Text>
        <Text size="xs" c="dimmed">
          {t.detalle}
        </Text>
      </div>
    </Card>
  );
}

/** Tarjeta de sección con título, subtítulo opcional y contenido. */
export function Seccion({
  titulo,
  subtitulo,
  icono,
  extra,
  children,
  className,
}: {
  titulo: React.ReactNode;
  subtitulo?: React.ReactNode;
  icono?: React.ReactNode;
  extra?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <Card withBorder radius="md" p="md" className={className}>
      <Group justify="space-between" wrap="nowrap" align="flex-start" gap="sm">
        <Group gap="xs" wrap="nowrap" align="flex-start">
          {icono && <span className="pred-section__icon">{icono}</span>}
          <Title order={4}>{titulo}</Title>
        </Group>
        {extra}
      </Group>
      {subtitulo && (
        <Text size="sm" c="dimmed" mt={4}>
          {subtitulo}
        </Text>
      )}
      {children && <div style={{ marginTop: 12 }}>{children}</div>}
    </Card>
  );
}

/** Línea de "qué hacer": flecha + texto. */
export function Accion({ children, size = 'sm' }: { children: React.ReactNode; size?: 'xs' | 'sm' }) {
  return (
    <div className="pred-accion">
      <IconArrowRight size={size === 'xs' ? 14 : 16} aria-hidden />
      <Text size={size} c="inherit">
        {children}
      </Text>
    </div>
  );
}

/** Lista de alertas accionables ordenadas como llegan del snapshot. */
export function ListaAlertas({
  alertas,
}: {
  alertas: { prioridad: Prioridad; titulo: string; accion: string }[];
}) {
  return (
    <Stack gap="sm">
      {alertas.map((a, i) => {
        const p = PRIORIDAD[a.prioridad];
        return (
          <div key={i} className={`pred-alerta ${tonoClase(p.tono)}`}>
            {/* La pastilla va en línea con el título: si este es largo, envuelve como texto. */}
            <Text size="sm" fw={600} mb={6} className="pred-alerta__titulo">
              <EstadoPill tono={p.tono} texto={p.texto} />
              {a.titulo}
            </Text>
            <Accion>{a.accion}</Accion>
          </div>
        );
      })}
    </Stack>
  );
}

/** Bloque "¿Cómo leer esto?". */
export function ComoLeer({ titulo = '¿Cómo leer esto?', items }: { titulo?: string; items: string[] }) {
  return (
    <Seccion titulo={titulo} icono={<IconBulb size={20} />}>
      <List size="sm" spacing={4}>
        {items.map((t, i) => (
          <List.Item key={i}>{t}</List.Item>
        ))}
      </List>
    </Seccion>
  );
}

/** Colores de series de las gráficas, por tema (contraste ≥ 3:1 sobre la tarjeta). */
const SERIES = {
  light: {
    vendido: '#1c7ed6',
    banda: 'rgba(28, 126, 214, 0.15)',
    proyectado: '#e8590c',
    registrado: '#6b7280',
    recaudo: '#1c7ed6',
    otrasEntradas: '#74c0fc',
    salidas: '#e03131',
  },
  dark: {
    vendido: '#5b9cff',
    banda: 'rgba(91, 156, 255, 0.22)',
    proyectado: '#ff9f43',
    registrado: '#aab4cf',
    recaudo: '#5b9cff',
    otrasEntradas: '#9dd4f2',
    salidas: '#ff7b8a',
  },
} as const;

/**
 * Tema de las gráficas de Predicciones: colores de series, si la pantalla es
 * angosta y una función que ajusta ejes, grilla, leyenda y tooltip al tema.
 */
export function usePrediccionesChartTheme() {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const compacto = useMediaQuery('(max-width: 576px)') ?? false;
  return useMemo(
    () => ({
      isDark,
      compacto,
      series: isDark ? SERIES.dark : SERIES.light,
      tematizar: <T extends ChartType>(options: ChartOptions<T>): ChartOptions<T> => {
        // Se trabaja con el tipo base: ChartOptions<T> genérico no deja leer plugins.
        const merged = (mergeChartOptionsForTheme(options, isDark) ?? {}) as ChartOptions;
        return {
          ...merged,
          plugins: {
            ...merged.plugins,
            tooltip: { ...merged.plugins?.tooltip, borderWidth: 1, padding: 10, cornerRadius: 8 },
          },
        } as unknown as ChartOptions<T>;
      },
    }),
    [isDark, compacto]
  );
}
