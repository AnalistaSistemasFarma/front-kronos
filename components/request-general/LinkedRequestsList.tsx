'use client';

import { Badge, Button, Group, Stack, Table, Text } from '@mantine/core';
import { IconPlus } from '@tabler/icons-react';

interface Linked {
  id: number;
  consecutive?: string | null;
  subject?: string | null;
  status_req?: number | null;
}

const ESTADO: Record<number, { t: string; c: string }> = { 2: { t: 'Resuelta', c: 'green' }, 3: { t: 'Cancelada', c: 'red' } };

/**
 * 2026-11-26 (Calidad OLP: «una auditoría genera varias no conformidades»): tarea que crea VARIAS solicitudes
 * vinculadas; muestra las suyas y la cierra su responsable cuando termina de registrarlas.
 */
export default function LinkedRequestsList({ label, json, canCreate, onCreate, onOpen }: { label: string; json?: string | null; canCreate: boolean; onCreate: () => void; onOpen: (id: number) => void }) {
  let rows: Linked[] = [];
  try {
    rows = json ? (JSON.parse(json) as Linked[]) : [];
  } catch {
    rows = [];
  }
  return (
    <Stack gap='xs' data-testid='linked-requests-list'>
      <Text size='sm'>
        Cree una solicitud del flujo <b>{label}</b> por cada caso (p. ej. una no conformidad por hallazgo). Cuando termine de registrarlas,
        cierre esta tarea; cada solicitud sigue su propio proceso.
      </Text>
      {rows.length > 0 && (
        <Table fz='sm' verticalSpacing={4} withTableBorder>
          <Table.Tbody>
            {rows.map((r) => (
              <Table.Tr key={r.id}>
                <Table.Td>
                  <b>{r.consecutive ?? `#${r.id}`}</b>
                </Table.Td>
                <Table.Td>{r.subject ?? '—'}</Table.Td>
                <Table.Td>
                  <Badge variant='light' color={ESTADO[Number(r.status_req)]?.c ?? 'blue'}>
                    {ESTADO[Number(r.status_req)]?.t ?? 'En curso'}
                  </Badge>
                </Table.Td>
                <Table.Td w={90}>
                  <Button size='compact-xs' variant='subtle' onClick={() => onOpen(r.id)}>
                    Ver
                  </Button>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
      <Group>
        <Button color='grape' size='xs' leftSection={<IconPlus size={14} />} disabled={!canCreate} onClick={onCreate} data-testid='linked-requests-create'>
          {rows.length ? 'Registrar otra' : 'Registrar la primera'}
        </Button>
        <Text size='xs' c='dimmed'>
          {rows.length} registrada(s)
        </Text>
      </Group>
    </Stack>
  );
}
