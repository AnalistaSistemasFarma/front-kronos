'use client';

import React, { useEffect, useState } from 'react';
import {
  ActionIcon, Alert, Button, Group, Loader, Modal, NumberInput, Select, Stack, Table, TextInput, Textarea,
} from '@mantine/core';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import AttachmentsPanel from './AttachmentsPanel';
import SapLookupInput from './SapLookupInput';
import { FIELD_LOOKUP } from '../../../../lib/purchases/lookups';

/**
 * Crear / editar una solicitud de compra (borrador oPurchaseRequest en SAP).
 * Consume /api/purchases/drafts: el servidor resuelve solicitante, departamento
 * y valida contra SAP; aqui solo se captura y se muestran los errores por campo.
 * Campos de linea = los de SAPSEND (ModalCreatePurchaseRequest.jsx:180-199).
 */

export interface WritableCompany {
  idCompany: number;
  companyName: string;
}

/** Borrador a editar (estado B o ENC). */
export interface EditTarget {
  companyId: number;
  docEntry: number;
}

export type LineField =
  | 'ItemCode' | 'ItemDescription' | 'LineVendor' | 'U_NombreProveedor' | 'Quantity' | 'UnitPrice'
  | 'TaxCode' | 'AccountCode' | 'CostingCode' | 'WarehouseCode' | 'ProjectCode' | 'Currency'
  | 'RequiredDate' | 'U_Dest_compra' | 'U_HBT_UndMedida' | 'U_version';

export type Line = Partial<Record<LineField, string | number>>;

/** Columnas del formulario; `required` = obligatorio en el servidor. */
export const COLUMNS: { field: LineField; label: string; width: number; numeric?: boolean; required?: boolean }[] = [
  { field: 'ItemCode', label: 'Articulo', width: 110 },
  { field: 'ItemDescription', label: 'Descripcion', width: 220, required: true },
  { field: 'LineVendor', label: 'Cod. proveedor', width: 120 },
  { field: 'U_NombreProveedor', label: 'Proveedor', width: 180 },
  { field: 'Quantity', label: 'Cantidad', width: 90, numeric: true, required: true },
  { field: 'UnitPrice', label: 'Precio', width: 110, numeric: true },
  { field: 'Currency', label: 'Moneda', width: 70 },
  { field: 'TaxCode', label: 'IVA', width: 90, required: true },
  { field: 'AccountCode', label: 'Cuenta', width: 110, required: true },
  { field: 'CostingCode', label: 'Norma reparto', width: 110, required: true },
  { field: 'WarehouseCode', label: 'Bodega', width: 90 },
  { field: 'ProjectCode', label: 'Proyecto', width: 90 },
  { field: 'RequiredDate', label: 'Fecha req.', width: 120 },
  { field: 'U_Dest_compra', label: 'Destino', width: 140 },
  { field: 'U_HBT_UndMedida', label: 'Und. medida', width: 100 },
  { field: 'U_version', label: 'Version', width: 80 },
];

export interface FieldError {
  field: string;
  error: string;
}

interface Props {
  opened: boolean;
  onClose: () => void;
  /** `warning`: el borrador se creo pero algo posterior fallo (se muestra en el listado). */
  onSaved: (warning?: string) => void;
  companies: WritableCompany[];
  /** null = crear; con valor = editar ese borrador. */
  edit: EditTarget | null;
  /**
   * Crear copiando cabecera y lineas de otro borrador (boton «Duplicar» de
   * SAPSEND, ModalCreatePurchaseRequest.jsx:175-213): sin adjuntos y con la
   * fecha requerida reiniciada. Solo aplica si `edit` es null.
   */
  duplicate?: EditTarget | null;
  /** Empresa preseleccionada al crear (p. ej. al llegar desde «Mis solicitudes»). */
  initialCompanyId?: number | null;
  /**
   * Al crear, enviar de una vez a autorizar (flujo desde «Mis solicitudes»: el
   * usuario monta la solicitud y pasa a autorizacion en un solo paso).
   */
  sendOnCreate?: boolean;
}

/** Proyecta una linea del Draft de SAP a los campos del formulario. */
function toFormLine(l: Record<string, unknown>): Line {
  const line: Line = {};
  for (const c of COLUMNS) {
    const v = l[c.field];
    if (v === null || v === undefined || v === '') continue;
    line[c.field] = c.field === 'RequiredDate' ? String(v).slice(0, 10) : (v as string | number);
  }
  return line;
}

