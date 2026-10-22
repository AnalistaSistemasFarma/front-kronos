'use client';

import { useState } from 'react';
import { Alert, Badge, Button, Card, Checkbox, Group, NumberInput, SegmentedControl, SimpleGrid, Stack, Switch, Text, TextInput, UnstyledButton } from '@mantine/core';
import { IconAlertTriangle, IconArrowMerge, IconArrowsSplit, IconColumnInsertRight, IconRowInsertBottom, IconTrash } from '@tabler/icons-react';
import SgcSelect from './SgcSelect';
import {
  SGC_DEFAULT_HEADER_GRID,
  SGC_HEADER_FIELDS,
  SGC_HEADER_FIELD_LABELS,
  SGC_HEADER_GRID_MAX_COLS,
  SGC_HEADER_GRID_MAX_HEIGHT,
  SGC_HEADER_GRID_MAX_ROWS,
  SGC_HEADER_ROW_MAX,
  SGC_HEADER_ROW_MIN,
  addLine,
  canMerge,
  headerGridProblem,
  mergeCell,
  removeLastLine,
  splitCell,
  type SgcHeaderField,
  type SgcHeaderGrid,
} from '../../lib/sgc/headerGrid';
import type { SgcHeaderTemplateConfig } from '../../lib/sgc/headerTemplates';

/**
 * EDITOR VISUAL DE LA GRILLA DEL ENCABEZADO (fase 1, 2026-10-19). Calidad
 * arma la tabla de la primera página: filas y columnas, celdas combinadas y
 * qué campo va en cada celda (con su rótulo, un texto fijo o el logo). El
 * dibujo es un esquema para ubicar las celdas; «Ver cómo queda» muestra el PDF
 * REAL que genera el sistema con esta grilla (la misma función que compone el
 * documento controlado), así que la vista previa es idéntica al encabezado.
 * Mismos componentes de Mantine que el resto de Configuración del SGC.
 */

const PX_PER_PT = 1.15;

/** Rótulo por defecto de un campo según la plantilla (lo que sale si la celda no trae rótulo propio). */
function defaultLabel(field: SgcHeaderField, cfg: SgcHeaderTemplateConfig): string {
  const map: Partial<Record<SgcHeaderField, string>> = {
    nombre: cfg.titleLabel,
    codigo: cfg.codeLabel,
    version: cfg.versionLabel,
    pagina: 'PÁGINA',
    elaboro: cfg.elaboroLabel,
    reviso: cfg.revisoLabel,
    aprobo: cfg.aproboLabel,
    fecha_emision: cfg.emissionLabel,
    proceso: 'PROCESO',
    tipo_documental: 'TIPO DOCUMENTAL',
    firma_elaboro: 'Firma',
    firma_reviso: 'Firma',
    firma_aprobo: 'Firma',
  };
  return map[field] ?? '';
}

