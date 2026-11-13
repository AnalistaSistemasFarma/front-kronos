'use client';

import React, { useEffect, useState } from 'react';
import {
  ActionIcon, Alert, Button, FileButton, Group, Loader, NumberInput, Paper, ScrollArea, Select, Stack, Switch, Table, Text, TextInput, Textarea,
} from '@mantine/core';
import {
  IconCloudUpload,
  IconDownload,
  IconEraser,
  IconFile,
  IconFileSpreadsheet,
  IconPlus,
  IconSend,
  IconTrash,
  IconUpload,
  IconX,
} from '@tabler/icons-react';
import type ExcelJS from 'exceljs';
import BulkModal from './BulkModal';
import { COLUMNS, toFormLine, type FieldError, type Line, type LineField } from './RequestFormModal';
import PurchaseSearchModal from './PurchaseSearchModal';
import { purchaseSubject } from '../../../../lib/purchases/subject';
import type { LookupKind, LookupOption } from '../../../../lib/purchases/lookups';
import SapLookupInput from './SapLookupInput';
import { FIELD_LOOKUP } from '../../../../lib/purchases/lookups';
import { sapErrorText } from '../../../../lib/purchases/sapErrorHint';
import toast from 'react-hot-toast';

/** Aviso flotante con el error de SAP (como el NotifyError de SAPSEND). */
const notifySapError = (msg: string) => toast.error(sapErrorText(msg), { duration: 12000, style: { whiteSpace: 'pre-line', maxWidth: 520 } });

/**
 * Campos de la solicitud de compra DENTRO de «Crear Nueva Solicitud» (Mis solicitudes),
 * debajo del proceso: el usuario no cambia de pantalla. Al enviar:
 *   1) crea el borrador en SAP (POST /api/purchases/drafts),
 *   2) sube los adjuntos (cotizaciones) si hay,
 *   3) lo envia a autorizar, lo que crea la solicitud del workflow que aparece en Mis solicitudes.
 * Mismos campos y validaciones que el formulario de Compras (columnas compartidas).
 */

interface Props {
  /** id_company elegido arriba en el formulario general. */
  companyId: string;
  /** Ya no se usa: el asunto se arma solo («SC - proveedor - primera línea»). */
  subject?: string;
  /** Editar un borrador ya creado (desde su solicitud «En Borrador»). */
  edit?: { docEntry: number } | null;
  /** Termino (ok) o quedo el borrador creado con un aviso (warning). */
  onDone: (result: { ok: boolean; message: string }) => void;
}

type Readiness = 'loading' | 'ready' | 'no-write' | 'no-sap' | 'no-profile';

/** Valor interno de «moneda local» (Ryan guarda la moneda vacía, como en SAPSEND). */
const LOCAL = '__local';

/** Opciones de moneda de la empresa: la de por defecto + USD (igual que SAPSEND). */
export function currencyOptions(defaultCurrency: string): { value: string; label: string }[] {
  const def = defaultCurrency.trim().toUpperCase();
  const first = def ? { value: def, label: def } : { value: LOCAL, label: 'COP (moneda local)' };
  return def === 'USD' ? [first] : [first, { value: 'USD', label: 'USD' }];
}

const isEmpty = (v: unknown) => v == null || String(v).trim() === '';

