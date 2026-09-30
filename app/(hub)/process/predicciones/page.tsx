'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import {
  Alert,
  Anchor,
  Badge,
  Breadcrumbs,
  Card,
  Group,
  Loader,
  SimpleGrid,
  Stack,
  Tabs,
  Text,
  ThemeIcon,
  Title,
} from '@mantine/core';
import {
  IconAlertTriangle,
  IconChartLine,
  IconChecklist,
  IconChevronRight,
  IconPackage,
  IconTarget,
} from '@tabler/icons-react';
import { Line } from 'react-chartjs-2';
import '../../../../lib/charts/register';
import CarteraCaja, { type Cartera } from './CarteraCaja';
import LotesRegistros, { type LotesRegistrosData } from './LotesRegistros';
import DecisionesArticulo, { MOSTRAR_DECISIONES_POR_ARTICULO } from './DecisionesArticulo';
import {
  ComoLeer,
  KpiCard,
  ListaAlertas,
  SEMAFORO,
  Seccion,
  SemaforoPill,
  tonoClase,
  usePrediccionesChartTheme,
  type Semaforo,
  type TarjetaKpi,
} from './ui';

/**
 * Predicciones — una pestaña por empresa (Farmalógica, Ryan, OLP, Abamia,
 * Meditrack, Kelab), solo las que el usuario tiene asignadas.
 *
 * Toda la complejidad (limpieza, modelos, backtest) vive en
 * analytics/predictivo/generar_farmalogica.py y generar_empresa.py; esta página solo pinta el JSON
 * con textos ya redactados. Objetivo de diseño: que se entienda en ~10 s.
 *
 * Acceso: subproceso '/process/predicciones' asignado en cada empresa
 * (lib/predictivo/access.ts).
 */

interface Alerta {
  prioridad: 'alta' | 'media' | 'baja';
  tipo: string;
  titulo: string;
  accion: string;
}

interface MesPasado {
  mes: string;
  pronosticado: number;
  real: number;
  error: number | null;
  semaforo: Semaforo;
  frase: string;
  detalle: string;
}

interface Producto {
  codigo: string;
  nombre: string;
  intermitente?: boolean;
  frase: string;
  frase_metodo?: string;
}

