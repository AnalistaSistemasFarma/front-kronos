'use client';

import React, { useState, useEffect } from 'react';
import {
  Modal, Select, TextInput, Button, Group, Stack, Alert, SimpleGrid, Badge, Text,
  Divider, Loader, Accordion, Table, Center,
} from '@mantine/core';
import {
  STANDARD_FIELDS,
  STANDARD_FIELD_NAMES,
  ITEM_TYPES,
  FLAG_YES,
  FLAG_NO,
  FLAG_FIELDS,
  INT_FIELDS,
  CONFIRM_FIELDS,
  getCompanyCustomFields,
  humanizeCustomField,
  type CustomField,
} from '../../../../lib/articles/fields';

export interface Article {
  companyId: number;
  companyName: string;
  ItemCode?: string;
  ItemName?: string;
  ItemsGroupCode?: number;
  ItemType?: string;
  SalesItem?: string;
  PurchaseItem?: string;
  InventoryItem?: string;
  Valid?: string;
  Frozen?: string;
  [key: string]: unknown;
}

interface Props {
  article: Article | null;
  canWrite: boolean;
  onClose: () => void;
  onUpdated: () => void;
}

interface ItemGroup {
  number: number;
  name: string;
}

const FLAG_OPTIONS = [
  { value: FLAG_YES, label: 'Si' },
  { value: FLAG_NO, label: 'No' },
];

type FormState = Record<string, string>;

/** Nombres de campos estandar gestionados (para clasificar el resto como "adicional"). */
const STANDARD_SET = new Set(STANDARD_FIELD_NAMES);

/** Construye el estado del formulario a partir del item COMPLETO de SAP. */
function buildForm(
  item: Record<string, unknown>,
  customFields: CustomField[]
): FormState {
  const form: FormState = {};
  for (const f of STANDARD_FIELDS) {
    const raw = item[f.field];
    form[f.field] = raw == null ? '' : String(raw);
  }
  // Campos custom del mapa curado.
  for (const cf of customFields) {
    const raw = item[cf.field];
    form[cf.field] = raw == null ? '' : String(raw);
  }
  // Cualquier OTRO campo U_* poblado que no este en el mapa.
  for (const [key, raw] of Object.entries(item)) {
    if (!/^U_/.test(key)) continue;
    if (raw == null) continue;
    if (key in form) continue;
    form[key] = String(raw);
  }
  return form;
}

/** Lista de todos los campos U_* poblados del item (mapa + extras). */
function resolveCustomFields(
  item: Record<string, unknown>,
  mapped: CustomField[]
): CustomField[] {
  const result: CustomField[] = [];
  const seen = new Set<string>();
  for (const cf of mapped) {
    // Solo se muestran los del mapa que tienen valor en el item.
    if (item[cf.field] != null && String(item[cf.field]).trim() !== '') {
      result.push(cf);
      seen.add(cf.field);
    }
  }
  for (const [key, raw] of Object.entries(item)) {
    if (!/^U_/.test(key)) continue;
    if (seen.has(key)) continue;
    if (raw == null || String(raw).trim() === '') continue;
    result.push({ field: key, label: humanizeCustomField(key) });
    seen.add(key);
  }
  return result;
}

/** Da formato legible a un valor escalar de un campo estandar de solo lectura. */
function formatReadValue(key: string, raw: unknown): string {
  if (raw == null) return '';
  const value = String(raw);

  // Banderas tYES/tNO.
  if (value === 'tYES') return 'Si';
  if (value === 'tNO') return 'No';

  // Enum de tipo de articulo.
  const itemType = ITEM_TYPES.find((t) => t.value === value);
  if (itemType) return itemType.label;

  // Fechas ISO -> YYYY-MM-DD.
  const isoDate = /^(\d{4}-\d{2}-\d{2})(T.*)?$/.exec(value);
  if (isoDate) return isoDate[1];

  return value;
}

/** ¿El valor es "vacio" para efectos de mostrarlo en lectura? */
function isEmptyValue(raw: unknown): boolean {
  if (raw == null) return true;
  if (typeof raw === 'string' && raw.trim() === '') return true;
  if (Array.isArray(raw)) return true;
  if (typeof raw === 'object') return true;
  return false;
}

/**
 * Regla de contraste: Mantine pinta los campos deshabilitados en gris muy claro
 * (baja legibilidad). Para los campos bloqueados (no editables) forzamos un color
 * de texto legible (ink-2 GSS #38445a) sobre fondo gris suave, conservando el
 * indicador visual de "no editable" pero cumpliendo el contraste minimo.
 */
