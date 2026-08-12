'use client';

/**
 * Galería / consulta de una vista publicada (Incremento 2 + 3, §5.4 / §3).
 *
 * Ejecuta la vista por su slug (POST /api/custom-views/[slug]/run), renderiza un
 * PANEL DE FILTROS parametrizables a partir de las definiciones de la vista,
 * muestra la tabla de resultados y permite exportar a Excel (por defecto) o CSV
 * (reusa exceljs/file-saver). El alcance de empresa y las condiciones de filtro
 * (parametrizadas) las inyecta el backend.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  MultiSelect,
  NumberInput,
  Paper,
  Select,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import {
  IconAlertTriangle,
  IconFileSpreadsheet,
  IconFileTypeCsv,
  IconFilter,
  IconRefresh,
} from '@tabler/icons-react';

interface FilterDef {
  id_saved_view_filter: number;
  column_name: string;
  label: string;
  filter_type: string;
  operator: string;
  options_json: string | null;
  default_value: string | null;
  required: boolean;
  sort_order: number;
}

interface RunResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
  view: { id: number; slug: string; name: string };
  filters?: FilterDef[];
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** Convierte options_json a la lista {value,label} para Select/MultiSelect. */
function parseOptions(json: string | null): { value: string; label: string }[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((o) => {
      if (o && typeof o === 'object') {
        const rec = o as Record<string, unknown>;
        const value = String(rec.value ?? rec.val ?? rec.id ?? '');
        return { value, label: String(rec.label ?? rec.text ?? value) };
      }
      return { value: String(o), label: String(o) };
    });
  } catch {
    return [];
  }
}

