'use client';

import React from 'react';
import { Alert, Badge, Group, Select, Stack, Table, Text } from '@mantine/core';
import { IconBolt, IconPlugConnected } from '@tabler/icons-react';
import { actionsFor, getSapAction } from '../../lib/workflow-sap/catalog';

/**
 * Objeto «Tarea SAP» del flujo: selector de la accion (al agregarla) y la
 * informacion que se muestra en su tarjeta (accion, endpoint y mapeo).
 */

/** Selector de la accion del catalogo + mapeo, para la ventana «Agregar tarea». */
export function SapTaskActionPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const options = actionsFor('sap_executor', 'on_execute');
  const def = value ? getSapAction(value) : undefined;
  return (
    <Stack gap="xs">
      <Select
        label="Acción en SAP"
        placeholder="Elija una acción del catálogo"
        data={options.map((o) => ({ value: o.key, label: o.label }))}
        value={value || null}
        onChange={(v) => onChange(v ?? '')}
        required
        comboboxProps={{ withinPortal: true, zIndex: 1100 }}
      />
      {def && <SapMappingTable actionKey={def.key} />}
      <Alert color="blue" variant="light" p="xs">
        <Text size="xs">
          La ejecuta el sistema cuando le llega el turno en el flujo, sin responsable. Si SAP falla, queda pendiente con el
          error y se puede reintentar; todo queda en el historial de la solicitud.
        </Text>
      </Alert>
    </Stack>
  );
}

/** Tabla del mapeo de una accion (que dato de SynerLink va a que campo de SAP). */
export function SapMappingTable({ actionKey }: { actionKey: string }) {
  const def = getSapAction(actionKey);
  if (!def) return null;
  return (
    <Table withTableBorder fz="xs" verticalSpacing={2}>
      <Table.Thead>
        <Table.Tr>
          <Table.Th colSpan={3}>
            <Group gap={6}>
              <IconPlugConnected size={14} /> {def.endpoint}
            </Group>
          </Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {def.mapping.map((m) => (
          <Table.Tr key={m.target}>
            <Table.Td>{m.source}</Table.Td>
            <Table.Td>
              <code>{m.target}</code>
            </Table.Td>
            <Table.Td c={m.editable ? undefined : 'dimmed'}>{m.editable ? 'Editable' : 'Fijo (SAPSEND)'}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

/** Distintivos de la tarjeta de una tarea SAP. */
export function SapTaskCardInfo({ actionKey }: { actionKey?: string | null }) {
  const def = actionKey ? getSapAction(actionKey) : undefined;
  return (
    <>
      <Badge color="blue" variant="filled" size="sm" leftSection={<IconBolt size={12} />}>
        Tarea SAP
      </Badge>
      <Badge color="blue" variant="light" size="sm" styles={{ root: { textTransform: 'none' } }}>
        {def ? `${def.label} · ${def.endpoint}` : 'Sin acción configurada'}
      </Badge>
    </>
  );
}
