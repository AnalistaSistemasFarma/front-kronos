'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Alert, Anchor, Button, Card, Group, Loader, Modal, ScrollArea, Select, Table, Text } from '@mantine/core';
import SalesInlineForm from './SalesInlineForm';
import { IconPencil, IconSend, IconX } from '@tabler/icons-react';
import toast from 'react-hot-toast';

/**
 * «Mis ofertas en borrador»: ofertas que el usuario guardó sin enviarlas al flujo (interruptor del
 * formulario). Como en SAPSEND, quedan en SAP en borrador; desde aquí se envían al flujo
 * «Oferta de venta» o se anulan (cancela la cotización y cierra el borrador).
 */

type Company = { idCompany: number; companyName: string; canWrite: boolean; ready: boolean };
interface Draft {
  docEntry: number; docNum: number | null; docDate: string | null; dueDate: string | null; cardCode: string | null; cardName: string | null;
  total: number | null; comments: string | null; open: boolean; missing: boolean; requestId?: number | null;
}

const money = (v: number | null) => (v == null ? '—' : `$ ${Math.round(v).toLocaleString('es-CO')}`);

export default function MisBorradores() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [editing, setEditing] = useState<Draft | null>(null);

  useEffect(() => {
    fetch('/api/sales/access')
      .then((r) => r.json())
      .then((d) => {
        const list = ((d.companies ?? []) as Company[]).filter((c) => c.canWrite && c.ready);
        setCompanies(list);
        if (list[0]) setCompanyId(String(list[0].idCompany));
        else setDrafts([]);
      })
      .catch(() => setDrafts([]));
  }, []);

  const load = useCallback(async () => {
    if (!companyId) return;
    setDrafts(null);
    setError(null);
    try {
      const r = await fetch(`/api/sales/drafts?companyId=${companyId}`, { cache: 'no-store' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'No se pudieron consultar sus borradores');
      setDrafts(d.drafts ?? []);
    } catch (e) {
      setError((e as Error).message);
      setDrafts([]);
    }
  }, [companyId]);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (d: Draft, accion: 'enviar' | 'anular') => {
    if (
      accion === 'enviar' &&
      !window.confirm(`¿Enviar la oferta #${d.docNum ?? d.docEntry} a pedido? Entra al flujo de venta: se revisa precio y cupo; si no requiere autorización se crea el pedido en SAP; si la requiere, pasa a Autorizaciones.`)
    )
      return;
    if (accion === 'anular' && !window.confirm(`¿Anular la oferta #${d.docNum ?? d.docEntry}? Se cancela la cotización y se cierra el borrador en SAP.`)) return;
    setBusy(d.docEntry);
    try {
      const r = await fetch('/api/sales/drafts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ companyId: Number(companyId), docEntry: d.docEntry, accion }) });
      const x = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(x.error || 'No se pudo completar la acción');
      toast.success(accion === 'enviar' ? `Oferta enviada a pedido: solicitud #${x.idRequest}` : 'Oferta anulada');
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (!companies.length && drafts !== null && !error) return null;

  return (
    <Card shadow='sm' p={{ base: 'md', sm: 'xl' }} radius='md' withBorder mb='md'>
      <Group justify='space-between' mb='sm' wrap='wrap'>
        <Group gap={8}>
          <IconPencil size={20} />
          <Text fw={700}>Mis ofertas en borrador</Text>
        </Group>
        {companies.length > 1 && (
          <Select data={companies.map((c) => ({ value: String(c.idCompany), label: c.companyName }))} value={companyId} onChange={setCompanyId} allowDeselect={false} w={220} />
        )}
      </Group>
      {error && <Alert color='red' mb='sm'>{error}</Alert>}
      {drafts === null ? (
        <Loader size='sm' />
      ) : drafts.length === 0 ? (
        <Text size='sm' c='dimmed'>No tiene ofertas guardadas en borrador. Al crear una oferta, apague «Enviar a autorización al crear» para guardarla aquí.</Text>
      ) : (
        <ScrollArea type='auto'>
          <Table striped verticalSpacing='xs' style={{ minWidth: 980 }}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Borrador</Table.Th><Table.Th>Fecha</Table.Th><Table.Th>Entrega</Table.Th><Table.Th>Cliente</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Total</Table.Th><Table.Th>Comentarios</Table.Th><Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {drafts.map((d) => (
                <Table.Tr key={d.docEntry}>
                  <Table.Td style={{ whiteSpace: 'nowrap' }}>
                    {d.docNum ?? d.docEntry}
                    {d.requestId ? <Text size='xs'><Anchor component={Link} href={`/process/request-general/view-request?id=${d.requestId}`}>Solicitud #{d.requestId}</Anchor></Text> : null}
                  </Table.Td>
                  <Table.Td style={{ whiteSpace: 'nowrap' }}>{d.docDate ?? '—'}</Table.Td>
                  <Table.Td style={{ whiteSpace: 'nowrap' }}>{d.dueDate ?? '—'}</Table.Td>
                  <Table.Td><Text size='sm'>{d.cardName ?? (d.missing ? 'No se encontró en SAP' : '')}</Text><Text size='xs' c='dimmed'>{d.cardCode}</Text></Table.Td>
                  <Table.Td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{money(d.total)}</Table.Td>
                  <Table.Td style={{ maxWidth: 260 }}><Text size='xs' lineClamp={2}>{d.comments}</Text></Table.Td>
                  <Table.Td>
                    <Group gap={6} wrap='nowrap'>
                      <Button size='xs' variant='light' leftSection={<IconPencil size={14} />} disabled={busy === d.docEntry || !d.open} onClick={() => setEditing(d)}>Editar</Button>
                      <Button size='xs' leftSection={<IconSend size={14} />} loading={busy === d.docEntry} disabled={!d.open} onClick={() => act(d, 'enviar')}>Enviar a pedido</Button>
                      <Button size='xs' variant='subtle' color='red' leftSection={<IconX size={14} />} disabled={busy === d.docEntry || !d.open} onClick={() => act(d, 'anular')}>Anular</Button>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      )}
      <Modal opened={Boolean(editing)} onClose={() => setEditing(null)} fullScreen title={<Text fw={700}>Editar borrador #{editing?.docNum ?? editing?.docEntry}</Text>}>
        {editing && companyId && (
          <SalesInlineForm
            companyId={companyId}
            editDocEntry={editing.docEntry}
            onDone={({ ok, message }) => {
              if (ok) toast.success(message);
              setEditing(null);
              load();
            }}
          />
        )}
      </Modal>
      <Text size='xs' c='dimmed' mt='sm'>
        Para crear una oferta nueva: <Anchor component={Link} href='/process/request-general/create-request' size='xs'>Mis solicitudes → Crear nueva solicitud</Anchor>.
      </Text>
    </Card>
  );
}
