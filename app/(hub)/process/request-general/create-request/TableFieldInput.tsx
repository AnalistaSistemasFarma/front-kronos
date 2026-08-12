'use client';

import {
  Table,
  TextInput,
  NumberInput,
  Select,
  Switch,
  Button,
  ActionIcon,
  Text,
  ScrollArea,
  Group,
} from '@mantine/core';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import { isSapColumn, type TableColumn, type TableRow } from '../../../../../lib/requests-general/tableField';
import SapOptionSelect from './SapOptionSelect';

interface TableFieldInputProps {
  label: string;
  required: boolean;
  columns: TableColumn[];
  rows: TableRow[];
  onChange: (rows: TableRow[]) => void;
  companyId?: number;
  error?: string;
}

/**
 * Render editable de un campo de tipo "Tabla" en el formulario de la solicitud.
 * Muestra una tabla con columnas tipadas; el usuario agrega/borra filas
 * ilimitadas y cada celda usa el input correspondiente al tipo de su columna.
 */
export default function TableFieldInput({
  label,
  required,
  columns,
  rows,
  onChange,
  companyId,
  error,
}: TableFieldInputProps) {
  const updateCell = (rowIndex: number, colKey: string, value: unknown) => {
    const next = rows.map((r, i) =>
      i === rowIndex ? { ...r, [colKey]: value } : r
    );
    onChange(next);
  };

  const addRow = () => {
    onChange([...rows, {}]);
  };

  const removeRow = (rowIndex: number) => {
    onChange(rows.filter((_, i) => i !== rowIndex));
  };

  if (columns.length === 0) {
    return (
      <div>
        <Text fw={500} size='sm' mb={4}>
          {label}
        </Text>
        <Text size='sm' c='dimmed'>
          Esta tabla no tiene columnas configuradas.
        </Text>
      </div>
    );
  }

  const renderCell = (col: TableColumn, rowIndex: number) => {
    const raw = rows[rowIndex]?.[col.key];
    const commonSize = 'xs' as const;

    switch (col.type) {
      case 'number':
        return (
          <NumberInput
            size={commonSize}
            placeholder='0'
            value={raw === undefined || raw === null || raw === '' ? '' : (raw as number | string)}
            onChange={(v) =>
              updateCell(rowIndex, col.key, v === '' || v === null ? undefined : v)
            }
            hideControls
            allowNegative={false}
          />
        );
      case 'money':
        return (
          <NumberInput
            size={commonSize}
            placeholder='0'
            value={raw === undefined || raw === null || raw === '' ? '' : (raw as number | string)}
            onChange={(v) =>
              updateCell(rowIndex, col.key, v === '' || v === null ? undefined : v)
            }
            thousandSeparator='.'
            decimalSeparator=','
            decimalScale={0}
            allowNegative={false}
            hideControls
            min={0}
          />
        );
      case 'date':
        return (
          <TextInput
            size={commonSize}
            type='date'
            value={typeof raw === 'string' ? raw : ''}
            onChange={(e) => updateCell(rowIndex, col.key, e.currentTarget.value)}
          />
        );
      case 'select':
        return (
          <Select
            size={commonSize}
            placeholder='Seleccione'
            data={(col.options || []).map((o) => ({ value: o, label: o }))}
            value={typeof raw === 'string' ? raw : null}
            onChange={(v) => updateCell(rowIndex, col.key, v ?? undefined)}
            clearable
            comboboxProps={{ withinPortal: true }}
          />
        );
      case 'yesno':
        return (
          <Switch
            checked={raw === true}
            onChange={(e) => updateCell(rowIndex, col.key, e.currentTarget.checked)}
            label={raw === true ? 'Sí' : 'No'}
          />
        );
      case 'sap_items':
      case 'sap_business_partners':
        return isSapColumn(col.type) ? (
          <SapOptionSelect
            source={col.type}
            companyId={companyId}
            label=''
            value={typeof raw === 'string' ? raw : undefined}
            onChange={(v) => updateCell(rowIndex, col.key, v || undefined)}
          />
        ) : null;
      case 'text':
      default:
        return (
          <TextInput
            size={commonSize}
            placeholder='Escriba…'
            value={typeof raw === 'string' ? raw : ''}
            onChange={(e) => updateCell(rowIndex, col.key, e.currentTarget.value)}
          />
        );
    }
  };

  return (
    <div>
      <Group gap={4} mb={6} align='center'>
        <Text fw={500} size='sm'>
          {label}
        </Text>
        {required && (
          <Text component='span' c='red' size='sm'>
            *
          </Text>
        )}
      </Group>

      <ScrollArea>
        <Table withTableBorder withColumnBorders verticalSpacing='xs' horizontalSpacing='xs'>
          <Table.Thead>
            <Table.Tr>
              {columns.map((col) => (
                <Table.Th key={col.key} style={{ minWidth: 140 }}>
                  {col.label}
                  {col.required && (
                    <Text component='span' c='red'>
                      {' '}
                      *
                    </Text>
                  )}
                </Table.Th>
              ))}
              <Table.Th style={{ width: 48 }} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.length === 0 ? (
              <Table.Tr>
                <Table.Td colSpan={columns.length + 1}>
                  <Text size='sm' c='dimmed' ta='center'>
                    Sin filas. Use &quot;Agregar fila&quot; para comenzar.
                  </Text>
                </Table.Td>
              </Table.Tr>
            ) : (
              rows.map((_, rowIndex) => (
                <Table.Tr key={rowIndex}>
                  {columns.map((col) => (
                    <Table.Td key={col.key}>{renderCell(col, rowIndex)}</Table.Td>
                  ))}
                  <Table.Td>
                    <ActionIcon
                      color='red'
                      variant='subtle'
                      onClick={() => removeRow(rowIndex)}
                      title='Quitar fila'
                    >
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Table.Td>
                </Table.Tr>
              ))
            )}
          </Table.Tbody>
        </Table>
      </ScrollArea>

      <Button
        mt='xs'
        size='xs'
        variant='light'
        leftSection={<IconPlus size={16} />}
        onClick={addRow}
      >
        Agregar fila
      </Button>

      {error && (
        <Text size='sm' c='red' mt={6}>
          {error}
        </Text>
      )}
    </div>
  );
}