const LOCKED_FIELD_STYLES = {
  input: {
    color: '#38445a',
    opacity: 1,
    WebkitTextFillColor: '#38445a',
    backgroundColor: '#f1f3f5',
  },
} as const;

export default function EditModal({ article, canWrite, onClose, onUpdated }: Props) {
  const [fullItem, setFullItem] = useState<Record<string, unknown> | null>(null);
  const [form, setForm] = useState<FormState>({});
  const [original, setOriginal] = useState<FormState>({});
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [groups, setGroups] = useState<ItemGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!article) {
      setFullItem(null);
      setForm({});
      setOriginal({});
      setCustomFields([]);
      setGroups([]);
      setLoadError(null);
      setError(null);
      return;
    }

    let cancelled = false;
    const itemCode = String(article.ItemCode ?? '');

    const load = async () => {
      setLoading(true);
      setLoadError(null);
      setError(null);
      try {
        const [itemRes, groupsRes] = await Promise.all([
          fetch(
            `/api/articles/item?companyId=${article.companyId}&itemCode=${encodeURIComponent(itemCode)}`
          ),
          fetch(`/api/articles/item-groups?companyId=${article.companyId}`),
        ]);

        const itemData = await itemRes.json();
        if (!itemRes.ok) {
          if (!cancelled) setLoadError(itemData.error || 'No se pudo cargar el detalle del articulo');
          return;
        }
        const item: Record<string, unknown> = itemData.item ?? {};

        const groupsData = await groupsRes.json().catch(() => ({}));
        const loadedGroups: ItemGroup[] = groupsRes.ok ? (groupsData.groups ?? []) : [];

        const mapped = getCompanyCustomFields(article.companyName);
        const resolved = resolveCustomFields(item, mapped);
        const initial = buildForm(item, resolved);

        if (cancelled) return;
        setFullItem(item);
        setCustomFields(resolved);
        setGroups(loadedGroups);
        setForm(initial);
        setOriginal(initial);
      } catch {
        if (!cancelled) setLoadError('Error de red al cargar el detalle del articulo');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [article]);

  const set = (field: string, value: string) => setForm((r) => ({ ...r, [field]: value }));

  /** Calcula los cambios (campos editables que difieren del original). */
  const computeChanges = (): Record<string, string> => {
    const changes: Record<string, string> = {};
    const editableNames = STANDARD_FIELDS.filter((f) => f.editable).map((f) => f.field);
    const allFields = [...editableNames, ...customFields.map((c) => c.field)];
    for (const f of allFields) {
      if ((form[f] ?? '') !== (original[f] ?? '')) changes[f] = form[f] ?? '';
    }
    return changes;
  };

  const submit = async () => {
    if (!article) return;
    setError(null);

    const changes = computeChanges();
    if (Object.keys(changes).length === 0) {
      setError('No hay cambios para guardar.');
      return;
    }

    // Confirmacion explicita si se cambia Valid/Frozen (activar/inactivar).
    const confirmChanged = CONFIRM_FIELDS.filter((f) => f in changes);
    if (confirmChanged.length > 0) {
      const labels = confirmChanged
        .map((f) => `${f} = ${changes[f] === FLAG_YES ? 'Si' : 'No'}`)
        .join(', ');
      const ok = window.confirm(
        `Va a cambiar el estado del articulo (${labels}). Esto activa o inactiva el ` +
          `articulo en SAP y afecta compras, ventas e inventario. ¿Confirma el cambio?`
      );
      if (!ok) return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/articles/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: article.companyId,
          itemCode: article.ItemCode,
          changes,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'No se pudo actualizar el articulo');
        return;
      }
      onUpdated();
      onClose();
    } catch {
      setError('Error de red al actualizar el articulo');
    } finally {
      setSaving(false);
    }
  };

  /** Renderiza el control adecuado segun el tipo del campo estandar. */
  const renderStandard = (f: (typeof STANDARD_FIELDS)[number]) => {
    const value = form[f.field] ?? '';
    const disabled = !canWrite || !f.editable;

    if (FLAG_FIELDS.includes(f.field)) {
      return (
        <Select
          key={f.field}
          label={f.label}
          data={FLAG_OPTIONS}
          value={value || FLAG_NO}
          onChange={(v) => set(f.field, v ?? FLAG_NO)}
          disabled={disabled}
          styles={disabled ? LOCKED_FIELD_STYLES : undefined}
        />
      );
    }
    if (f.type === 'itemType') {
      return (
        <Select
          key={f.field}
          label={f.label}
          data={ITEM_TYPES}
          value={value || 'itItems'}
          onChange={(v) => set(f.field, v ?? 'itItems')}
          disabled={disabled}
          styles={disabled ? LOCKED_FIELD_STYLES : undefined}
        />
      );
    }
    if (f.field === 'ItemsGroupCode' && groups.length > 0) {
      return (
        <Select
          key={f.field}
          label={f.label}
          data={groups.map((g) => ({ value: String(g.number), label: `${g.name} (${g.number})` }))}
          value={value || null}
          onChange={(v) => set(f.field, v ?? '')}
          searchable
          disabled={disabled}
          styles={disabled ? LOCKED_FIELD_STYLES : undefined}
        />
      );
    }
    return (
      <TextInput
        key={f.field}
        label={f.label}
        value={value}
        onChange={(e) => set(f.field, e.currentTarget.value)}
        disabled={disabled}
        styles={disabled ? LOCKED_FIELD_STYLES : undefined}
        type={INT_FIELDS.includes(f.field) ? 'number' : undefined}
      />
    );
  };

  /** Campos estandar poblados que NO se gestionan (ni editables ni U_*): solo lectura. */
  const additionalRows: { key: string; value: string }[] = (() => {
    if (!fullItem) return [];
    const rows: { key: string; value: string }[] = [];
    for (const [key, raw] of Object.entries(fullItem)) {
      if (STANDARD_SET.has(key)) continue; // ya se muestra arriba
      if (/^U_/.test(key)) continue; // van en "Campos personalizados"
      if (isEmptyValue(raw)) continue; // vacios, arrays, objetos, colecciones
      rows.push({ key, value: formatReadValue(key, raw) });
    }
    rows.sort((a, b) => a.key.localeCompare(b.key));
    return rows;
  })();

  return (
    <Modal
      opened={!!article}
      onClose={onClose}
      title={canWrite ? 'Editar articulo' : 'Detalle del articulo'}
      size="lg"
    >
      {article && (
        <Stack gap="sm">
          {error && <Alert color="red">{error}</Alert>}

          <Group gap="xs">
            <Text size="sm" fw={500}>Empresa:</Text>
            <Badge variant="light">{article.companyName}</Badge>
            {article.ItemCode && (
              <Badge variant="outline" color="gray">{article.ItemCode}</Badge>
            )}
          </Group>

          {loading && (
            <Center py="lg">
              <Loader />
            </Center>
          )}

          {!loading && loadError && <Alert color="red">{loadError}</Alert>}

          {!loading && !loadError && fullItem && (
            <>
              <Divider label="Datos del articulo" labelPosition="left" />
              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                {STANDARD_FIELDS.map((f) => renderStandard(f))}
              </SimpleGrid>

              <Divider label="Campos personalizados" labelPosition="left" />
              {customFields.length > 0 ? (
                <SimpleGrid cols={{ base: 1, sm: 2 }}>
                  {customFields.map((cf) => (
                    <TextInput
                      key={cf.field}
                      label={cf.label}
                      value={form[cf.field] ?? ''}
                      onChange={(e) => set(cf.field, e.currentTarget.value)}
                      disabled={!canWrite}
                      styles={!canWrite ? LOCKED_FIELD_STYLES : undefined}
                    />
                  ))}
                </SimpleGrid>
              ) : (
                <Text size="xs" c="dimmed">
                  Este articulo no tiene campos personalizados con valor.
                </Text>
              )}

              {additionalRows.length > 0 && (
                <Accordion variant="contained" mt="xs">
                  <Accordion.Item value="additional">
                    <Accordion.Control>
                      Informacion adicional ({additionalRows.length} campos)
                    </Accordion.Control>
                    <Accordion.Panel>
                      <Table withRowBorders={false} verticalSpacing={4} fz="sm">
                        <Table.Tbody>
                          {additionalRows.map((row) => (
                            <Table.Tr key={row.key}>
                              <Table.Td style={{ color: '#666', whiteSpace: 'nowrap', verticalAlign: 'top' }}>
                                {row.key}
                              </Table.Td>
                              <Table.Td style={{ wordBreak: 'break-word' }}>{row.value}</Table.Td>
                            </Table.Tr>
                          ))}
                        </Table.Tbody>
                      </Table>
                    </Accordion.Panel>
                  </Accordion.Item>
                </Accordion>
              )}
            </>
          )}

          <Group justify="flex-end" mt="sm">
            <Button variant="default" onClick={onClose} disabled={saving}>
              {canWrite ? 'Cancelar' : 'Cerrar'}
            </Button>
            {canWrite && !loadError && (
              <Button onClick={submit} loading={saving} disabled={loading}>
                Guardar
              </Button>
            )}
          </Group>
        </Stack>
      )}
    </Modal>
  );
}
