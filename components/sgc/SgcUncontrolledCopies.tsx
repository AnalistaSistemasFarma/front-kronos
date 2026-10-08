'use client';

import { useMemo, useState } from 'react';
import { Alert, Badge, Button, Card, Group, Modal, NumberInput, Stack, Table, Text, TextInput, Textarea, Title } from '@mantine/core';
import { IconAlertTriangle, IconCheck, IconCopy, IconDownload, IconPrinter, IconX } from '@tabler/icons-react';
import { SGC_COPY_DESTINATIONS, SGC_COPY_DESTINATION_LABELS } from '../../lib/sgc/uncontrolledCopies';
import type { SgcCopyView } from '../../lib/sgc/db/uncontrolledCopies';
import SgcSelect from './SgcSelect';
import { printAuthorized } from './SgcSecureViewer';
import { sgcSend, useSgcFetch } from './useSgcFetch';

/**
 * COPIAS NO CONTROLADAS (Sprint 11) — piezas de pantalla:
 *   - SgcCopyRequestForm: la persona pide la copia (documento vigente de un
 *     tipo permitido, justificación, destino y días);
 *   - SgcMyCopies: sus copias, con «Imprimir» (y «Descargar» si es para un
 *     tercero) mientras estén autorizadas y vigentes;
 *   - SgcCopiesQuality: el grupo exclusivo decide (con motivo) y Calidad ve el
 *     historial y el reporte (quién, cuándo, por qué y quién autorizó).
 */

const STATUS_COLOR: Record<string, string> = { pendiente: 'blue', autorizada: 'green', rechazada: 'red', cancelada: 'gray', vencida: 'orange' };