export default function RequestFormModal({
  opened,
  onClose,
  onSaved,
  companies,
  edit,
  duplicate = null,
  initialCompanyId = null,
  sendOnCreate = false,
}: Props) {
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [comments, setComments] = useState('');
  const [requiredDate, setRequiredDate] = useState('');
  const [lines, setLines] = useState<Line[]>([{}]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);

  // Reinicia el formulario al abrir; en edicion carga el borrador completo.
  useEffect(() => {
    if (!opened) return;
    setError(null);
    setFieldErrors([]);
    const source = edit ?? duplicate;
    if (!source) {
      setCompanyId(
        initialCompanyId ? String(initialCompanyId) : companies.length === 1 ? String(companies[0].idCompany) : null
      );
      setComments('');
      setRequiredDate('');
      setLines([{}]);
      return;
    }
    const isDuplicate = !edit;
    let cancelled = false;
    setLoading(true);
    setCompanyId(String(source.companyId));
    fetch(`/api/purchases/item?companyId=${source.companyId}&docEntry=${source.docEntry}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'No se pudo cargar la solicitud');
        if (cancelled) return;
        const item = data.item ?? {};
        setComments(String(item.Comments ?? ''));
        setRequiredDate(isDuplicate ? '' : String(item.RequriedDate ?? '').slice(0, 10));
        const docLines: Record<string, unknown>[] = Array.isArray(item.DocumentLines) ? item.DocumentLines : [];
        const formLines = docLines.map(toFormLine).map((l) => {
          if (isDuplicate) delete l.RequiredDate; // SAPSEND reinicia la fecha al duplicar
          return l;
        });
        setLines(formLines.length > 0 ? formLines : [{}]);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [opened, edit, duplicate, companies, initialCompanyId]);

  const setLineValue = (index: number, field: LineField, value: string | number) => {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, [field]: value } : l)));
  };

  const errorFor = (field: string) => fieldErrors.find((e) => e.field === field)?.error;

  const save = async () => {
    if (!companyId) {
      setError('Seleccione la empresa.');
      return;
    }
    setSaving(true);
    setError(null);
    setFieldErrors([]);
    try {
      const res = await fetch('/api/purchases/drafts', {
        method: edit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: Number(companyId),
          ...(edit ? { docEntry: edit.docEntry } : {}),
          header: { Comments: comments, ...(requiredDate ? { RequriedDate: requiredDate } : {}) },
          lines,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'No se pudo guardar la solicitud');
        setFieldErrors(Array.isArray(data.errors) ? data.errors : []);
        return;
      }
      if (!edit && sendOnCreate && data.docEntry) {
        const sent = await fetch('/api/purchases/drafts/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ companyId: Number(companyId), docEntry: data.docEntry }),
        });
        const sentData = await sent.json().catch(() => ({}));
        if (!sent.ok) {
          // El borrador SI quedo creado: se cierra (para no crear otro con un segundo clic)
          // y se avisa en el listado, desde donde se puede reenviar.
          onSaved(
            `Se creo el borrador #${data.docEntry}, pero no se pudo enviar a autorizar: ${sentData.error || 'error'}. Envielo desde el listado.`
          );
          onClose();
          return;
        }
      }
      onSaved();
      onClose();
    } catch {
      setError('Error de red al guardar la solicitud');
    } finally {
      setSaving(false);
    }
  };

  const generalErrors = fieldErrors.filter((e) => !e.field.startsWith('DocumentLines['));

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        edit
          ? `Editar solicitud · Borrador #${edit.docEntry}`
          : duplicate
            ? `Nueva solicitud (copia del borrador #${duplicate.docEntry})`
            : 'Nueva solicitud de compra'
      }
      size="95%"
    >
      {loading ? (
        <Group justify="center" p="xl">
          <Loader />
        </Group>
      ) : (
        <Stack>
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
            <Select
              label="Empresa"
              data={companies.map((c) => ({ value: String(c.idCompany), label: c.companyName }))}
              value={companyId}
              onChange={setCompanyId}
              disabled={Boolean(edit)}
              allowDeselect={false}
              required
            />
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
            required
            autosize
            minRows={2}
            maxLength={254}
            value={comments}
            onChange={(e) => setComments(e.currentTarget.value.toUpperCase())}
            error={errorFor('Comments')}
          />

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
                              aria-label={`${c.label} linea ${i + 1}`}
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
                                aria-label={`${c.label} linea ${i + 1}`}
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
                        aria-label={`Quitar linea ${i + 1}`}
                      >
                        <IconTrash size={14} />
                      </ActionIcon>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>

          {edit ? (
            <AttachmentsPanel companyId={edit.companyId} docEntry={edit.docEntry} canUpload />
          ) : (
            <Alert color="blue" variant="light">
              Los adjuntos (cotizaciones y anexos) se agregan despues de crear el borrador, desde Editar.
            </Alert>
          )}

          <Group justify="space-between">
            <Button variant="light" leftSection={<IconPlus size={14} />} onClick={() => setLines((prev) => [...prev, {}])}>
              Agregar linea
            </Button>
            <Group>
              <Button variant="default" onClick={onClose}>
                Cancelar
              </Button>
              <Button onClick={save} loading={saving} disabled={!comments.trim()}>
                {edit ? 'Guardar cambios' : sendOnCreate ? 'Crear y enviar a autorizar' : 'Crear borrador'}
              </Button>
            </Group>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}
