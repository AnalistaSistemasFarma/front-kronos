'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Alert, Anchor, Badge, Breadcrumbs, Button, Card, Group, Loader, Modal, ScrollArea, SegmentedControl, Select, Table, Text, TextInput, Title,
} from '@mantine/core';
import { IconChevronRight, IconDownload, IconFileInvoice, IconSearch } from '@tabler/icons-react';
import toast from 'react-hot-toast';
import RelationMap, { type RelDoc } from '../RelationMap';

/**
 * Ventas · Pedidos de venta: los pedidos en firme de SAP (Orders), como «Órdenes de Venta»
 * de SAPSEND. Búsqueda por número, cliente/NIT u OC, fechas, estado y origen (todos o solo
 * los creados por SynerLink), Excel, y el detalle de cada pedido con líneas y mapa de relaciones.
 */

type Company = { idCompany: number; companyName: string; canRead: boolean; ready: boolean };
interface Row {
  docEntry: number; docNum: number; docDate: string; dueDate: string; cardCode: string; cardName: string; numAtCard: string; shipTo: string;
  total: number; vat: number; currency: string; status: 'Abierto' | 'Cerrado' | 'Cancelado'; comments: string; draftDocEntry: number | null; requestId: number | null;
}
interface Detail {
  order: Row & { address: string };
  lines: { itemCode: string; description: string; warehouse: string; quantity: number; open: number; price: number; total: number; status: string }[];
  relations: RelDoc[];
  warnings: string[];
}

const money = (v: number | null | undefined) => (v == null ? '—' : `$ ${Math.round(v).toLocaleString('es-CO')}`);
const qty = (v: number) => v.toLocaleString('es-CO', { maximumFractionDigits: 2 });
const STATUS_COLOR: Record<string, string> = { Abierto: 'blue', Cerrado: 'gray', Cancelado: 'red' };

