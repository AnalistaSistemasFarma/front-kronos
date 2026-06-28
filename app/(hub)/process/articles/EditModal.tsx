'use client';

import React, { useState, useEffect } from 'react';
import {
  Modal, Select, TextInput, Button, Group, Stack, Alert, SimpleGrid, Badge, Text, Divider,
} from '@mantine/core';
import {
  STANDARD_FIELDS,
  ITEM_TYPES,
  FLAG_YES,
  FLAG_NO,
  FLAG_FIELDS,
  INT_FIELDS,
  CONFIRM_FIELDS,
  getCompanyCustomFields,
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

const FLAG_OPTIONS = [
  { value: FLAG_YES, label: 'Si' },
  { value: FLAG_NO, label: 'No' },
];

type FormState = Record<string, string>;

function fromArticle(article: Article, customFields: CustomField[]): FormState {
  const form: FormState = {};
  for (const f of STANDARD_FIELDS) {
    const raw = article[f.field];
    form[f.field] = raw == null ? '' : String(raw);
  }
  for (const cf of customFields) {
    const raw = article[cf.field];
    form[cf.field] = raw == null ? '' : String(raw);
  }
  return form;
}

export default function EditModal({ article, canWrite, onClose, onUpdated }: Props) {
  const customFields: CustomField[] = article ? getCompanyCustomFields(article.companyName) : [];

  const [form, setForm] = useState<FormState>({});
  const [original, setOriginal] = useState<FormState>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (article) {
      const initial = fromArticle(article, getCompanyCustomFields(article.companyName));
      setForm(initial);
      setOriginal(initial);
      setError(null);
    }
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
        type={INT_FIELDS.includes(f.field) ? 'number' : undefined}
      />
    );
  };

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
          </Group>

          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            {STANDARD_FIELDS.map((f) => renderStandard(f))}
          </SimpleGrid>

          {customFields.length > 0 && (
            <>
              <Divider label={`Campos especificos de ${article.companyName}`} />
              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                {customFields.map((cf) => (
                  <TextInput
                    key={cf.field}
                    label={cf.label}
                    value={form[cf.field] ?? ''}
                    onChange={(e) => set(cf.field, e.currentTarget.value)}
                    disabled={!canWrite}
                  />
                ))}
              </SimpleGrid>
            </>
          )}

          <Group justify="flex-end" mt="sm">
            <Button variant="default" onClick={onClose} disabled={saving}>
              {canWrite ? 'Cancelar' : 'Cerrar'}
            </Button>
            {canWrite && <Button onClick={submit} loading={saving}>Guardar</Button>}
          </Group>
        </Stack>
      )}
    </Modal>
  );
}
