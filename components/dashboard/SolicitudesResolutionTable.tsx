'use client';

import { useMemo, useState } from 'react';
import {
  Badge,
  Group,
  Pagination,
  Paper,
  Stack,
  Table,
  Text,
  ThemeIcon,
} from '@mantine/core';
import { IconClockHour4 } from '@tabler/icons-react';
import type { RequestWithResolution } from '../../lib/dashboard/requestResolution';
import { formatHoursLabel } from '../../lib/dashboard/requestResolution';
import { normalizeRequestStatus } from '../../lib/dashboard/requestStatus';
import { dashboardChartTheme } from './chartTheme';

const PAGE_SIZE = 10;

function formatShortDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
}

interface SolicitudesResolutionTableProps {
  requests: RequestWithResolution[];
}

export default function SolicitudesResolutionTable({ requests }: SolicitudesResolutionTableProps) {
  const [page, setPage] = useState(1);

  const sorted = useMemo(
    () =>
      [...requests].sort((a, b) => {
        const ah = a.resolutionHours ?? -1;
        const bh = b.resolutionHours ?? -1;
        return bh - ah;
      }),
    [requests]
  );

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const rows = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  if (requests.length === 0) {
    return (
      <Text c='dimmed' ta='center' py='md'>
        No hay solicitudes para esta empresa en el periodo
      </Text>
    );
  }

  return (
    <Stack gap='md'>
      <Stack gap='sm' hiddenFrom='md'>
        {rows.map((r) => (
          <Paper key={r.id_solicitud} p='sm' withBorder>
            <Text size='sm' fw={600} lineClamp={2}>
              #{r.id_solicitud} · {r.asunto_solicitud}
            </Text>
            <Text size='xs' c='dimmed' mt={4}>
              {r.proceso_solicitud} · Creada {formatShortDate(r.fecha_creacion_solicitud)}
            </Text>
            <Group gap='xs' mt='sm' wrap='wrap'>
              <Badge variant='light'>{normalizeRequestStatus(r.estado_solicitud)}</Badge>
              <Badge
                variant='filled'
                color={r.resolutionHours != null ? 'blue' : 'gray'}
                leftSection={<IconClockHour4 size={12} />}
              >
                {r.resolutionHours != null
                  ? formatHoursLabel(r.resolutionHours)
                  : 'Sin cierre'}
              </Badge>
            </Group>
          </Paper>
        ))}
      </Stack>

      <Table.ScrollContainer minWidth={720} visibleFrom='md'>
        <Table striped highlightOnHover fz='sm'>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>ID</Table.Th>
              <Table.Th>Asunto</Table.Th>
              <Table.Th>Proceso</Table.Th>
              <Table.Th>Creación</Table.Th>
              <Table.Th>Cierre</Table.Th>
              <Table.Th>Tiempo total</Table.Th>
              <Table.Th>Estado</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((r) => (
              <Table.Tr key={r.id_solicitud}>
                <Table.Td fw={600}>#{r.id_solicitud}</Table.Td>
                <Table.Td>
                  <Text size='sm' lineClamp={2} maw={220}>
                    {r.asunto_solicitud}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size='sm' lineClamp={1}>
                    {r.proceso_solicitud}
                  </Text>
                </Table.Td>
                <Table.Td>{formatShortDate(r.fecha_creacion_solicitud)}</Table.Td>
                <Table.Td>
                  {formatShortDate(r.resolutionEndDate ?? r.fecha_resolucion_solicitud)}
                  {r.resolutionSource === 'tareas' && r.resolutionHours != null && (
                    <Text size='xs' c='dimmed'>
                      (por tareas)
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>
                  {r.resolutionHours != null ? (
                    <Group gap={6} wrap='nowrap'>
                      <ThemeIcon size='sm' variant='light' color='blue'>
                        <IconClockHour4 size={14} />
                      </ThemeIcon>
                      <Text fw={700} style={{ color: dashboardChartTheme.primary }}>
                        {formatHoursLabel(r.resolutionHours)}
                      </Text>
                    </Group>
                  ) : (
                    <Text size='sm' c='dimmed'>
                      En curso
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>
                  <Badge variant='light' size='sm'>
                    {normalizeRequestStatus(r.estado_solicitud)}
                  </Badge>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>

      {totalPages > 1 && (
        <Group justify='center'>
          <Pagination total={totalPages} value={safePage} onChange={setPage} size='sm' />
        </Group>
      )}
    </Stack>
  );
}
