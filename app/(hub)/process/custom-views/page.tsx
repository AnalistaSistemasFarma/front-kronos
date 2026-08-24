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
  ActionIcon,
  Alert,
  Autocomplete,
  Badge,
  Button,
  Checkbox,
  Group,
  Loader,
  NumberInput,
  Paper,
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
  IconFilter,
  IconPlayerPlay,
  IconPencil,
  IconPlus,
  IconTable,
  IconTrash,
  IconWand,
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
  id_process: number | null;
  scope_mode: string;
  company_column: string | null;
  visibility: string;
  sort_order: number;
  row_limit: number;
}
/** Módulo de primer nivel (tabla process) para el selector "Ubicar en". */
interface ModuleOption {
  id_process: number;
  process: string;
  process_url: string | null;
}
interface ProcessFlowOption {
  id_process_category: number;
  process: string;
  companies: string[];
}
interface PreviewResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
}
type Feedback = { type: 'success' | 'error'; text: string } | null;

/** Borrador de filtro parametrizable definido por el autor (Incremento 3). */
interface FilterDraft {
  column_name: string;
  label: string;
  filter_type: string;
  operator: string;
  options_text: string;
  default_value: string;
  required: boolean;
}

const FILTER_TYPE_OPTIONS = [
  { value: 'text', label: 'Texto' },
  { value: 'select', label: 'Lista (select)' },
  { value: 'date', label: 'Fecha' },
  { value: 'daterange', label: 'Rango de fechas' },
  { value: 'number', label: 'Número' },
];
const FILTER_OP_OPTIONS = [
  { value: 'eq', label: 'Igual (=)' },
  { value: 'like', label: 'Contiene (LIKE)' },
  { value: 'in', label: 'En lista (IN)' },
  { value: 'between', label: 'Entre (BETWEEN)' },
  { value: 'gte', label: 'Mayor o igual (>=)' },
  { value: 'lte', label: 'Menor o igual (<=)' },
];

const ICON_OPTIONS = [
  { value: 'table', label: 'Tabla' },
  { value: 'database', label: 'Base de datos' },
  { value: 'chart-bar', label: 'Gráfico' },
  { value: 'report', label: 'Reporte' },
  { value: 'list', label: 'Lista' },
  { value: 'file-analytics', label: 'Analítica' },
  { value: 'clipboard-list', label: 'Checklist' },
];

/** Módulo por defecto "Vistas personalizadas" (id_process 13). */
const DEFAULT_MODULE_ID = 13;
/** Valor centinela del selector "Ubicar en" para crear una categoría nueva. */
const NEW_CATEGORY_VALUE = '__new__';

// -------------------------------------------------------------------- página

