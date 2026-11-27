'use client';

import { useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Group, Loader, Menu, Modal, ScrollArea, SegmentedControl, Table, Text, TextInput } from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';
import type { CustomerDocType, CustomerOrderLine } from '../../../../lib/sales/customerOrders';

const CUSTOMER_DOC_LABEL: Record<CustomerDocType, string> = { Quotations: 'Oferta', Orders: 'Pedido', Invoices: 'Factura' };

/**
 * Previous quotations, orders and invoices of the customer (last months, read only) inside the «Montar oferta desde
 * PDF» review. Opened for one PO line (filtered to that line's candidate items) or for the whole PO. Any row can be
 * used on a PO line (Nicolás Rivera, 2026-11-27, SynerLink msg 41343).
 */
export interface PoLineRef {
  /** Index in the simulation. */
  index: number;
  /** PO line number shown to the user. */
  row: string;
  /** Item codes of that line: current item and candidates. */
  codes: string[];
}

interface Props {
  opened: boolean;
  onClose: () => void;
  companyId: string;
  cardCode: string;
  customerName: string;
  poLines: PoLineRef[];
  /** Open for one line (index in poLines' index space); null = the whole PO. */
  forLine: number | null;
  onUse: (lineIndex: number, itemCode: string) => void;
  zIndex?: number;
}

const money = (v: number) => `$ ${Number(v).toLocaleString('es-CO')}`;
const cache = new Map<string, { months: number; lines: CustomerOrderLine[] }>();

