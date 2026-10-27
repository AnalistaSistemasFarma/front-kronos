'use client';

import React, { useEffect, useState } from 'react';
import {
  ActionIcon, Alert, Button, Group, Loader, NumberInput, Paper, ScrollArea, Select, Stack, Table, Text, TextInput, Textarea,
} from '@mantine/core';
import { IconCloudUpload, IconFile, IconPlus, IconSend, IconTrash, IconX } from '@tabler/icons-react';
import { COLUMNS, type FieldError, type Line, type LineField } from './RequestFormModal';
import SapLookupInput from './SapLookupInput';
import { FIELD_LOOKUP } from '../../../../lib/purchases/lookups';

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
  /** Asunto del formulario general: se usa en la solicitud del workflow. */
  subject: string;
  /** Termino (ok) o quedo el borrador creado con un aviso (warning). */
  onDone: (result: { ok: boolean; message: string }) => void;
}

type Readiness = 'loading' | 'ready' | 'no-write' | 'no-sap';

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

export default function PurchaseInlineForm({ companyId, subject, onDone }: Props) {
  const [readiness, setReadiness] = useState<Readiness>('loading');
  const [comments, setComments] = useState('');
  const [requiredDate, setRequiredDate] = useState('');
  const [lines, setLines] = useState<Line[]>([{}]);
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  /** Tras el primer intento de envío, los obligatorios vacíos se marcan en rojo. */
  const [tried, setTried] = useState(false);
  const [defaultCurrency, setDefaultCurrency] = useState('');

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
        if (!c?.canWrite) setReadiness('no-write');
        else if (!c.ready) setReadiness('no-sap');
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
  const missingList = lines.flatMap((l, i) =>
    COLUMNS.filter((c) => c.required && isEmpty(l[c.field])).map((c) => `Línea ${i + 1} · ${c.label}`)
  );

  const submit = async () => {
    setTried(true);
    setError(null);
    setFieldErrors([]);
    if (missingList.length > 0) {
      setError('Complete los campos obligatorios marcados en rojo.');
      return;
    }
    setSaving(true);
    try {
      // 1) Borrador en SAP
      const res = await fetch('/api/purchases/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: Number(companyId),
          header: { Comments: comments || subject.toUpperCase(), ...(requiredDate ? { RequriedDate: requiredDate } : {}) },
          // Moneda: la elegida o la de la empresa; «moneda local» viaja vacía (como SAPSEND en Ryan).
          lines: lines.map((l) => {
            const cur = lineCurrency(l);
            return { ...l, Currency: cur === LOCAL ? '' : cur };
          }),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'No se pudo crear la solicitud de compra');
        setFieldErrors(Array.isArray(data.errors) ? data.errors : []);
        return;
      }
      const docEntry = Number(data.docEntry);

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
        }
      }

      // 3) Enviar a autorizar (crea la solicitud del workflow en Mis solicitudes)
      const sent = await fetch('/api/purchases/drafts/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: Number(companyId), docEntry, subject }),
      });
      const sentData = await sent.json().catch(() => ({}));
      if (!sent.ok) {
        onDone({
          ok: false,
          message: `Se creó el borrador #${docEntry}, pero no se pudo enviar a autorizar: ${sentData.error || 'error'}.${attachWarning} Envíelo desde Compras.`,
        });
        return;
      }
      onDone({ ok: !attachWarning, message: `Solicitud de compra #${docEntry} enviada a autorizar.${attachWarning}` });
    } catch {
      setError('Error de red al crear la solicitud de compra');
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
  if (readiness === 'no-sap') {
    return (
      <Alert color="yellow" title="Solicitud de compra">
        Esta empresa no tiene conexión a SAP configurada; no se pueden crear solicitudes de compra.
      </Alert>
    );
  }

  const generalErrors = fieldErrors.filter((e) => !e.field.startsWith('DocumentLines['));
  const showMissing = tried && missingList.length > 0;

  return (
    <Stack gap="md">
      {error && (
        <Alert color="red">
          {error}
          {generalErrors.length > 0 && (
            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
              {generalErrors.map((e) => (
                <li key={e.field}>{e.error}</li>
              ))}
            </ul>
          )}
          {showMissing && (
            <Text size="xs" mt={4}>
              Faltan: {missingList.join(' · ')}
            </Text>
          )}
        </Alert>
      )}

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
        description="Si lo deja vacío se usa el asunto."
        autosize
        minRows={2}
        maxLength={254}
        value={comments}
        onChange={(e) => setComments(e.currentTarget.value.toUpperCase())}
        error={errorFor('Comments')}
      />

      <div>
        <Text fw={600} size="sm" mb={4}>
          Líneas de la solicitud
        </Text>
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
                          onSelect={(opt) =>
                            setLines((prev) =>
                              prev.map((l, j) =>
                                j === i ? { ...l, ...(opt.fill ?? {}), [c.field]: opt.fill?.[c.field] ?? opt.value } : l
                              )
                            )
                          }
                          error={typeof err === 'string' ? err : undefined}
                          ariaLabel={aria}
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
                      onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}
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

      <Group justify="flex-end">
        <Button
          leftSection={<IconSend size={16} />}
          onClick={submit}
          loading={saving}
          disabled={!subject.trim() && !comments.trim()}
        >
          Crear y enviar a autorizar
        </Button>
      </Group>
    </Stack>
  );
}
