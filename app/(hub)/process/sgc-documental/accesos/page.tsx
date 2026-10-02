'use client';

import { useState } from 'react';
import { Alert, Badge, Button, Card, Group, Loader, Modal, SegmentedControl, Select, Stack, Table, Tabs, Text, TextInput, Textarea, Title } from '@mantine/core';
import { IconAlertTriangle, IconCheck, IconKey } from '@tabler/icons-react';
import SgcShell from '../../../../../components/sgc/SgcShell';
import { sgcHref } from '../../../../../components/sgc/useSgcCompany';
import { sgcSend, useSgcFetch } from '../../../../../components/sgc/useSgcFetch';
import { useSgcRowLink } from '../../../../../components/sgc/useSgcRowLink';
import { SGC_BASE_URL } from '../../../../../lib/sgc/constants';
import type { SgcAccessRequestRow } from '../../../../../lib/sgc/db/accessRequests';
import type { SgcCompanyAccess } from '../../../../../lib/sgc/permissions';

/**
 * SOLICITUDES DE ACCESO a documentos de otra área (Sprint 5): la persona pide
 * consulta con justificación (eligiendo un documento «por departamento» de
 * otra área o escribiendo el código); Aseguramiento de Calidad decide. Nunca
 * se revela si un código confidencial existe.
 */

interface AccessData {
  mine: SgcAccessRequestRow[];
  all: SgcAccessRequestRow[] | null;
  requestable: { idDocument: number; code: string; title: string; process: string; ownerDepartment: string | null }[];
  canQuality: boolean;
}

const COLOR: Record<string, string> = { pendiente: 'yellow', aprobada: 'green', rechazada: 'red', cancelada: 'gray' };

function StatusBadge({ r }: { r: SgcAccessRequestRow }) {
  return (
    <Badge size='sm' color={COLOR[r.status] ?? 'gray'} variant='light' data-testid='sgc-acceso-estado'>
      {r.statusLabel}
    </Badge>
  );
}

