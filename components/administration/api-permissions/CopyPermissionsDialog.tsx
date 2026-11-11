'use client';

/**
 * «Copiar estos permisos a otros clientes» (2026-11-11). Se eligen agentes, personas de México u
 * otros sistemas y reciben los MISMOS permisos del cliente abierto (reemplazan los suyos). Cada
 * destino conserva sus reglas: en solo lectura no recibe los de escritura y sin agente no recibe los
 * que exigen agente (permissionsForCopy, la misma función que usa el servidor).
 */
import { useMemo, useState } from 'react';
import { Alert, Button, Checkbox, Group, Modal, Stack, Text, TextInput } from '@mantine/core';
import { IconCopy, IconInfoCircle, IconSearch } from '@tabler/icons-react';
import toast from 'react-hot-toast';
import {
  API_ACCESS_MODE_LABELS,
  API_CLIENT_TYPES,
  API_CLIENT_TYPE_SECTION_TITLES,
  clientTypeUsesApiAccess,
  permissionsForCopy,
  type ApiClientType,
} from '@/lib/api-permissions/constants';
import type { ApiClientItem, ApiPermissionItem } from './types';

interface Props {
  opened: boolean;
  source: ApiClientItem;
  clients: ApiClientItem[];
  permissions: ApiPermissionItem[];
  onClose: () => void;
  /** Se copiaron: recargar la lista para ver los permisos nuevos. */
  onCopied: () => void;
}

interface Outcome {
  clientId: number;
  name: string;
  applied: boolean;
  received: number;
  droppedWrite: number;
  droppedAgent: number;
}

