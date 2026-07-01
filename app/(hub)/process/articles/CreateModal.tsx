'use client';

import React, { useState, useEffect } from 'react';
import {
  Modal, Select, TextInput, Button, Group, Stack, Alert, SimpleGrid, Divider, Text,
} from '@mantine/core';
import {
  ITEM_TYPES,
  FLAG_YES,
  FLAG_NO,
  getCompanyCustomFields,
  type CustomField,
} from '../../../../lib/articles/fields';

interface WritableCompany {
  idCompany: number;
  companyName: string;
}

interface Props {
  opened: boolean;
  onClose: () => void;
  companies: WritableCompany[];
  onCreated: () => void;
}

interface ItemGroup {
  number: number;
  name: string;
}

const FLAG_OPTIONS = [
  { value: FLAG_YES, label: 'Si' },
  { value: FLAG_NO, label: 'No' },
];

/** Estado base de los campos estandar de creacion. */
function emptyStandard(): Record<string, string> {
  return {
    ItemCode: '',
    ItemName: '',
    ItemsGroupCode: '',
    ForeignName: '',
    ItemType: 'itItems',
    BarCode: '',
    SalesItem: FLAG_YES,
    PurchaseItem: FLAG_YES,
    InventoryItem: FLAG_YES,
    Mainsupplier: '',
    SalesUnit: '',
    PurchaseUnit: '',
    InventoryUOM: '',
  };
}

export default function CreateModal({ opened, onClose, companies, onCreated }: Props) {
  const [companyId, setCompanyId] = useState<string | null>(
    companies[0] ? String(companies[0].idCompany) : null
  );
  const [std, setStd] = useState<Record<string, string>>(emptyStandard());
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [groups, setGroups] = useState<ItemGroup[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const companyName = companies.find((c) => String(c.idCompany) === companyId)?.companyName ?? '';
  const customFields: CustomField[] = companyName ? getCompanyCustomFields(companyName) : [];

  // Al cambiar de empresa: recargar grupos y reiniciar los custom.
  useEffect(() => {
    if (!opened || !companyId) return;
    setCustom({});
    setStd((s) => ({ ...s, ItemsGroupCode: '' }));
    loadGroups(companyId);
  }, [companyId, opened]);

  const loadGroups = async (cid: string) => {
    setLoadingGroups(true);
    try {
      const res = await fetch(`/api/articles/item-groups?companyId=${cid}`);
      const data = await res.json();
      setGroups(res.ok ? (data.groups ?? []) : []);
    } catch {
      setGroups([]);
    } finally {
      setLoadingGroups(false);
    }
  };

  const setS = (field: string, value: string) => setStd((r) => ({ ...r, [field]: value }));
  const setC = (field: string, value: string) => setCustom((r) => ({ ...r, [field]: value }));

  const reset = () => {
    setStd(emptyStandard());
    setCustom({});
    setError(null);
  };

  const submit = async () => {
    setError(null);
    if (!companyId) return setError('Seleccione una empresa');
    if (!std.ItemCode.trim()) return setError('El codigo (ItemCode) es obligatorio');
    if (!std.ItemName.trim()) return setError('La descripcion (ItemName) es obligatoria');
    if (!std.ItemsGroupCode) return setError('El grupo de articulos es obligatorio');

    const item: Record<string, string> = { ...std, ...custom };

    setSaving(true);
    try {
      const res = await fetch('/api/articles/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: Number(companyId), item }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'No se pudo crear el articulo');
        return;
      }
      reset();
      onCreated();
      onClose();
    } catch {
      setError('Error de red al crear el articulo');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title="Crear articulo" size="lg">
      <Stack gap="sm">
        {error && <Alert color="red">{error}</Alert>}

        <Select
          label="Empresa"
          required
          data={companies.map((c) => ({ value: String(c.idCompany), label: c.companyName }))}
          value={companyId}
          onChange={setCompanyId}
          allowDeselect={false}
        />

        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <TextInput label="Codigo (ItemCode)" required value={std.ItemCode} onChange={(e) => setS('ItemCode', e.currentTarget.value)} />
          <TextInput label="Descripcion" required value={std.ItemName} onChange={(e) => setS('ItemName', e.currentTarget.value)} />
          <Select
            label="Grupo de articulos"
            required
            placeholder={loadingGroups ? 'Cargando...' : 'Seleccione un grupo'}
            data={groups.map((g) => ({ value: String(g.number), label: `${g.name} (${g.number})` }))}
            value={std.ItemsGroupCode || null}
            onChange={(v) => setS('ItemsGroupCode', v ?? '')}
            searchable
            disabled={loadingGroups}
          />
          <Select label="Tipo de articulo" data={ITEM_TYPES} value={std.ItemType} onChange={(v) => setS('ItemType', v ?? 'itItems')} />
          <TextInput label="Nombre extranjero" value={std.ForeignName} onChange={(e) => setS('ForeignName', e.currentTarget.value)} />
          <TextInput label="Codigo de barras / GTIN" value={std.BarCode} onChange={(e) => setS('BarCode', e.currentTarget.value)} />
          <Select label="Es de ventas" data={FLAG_OPTIONS} value={std.SalesItem} onChange={(v) => setS('SalesItem', v ?? FLAG_NO)} />
          <Select label="Es de compras" data={FLAG_OPTIONS} value={std.PurchaseItem} onChange={(v) => setS('PurchaseItem', v ?? FLAG_NO)} />
          <Select label="Es de inventario" data={FLAG_OPTIONS} value={std.InventoryItem} onChange={(v) => setS('InventoryItem', v ?? FLAG_NO)} />
          <TextInput label="Proveedor principal (CardCode)" value={std.Mainsupplier} onChange={(e) => setS('Mainsupplier', e.currentTarget.value)} />
          <TextInput label="Unidad de venta" value={std.SalesUnit} onChange={(e) => setS('SalesUnit', e.currentTarget.value)} />
          <TextInput label="Unidad de compra" value={std.PurchaseUnit} onChange={(e) => setS('PurchaseUnit', e.currentTarget.value)} />
          <TextInput label="Unidad de inventario" value={std.InventoryUOM} onChange={(e) => setS('InventoryUOM', e.currentTarget.value)} />
        </SimpleGrid>

        {customFields.length > 0 && (
          <>
            <Divider label={`Campos especificos de ${companyName}`} />
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              {customFields.map((cf) => (
                <TextInput
                  key={cf.field}
                  label={cf.label}
                  value={custom[cf.field] ?? ''}
                  onChange={(e) => setC(cf.field, e.currentTarget.value)}
                />
              ))}
            </SimpleGrid>
          </>
        )}

        {companyName && customFields.length === 0 && (
          <Text size="xs" c="dimmed">
            Esta empresa no tiene campos especificos configurados; solo se crearan los campos estandar.
          </Text>
        )}

        <Group justify="flex-end" mt="sm">
          <Button variant="default" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={submit} loading={saving}>Crear</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