/** Adjuntos que acepta SAP para la solicitud (los mismos de SAPSEND). */
const ALLOWED_EXT = ['pdf', 'jpg', 'jpeg', 'png'];
const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** Zona de adjuntos: arrastrar y soltar o hacer clic para elegir. */
function AttachmentsDrop({ files, onChange }: { files: File[]; onChange: (f: File[]) => void }) {
  const [over, setOver] = useState(false);
  const [rejected, setRejected] = useState<string[]>([]);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const add = (list: FileList | null) => {
    if (!list) return;
    const ok: File[] = [];
    const bad: string[] = [];
    for (const f of Array.from(list)) {
      const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
      if (!ALLOWED_EXT.includes(ext)) bad.push(`${f.name}: solo PDF, JPG o PNG`);
      else if (f.size > MAX_FILE_BYTES) bad.push(`${f.name}: supera 10 MB`);
      else if (!files.some((x) => x.name === f.name && x.size === f.size)) ok.push(f);
    }
    setRejected(bad);
    if (ok.length) onChange([...files, ...ok]);
  };

  return (
    <div>
      <Text fw={500} size="sm" mb={4}>
        Cotizaciones y anexos
      </Text>
      <Paper
        withBorder
        radius="md"
        p="md"
        role="button"
        tabIndex={0}
        aria-label="Adjuntar cotizaciones y anexos"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          add(e.dataTransfer.files);
        }}
        style={{
          borderStyle: 'dashed',
          borderWidth: 2,
          cursor: 'pointer',
          textAlign: 'center',
          borderColor: over ? 'var(--mantine-color-blue-5)' : undefined,
          background: over ? 'var(--mantine-color-blue-light)' : undefined,
        }}
      >
        <IconCloudUpload size={28} style={{ opacity: 0.6 }} />
        <Text size="sm">Arrastre aquí los archivos o haga clic para elegirlos</Text>
        <Text size="xs" c="dimmed">
          PDF, JPG o PNG · máximo 10 MB cada uno
        </Text>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.jpg,.jpeg,.png"
          hidden
          onChange={(e) => {
            add(e.currentTarget.files);
            e.currentTarget.value = '';
          }}
        />
      </Paper>
      {rejected.length > 0 && (
        <Text size="xs" c="red" mt={4}>
          No se agregaron: {rejected.join(' · ')}
        </Text>
      )}
      {files.length > 0 && (
        <Stack gap={4} mt="xs">
          {files.map((f, i) => (
            <Group key={`${f.name}-${i}`} gap={6} wrap="nowrap">
              <IconFile size={14} />
              <Text size="sm" truncate style={{ flex: 1 }}>
                {f.name}
              </Text>
              <Text size="xs" c="dimmed">
                {(f.size / 1024 / 1024).toFixed(2)} MB
              </Text>
              <ActionIcon
                size="sm"
                variant="subtle"
                color="red"
                aria-label={`Quitar ${f.name}`}
                onClick={() => onChange(files.filter((_, j) => j !== i))}
              >
                <IconX size={14} />
              </ActionIcon>
            </Group>
          ))}
        </Stack>
      )}
    </div>
  );
}

/** Ancho mínimo de cada columna de la tabla (las búsquedas en SAP necesitan más espacio). */
function colWidth(field: LineField, base: number): number {
  if (field === 'ItemDescription' || field === 'U_NombreProveedor') return 240;
  if (FIELD_LOOKUP[field]) return 170;
  if (field === 'Currency') return 130;
  if (field === 'RequiredDate') return 140;
  return Math.max(base, 110);
}

