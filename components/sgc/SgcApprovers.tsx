'use client';

import { useMemo, useState } from 'react';
import { Alert, Autocomplete, Badge, Button, Card, Group, Modal, Stack, Table, Text, TextInput, Textarea } from '@mantine/core';
import SgcSelect, { sgcTouchComboboxProps } from './SgcSelect';
import { IconPlus, IconX } from '@tabler/icons-react';
import { formatDateCO } from './tareas/format';
import { sgcSend, useSgcFetch } from './useSgcFetch';

/**
 * APROBADORES AUTORIZADOS (Sprint 12, R11; solo Calidad). Misma pantalla que
 * «Personas por cargo» (SgcCargoMembers, copia congelada): formulario arriba
 * y tabla abajo, con motivo en cada cambio. La lista es por PERSONA y proceso
 * (decisión D9); con al menos una persona registrada, el servidor solo deja
 * como aprobador a quien esté vigente en ella. Nada se borra: se revoca.
 */
interface Item {
  id: number;
  email: string;
  idProcessMap: number | null;
  process: string;
  validFrom: string | null;
  validTo: string | null;
  reason: string;
  grantedBy: string;
  grantedAt: string;
  revokedBy: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
  status: 'vigente' | 'programada' | 'vencida' | 'revocada';
}
interface Data {
  enforced: boolean;
  applies: boolean;
  items: Item[];
}

const STATUS_COLOR: Record<Item['status'], string> = { vigente: 'green', programada: 'blue', vencida: 'gray', revocada: 'red' };
const STATUS_LABEL: Record<Item['status'], string> = { vigente: 'Vigente', programada: 'Programada', vencida: 'Vencida', revocada: 'Revocada' };

