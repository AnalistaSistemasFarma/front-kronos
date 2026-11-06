'use client';

import { Alert, Button, Group, Loader, Modal, NumberInput, Stack, Table, Text } from '@mantine/core';
import { useEffect, useState } from 'react';

/**
 * Mapeo SAPSEND por empresa (modulo de compras). Cada SAPSEND numera sus
 * perfiles y departamentos, asi que se configura una fila por empresa.
 * Persiste en company_user via /api/users/[id]/sapsend.
 */

interface MappingRow {
  id_company_user: number;
  id_company: number;
  company: string;
  id_user_sapsend: number | null;
  id_department_sapsend: number | null;
}

interface Props {
  opened: boolean;
  onClose: () => void;
  userId: string | null;
  userName?: string | null;
}

export default function SapsendMappingModal({ opened, onClose, userId, userName }: Props) {
  const [rows, setRows] = useState<MappingRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!opened || !userId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/users/${userId}/sapsend`, { cache: 'no-store' })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'No se pudo cargar el mapeo');
        if (!cancelled) setRows(data.mappings ?? []);
      })
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [opened, userId]);

  const update = (id: number, field: 'id_user_sapsend' | 'id_department_sapsend', value: string | number) => {
    const parsed = value === '' ? null : Number(value);
    setRows((prev) => prev.map((r) => (r.id_company_user === id ? { ...r, [field]: parsed } : r)));
  };

  const save = async () => {
    if (!userId) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/users/${userId}/sapsend`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mappings: rows.map(({ id_company_user, id_user_sapsend, id_department_sapsend }) => ({
            id_company_user,
            id_user_sapsend,
            id_department_sapsend,
          })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'No se pudo guardar');
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title={`SAPSEND por empresa${userName ? ` · ${userName}` : ''}`} size='lg'>
      <Stack>
        <Text size='sm' c='dimmed'>
          Lo usa el modulo de compras para registrar quien crea la solicitud y su departamento en SAPSEND. Cada
          empresa tiene sus propios IDs. Deje vacio si el usuario no crea solicitudes en esa empresa.
        </Text>

        {loading && <Loader size='sm' />}
        {error && <Alert color='red'>{error}</Alert>}
        {!loading && !error && rows.length === 0 && (
          <Alert color='yellow'>El usuario no esta asociado a ninguna empresa.</Alert>
        )}

        {!loading && rows.length > 0 && (
          // Si falla el guardado, el error se muestra arriba y las filas siguen editables.
          <Table striped withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Empresa</Table.Th>
                <Table.Th>ID usuario SAPSEND</Table.Th>
                <Table.Th>ID departamento SAPSEND</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((r) => (
                <Table.Tr key={r.id_company_user}>
                  <Table.Td>{r.company}</Table.Td>
                  <Table.Td>
                    <NumberInput
                      size='xs'
                      min={1}
                      allowDecimal={false}
                      allowNegative={false}
                      value={r.id_user_sapsend ?? ''}
                      onChange={(v) => update(r.id_company_user, 'id_user_sapsend', v)}
                      aria-label={`ID usuario SAPSEND en ${r.company}`}
                    />
                  </Table.Td>
                  <Table.Td>
                    <NumberInput
                      size='xs'
                      min={1}
                      allowDecimal={false}
                      allowNegative={false}
                      value={r.id_department_sapsend ?? ''}
                      onChange={(v) => update(r.id_company_user, 'id_department_sapsend', v)}
                      aria-label={`ID departamento SAPSEND en ${r.company}`}
                    />
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}

        <Group justify='flex-end'>
          <Button variant='default' onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={save} loading={saving} disabled={loading || rows.length === 0}>
            Guardar
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
