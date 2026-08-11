'use client';

/**
 * Constructor de Vistas SQL (Incremento 2).
 *
 * Layout de 2 columnas:
 *  - IZQUIERDA: explorador del catálogo (Proceso -> Tabla/Vista -> Campos). Clic
 *    en una tabla genera un SELECT base; clic en un campo lo inserta en el editor.
 *  - CENTRO/DERECHA: editor Monaco (SQL) + Ejecutar (preview) + tabla de resultados
 *    + formulario Guardar/Publicar + lista de vistas guardadas con reordenar.
 *
 * Ver propuesta técnica §5. Feedback de estado SIEMPRE arriba, con color.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useSession } from 'next-auth/react';
import {
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  NumberInput,
  Select,
  Table,
  Text,
  TextInput,
  Textarea,
  Title,
  Tooltip,
} from '@mantine/core';
import {
  IconAlertTriangle,
  IconArrowDown,
  IconArrowUp,
  IconChevronDown,
  IconChevronRight,
  IconCircleCheck,
  IconDatabase,
  IconExternalLink,
  IconPlayerPlay,
  IconTable,
  IconTrash,
} from '@tabler/icons-react';

/** Interfaz mínima del editor Monaco (evita depender de los tipos de monaco-editor). */
interface MonacoLikeEditor {
  getSelection: () => unknown;
  executeEdits: (source: string, edits: unknown[]) => void;
  focus: () => void;
  setValue: (value: string) => void;
}

const MonacoEditor = dynamic(() => import('@monaco-editor/react'), {
  ssr: false,
  loading: () => (
    <div style={{ padding: 16 }}>
      <Loader size='sm' /> <Text component='span'>Cargando editor…</Text>
    </div>
  ),
});

// -------------------------------------------------------------------- tipos

interface CatalogField {
  column_name: string;
  label: string;
  data_type: string | null;
  is_pii: boolean;
}
interface CatalogSource {
  id_catalog_source: number;
  object_name: string;
  object_type: string;
  label: string;
  description: string | null;
  company_column: string | null;
  process: string | null;
  fields: CatalogField[];
}
interface SavedViewRow {
  id_saved_view: number;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  scope_mode: string;
  company_column: string | null;
  visibility: string;
  sort_order: number;
  row_limit: number;
}
interface PreviewResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
}
type Feedback = { type: 'success' | 'error'; text: string } | null;

const ICON_OPTIONS = [
  { value: 'table', label: 'Tabla' },
  { value: 'database', label: 'Base de datos' },
  { value: 'chart-bar', label: 'Gráfico' },
  { value: 'report', label: 'Reporte' },
  { value: 'list', label: 'Lista' },
  { value: 'file-analytics', label: 'Analítica' },
  { value: 'clipboard-list', label: 'Checklist' },
];

// -------------------------------------------------------------------- página

