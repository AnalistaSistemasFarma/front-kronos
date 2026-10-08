'use client';

import React, { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Group,
  Loader,
  Pagination,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconAlertTriangle, IconDownload, IconListCheck, IconSearch } from '@tabler/icons-react';
import { ComoLeer, EstadoPill, Seccion, tonoClase } from './ui';
import {
  CATALOGO_DECISIONES,
  ETIQUETA_OPCION,
  type CodigoDecision,
  type FilaDecision,
} from '../../../../lib/predictivo/decisiones';

/**
 * Sub-pestaña "Decisiones por artículo" (FASE 1: Farmalógica y OLP).
 *
 * Solo pinta lo que calcula analytics/predictivo/decisiones_articulo.py y se
 * publica en dbo.predictivo_decisiones: por artículo, qué conviene hacer, con
 * qué probabilidad, cuánto está en juego en pesos y qué tan confiable es el
 * dato. La tabla se pagina y filtra en el servidor (/api/predictivo/decisiones).
 */
export const MOSTRAR_DECISIONES_POR_ARTICULO = true;

type Tono = 'ok' | 'warn' | 'danger' | 'neutral';

const TONO_OPCION: Record<string, Tono> = {
  urgente: 'danger',
  alto: 'danger',
  bloquea: 'danger',
  pronto: 'warn',
  medio: 'warn',
  renovar_ya: 'warn',
  no: 'ok',
  bajo: 'ok',
  ok: 'ok',
  no_aplica: 'neutral',
  vigilar: 'neutral',
};

const TONO_CALIDAD: Record<string, Tono> = { alta: 'ok', media: 'warn', baja: 'neutral' };

interface ResumenDecision {
  decision: string;
  opciones: Record<string, number>;
  accionables: number;
  impacto_accionable: number;
  calidad: Record<string, number>;
}

interface Resumen {
  fecha_corte: string | null;
  generado_en: string | null;
  total: number;
  por_decision: ResumenDecision[];
}

interface Pagina {
  fecha_corte: string | null;
  total: number;
  page: number;
  pageSize: number;
  filas: FilaDecision[];
}

const PAGE_SIZE = 25;
const fmtNum = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 });

function pesosCorto(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return `$${(a / 1e9).toLocaleString('es-CO', { maximumFractionDigits: 1 })} mil M`;
  if (a >= 1e6) return `$${fmtNum.format(a / 1e6)} M`;
  return `$${fmtNum.format(a)}`;
}

function pct(p: number | null): string {
  return p === null ? '—' : `${Math.round(p * 100)} %`;
}

const DESCRIPCION: Record<string, string> = {
  D1: 'Artículos a los que conviene hacerles pedido ya (urgente) o en el próximo mes (pronto).',
  D2: 'Artículos con probabilidad alta o media de quedarse sin inventario en 30 días.',
  D3: 'Artículos con lotes que podrían vencerse antes de venderse.',
  D7: 'Productos con ventas cuyo registro sanitario está vencido o vence en menos de 6 meses.',
};

function TarjetaDecision({ r, activa, onClick }: { r: ResumenDecision; activa: boolean; onClick: () => void }) {
  const cat = CATALOGO_DECISIONES[r.decision as CodigoDecision];
  const opciones = (cat?.opciones ?? Object.keys(r.opciones)) as readonly string[];
  const tono: Tono = r.accionables === 0 ? 'ok' : r.decision === 'D7' || r.decision === 'D2' ? 'danger' : 'warn';
  return (
    <Card
      withBorder
      radius="md"
      p="md"
      className={`pred-accent ${tonoClase(tono)}`}
      style={{ cursor: 'pointer', outline: activa ? '2px solid var(--pred-info)' : undefined }}
      onClick={onClick}
      role="button"
      aria-pressed={activa}
    >
      <div className="pred-kpi">
        <span className="pred-kpi__label">
          {r.decision} · {cat?.titulo ?? r.decision}
        </span>
        <span className="pred-kpi__value">{fmtNum.format(r.accionables)}</span>
        <Text size="sm">{DESCRIPCION[r.decision] ?? 'Artículos para revisar.'}</Text>
        <Text size="xs" c="dimmed">
          {opciones
            .filter((o) => r.opciones[o])
            .map((o) => `${ETIQUETA_OPCION[o] ?? o}: ${fmtNum.format(r.opciones[o])}`)
            .join(' · ')}
          {r.impacto_accionable > 0 ? ` · en juego ≈ ${pesosCorto(r.impacto_accionable)}` : ''}
        </Text>
      </div>
    </Card>
  );
}

