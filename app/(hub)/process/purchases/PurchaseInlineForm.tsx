'use client';

import React, { useEffect, useState } from 'react';
import { ActionIcon, Alert, Button, FileInput, Group, Loader, NumberInput, Stack, Table, Text, TextInput, Textarea } from '@mantine/core';
import { IconPaperclip, IconPlus, IconSend, IconTrash } from '@tabler/icons-react';
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

export default function PurchaseInlineForm({ companyId, subject, onDone }: Props) {
  const [readiness, setReadiness] = useState<Readiness>('loading');
  const [comments, setComments] = useState('');
  const [requiredDate, setRequiredDate] = useState('');
  const [lines, setLines] = useState<Line[]>([{}]);
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);

  // ¿El usuario puede crear solicitudes de compra en esta empresa?
  useEffect(() => {
    let cancelled = false;
    setReadiness('loading');
    fetch('/api/purchases/access')
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const c = (d.companies ?? []).find((x: { idCompany: number }) => String(x.idCompany) === companyId);
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

  const submit = async () => {
    setSaving(true);
    setError(null);
    setFieldErrors([]);
    try {
      // 1) Borrador en SAP
      const res = await fetch('/api/purchases/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: Number(companyId),
          header: { Comments: comments || subject.toUpperCase(), ...(requiredDate ? { RequriedDate: requiredDate } : {}) },
          lines,
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
        <Table.ScrollContainer minWidth={1900}>
          <Table withTableBorder verticalSpacing={4}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th style={{ width: 36 }}>#</Table.Th>
                {COLUMNS.map((c) => (
                  <Table.Th key={c.field} style={{ minWidth: c.width }}>
                    {c.label}
                    {c.required ? ' *' : ''}
                  </Table.Th>
                ))}
                <Table.Th style={{ width: 40 }} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {lines.map((line, i) => (
                <Table.Tr key={i}>
                  <Table.Td>{i + 1}</Table.Td>
                  {COLUMNS.map((c) => {
                    const err = errorFor(`DocumentLines[${i}].${c.field}`);
                    return (
                      <Table.Td key={c.field}>
                        {c.numeric ? (
                          <NumberInput
                            size="xs"
                            min={0}
                            allowNegative={false}
                            thousandSeparator="."
                            decimalSeparator=","
                            value={line[c.field] ?? ''}
                            onChange={(v) => setLineValue(i, c.field, v)}
                            error={err}
                            aria-label={`${c.label} línea ${i + 1}`}
                          />
                        ) : (
                          FIELD_LOOKUP[c.field] ? (
                            <SapLookupInput
                              companyId={companyId}
                              kind={FIELD_LOOKUP[c.field]!}
                              value={String(line[c.field] ?? '')}
                              onChange={(v) => setLineValue(i, c.field, v)}
                              onSelect={(opt) =>
                                setLines((prev) =>
                                  prev.map((l, j) => (j === i ? { ...l, ...(opt.fill ?? {}), [c.field]: opt.fill?.[c.field] ?? opt.value } : l))
                                )
                              }
                              error={err}
                              ariaLabel={`${c.label} línea ${i + 1}`}
                            />
                          ) : (
                            <TextInput
                              size="xs"
                              type={c.field === 'RequiredDate' ? 'date' : 'text'}
                              value={String(line[c.field] ?? '')}
                              onChange={(e) => {
                                const v = e.currentTarget.value;
                                setLineValue(i, c.field, c.field === 'ItemDescription' ? v.toUpperCase() : v);
                              }}
                              error={err}
                              aria-label={`${c.label} línea ${i + 1}`}
                            />
                          )
                        )}
                      </Table.Td>
                    );
                  })}
                  <Table.Td>
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      size="sm"
                      disabled={lines.length === 1}
                      onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}
                      aria-label={`Quitar línea ${i + 1}`}
                    >
                      <IconTrash size={14} />
                    </ActionIcon>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
        <Button
          mt="xs"
          variant="light"
          size="xs"
          leftSection={<IconPlus size={14} />}
          onClick={() => setLines((prev) => [...prev, {}])}
        >
          Agregar línea
        </Button>
      </div>

      <FileInput
        multiple
        label="Cotizaciones y anexos"
        placeholder="PDF, JPG o PNG (máx. 10 MB c/u)"
        accept=".pdf,.jpg,.jpeg,.png"
        leftSection={<IconPaperclip size={16} />}
        value={files}
        onChange={setFiles}
        clearable
      />

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