export default function CustomerOrdersModal({ opened, onClose, companyId, cardCode, customerName, poLines, forLine, onUse, zIndex = 1400 }: Props) {
  const key = `${companyId}|${cardCode}`;
  const [data, setData] = useState<{ months: number; lines: CustomerOrderLine[] } | null>(cache.get(key) ?? null);
  const [error, setError] = useState('');
  const [scope, setScope] = useState<'oc' | 'todo'>('oc');
  const [text, setText] = useState('');

  useEffect(() => {
    if (!opened || cache.has(key)) return;
    let cancelled = false;
    setError('');
    fetch(`/api/sales/customer-orders?companyId=${encodeURIComponent(companyId)}&cardCode=${encodeURIComponent(cardCode)}`, { cache: 'no-store' })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || 'No se pudieron leer los pedidos anteriores del cliente.');
        cache.set(key, d);
        if (!cancelled) setData(d);
      })
      .catch((e) => !cancelled && setError((e as Error).message));
    return () => { cancelled = true; };
  }, [opened, key, companyId, cardCode]);

  useEffect(() => { if (opened) { setScope('oc'); setText(''); } }, [opened, forLine]);

  const line = forLine == null ? null : poLines.find((p) => p.index === forLine) ?? null;
  const codes = useMemo(() => new Set(line ? line.codes : poLines.flatMap((p) => p.codes)), [line, poLines]);
  const linesOf = (code: string) => poLines.filter((p) => p.codes.includes(code));

  const rows = useMemo(() => {
    const t = text.trim().toLowerCase();
    return (data?.lines ?? [])
      .filter((l) => scope === 'todo' || codes.has(l.itemCode))
      .filter((l) => !t || `${l.itemCode} ${l.itemName} ${l.numAtCard} ${l.docNum}`.toLowerCase().includes(t));
  }, [data, scope, codes, text]);

  return (
    <Modal opened={opened} onClose={onClose} zIndex={zIndex} size="85rem" centered
      title={<Text fw={600}>{line ? `Pedidos anteriores para la línea ${line.row}` : 'Pedidos anteriores del cliente'}</Text>}>
      <Text size="sm" c="dimmed" mb="xs">
        {customerName} ({cardCode}). Ofertas, pedidos y facturas de los últimos {data?.months ?? 6} meses en SAP. Solo consulta.
      </Text>
      <Group gap="sm" mb="sm" wrap="wrap">
        <SegmentedControl size="xs" value={scope} onChange={(v) => setScope(v as 'oc' | 'todo')}
          data={[{ value: 'oc', label: line ? 'Artículos de esta línea' : 'Artículos de la OC' }, { value: 'todo', label: 'Todos los artículos' }]} />
        <TextInput size="xs" placeholder="Filtrar por código, nombre u OC" leftSection={<IconSearch size={14} />} value={text} onChange={(e) => setText(e.currentTarget.value)} style={{ flex: 1, minWidth: 200 }} />
      </Group>
      {error && <Alert color="red" mb="sm">{error}</Alert>}
      {!data && !error && <Group justify="center" my="lg"><Loader size="sm" /><Text size="sm" c="dimmed">Consultando SAP…</Text></Group>}
      {data && (
        <ScrollArea.Autosize mah="60vh" type="auto" offsetScrollbars>
          <Table striped withTableBorder stickyHeader verticalSpacing={4} miw={860}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Fecha</Table.Th><Table.Th>Documento</Table.Th><Table.Th>OC cliente</Table.Th><Table.Th>Artículo</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Cantidad</Table.Th><Table.Th style={{ textAlign: 'right' }}>Precio unitario</Table.Th><Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.length === 0 && (
                <Table.Tr><Table.Td colSpan={7}><Text size="sm" c="dimmed" ta="center" py="sm">
                  {scope === 'oc' ? 'El cliente no tiene documentos recientes con estos artículos. Vea todos los artículos.' : 'Sin documentos en el periodo.'}
                </Text></Table.Td></Table.Tr>
              )}
              {rows.slice(0, 300).map((l, i) => {
                const matches = linesOf(l.itemCode);
                return (
                  <Table.Tr key={`${l.type}-${l.docEntry}-${l.itemCode}-${i}`}>
                    <Table.Td style={{ whiteSpace: 'nowrap' }}><Text size="xs">{l.docDate}</Text></Table.Td>
                    <Table.Td style={{ whiteSpace: 'nowrap' }}><Badge size="xs" variant="light" color={l.type === 'Invoices' ? 'teal' : l.type === 'Orders' ? 'blue' : 'gray'}>{CUSTOMER_DOC_LABEL[l.type]}</Badge> <Text span size="xs">{l.docNum}</Text></Table.Td>
                    <Table.Td><Text size="xs">{l.numAtCard || '—'}</Text></Table.Td>
                    <Table.Td><Text size="xs"><b>{l.itemCode}</b> · {l.itemName}</Text></Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}><Text size="xs">{l.quantity.toLocaleString('es-CO')}</Text></Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}><Text size="xs">{money(l.unitPrice)}</Text></Table.Td>
                    <Table.Td style={{ whiteSpace: 'nowrap' }}>
                      {line ? (
                        <Button size="compact-xs" variant="light" color="violet" onClick={() => onUse(line.index, l.itemCode)}>Usar en la línea {line.row}</Button>
                      ) : (
                        <Menu withinPortal zIndex={zIndex + 10} position="bottom-end">
                          <Menu.Target>
                            <Button size="compact-xs" variant={matches.length ? 'light' : 'subtle'} color="violet">
                              {matches.length === 1 ? `Usar en la línea ${matches[0].row}` : 'Usar en una línea'}
                            </Button>
                          </Menu.Target>
                          <Menu.Dropdown>
                            {[...matches, ...poLines.filter((p) => !matches.includes(p))].map((p) => (
                              <Menu.Item key={p.index} onClick={() => onUse(p.index, l.itemCode)} fw={matches.includes(p) ? 600 : undefined}>
                                Línea {p.row}{matches.includes(p) ? ' (artículo sugerido)' : ''}
                              </Menu.Item>
                            ))}
                          </Menu.Dropdown>
                        </Menu>
                      )}
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
          {rows.length > 300 && <Text size="xs" c="dimmed" mt="xs">Se ven 300 de {rows.length}: filtre para encontrar el resto.</Text>}
        </ScrollArea.Autosize>
      )}
    </Modal>
  );
}
