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
  List,
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
  IconBulb,
  IconChartLine,
  IconChevronRight,
} from '@tabler/icons-react';
import { Line } from 'react-chartjs-2';
import '../../../../lib/charts/register';
import CarteraCaja, { type Cartera } from './CarteraCaja';

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

type Semaforo = 'verde' | 'amarillo' | 'rojo';

interface Tarjeta {
  id: string;
  titulo: string;
  valor: string;
  detalle: string;
  semaforo: Semaforo;
  frase: string;
}

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
  tarjetas: Tarjeta[];
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
}

const SEMAFORO: Record<Semaforo, { color: string; emoji: string; texto: string }> = {
  verde: { color: 'green', emoji: '🟢', texto: 'Bien' },
  amarillo: { color: 'yellow', emoji: '🟡', texto: 'Revisar' },
  rojo: { color: 'red', emoji: '🔴', texto: 'Actuar' },
};

const PRIORIDAD: Record<Alerta['prioridad'], { color: string; texto: string }> = {
  alta: { color: 'red', texto: 'Urgente' },
  media: { color: 'yellow', texto: 'Pronto' },
  baja: { color: 'gray', texto: 'Informativo' },
};

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
          backgroundColor: 'rgba(28, 126, 214, 0.15)',
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
          borderColor: '#1c7ed6',
          backgroundColor: '#1c7ed6',
          borderWidth: 3,
          pointRadius: 2,
          tension: 0.25,
          fill: false,
        },
        {
          label: 'Proyectado',
          data: [...pad(nHist - 1), ultimoReal, ...pronostico.map((p) => p.esperado)],
          borderColor: '#f76707',
          backgroundColor: '#f76707',
          borderDash: [6, 5],
          borderWidth: 3,
          pointRadius: 3,
          tension: 0.25,
          fill: false,
        },
        {
          label: 'Registrado hasta hoy (incompleto)',
          data: [...pad(nHist), ...pronostico.map((p) => parcialPorMes.get(p.mes) ?? null)],
          borderColor: '#868e96',
          backgroundColor: '#868e96',
          showLine: false,
          pointRadius: 4,
          pointStyle: 'triangle' as const,
        },
      ],
    };
  }, [data]);

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

  const ventasInventario = (
      <Stack className="py-6" gap="lg">
        {/* 1. Encabezado con la frase resumen */}
        <Card shadow="sm" p="lg" radius="md" withBorder>
          <Breadcrumbs separator={<IconChevronRight size={16} />} mb="sm">
            {breadcrumbItems}
          </Breadcrumbs>
          <Group gap="sm" wrap="nowrap" align="flex-start">
            <ThemeIcon size={40} radius="md" variant="light">
              <IconChartLine size={24} />
            </ThemeIcon>
            <div>
              <Title order={2}>Predicciones · {data.empresa}</Title>
              <Text size="lg" mt={6} fw={500}>
                {data.resumen}
              </Text>
              <Text size="xs" c="dimmed" mt={6}>
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
          {data.tarjetas.map((t) => {
            const s = SEMAFORO[t.semaforo];
            return (
              <Card
                key={t.id}
                withBorder
                radius="md"
                p="md"
                style={{ borderLeft: `6px solid var(--mantine-color-${s.color}-6)` }}
              >
                <Group justify="space-between" wrap="nowrap" align="flex-start">
                  <Text size="sm" c="dimmed" fw={600}>
                    {t.titulo}
                  </Text>
                  <Badge color={s.color} variant="light" size="sm">
                    {s.emoji} {s.texto}
                  </Badge>
                </Group>
                <Text fz={26} fw={700} mt={4}>
                  {t.valor}
                </Text>
                <Text size="sm">{t.frase}</Text>
                <Text size="xs" c="dimmed" mt={4}>
                  {t.detalle}
                </Text>
              </Card>
            );
          })}
        </SimpleGrid>

        {/* 2b. ¿Cómo le fue al pronóstico el mes pasado? */}
        {data.mes_pasado && (
          <Card
            withBorder
            radius="md"
            p="md"
            style={{
              borderLeft: `6px solid var(--mantine-color-${SEMAFORO[data.mes_pasado.semaforo].color}-6)`,
            }}
          >
            <Group justify="space-between" wrap="nowrap" align="flex-start">
              <Title order={4}>¿Cómo le fue al pronóstico el mes pasado?</Title>
              <Badge color={SEMAFORO[data.mes_pasado.semaforo].color} variant="light" size="sm">
                {SEMAFORO[data.mes_pasado.semaforo].emoji} {SEMAFORO[data.mes_pasado.semaforo].texto}
              </Badge>
            </Group>
            <Text size="md" mt={6} fw={500}>
              {data.mes_pasado.frase}
            </Text>
            <Text size="xs" c="dimmed" mt={4}>
              {data.mes_pasado.detalle}
              {data.ventas.frase_modelo ? ` ${data.ventas.frase_modelo}` : ''}
            </Text>
          </Card>
        )}

        {/* 3. Gráfica real vs proyectado */}
        {chartData && (
          <Card withBorder radius="md" p="md">
            <Title order={4}>Ventas netas por mes: lo vendido y lo que se espera</Title>
            <Text size="sm" c="dimmed" mb="sm">
              La franja azul clara es el rango probable del pronóstico.
            </Text>
            <div style={{ height: 320 }}>
              <Line
                data={chartData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  interaction: { mode: 'index', intersect: false },
                  plugins: {
                    legend: {
                      position: 'bottom',
                      labels: {
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
                    x: { ticks: { maxTicksLimit: 12 } },
                    y: { beginAtZero: true, ticks: { callback: (v) => millones(Number(v)) } },
                  },
                }}
              />
            </div>
          </Card>
        )}

        {/* 3b. Productos principales (indica cuándo la venta es intermitente) */}
        {data.top_productos && data.top_productos.length > 0 && (
          <Card withBorder radius="md" p="md">
            <Title order={4} mb="sm">
              Productos que más venden: lo que se espera
            </Title>
            <Stack gap="xs">
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
          </Card>
        )}

        {/* 4. Alertas accionables */}
        <Card withBorder radius="md" p="md">
          <Title order={4} mb="sm">
            Qué hacer ahora
          </Title>
          {data.alertas.length === 0 ? (
            <Text c="dimmed">No hay alertas. 🟢</Text>
          ) : (
            <Stack gap="sm">
              {data.alertas.map((a, i) => {
                const p = PRIORIDAD[a.prioridad];
                return (
                  <Alert
                    key={i}
                    color={p.color}
                    variant="light"
                    radius="md"
                    title={
                      <Group gap="xs">
                        <Badge color={p.color} size="sm">
                          {p.texto}
                        </Badge>
                        <Text size="sm" fw={600} component="span">
                          {a.titulo}
                        </Text>
                      </Group>
                    }
                  >
                    <Text size="sm">👉 {a.accion}</Text>
                  </Alert>
                );
              })}
            </Stack>
          )}
        </Card>

        {/* 5. Cómo leer esto */}
        <Card withBorder radius="md" p="md">
          <Group gap="xs" mb="xs">
            <IconBulb size={20} />
            <Title order={4}>¿Cómo leer esto?</Title>
          </Group>
          <List size="sm" spacing={4}>
            {data.como_leer.map((t, i) => (
              <List.Item key={i}>{t}</List.Item>
            ))}
          </List>
        </Card>
      </Stack>
  );

  if (!data.cartera) return <div>{ventasInventario}</div>;
  return (
    <Tabs defaultValue="ventas" variant="pills" mt="md" keepMounted={false}>
      <Tabs.List>
        <Tabs.Tab value="ventas">Ventas e inventario</Tabs.Tab>
        <Tabs.Tab value="cartera">Cartera y caja</Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel value="ventas">{ventasInventario}</Tabs.Panel>
      <Tabs.Panel value="cartera" pt="md">
        <CarteraCaja data={data.cartera} />
      </Tabs.Panel>
    </Tabs>
  );
}