interface Prediccion {
  empresa: string;
  generado: string;
  aviso?: string | null;
  fuente: { ventas_desde: string; ultimo_mes_completo: string };
  resumen: string;
  tarjetas: TarjetaKpi[];
  mes_pasado?: MesPasado | null;
  top_productos?: Producto[];
  ventas: {
    frase_modelo?: string;
    historia: { mes: string; real: number }[];
    parciales: { mes: string; registrado: number }[];
    pronostico: { mes: string; esperado: number; min: number; max: number }[];
  };
  alertas: Alerta[];
  como_leer: string[];
  cartera?: Cartera | null;
  lotes_registros?: LotesRegistrosData | null;
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function etiquetaMes(ym: string): string {
  const [y, m] = ym.split('-');
  return `${MESES[Number(m) - 1]} ${y.slice(2)}`;
}

function millones(v: number): string {
  return `$${new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(v / 1e6)} M`;
}

interface Empresa {
  id: number;
  nombre: string;
}

export default function PrediccionesPage() {
  const { data: session } = useSession();
  const [empresas, setEmpresas] = useState<Empresa[] | null>(null);
  const [activa, setActiva] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    (async () => {
      try {
        setError(null);
        const accessRes = await fetch('/api/predictivo/access');
        if (!accessRes.ok) throw new Error('No se pudo verificar el acceso al módulo');
        const accessData = await accessRes.json();
        const lista: Empresa[] = accessData.canAccess ? accessData.empresas ?? [] : [];
        setEmpresas(lista);
        if (lista.length > 0) setActiva(String(lista[0].id));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error inesperado');
      }
    })();
  }, [session]);

  if (error) {
    return (
      <Alert color="red" title="Predicciones" mt="md" icon={<IconAlertTriangle size={18} />}>
        {error}
      </Alert>
    );
  }

  if (empresas === null) {
    return (
      <Group justify="center" mt="xl">
        <Loader />
      </Group>
    );
  }

  if (empresas.length === 0) {
    return (
      <Alert color="red" title="Predicciones" mt="md">
        No tiene acceso a este módulo.
      </Alert>
    );
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--mantine-color-body)' }}>
      <Tabs value={activa} onChange={setActiva} keepMounted={false} className="max-w-7xl mx-auto pt-4 px-3 sm:px-6 lg:px-8">
        <Tabs.List>
          {empresas.map((e) => (
            <Tabs.Tab key={e.id} value={String(e.id)}>
              {e.nombre}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        {empresas.map((e) => (
          <Tabs.Panel key={e.id} value={String(e.id)}>
            <PanelEmpresa companyId={e.id} />
          </Tabs.Panel>
        ))}
      </Tabs>
    </div>
  );
}

function PanelEmpresa({ companyId }: { companyId: number }) {
  const [data, setData] = useState<Prediccion | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch(`/api/predictivo?companyId=${companyId}`);
        if (res.status === 403) throw new Error('No tiene acceso a esta empresa.');
        if (!res.ok) throw new Error('No se pudieron cargar las predicciones');
        const json = await res.json();
        setData(json.data ?? null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error inesperado');
      } finally {
        setLoading(false);
      }
    })();
  }, [companyId]);

  const chartTheme = usePrediccionesChartTheme();
  const { series } = chartTheme;

  const chartData = useMemo(() => {
    if (!data) return null;
    const { historia, parciales, pronostico } = data.ventas;
    const labels = [...historia.map((h) => h.mes), ...pronostico.map((p) => p.mes)];
    const nHist = historia.length;
    const ultimoReal = historia[nHist - 1]?.real ?? null;
    const pad = (n: number) => Array<number | null>(n).fill(null);
    const parcialPorMes = new Map(parciales.map((p) => [p.mes, p.registrado]));
    return {
      labels: labels.map(etiquetaMes),
      datasets: [
        {
          label: 'Máximo probable',
          data: [...pad(nHist - 1), ultimoReal, ...pronostico.map((p) => p.max)],
          borderColor: 'transparent',
          backgroundColor: series.banda,
          pointRadius: 0,
          fill: '+1',
        },
        {
          label: 'Mínimo probable',
          data: [...pad(nHist - 1), ultimoReal, ...pronostico.map((p) => p.min)],
          borderColor: 'transparent',
          pointRadius: 0,
          fill: false,
        },
        {
          label: 'Vendido',
          data: [...historia.map((h) => h.real), ...pad(pronostico.length)],
          borderColor: series.vendido,
          backgroundColor: series.vendido,
          borderWidth: 3,
          pointRadius: 2,
          tension: 0.25,
          fill: false,
        },
        {
          label: 'Proyectado',
          data: [...pad(nHist - 1), ultimoReal, ...pronostico.map((p) => p.esperado)],
          borderColor: series.proyectado,
          backgroundColor: series.proyectado,
          borderDash: [6, 5],
          borderWidth: 3,
          pointRadius: 3,
          tension: 0.25,
          fill: false,
        },
        {
          label: 'Registrado hasta hoy (incompleto)',
          data: [...pad(nHist), ...pronostico.map((p) => parcialPorMes.get(p.mes) ?? null)],
          borderColor: series.registrado,
          backgroundColor: series.registrado,
          showLine: false,
          pointRadius: 4,
          pointStyle: 'triangle' as const,
        },
      ],
    };
  }, [data, series]);

  const breadcrumbItems = [
    { title: 'Procesos', href: '/process' },
    { title: 'Predicciones', href: '#' },
  ].map((item, index) =>
    item.href !== '#' ? (
      <Link key={index} href={item.href} passHref>
        <Anchor component="span" size="sm">
          {item.title}
        </Anchor>
      </Link>
    ) : (
      <Text key={index} component="span" size="sm" c="dimmed">
        {item.title}
      </Text>
    )
  );

  if (loading) {
    return (
      <Group justify="center" mt="xl">
        <Loader />
      </Group>
    );
  }

  if (error || !data) {
    return (
      <Alert color="red" title="Predicciones" mt="md" icon={<IconAlertTriangle size={18} />}>
        {error ?? 'Todavía no hay predicciones generadas para esta empresa.'}
      </Alert>
    );
  }

  const mesPasado = data.mes_pasado;

  const ventasInventario = (
      <Stack className="py-6" gap="lg">
        {/* 1. Encabezado con la frase resumen */}
        <Card p="lg" radius="md" withBorder>
          <Breadcrumbs separator={<IconChevronRight size={14} />} mb="sm">
            {breadcrumbItems}
          </Breadcrumbs>
          <Group gap="md" wrap="nowrap" align="flex-start">
            <ThemeIcon size={44} radius="md" variant="light" visibleFrom="xs">
              <IconChartLine size={24} />
            </ThemeIcon>
            <div style={{ minWidth: 0 }}>
              <Title order={2} className="pred-hero__title">
                Predicciones · {data.empresa}
              </Title>
              <Text size="md" mt={8} fw={500} maw={880}>
                {data.resumen}
              </Text>
              <Text size="xs" c="dimmed" mt={8}>
                Actualizado el {data.generado} · con ventas desde {data.fuente.ventas_desde} · piloto
              </Text>
              {data.aviso && (
                <Alert color="yellow" variant="light" radius="md" mt="sm" icon={<IconAlertTriangle size={18} />}>
                  {data.aviso}
                </Alert>
              )}
            </div>
          </Group>
        </Card>

        {/* 2. Tarjetas con semáforo */}
        <SimpleGrid cols={{ base: 1, xs: 2, lg: 4 }} spacing="md">
          {data.tarjetas.map((t) => (
            <KpiCard key={t.id} t={t} />
          ))}
        </SimpleGrid>

        {/* 2b. ¿Cómo le fue al pronóstico el mes pasado? */}
        {mesPasado && (
          <Seccion
            titulo="¿Cómo le fue al pronóstico el mes pasado?"
            icono={<IconTarget size={20} />}
            extra={<SemaforoPill semaforo={mesPasado.semaforo} />}
            className={`pred-accent ${tonoClase(SEMAFORO[mesPasado.semaforo].tono)}`}
          >
            <Text size="md" fw={500}>
              {mesPasado.frase}
            </Text>
            <Text size="xs" c="dimmed" mt={4}>
              {mesPasado.detalle}
              {data.ventas.frase_modelo ? ` ${data.ventas.frase_modelo}` : ''}
            </Text>
          </Seccion>
        )}

        {/* 3. Gráfica real vs proyectado */}
        {chartData && (
          <Seccion
            titulo="Ventas netas por mes: lo vendido y lo que se espera"
            subtitulo="La franja sombreada es el rango probable del pronóstico."
            icono={<IconChartLine size={20} />}
          >
            <div className="pred-chart" style={{ height: chartTheme.compacto ? 280 : 340 }}>
              <Line
                data={chartData}
                options={chartTheme.tematizar<'line'>({
                  responsive: true,
                  maintainAspectRatio: false,
                  interaction: { mode: 'index', intersect: false },
                  plugins: {
                    legend: {
                      position: 'bottom',
                      labels: {
                        usePointStyle: true,
                        boxWidth: 8,
                        boxHeight: 8,
                        padding: chartTheme.compacto ? 10 : 16,
                        filter: (item) =>
                          item.text !== 'Máximo probable' && item.text !== 'Mínimo probable',
                      },
                    },
                    tooltip: {
                      callbacks: {
                        label: (ctx) =>
                          ctx.parsed.y == null
                            ? ''
                            : `${ctx.dataset.label}: ${millones(ctx.parsed.y)}`,
                      },
                    },
                  },
                  scales: {
                    x: { ticks: { maxTicksLimit: chartTheme.compacto ? 6 : 12 }, grid: { display: false } },
                    y: { beginAtZero: true, ticks: { callback: (v) => millones(Number(v)) } },
                  },
                })}
              />
            </div>
          </Seccion>
        )}

        {/* 3b. Productos principales (indica cuándo la venta es intermitente) */}
        {data.top_productos && data.top_productos.length > 0 && (
          <Seccion titulo="Productos que más venden: lo que se espera" icono={<IconPackage size={20} />}>
            <Stack gap="md">
              {data.top_productos.map((p) => (
                <div key={p.codigo}>
                  <Group gap="xs" wrap="wrap">
                    <Text size="sm" fw={600}>
                      {p.nombre}
                    </Text>
                    {p.intermitente && (
                      <Badge color="grape" variant="light" size="sm">
                        Venta intermitente
                      </Badge>
                    )}
                  </Group>
                  <Text size="sm">{p.frase}</Text>
                  {p.frase_metodo && (
                    <Text size="xs" c="dimmed">
                      {p.frase_metodo}
                    </Text>
                  )}
                </div>
              ))}
            </Stack>
          </Seccion>
        )}

        {/* 4. Alertas accionables */}
        <Seccion titulo="Qué hacer ahora" icono={<IconChecklist size={20} />}>
          {data.alertas.length === 0 ? (
            <Text c="dimmed">No hay alertas.</Text>
          ) : (
            <ListaAlertas alertas={data.alertas} />
          )}
        </Seccion>

        {/* 5. Cómo leer esto */}
        <ComoLeer items={data.como_leer} />
      </Stack>
  );

  const hayDecisiones = MOSTRAR_DECISIONES_POR_ARTICULO;
  if (!data.cartera && !data.lotes_registros && !hayDecisiones) return <div>{ventasInventario}</div>;
  return (
    <Tabs defaultValue="ventas" variant="pills" mt="md" keepMounted={false}>
      <Tabs.List>
        <Tabs.Tab value="ventas">Ventas e inventario</Tabs.Tab>
        {data.cartera && <Tabs.Tab value="cartera">Cartera y caja</Tabs.Tab>}
        {data.lotes_registros && <Tabs.Tab value="lotes">Lotes y registros</Tabs.Tab>}
        {hayDecisiones && <Tabs.Tab value="decisiones">Decisiones por artículo</Tabs.Tab>}
      </Tabs.List>
      <Tabs.Panel value="ventas">{ventasInventario}</Tabs.Panel>
      {data.cartera && (
        <Tabs.Panel value="cartera" pt="md">
          <CarteraCaja data={data.cartera} />
        </Tabs.Panel>
      )}
      {data.lotes_registros && (
        <Tabs.Panel value="lotes" pt="md">
          <LotesRegistros data={data.lotes_registros} />
        </Tabs.Panel>
      )}
      {hayDecisiones && (
        <Tabs.Panel value="decisiones" pt="md">
          <DecisionesArticulo />
        </Tabs.Panel>
      )}
    </Tabs>
  );
}
