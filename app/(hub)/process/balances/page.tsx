'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  Title,
  Text,
  Stack,
  SimpleGrid,
  Card,
  Button,
  Badge,
  Table,
  Alert,
  Group,
} from '@mantine/core';
import { IconAlertTriangle, IconPlayerPlay } from '@tabler/icons-react';

/**
 * Balances — Sprint 2.
 *
 * Habilitadas: Farmalogica, OLP y GSS (ver lib/balances/companies.ts).
 * Cada botón dispara /api/balances/submit-run y la corrida continúa en
 * background. El historial se consulta cada 2 segundos mientras hay una
 * corrida activa, para reflejar running/success/failed sin bloquear el request.
 */

const COMPANIES = [
  { idCompany: 1, displayName: 'Farmalogica' },
  { idCompany: 3, displayName: 'One Latam Pharma' },
  { idCompany: 8, displayName: 'GSS' },
  { idCompany: 9, displayName: 'Abamia' },
] as const;

interface RunRow {
  id: number;
  id_company: number;
  triggered_by: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  balance_duration_ms: number | null;
  acumulado_duration_ms: number | null;
  error_message: string | null;
}

function statusColor(status: string) {
  if (status === 'success') return 'green';
  if (status === 'failed') return 'red';
  return 'yellow';
}

export default function BalancesPage() {
  const [runningCompany, setRunningCompany] = useState<number | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(true);
  // Candado GLOBAL: si CUALQUIER empresa tiene una corrida 'running' (la
  // disparó otra persona/pestaña), se deshabilitan los botones — el servidor
  // igual lo rechaza (409) si se cuela un clic; esto es solo UX.
  const [globallyRunning, setGloballyRunning] = useState<RunRow | null>(null);

  const fetchRuns = useCallback(async () => {
    try {
      const res = await fetch('/api/balances/runs?limit=15');
      const data = await res.json();
      const list: RunRow[] = Array.isArray(data.runs) ? data.runs : [];
      setRuns(list);
      setGloballyRunning(list.find((r) => r.status === 'running') ?? null);
    } catch {
      // silencioso: el historial es informativo, no bloquea el botón
    } finally {
      setLoadingRuns(false);
    }
  }, []);

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  useEffect(() => {
    if (!globallyRunning) return;
    const timer = window.setInterval(fetchRuns, 2000);
    return () => window.clearInterval(timer);
  }, [fetchRuns, globallyRunning]);

  async function handleRun(idCompany: number) {
    setRunningCompany(idCompany);
    setLastError(null);
    try {
      const res = await fetch(`/api/balances/submit-run?companyId=${idCompany}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setLastError(data.error || 'No se pudo ejecutar el balance.');
      }
    } catch (err) {
      setLastError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunningCompany(null);
      await fetchRuns();
    }
  }

  return (
    <Stack gap="lg" p="md">
      <div>
        <Title order={2}>Balances</Title>
        <Text c="dimmed" size="sm">
          Ejecuta el balance y el balance acumulado de Farmalogica. Las demás empresas permanecen
          bloqueadas hasta completar su activación operativa.
        </Text>
      </div>

      {lastError && (
        <Alert color="red" icon={<IconAlertTriangle size={18} />} title="Error al ejecutar">
          {lastError}
        </Alert>
      )}

      {globallyRunning && runningCompany === null && (
        <Alert color="yellow" icon={<IconAlertTriangle size={18} />} title="Hay un balance en curso">
          {COMPANIES.find((c) => c.idCompany === globallyRunning.id_company)?.displayName ??
            globallyRunning.id_company}{' '}
          está corriendo ahora mismo (disparado por {globallyRunning.triggered_by}). Solo se permite una
          corrida a la vez para no sobrecargar el 10.7 — espere a que termine.
        </Alert>
      )}

      <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }}>
        {COMPANIES.map((c) => {
          const blockedByOther = globallyRunning !== null && globallyRunning.id_company !== c.idCompany;
          return (
            <Card key={c.idCompany} withBorder padding="lg">
              <Stack gap="xs" align="center">
                <Text fw={600}>{c.displayName}</Text>
                <Button
                  leftSection={<IconPlayerPlay size={16} />}
                  loading={runningCompany === c.idCompany}
                  disabled={(runningCompany !== null && runningCompany !== c.idCompany) || blockedByOther}
                  onClick={() => handleRun(c.idCompany)}
                  fullWidth
                >
                  Ejecutar balances
                </Button>
              </Stack>
            </Card>
          );
        })}
      </SimpleGrid>

      <div>
        <Title order={4} mb="xs">
          Últimas corridas
        </Title>
        {loadingRuns ? (
          <Text size="sm" c="dimmed">
            Cargando…
          </Text>
        ) : runs.length === 0 ? (
          <Text size="sm" c="dimmed">
            Sin corridas todavía.
          </Text>
        ) : (
          <Table striped withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Empresa</Table.Th>
                <Table.Th>Estado</Table.Th>
                <Table.Th>Inicio</Table.Th>
                <Table.Th>Duración (balance / acumulado)</Table.Th>
                <Table.Th>Ejecutado por</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {runs.map((r) => {
                const company = COMPANIES.find((c) => c.idCompany === r.id_company);
                return (
                  <Table.Tr key={r.id}>
                    <Table.Td>{company?.displayName ?? r.id_company}</Table.Td>
                    <Table.Td>
                      <Group gap={6}>
                        <Badge color={statusColor(r.status)}>{r.status}</Badge>
                      </Group>
                      {r.error_message && (
                        <Text size="xs" c="red">
                          {r.error_message}
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>{new Date(r.started_at).toLocaleString('es-CO')}</Table.Td>
                    <Table.Td>
                      {r.balance_duration_ms != null ? `${(r.balance_duration_ms / 1000).toFixed(1)}s` : '—'} /{' '}
                      {r.acumulado_duration_ms != null ? `${(r.acumulado_duration_ms / 1000).toFixed(1)}s` : '—'}
                    </Table.Td>
                    <Table.Td>{r.triggered_by}</Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        )}
      </div>
    </Stack>
  );
}
