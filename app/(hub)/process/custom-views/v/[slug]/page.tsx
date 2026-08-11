'use client';

/**
 * Galería / consulta de una vista publicada (Incremento 2, §5.4 / §3).
 *
 * Ejecuta la vista por su slug (POST /api/custom-views/[slug]/run), muestra la
 * tabla de resultados y permite exportar a Excel o CSV (reusa exceljs/file-saver,
 * ya usados por los informes del front). El alcance de empresa lo inyecta el backend.
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Table,
  Text,
  Title,
} from '@mantine/core';
import {
  IconAlertTriangle,
  IconFileSpreadsheet,
  IconFileTypeCsv,
  IconRefresh,
} from '@tabler/icons-react';

interface RunResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
  view: { id: number; slug: string; name: string };
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export default function CustomViewGalleryPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug;

  const [result, setResult] = useState<RunResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/custom-views/${encodeURIComponent(slug)}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (res.ok) {
        setResult(data as RunResult);
      } else {
        setResult(null);
        setError(`${data.error ?? 'Error al ejecutar la vista.'}${data.detail ? ' — ' + data.detail : ''}`);
      }
    } catch {
      setError('Error de red al ejecutar la vista.');
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    run();
  }, [run]);

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
            onClick={run}
            loading={loading}
          >
            Actualizar
          </Button>
          <Button
            variant='light'
            color='green'
            leftSection={<IconFileSpreadsheet size={16} />}
            onClick={exportExcel}
            disabled={!result || result.rows.length === 0}
          >
            Exportar Excel
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