export default function DecisionesArticulo({ companyId }: { companyId: number }) {
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [pagina, setPagina] = useState<Pagina | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  const [decision, setDecision] = useState<string | null>(null);
  const [opcion, setOpcion] = useState<string | null>(null);
  const [calidad, setCalidad] = useState<string | null>(null);
  const [probMin, setProbMin] = useState<string | null>(null);
  const [soloAccionables, setSoloAccionables] = useState(true);
  const [busqueda, setBusqueda] = useState('');
  const [q] = useDebouncedValue(busqueda, 350);
  // la página vuelve a 1 cuando cambia cualquier filtro (se guarda junto con los filtros que la originaron)
  const [paginaSel, setPaginaSel] = useState({ qs: '', page: 1 });

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/predictivo/decisiones/resumen?companyId=${companyId}`);
        if (!res.ok) throw new Error('No se pudo cargar el resumen de decisiones');
        setResumen(await res.json());
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error inesperado');
      }
    })();
  }, [companyId]);

  const params = new URLSearchParams({ companyId: String(companyId) });
  if (decision) params.set('decision', decision);
  if (opcion) params.set('opcion', opcion);
  if (calidad) params.set('calidad', calidad);
  if (probMin) params.set('probMin', probMin);
  if (q.trim()) params.set('q', q.trim());
  if (soloAccionables) params.set('accionables', '1');
  const filtrosQs = params.toString();
  const page = paginaSel.qs === filtrosQs ? paginaSel.page : 1;
  const setPage = (p: number) => setPaginaSel({ qs: filtrosQs, page: p });

  useEffect(() => {
    let vigente = true;
    (async () => {
      try {
        setCargando(true);
        const res = await fetch(`/api/predictivo/decisiones?${filtrosQs}&page=${page}&pageSize=${PAGE_SIZE}`);
        if (!res.ok) throw new Error('No se pudieron cargar las decisiones');
        const json = (await res.json()) as Pagina;
        if (vigente) setPagina(json);
      } catch (err) {
        if (vigente) setError(err instanceof Error ? err.message : 'Error inesperado');
      } finally {
        if (vigente) setCargando(false);
      }
    })();
    return () => {
      vigente = false;
    };
  }, [filtrosQs, page]);

  if (error) {
    return (
      <Alert color="red" title="Decisiones por artículo" icon={<IconAlertTriangle size={18} />}>
        {error}
      </Alert>
    );
  }

  if (resumen && resumen.total === 0) {
    return (
      <Seccion titulo="Decisiones por artículo" icono={<IconListCheck size={20} />}>
        <Text size="sm" c="dimmed">
          Todavía no hay decisiones calculadas para esta empresa.
        </Text>
      </Seccion>
    );
  }

  const opcionesDecision = decision
    ? CATALOGO_DECISIONES[decision as CodigoDecision].opciones.map((o) => ({ value: o, label: ETIQUETA_OPCION[o] ?? o }))
    : [];
  const totalPaginas = pagina ? Math.max(1, Math.ceil(pagina.total / PAGE_SIZE)) : 1;

  return (
    <Stack gap="lg" className="pb-6">
      <Seccion
        titulo="Decisiones por artículo"
        subtitulo={
          resumen?.fecha_corte
            ? `Qué conviene hacer con cada artículo, calculado con datos al ${resumen.fecha_corte}. Piloto.`
            : 'Qué conviene hacer con cada artículo.'
        }
        icono={<IconListCheck size={20} />}
      />

      {resumen ? (
        <SimpleGrid cols={{ base: 1, xs: 2, lg: resumen.por_decision.length >= 4 ? 4 : 3 }} spacing="md">
          {resumen.por_decision.map((r) => (
            <TarjetaDecision
              key={r.decision}
              r={r}
              activa={decision === r.decision}
              onClick={() => {
                setOpcion(null);
                setDecision(decision === r.decision ? null : r.decision);
              }}
            />
          ))}
        </SimpleGrid>
      ) : (
        <Group justify="center">
          <Loader size="sm" />
        </Group>
      )}

      <Seccion
        titulo="Artículos"
        subtitulo="Ordenados por prioridad: probabilidad × impacto en pesos."
        extra={
          <Button
            component="a"
            href={`/api/predictivo/decisiones?${filtrosQs}&formato=csv`}
            variant="light"
            size="xs"
            leftSection={<IconDownload size={14} />}
          >
            Exportar CSV
          </Button>
        }
      >
        <Group gap="sm" align="flex-end" wrap="wrap" mb="md">
          <Select
            label="Decisión"
            placeholder="Todas"
            clearable
            value={decision}
            onChange={(v) => {
              setOpcion(null);
              setDecision(v);
            }}
            data={(resumen?.por_decision ?? []).map((r) => ({
              value: r.decision,
              label: `${r.decision} · ${CATALOGO_DECISIONES[r.decision as CodigoDecision]?.titulo ?? r.decision}`,
            }))}
            w={230}
          />
          <Select
            label="Opción"
            placeholder={decision ? 'Todas' : 'Elija una decisión'}
            clearable
            disabled={!decision}
            value={opcion}
            onChange={setOpcion}
            data={opcionesDecision}
            w={170}
          />
          <Select
            label="Probabilidad mínima"
            placeholder="Cualquiera"
            clearable
            value={probMin}
            onChange={setProbMin}
            data={[
              { value: '0.2', label: '20 % o más' },
              { value: '0.5', label: '50 % o más' },
              { value: '0.8', label: '80 % o más' },
            ]}
            w={170}
          />
          <Select
            label="Calidad del dato"
            placeholder="Todas"
            clearable
            value={calidad}
            onChange={setCalidad}
            data={[
              { value: 'alta', label: 'Alta' },
              { value: 'media', label: 'Media' },
              { value: 'baja', label: 'Baja' },
            ]}
            w={150}
          />
          <TextInput
            label="Buscar"
            placeholder="Código o nombre"
            leftSection={<IconSearch size={14} />}
            value={busqueda}
            onChange={(e) => setBusqueda(e.currentTarget.value)}
            w={220}
          />
          <Switch
            label="Solo las que piden acción"
            checked={soloAccionables}
            onChange={(e) => setSoloAccionables(e.currentTarget.checked)}
            mb={8}
          />
        </Group>

        {cargando && !pagina ? (
          <Group justify="center" my="md">
            <Loader size="sm" />
          </Group>
        ) : pagina && pagina.filas.length === 0 ? (
          <Text size="sm" c="dimmed">
            Ningún artículo cumple estos filtros.
          </Text>
        ) : (
          <>
            <Table.ScrollContainer minWidth={900}>
              <Table verticalSpacing="sm" highlightOnHover style={{ opacity: cargando ? 0.6 : 1 }}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Artículo</Table.Th>
                    <Table.Th>Decisión</Table.Th>
                    <Table.Th ta="right">Probabilidad</Table.Th>
                    <Table.Th ta="right">Cantidad</Table.Th>
                    <Table.Th ta="right">En juego</Table.Th>
                    <Table.Th>Calidad del dato</Table.Th>
                    <Table.Th>Por qué</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {pagina?.filas.map((f) => (
                    <Table.Tr key={`${f.item_code}-${f.decision}`}>
                      <Table.Td>
                        <Text size="sm" fw={600}>
                          {f.item_nombre ?? f.item_code}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {f.item_code}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs" c="dimmed" mb={4}>
                          {CATALOGO_DECISIONES[f.decision]?.titulo ?? f.decision}
                        </Text>
                        <EstadoPill tono={TONO_OPCION[f.opcion] ?? 'neutral'} texto={ETIQUETA_OPCION[f.opcion] ?? f.opcion} />
                      </Table.Td>
                      <Table.Td ta="right">
                        <Text size="sm">{f.probabilidad === null ? 'Regla' : pct(f.probabilidad)}</Text>
                      </Table.Td>
                      <Table.Td ta="right">
                        <Text size="sm">{f.cantidad ? fmtNum.format(f.cantidad) : '—'}</Text>
                      </Table.Td>
                      <Table.Td ta="right">
                        <Text size="sm">{f.impacto_cop ? pesosCorto(f.impacto_cop) : '—'}</Text>
                      </Table.Td>
                      <Table.Td>
                        <EstadoPill
                          tono={TONO_CALIDAD[f.calidad] ?? 'neutral'}
                          texto={f.calidad.charAt(0).toUpperCase() + f.calidad.slice(1)}
                        />
                      </Table.Td>
                      <Table.Td maw={420}>
                        <Text size="sm">{f.motivo}</Text>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
            <Group justify="space-between" mt="md" wrap="wrap" gap="xs">
              <Text size="xs" c="dimmed">
                {pagina ? `${fmtNum.format(pagina.total)} filas` : ''}
              </Text>
              {totalPaginas > 1 && <Pagination value={page} onChange={setPage} total={totalPaginas} size="sm" />}
            </Group>
          </>
        )}
      </Seccion>

      <ComoLeer
        items={[
          'Cada fila es una decisión sobre un artículo: reabastecer (D1), riesgo de quedarse sin inventario en 30 días (D2), lotes que podrían vencerse antes de venderse (D3) y registro sanitario por vencer (D7).',
          'La probabilidad sale de simular 1.000 escenarios de venta con los errores que el pronóstico tuvo en meses pasados. «Regla» indica que la decisión no es probabilística (por ejemplo, la fecha del registro sanitario).',
          'La posición de inventario suma lo aprobado, lo que está en cuarentena y las órdenes de compra abiertas, y le resta lo ya comprometido con clientes.',
          '«En juego» es la venta que se perdería (D1 y D2), el valor que quedaría sin vender (D3) o tres meses de venta del producto (D7), en pesos.',
          'La calidad del dato es independiente de la probabilidad: baja significa poca historia, pocas pruebas o datos incompletos en SAP; tómela como referencia.',
          'Tiempo de reposición: el de SAP para cada artículo; si no tiene, se suponen 30 días. Nivel de servicio 95 % y cobertura objetivo de 90 días.',
        ]}
      />
    </Stack>
  );
}
