'use client';

import { Fragment, useMemo, useState } from 'react';
import { Badge, Code, Group, SegmentedControl, Select, Table, Text } from '@mantine/core';
import { formatAgo, formatInt, formatMs } from '../system-metrics/format';
import styles from '../system-metrics/monitor.module.css';

/**
 * Consultas SQL de cada SAPSEND (caché de planes del SQL Server) + las que corren ahora.
 * Clic en una fila para ver la consulta completa.
 */

export type SapsendQuery = {
  database: string;
  queryHash: string;
  executions: number;
  totalMs: number;
  avgMs: number | null;
  maxMs: number;
  cpuMs: number;
  reads: number;
  rows: number;
  lastExecAt: string | null;
  since: string | null;
  perMin: number | null;
  avgMsNow: number | null;
  sqlText: string | null;
};

export type SapsendRunning = {
  database: string;
  sessionId: number;
  host: string | null;
  programName: string | null;
  status: string | null;
  command: string | null;
  waitType: string | null;
  blockingSessionId: number;
  elapsedMs: number;
  cpuMs: number;
  reads: number;
  sqlText: string | null;
};

type SortKey = 'total' | 'avg' | 'execs' | 'now';

const SORTS: Array<{ value: SortKey; label: string }> = [
  { value: 'total', label: 'Más tiempo total' },
  { value: 'avg', label: 'Más lentas' },
  { value: 'execs', label: 'Más ejecutadas' },
  { value: 'now', label: 'Más activas ahora' },
];

function sortValue(q: SapsendQuery, key: SortKey): number {
  if (key === 'avg') return q.avgMs ?? 0;
  if (key === 'execs') return q.executions;
  if (key === 'now') return q.perMin ?? -1;
  return q.totalMs;
}

function oneLine(sql: string | null): string {
  return (sql ?? '').replace(/\s+/g, ' ').trim() || '(sin texto)';
}

function slowColor(ms: number | null): string | undefined {
  if (ms == null) return undefined;
  if (ms >= 5000) return 'red';
  if (ms >= 1000) return 'yellow.8';
  return undefined;
}