export default function CustomViewsBuilderPage() {
  const { data: session } = useSession();

  const [catalog, setCatalog] = useState<CatalogSource[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  const [sql, setSql] = useState<string>('SELECT TOP 100 *\nFROM vw_requests_general');
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [running, setRunning] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  // formulario guardar/publicar
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState<string | null>('table');
  const [sortOrder, setSortOrder] = useState<number | string>(0);
  const [scopeMode, setScopeMode] = useState<string>('all');
  const [companyColumn, setCompanyColumn] = useState('');
  const [rowLimit, setRowLimit] = useState<number | string>(1000);
  const [visibility, setVisibility] = useState<string>('draft');
  const [saving, setSaving] = useState(false);

  const [views, setViews] = useState<SavedViewRow[]>([]);

  const editorRef = useRef<MonacoLikeEditor | null>(null);

  // ----------------------------------------------------------------- carga

  const loadCatalog = useCallback(async () => {
    setCatalogLoading(true);
    try {
      const res = await fetch('/api/custom-views/catalog', { cache: 'no-store' });
      const data = await res.json();
      if (res.ok) setCatalog(data.catalog ?? []);
      else setFeedback({ type: 'error', text: data.error ?? 'Error al cargar el catálogo.' });
    } catch {
      setFeedback({ type: 'error', text: 'No se pudo cargar el catálogo.' });
    } finally {
      setCatalogLoading(false);
    }
  }, []);

  const loadViews = useCallback(async () => {
    try {
      const res = await fetch('/api/custom-views', { cache: 'no-store' });
      const data = await res.json();
      if (res.ok) setViews(data.views ?? []);
    } catch {
      /* silencioso */
    }
  }, []);

  useEffect(() => {
    loadCatalog();
    loadViews();
  }, [loadCatalog, loadViews]);

  // ----------------------------------------------------------------- editor

  const insertIntoEditor = useCallback((text: string) => {
    const ed = editorRef.current;
    if (!ed) {
      setSql((prev) => `${prev}${prev.endsWith(' ') || prev === '' ? '' : ' '}${text}`);
      return;
    }
    const selection = ed.getSelection();
    if (selection) {
      ed.executeEdits('catalog-insert', [
        { range: selection, text, forceMoveMarkers: true },
      ]);
      ed.focus();
    }
  }, []);

  const generateSelect = useCallback((source: CatalogSource) => {
    const cols = source.fields.length
      ? source.fields.map((f) => `  ${f.column_name}`).join(',\n')
      : '  *';
    const stmt = `SELECT TOP 100\n${cols}\nFROM ${source.object_name}`;
    setSql(stmt);
    const ed = editorRef.current;
    if (ed) ed.setValue(stmt);
    if (source.company_column) setCompanyColumn(source.company_column);
  }, []);

  // ----------------------------------------------------------------- acciones

  const runPreview = useCallback(async () => {
    setRunning(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/custom-views/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql }),
      });
      const data = await res.json();
      if (res.ok) {
        setPreview({
          columns: data.columns ?? [],
          rows: data.rows ?? [],
          rowCount: data.rowCount ?? 0,
          truncated: !!data.truncated,
        });
        setFeedback({
          type: 'success',
          text: `Consulta ejecutada: ${data.rowCount ?? 0} fila(s)${
            data.truncated ? ' (resultado truncado al tope)' : ''
          }.`,
        });
      } else {
        setPreview(null);
        setFeedback({
          type: 'error',
          text: `${data.error ?? 'Error al ejecutar.'}${data.detail ? ' — ' + data.detail : ''}`,
        });
      }
    } catch {
      setFeedback({ type: 'error', text: 'Error de red al ejecutar la consulta.' });
    } finally {
      setRunning(false);
    }
  }, [sql]);

  const saveView = useCallback(async () => {
    if (!name.trim()) {
      setFeedback({ type: 'error', text: 'Indique un nombre para la vista.' });
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/custom-views', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          sql_text: sql,
          icon,
          sort_order: Number(sortOrder) || 0,
          scope_mode: scopeMode,
          company_column: scopeMode === 'company' ? companyColumn.trim() : null,
          row_limit: Number(rowLimit) || 1000,
          visibility,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setFeedback({
          type: 'success',
          text:
            visibility === 'published'
              ? `Vista "${data.view.name}" publicada (slug: ${data.view.slug}). Módulo creado para asignar en Usuarios.`
              : `Borrador "${data.view.name}" guardado.`,
        });
        setName('');
        setDescription('');
        await loadViews();
      } else {
        setFeedback({
          type: 'error',
          text: `${data.error ?? 'Error al guardar.'}${data.detail ? ' — ' + data.detail : ''}`,
        });
      }
    } catch {
      setFeedback({ type: 'error', text: 'Error de red al guardar la vista.' });
    } finally {
      setSaving(false);
    }
  }, [name, description, sql, icon, sortOrder, scopeMode, companyColumn, rowLimit, visibility, loadViews]);

  const move = useCallback(
    async (index: number, dir: -1 | 1) => {
      const next = [...views];
      const target = index + dir;
      if (target < 0 || target >= next.length) return;
      [next[index], next[target]] = [next[target], next[index]];
      const reordered = next.map((v, i) => ({ ...v, sort_order: i }));
      setViews(reordered);
      try {
        await fetch('/api/custom-views/reorder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(reordered.map((v) => ({ id: v.id_saved_view, sort_order: v.sort_order }))),
        });
      } catch {
        setFeedback({ type: 'error', text: 'No se pudo guardar el nuevo orden.' });
      }
    },
    [views]
  );

  const archiveView = useCallback(
    async (id: number) => {
      try {
        const res = await fetch(`/api/custom-views/${id}`, { method: 'DELETE' });
        if (res.ok) {
          setFeedback({ type: 'success', text: 'Vista archivada.' });
          await loadViews();
        } else {
          const data = await res.json();
          setFeedback({ type: 'error', text: data.error ?? 'No se pudo archivar.' });
        }
      } catch {
        setFeedback({ type: 'error', text: 'Error de red al archivar.' });
      }
    },
    [loadViews]
  );

  const rows = useMemo(() => preview?.rows.slice(0, 200) ?? [], [preview]);

  if (session === null) {
    return (
      <div style={{ padding: 24 }}>
        <Alert color='red' icon={<IconAlertTriangle size={16} />}>
          Debe iniciar sesión.
        </Alert>
      </div>
    );
  }

  return (
    <div style={{ padding: 20, maxWidth: 1600, margin: '0 auto' }}>
      <Title order={2} mb={4}>
        Constructor de Vistas
      </Title>
      <Text c='dimmed' size='sm' mb='md'>
        Escriba SQL de solo lectura sobre las fuentes del catálogo, previsualice y publique como vista.
      </Text>

      {feedback && (
        <Alert
          mb='md'
          color={feedback.type === 'success' ? 'green' : 'red'}
          icon={
            feedback.type === 'success' ? (
              <IconCircleCheck size={18} />
            ) : (
              <IconAlertTriangle size={18} />
            )
          }
          withCloseButton
          onClose={() => setFeedback(null)}
        >
          {feedback.text}
        </Alert>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 16, alignItems: 'start' }}>
        {/* IZQUIERDA: explorador del catálogo */}
        <div
          style={{
            border: '1px solid var(--mantine-color-gray-3)',
            borderRadius: 8,
            padding: 12,
            maxHeight: 640,
            overflow: 'auto',
          }}
        >
          <Group gap={6} mb='xs'>
            <IconDatabase size={18} />
            <Text fw={600}>Catálogo</Text>
          </Group>
          {catalogLoading ? (
            <Loader size='sm' />
          ) : catalog.length === 0 ? (
            <Text size='sm' c='dimmed'>
              Sin fuentes en el catálogo.
            </Text>
          ) : (
            catalog.map((s) => {
              const open = !!expanded[s.id_catalog_source];
              return (
                <div key={s.id_catalog_source} style={{ marginBottom: 6 }}>
                  <Group gap={4} wrap='nowrap'>
                    <Button
                      variant='subtle'
                      size='compact-sm'
                      leftSection={open ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                      onClick={() =>
                        setExpanded((e) => ({ ...e, [s.id_catalog_source]: !open }))
                      }
                      styles={{ label: { fontWeight: 600 } }}
                    >
                      <IconTable size={14} style={{ marginRight: 4 }} />
                      {s.label}
                    </Button>
                    <Tooltip label={`Generar SELECT de ${s.object_name}`}>
                      <Button variant='light' size='compact-xs' onClick={() => generateSelect(s)}>
                        SELECT
                      </Button>
                    </Tooltip>
                  </Group>
                  {s.process && (
                    <Text size='xs' c='dimmed' pl={28}>
                      {s.process} · {s.object_type}
                    </Text>
                  )}
                  {open && (
                    <div style={{ paddingLeft: 24 }}>
                      {s.fields.map((f) => (
                        <Group key={f.column_name} gap={4} wrap='nowrap' style={{ padding: '1px 0' }}>
                          <Button
                            variant='subtle'
                            size='compact-xs'
                            color='gray'
                            onClick={() => insertIntoEditor(f.column_name)}
                            title={`Insertar ${f.column_name}`}
                          >
                            {f.label}
                          </Button>
                          <Text size='xs' c='dimmed'>
                            {f.data_type ?? ''}
                          </Text>
                          {f.is_pii && (
                            <Badge size='xs' color='orange'>
                              PII
                            </Badge>
                          )}
                        </Group>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* CENTRO/DERECHA */}
        <div>
          <div style={{ border: '1px solid var(--mantine-color-gray-3)', borderRadius: 8, overflow: 'hidden' }}>
            <MonacoEditor
              height='260px'
              defaultLanguage='sql'
              value={sql}
              onChange={(v) => setSql(v ?? '')}
              onMount={(ed) => {
                editorRef.current = ed as unknown as MonacoLikeEditor;
              }}
              options={{ minimap: { enabled: false }, fontSize: 13, wordWrap: 'on' }}
            />
          </div>

          <Group mt='sm' mb='md'>
            <Button
              leftSection={<IconPlayerPlay size={16} />}
              onClick={runPreview}
              loading={running}
              color='blue'
            >
              Ejecutar
            </Button>
            <Text size='sm' c='dimmed'>
              Solo lectura · TOP 1000 · con timeout
            </Text>
          </Group>

          {/* Resultados */}
          {preview && (
            <div
              style={{
                border: '1px solid var(--mantine-color-gray-3)',
                borderRadius: 8,
                maxHeight: 320,
                overflow: 'auto',
                marginBottom: 16,
              }}
            >
              <Table striped highlightOnHover withColumnBorders stickyHeader>
                <Table.Thead>
                  <Table.Tr>
                    {preview.columns.map((c) => (
                      <Table.Th key={c}>{c}</Table.Th>
                    ))}
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {rows.map((r, i) => (
                    <Table.Tr key={i}>
                      {preview.columns.map((c) => (
                        <Table.Td key={c}>{formatCell(r[c])}</Table.Td>
                      ))}
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </div>
          )}

          {/* Guardar / publicar */}
          <div style={{ border: '1px solid var(--mantine-color-gray-3)', borderRadius: 8, padding: 16 }}>
            <Text fw={600} mb='sm'>
              Guardar / Publicar
            </Text>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <TextInput
                label='Nombre'
                required
                value={name}
                onChange={(e) => setName(e.currentTarget.value)}
                placeholder='Ej. Solicitudes vencidas'
              />
              <Select label='Ícono' data={ICON_OPTIONS} value={icon} onChange={setIcon} searchable />
              <Textarea
                label='Descripción'
                value={description}
                onChange={(e) => setDescription(e.currentTarget.value)}
                autosize
                minRows={1}
                style={{ gridColumn: '1 / span 2' }}
              />
              <Select
                label='Alcance'
                data={[
                  { value: 'all', label: 'Todas las empresas / transversal' },
                  { value: 'company', label: 'Por empresa del consumidor' },
                ]}
                value={scopeMode}
                onChange={(v) => setScopeMode(v ?? 'all')}
              />
              <TextInput
                label='Columna de empresa'
                description='Requerida si el alcance es por empresa'
                value={companyColumn}
                onChange={(e) => setCompanyColumn(e.currentTarget.value)}
                disabled={scopeMode !== 'company'}
                placeholder='id_company'
              />
              <NumberInput label='Orden' value={sortOrder} onChange={setSortOrder} min={0} />
              <NumberInput
                label='Tope de filas'
                value={rowLimit}
                onChange={setRowLimit}
                min={1}
                max={5000}
              />
              <Select
                label='Estado'
                data={[
                  { value: 'draft', label: 'Borrador' },
                  { value: 'published', label: 'Publicada' },
                ]}
                value={visibility}
                onChange={(v) => setVisibility(v ?? 'draft')}
              />
            </div>
            <Group mt='md'>
              <Button onClick={saveView} loading={saving} color='teal'>
                {visibility === 'published' ? 'Publicar vista' : 'Guardar borrador'}
              </Button>
            </Group>
          </div>

          {/* Lista de vistas guardadas */}
          <div style={{ marginTop: 16 }}>
            <Text fw={600} mb='sm'>
              Vistas guardadas
            </Text>
            {views.length === 0 ? (
              <Text size='sm' c='dimmed'>
                Aún no hay vistas.
              </Text>
            ) : (
              <Table withTableBorder>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Orden</Table.Th>
                    <Table.Th>Nombre</Table.Th>
                    <Table.Th>Estado</Table.Th>
                    <Table.Th>Alcance</Table.Th>
                    <Table.Th>Acciones</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {views.map((v, i) => (
                    <Table.Tr key={v.id_saved_view}>
                      <Table.Td>
                        <Group gap={2}>
                          <Button variant='subtle' size='compact-xs' onClick={() => move(i, -1)} disabled={i === 0}>
                            <IconArrowUp size={14} />
                          </Button>
                          <Button
                            variant='subtle'
                            size='compact-xs'
                            onClick={() => move(i, 1)}
                            disabled={i === views.length - 1}
                          >
                            <IconArrowDown size={14} />
                          </Button>
                        </Group>
                      </Table.Td>
                      <Table.Td>
                        <Text fw={500}>{v.name}</Text>
                        <Text size='xs' c='dimmed'>
                          {v.slug}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Badge
                          color={
                            v.visibility === 'published'
                              ? 'green'
                              : v.visibility === 'draft'
                                ? 'gray'
                                : 'red'
                          }
                        >
                          {v.visibility}
                        </Badge>
                      </Table.Td>
                      <Table.Td>{v.scope_mode}</Table.Td>
                      <Table.Td>
                        <Group gap={4}>
                          {v.visibility === 'published' && (
                            <Tooltip label='Abrir galería'>
                              <Button
                                variant='light'
                                size='compact-xs'
                                component='a'
                                href={`/process/custom-views/v/${v.slug}`}
                                target='_blank'
                                leftSection={<IconExternalLink size={14} />}
                              >
                                Abrir
                              </Button>
                            </Tooltip>
                          )}
                          <Button
                            variant='light'
                            color='red'
                            size='compact-xs'
                            onClick={() => archiveView(v.id_saved_view)}
                            leftSection={<IconTrash size={14} />}
                          >
                            Archivar
                          </Button>
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