export default function PedidosVentaPage() {
  const [companies, setCompanies] = useState<Company[] | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [estado, setEstado] = useState('todos');
  const [origen, setOrigen] = useState('todos');
  const [rows, setRows] = useState<Row[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    fetch('/api/sales/access')
      .then((r) => r.json())
      .then((d) => {
        const list = ((d.companies ?? []) as Company[]).filter((c) => c.canRead && c.ready);
        setCompanies(list);
        if (list[0]) setCompanyId(String(list[0].idCompany));
      })
      .catch(() => setCompanies([]));
  }, []);

  const params = useCallback(
    (pg: number) => new URLSearchParams({ companyId: companyId ?? '', q, desde, hasta, estado, origen, page: String(pg) }),
    [companyId, q, desde, hasta, estado, origen]
  );

  const load = useCallback(
    async (pg: number, append: boolean) => {
      if (!companyId) return;
      setLoading(true);
      setError(null);
      try {
        const r = await fetch(`/api/sales/orders?${params(pg)}`, { cache: 'no-store' });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || 'No se pudieron consultar los pedidos');
        setRows((prev) => (append ? [...prev, ...(d.rows ?? [])] : d.rows ?? []));
        setHasMore(Boolean(d.hasMore));
        setPage(pg);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [companyId, params]
  );

  useEffect(() => {
    const t = setTimeout(() => load(0, false), 400);
    return () => clearTimeout(t);
  }, [load]);

  const openDetail = async (r: Row) => {
    setDetailLoading(r.docEntry);
    try {
      const res = await fetch(`/api/sales/orders?companyId=${companyId}&docEntry=${r.docEntry}`, { cache: 'no-store' });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'No se pudo abrir el pedido');
      setDetail(d);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDetailLoading(null);
    }
  };

  const exportExcel = async () => {
    setExporting(true);
    try {
      const p = params(0);
      p.set('export', '1');
      const r = await fetch(`/api/sales/orders?${p}`, { cache: 'no-store' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'No se pudo exportar');
      const list = (d.rows ?? []) as Row[];
      if (!list.length) {
        toast.error('No hay pedidos con esos filtros.');
        return;
      }
      const { default: ExcelJS } = await import('exceljs');
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Pedidos de venta');
      ws.columns = [
        { header: 'Pedido', key: 'docNum', width: 10 }, { header: 'Fecha', key: 'docDate', width: 12 }, { header: 'Entrega', key: 'dueDate', width: 12 },
        { header: 'NIT', key: 'cardCode', width: 15 }, { header: 'Cliente', key: 'cardName', width: 45 }, { header: 'OC del cliente', key: 'numAtCard', width: 18 },
        { header: 'Punto de entrega', key: 'shipTo', width: 20 }, { header: 'Total', key: 'total', width: 16 }, { header: 'IVA', key: 'vat', width: 14 },
        { header: 'Estado', key: 'status', width: 11 }, { header: 'Origen', key: 'origen', width: 12 }, { header: 'Solicitud SynerLink', key: 'requestId', width: 14 },
        { header: 'Comentarios', key: 'comments', width: 50 },
      ];
      ws.getRow(1).font = { bold: true };
      for (const x of list) ws.addRow({ ...x, origen: x.draftDocEntry ? 'SynerLink' : 'SAP / otro' });
      ws.getColumn('total').numFmt = '#,##0';
      ws.getColumn('vat').numFmt = '#,##0';
      const buf = await wb.xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `pedidos-venta-${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      if (list.length >= 2000) toast('Se exportaron los primeros 2.000 pedidos; acote las fechas para ver el resto.');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setExporting(false);
    }
  };

  if (companies === null) return <Group justify='center' mt='xl'><Loader /></Group>;
  if (!companies.length) {
    return <Alert color='yellow' m='md' title='Pedidos de venta'>No tiene acceso a Ventas en ninguna empresa con SAP configurado («Ventas · Ofertas»).</Alert>;
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--mantine-color-body)' }}>
      <div className='max-w-7xl mx-auto py-3 sm:py-8 px-3 sm:px-6 lg:px-8'>
        <Card shadow='sm' p={{ base: 'md', sm: 'xl' }} radius='md' withBorder mb='md'>
          <Breadcrumbs separator={<IconChevronRight size={16} />} mb='sm'>
            <Anchor component={Link} href='/process'>Procesos</Anchor>
            <Anchor component={Link} href='/process/sales'>Ventas</Anchor>
            <Text>Pedidos de venta</Text>
          </Breadcrumbs>
          <Group justify='space-between' align='flex-end' wrap='wrap'>
            <div>
              <Title order={1} fz={{ base: 26, sm: 30 }} className='font-bold mb-1 flex items-center gap-3'>
                <IconFileInvoice size={28} style={{ color: 'var(--mantine-primary-color-filled)' }} />
                Pedidos de venta
              </Title>
              <Text c='dimmed'>Pedidos en firme en SAP, con su detalle, entregas y facturas.</Text>
            </div>
            <Group>
              {companies.length > 1 && (
                <Select data={companies.map((c) => ({ value: String(c.idCompany), label: c.companyName }))} value={companyId} onChange={setCompanyId} allowDeselect={false} w={220} />
              )}
              <Button variant='light' leftSection={<IconDownload size={16} />} loading={exporting} onClick={exportExcel}>Descargar Excel</Button>
            </Group>
          </Group>
        </Card>

        <Card withBorder radius='md' p='md' mb='md'>
          <Group align='flex-end' wrap='wrap' gap='sm'>
            <TextInput label='Buscar' placeholder='Pedido, NIT, cliente u OC' leftSection={<IconSearch size={16} />} value={q} onChange={(e) => setQ(e.currentTarget.value)} w={280} />
            <TextInput label='Desde' type='date' value={desde} onChange={(e) => setDesde(e.currentTarget.value)} />
            <TextInput label='Hasta' type='date' value={hasta} onChange={(e) => setHasta(e.currentTarget.value)} />
            <div>
              <Text size='sm' fw={500} mb={4}>Estado</Text>
              <SegmentedControl value={estado} onChange={setEstado} data={[{ value: 'todos', label: 'Todos' }, { value: 'abiertos', label: 'Abiertos' }, { value: 'cerrados', label: 'Cerrados' }, { value: 'cancelados', label: 'Cancelados' }]} />
            </div>
            <div>
              <Text size='sm' fw={500} mb={4}>Origen</Text>
              <SegmentedControl value={origen} onChange={setOrigen} data={[{ value: 'todos', label: 'Todos' }, { value: 'synerlink', label: 'SynerLink' }]} />
            </div>
          </Group>
        </Card>

        <Card withBorder radius='md' p='md'>
          {error && <Alert color='red' mb='sm'>{error}</Alert>}
          <ScrollArea type='auto'>
            <Table striped highlightOnHover verticalSpacing='xs' style={{ minWidth: 1200 }}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Pedido</Table.Th><Table.Th>Fecha</Table.Th><Table.Th>Entrega</Table.Th><Table.Th>Cliente</Table.Th>
                  <Table.Th>OC del cliente</Table.Th><Table.Th>Punto de entrega</Table.Th><Table.Th style={{ textAlign: 'right' }}>Total</Table.Th>
                  <Table.Th>Estado</Table.Th><Table.Th>Origen</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((r) => (
                  <Table.Tr key={r.docEntry} onClick={() => openDetail(r)} style={{ cursor: 'pointer' }}>
                    <Table.Td><Group gap={4}><Text fw={600} size='sm'>{r.docNum}</Text>{detailLoading === r.docEntry && <Loader size={12} />}</Group></Table.Td>
                    <Table.Td style={{ whiteSpace: 'nowrap' }}>{r.docDate}</Table.Td>
                    <Table.Td style={{ whiteSpace: 'nowrap' }}>{r.dueDate}</Table.Td>
                    <Table.Td><Text size='sm'>{r.cardName}</Text><Text size='xs' c='dimmed'>{r.cardCode}</Text></Table.Td>
                    <Table.Td>{r.numAtCard}</Table.Td>
                    <Table.Td>{r.shipTo}</Table.Td>
                    <Table.Td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{money(r.total)}</Table.Td>
                    <Table.Td><Badge variant='light' color={STATUS_COLOR[r.status]} style={{ overflow: 'visible' }} miw={84}>{r.status}</Badge></Table.Td>
                    <Table.Td>
                      {r.draftDocEntry ? (
                        r.requestId ? (
                          <Anchor size='sm' style={{ whiteSpace: 'nowrap' }} component={Link} href={`/process/request-general/view-request?id=${r.requestId}`} onClick={(e) => e.stopPropagation()}>SynerLink #{r.requestId}</Anchor>
                        ) : <Badge size='sm' variant='outline'>SynerLink</Badge>
                      ) : <Text size='xs' c='dimmed'>SAP / otro</Text>}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
          {!loading && !rows.length && !error && <Text c='dimmed' size='sm' ta='center' my='md'>No hay pedidos con esos filtros.</Text>}
          {loading && <Group justify='center' my='md'><Loader size='sm' /></Group>}
          <Group justify='space-between' mt='sm'>
            <Text size='xs' c='dimmed'>{rows.length} pedido(s) · clic en una fila para ver el detalle</Text>
            {hasMore && <Button size='xs' variant='light' loading={loading} onClick={() => load(page + 1, true)}>Cargar más</Button>}
          </Group>
        </Card>
      </div>

      <Modal opened={Boolean(detail)} onClose={() => setDetail(null)} size='90%' title={<Text fw={700}>Pedido de venta #{detail?.order.docNum}</Text>} centered>
        {detail && (
          <>
            <Group gap='xl' mb='md' wrap='wrap'>
              <div><Text size='xs' c='dimmed'>Cliente</Text><Text size='sm' fw={600}>{detail.order.cardName}</Text><Text size='xs'>{detail.order.cardCode}</Text></div>
              <div><Text size='xs' c='dimmed'>Punto de entrega</Text><Text size='sm'>{detail.order.shipTo || '—'}</Text><Text size='xs' c='dimmed' style={{ whiteSpace: 'pre-line', maxWidth: 280 }}>{detail.order.address}</Text></div>
              <div><Text size='xs' c='dimmed'>OC del cliente</Text><Text size='sm'>{detail.order.numAtCard || '—'}</Text></div>
              <div><Text size='xs' c='dimmed'>Fecha / entrega</Text><Text size='sm'>{detail.order.docDate} · {detail.order.dueDate}</Text></div>
              <div><Text size='xs' c='dimmed'>Total</Text><Text size='sm' fw={700}>{money(detail.order.total)}</Text><Text size='xs' c='dimmed'>IVA {money(detail.order.vat)}</Text></div>
              <div><Text size='xs' c='dimmed'>Estado</Text><Badge variant='light' color={STATUS_COLOR[detail.order.status]}>{detail.order.status}</Badge></div>
              {detail.order.requestId && (
                <div><Text size='xs' c='dimmed'>Solicitud</Text><Anchor size='sm' component={Link} href={`/process/request-general/view-request?id=${detail.order.requestId}`}>#{detail.order.requestId}</Anchor></div>
              )}
            </Group>
            {detail.order.comments && <Text size='sm' mb='md'><Text span c='dimmed'>Comentarios: </Text>{detail.order.comments}</Text>}
            <RelationMap relations={detail.relations} warnings={detail.warnings} />
            <ScrollArea type='auto'>
              <Table withTableBorder striped verticalSpacing={4} style={{ minWidth: 820 }}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>#</Table.Th><Table.Th>Artículo</Table.Th><Table.Th>Descripción</Table.Th><Table.Th>Bodega</Table.Th>
                    <Table.Th style={{ textAlign: 'right' }}>Cantidad</Table.Th><Table.Th style={{ textAlign: 'right' }}>Pendiente</Table.Th>
                    <Table.Th style={{ textAlign: 'right' }}>Precio</Table.Th><Table.Th style={{ textAlign: 'right' }}>Total</Table.Th><Table.Th>Línea</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {detail.lines.map((l, i) => (
                    <Table.Tr key={i}>
                      <Table.Td>{i + 1}</Table.Td><Table.Td>{l.itemCode}</Table.Td><Table.Td>{l.description}</Table.Td><Table.Td>{l.warehouse}</Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>{qty(l.quantity)}</Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}><Text size='sm' c={l.open > 0 ? 'orange' : 'dimmed'}>{qty(l.open)}</Text></Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>{money(l.price)}</Table.Td><Table.Td style={{ textAlign: 'right' }}>{money(l.total)}</Table.Td>
                      <Table.Td><Badge size='xs' variant='light' color={l.status === 'Abierta' ? 'blue' : 'gray'}>{l.status}</Badge></Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          </>
        )}
      </Modal>
    </div>
  );
}
