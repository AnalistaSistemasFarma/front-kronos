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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  MultiSelect,
  NumberInput,
  Pagination,
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

const PAGE_SIZE_OPTIONS = ['25', '50', '100', '200'];

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
  /** Total de filas del resultado completo (para la paginación). */
  total: number;
  page: number;
  pageSize: number;
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
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);
  // Solo inicializamos los valores por defecto una vez (primera corrida).
  const initializedRef = useRef(false);

  const run = useCallback(
    async (values: Record<string, unknown> | undefined, pageArg: number, sizeArg: number) => {
      if (!slug) return;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/custom-views/${encodeURIComponent(slug)}/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filterValues: values ?? {}, page: pageArg, pageSize: sizeArg }),
        });
        const data = await res.json();
        if (res.ok) {
          setResult(data as RunResult);
          setPage(data.page ?? pageArg);
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
    // Primera corrida al montar / al cambiar de vista con el tamaño de página por
    // defecto (50). El resto se dispara por acciones del usuario (filtros, cambio
    // de página, cambio de tamaño de página) — no por este efecto.
    run(undefined, 1, 50);
  }, [slug, run]);

  // Aplicar filtros SIEMPRE vuelve a la página 1.
  const applyFilters = useCallback(() => {
    setPage(1);
    run(filterValues, 1, pageSize);
  }, [run, filterValues, pageSize]);

  const goToPage = useCallback(
    (p: number) => {
      setPage(p);
      run(filterValues, p, pageSize);
    },
    [run, filterValues, pageSize]
  );

  const changePageSize = useCallback(
    (size: number) => {
      setPageSize(size);
      setPage(1);
      run(filterValues, 1, size);
    },
    [run, filterValues]
  );

  const setValue = useCallback((key: string, value: unknown) => {
    setFilterValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  const totalPages = useMemo(
    () => (result && result.total > 0 ? Math.ceil(result.total / pageSize) : 0),
    [result, pageSize]
  );

  /**
   * Trae TODAS las filas del resultado (no solo la página visible) desde el
   * servidor, aplicando los mismos filtros. El backend acota a un tope de
   * seguridad; si se alcanza, `truncated=true`.
   */
  const fetchAllRows = useCallback(async (): Promise<{
    columns: string[];
    rows: Record<string, unknown>[];
    truncated: boolean;
    exportCap?: number;
  } | null> => {
    if (!slug) return null;
    const res = await fetch(`/api/custom-views/${encodeURIComponent(slug)}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filterValues, export: true }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(`${data.error ?? 'Error al exportar.'}${data.detail ? ' — ' + data.detail : ''}`);
    }
    return {
      columns: (data.columns ?? []) as string[],
      rows: (data.rows ?? []) as Record<string, unknown>[],
      truncated: !!data.truncated,
      exportCap: data.exportCap as number | undefined,
    };
  }, [slug, filterValues]);

  const exportExcel = useCallback(async () => {
    if (!result) return;
    setExporting(true);
    setExportNote(null);
    setError(null);
    try {
      const all = await fetchAllRows();
      if (!all) return;
      const ExcelJS = (await import('exceljs')).default;
      const { saveAs } = await import('file-saver');
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Datos');
      ws.addRow(all.columns);
      const header = ws.getRow(1);
      header.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF113562' } };
      });
      for (const r of all.rows) {
        ws.addRow(all.columns.map((c) => formatCell(r[c])));
      }
      ws.columns.forEach((col) => {
        col.width = 22;
      });
      if (all.truncated) {
        const note = wb.addWorksheet('Aviso');
        note.addRow([
          `Export truncado al tope de seguridad de ${all.exportCap ?? ''} filas. El resultado completo es mayor; refine los filtros para exportar el resto.`,
        ]);
      }
      const buffer = await wb.xlsx.writeBuffer();
      const stamp = new Date().toISOString().slice(0, 10);
      saveAs(
        new Blob([buffer], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
        `${result.view.slug}-${stamp}.xlsx`
      );
      setExportNote(
        all.truncated
          ? `Exportadas ${all.rows.length} filas (TRUNCADO al tope de ${all.exportCap}). Refine los filtros para el resto.`
          : `Exportadas ${all.rows.length} filas.`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al exportar a Excel.');
    } finally {
      setExporting(false);
    }
  }, [result, fetchAllRows]);

  const exportCsv = useCallback(async () => {
    if (!result) return;
    setExporting(true);
    setExportNote(null);
    setError(null);
    try {
      const all = await fetchAllRows();
      if (!all) return;
      const { saveAs } = await import('file-saver');
      const BOM = String.fromCharCode(0xfeff);
      const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
      const lines = [
        all.columns.map(esc).join(','),
        ...all.rows.map((r) => all.columns.map((c) => esc(formatCell(r[c]))).join(',')),
      ];
      const stamp = new Date().toISOString().slice(0, 10);
      saveAs(
        new Blob([BOM + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }),
        `${result.view.slug}-${stamp}.csv`
      );
      setExportNote(
        all.truncated
          ? `Exportadas ${all.rows.length} filas (TRUNCADO al tope de ${all.exportCap}). Refine los filtros para el resto.`
          : `Exportadas ${all.rows.length} filas.`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al exportar a CSV.');
    } finally {
      setExporting(false);
    }
  }, [result, fetchAllRows]);

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
            onClick={() => run(filterValues, page, pageSize)}
            loading={loading}
          >
            Actualizar
          </Button>
          <Button
            color='green'
            leftSection={<IconFileSpreadsheet size={16} />}
            onClick={exportExcel}
            loading={exporting}
            disabled={!result || (result.total ?? 0) === 0}
          >
            Exportar a Excel
          </Button>
          <Button
            variant='light'
            leftSection={<IconFileTypeCsv size={16} />}
            onClick={exportCsv}
            loading={exporting}
            disabled={!result || (result.total ?? 0) === 0}
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

      {exportNote && (
        <Alert color='green' mb='md' withCloseButton onClose={() => setExportNote(null)}>
          {exportNote}
        </Alert>
      )}

      {loading && !result ? (
        <Group>
          <Loader size='sm' /> <Text>Ejecutando vista…</Text>
        </Group>
      ) : result ? (
        <>
          <Group mb='xs' justify='space-between'>
            <Group gap='xs'>
              <Badge color='blue'>{result.total} resultado(s)</Badge>
              {totalPages > 1 && (
                <Text size='sm' c='dimmed'>
                  Página {page} de {totalPages}
                </Text>
              )}
              {loading && <Loader size='xs' />}
            </Group>
            <Group gap='xs'>
              <Text size='sm' c='dimmed'>
                Filas por página
              </Text>
              <Select
                size='xs'
                w={90}
                data={PAGE_SIZE_OPTIONS}
                value={String(pageSize)}
                onChange={(v) => changePageSize(Number(v) || 50)}
                allowDeselect={false}
              />
            </Group>
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
          {totalPages > 1 && (
            <Group justify='center' mt='md'>
              <Pagination
                total={totalPages}
                value={page}
                onChange={goToPage}
                disabled={loading}
                withEdges
                siblings={1}
              />
            </Group>
          )}
        </>
      ) : null}
    </div>
  );
}