export default function SgcApprovers({ idCompany, processes }: { idCompany: number; processes: { id: number; code: string; name: string }[] }) {
  const { data, error, reload } = useSgcFetch<Data>(`/api/sgc/approvers?company=${idCompany}`);
  const users = useSgcFetch<{ users: { email: string; name: string | null }[] }>(`/api/sgc/users?company=${idCompany}`);
  const [proc, setProc] = useState<string | null>('todos');
  const [email, setEmail] = useState('');
  const [validFrom, setValidFrom] = useState('');
  const [validTo, setValidTo] = useState('');
  const [reason, setReason] = useState('');
  const [revoke, setRevoke] = useState<{ id: number; label: string; reason: string } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const options = useMemo(() => (users.data?.users ?? []).map((u) => u.email), [users.data]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: ok });
      reload();
      return true;
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
      return false;
    }
  };

  if (error) return <Alert color='red'>{error}</Alert>;
  return (
    <Card withBorder radius='md' p='lg' shadow='xs' data-testid='sgc-aprobadores'>
      <Stack>
        <Text size='sm' c='dimmed'>
          Registre quién APRUEBA documentos (por persona y proceso, o en todos los procesos), con vigencia y motivo. En el área todos elaboran y revisan; aprobar, solo quien esté aquí. Cada cambio queda en la auditoría.
        </Text>
        {data && (
          <Alert color={data.applies ? 'blue' : 'yellow'} variant='light' data-testid='sgc-aprobadores-estado'>
            {data.applies
              ? 'La lista está ACTIVA: solo las personas vigentes aquí quedan como aprobadoras (y como sustitutas de un aprobador).'
              : data.enforced
                ? 'La lista está vacía: mientras no registre a nadie, cualquier persona con permiso de gestión del SGC puede ser aprobadora.'
                : 'La lista está desactivada en la configuración de la empresa: no se restringe a los aprobadores.'}
          </Alert>
        )}
        {msg && <Alert color={msg.ok ? 'green' : 'red'}>{msg.text}</Alert>}
        <Group align='flex-end' wrap='wrap'>
          <Autocomplete comboboxProps={sgcTouchComboboxProps()} autoComplete='off' data-1p-ignore='true' data-lpignore='true' label='Correo de la persona' data={options} value={email} onChange={setEmail} w={300} data-testid='sgc-aprobadores-correo' />
          <SgcSelect
            label='Proceso'
            data={[{ value: 'todos', label: 'Todos los procesos' }, ...processes.map((p) => ({ value: String(p.id), label: `${p.code} · ${p.name}` }))]}
            value={proc}
            onChange={setProc}
            searchable
            w={300}
          />
          <TextInput type='date' label='Vigente desde' value={validFrom} onChange={(e) => setValidFrom(e.currentTarget.value)} w={160} />
          <TextInput type='date' label='Vigente hasta (opcional)' value={validTo} onChange={(e) => setValidTo(e.currentTarget.value)} w={180} />
          <Textarea autoComplete='off' data-1p-ignore='true' data-lpignore='true' label='Motivo' autosize minRows={1} value={reason} onChange={(e) => setReason(e.currentTarget.value)} w={260} data-testid='sgc-aprobadores-motivo' />
          <Button
            leftSection={<IconPlus size={14} />}
            disabled={!email.includes('@') || reason.trim().length < 5}
            onClick={async () => {
              const ok = await act(
                () =>
                  sgcSend('/api/sgc/approvers', 'POST', {
                    company: idCompany,
                    email: email.trim(),
                    idProcessMap: proc && proc !== 'todos' ? Number(proc) : null,
                    validFrom: validFrom || null,
                    validTo: validTo || null,
                    reason: reason.trim(),
                  }),
                'Aprobador autorizado.'
              );
              if (ok) {
                setEmail('');
                setReason('');
                setValidTo('');
              }
            }}
            data-testid='sgc-aprobadores-registrar'
          >
            Autorizar
          </Button>
        </Group>
        <Table.ScrollContainer minWidth={720}>
          <Table striped>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Persona</Table.Th>
                <Table.Th>Proceso</Table.Th>
                <Table.Th>Vigencia</Table.Th>
                <Table.Th>Estado</Table.Th>
                <Table.Th>Registrado</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(data?.items ?? []).map((m) => (
                <Table.Tr key={m.id}>
                  <Table.Td>{m.email}</Table.Td>
                  <Table.Td>{m.process}</Table.Td>
                  <Table.Td>
                    <Text size='xs'>
                      {m.validFrom} → {m.validTo ?? 'sin vencimiento'}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge color={STATUS_COLOR[m.status]} variant='light' size='sm'>
                      {STATUS_LABEL[m.status]}
                    </Badge>
                    {m.revokeReason && (
                      <Text size='xs' c='dimmed'>
                        {m.revokedBy}: {m.revokeReason}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Text size='xs'>
                      {m.grantedBy} · {formatDateCO(m.grantedAt)}
                    </Text>
                    <Text size='xs' c='dimmed'>
                      {m.reason}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    {!m.revokedAt && (
                      <Button size='xs' variant='subtle' color='red' leftSection={<IconX size={12} />} onClick={() => setRevoke({ id: m.id, label: `${m.email} (${m.process})`, reason: '' })}>
                        Revocar
                      </Button>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
              {data && data.items.length === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={6}>
                    <Text size='sm' c='dimmed'>
                      Aún no hay aprobadores autorizados.
                    </Text>
                  </Table.Td>
                </Table.Tr>
              )}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Stack>
      <Modal opened={Boolean(revoke)} onClose={() => setRevoke(null)} title={`Revocar ${revoke?.label ?? ''}`} centered>
        <Stack>
          <Textarea autoComplete='off' data-1p-ignore='true' data-lpignore='true' label='Motivo' required autosize minRows={2} value={revoke?.reason ?? ''} onChange={(e) => revoke && setRevoke({ ...revoke, reason: e.currentTarget.value })} />
          <Group justify='flex-end'>
            <Button variant='default' onClick={() => setRevoke(null)}>
              Volver
            </Button>
            <Button
              color='red'
              disabled={(revoke?.reason.trim().length ?? 0) < 5}
              onClick={async () => {
                if (!revoke) return;
                const ok = await act(() => sgcSend(`/api/sgc/approvers/${revoke.id}/revoke`, 'POST', { company: idCompany, reason: revoke.reason.trim() }), 'Autorización revocada.');
                if (ok) setRevoke(null);
              }}
            >
              Revocar
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Card>
  );
}
