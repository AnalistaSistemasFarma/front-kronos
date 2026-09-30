'use client';

import { useMemo, useState } from 'react';
import { Alert, Badge, Button, Card, Code, Group, Image, Modal, Select, Stack, Table, Text, TextInput, Textarea, Title } from '@mantine/core';
import { IconAlertCircle, IconCheck, IconSignature, IconX } from '@tabler/icons-react';
import SgcShell from '../../../../../components/sgc/SgcShell';
import SgcSignaturePad from '../../../../../components/sgc/signature/SgcSignaturePad';
import { formatDateCO } from '../../../../../components/sgc/tareas/format';
import { sgcSend, useSgcFetch } from '../../../../../components/sgc/useSgcFetch';
import { SGC_SIGNATURE_AUTH_METHOD_LABEL, SGC_SIGNATURE_CONSENT, SGC_SIGNATURE_CONSENT_VERSION } from '../../../../../lib/sgc/signature/consent';
import type { SgcCompanyAccess } from '../../../../../lib/sgc/permissions';

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
}

function Masters({ company }: { company: SgcCompanyAccess }) {
  const id = company.idCompany;
  const { data, error, reload } = useSgcFetch<{ masters: MasterRow[] }>(`/api/sgc/signature/masters?company=${id}`);
  const users = useSgcFetch<{ users: { email: string; name: string | null }[] }>(`/api/sgc/users?company=${id}`);
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

      <Card withBorder radius='md' p='lg'>
        <Title order={4} mb='sm'>
          Registrar firma (inducción)
        </Title>
        <Stack>
          <Select label='Persona' placeholder='Elija la persona' data={options} value={email} onChange={setEmail} searchable data-testid='sgc-firmas-persona' />
          <TextInput label='Motivo' placeholder='Inducción al SGC del 2026-10-01' value={reason} onChange={(e) => setReason(e.currentTarget.value)} data-testid='sgc-firmas-motivo' />
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

      <Card withBorder radius='md' p='lg'>
        <Title order={4} mb='sm'>
          Maestro de firmas
        </Title>
        {error && <Alert color='red'>{error}</Alert>}
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
                  {m.revokedAt ? (
                    <Badge color='gray' title={m.revokeReason ?? ''}>
                      Revocada
                    </Badge>
                  ) : (
                    <Badge color='teal'>Vigente</Badge>
                  )}
                </Table.Td>
                <Table.Td>
                  {!m.revokedAt && (
                    <Button size='xs' variant='subtle' color='red' leftSection={<IconX size={14} />} onClick={() => setRevoke({ id: m.id, reason: '' })}>
                      Revocar
                    </Button>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Card>

      <Modal opened={Boolean(revoke)} onClose={() => setRevoke(null)} title='Revocar firma registrada' centered>
        <Stack>
          <Textarea label='Motivo' minRows={2} autosize value={revoke?.reason ?? ''} onChange={(e) => setRevoke((r) => (r ? { ...r, reason: e.currentTarget.value } : r))} />
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
    <SgcShell section='Firma electrónica del SGC' subtitle='Maestro de firmas registrado por Aseguramiento de Calidad' requireQuality>
      {(company) => <Masters company={company} />}
    </SgcShell>
  );
}