export function SapsendQueries({
  queries,
  runningNow,
  companyByDb,
}: {
  queries: SapsendQuery[];
  runningNow: SapsendRunning[];
  /** base SAPSEND → nombre de empresa, para mostrar algo legible. */
  companyByDb: Record<string, string>;
}) {
  const [db, setDb] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>('total');
  const [open, setOpen] = useState<string | null>(null);

  const label = (database: string) => companyByDb[database.toLowerCase()] ?? database;

  const dbOptions = useMemo(() => {
    const set = new Set([...queries.map((q) => q.database), ...runningNow.map((r) => r.database)]);
    return [...set]
      .sort()
      .map((d) => ({ value: d, label: `${companyByDb[d.toLowerCase()] ?? d} (${d})` }));
  }, [queries, runningNow, companyByDb]);

  const perDb = useMemo(() => {
    const map = new Map<string, { execs: number; totalMs: number; perMin: number; queries: number }>();
    for (const q of queries) {
      const cur = map.get(q.database) ?? { execs: 0, totalMs: 0, perMin: 0, queries: 0 };
      cur.execs += q.executions;
      cur.totalMs += q.totalMs;
      cur.perMin += q.perMin ?? 0;
      cur.queries += 1;
      map.set(q.database, cur);
    }
    return [...map.entries()].sort((a, b) => b[1].totalMs - a[1].totalMs);
  }, [queries]);

  const rows = useMemo(
    () =>
      queries
        .filter((q) => !db || q.database === db)
        .sort((a, b) => sortValue(b, sort) - sortValue(a, sort))
        .slice(0, 50),
    [queries, db, sort]
  );
  const running = runningNow.filter((r) => !db || r.database === db);

  return (
    <>
      {perDb.length > 0 && (
        <div className={styles.card} style={{ marginBottom: 12 }}>
          <Text size="sm" fw={600} mb={8}>
            Resumen por SAPSEND (última hora)
          </Text>
          <Group gap="xs">
            {perDb.map(([database, s]) => (
              <Badge
                key={database}
                variant={db === database ? 'filled' : 'light'}
                radius="xl"
                size="lg"
                style={{ cursor: 'pointer', textTransform: 'none' }}
                onClick={() => setDb((cur) => (cur === database ? null : database))}
                title="Clic para ver solo esta empresa"
              >
                {label(database)} · {formatInt(s.queries)} consultas · {formatInt(s.execs)} ejec. ·{' '}
                {formatMs(s.totalMs)}
                {s.perMin > 0 ? ` · ${formatInt(Math.round(s.perMin))}/min ahora` : ''}
              </Badge>
            ))}
          </Group>
        </div>
      )}

      <div className={styles.card}>
        <Group justify="space-between" mb="sm" wrap="wrap" gap="sm">
          <Select
            placeholder="Todas las empresas"
            data={dbOptions}
            value={db}
            onChange={setDb}
            clearable
            w={300}
            aria-label="Filtrar por SAPSEND"
          />
          <SegmentedControl
            value={sort}
            onChange={(v) => setSort(v as SortKey)}
            data={SORTS}
            size="xs"
            radius="xl"
          />
        </Group>

        {rows.length === 0 ? (
          <Text size="sm" c="dimmed">
            No hay consultas de SAPSEND en la caché del SQL Server durante la última hora.
          </Text>
        ) : (
          <Table.ScrollContainer minWidth={1000}>
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Empresa</Table.Th>
                  <Table.Th>Consulta</Table.Th>
                  <Table.Th>Ejecuciones</Table.Th>
                  <Table.Th>Ahora</Table.Th>
                  <Table.Th>Promedio</Table.Th>
                  <Table.Th>Máximo</Table.Th>
                  <Table.Th>Tiempo total</Table.Th>
                  <Table.Th>CPU</Table.Th>
                  <Table.Th>Lecturas</Table.Th>
                  <Table.Th>Última</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((q) => {
                  const key = `${q.database}|${q.queryHash}`;
                  const isOpen = open === key;
                  return (
                    <Fragment key={key}>
                      <Table.Tr
                        style={{ cursor: 'pointer' }}
                        onClick={() => setOpen(isOpen ? null : key)}
                        aria-expanded={isOpen}
                      >
                        <Table.Td>
                          <Text size="sm" fw={600}>
                            {label(q.database)}
                          </Text>
                          <Text size="xs" c="dimmed" ff="monospace">
                            {q.database}
                          </Text>
                        </Table.Td>
                        <Table.Td maw={380}>
                          <Text size="xs" ff="monospace" lineClamp={2}>
                            {oneLine(q.sqlText)}
                          </Text>
                        </Table.Td>
                        <Table.Td>{formatInt(q.executions)}</Table.Td>
                        <Table.Td>
                          <Text size="xs">
                            {q.perMin == null ? '—' : `${formatInt(Math.round(q.perMin))}/min`}
                          </Text>
                          {q.avgMsNow != null && (
                            <Text size="xs" c={slowColor(q.avgMsNow) ?? 'dimmed'}>
                              {formatMs(q.avgMsNow)} c/u
                            </Text>
                          )}
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm" fw={600} c={slowColor(q.avgMs)}>
                            {formatMs(q.avgMs)}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm" c={slowColor(q.maxMs)}>
                            {formatMs(q.maxMs)}
                          </Text>
                        </Table.Td>
                        <Table.Td>{formatMs(q.totalMs)}</Table.Td>
                        <Table.Td>{formatMs(q.cpuMs)}</Table.Td>
                        <Table.Td>{formatInt(q.reads)}</Table.Td>
                        <Table.Td>
                          <Text size="xs">{formatAgo(q.lastExecAt)}</Text>
                        </Table.Td>
                      </Table.Tr>
                      {isOpen && (
                        <Table.Tr>
                          <Table.Td colSpan={10}>
                            <Code block style={{ whiteSpace: 'pre-wrap', maxHeight: 280, overflow: 'auto' }}>
                              {q.sqlText || '(sin texto)'}
                            </Code>
                            <Text size="xs" c="dimmed" mt={6}>
                              {formatInt(q.rows)} filas devueltas en total · en caché desde{' '}
                              {formatAgo(q.since)} · id {q.queryHash}
                            </Text>
                          </Table.Td>
                        </Table.Tr>
                      )}
                    </Fragment>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
        <Text size="xs" c="dimmed" mt="sm">
          Sale de la caché de planes del SQL Server: la misma consulta con distintos valores cuenta como una
          fila. «Ahora» compara contra la lectura anterior (cada 30 s). Clic en una fila para ver la consulta
          completa.
        </Text>
      </div>

      <div className={styles.card} style={{ marginTop: 12 }}>
        <Text size="sm" fw={600} mb={8}>
          Ejecutándose en este momento ({formatInt(running.length)})
        </Text>
        {running.length === 0 ? (
          <Text size="sm" c="dimmed">
            Ningún SAPSEND está ejecutando consultas en este instante.
          </Text>
        ) : (
          <Table.ScrollContainer minWidth={900}>
            <Table striped>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Empresa</Table.Th>
                  <Table.Th>Equipo / programa</Table.Th>
                  <Table.Th>Lleva</Table.Th>
                  <Table.Th>Estado</Table.Th>
                  <Table.Th>Consulta</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {running.map((r) => (
                  <Table.Tr key={`${r.database}-${r.sessionId}`}>
                    <Table.Td>
                      <Text size="sm" fw={600}>
                        {label(r.database)}
                      </Text>
                      <Text size="xs" c="dimmed">
                        Sesión {r.sessionId}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs">{r.host ?? '—'}</Text>
                      <Text size="xs" c="dimmed" lineClamp={1}>
                        {r.programName ?? '—'}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" fw={600} c={slowColor(r.elapsedMs)}>
                        {formatMs(r.elapsedMs)}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs">{r.command ?? r.status ?? '—'}</Text>
                      {r.blockingSessionId > 0 ? (
                        <Text size="xs" c="red">
                          Bloqueada por sesión {r.blockingSessionId}
                        </Text>
                      ) : r.waitType ? (
                        <Text size="xs" c="dimmed">
                          Esperando {r.waitType}
                        </Text>
                      ) : null}
                    </Table.Td>
                    <Table.Td maw={420}>
                      <Text size="xs" ff="monospace" lineClamp={2} title={r.sqlText ?? ''}>
                        {oneLine(r.sqlText)}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </div>
    </>
  );
}
