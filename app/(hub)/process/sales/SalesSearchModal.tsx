'use client';

import { useEffect, useRef, useState } from 'react';
import { Alert, Badge, Button, Group, Loader, Modal, ScrollArea, Table, Text, TextInput } from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';

/**
 * Ventana de búsqueda ampliada de la oferta de venta (como «*» + Enter en SAP y los
 * modales de SAPSEND). Clientes y artículos se eligen con clic o Enter; stock por
 * bodega, lotes y pedidos recientes son de consulta (bodega también se elige).
 */

export type SearchKind = 'customer' | 'item' | 'warehouse_stock' | 'batches' | 'recent_orders';
type Row = Record<string, unknown>;

interface Props {
  opened: boolean;
  onClose: () => void;
  companyId: string;
  kind: SearchKind;
  initialQuery?: string;
  itemCode?: string;
  cardCode?: string;
  title?: string;
  onSelect?: (row: Row) => void;
}

const num = (v: unknown, dec = 0) => (v == null || v === '' ? '—' : Number(v).toLocaleString('es-CO', { maximumFractionDigits: dec }));
const money = (v: unknown) => (v == null || v === '' ? '—' : `$ ${Math.round(Number(v)).toLocaleString('es-CO')}`);

const COLUMNS: Record<SearchKind, { key: string; label: string; render?: (r: Row) => React.ReactNode; align?: 'right' }[]> = {
  customer: [
    { key: 'CardCode', label: 'NIT / Código' },
    { key: 'CardName', label: 'Nombre', render: (r) => (<>{String(r.CardName)}{r.Frozen ? <Badge ml={6} size="xs" color="red">Inactivo</Badge> : null}</>) },
    { key: 'City', label: 'Ciudad' },
    { key: 'CreditLimit', label: 'Límite de crédito', render: (r) => money(r.CreditLimit), align: 'right' },
    { key: 'CurrentAccountBalance', label: 'Saldo', render: (r) => money(r.CurrentAccountBalance), align: 'right' },
    { key: 'OpenDeliveryNotesBalance', label: 'Entregas', render: (r) => money(r.OpenDeliveryNotesBalance), align: 'right' },
    { key: 'OpenOrdersBalance', label: 'Pedidos', render: (r) => money(r.OpenOrdersBalance), align: 'right' },
    { key: 'Disponible', label: 'Cupo disponible', render: (r) => <Text size="sm" c={Number(r.Disponible) < 0 ? 'red' : 'green'} fw={600}>{money(r.Disponible)}</Text>, align: 'right' },
  ],
  item: [
    { key: 'ItemCode', label: 'Código' },
    { key: 'ItemName', label: 'Descripción' },
    { key: 'QuantityOnStock', label: 'En stock', render: (r) => num(r.QuantityOnStock, 2), align: 'right' },
    { key: 'Committed', label: 'Comprometido', render: (r) => num(r.Committed, 2), align: 'right' },
    { key: 'Available', label: 'Disponible', render: (r) => <Text size="sm" fw={600} c={Number(r.Available) <= 0 ? 'red' : undefined}>{num(r.Available, 2)}</Text>, align: 'right' },
    { key: 'DefaultWarehouse', label: 'Bodega por defecto' },
  ],
  warehouse_stock: [
    { key: 'WarehouseCode', label: 'Bodega', render: (r) => (<>{String(r.WarehouseCode)}{r.Locked ? <Badge ml={6} size="xs" color="gray">Bloqueada</Badge> : null}</>) },
    { key: 'InStock', label: 'En stock', render: (r) => num(r.InStock, 2), align: 'right' },
    { key: 'Committed', label: 'Comprometido', render: (r) => num(r.Committed, 2), align: 'right' },
    { key: 'Ordered', label: 'Pedido', render: (r) => num(r.Ordered, 2), align: 'right' },
    { key: 'Available', label: 'Disponible', render: (r) => <Text size="sm" fw={600} c={Number(r.Available) <= 0 ? 'red' : undefined}>{num(r.Available, 2)}</Text>, align: 'right' },
  ],
  batches: [
    { key: 'Batch', label: 'Lote' },
    { key: 'ExpirationDate', label: 'Vencimiento' },
    { key: 'ManufacturingDate', label: 'Fabricación' },
    { key: 'Status', label: 'Estado', render: (r) => (String(r.Status) === 'bdsStatus_Released' ? 'Liberado' : String(r.Status).replace('bdsStatus_', '')) },
  ],
  recent_orders: [
    { key: 'DocNum', label: 'Pedido' },
    { key: 'DocDate', label: 'Fecha' },
    { key: 'NumAtCard', label: 'OC del cliente' },
    { key: 'DocTotal', label: 'Total', render: (r) => money(r.DocTotal), align: 'right' },
    { key: 'DocumentStatus', label: 'Estado' },
  ],
};

