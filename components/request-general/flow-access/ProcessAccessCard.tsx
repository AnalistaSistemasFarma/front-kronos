'use client';

import { Alert, Badge, Button, Card, Group, MultiSelect, Stack, Switch, Table, Text } from '@mantine/core';
import { IconLock, IconLockOpen } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';

interface AccessRow {
  restricted: boolean;
  sgcOnly: boolean;
  canEdit: boolean;
  canManageAccess: boolean;
  reason: string | null;
  editors: { id: string; name: string | null; email: string | null }[];
  log: { id: number; actor_email: string; action: string; detail: string | null; created_at: string }[];
}

const fecha = (iso: string) => new Date(iso).toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'short', timeStyle: 'short' });

/**
 * «Acceso al flujo» in the workflow administration (2026-11-24): restricted access with its editors, «solo plantillas del
 * SGC» and the flow change log. Only system administrators change the access; everyone who sees the flow sees the state.
 */
export function ProcessAccessCard({ processId }: { processId: number }) {
  const [row, setRow] = useState<AccessRow | null>(null);
  const [editing, setEditing] = useState(false);
  const [restricted, setRestricted] = useState(false);
  const [sgcOnly, setSgcOnly] = useState(false);
  const [editors, setEditors] = useState<string[]>([]);
  const [users, setUsers] = useState<{ value: string; label: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [showLog, setShowLog] = useState(false);

  const load = async () => {
    const res = await fetch(`/api/requests-general/flow-access?id=${processId}`, { cache: 'no-store' });
    if (!res.ok) return;
    const data = (await res.json()) as AccessRow;
    setRow(data);
    setRestricted(data.restricted);
    setSgcOnly(data.sgcOnly);
    setEditors(data.editors.map((e) => e.id));
  };
  useEffect(() => {
    void load();
  }, [processId]);

  const startEdit = async () => {
    setEditing(true);
    if (users.length) return;
    const res = await fetch('/api/requests-general/users-emails', { cache: 'no-store' });
    const data = (await res.json().catch(() => ({}))) as { users?: { id: string; name: string | null; email: string | null }[] };
    const all = (data.users ?? []).map((u) => ({ value: u.id, label: `${u.name ?? u.email ?? u.id}${u.email ? ` · ${u.email}` : ''}` }));
    // Current editors stay selectable even if they are no longer in the active list.
    for (const e of row?.editors ?? []) if (!all.some((u) => u.value === e.id)) all.push({ value: e.id, label: `${e.name ?? e.id}${e.email ? ` · ${e.email}` : ''}` });
    setUsers(all);
  };

  if (!row) return null;

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/requests-general/flow-access', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: processId, restricted, sgcOnly, editors }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'No se pudo guardar el acceso del flujo');
      toast.success('Acceso del flujo guardado');
      setEditing(false);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo guardar el acceso del flujo');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card withBorder radius='md' p='md' data-testid='process-access-card'>
      <Stack gap='sm'>
        <Group justify='space-between'>
          <Group gap='xs'>
            {row.restricted ? <IconLock size={18} style={{ color: 'var(--mantine-color-orange-6)' }} /> : <IconLockOpen size={18} style={{ color: 'var(--mantine-color-dimmed)' }} />}
            <Text size='sm' c='dimmed' fw={500}>
              Acceso al flujo
            </Text>
          </Group>
          <Group gap='xs'>
            {row.log.length > 0 && (
              <Button size='xs' variant='subtle' onClick={() => setShowLog((v) => !v)}>
                {showLog ? 'Ocultar cambios' : `Historial de cambios (${row.log.length})`}
              </Button>
            )}
            {row.canManageAccess && !editing && (
              <Button size='xs' variant='light' onClick={() => void startEdit()} data-testid='process-access-edit'>
                Gestionar acceso
              </Button>
            )}
          </Group>
        </Group>

        {editing ? (
          <>
            <Switch label='Acceso restringido: solo los editores cambian este flujo' checked={restricted} onChange={(e) => setRestricted(e.currentTarget.checked)} data-testid='process-access-restricted' />
            <MultiSelect
              label='Editores del flujo'
              description='Pueden cambiar campos, tareas, plantillas, ANS y activar o desactivar el flujo.'
              data={users}
              value={editors}
              onChange={setEditors}
              searchable
              clearable
              maxValues={50}
              nothingFoundMessage='Sin coincidencias'
              data-testid='process-access-editors'
            />
            <Switch label='Solo plantillas del SGC: los documentos del flujo se llenan sobre un documento vigente del SGC' checked={sgcOnly} onChange={(e) => setSgcOnly(e.currentTarget.checked)} data-testid='process-access-sgc' />
            <Group justify='flex-end'>
              <Button variant='default' size='xs' onClick={() => { setEditing(false); void load(); }}>
                Cancelar
              </Button>
              <Button size='xs' loading={saving} disabled={restricted && editors.length === 0} onClick={() => void save()} data-testid='process-access-save'>
                Guardar acceso
              </Button>
            </Group>
          </>
        ) : (
          <Stack gap={6}>
            <Group gap='xs'>
              <Badge variant='light' color={row.restricted ? 'orange' : 'gray'}>
                {row.restricted ? 'Restringido' : 'Sin restricción'}
              </Badge>
              {row.sgcOnly && (
                <Badge variant='light' color='blue'>
                  Solo plantillas del SGC
                </Badge>
              )}
            </Group>
            {row.restricted && (
              <Text size='sm'>
                Editores: {row.editors.length ? row.editors.map((e) => e.name ?? e.email ?? e.id).join(', ') : '—'}
              </Text>
            )}
            {!row.canEdit && row.reason && (
              <Alert color='orange' variant='light' p='xs' data-testid='process-access-readonly'>
                <Text size='sm'>{row.reason}</Text>
              </Alert>
            )}
          </Stack>
        )}

        {showLog && (
          <Table striped fz='xs' verticalSpacing={4}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Fecha</Table.Th>
                <Table.Th>Quién</Table.Th>
                <Table.Th>Cambio</Table.Th>
                <Table.Th>Detalle</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {row.log.map((l) => (
                <Table.Tr key={l.id}>
                  <Table.Td>{fecha(l.created_at)}</Table.Td>
                  <Table.Td>{l.actor_email}</Table.Td>
                  <Table.Td>{l.action}</Table.Td>
                  <Table.Td>{l.detail ?? '—'}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Stack>
    </Card>
  );
}
