'use client';

import { useMemo, useState } from 'react';
import { Alert, Badge, Button, Card, Code, Group, Image, Modal, Stack, Table, Text, TextInput, Textarea, Title } from '@mantine/core';
import SgcSelect from '../../../../../components/sgc/SgcSelect';
import { IconAlertCircle, IconCheck, IconSignature, IconX } from '@tabler/icons-react';
import SgcShell from '../../../../../components/sgc/SgcShell';
import SgcSignaturePad from '../../../../../components/sgc/signature/SgcSignaturePad';
import { formatDateCO } from '../../../../../components/sgc/tareas/format';
import { sgcSend, useSgcFetch } from '../../../../../components/sgc/useSgcFetch';
import { SGC_SIGNATURE_AUTH_METHOD_LABEL, SGC_SIGNATURE_CONSENT, SGC_SIGNATURE_CONSENT_VERSION } from '../../../../../lib/sgc/signature/consent';
import type { SgcCompanyAccess } from '../../../../../lib/sgc/permissions';
import { SGC_MASTER_STATUS_LABELS, type SgcMasterStatus } from '../../../../../lib/sgc/signature/ownSignature';

/**
 * «Firma electrónica del SGC» — MAESTRO DE FIRMAS (Sprint 3, solo Calidad).
 * En la inducción, Aseguramiento de Calidad registra el trazo de cada persona
 * (copia congelada del SignaturePad de GSS Firma/Orión). Cada registro es una
 * versión nueva; la anterior queda revocada con motivo; nada se borra. El
 * trazo es complementario: la firma electrónica es la reautenticación con
 * contraseña + significado + motivo + sello de tiempo (el trazo se muestra en
 * el manifiesto del PDF controlado).
 */

interface MasterRow {
  id: number;
  email: string;
  name: string | null;
  versionNumber: number;
  imagePng: string | null;
  imageSha256: string;
  registeredBy: string;
  registeredAt: string;
  reason: string;
  revokedAt: string | null;
  revokedBy: string | null;
  revokeReason: string | null;
  // Sprint 13: firma propia (origen, método y validación de Calidad).
  origin: 'calidad' | 'propia';
  captureMethod: 'dibujada' | 'imagen' | null;
  status: SgcMasterStatus;
  validatedBy: string | null;
  validatedAt: string | null;
}

const STATUS_COLOR: Record<SgcMasterStatus, string> = { validada: 'teal', pendiente: 'orange', rechazada: 'red', revocada: 'gray' };

