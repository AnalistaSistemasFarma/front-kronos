'use client';

import { ActionIcon, Button, Group, Table, TextInput } from '@mantine/core';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import SgcSelect from '../sgc/SgcSelect';
import type { FilaMapeo } from '../../lib/transferencias-nabuco/mapeo';

const ORIGENES = [
  { value: 'campo_sap', label: 'Campo SAP' },
  { value: 'fijo', label: 'Valor fijo' },
];

/** Tabla editable del mapeo SAP → Nabuco (filas agregables y eliminables). */
export default function NabucoMapeo({ filas, onChange }: { filas: FilaMapeo[]; onChange: (f: FilaMapeo[]) => void }) {
  const set = (i: number, cambio: Partial<FilaMapeo>) => onChange(filas.map((f, j) => (j === i ? { ...f, ...cambio } : f)));
  return (
    <>
      <Table.ScrollContainer minWidth={600}>
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Campo Nabuco</Table.Th>
              <Table.Th w={160}>Origen</Table.Th>
              <Table.Th>Valor / campo SAP</Table.Th>
              <Table.Th w={50} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {filas.map((f, i) => (
              <Table.Tr key={i}>
                <Table.Td>
                  <TextInput value={f.campo} onChange={(e) => set(i, { campo: e.currentTarget.value })} aria-label='Campo Nabuco' />
                </Table.Td>
                <Table.Td>
                  <SgcSelect data={ORIGENES} value={f.origen} allowDeselect={false} onChange={(v) => set(i, { origen: (v as FilaMapeo['origen']) ?? 'fijo' })} aria-label='Origen' />
                </Table.Td>
                <Table.Td>
                  <TextInput
                    value={f.valor}
                    placeholder={f.origen === 'campo_sap' ? 'Ej. CardName o AddressExtension.ShipToStreet' : 'Valor fijo'}
                    onChange={(e) => set(i, { valor: e.currentTarget.value })}
                    aria-label='Valor'
                  />
                </Table.Td>
                <Table.Td>
                  <ActionIcon variant='subtle' color='red' aria-label='Quitar fila' onClick={() => onChange(filas.filter((_, j) => j !== i))}>
                    <IconTrash size={16} />
                  </ActionIcon>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      <Group mt='xs'>
        <Button size='xs' variant='light' leftSection={<IconPlus size={14} />} onClick={() => onChange([...filas, { campo: '', origen: 'campo_sap', valor: '' }])}>
          Agregar fila
        </Button>
      </Group>
    </>
  );
}
