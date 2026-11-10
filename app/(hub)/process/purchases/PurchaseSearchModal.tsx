'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Alert, Button, Group, Loader, Modal, ScrollArea, Table, Text, TextInput } from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';
import type { LookupKind, LookupOption } from '../../../../lib/purchases/lookups';

/**
 * Lupa de los campos que consultan SAP en la solicitud de compra (como la de Ventas):
 * tabla con más información, búsqueda vacía = todos, «Cargar más» de 50 en 50,
 * flechas + Enter o clic para elegir. Al elegir aplica la misma opción que el autocompletar.
 */

type Row = Record<string, unknown> & { option: LookupOption };
type Col = { key: string; label: string; align?: 'right'; render?: (r: Row) => React.ReactNode };

const num = (v: unknown) => (v == null || v === '' ? '' : Number(v).toLocaleString('es-CO', { maximumFractionDigits: 2 }));

const COLUMNS: Record<LookupKind, Col[]> = {
  item: [
    { key: 'ItemCode', label: 'Código' },
    { key: 'ItemName', label: 'Descripción' },
    { key: 'PurchaseUnit', label: 'Unidad de compra' },
    { key: 'DefaultWarehouse', label: 'Bodega por defecto' },
    { key: 'QuantityOnStock', label: 'En stock', align: 'right', render: (r) => num(r.QuantityOnStock) },
  ],
  vendor: [
    { key: 'CardCode', label: 'Código' },
    { key: 'CardName', label: 'Proveedor' },
    { key: 'FederalTaxID', label: 'NIT' },
    { key: 'City', label: 'Ciudad' },
    { key: 'Phone1', label: 'Teléfono' },
    { key: 'EmailAddress', label: 'Correo' },
    { key: 'CurrentAccountBalance', label: 'Saldo', align: 'right', render: (r) => num(r.CurrentAccountBalance) },
  ],
  account: [
    { key: 'Code', label: 'Cuenta' },
    { key: 'Name', label: 'Nombre' },
    { key: 'AccountLevel', label: 'Nivel', align: 'right' },
  ],
  tax: [
    { key: 'Code', label: 'Código' },
    { key: 'Name', label: 'Indicador de IVA' },
    { key: 'Rate', label: 'Tasa %', align: 'right', render: (r) => num(r.Rate) },
  ],
  costing: [
    { key: 'FactorCode', label: 'Código' },
    { key: 'FactorDescription', label: 'Norma de reparto' },
    { key: 'InWhichDimension', label: 'Dimensión', align: 'right' },
  ],
  warehouse: [
    { key: 'WarehouseCode', label: 'Código' },
    { key: 'WarehouseName', label: 'Bodega' },
  ],
};

export const SEARCH_TITLES: Record<LookupKind, string> = {
  item: 'Buscar artículo en SAP',
  vendor: 'Buscar proveedor en SAP',
  account: 'Buscar cuenta de mayor en SAP',
  tax: 'Buscar indicador de IVA en SAP',
  costing: 'Buscar norma de reparto en SAP',
  warehouse: 'Buscar bodega en SAP',
};

interface Props {
  opened: boolean;
  onClose: () => void;
  companyId: string | number;
  kind: LookupKind;
  initialQuery?: string;
  onSelect: (option: LookupOption) => void;
}

export default function PurchaseSearchModal({ opened, onClose, companyId, kind, initialQuery = '', onSelect }: Props) {
  const [q, setQ] = useState(initialQuery);
  const [rows, setRows] = useState<Row[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const reqId = useRef(0);
  const first = useRef(true);

  const load = async (query: string, pg: number, append: boolean) => {
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ companyId: String(companyId), kind, q: query, page: String(pg) });
      const r = await fetch(`/api/purchases/search?${params}`, { cache: 'no-store' });
      const d = await r.json().catch(() => ({}));
      if (id !== reqId.current) return;
      if (!r.ok) throw new Error(d.error || 'No se pudo consultar SAP');
      setRows((prev) => (append ? [...prev, ...(d.rows ?? [])] : d.rows ?? []));
      setHasMore(Boolean(d.hasMore));
      setPage(pg);
      if (!append) setActive(0);
    } catch (e) {
      if (id === reqId.current) setError((e as Error).message);
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (!opened) return;
    first.current = true;
    setQ(initialQuery);
    void load(initialQuery, 0, false);
  }, [opened, kind]);

  useEffect(() => {
    if (!opened) return;
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => void load(q, 0, false), 350);
    return () => clearTimeout(t);
  }, [q]);

  const choose = (r: Row) => {
    onSelect(r.option);
    onClose();
  };
  const cols = COLUMNS[kind];

  return (
    <Modal opened={opened} onClose={onClose} title={<Text fw={700}>{SEARCH_TITLES[kind]}</Text>} size="90%" zIndex={1200} centered>
      <TextInput
        autoFocus
        leftSection={<IconSearch size={16} />}
        placeholder="Código o nombre (vacío = todos)"
        value={q}
        onChange={(e) => setQ(e.currentTarget.value.replace(/\*/g, ''))}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setActive((a) => Math.min(rows.length - 1, a + 1));
          if (e.key === 'ArrowUp') setActive((a) => Math.max(0, a - 1));
          if (e.key === 'Enter' && rows[active]) choose(rows[active]);
        }}
        mb="sm"
      />
      {error && (
        <Alert color="red" mb="sm">
          {error}
        </Alert>
      )}
      <ScrollArea h="60vh" type="auto">
        <Table striped highlightOnHover stickyHeader verticalSpacing={6}>
          <Table.Thead>
            <Table.Tr>
              {cols.map((c) => (
                <Table.Th key={c.key} style={{ textAlign: c.align ?? 'left', whiteSpace: 'nowrap' }}>
                  {c.label}
                </Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((r, i) => (
              <Table.Tr
                key={`${r.option?.value}-${i}`}
                onClick={() => choose(r)}
                style={{ cursor: 'pointer', background: i === active ? 'var(--mantine-primary-color-light)' : undefined }}
              >
                {cols.map((c) => (
                  <Table.Td key={c.key} style={{ textAlign: c.align ?? 'left' }}>
                    {c.render ? c.render(r) : String(r[c.key] ?? '')}
                  </Table.Td>
                ))}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        {!loading && rows.length === 0 && !error && (
          <Text c="dimmed" size="sm" ta="center" my="md">
            Sin resultados.
          </Text>
        )}
        {loading && (
          <Group justify="center" my="md">
            <Loader size="sm" />
          </Group>
        )}
      </ScrollArea>
      <Group justify="space-between" mt="sm">
        <Text size="xs" c="dimmed">
          Clic o Enter para elegir · flechas para moverse · {rows.length} registro(s)
        </Text>
        {hasMore && (
          <Button size="xs" variant="light" loading={loading} onClick={() => void load(q, page + 1, true)}>
            Cargar más
          </Button>
        )}
      </Group>
    </Modal>
  );
}
