'use client';

import { useEffect, useState } from 'react';
import { Alert, Badge, Card, Group, Loader, Progress, ScrollArea, SimpleGrid, Table, Text } from '@mantine/core';
import { IconAlertTriangle, IconCash, IconReportMoney } from '@tabler/icons-react';

/**
 * Cupo y cartera por edades del cliente de la oferta (decisión de cartera para el
 * extracupo): porcentaje de uso y de extracupo, excedente, y la cartera vencida por
 * rangos de días con las facturas abiertas. Datos de SAP del momento. Solo lectura.
 */

interface Credit {
  creditLimit: number; pctTolerancia: number; saldo: number; entregasAbiertas: number; pedidosAbiertos: number; otrasOfertas: number; estaOferta: number;
  limiteConTolerancia: number; comprometidoSinOferta: number; comprometido: number; disponible: number; excedente: number;
  pctUso: number | null; pctExtracupo: number | null; excede: boolean;
}
interface Aging { buckets: { key: string; label: string; amount: number; count: number }[]; total: number; vencido: number; pctVencido: number; maxDias: number }
interface Inv { docNum: number; docDate: string; dueDate: string; total: number; pendiente: number; diasVencida: number }
interface Data { credit: Credit; aging: Aging; invoices: Inv[]; invoiceCount: number; today: string }

const money = (v: number | null | undefined) => (v == null ? '—' : `$ ${Math.round(v).toLocaleString('es-CO')}`);
const pct = (v: number | null | undefined) => (v == null ? '—' : `${v.toLocaleString('es-CO', { maximumFractionDigits: 1 })} %`);
const BUCKET_COLOR: Record<string, string> = { por_vencer: 'teal', d1_30: 'yellow', d31_60: 'orange', d61_90: 'red', d91_120: 'red', d120: 'grape' };

function Kpi({ label, value, hint, color }: { label: string; value: string; hint?: string; color?: string }) {
  return (
    <Card withBorder radius='md' p='sm'>
      <Text size='xs' c='dimmed'>{label}</Text>
      <Text fz={20} fw={700} c={color}>{value}</Text>
      {hint && <Text size='xs' c='dimmed'>{hint}</Text>}
    </Card>
  );
}