export default function CustomViewsBuilderPage() {
  const { data: session } = useSession();

  const [catalog, setCatalog] = useState<CatalogSource[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  // Selector "Flujo de trabajo" (pivote guiado)
  const [processes, setProcesses] = useState<ProcessFlowOption[]>([]);
  const [processesLoading, setProcessesLoading] = useState(true);
  const [selectedProcess, setSelectedProcess] = useState<string | null>(null);
  const [generatingPivot, setGeneratingPivot] = useState(false);

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

  // Edición en su lugar de una vista existente (null = crear nueva).
  const [editingId, setEditingId] = useState<number | null>(null);
  const [loadingEdit, setLoadingEdit] = useState(false);

  // "Ubicar en": módulo de primer nivel destino (o nueva categoría).
  const [modules, setModules] = useState<ModuleOption[]>([]);
  const [targetModule, setTargetModule] = useState<string>(String(DEFAULT_MODULE_ID));
  const [newCategoryName, setNewCategoryName] = useState('');

  // filtros parametrizables (Incremento 3)
  const [filterDrafts, setFilterDrafts] = useState<FilterDraft[]>([]);

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

  const loadProcesses = useCallback(async () => {
    setProcessesLoading(true);
    try {
      const res = await fetch('/api/custom-views/catalog/processes', { cache: 'no-store' });
      const data = await res.json();
      if (res.ok) setProcesses(data.processes ?? []);
    } catch {
      /* silencioso: el árbol de catálogo sigue funcionando sin el selector */
    } finally {
      setProcessesLoading(false);
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

  const loadModules = useCallback(async () => {
    try {
      const res = await fetch('/api/custom-views/catalog/modules', { cache: 'no-store' });
      const data = await res.json();
      if (res.ok) setModules(data.modules ?? []);
    } catch {
      /* silencioso: el selector cae al módulo por defecto */
    }
  }, []);

  useEffect(() => {
    loadCatalog();
    loadViews();
    loadProcesses();
    loadModules();
  }, [loadCatalog, loadViews, loadProcesses, loadModules]);

  /** Limpia el formulario y sale del modo edición (crear vista nueva). */
  const resetForm = useCallback(() => {
    setEditingId(null);
    setName('');
    setDescription('');
    setIcon('table');
    setSortOrder(0);
    setScopeMode('all');
    setCompanyColumn('');
    setRowLimit(1000);
    setVisibility('draft');
    setFilterDrafts([]);
    setTargetModule(String(DEFAULT_MODULE_ID));
    setNewCategoryName('');
  }, []);

  /** Carga una vista existente en el formulario/editor para editarla EN SU LUGAR. */
  const startEdit = useCallback(async (id: number) => {
    setLoadingEdit(true);
    setFeedback(null);
    try {
      const res = await fetch(`/api/custom-views/${id}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok || !data.view) {
        setFeedback({ type: 'error', text: data.error ?? 'No se pudo cargar la vista.' });
        return;
      }
      const v = data.view as {
        id_saved_view: number;
        name: string;
        description: string | null;
        sql_text: string;
        icon: string | null;
        id_process: number | null;
        scope_mode: string;
        company_column: string | null;
        sort_order: number;
        row_limit: number;
        visibility: string;
        filters?: Array<{
          column_name: string;
          label: string;
          filter_type: string;
          operator: string;
          options_json: string | null;
          default_value: string | null;
          required: boolean;
        }>;
      };
      setEditingId(v.id_saved_view);
      setName(v.name ?? '');
      setDescription(v.description ?? '');
      setIcon(v.icon ?? 'table');
      setSortOrder(v.sort_order ?? 0);
      setScopeMode(v.scope_mode ?? 'all');
      setCompanyColumn(v.company_column ?? '');
      setRowLimit(v.row_limit ?? 1000);
      setVisibility(v.visibility === 'archived' ? 'draft' : v.visibility ?? 'draft');
      setTargetModule(String(v.id_process ?? DEFAULT_MODULE_ID));
      setNewCategoryName('');
      setSql(v.sql_text ?? '');
      const ed = editorRef.current;
      if (ed) ed.setValue(v.sql_text ?? '');
      setFilterDrafts(
        (v.filters ?? []).map((f) => ({
          column_name: f.column_name,
          label: f.label,
          filter_type: f.filter_type,
          operator: f.operator,
          options_text: (() => {
            if (!f.options_json) return '';
            try {
              const arr = JSON.parse(f.options_json);
              return Array.isArray(arr) ? arr.map((o) => String(o)).join(', ') : '';
            } catch {
              return '';
            }
          })(),
          default_value: f.default_value ?? '',
          required: !!f.required,
        }))
      );
      setFeedback({
        type: 'success',
        text: `Editando "${v.name}". Cambie lo que necesite y presione Guardar.`,
      });
      if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      setFeedback({ type: 'error', text: 'Error de red al cargar la vista.' });
    } finally {
      setLoadingEdit(false);
    }
  }, []);

  /** Al elegir un flujo: pide al servidor el SQL pivoteado y lo carga en el editor. */
  const onSelectProcess = useCallback(async (value: string | null) => {
    setSelectedProcess(value);
    if (!value) return;
    setGeneratingPivot(true);
    setFeedback(null);
    try {
      const res = await fetch(
        `/api/custom-views/catalog/process-pivot?processId=${encodeURIComponent(value)}`,
        { cache: 'no-store' }
      );
      const data = await res.json();
      if (res.ok && typeof data.sql === 'string') {
        setSql(data.sql);
        const ed = editorRef.current;
        if (ed) ed.setValue(data.sql);
        setFeedback({
          type: 'success',
          text: `SQL generado para el flujo "${data.processName || value}" (${
            data.fieldCount ?? 0
          } campo(s)). Revíselo y ejecute la vista previa.`,
        });
      } else {
        setFeedback({
          type: 'error',
          text: `${data.error ?? 'No se pudo generar el SQL del flujo.'}${
            data.detail ? ' — ' + data.detail : ''
          }`,
        });
      }
    } catch {
      setFeedback({ type: 'error', text: 'Error de red al generar el SQL del flujo.' });
    } finally {
      setGeneratingPivot(false);
    }
  }, []);

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

  // ----------------------------------------------------------- filtros (autor)

  const addFilter = useCallback(() => {
    setFilterDrafts((prev) => [
      ...prev,
      {
        column_name: '',
        label: '',
        filter_type: 'text',
        operator: 'eq',
        options_text: '',
        default_value: '',
        required: false,
      },
    ]);
  }, []);

  const updateFilter = useCallback(
    (index: number, patch: Partial<FilterDraft>) => {
      setFilterDrafts((prev) => prev.map((f, i) => (i === index ? { ...f, ...patch } : f)));
    },
    []
  );

  const removeFilter = useCallback((index: number) => {
    setFilterDrafts((prev) => prev.filter((_, i) => i !== index));
  }, []);

  /** Convierte los borradores de filtro al payload que espera el backend. */
  const buildFilterPayload = useCallback(
    () =>
      filterDrafts
        .filter((f) => f.column_name.trim() && f.label.trim())
        .map((f, i) => ({
          column_name: f.column_name.trim(),
          label: f.label.trim(),
          filter_type: f.filter_type,
          operator: f.operator,
          options_json:
            f.filter_type === 'select' && f.options_text.trim()
              ? JSON.stringify(
                  f.options_text
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean)
                )
              : null,
          default_value: f.default_value.trim() || null,
          required: f.required,
          sort_order: i,
        })),
    [filterDrafts]
  );

  const saveView = useCallback(async () => {
    if (!name.trim()) {
      setFeedback({ type: 'error', text: 'Indique un nombre para la vista.' });
      return;
    }
    const creatingCategory = targetModule === NEW_CATEGORY_VALUE;
    if (creatingCategory && !newCategoryName.trim()) {
      setFeedback({ type: 'error', text: 'Indique el nombre de la nueva categoría.' });
      return;
    }
    setSaving(true);
    setFeedback(null);

    // "Ubicar en": módulo existente o nueva categoría (default 13).
    const moduleFields: Record<string, unknown> = creatingCategory
      ? { newCategoryName: newCategoryName.trim() }
      : { targetProcessId: Number(targetModule) || DEFAULT_MODULE_ID };

    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      sql_text: sql,
      icon,
      sort_order: Number(sortOrder) || 0,
      scope_mode: scopeMode,
      company_column: scopeMode === 'company' ? companyColumn.trim() : null,
      row_limit: Number(rowLimit) || 1000,
      visibility,
      filters: buildFilterPayload(),
      ...moduleFields,
    };

    try {
      const isEditing = editingId !== null;
      const res = await fetch(
        isEditing ? `/api/custom-views/${editingId}` : '/api/custom-views',
        {
          method: isEditing ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );
      const data = await res.json();
      if (res.ok) {
        const vname = data.view?.name ?? name.trim();
        setFeedback({
          type: 'success',
          text: isEditing
            ? `Vista "${vname}" actualizada${
                visibility === 'published' ? ' (publicada)' : ' (borrador)'
              }.`
            : visibility === 'published'
              ? `Vista "${vname}" publicada (slug: ${data.view?.slug ?? ''}). Asígnela en Usuarios para que aparezca en el menú.`
              : `Borrador "${vname}" guardado.`,
        });
        resetForm();
        await Promise.all([loadViews(), loadModules()]);
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
  }, [
    name,
    description,
    sql,
    icon,
    sortOrder,
    scopeMode,
    companyColumn,
    rowLimit,
    visibility,
    buildFilterPayload,
    loadViews,
    loadModules,
    editingId,
    targetModule,
    newCategoryName,
    resetForm,
  ]);

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
          {/* Selector guiado: generar SQL pivoteado desde un flujo de trabajo */}
          <div style={{ marginBottom: 14 }}>
            <Group gap={6} mb={6}>
              <IconWand size={18} />
              <Text fw={600}>Flujo de trabajo</Text>
            </Group>
            <Select
              placeholder={
                processesLoading ? 'Cargando flujos…' : 'Elija un flujo para generar la vista'
              }
              data={processes.map((p) => ({
                value: String(p.id_process_category),
                label: p.companies.length
                  ? `${p.process} — ${p.companies.join(', ')}`
                  : p.process,
              }))}
              value={selectedProcess}
              onChange={onSelectProcess}
              disabled={processesLoading || generatingPivot}
              searchable
              clearable
              nothingFoundMessage='Sin flujos activos'
              rightSection={generatingPivot ? <Loader size='xs' /> : undefined}
            />
            <Text size='xs' c='dimmed' mt={4}>
              Genera una vista con una fila por solicitud y los campos del formulario como
              columnas. Los campos tipo Tabla se excluyen.
            </Text>
          </div>

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
            <Group justify='space-between' mb='sm'>
              <Group gap={8}>
                <Text fw={600}>{editingId !== null ? 'Editar vista' : 'Guardar / Publicar'}</Text>
                {editingId !== null && (
                  <Badge color='indigo' variant='light'>
                    Editando #{editingId}
                  </Badge>
                )}
                {loadingEdit && <Loader size='xs' />}
              </Group>
              {editingId !== null && (
                <Button
                  size='compact-sm'
                  variant='subtle'
                  color='gray'
                  onClick={resetForm}
                >
                  Nueva vista / Cancelar edición
                </Button>
              )}
            </Group>
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
              <Select
                label='Ubicar en (módulo del menú)'
                description='Módulo de primer nivel donde aparecerá la vista al publicarla'
                data={[
                  ...modules.map((m) => ({
                    value: String(m.id_process),
                    label: m.process,
                  })),
                  { value: NEW_CATEGORY_VALUE, label: '➕ Nueva categoría…' },
                ]}
                value={targetModule}
                onChange={(v) => setTargetModule(v ?? String(DEFAULT_MODULE_ID))}
                searchable
              />
              {targetModule === NEW_CATEGORY_VALUE && (
                <TextInput
                  label='Nombre de la nueva categoría'
                  required
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.currentTarget.value)}
                  placeholder='Ej. Reportes de Tesorería'
                />
              )}
            </div>

            {/* Filtros parametrizables (Incremento 3) */}
            <div style={{ marginTop: 16 }}>
              <Group justify='space-between' mb='xs'>
                <Group gap={6}>
                  <IconFilter size={16} />
                  <Text fw={600}>Filtros parametrizables</Text>
                </Group>
                <Button
                  size='compact-sm'
                  variant='light'
                  leftSection={<IconPlus size={14} />}
                  onClick={addFilter}
                >
                  Agregar filtro
                </Button>
              </Group>
              <Text size='xs' c='dimmed' mb='sm'>
                El consumidor podrá filtrar la vista por estas columnas del resultado. Ejecute una
                vista previa para sugerir columnas.
              </Text>

              {filterDrafts.length === 0 ? (
                <Text size='sm' c='dimmed'>
                  Sin filtros. La vista se consultará sin panel de filtros.
                </Text>
              ) : (
                filterDrafts.map((f, i) => (
                  <Paper key={i} withBorder p='sm' radius='md' mb='xs'>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr 1fr 1fr',
                        gap: 10,
                        alignItems: 'flex-end',
                      }}
                    >
                      <Autocomplete
                        label='Columna del resultado'
                        required
                        data={preview?.columns ?? []}
                        value={f.column_name}
                        onChange={(v) => updateFilter(i, { column_name: v })}
                        placeholder='p. ej. estado'
                      />
                      <TextInput
                        label='Etiqueta'
                        required
                        value={f.label}
                        onChange={(e) => updateFilter(i, { label: e.currentTarget.value })}
                        placeholder='p. ej. Estado'
                      />
                      <Select
                        label='Tipo'
                        data={FILTER_TYPE_OPTIONS}
                        value={f.filter_type}
                        onChange={(v) => updateFilter(i, { filter_type: v ?? 'text' })}
                      />
                      <Select
                        label='Operador'
                        data={FILTER_OP_OPTIONS}
                        value={f.operator}
                        onChange={(v) => updateFilter(i, { operator: v ?? 'eq' })}
                      />
                      {f.filter_type === 'select' && (
                        <TextInput
                          label='Opciones (separadas por coma)'
                          value={f.options_text}
                          onChange={(e) => updateFilter(i, { options_text: e.currentTarget.value })}
                          placeholder='Abierto, Cerrado, Pendiente'
                          style={{ gridColumn: '1 / span 2' }}
                        />
                      )}
                      <TextInput
                        label='Valor por defecto'
                        value={f.default_value}
                        onChange={(e) => updateFilter(i, { default_value: e.currentTarget.value })}
                        placeholder='Opcional'
                      />
                      <Group gap='sm' wrap='nowrap'>
                        <Checkbox
                          label='Requerido'
                          checked={f.required}
                          onChange={(e) => updateFilter(i, { required: e.currentTarget.checked })}
                        />
                        <Tooltip label='Quitar filtro'>
                          <ActionIcon color='red' variant='light' onClick={() => removeFilter(i)}>
                            <IconTrash size={16} />
                          </ActionIcon>
                        </Tooltip>
                      </Group>
                    </div>
                  </Paper>
                ))
              )}
            </div>

            <Group mt='md'>
              <Button onClick={saveView} loading={saving} color='teal'>
                {editingId !== null
                  ? visibility === 'published'
                    ? 'Actualizar y publicar'
                    : 'Actualizar vista'
                  : visibility === 'published'
                    ? 'Publicar vista'
                    : 'Guardar borrador'}
              </Button>
              {editingId !== null && (
                <Button variant='default' onClick={resetForm}>
                  Cancelar
                </Button>
              )}
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
                            size='compact-xs'
                            onClick={() => startEdit(v.id_saved_view)}
                            leftSection={<IconPencil size={14} />}
                          >
                            Editar
                          </Button>
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