function fmt(iso: string | null): string {
  if (!iso) return '—';
  return new Date(new Date(iso).getTime() - 5 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ');
}

export function SgcCopyRequestForm({ idCompany, initialDocument = null, onDone }: { idCompany: number; initialDocument?: string | null; onDone?: () => void }) {
  const docs = useSgcFetch<{ documents: { idDocument: number; code: string; title: string; versionNumber: number | null; documentType: { code: string } }[] }>(`/api/sgc/documents?company=${idCompany}`);
  const mine = useSgcFetch<{ config: { types: string[]; days: number; maxDays: number } }>(`/api/sgc/uncontrolled-copies?company=${idCompany}`);
  const cfg = mine.data?.config;
  const options = useMemo(() => (docs.data?.documents ?? []).filter((d) => !cfg || cfg.types.includes(d.documentType.code)), [docs.data, cfg]);
  const [idDocument, setIdDocument] = useState<string | null>(initialDocument);
  const [justification, setJustification] = useState('');
  const [destination, setDestination] = useState<string>('interno');
  const [detail, setDetail] = useState('');
  const [days, setDays] = useState<number | string>('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const submit = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await sgcSend('/api/sgc/uncontrolled-copies', 'POST', { company: idCompany, idDocument: Number(idDocument), justification, destination, destinationDetail: detail, days: days === '' ? undefined : Number(days) });
      setMsg({ ok: true, text: 'Solicitud enviada: la decide Aseguramiento de Calidad. Le avisamos por la campana.' });
      setJustification('');
      setDetail('');
      onDone?.();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Stack data-testid='sgc-copia-formulario'>
      {msg && (
        <Alert color={msg.ok ? 'green' : 'red'} icon={msg.ok ? <IconCheck size={16} /> : <IconAlertTriangle size={16} />} data-testid='sgc-copia-mensaje'>
          {msg.text}
        </Alert>
      )}
      <Text size='sm' c='dimmed'>
        Una copia no controlada sale de la compañía o se diligencia a mano (por ejemplo, un formato que se envía a un cliente). Se imprime con la marca «COPIA NO CONTROLADA» y vence a los días autorizados. Solo
        {cfg ? ` ${cfg.types.join(', ')}` : ' formatos'}. La decide Aseguramiento de Calidad.
      </Text>
      <SgcSelect
        label='Documento vigente'
        required
        searchable
        data={options.map((d) => ({ value: String(d.idDocument), label: `${d.code} · V${d.versionNumber ?? '-'} · ${d.title}` }))}
        value={idDocument}
        onChange={setIdDocument}
        nothingFoundMessage='No hay documentos que admitan copia no controlada'
        data-testid='sgc-copia-documento'
      />
      <Textarea label='Justificación' description='¿Para qué la necesita? Por ejemplo: «lo voy a llenar a mano» o «se envía al cliente X».' required autosize minRows={2} value={justification} onChange={(e) => setJustification(e.currentTarget.value)} data-testid='sgc-copia-justificacion' />
      <Group grow align='flex-start'>
        <SgcSelect label='Destino' data={SGC_COPY_DESTINATIONS.map((d) => ({ value: d, label: SGC_COPY_DESTINATION_LABELS[d] }))} value={destination} onChange={(v) => setDestination(v ?? 'interno')} allowDeselect={false} data-testid='sgc-copia-destino' />
        <NumberInput label='Días de vigencia' description={cfg ? `Por defecto ${cfg.days}; máximo ${cfg.maxDays}.` : undefined} min={1} max={cfg?.maxDays ?? 90} value={days} onChange={setDays} data-testid='sgc-copia-dias' />
      </Group>
      {destination === 'tercero' && <TextInput label='¿A quién se entrega?' required value={detail} onChange={(e) => setDetail(e.currentTarget.value)} data-testid='sgc-copia-destino-detalle' />}
      <Group justify='flex-end'>
        <Button leftSection={<IconCopy size={16} />} loading={busy} disabled={!idDocument || justification.trim().length < 10} onClick={() => void submit()} data-testid='sgc-copia-enviar'>
          Solicitar copia no controlada
        </Button>
      </Group>
    </Stack>
  );
}

export function SgcMyCopies({ idCompany, compact = false }: { idCompany: number; compact?: boolean }) {
  const { data, reload } = useSgcFetch<{ copies: SgcCopyView[] }>(`/api/sgc/uncontrolled-copies?company=${idCompany}`);
  const [error, setError] = useState<string | null>(null);
  const copies = data?.copies ?? [];
  if (compact && copies.length === 0) return null;
  return (
    <Card withBorder radius='md' p='lg' data-testid='sgc-mis-copias'>
      <Title order={5} mb='sm'>
        Mis copias no controladas
      </Title>
      {error && (
        <Alert color='red' mb='sm' withCloseButton onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {copies.length === 0 ? (
        <Text size='sm' c='dimmed'>
          Aún no ha pedido copias no controladas.
        </Text>
      ) : (
        <Table.ScrollContainer minWidth={640}>
          <Table striped verticalSpacing='xs'>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Documento</Table.Th>
                <Table.Th>Estado</Table.Th>
                <Table.Th>Vence</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {copies.map((c) => (
                <Table.Tr key={c.id} data-testid='sgc-mi-copia'>
                  <Table.Td>
                    <Text size='sm' ff='monospace'>
                      {c.code} V{c.versionNumber ?? '-'}
                    </Text>
                    <Text size='xs' c='dimmed'>
                      {c.title}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge color={STATUS_COLOR[c.status] ?? 'gray'} variant='light'>
                      {c.statusLabel}
                    </Badge>
                    {c.decisionReason && (
                      <Text size='xs' c='dimmed'>
                        {c.decisionReason}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>{fmt(c.expiresAt)}</Table.Td>
                  <Table.Td>
                    <Group gap='xs' wrap='nowrap'>
                      {c.canPrint && (
                        <Button size='xs' variant='light' leftSection={<IconPrinter size={14} />} onClick={() => printAuthorized(`/api/sgc/uncontrolled-copies/${c.id}/file?modo=impresion`).then(reload).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))} data-testid='sgc-copia-imprimir'>
                          Imprimir
                        </Button>
                      )}
                      {c.canDownload && (
                        <Button size='xs' variant='light' component='a' href={`/api/sgc/uncontrolled-copies/${c.id}/file?modo=descarga`} leftSection={<IconDownload size={14} />} data-testid='sgc-copia-descargar'>
                          Descargar
                        </Button>
                      )}
                      {c.status === 'pendiente' && (
                        <Button size='xs' variant='subtle' color='gray' onClick={() => sgcSend(`/api/sgc/uncontrolled-copies/${c.id}/cancel`, 'POST', { company: idCompany }).then(reload).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))}>
                          Cancelar
                        </Button>
                      )}
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </Card>
  );
}

export function SgcCopiesQuality({ idCompany }: { idCompany: number }) {
  const { data, error, reload } = useSgcFetch<{ canDecide: boolean; copies: SgcCopyView[] }>(`/api/sgc/uncontrolled-copies?company=${idCompany}&vista=calidad`);
  const [deciding, setDeciding] = useState<{ copy: SgcCopyView; decision: 'autorizar' | 'rechazar' } | null>(null);
  const [reason, setReason] = useState('');
  const [days, setDays] = useState<number | string>('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (error) return <Alert color='gray'>{error}</Alert>;
  if (!data) return null;
  const pending = data.copies.filter((c) => c.status === 'pendiente');
  const decide = async () => {
    if (!deciding) return;
    setMsg(null);
    try {
      await sgcSend(`/api/sgc/uncontrolled-copies/${deciding.copy.id}/decision`, 'POST', { company: idCompany, decision: deciding.decision, reason, days: days === '' ? undefined : Number(days) });
      setMsg({ ok: true, text: deciding.decision === 'autorizar' ? 'Copia autorizada.' : 'Copia rechazada.' });
      setDeciding(null);
      setReason('');
      setDays('');
      reload();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  };
  const exportExcel = async () => {
    const { default: ExcelJS } = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Copias no controladas');
    ws.addRow(['Solicitud', 'Documento', 'Versión', 'Pidió', 'Fecha', 'Justificación', 'Destino', 'Estado', 'Decidió', 'Fecha decisión', 'Motivo', 'Vence', 'Impresiones', 'Descargas']).font = { bold: true };
    for (const c of data.copies) ws.addRow([c.id, c.code, c.versionNumber, c.requester, fmt(c.createdAt), c.justification, c.destinationDetail ? `${c.destinationLabel}: ${c.destinationDetail}` : c.destinationLabel, c.statusLabel, c.decidedBy ?? '', fmt(c.decidedAt), c.decisionReason ?? '', fmt(c.expiresAt), c.events.filter((e) => e.event === 'impresion').length, c.events.filter((e) => e.event === 'descarga').length]);
    const blob = new Blob([await wb.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'reporte-copias-no-controladas.xlsx';
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <Stack>
      {msg && (
        <Alert color={msg.ok ? 'green' : 'red'} withCloseButton onClose={() => setMsg(null)} data-testid='sgc-copias-mensaje'>
          {msg.text}
        </Alert>
      )}
      {data.canDecide && (
        <Card withBorder radius='md' p='lg' data-testid='sgc-copias-por-decidir'>
          <Title order={5} mb='sm'>
            Por decidir ({pending.length})
          </Title>
          {pending.length === 0 ? (
            <Text size='sm' c='dimmed'>
              No hay solicitudes pendientes.
            </Text>
          ) : (
            <Table.ScrollContainer minWidth={720}>
              <Table striped verticalSpacing='xs'>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Documento</Table.Th>
                    <Table.Th>Pidió</Table.Th>
                    <Table.Th>Justificación y destino</Table.Th>
                    <Table.Th>Días</Table.Th>
                    <Table.Th />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {pending.map((c) => (
                    <Table.Tr key={c.id} data-testid='sgc-copia-pendiente'>
                      <Table.Td ff='monospace'>{c.code}</Table.Td>
                      <Table.Td>{c.requester}</Table.Td>
                      <Table.Td>
                        <Text size='sm'>{c.justification}</Text>
                        <Text size='xs' c='dimmed'>
                          {c.destinationLabel}
                          {c.destinationDetail ? `: ${c.destinationDetail}` : ''}
                        </Text>
                      </Table.Td>
                      <Table.Td>{c.days}</Table.Td>
                      <Table.Td>
                        <Group gap='xs' wrap='nowrap'>
                          <Button size='xs' color='green' leftSection={<IconCheck size={14} />} onClick={() => setDeciding({ copy: c, decision: 'autorizar' })} data-testid='sgc-copia-autorizar'>
                            Autorizar
                          </Button>
                          <Button size='xs' color='red' variant='light' leftSection={<IconX size={14} />} onClick={() => setDeciding({ copy: c, decision: 'rechazar' })} data-testid='sgc-copia-rechazar'>
                            Rechazar
                          </Button>
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )}
        </Card>
      )}
      <Card withBorder radius='md' p='lg' data-testid='sgc-copias-historial'>
        <Group justify='space-between' mb='sm'>
          <Title order={5}>Historial y reporte</Title>
          <Button size='xs' variant='light' leftSection={<IconDownload size={14} />} onClick={() => void exportExcel()} disabled={data.copies.length === 0}>
            Reporte (Excel)
          </Button>
        </Group>
        <Table.ScrollContainer minWidth={900}>
          <Table striped verticalSpacing='xs'>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Documento</Table.Th>
                <Table.Th>Pidió · cuándo</Table.Th>
                <Table.Th>Por qué</Table.Th>
                <Table.Th>Estado</Table.Th>
                <Table.Th>Decidió · motivo</Table.Th>
                <Table.Th>Usos</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data.copies.map((c) => (
                <Table.Tr key={c.id} data-testid='sgc-copia-historial'>
                  <Table.Td ff='monospace'>
                    {c.code} V{c.versionNumber ?? '-'}
                  </Table.Td>
                  <Table.Td>
                    <Text size='sm'>{c.requester}</Text>
                    <Text size='xs' c='dimmed'>
                      {fmt(c.createdAt)}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size='sm'>{c.justification}</Text>
                    <Text size='xs' c='dimmed'>
                      {c.destinationLabel}
                      {c.destinationDetail ? `: ${c.destinationDetail}` : ''}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge color={STATUS_COLOR[c.status] ?? 'gray'} variant='light'>
                      {c.statusLabel}
                    </Badge>
                    {c.expiresAt && (
                      <Text size='xs' c='dimmed'>
                        Vence {fmt(c.expiresAt)}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Text size='sm'>{c.decidedBy ?? '—'}</Text>
                    <Text size='xs' c='dimmed'>
                      {c.decisionReason ?? ''}
                    </Text>
                  </Table.Td>
                  <Table.Td>{c.events.length ? c.events.map((e) => `${e.event === 'descarga' ? 'Descargó' : 'Imprimió'} ${fmt(e.at)}`).join(' · ') : '—'}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Card>
      <Modal opened={!!deciding} onClose={() => setDeciding(null)} title={deciding?.decision === 'autorizar' ? 'Autorizar copia no controlada' : 'Rechazar copia no controlada'} centered>
        {deciding && (
          <Stack>
            <Text size='sm'>
              {deciding.copy.code} · pidió {deciding.copy.requester}: {deciding.copy.justification}
            </Text>
            {deciding.decision === 'autorizar' && <NumberInput label='Días de vigencia' description={`Pidió ${deciding.copy.days} día(s).`} min={1} value={days} onChange={setDays} />}
            <Textarea label='Motivo' description='Mínimo 10 caracteres: queda en el historial.' required autosize minRows={2} value={reason} onChange={(e) => setReason(e.currentTarget.value)} data-testid='sgc-copia-motivo' />
            <Button color={deciding.decision === 'autorizar' ? 'green' : 'red'} disabled={reason.trim().length < 10} onClick={() => void decide()} data-testid='sgc-copia-confirmar'>
              {deciding.decision === 'autorizar' ? 'Autorizar' : 'Rechazar'}
            </Button>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}