function Masters({ company }: { company: SgcCompanyAccess }) {
  const id = company.idCompany;
  const { data, error, reload } = useSgcFetch<{ masters: MasterRow[] }>(`/api/sgc/signature/masters?company=${id}`);
  const users = useSgcFetch<{ users: { email: string; name: string | null }[] }>(`/api/sgc/users?company=${id}`);
  // Sprint 13: con la firma propia encendida, Calidad ya no registra firmas de otros: valida o revoca.
  const own = useSgcFetch<{ enabled: boolean }>(`/api/sgc/signature/own?company=${id}`);
  const selfSignature = Boolean(own.data?.enabled);
  const [validate, setValidate] = useState<{ id: number; label: string; reason: string } | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [revoke, setRevoke] = useState<{ id: number; reason: string } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const options = useMemo(() => (users.data?.users ?? []).map((u) => ({ value: u.email, label: u.name ? `${u.name} (${u.email})` : u.email })), [users.data]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: ok });
      reload();
      return true;
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack>
      {msg && (
        <Alert color={msg.ok ? 'green' : 'red'} icon={msg.ok ? <IconCheck size={16} /> : <IconAlertCircle size={16} />} data-testid='sgc-firmas-mensaje'>
          {msg.text}
        </Alert>
      )}
      <Card withBorder radius='md' p='lg'>
        <Title order={4} mb='xs' className='flex items-center gap-2'>
          <IconSignature size={18} /> Cómo firma el SGC
        </Title>
        <Text size='sm'>{SGC_SIGNATURE_CONSENT.body}</Text>
        <Text size='xs' c='dimmed' mt='xs'>
          Método: {SGC_SIGNATURE_AUTH_METHOD_LABEL}. Texto del consentimiento: versión <Code>{SGC_SIGNATURE_CONSENT_VERSION}</Code>. Las evidencias quedan en la carpeta propia de la empresa (<Code>SGC/…/_firmas/</Code>). No depende de GSS Firma/Orión.
        </Text>
      </Card>

      {selfSignature && (
        <Alert color='blue' icon={<IconAlertCircle size={16} />} data-testid='sgc-firmas-propia-activa'>
          La firma propia está activa: cada persona registra la suya en «Mi firma» y queda pendiente. Aseguramiento de Calidad la valida (por ejemplo, comparándola con el documento de identidad) o la rechaza con motivo. Nadie valida su propia firma.
        </Alert>
      )}

      {!selfSignature && (
      <Card withBorder radius='md' p='lg'>
        <Title order={4} mb='sm'>
          Registrar firma (inducción)
        </Title>
        <Stack>
          <SgcSelect label='Persona' placeholder='Elija la persona' data={options} value={email} onChange={setEmail} searchable data-testid='sgc-firmas-persona' />
          <TextInput autoComplete='off' data-1p-ignore='true' data-lpignore='true' label='Motivo' placeholder='Inducción al SGC del 2026-10-01' value={reason} onChange={(e) => setReason(e.currentTarget.value)} data-testid='sgc-firmas-motivo' />
          {image ? (
            <Group>
              <Image src={image} alt='Firma dibujada' h={80} w='auto' fit='contain' radius='sm' />
              <Button variant='default' onClick={() => setImage(null)}>
                Volver a dibujar
              </Button>
            </Group>
          ) : (
            <SgcSignaturePad onSave={setImage} />
          )}
          <Group justify='flex-end'>
            <Button
              disabled={!email || !image || reason.trim().length < 5}
              loading={busy}
              onClick={async () => {
                const ok = await act(() => sgcSend('/api/sgc/signature/masters', 'POST', { company: id, email, imagePng: image, reason: reason.trim() }), 'Firma registrada en el maestro.');
                if (ok) {
                  setImage(null);
                  setReason('');
                }
              }}
              data-testid='sgc-firmas-registrar'
            >
              Registrar firma
            </Button>
          </Group>
        </Stack>
      </Card>
      )}

      <Card withBorder radius='md' p='lg'>
        <Title order={4} mb='sm'>
          Maestro de firmas
        </Title>
        {error && <Alert color='red'>{error}</Alert>}
        <Table.ScrollContainer minWidth={640}>
          <Table withTableBorder striped verticalSpacing='xs'>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Persona</Table.Th>
                <Table.Th>Versión</Table.Th>
                <Table.Th>Trazo</Table.Th>
                <Table.Th>Registró</Table.Th>
                <Table.Th>Estado</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(data?.masters ?? []).map((m) => (
                <Table.Tr key={m.id} data-testid='sgc-firmas-fila'>
                  <Table.Td>
                    <Text size='sm'>{m.name ?? m.email}</Text>
                    <Text size='xs' c='dimmed'>
                      {m.email}
                    </Text>
                  </Table.Td>
                  <Table.Td>{m.versionNumber}</Table.Td>
                  <Table.Td>{m.imagePng ? <Image src={m.imagePng} alt={`Firma de ${m.email}`} h={40} w='auto' fit='contain' /> : <Text size='xs' c='dimmed'>—</Text>}</Table.Td>
                  <Table.Td>
                    <Text size='xs'>{m.registeredBy}</Text>
                    <Text size='xs' c='dimmed'>
                      {formatDateCO(m.registeredAt)} · {m.reason}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge color={STATUS_COLOR[m.status] ?? 'gray'} title={m.revokeReason ?? ''}>
                      {SGC_MASTER_STATUS_LABELS[m.status] ?? m.status}
                    </Badge>
                    <Text size='xs' c='dimmed'>
                      {m.origin === 'propia' ? `Propia (${m.captureMethod === 'imagen' ? 'imagen' : 'dibujada'})` : 'Registrada por Calidad'}
                      {m.validatedBy ? ` · validó ${m.validatedBy}` : ''}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Group gap={4} wrap='nowrap'>
                      {m.status === 'pendiente' && (
                        <Button size='xs' variant='light' color='teal' leftSection={<IconCheck size={14} />} onClick={() => setValidate({ id: m.id, label: m.name ?? m.email, reason: '' })} data-testid={`sgc-firmas-validar-${m.id}`}>
                          Validar
                        </Button>
                      )}
                      {!m.revokedAt && (
                        <Button size='xs' variant='subtle' color='red' leftSection={<IconX size={14} />} onClick={() => setRevoke({ id: m.id, reason: '' })}>
                          {m.status === 'pendiente' ? 'Rechazar' : 'Revocar'}
                        </Button>
                      )}
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Card>

      <Modal opened={Boolean(validate)} onClose={() => setValidate(null)} title={`Validar la firma de ${validate?.label ?? ''}`} centered>
        <Stack>
          <Textarea autoComplete='off' data-1p-ignore='true' data-lpignore='true' label='Cómo la validó' placeholder='Comparada con la cédula en la inducción' minRows={2} autosize value={validate?.reason ?? ''} onChange={(e) => setValidate((v) => (v ? { ...v, reason: e.currentTarget.value } : v))} data-testid='sgc-firmas-validar-motivo' />
          <Group justify='flex-end'>
            <Button variant='default' onClick={() => setValidate(null)}>
              Volver
            </Button>
            <Button
              color='teal'
              disabled={(validate?.reason.trim().length ?? 0) < 5}
              loading={busy}
              onClick={async () => {
                if (!validate) return;
                const ok = await act(() => sgcSend(`/api/sgc/signature/masters/${validate.id}/validate`, 'POST', { company: id, reason: validate.reason.trim() }), 'Firma validada: desde ahora se estampa en los documentos que firme.');
                if (ok) setValidate(null);
              }}
              data-testid='sgc-firmas-validar-confirmar'
            >
              Validar
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={Boolean(revoke)} onClose={() => setRevoke(null)} title='Revocar o rechazar firma registrada' centered>
        <Stack>
          <Textarea autoComplete='off' data-1p-ignore='true' data-lpignore='true' label='Motivo' minRows={2} autosize value={revoke?.reason ?? ''} onChange={(e) => setRevoke((r) => (r ? { ...r, reason: e.currentTarget.value } : r))} />
          <Group justify='flex-end'>
            <Button variant='default' onClick={() => setRevoke(null)}>
              Volver
            </Button>
            <Button
              color='red'
              disabled={(revoke?.reason.trim().length ?? 0) < 5}
              loading={busy}
              onClick={async () => {
                if (!revoke) return;
                const ok = await act(() => sgcSend(`/api/sgc/signature/masters/${revoke.id}/revoke`, 'POST', { company: id, reason: revoke.reason.trim() }), 'Firma revocada (queda en el historial).');
                if (ok) setRevoke(null);
              }}
            >
              Revocar
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}

export default function SgcSignatureMastersPage() {
  return (
    <SgcShell section='Firma electrónica' subtitle='Maestro de firmas: Aseguramiento de Calidad registra (inducción) o valida la firma propia de cada persona' requireQuality>
      {(company) => <Masters company={company} />}
    </SgcShell>
  );
}