export default function PurchaseInlineForm({ companyId, edit, onDone }: Props) {
  const [readiness, setReadiness] = useState<Readiness>('loading');
  const [comments, setComments] = useState('');
  const [requiredDate, setRequiredDate] = useState('');
  const [lines, setLines] = useState<Line[]>([{}]);
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  /** Tras el primer intento de envío, los obligatorios vacíos se marcan en rojo. */
  const [tried, setTried] = useState(false);
  const [defaultCurrency, setDefaultCurrency] = useState('');
  /** Como Ventas: enviar de una vez a autorización o guardarla en borrador («En Borrador» en Mis solicitudes). */
  const [enviar, setEnviar] = useState(true);
  /** Lupa: búsqueda ampliada del campo de una línea. */
  const [search, setSearch] = useState<{ kind: LookupKind; line: number; field: LineField; q: string } | null>(null);
  const [loadingEdit, setLoadingEdit] = useState(false);
  const [companyName, setCompanyName] = useState('');
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkDone, setBulkDone] = useState(false);
  /** Asignación masiva: fecha requerida y proveedor a todas las líneas o a una. */
  const [massDate, setMassDate] = useState('');
  const [massDateTarget, setMassDateTarget] = useState<string>('all');
  const [massVendor, setMassVendor] = useState<{ text: string; option: LookupOption | null }>({ text: '', option: null });
  const [massVendorTarget, setMassVendorTarget] = useState<string>('all');
  const [massVendorSearch, setMassVendorSearch] = useState<string | null>(null);

  // Edición: carga el borrador.
  useEffect(() => {
    if (!edit) return;
    let cancelled = false;
    setLoadingEdit(true);
    fetch(`/api/purchases/item?companyId=${companyId}&docEntry=${edit.docEntry}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'No se pudo cargar la solicitud');
        if (cancelled) return;
        const item = data.item ?? {};
        setComments(String(item.Comments ?? ''));
        setRequiredDate(String(item.RequriedDate ?? '').slice(0, 10));
        const docLines: Record<string, unknown>[] = Array.isArray(item.DocumentLines) ? item.DocumentLines : [];
        setLines(docLines.length ? docLines.map(toFormLine) : [{}]);
      })
      .catch((e: Error) => {
        if (!cancelled) toast.error(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoadingEdit(false);
      });
    return () => {
      cancelled = true;
    };
  }, [edit, companyId]);
  /** Campos de búsqueda con texto escrito pero sin elegir de la lista («línea-campo»). */
  const [notFromList, setNotFromList] = useState<Set<string>>(new Set());
  const markNotFromList = (key: string, invalid: boolean) =>
    setNotFromList((prev) => {
      if (prev.has(key) === invalid) return prev;
      const next = new Set(prev);
      if (invalid) next.add(key);
      else next.delete(key);
      return next;
    });

  // ¿El usuario puede crear solicitudes de compra en esta empresa?
  useEffect(() => {
    let cancelled = false;
    setReadiness('loading');
    fetch('/api/purchases/access')
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const c = (d.companies ?? []).find((x: { idCompany: number }) => String(x.idCompany) === companyId);
        setDefaultCurrency(String(c?.defaultCurrency ?? ''));
        setCompanyName(String(c?.companyName ?? ''));
        if (!c?.canWrite) setReadiness('no-write');
        else if (!c.ready) setReadiness('no-sap');
        // Sin perfil de SAPSEND en la empresa no se puede crear (SAP registra quién solicita y su departamento).
        else if (c.sapsendUserId == null || c.sapsendDepartmentId == null) setReadiness('no-profile');
        else setReadiness('ready');
      })
      .catch(() => {
        if (!cancelled) setReadiness('no-write');
      });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const setLineValue = (index: number, field: LineField, value: string | number) => {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, [field]: value } : l)));
  };
  const errorFor = (field: string) => fieldErrors.find((e) => e.field === field)?.error;
  const currencyData = currencyOptions(defaultCurrency);
  const lineCurrency = (line: Line) => {
    const v = String(line.Currency ?? '');
    if (v) return v;
    return currencyData[0].value;
  };
  const newLine = (): Line => ({});
  /** Obligatorios vacíos (cliente), con el mismo texto para cada línea. */
  const missing = (i: number, field: LineField) =>
    tried && COLUMNS.find((c) => c.field === field)?.required && isEmpty(lines[i]?.[field]);
  const missingList = [
    ...(comments.trim() ? [] : ['Comentarios']),
    ...lines.flatMap((l, i) =>
      COLUMNS.filter((c) => c.required && isEmpty(l[c.field])).map((c) => `Línea ${i + 1} · ${c.label}`)
    ),
  ];
  /** Vista previa del asunto (el que vale lo arma el servidor desde SAP con la misma regla). */
  const autoSubject = purchaseSubject({ DocumentLines: lines as Record<string, unknown>[] });
  /** Aplica la opción elegida (lista o lupa) a la línea: valor + campos que llena. */
  const applyOption = (i: number, field: LineField, opt: LookupOption) =>
    setLines((prev) =>
      prev.map((l, j) => (j === i ? { ...l, ...(opt.fill ?? {}), [field]: opt.fill?.[field] ?? opt.value } : l))
    );

  const lineTargets = [
    { value: 'all', label: 'Todas las líneas' },
    ...lines.map((_, i) => ({ value: String(i), label: `Línea ${i + 1}` })),
  ];
  const inTarget = (target: string, i: number) => target === 'all' || Number(target) === i;
  const applyDate = () => {
    if (!massDate) return;
    setLines((prev) => prev.map((l, i) => (inTarget(massDateTarget, i) ? { ...l, RequiredDate: massDate } : l)));
  };
  const clearDates = () => setLines((prev) => prev.map((l) => ({ ...l, RequiredDate: '' })));
  const applyVendor = () => {
    const opt = massVendor.option;
    if (!opt) {
      toast.error('Elija el proveedor de la lista de SAP.');
      return;
    }
    setLines((prev) => prev.map((l, i) => (inTarget(massVendorTarget, i) ? { ...l, ...(opt.fill ?? {}) } : l)));
  };
  const clearVendors = () => setLines((prev) => prev.map((l) => ({ ...l, LineVendor: '', U_NombreProveedor: '' })));

  /** Plantilla de líneas: una columna por campo de la tabla (nombre visible). */
  const downloadLinesTemplate = async () => {
    const { default: Excel } = await import('exceljs');
    const wb = new Excel.Workbook();
    const ws = wb.addWorksheet('Lineas');
    ws.addRow(COLUMNS.map((c) => `${c.label}${c.required ? ' *' : ''}`));
    ws.getRow(1).font = { bold: true };
    ws.columns.forEach((col) => {
      col.width = 20;
    });
    const buf = await wb.xlsx.writeBuffer();
    const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'plantilla-lineas-solicitud-compra.xlsx';
    a.click();
    URL.revokeObjectURL(url);
  };

  /** Carga las líneas desde la plantilla (reemplaza las líneas vacías; agrega a las que ya tienen datos). */
  const loadLinesFile = async (file: File | null) => {
    if (!file) return;
    try {
      const { default: Excel } = await import('exceljs');
      const wb = new Excel.Workbook();
      await wb.xlsx.load(await file.arrayBuffer());
      const ws = wb.worksheets[0];
      if (!ws) throw new Error('El archivo no tiene hojas.');
      const norm = (t: string) => t.replace(/\*/g, '').trim().toLowerCase();
      const byHeader = new Map<string, LineField>();
      for (const c of COLUMNS) {
        byHeader.set(norm(c.label), c.field);
        byHeader.set(norm(c.field), c.field);
      }
      const cols: (LineField | null)[] = [];
      ws.getRow(1).eachCell((cell, col) => {
        cols[col] = byHeader.get(norm(String(cell.value ?? ''))) ?? null;
      });
      if (!cols.some(Boolean)) throw new Error('El archivo no tiene los encabezados de la plantilla de líneas.');
      const cellVal = (v: ExcelJS.CellValue): string | number => {
        if (v == null) return '';
        if (v instanceof Date) return v.toISOString().slice(0, 10);
        if (typeof v === 'object') {
          if ('result' in v) return cellVal((v as ExcelJS.CellFormulaValue).result as ExcelJS.CellValue);
          if ('richText' in v) return (v as ExcelJS.CellRichTextValue).richText.map((t) => t.text).join('');
          if ('text' in v) return String((v as ExcelJS.CellHyperlinkValue).text);
          return '';
        }
        return typeof v === 'number' ? v : String(v).trim();
      };
      const parsed: Line[] = [];
      for (let r = 2; r <= ws.rowCount; r++) {
        const line: Line = {};
        let has = false;
        ws.getRow(r).eachCell((cell, col) => {
          const f = cols[col];
          const v = cellVal(cell.value);
          if (!f || v === '') return;
          const c = COLUMNS.find((x) => x.field === f);
          line[f] = c?.numeric ? Number(String(v).replace(/,/g, '')) || 0 : f === 'ItemDescription' ? String(v).toUpperCase() : v;
          has = true;
        });
        if (has) parsed.push(line);
      }
      if (parsed.length === 0) throw new Error('La plantilla no trae líneas.');
      setLines((prev) => [...prev.filter((l) => Object.values(l).some((v) => !isEmpty(v))), ...parsed]);
      setNotFromList(new Set());
      toast.success(`Se cargaron ${parsed.length} línea(s). Revise y complete los campos en rojo.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo leer el archivo. Use la plantilla .xlsx.');
    }
  };

  const submit = async () => {
    setTried(true);
    setFieldErrors([]);
    if (missingList.length > 0) {
      toast.error(`Complete los campos obligatorios marcados en rojo: ${missingList.join(' · ')}.`);
      return;
    }
    if (notFromList.size > 0) {
      const labels = [...notFromList].map((k) => {
        const [i, f] = k.split('-');
        return `Línea ${Number(i) + 1} · ${COLUMNS.find((c) => c.field === f)?.label ?? f}`;
      });
      toast.error(`Elija de la lista de SAP: ${labels.join(' · ')}.`);
      return;
    }
    setSaving(true);
    try {
      // 1) Borrador en SAP (crear o, si se edita, actualizar)
      const res = await fetch('/api/purchases/drafts', {
        method: edit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: Number(companyId),
          ...(edit ? { docEntry: edit.docEntry } : {}),
          header: { Comments: comments, ...(requiredDate ? { RequriedDate: requiredDate } : {}) },
          // Moneda: la elegida o la de la empresa; «moneda local» viaja vacía (como SAPSEND en Ryan).
          lines: lines.map((l) => {
            const cur = lineCurrency(l);
            return { ...l, Currency: cur === LOCAL ? '' : cur };
          }),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        notifySapError(String(data.error || 'No se pudo crear la solicitud de compra'));
        setFieldErrors(Array.isArray(data.errors) ? data.errors : []);
        return;
      }
      const docEntry = Number(edit?.docEntry ?? data.docEntry);

      // 2) Adjuntos (no bloquean: si fallan, se avisa)
      let attachWarning = '';
      if (files.length > 0) {
        const form = new FormData();
        form.append('companyId', companyId);
        form.append('docEntry', String(docEntry));
        for (const f of files) form.append('files', f, f.name);
        const up = await fetch('/api/purchases/attachments', { method: 'POST', body: form });
        if (!up.ok) {
          const u = await up.json().catch(() => ({}));
          attachWarning = ` Los adjuntos no se cargaron: ${u.error || 'error'}.`;
          if (u.error) notifySapError(String(u.error));
        }
      }

      // 3) Enviar a autorización, o dejarla «En Borrador» en Mis solicitudes (sin flujo)
      const sent = await fetch('/api/purchases/drafts/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: Number(companyId), docEntry, borrador: !enviar }),
      });
      const sentData = await sent.json().catch(() => ({}));
      if (!sent.ok) {
        if (sentData.error) notifySapError(String(sentData.error));
        onDone({
          ok: false,
          message: `Se guardó el borrador #${docEntry}, pero no se pudo ${enviar ? 'enviar a autorización' : 'dejar en Mis solicitudes'}: ${sentData.error || 'error'}.${attachWarning}`,
        });
        return;
      }
      onDone({
        ok: !attachWarning,
        message: enviar
          ? `Solicitud de compra #${docEntry} enviada a autorización.${attachWarning}`
          : `Solicitud de compra #${docEntry} guardada en borrador; la encuentra en Mis solicitudes («En Borrador»).${attachWarning}`,
      });
    } catch {
      toast.error('Error de red al crear la solicitud de compra');
    } finally {
      setSaving(false);
    }
  };

  if (readiness === 'loading') return <Loader size="sm" />;
  if (readiness === 'no-write') {
    return (
      <Alert color="yellow" title="Solicitud de compra">
        No tiene permiso para crear solicitudes de compra en esta empresa («Compras · Gestionar solicitudes»).
      </Alert>
    );
  }
  if (readiness === 'no-profile') {
    return (
      <Alert color="yellow" title="Falta su perfil de SAPSEND en esta empresa">
        Para crear solicitudes de compra su usuario necesita el ID de usuario y el ID de departamento de SAPSEND de esta
        empresa. Pídale a Tecnología que los registre en Administración → Usuarios → «SAPSEND por empresa».
      </Alert>
    );
  }
  if (readiness === 'no-sap') {
    return (
      <Alert color="yellow" title="Solicitud de compra">
        Esta empresa no tiene conexión a SAP configurada; no se pueden crear solicitudes de compra.
      </Alert>
    );
  }


  return (
    <Stack gap="md" pos="relative">
      {loadingEdit && <Loader size="sm" />}
      <Paper withBorder radius="md" p="sm" bg="var(--mantine-color-default-hover)">
        <Text size="xs" c="dimmed">
          Asunto de la solicitud (se arma solo)
        </Text>
        <Text size="sm" fw={600}>
          {autoSubject}
        </Text>
      </Paper>
      <Group grow align="flex-start">
        <TextInput
          label="Fecha requerida"
          type="date"
          value={requiredDate}
          onChange={(e) => setRequiredDate(e.currentTarget.value)}
          error={errorFor('RequriedDate')}
        />
      </Group>

      <Textarea
        label="Comentarios"
        withAsterisk
        autosize
        minRows={2}
        maxLength={254}
        value={comments}
        onChange={(e) => setComments(e.currentTarget.value.toUpperCase())}
        error={errorFor('Comments') ?? (tried && !comments.trim() ? 'Obligatorio' : undefined)}
      />

      <div>
        <Group justify="space-between" mb={6} wrap="wrap">
          <Text fw={600} size="sm">
            Líneas de la solicitud
          </Text>
          <Group gap="xs">
            <Button size="xs" variant="subtle" leftSection={<IconDownload size={14} />} onClick={downloadLinesTemplate}>
              Plantilla de líneas
            </Button>
            <FileButton onChange={loadLinesFile} accept=".xlsx">
              {(props) => (
                <Button {...props} size="xs" variant="light" leftSection={<IconUpload size={14} />}>
                  Cargar líneas desde Excel
                </Button>
              )}
            </FileButton>
            {!edit && (
              <Button size="xs" variant="light" color="grape" leftSection={<IconFileSpreadsheet size={14} />} onClick={() => setBulkOpen(true)}>
                Cargue masivo de solicitudes
              </Button>
            )}
          </Group>
        </Group>

        {/* Asignación masiva a las líneas: a todas o a una en específico; y borrar en todas de una vez. */}
        <Paper withBorder radius="md" p="xs" mb="xs">
          <Group gap="lg" align="flex-end" wrap="wrap">
            <Group gap={6} align="flex-end" wrap="nowrap">
              <TextInput size="xs" type="date" label="Fecha requerida" value={massDate} onChange={(e) => setMassDate(e.currentTarget.value)} />
              <Select size="xs" w={150} label="Aplicar a" data={lineTargets} value={massDateTarget} onChange={(v) => setMassDateTarget(v ?? 'all')} allowDeselect={false} comboboxProps={{ withinPortal: true, zIndex: 1100 }} />
              <Button size="xs" onClick={applyDate} disabled={!massDate}>
                Aplicar
              </Button>
              <Button size="xs" variant="subtle" color="red" leftSection={<IconEraser size={14} />} onClick={clearDates}>
                Quitar en todas
              </Button>
            </Group>
            <Group gap={6} align="flex-end" wrap="nowrap">
              <div style={{ width: 260 }}>
                <SapLookupInput
                  size="xs"
                  label="Proveedor"
                  companyId={companyId}
                  kind="vendor"
                  value={massVendor.text}
                  onChange={(v) => setMassVendor({ text: v, option: null })}
                  onSelect={(opt) => setMassVendor({ text: opt.label, option: opt })}
                  onExpand={(q) => setMassVendorSearch(q)}
                  ariaLabel="Proveedor para asignar a las líneas"
                />
              </div>
              <Select size="xs" w={150} label="Aplicar a" data={lineTargets} value={massVendorTarget} onChange={(v) => setMassVendorTarget(v ?? 'all')} allowDeselect={false} comboboxProps={{ withinPortal: true, zIndex: 1100 }} />
              <Button size="xs" onClick={applyVendor} disabled={!massVendor.option}>
                Aplicar
              </Button>
              <Button size="xs" variant="subtle" color="red" leftSection={<IconEraser size={14} />} onClick={clearVendors}>
                Quitar en todas
              </Button>
            </Group>
          </Group>
        </Paper>

        <ScrollArea type="auto" offsetScrollbars>
          <Table withTableBorder withColumnBorders verticalSpacing={4} horizontalSpacing={6} style={{ minWidth: 1900 }}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th style={{ width: 36 }}>#</Table.Th>
                {COLUMNS.map((c) => (
                  <Table.Th key={c.field} style={{ minWidth: colWidth(c.field, c.width), whiteSpace: 'nowrap' }}>
                    {c.label}
                    {c.required && (
                      <Text span c="red" fw={700}>
                        {' '}*
                      </Text>
                    )}
                  </Table.Th>
                ))}
                <Table.Th style={{ width: 40 }} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {lines.map((line, i) => (
                <Table.Tr key={i}>
                  <Table.Td>
                    <Text size="xs" fw={600}>
                      {i + 1}
                    </Text>
                  </Table.Td>
                  {COLUMNS.map((c) => {
                    const serverErr = errorFor(`DocumentLines[${i}].${c.field}`);
                    const err: React.ReactNode = serverErr ?? (missing(i, c.field) ? 'Obligatorio' : undefined);
                    const aria = `${c.label} línea ${i + 1}`;
                    let input: React.ReactNode;
                    if (c.field === 'Currency') {
                      input = (
                        <Select
                          size="xs"
                          data={currencyData}
                          value={lineCurrency(line)}
                          onChange={(v) => setLineValue(i, 'Currency', v ?? currencyData[0].value)}
                          allowDeselect={false}
                          comboboxProps={{ withinPortal: true, zIndex: 1100 }}
                          aria-label={aria}
                        />
                      );
                    } else if (c.numeric) {
                      input = (
                        <NumberInput
                          size="xs"
                          min={0}
                          allowNegative={false}
                          thousandSeparator="."
                          decimalSeparator=","
                          value={line[c.field] ?? ''}
                          onChange={(v) => setLineValue(i, c.field, v)}
                          error={err}
                          aria-label={aria}
                        />
                      );
                    } else if (FIELD_LOOKUP[c.field]) {
                      input = (
                        <SapLookupInput
                          size="xs"
                          companyId={companyId}
                          kind={FIELD_LOOKUP[c.field]!}
                          value={String(line[c.field] ?? '')}
                          onChange={(v) => setLineValue(i, c.field, v)}
                          onSelect={(opt) => applyOption(i, c.field, opt)}
                          onExpand={(q) => setSearch({ kind: FIELD_LOOKUP[c.field]!, line: i, field: c.field, q })}
                          error={typeof err === 'string' ? err : undefined}
                          ariaLabel={aria}
                          onInvalidChange={(bad) => markNotFromList(`${i}-${c.field}`, bad)}
                        />
                      );
                    } else {
                      input = (
                        <TextInput
                          size="xs"
                          type={c.field === 'RequiredDate' ? 'date' : 'text'}
                          value={String(line[c.field] ?? '')}
                          onChange={(e) => {
                            const v = e.currentTarget.value;
                            setLineValue(i, c.field, c.field === 'ItemDescription' ? v.toUpperCase() : v);
                          }}
                          error={err}
                          aria-label={aria}
                        />
                      );
                    }
                    return (
                      <Table.Td key={c.field} style={{ verticalAlign: 'top' }}>
                        {input}
                      </Table.Td>
                    );
                  })}
                  <Table.Td style={{ verticalAlign: 'top' }}>
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      disabled={lines.length === 1}
                      onClick={() => {
                        setLines((prev) => prev.filter((_, j) => j !== i));
                        setNotFromList(new Set());
                      }}
                      aria-label={`Quitar línea ${i + 1}`}
                    >
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>
        <Button
          mt="sm"
          variant="light"
          leftSection={<IconPlus size={16} />}
          onClick={() => setLines((prev) => [...prev, newLine()])}
        >
          Agregar línea
        </Button>
      </div>

      <AttachmentsDrop files={files} onChange={setFiles} />

      {/* Pie fijo: el botón de enviar siempre a la vista (pantalla completa); los errores salen en el aviso flotante. */}
      <Stack
        gap="xs"
        style={{
          position: 'sticky',
          bottom: 0,
          zIndex: 5,
          background: 'var(--mantine-color-body)',
          paddingTop: 8,
          paddingBottom: 8,
          borderTop: '1px solid var(--mantine-color-default-border)',
        }}
      >
        <Group justify="space-between">
          <Switch
            checked={enviar}
            onChange={(e) => setEnviar(e.currentTarget.checked)}
            label={enviar ? 'Enviar a autorización del líder de área' : 'Guardar en borrador (podrá editarla y enviarla después)'}
          />
          <Button
            leftSection={<IconSend size={16} />}
            onClick={submit}
            loading={saving}
            disabled={loadingEdit}
          >
            {enviar ? (edit ? 'Guardar y enviar a autorización' : 'Crear y enviar a autorización') : edit ? 'Guardar borrador' : 'Guardar en borrador'}
          </Button>
        </Group>
      </Stack>
      {search && (
        <PurchaseSearchModal
          opened
          onClose={() => setSearch(null)}
          companyId={companyId}
          kind={search.kind}
          initialQuery={search.q}
          onSelect={(opt) => applyOption(search.line, search.field, opt)}
        />
      )}
      {massVendorSearch !== null && (
        <PurchaseSearchModal
          opened
          onClose={() => setMassVendorSearch(null)}
          companyId={companyId}
          kind="vendor"
          initialQuery={massVendorSearch}
          onSelect={(opt) => setMassVendor({ text: opt.label, option: opt })}
        />
      )}
      <BulkModal
        opened={bulkOpen}
        onClose={() => {
          setBulkOpen(false);
          if (bulkDone) onDone({ ok: true, message: 'Carga masiva procesada: las solicitudes quedaron en Mis solicitudes.' });
        }}
        onDone={() => setBulkDone(true)}
        companies={[{ idCompany: Number(companyId), companyName: companyName || 'Empresa' }]}
      />
    </Stack>
  );
}