/** Valor inicial de un filtro a partir de su default_value, según tipo/operador. */
function initValue(f: FilterDef): unknown {
  const dv = f.default_value;
  if (f.operator === 'between' || f.filter_type === 'daterange') {
    if (!dv) return ['', ''];
    const [a, b] = dv.split(',').map((s) => s.trim());
    return [a ?? '', b ?? ''];
  }
  if (f.operator === 'in') {
    if (!dv) return [];
    return dv.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return dv ?? '';
}

export default function CustomViewGalleryPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug;

  const [result, setResult] = useState<RunResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterDef[]>([]);
  const [filterValues, setFilterValues] = useState<Record<string, unknown>>({});
  // Solo inicializamos los valores por defecto una vez (primera corrida).
  const initializedRef = useRef(false);

  const run = useCallback(
    async (values?: Record<string, unknown>) => {
      if (!slug) return;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/custom-views/${encodeURIComponent(slug)}/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filterValues: values ?? {} }),
        });
        const data = await res.json();
        if (res.ok) {
          setResult(data as RunResult);
          const defs: FilterDef[] = (data.filters ?? []) as FilterDef[];
          setFilters(defs);
          if (!initializedRef.current) {
            const init: Record<string, unknown> = {};
            for (const f of defs) init[String(f.id_saved_view_filter)] = initValue(f);
            setFilterValues(init);
            initializedRef.current = true;
          }
        } else {
          setResult(null);
          setError(
            `${data.error ?? 'Error al ejecutar la vista.'}${data.detail ? ' — ' + data.detail : ''}`
          );
        }
      } catch {
        setError('Error de red al ejecutar la vista.');
      } finally {
        setLoading(false);
      }
    },
    [slug]
  );

  useEffect(() => {
    run();
  }, [run]);

  const applyFilters = useCallback(() => {
    run(filterValues);
  }, [run, filterValues]);

  const setValue = useCallback((key: string, value: unknown) => {
    setFilterValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  const exportExcel = useCallback(async () => {
    if (!result) return;
    const ExcelJS = (await import('exceljs')).default;
    const { saveAs } = await import('file-saver');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Datos');
    ws.addRow(result.columns);
    const header = ws.getRow(1);
    header.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF113562' } };
    });
    for (const r of result.rows) {
      ws.addRow(result.columns.map((c) => formatCell(r[c])));
    }
    ws.columns.forEach((col) => {
      col.width = 22;
    });
    const buffer = await wb.xlsx.writeBuffer();
    const stamp = new Date().toISOString().slice(0, 10);
    saveAs(
      new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
      `${result.view.slug}-${stamp}.xlsx`
    );
  }, [result]);

  const exportCsv = useCallback(async () => {
    if (!result) return;
    const { saveAs } = await import('file-saver');
    const BOM = String.fromCharCode(0xfeff);
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const lines = [
      result.columns.map(esc).join(','),
      ...result.rows.map((r) => result.columns.map((c) => esc(formatCell(r[c]))).join(',')),
    ];
    const stamp = new Date().toISOString().slice(0, 10);
    saveAs(
      new Blob([BOM + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }),
      `${result.view.slug}-${stamp}.csv`
    );
  }, [result]);

  /** Renderiza el control adecuado para un filtro según su tipo/operador. */
  function renderFilterControl(f: FilterDef) {
    const key = String(f.id_saved_view_filter);
    const value = filterValues[key];

    if (f.operator === 'between' || f.filter_type === 'daterange') {
      const pair = Array.isArray(value) ? (value as string[]) : ['', ''];
      const isDate = f.filter_type === 'daterange' || f.filter_type === 'date';
      return (
        <Group gap={6} wrap='nowrap' align='flex-end'>
          <TextInput
            label={f.label}
            required={f.required}
            type={isDate ? 'date' : f.filter_type === 'number' ? 'number' : 'text'}
            value={pair[0] ?? ''}
            onChange={(e) => setValue(key, [e.currentTarget.value, pair[1] ?? ''])}
            placeholder='Desde'
            style={{ minWidth: 150 }}
          />
          <TextInput
            label=' '
            type={isDate ? 'date' : f.filter_type === 'number' ? 'number' : 'text'}
            value={pair[1] ?? ''}
            onChange={(e) => setValue(key, [pair[0] ?? '', e.currentTarget.value])}
            placeholder='Hasta'
            style={{ minWidth: 150 }}
          />
        </Group>
      );
    }

    if (f.filter_type === 'select') {
      const data = parseOptions(f.options_json);
      if (f.operator === 'in') {
        return (
          <MultiSelect
            label={f.label}
            required={f.required}
            data={data}
            value={Array.isArray(value) ? (value as string[]) : []}
            onChange={(v) => setValue(key, v)}
            clearable
            searchable
            style={{ minWidth: 220 }}
          />
        );
      }
      return (
        <Select
          label={f.label}
          required={f.required}
          data={data}
          value={typeof value === 'string' ? value : null}
          onChange={(v) => setValue(key, v ?? '')}
          clearable
          searchable
          style={{ minWidth: 200 }}
        />
      );
    }

    if (f.filter_type === 'number') {
      return (
        <NumberInput
          label={f.label}
          required={f.required}
          value={value === '' || value === undefined ? '' : (value as number)}
          onChange={(v) => setValue(key, v)}
          style={{ minWidth: 160 }}
        />
      );
    }

    // text | date (u operadores escalares con estos tipos)
    return (
      <TextInput
        label={f.label}
        required={f.required}
        type={f.filter_type === 'date' ? 'date' : 'text'}
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => setValue(key, e.currentTarget.value)}
        placeholder={f.operator === 'like' ? 'Contiene…' : ''}
        style={{ minWidth: 180 }}
      />
    );
  }

  return (
    <div style={{ padding: 20, maxWidth: 1400, margin: '0 auto' }}>
      <Group justify='space-between' mb='md'>
        <div>
          <Title order={2}>{result?.view.name ?? 'Vista'}</Title>
          <Text c='dimmed' size='sm'>
            {slug}
          </Text>
        </div>
        <Group>
          <Button
            variant='light'
            leftSection={<IconRefresh size={16} />}
            onClick={() => run(filterValues)}
            loading={loading}
          >
            Actualizar
          </Button>
          <Button
            color='green'
            leftSection={<IconFileSpreadsheet size={16} />}
            onClick={exportExcel}
            disabled={!result || result.rows.length === 0}
          >
            Exportar a Excel
          </Button>
          <Button
            variant='light'
            leftSection={<IconFileTypeCsv size={16} />}
            onClick={exportCsv}
            disabled={!result || result.rows.length === 0}
          >
            CSV
          </Button>
        </Group>
      </Group>

      {/* Panel de filtros parametrizables */}
      {filters.length > 0 && (
        <Paper withBorder p='md' mb='md' radius='md'>
          <Group gap={6} mb='sm'>
            <IconFilter size={18} />
            <Text fw={600}>Filtros</Text>
          </Group>
          <Group align='flex-end' gap='md' wrap='wrap'>
            {filters.map((f) => (
              <div key={f.id_saved_view_filter}>{renderFilterControl(f)}</div>
            ))}
            <Button onClick={applyFilters} loading={loading} color='blue'>
              Aplicar
            </Button>
          </Group>
        </Paper>
      )}

      {error && (
        <Alert color='red' icon={<IconAlertTriangle size={18} />} mb='md'>
          {error}
        </Alert>
      )}

      {loading && !result ? (
        <Group>
          <Loader size='sm' /> <Text>Ejecutando vista…</Text>
        </Group>
      ) : result ? (
        <>
          <Group mb='xs'>
            <Badge color='blue'>{result.rowCount} fila(s)</Badge>
            {result.truncated && <Badge color='orange'>Resultado truncado al tope</Badge>}
          </Group>
          <div
            style={{
              border: '1px solid var(--mantine-color-gray-3)',
              borderRadius: 8,
              overflow: 'auto',
              maxHeight: '70vh',
            }}
          >
            <Table striped highlightOnHover withColumnBorders stickyHeader>
              <Table.Thead>
                <Table.Tr>
                  {result.columns.map((c) => (
                    <Table.Th key={c}>{c}</Table.Th>
                  ))}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {result.rows.map((r, i) => (
                  <Table.Tr key={i}>
                    {result.columns.map((c) => (
                      <Table.Td key={c}>{formatCell(r[c])}</Table.Td>
                    ))}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </div>
        </>
      ) : null}
    </div>
  );
}
