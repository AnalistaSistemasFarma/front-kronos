'use client';

import { useMemo, useState } from 'react';
import { Alert, Autocomplete, Button, Card, Group, Modal, Select, Stack, Table, Text, Textarea } from '@mantine/core';
import { IconPlus, IconX } from '@tabler/icons-react';
import { formatDateCO } from './tareas/format';
import { sgcSend, useSgcFetch } from './useSgcFetch';

/**
 * PERSONAS POR CARGO (Sprint 4, solo Calidad): quién ocupa cada cargo en la
 * empresa, para el alcance de divulgación «por cargo» (SynerLink tiene los
 * cargos pero no vincula persona↔cargo). Nada se borra: se retira con motivo.
 */
interface Data {
  cargos: { id: number; name: string }[];
  members: { id: number; idCargo: number; cargo: string; email: string; name: string | null; addedBy: string; addedAt: string; reason: string }[];
}

export default function SgcCargoMembers({ idCompany }: { idCompany: number }) {
  const { data, error, reload } = useSgcFetch<Data>(`/api/sgc/cargo-members?company=${idCompany}`);
  const users = useSgcFetch<{ users: { email: string; name: string | null }[] }>(`/api/sgc/users?company=${idCompany}`);
  const [idCargo, setIdCargo] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [reason, setReason] = useState('');
  const [remove, setRemove] = useState<{ id: number; label: string; reason: string } | null>(null);
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
    <Card withBorder radius='md' p='lg' shadow='xs' data-testid='sgc-cargos'>
      <Stack>
        <Text size='sm' c='dimmed'>
          Para divulgar un documento «por cargo», registre aquí quién ocupa cada cargo en la empresa. Los cargos vienen del organigrama de SynerLink. Cada cambio pide motivo y queda en la auditoría.
        </Text>
        {msg && <Alert color={msg.ok ? 'green' : 'red'}>{msg.text}</Alert>}
        <Group align='flex-end' wrap='wrap'>
          <Select label='Cargo' data={(data?.cargos ?? []).map((c) => ({ value: String(c.id), label: c.name }))} value={idCargo} onChange={setIdCargo} searchable w={300} />
          <Autocomplete label='Correo de la persona' data={options} value={email} onChange={setEmail} w={300} />
          <Textarea label='Motivo' autosize minRows={1} value={reason} onChange={(e) => setReason(e.currentTarget.value)} w={260} />
          <Button
            leftSection={<IconPlus size={14} />}
            disabled={!idCargo || !email.includes('@') || reason.trim().length < 5}
            onClick={async () => {
              const ok = await act(() => sgcSend('/api/sgc/cargo-members', 'POST', { company: idCompany, idCargo: Number(idCargo), email: email.trim(), reason: reason.trim() }), 'Persona registrada en el cargo.');
              if (ok) {
                setEmail('');
                setReason('');
              }
            }}
          >
            Registrar
          </Button>
        </Group>
        <Table.ScrollContainer minWidth={520}>
          <Table striped>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Cargo</Table.Th>
                <Table.Th>Persona</Table.Th>
                <Table.Th>Registrado</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(data?.members ?? []).map((m) => (
                <Table.Tr key={m.id}>
                  <Table.Td>{m.cargo}</Table.Td>
                  <Table.Td>
                    {m.name ?? m.email} <Text span size='xs' c='dimmed'>({m.email})</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size='xs'>
                      {m.addedBy} · {formatDateCO(m.addedAt)}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Button size='xs' variant='subtle' color='red' leftSection={<IconX size={12} />} onClick={() => setRemove({ id: m.id, label: `${m.email} (${m.cargo})`, reason: '' })}>
                      Retirar
                    </Button>
                  </Table.Td>
                </Table.Tr>
              ))}
              {data && data.members.length === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={4}>
                    <Text size='sm' c='dimmed'>
                      Aún no hay personas registradas por cargo.
                    </Text>
                  </Table.Td>
                </Table.Tr>
              )}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Stack>
      <Modal opened={Boolean(remove)} onClose={() => setRemove(null)} title={`Retirar ${remove?.label ?? ''}`} centered>
        <Stack>
          <Textarea label='Motivo' required autosize minRows={2} value={remove?.reason ?? ''} onChange={(e) => remove && setRemove({ ...remove, reason: e.currentTarget.value })} />
          <Group justify='flex-end'>
            <Button variant='default' onClick={() => setRemove(null)}>
              Volver
            </Button>
            <Button
              color='red'
              disabled={(remove?.reason.trim().length ?? 0) < 5}
              onClick={async () => {
                if (!remove) return;
                const ok = await act(() => sgcSend(`/api/sgc/cargo-members/${remove.id}/deactivate`, 'POST', { company: idCompany, reason: remove.reason.trim() }), 'Persona retirada del cargo.');
                if (ok) setRemove(null);
              }}
            >
              Retirar
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Card>
  );
}