export default function SgcHeaderGridEditor({ config, onChange }: { config: SgcHeaderTemplateConfig; onChange: (grid: SgcHeaderGrid | null) => void }) {
  const grid = config.grid;
  const [selected, setSelected] = useState<number>(0);
  if (!grid) {
    return (
      <Card withBorder radius='md' p='sm' data-testid='sgc-grilla-apagada'>
        <Group justify='space-between' wrap='wrap' gap='xs'>
          <div style={{ flex: '1 1 280px' }}>
            <Text size='sm' fw={600}>
              Grilla del encabezado
            </Text>
            <Text size='xs' c='dimmed'>
              Hoy usa la tabla institucional (logo, nombre, código, versión, página, Elaboró / Revisó / Aprobó con su firma, fecha de emisión y fila inferior). Active la grilla propia para cambiar filas, columnas, celdas combinadas y el campo de cada celda.
            </Text>
          </div>
          <Switch label='Grilla propia' checked={false} onChange={() => onChange(SGC_DEFAULT_HEADER_GRID)} data-testid='sgc-grilla-activar' />
        </Group>
      </Card>
    );
  }

  const sel = grid.cells[Math.min(selected, grid.cells.length - 1)] ?? null;
  const selIndex = sel ? grid.cells.indexOf(sel) : -1;
  const problem = headerGridProblem(grid);
  const total = grid.rows.reduce((a, b) => a + b, 0);
  const update = (g: SgcHeaderGrid) => onChange(g);
  const setCell = (patch: Partial<(typeof grid.cells)[number]>) => {
    if (selIndex < 0) return;
    update({ ...grid, cells: grid.cells.map((c, i) => (i === selIndex ? { ...c, ...patch } : c)) });
  };

  return (
    <Card withBorder radius='md' p='sm' data-testid='sgc-grilla-editor'>
      <Stack gap='sm'>
        <Group justify='space-between' wrap='wrap' gap='xs'>
          <Text size='sm' fw={600}>
            Grilla del encabezado (primera página)
          </Text>
          <Switch label='Grilla propia' checked onChange={() => onChange(null)} data-testid='sgc-grilla-desactivar' />
        </Group>
        {problem && (
          <Alert color='orange' icon={<IconAlertTriangle size={16} />} data-testid='sgc-grilla-problema'>
            {problem}
          </Alert>
        )}
        <Group gap='xs' wrap='wrap'>
          <Button size='xs' variant='default' leftSection={<IconRowInsertBottom size={14} />} disabled={grid.rows.length >= SGC_HEADER_GRID_MAX_ROWS} onClick={() => update(addLine(grid, 'fila'))} data-testid='sgc-grilla-mas-fila'>
            Fila
          </Button>
          <Button size='xs' variant='default' leftSection={<IconTrash size={14} />} disabled={grid.rows.length <= 1} onClick={() => update(removeLastLine(grid, 'fila'))}>
            Última fila
          </Button>
          <Button size='xs' variant='default' leftSection={<IconColumnInsertRight size={14} />} disabled={grid.columns.length >= SGC_HEADER_GRID_MAX_COLS} onClick={() => update(addLine(grid, 'columna'))} data-testid='sgc-grilla-mas-columna'>
            Columna
          </Button>
          <Button size='xs' variant='default' leftSection={<IconTrash size={14} />} disabled={grid.columns.length <= 1} onClick={() => update(removeLastLine(grid, 'columna'))}>
            Última columna
          </Button>
          <Button size='xs' variant='subtle' onClick={() => { setSelected(0); update(SGC_DEFAULT_HEADER_GRID); }}>
            Partir del institucional
          </Button>
        </Group>

        {/* Esquema de la grilla: clic en una celda para editarla. */}
        <div
          role='grid'
          aria-label='Esquema de la grilla del encabezado'
          data-testid='sgc-grilla-esquema'
          style={{
            display: 'grid',
            gridTemplateColumns: grid.columns.map((c) => `${c}fr`).join(' '),
            gridTemplateRows: grid.rows.map((h) => `${Math.round(h * PX_PER_PT)}px`).join(' '),
            border: '1px solid var(--mantine-color-default-border)',
            borderRadius: 4,
            overflow: 'hidden',
            background: 'var(--mantine-color-body)',
          }}
        >
          {grid.cells.map((c, i) => {
            const active = i === selIndex;
            const label = c.label ?? defaultLabel(c.field, config);
            return (
              <UnstyledButton
                key={`${c.row}-${c.col}`}
                role='gridcell'
                aria-selected={active}
                onClick={() => setSelected(i)}
                data-testid='sgc-grilla-celda'
                data-field={c.field}
                style={{
                  gridColumn: `${c.col + 1} / span ${c.colSpan}`,
                  gridRow: `${c.row + 1} / span ${c.rowSpan}`,
                  border: '1px solid var(--mantine-color-default-border)',
                  outline: active ? '2px solid var(--mantine-color-blue-6)' : undefined,
                  outlineOffset: -2,
                  background: active ? 'var(--mantine-color-blue-light)' : c.field === 'vacio' ? 'var(--mantine-color-default-hover)' : undefined,
                  padding: '2px 4px',
                  overflow: 'hidden',
                  textAlign: c.align === 'center' ? 'center' : 'left',
                  minWidth: 0,
                }}
              >
                <Text component='span' display='block' size='9px' c='dimmed' lh={1.1} truncate>
                  {label || ' '}
                </Text>
                <Text component='span' display='block' size='10px' fw={600} lh={1.15} lineClamp={2}>
                  {c.field === 'texto' ? c.text || 'Texto fijo' : SGC_HEADER_FIELD_LABELS[c.field]}
                </Text>
              </UnstyledButton>
            );
          })}
        </div>
        <Text size='xs' c={total > SGC_HEADER_GRID_MAX_HEIGHT ? 'red' : 'dimmed'} data-testid='sgc-grilla-alto'>
          Alto total: {total} de {SGC_HEADER_GRID_MAX_HEIGHT} puntos · {grid.rows.length} fila(s) × {grid.columns.length} columna(s) · {grid.cells.length} celda(s)
        </Text>

        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing='sm'>
          <Stack gap={4}>
            <Text size='xs' fw={600}>
              Ancho de las columnas (relativo)
            </Text>
            <Group gap={6} wrap='wrap'>
              {grid.columns.map((w, k) => (
                <NumberInput key={k} aria-label={`Ancho de la columna ${k + 1}`} size='xs' w={70} min={1} max={100} value={w} onChange={(v) => update({ ...grid, columns: grid.columns.map((x, j) => (j === k ? Number(v) || 1 : x)) })} />
              ))}
            </Group>
          </Stack>
          <Stack gap={4}>
            <Text size='xs' fw={600}>
              Alto de las filas (puntos)
            </Text>
            <Group gap={6} wrap='wrap'>
              {grid.rows.map((h, r) => (
                <NumberInput key={r} aria-label={`Alto de la fila ${r + 1}`} size='xs' w={70} min={SGC_HEADER_ROW_MIN} max={SGC_HEADER_ROW_MAX} value={h} onChange={(v) => update({ ...grid, rows: grid.rows.map((x, j) => (j === r ? Number(v) || SGC_HEADER_ROW_MIN : x)) })} />
              ))}
            </Group>
          </Stack>
        </SimpleGrid>

        {sel && (
          <Card withBorder radius='sm' p='sm' data-testid='sgc-grilla-celda-editor'>
            <Group justify='space-between' wrap='wrap' gap='xs' mb='xs'>
              <Text component='div' size='sm' fw={600}>
                Celda: fila {sel.row + 1}, columna {sel.col + 1}
                {(sel.rowSpan > 1 || sel.colSpan > 1) && (
                  <Badge ml={6} size='xs' variant='light'>
                    combinada {sel.rowSpan}×{sel.colSpan}
                  </Badge>
                )}
              </Text>
              <Group gap={4} wrap='wrap'>
                <Button size='xs' variant='light' leftSection={<IconArrowMerge size={14} />} disabled={!canMerge(grid, selIndex, 'derecha')} onClick={() => update(mergeCell(grid, selIndex, 'derecha'))} data-testid='sgc-grilla-combinar-derecha'>
                  Combinar a la derecha
                </Button>
                <Button size='xs' variant='light' leftSection={<IconArrowMerge size={14} style={{ transform: 'rotate(90deg)' }} />} disabled={!canMerge(grid, selIndex, 'abajo')} onClick={() => update(mergeCell(grid, selIndex, 'abajo'))} data-testid='sgc-grilla-combinar-abajo'>
                  Combinar hacia abajo
                </Button>
                <Button size='xs' variant='light' color='gray' leftSection={<IconArrowsSplit size={14} />} disabled={sel.rowSpan === 1 && sel.colSpan === 1} onClick={() => update(splitCell(grid, selIndex))} data-testid='sgc-grilla-separar'>
                  Separar
                </Button>
              </Group>
            </Group>
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing='sm'>
              <SgcSelect label='Campo' data={SGC_HEADER_FIELDS.map((f) => ({ value: f, label: SGC_HEADER_FIELD_LABELS[f] }))} value={sel.field} onChange={(v) => v && setCell({ field: v as SgcHeaderField, ...(v === 'texto' ? { text: sel.text ?? '' } : {}) })} allowDeselect={false} data-testid='sgc-grilla-campo' />
              <SegmentedControl
                aria-label='Alineación'
                data={[
                  { value: 'left', label: 'A la izquierda' },
                  { value: 'center', label: 'Centrado' },
                ]}
                value={sel.align === 'center' ? 'center' : 'left'}
                onChange={(v) => setCell({ align: v === 'center' ? 'center' : 'left' })}
                mt={{ base: 0, sm: 24 }}
              />
              {sel.field === 'texto' ? (
                <TextInput label='Texto fijo' value={sel.text ?? ''} onChange={(e) => setCell({ text: e.currentTarget.value })} autoComplete='off' maxLength={160} data-testid='sgc-grilla-texto' />
              ) : (
                <TextInput
                  label='Rótulo propio'
                  description={`Vacío: el de la plantilla${defaultLabel(sel.field, config) ? ` («${defaultLabel(sel.field, config)}»)` : ''}.`}
                  value={sel.label ?? ''}
                  disabled={sel.label === ''}
                  onChange={(e) => setCell({ label: e.currentTarget.value ? e.currentTarget.value : null })}
                  autoComplete='off'
                  maxLength={40}
                  data-testid='sgc-grilla-rotulo'
                />
              )}
              {sel.field !== 'texto' && sel.field !== 'vacio' && sel.field !== 'logo' && (
                <Checkbox label='Sin rótulo' checked={sel.label === ''} onChange={(e) => setCell({ label: e.currentTarget.checked ? '' : null })} mt={{ base: 0, sm: 30 }} />
              )}
            </SimpleGrid>
          </Card>
        )}
        <Text size='xs' c='dimmed'>
          Obligatorios: nombre, código, versión, página, fecha de emisión y las tres firmas (Elaboró, Revisó, Aprobó), cada uno una sola vez. Las demás páginas conservan el encabezado corto. Use «Ver cómo queda» para ver el PDF real.
        </Text>
      </Stack>
    </Card>
  );
}