const TITLES: Record<SearchKind, string> = {
  customer: 'Buscar cliente',
  item: 'Buscar artículo',
  warehouse_stock: 'Stock por bodega',
  batches: 'Lotes vigentes',
  recent_orders: 'Pedidos recientes del cliente',
};

export default function SalesSearchModal({ opened, onClose, companyId, kind, initialQuery = '', itemCode, cardCode, title, onSelect }: Props) {
  const [q, setQ] = useState(initialQuery);
  const [rows, setRows] = useState<Row[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const searchable = kind === 'customer' || kind === 'item';
  const selectable = Boolean(onSelect) && kind !== 'batches' && kind !== 'recent_orders';
  const reqId = useRef(0);

  const load = async (query: string, pg: number, append: boolean) => {
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ companyId, kind, q: query, page: String(pg) });
      if (itemCode) params.set('itemCode', itemCode);
      if (cardCode) params.set('cardCode', cardCode);
      const r = await fetch(`/api/sales/search?${params}`, { cache: 'no-store' });
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
    setQ(initialQuery);
    load(initialQuery, 0, false);
  }, [opened, kind, itemCode, cardCode]);

  useEffect(() => {
    if (!opened || !searchable) return;
    const t = setTimeout(() => load(q, 0, false), 350);
    return () => clearTimeout(t);
  }, [q]);

  const choose = (r: Row) => {
    if (!selectable || !onSelect) return;
    onSelect(r);
    onClose();
  };
  const cols = COLUMNS[kind];

  return (
    <Modal opened={opened} onClose={onClose} title={<Text fw={700}>{title ?? TITLES[kind]}</Text>} size="90%" zIndex={1200} centered>
      {searchable && (
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
      )}
      {error && <Alert color="red" mb="sm">{error}</Alert>}
      <ScrollArea h="60vh" type="auto">
        <Table striped highlightOnHover stickyHeader verticalSpacing={6}>
          <Table.Thead>
            <Table.Tr>
              {cols.map((c) => (
                <Table.Th key={c.key} style={{ textAlign: c.align ?? 'left', whiteSpace: 'nowrap' }}>{c.label}</Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((r, i) => (
              <Table.Tr
                key={i}
                onClick={() => choose(r)}
                style={{ cursor: selectable ? 'pointer' : 'default', background: selectable && i === active ? 'var(--mantine-primary-color-light)' : undefined }}
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
        {!loading && rows.length === 0 && !error && <Text c="dimmed" size="sm" ta="center" my="md">Sin resultados.</Text>}
        {loading && <Group justify="center" my="md"><Loader size="sm" /></Group>}
      </ScrollArea>
      <Group justify="space-between" mt="sm">
        <Text size="xs" c="dimmed">{selectable ? 'Clic o Enter para elegir · flechas para moverse' : 'Consulta de SAP'} · {rows.length} registro(s)</Text>
        {hasMore && (
          <Button size="xs" variant="light" loading={loading} onClick={() => load(q, page + 1, true)}>
            Cargar más
          </Button>
        )}
      </Group>
    </Modal>
  );
}