export default function CopyPermissionsDialog({ opened, source, clients, permissions, onClose, onCopied }: Props) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);

  const activeCodes = useMemo(() => new Set(permissions.filter((p) => p.active).map((p) => p.code)), [permissions]);
  const writeCodes = useMemo(
    () => new Set(permissions.filter((p) => p.accessKind === 'escritura').map((p) => p.code)),
    [permissions]
  );
  const sourceCodes = useMemo(() => source.permissionCodes.filter((c) => activeCodes.has(c)), [source, activeCodes]);

  // Candidatos: los que usan permisos de API (no proveedores), distintos del cliente abierto.
  const needle = query.trim().toLowerCase();
  const sections = useMemo(() => {
    const candidates = clients.filter(
      (c) =>
        c.id !== source.id &&
        clientTypeUsesApiAccess(c.clientType) &&
        (!needle ||
          c.name.toLowerCase().includes(needle) ||
          (c.agentCode ?? '').toLowerCase().includes(needle) ||
          (c.subjectRef ?? '').toLowerCase().includes(needle))
    );
    return API_CLIENT_TYPES.map((type) => ({
      type,
      items: candidates.filter((c) => c.clientType === type).sort((a, b) => a.name.localeCompare(b.name, 'es')),
    })).filter((s) => s.items.length > 0);
  }, [clients, source.id, needle]);

  const toggle = (id: number, checked: boolean) =>
    setSelected((prev) => (checked ? [...new Set([...prev, id])] : prev.filter((x) => x !== id)));
  const toggleType = (type: ApiClientType, checked: boolean) => {
    const ids = sections.find((s) => s.type === type)?.items.map((c) => c.id) ?? [];
    setSelected((prev) => (checked ? [...new Set([...prev, ...ids])] : prev.filter((x) => !ids.includes(x))));
  };

  const close = () => {
    if (saving) return;
    setSelected([]);
    setQuery('');
    onClose();
  };

  const copy = async () => {
    if (selected.length === 0) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/administration/api-clients/${source.id}/copy-permissions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetIds: selected }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string; outcomes?: Outcome[] } | null;
      if (!res.ok || !body?.outcomes) throw new Error(body?.error || 'No se pudieron copiar los permisos');
      const applied = body.outcomes.filter((o) => o.applied);
      const trimmed = applied.filter((o) => o.droppedWrite + o.droppedAgent > 0).length;
      toast.success(
        `Permisos copiados a ${applied.length} ${applied.length === 1 ? 'cliente' : 'clientes'}` +
          (trimmed > 0 ? ` (${trimmed} sin algunos permisos por sus reglas)` : '')
      );
      onCopied();
      setSelected([]);
      setQuery('');
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudieron copiar los permisos');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={close}
      title={`Copiar los permisos de «${source.name}»`}
      size={640}
      centered
      zIndex={300}
      closeOnEscape={!saving}
      closeOnClickOutside={!saving}
    >
      <Stack gap='md'>
        <Text size='sm' c='dimmed'>
          Los clientes que elijas quedan con estos {sourceCodes.length} {sourceCodes.length === 1 ? 'permiso' : 'permisos'}.{' '}
          <b>Reemplaza</b> los que tengan hoy. No cambia sus empresas, llaves ni nivel de acceso.
        </Text>

        <TextInput
          placeholder='Buscar por nombre, agente o correo'
          aria-label='Buscar clientes'
          leftSection={<IconSearch size={16} />}
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          radius='xl'
        />

        {sections.length === 0 ? (
          <Text size='sm' c='dimmed' ta='center' py='lg'>
            {needle ? 'Ningún cliente coincide.' : 'No hay otros clientes a los que copiar permisos.'}
          </Text>
        ) : (
          <Stack gap='lg' mah={420} style={{ overflowY: 'auto' }}>
            {sections.map(({ type, items }) => {
              const marked = items.filter((c) => selected.includes(c.id)).length;
              return (
                <Stack key={type} gap={6}>
                  <Checkbox
                    label={
                      <Text fw={700} size='sm'>
                        {API_CLIENT_TYPE_SECTION_TITLES[type]} ({items.length})
                      </Text>
                    }
                    checked={marked === items.length}
                    indeterminate={marked > 0 && marked < items.length}
                    onChange={(e) => toggleType(type, e.currentTarget.checked)}
                  />
                  {items.map((c) => {
                    const preview = permissionsForCopy(sourceCodes, c, writeCodes);
                    const notes = [
                      preview.droppedWrite.length > 0
                        ? `sin ${preview.droppedWrite.length} de escritura (está en solo lectura)`
                        : null,
                      preview.droppedAgent.length > 0 ? `sin ${preview.droppedAgent.length} que exigen agente` : null,
                    ].filter(Boolean);
                    return (
                      <Checkbox
                        key={c.id}
                        ml='lg'
                        checked={selected.includes(c.id)}
                        onChange={(e) => toggle(c.id, e.currentTarget.checked)}
                        label={
                          <span>
                            <Text span size='sm' fw={600}>
                              {c.name}
                            </Text>
                            <Text span size='xs' c='dimmed'>
                              {' · '}
                              {API_ACCESS_MODE_LABELS[c.accessMode ?? 'lectura']}
                              {c.agentCode ? ` · Agente: ${c.agentCode}` : ''}
                            </Text>
                          </span>
                        }
                        description={
                          `Tiene ${c.permissionCodes.filter((x) => activeCodes.has(x)).length} → quedará con ${preview.codes.length}` +
                          (notes.length ? ` (${notes.join('; ')})` : '')
                        }
                      />
                    );
                  })}
                </Stack>
              );
            })}
          </Stack>
        )}

        <Alert variant='light' color='blue' icon={<IconInfoCircle size={16} />} p='sm'>
          Cada cliente conserva sus reglas: en solo lectura no recibe permisos de escritura y sin agente no recibe los de
          Proyectos, Correo ni «Solicitar conectores de IA». Los proveedores no salen aquí: lo que ven se maneja en su portal.
        </Alert>

        <Group justify='flex-end'>
          <Button variant='default' onClick={close} disabled={saving}>
            Cancelar
          </Button>
          <Button
            leftSection={<IconCopy size={16} />}
            onClick={() => void copy()}
            disabled={selected.length === 0}
            loading={saving}
          >
            {selected.length === 0
              ? 'Copiar'
              : `Copiar a ${selected.length} ${selected.length === 1 ? 'cliente' : 'clientes'}`}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
