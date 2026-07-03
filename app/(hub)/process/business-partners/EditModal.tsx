'use client';

import React, { useState, useEffect } from 'react';
import {
  Modal, Select, TextInput, Textarea, Button, Group, Stack, Alert, SimpleGrid, Badge, Text,
  Divider, Loader, Accordion, Table, Center, Anchor,
} from '@mantine/core';
import {
  GENERAL_FIELDS,
  EDITABLE_ON_UPDATE,
  MANAGED_FIELD_NAMES,
  CARD_TYPES,
  FLAG_YES,
  FLAG_NO,
  FLAG_FIELDS,
  INT_FIELDS,
  CONFIRM_FIELDS,
  ADDRESS_COLUMNS,
  CONTACT_COLUMNS,
  BANK_ACCOUNT_COLUMNS,
  addressTypeLabel,
  cardTypeLabel,
  humanizeCustomField,
  type StandardField,
} from '../../../../lib/business-partners/fields';

export interface Partner {
  companyId: number;
  companyName: string;
  CardCode?: string;
  CardName?: string;
  CardType?: string;
  FederalTaxID?: string;
  Phone1?: string;
  EmailAddress?: string;
  CurrentAccountBalance?: number;
  Currency?: string;
  Valid?: string;
  Frozen?: string;
  [key: string]: unknown;
}

interface Props {
  partner: Partner | null;
  canWrite: boolean;
  onClose: () => void;
  onUpdated: () => void;
}

type FormState = Record<string, string>;

interface CustomField {
  field: string;
  label: string;
}

const FLAG_OPTIONS = [
  { value: FLAG_YES, label: 'Si' },
  { value: FLAG_NO, label: 'No' },
];

/** Nombres de campos del encabezado gestionados (para clasificar el resto como "adicional"). */
const MANAGED_SET = new Set(MANAGED_FIELD_NAMES);

/**
 * Regla de contraste (igual que Articulos): Mantine pinta los campos
 * deshabilitados en gris muy claro. Para los bloqueados forzamos texto legible
 * (ink-2 GSS) sobre fondo gris suave, conservando el indicador de "no editable".
 */
const LOCKED_FIELD_STYLES = {
  input: {
    color: '#38445a',
    opacity: 1,
    WebkitTextFillColor: '#38445a',
    backgroundColor: '#f1f3f5',
  },
} as const;

/** Construye el estado del formulario a partir del socio COMPLETO de SAP. */
function buildForm(item: Record<string, unknown>, customFields: CustomField[]): FormState {
  const form: FormState = {};
  for (const f of GENERAL_FIELDS) {
    const raw = item[f.field];
    form[f.field] = raw == null ? '' : String(raw);
  }
  for (const f of EDITABLE_ON_UPDATE) {
    if (f in form) continue;
    const raw = item[f];
    form[f] = raw == null ? '' : String(raw);
  }
  for (const cf of customFields) {
    const raw = item[cf.field];
    form[cf.field] = raw == null ? '' : String(raw);
  }
  return form;
}

/** Lista de todos los campos U_* poblados del socio. */
function resolveCustomFields(item: Record<string, unknown>): CustomField[] {
  const result: CustomField[] = [];
  for (const [key, raw] of Object.entries(item)) {
    if (!/^U_/.test(key)) continue;
    if (raw == null || String(raw).trim() === '') continue;
    result.push({ field: key, label: humanizeCustomField(key) });
  }
  result.sort((a, b) => a.field.localeCompare(b.field));
  return result;
}

/** Da formato legible a un valor escalar de solo lectura. */
function formatReadValue(raw: unknown): string {
  if (raw == null) return '';
  const value = String(raw);
  if (value === 'tYES') return 'Si';
  if (value === 'tNO') return 'No';
  const isoDate = /^(\d{4}-\d{2}-\d{2})(T.*)?$/.exec(value);
  if (isoDate) return isoDate[1];
  return value;
}

function isEmptyValue(raw: unknown): boolean {
  if (raw == null) return true;
  if (typeof raw === 'string' && raw.trim() === '') return true;
  if (Array.isArray(raw)) return true;
  if (typeof raw === 'object') return true;
  return false;
}