function Accesos({ company }: { company: SgcCompanyAccess }) {
  const rowLink = useSgcRowLink();
  const data = useSgcFetch<AccessData>(`/api/sgc/access-requests?company=${company.idCompany}`);
  const [mode, setMode] = useState<'lista' | 'codigo'>('lista');
  const [idDocument, setIdDocument] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [justification, setJustification] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ color: string; text: string } | null>(null);
  const [deciding, setDeciding] = useState<{ row: SgcAccessRequestRow; decision: 'aprobar' | 'rechazar' } | null>(null);
  const [reason, setReason] = useState('');
  const [expires, setExpires] = useState('');

  const run = async (fn: () => Promise<{ message?: string } | unknown>, ok: string) => {
    setBusy(true);
    setFeedback(null);
    try {
      const r = (await fn()) as { message?: string };
      setFeedback({ color: 'green', text: r?.message ?? ok });
      setDeciding(null);
      setReason('');
      setExpires('');
      data.reload();
      return true;
    } catch (e) {
      setFeedback({ color: 'red', text: e instanceof Error ? e.message : String(e) });
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (data.error) return <Alert color='red'>{data.error}</Alert>;
  if (!data.data) {
    return (
      <Group justify='center' my='xl'>
        <Loader />
      </Group>
    );
  }
  const d = data.data;

  const requestForm = (
    <Card withBorder radius='md' p='lg'>
      <Title order={4} mb='xs' className='flex items-center gap-2'>
        <IconKey size={18} />
        Solicitar acceso de consulta
      </Title>
      <Text size='sm' c='dimmed' mb='md'>
        Para consultar un documento de otra área. Aseguramiento de Calidad revisa la justificación y le notifica la decisión. El acceso es solo de consulta (sin descarga ni
        impresión).
      </Text>
      <Stack>
        <SegmentedControl
          value={mode}
          onChange={(v) => setMode(v as 'lista' | 'codigo')}
          data={[
            { value: 'lista', label: 'Elegir de la lista' },
            { value: 'codigo', label: 'Escribir el código' },
          ]}
        />
        {mode === 'lista' ? (
          <Select
            label='Documento de otra área'
            searchable
            data={d.requestable.map((r) => ({ value: String(r.idDocument), label: `${r.code} · ${r.title} (${r.ownerDepartment ?? r.process})` }))}
            value={idDocument}
            onChange={setIdDocument}
            nothingFoundMessage='No hay documentos de otras áreas para pedir'
            data-testid='sgc-acceso-documento'
          />
        ) : (
          <TextInput autoComplete='off' data-1p-ignore='true' data-lpignore='true' label='Código del documento' placeholder='OLP-GC-PR-001' value={code} onChange={(e) => setCode(e.currentTarget.value)} data-testid='sgc-acceso-codigo' />
        )}
        <Textarea autoComplete='off' data-1p-ignore='true' data-lpignore='true' label='Justificación' required minRows={2} autosize value={justification} onChange={(e) => setJustification(e.currentTarget.value)} description='Mínimo 10 caracteres.' data-testid='sgc-acceso-justificacion' />
        <Group justify='flex-end'>
          <Button
            loading={busy}
            data-testid='sgc-acceso-enviar'
            onClick={async () => {
              const ok = await run(
                () => sgcSend('/api/sgc/access-requests', 'POST', { company: company.idCompany, ...(mode === 'lista' ? { idDocument: idDocument ? Number(idDocument) : null } : { code }), justification }),
                'Solicitud registrada.'
              );
              if (ok) {
                setJustification('');
                setCode('');
                setIdDocument(null);
              }
            }}
          >
            Enviar solicitud
          </Button>
        </Group>
      </Stack>
    </Card>
  );

  const table = (rows: SgcAccessRequestRow[], forQuality: boolean) => (
    <Table.ScrollContainer minWidth={760}>
      <Table verticalSpacing='xs' data-testid={forQuality ? 'sgc-accesos-calidad' : 'sgc-accesos-mios'}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>#</Table.Th>
            <Table.Th>Código</Table.Th>
            {forQuality && <Table.Th>Quién</Table.Th>}
            <Table.Th>Justificación</Table.Th>
            <Table.Th>Estado</Table.Th>
            <Table.Th>Decisión</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.length === 0 && (
            <Table.Tr>
              <Table.Td colSpan={7}>
                <Text size='sm' c='dimmed' ta='center' py='lg'>
                  Sin solicitudes.
                </Text>
              </Table.Td>
            </Table.Tr>
          )}
          {rows.map((r) => (
            <Table.Tr key={r.id} data-testid='sgc-acceso-fila' data-id={r.id} data-code={r.code} data-status={r.status} {...rowLink(r.document ? sgcHref(`${SGC_BASE_URL}/documentos/${r.document.idDocument}`, company.idCompany) : null)}>
              <Table.Td>{r.id}</Table.Td>
              <Table.Td>
                <Text size='sm' ff='monospace'>
                  {r.code}
                </Text>
                {forQuality && (
                  <Text size='xs' c={r.document ? 'dimmed' : 'red'}>
                    {r.document ? r.document.title : 'Sin documento vigente consultable con ese código'}
                  </Text>
                )}
              </Table.Td>
              {forQuality && (
                <Table.Td>
                  <Text size='xs'>{r.requester}</Text>
                </Table.Td>
              )}
              <Table.Td>
                <Text size='xs'>{r.justification}</Text>
                <Text size='xs' c='dimmed'>
                  {r.createdAt.slice(0, 10)}
                </Text>
              </Table.Td>
              <Table.Td>
                <StatusBadge r={r} />
              </Table.Td>
              <Table.Td>
                <Text size='xs'>{r.decisionReason ?? '—'}</Text>
                {r.decidedBy && (
                  <Text size='xs' c='dimmed'>
                    {r.decidedBy} · {r.decidedAt?.slice(0, 10)}
                    {r.accessExpiresAt ? ` · vence ${r.accessExpiresAt.slice(0, 10)}` : ''}
                  </Text>
                )}
              </Table.Td>
              <Table.Td>
                {r.status === 'pendiente' && forQuality && (
                  <Group gap={4} wrap='nowrap'>
                    <Button size='xs' color='green' variant='light' disabled={!r.document} onClick={() => setDeciding({ row: r, decision: 'aprobar' })} data-testid='sgc-acceso-aprobar'>
                      Aprobar
                    </Button>
                    <Button size='xs' color='red' variant='subtle' onClick={() => setDeciding({ row: r, decision: 'rechazar' })} data-testid='sgc-acceso-rechazar'>
                      Rechazar
                    </Button>
                  </Group>
                )}
                {r.status === 'pendiente' && !forQuality && (
                  <Button size='xs' variant='subtle' color='gray' onClick={() => run(() => sgcSend(`/api/sgc/access-requests/${r.id}/cancel`, 'POST', {}), 'Solicitud cancelada.')}>
                    Cancelar
                  </Button>
                )}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );

  return (
    <Stack gap='md'>
      {feedback && (
        <Alert color={feedback.color} withCloseButton onClose={() => setFeedback(null)} icon={feedback.color === 'green' ? <IconCheck size={16} /> : <IconAlertTriangle size={16} />} data-testid='sgc-feedback'>
          {feedback.text}
        </Alert>
      )}
      <Tabs defaultValue='solicitar' keepMounted={false}>
        <Tabs.List mb='md'>
          <Tabs.Tab value='solicitar'>Solicitar acceso</Tabs.Tab>
          <Tabs.Tab value='mias'>Mis solicitudes ({d.mine.length})</Tabs.Tab>
          {d.all && (
            <Tabs.Tab value='calidad' data-testid='sgc-tab-accesos-calidad'>
              Por decidir ({d.all.filter((r) => r.status === 'pendiente').length})
            </Tabs.Tab>
          )}
        </Tabs.List>
        <Tabs.Panel value='solicitar'>{requestForm}</Tabs.Panel>
        <Tabs.Panel value='mias'>
          <Card withBorder radius='md' p='md'>
            {table(d.mine, false)}
          </Card>
        </Tabs.Panel>
        {d.all && (
          <Tabs.Panel value='calidad'>
            <Card withBorder radius='md' p='md'>
              {table(d.all, true)}
            </Card>
          </Tabs.Panel>
        )}
      </Tabs>

      <Modal opened={!!deciding} onClose={() => setDeciding(null)} title={deciding?.decision === 'aprobar' ? 'Aprobar acceso de consulta' : 'Rechazar solicitud'} centered>
        {deciding && (
          <Stack>
            <Text size='sm'>
              {deciding.row.requester} · {deciding.row.code}
            </Text>
            <Textarea autoComplete='off' data-1p-ignore='true' data-lpignore='true' label='Motivo de la decisión' description='Queda en la auditoría y se le notifica a quien pidió.' value={reason} onChange={(e) => setReason(e.currentTarget.value)} data-testid='sgc-acceso-motivo' />
            {deciding.decision === 'aprobar' && <TextInput autoComplete='off' data-1p-ignore='true' data-lpignore='true' type='date' label='Vence (opcional)' value={expires} onChange={(e) => setExpires(e.currentTarget.value)} />}
            <Button
              color={deciding.decision === 'aprobar' ? 'green' : 'red'}
              loading={busy}
              data-testid='sgc-acceso-confirmar'
              onClick={() =>
                run(
                  () => sgcSend(`/api/sgc/access-requests/${deciding.row.id}/decide`, 'POST', { decision: deciding.decision, reason, expiresAt: expires ? `${expires}T23:59:59-05:00` : null }),
                  deciding.decision === 'aprobar' ? 'Acceso aprobado.' : 'Solicitud rechazada.'
                )
              }
            >
              {deciding.decision === 'aprobar' ? 'Aprobar' : 'Rechazar'}
            </Button>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}

export default function SgcAccesosPage() {
  return (
    <SgcShell section='Solicitudes de acceso' subtitle='Pida consultar un documento de otra área, con su justificación; Aseguramiento de Calidad decide.'>
      {(company) => <Accesos company={company} />}
    </SgcShell>
  );
}