export default function SalesCreditPanel({ requestId }: { requestId: number | string }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/sales/credit?requestId=${requestId}`, { cache: 'no-store' })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (!r.ok) throw new Error(d.error || 'No se pudo consultar el cupo y la cartera en SAP');
        if (d.credit) setData(d);
      })
      .catch((e) => !cancelled && setError((e as Error).message));
    return () => {
      cancelled = true;
    };
  }, [requestId]);

  if (error) return <Alert color='yellow' title='Cupo y cartera'>{error}</Alert>;
  if (!data) return <Group gap='xs'><Loader size='xs' /><Text size='sm' c='dimmed'>Consultando cupo y cartera en SAP…</Text></Group>;
  const c = data.credit;
  const a = data.aging;
  const usoColor = c.excede ? 'red' : (c.pctUso ?? 0) > 100 ? 'orange' : 'green';

  return (
    <Card withBorder radius='md' p='md' bg='var(--app-surface-raised)'>
      <Group justify='space-between' mb='sm' wrap='wrap'>
        <Group gap={8}>
          <IconReportMoney size={20} />
          <Text fw={700}>Cupo y cartera del cliente</Text>
        </Group>
        {c.excede ? (
          <Badge color='red' leftSection={<IconAlertTriangle size={12} />}>Excede el cupo en {money(c.excedente)}</Badge>
        ) : (
          <Badge color='green'>Dentro del cupo</Badge>
        )}
      </Group>

      <SimpleGrid cols={{ base: 2, sm: 4 }} mb='sm'>
        <Kpi label='Límite de crédito' value={money(c.creditLimit)} hint={`Con tolerancia ${c.pctTolerancia} %: ${money(c.limiteConTolerancia)}`} />
        <Kpi label='Comprometido con esta oferta' value={money(c.comprometido)} hint={`Antes de la oferta: ${money(c.comprometidoSinOferta)}`} color={usoColor} />
        <Kpi label='Uso del cupo' value={pct(c.pctUso)} hint={c.pctExtracupo ? `Extracupo: ${pct(c.pctExtracupo)} sobre el límite` : 'Sin extracupo'} color={usoColor} />
        <Kpi label='Disponible antes de la oferta' value={money(c.disponible)} hint={`Esta oferta: ${money(c.estaOferta)}`} color={c.disponible < c.estaOferta ? 'red' : undefined} />
      </SimpleGrid>
      {c.pctUso != null && <Progress value={Math.min(100, ((c.comprometido / Math.max(1, c.limiteConTolerancia)) * 100))} color={usoColor} size='sm' mb='xs' />}
      <Text size='xs' c='dimmed' mb='md'>
        Comprometido = saldo {money(c.saldo)} + entregas abiertas {money(c.entregasAbiertas)} + pedidos abiertos {money(c.pedidosAbiertos)} + otras ofertas en autorización {money(c.otrasOfertas)} + esta oferta {money(c.estaOferta)}.
      </Text>

      <Group gap={8} mb='xs'>
        <IconCash size={18} />
        <Text fw={600} size='sm'>Cartera por edades</Text>
        <Text size='xs' c='dimmed'>(facturas abiertas, por días vencidos al {data.today})</Text>
      </Group>
      <SimpleGrid cols={{ base: 2, sm: 3, md: 6 }} mb='xs'>
        {a.buckets.map((b) => (
          <Card key={b.key} withBorder radius='md' p='xs' style={{ borderLeft: `4px solid var(--mantine-color-${BUCKET_COLOR[b.key]}-6)` }}>
            <Text size='xs' c='dimmed'>{b.label}</Text>
            <Text fw={700} size='sm'>{money(b.amount)}</Text>
            <Text size='xs' c='dimmed'>{b.count} factura(s)</Text>
          </Card>
        ))}
      </SimpleGrid>
      <Text size='sm' mb='sm'>
        Total cartera <b>{money(a.total)}</b> · vencida <b style={{ color: a.vencido > 0 ? 'var(--mantine-color-red-7)' : undefined }}>{money(a.vencido)}</b> ({pct(a.pctVencido)}) · factura más vencida: <b>{a.maxDias} días</b>
      </Text>
      {data.invoices.length > 0 && (
        <ScrollArea h={220} type='auto'>
          <Table striped stickyHeader verticalSpacing={4} style={{ minWidth: 560 }}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Factura</Table.Th><Table.Th>Fecha</Table.Th><Table.Th>Vence</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Total</Table.Th><Table.Th style={{ textAlign: 'right' }}>Pendiente</Table.Th><Table.Th style={{ textAlign: 'right' }}>Días vencida</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data.invoices.map((i) => (
                <Table.Tr key={i.docNum}>
                  <Table.Td>{i.docNum}</Table.Td><Table.Td>{i.docDate}</Table.Td><Table.Td>{i.dueDate}</Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>{money(i.total)}</Table.Td><Table.Td style={{ textAlign: 'right' }}>{money(i.pendiente)}</Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}><Text size='sm' fw={i.diasVencida > 0 ? 700 : 400} c={i.diasVencida > 90 ? 'red' : i.diasVencida > 30 ? 'orange' : i.diasVencida > 0 ? 'yellow.8' : 'dimmed'}>{i.diasVencida > 0 ? i.diasVencida : 'Por vencer'}</Text></Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      )}
      {data.invoiceCount > data.invoices.length && <Text size='xs' c='dimmed' mt={4}>Se muestran las {data.invoices.length} más vencidas de {data.invoiceCount}.</Text>}
    </Card>
  );
}