/** Extrae una coleccion hija del objeto SAP como array de objetos. */
function collection(item: Record<string, unknown> | null, key: string): Record<string, unknown>[] {
  if (!item) return [];
  const raw = item[key];
  return Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
}

export default function EditModal({ partner, canWrite, onClose, onUpdated }: Props) {
  const [fullItem, setFullItem] = useState<Record<string, unknown> | null>(null);
  const [form, setForm] = useState<FormState>({});
  const [original, setOriginal] = useState<FormState>({});
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!partner) {
      setFullItem(null);
      setForm({});
      setOriginal({});
      setCustomFields([]);
      setLoadError(null);
      setError(null);
      setSuccess(null);
      return;
    }

    let cancelled = false;
    const cardCode = String(partner.CardCode ?? '');

    const load = async () => {
      setLoading(true);
      setLoadError(null);
      setError(null);
      setSuccess(null);
      try {
        const res = await fetch(
          `/api/business-partners/item?companyId=${partner.companyId}&cardCode=${encodeURIComponent(cardCode)}`
        );
        const data = await res.json();
        if (!res.ok) {
          if (!cancelled) setLoadError(data.error || 'No se pudo cargar el detalle del socio');
          return;
        }
        const item: Record<string, unknown> = data.item ?? {};
        const resolved = resolveCustomFields(item);
        const initial = buildForm(item, resolved);

        if (cancelled) return;
        setFullItem(item);
        setCustomFields(resolved);
        setForm(initial);
        setOriginal(initial);
      } catch {
        if (!cancelled) setLoadError('Error de red al cargar el detalle del socio');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [partner]);

  const set = (field: string, value: string) => setForm((r) => ({ ...r, [field]: value }));

  /** Calcula los cambios (campos editables + U_* que difieren del original). */
  const computeChanges = (): Record<string, string> => {
    const changes: Record<string, string> = {};
    for (const f of EDITABLE_ON_UPDATE) {
      if ((form[f] ?? '') !== (original[f] ?? '')) changes[f] = form[f] ?? '';
    }
    for (const cf of customFields) {
      if ((form[cf.field] ?? '') !== (original[cf.field] ?? '')) changes[cf.field] = form[cf.field] ?? '';
    }
    return changes;
  };

  const submit = async () => {
    if (!partner) return;
    setError(null);
    setSuccess(null);

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
        `Va a cambiar el estado del socio (${labels}). Esto activa o bloquea el ` +
          `socio en SAP y afecta compras, ventas y documentos. ¿Confirma el cambio?`
      );
      if (!ok) return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/business-partners/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: partner.companyId,
          cardCode: partner.CardCode,
          changes,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'No se pudo actualizar el socio de negocio');
        return;
      }
      setSuccess('Socio de negocio actualizado correctamente.');
      // Refresca el listado; deja la confirmacion visible un momento antes de cerrar.
      onUpdated();
      setOriginal((o) => ({ ...o, ...changes }));
      setTimeout(() => {
        onClose();
      }, 1200);
    } catch {
      setError('Error de red al actualizar el socio de negocio');
    } finally {
      setSaving(false);
    }
  };

  /** Renderiza el control adecuado segun el tipo del campo del encabezado. */
  const renderField = (f: StandardField) => {
    const value = form[f.field] ?? '';
    const editable = canWrite && EDITABLE_ON_UPDATE.includes(f.field);
    const disabled = !editable;

    if (f.type === 'currency') {
      // Saldo: siempre solo lectura, formato latino.
      const n = Number(value);
      const shown = value === '' || Number.isNaN(n)
        ? ''
        : n.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return (
        <TextInput key={f.field} label={f.label} value={shown} disabled styles={LOCKED_FIELD_STYLES} />
      );
    }
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
    if (f.type === 'cardType') {
      return (
        <Select
          key={f.field}
          label={f.label}
          data={CARD_TYPES}
          value={value || null}
          onChange={(v) => set(f.field, v ?? '')}
          disabled={disabled}
          styles={disabled ? LOCKED_FIELD_STYLES : undefined}
        />
      );
    }
    if (f.field === 'Notes') {
      return (
        <Textarea
          key={f.field}
          label={f.label}
          value={value}
          onChange={(e) => set(f.field, e.currentTarget.value)}
          disabled={disabled}
          autosize
          minRows={2}
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

  const addresses = collection(fullItem, 'BPAddresses');
  const contacts = collection(fullItem, 'ContactEmployees');
  const bankAccounts = collection(fullItem, 'BPBankAccounts');

  /** Campos escalares poblados que NO se gestionan (ni U_*): solo lectura. */
  const additionalRows: { key: string; value: string }[] = (() => {
    if (!fullItem) return [];
    const rows: { key: string; value: string }[] = [];
    for (const [key, raw] of Object.entries(fullItem)) {
      if (MANAGED_SET.has(key)) continue;
      if (/^U_/.test(key)) continue;
      if (isEmptyValue(raw)) continue;
      rows.push({ key, value: formatReadValue(raw) });
    }
    rows.sort((a, b) => a.key.localeCompare(b.key));
    return rows;
  })();

  /** Renderiza una tabla de solo lectura para una coleccion hija. */
  const renderCollection = (
    rows: Record<string, unknown>[],
    columns: { label: string; field: string }[],
    empty: string,
    transform?: (col: string, raw: unknown) => string
  ) => {
    if (rows.length === 0) {
      return <Text size="xs" c="dimmed">{empty}</Text>;
    }
    return (
      <Table.ScrollContainer minWidth={480}>
        <Table withRowBorders={false} verticalSpacing={4} fz="sm" striped>
          <Table.Thead>
            <Table.Tr>
              {columns.map((c) => (
                <Table.Th key={c.field} style={{ whiteSpace: 'nowrap' }}>{c.label}</Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((row, i) => (
              <Table.Tr key={i}>
                {columns.map((c) => {
                  const raw = row[c.field];
                  const shown = transform ? transform(c.field, raw) : formatReadValue(raw);
                  return (
                    <Table.Td key={c.field} style={{ wordBreak: 'break-word' }}>
                      {shown || '-'}
                    </Table.Td>
                  );
                })}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    );
  };

  return (
    <Modal
      opened={!!partner}
      onClose={onClose}
      title={canWrite ? 'Editar socio de negocio' : 'Detalle del socio de negocio'}
      size="xl"
    >
      {partner && (
        <Stack gap="sm">
          {/* Feedback visible arriba (verde/rojo), igual que el resto de la app. */}
          {success && <Alert color="green">{success}</Alert>}
          {error && <Alert color="red">{error}</Alert>}

          <Group gap="xs">
            <Text size="sm" fw={500}>Empresa:</Text>
            <Badge variant="light">{partner.companyName}</Badge>
            {partner.CardCode && (
              <Badge variant="outline" color="gray">{partner.CardCode}</Badge>
            )}
            {fullItem?.CardType != null && (
              <Badge variant="light" color="blue">{cardTypeLabel(fullItem.CardType)}</Badge>
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
              <Divider label="Generales" labelPosition="left" />
              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                {GENERAL_FIELDS.filter((f) => f.field !== 'Notes').map((f) => renderField(f))}
              </SimpleGrid>
              {renderField(GENERAL_FIELDS.find((f) => f.field === 'Notes') as StandardField)}

              <Divider label={`Direcciones (${addresses.length})`} labelPosition="left" mt="xs" />
              {renderCollection(
                addresses,
                ADDRESS_COLUMNS,
                'Este socio no tiene direcciones registradas.',
                (col, raw) => (col === 'AddressType' ? addressTypeLabel(raw) : formatReadValue(raw))
              )}

              <Divider label={`Contactos (${contacts.length})`} labelPosition="left" mt="xs" />
              {renderCollection(contacts, CONTACT_COLUMNS, 'Este socio no tiene contactos registrados.')}

              <Divider label={`Cuentas bancarias (${bankAccounts.length})`} labelPosition="left" mt="xs" />
              {renderCollection(bankAccounts, BANK_ACCOUNT_COLUMNS, 'Este socio no tiene cuentas bancarias registradas.')}

              <Divider label="Campos personalizados" labelPosition="left" mt="xs" />
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
                  Este socio no tiene campos personalizados con valor.
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
                              <Table.Td style={{ wordBreak: 'break-word' }}>
                                {/^https?:\/\//i.test(row.value) ? (
                                  <Anchor href={row.value} target="_blank" size="sm">{row.value}</Anchor>
                                ) : row.value}
                              </Table.Td>
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
