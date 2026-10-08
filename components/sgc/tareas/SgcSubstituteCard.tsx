'use client';

import { useState } from 'react';
import { Alert, Badge, Button, Card, Group, Modal, Stack, Table, Text, TextInput, Textarea, Title } from '@mantine/core';
import SgcSelect from '../SgcSelect';
import { IconUserShare } from '@tabler/icons-react';
import type { SgcRequestDetail } from '../../../lib/sgc/db/requests';
import { formatDateCO } from './format';

/**
 * FIRMANTE SUSTITUTO (Sprint 12, R12). La acción «Asignar sustituto» solo la
 * ve el grupo exclusivo SGC-SUSTITUTOS (María Camila y su suplente, D8) y el
 * servidor lo vuelve a validar. Pide a quién, motivo y periodo de ausencia;
 * la firma quedará «en sustitución de» el titular. El historial de
 * sustituciones lo ve todo el expediente. Misma tarjeta (Card + Title +
 * tabla) que el resto del detalle de la solicitud.
 */
type Detail = SgcRequestDetail;

export interface SgcSubstituteCardProps {
  tasks: Detail['tasks'];
  substitutions: Detail['substitutions'];
  canSubstitute: boolean;
  users: { value: string; label: string }[];
  /** Personas que se ofrecen en un paso de APROBACIÓN (aprobadores autorizados), si la lista aplica. */
  approverUsers: { value: string; label: string }[] | null;
  onAssign: (idTask: number, body: { idAssignee: number; toEmail: string; reason: string; absenceFrom: string | null; absenceTo: string | null }) => Promise<boolean>;
}

interface Target {
  idTask: number;
  idAssignee: number;
  taskName: string;
  holder: string;
  isApproval: boolean;
}

export default function SgcSubstituteCard({ tasks, substitutions, canSubstitute, users, approverUsers, onAssign }: SgcSubstituteCardProps) {
  const [target, setTarget] = useState<Target | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [from, setFrom] = useState('');
  const [until, setUntil] = useState('');
  const [saving, setSaving] = useState(false);

  const slots: Target[] = canSubstitute
    ? tasks
        .filter((t) => t.status === 'abierta' && t.assignment === 'firmantes')
        .flatMap((t) =>
          t.assignees
            .filter((a) => a.status === 'pendiente' && a.email)
            .map((a) => ({ idTask: t.id, idAssignee: a.id, taskName: t.name, holder: a.onBehalfOf ? `${a.name ?? a.email} (sustituto de ${a.onBehalfOfName ?? a.onBehalfOf})` : a.name ?? a.email ?? '', isApproval: t.signatureMeaning === 'aprobo' }))
        )
    : [];
  if (!canSubstitute && substitutions.length === 0) return null;

  const people = target?.isApproval && approverUsers ? approverUsers : users;
  const close = () => {
    setTarget(null);
    setTo(null);
    setReason('');
    setFrom('');
    setUntil('');
  };

  return (
    <Card shadow='sm' p='lg' radius='md' withBorder mt='6' data-testid='sgc-sustitutos'>
      <Title order={3} mb='xs' className='flex items-center gap-2'>
        <IconUserShare size={20} />
        Firmantes sustitutos
      </Title>
      {canSubstitute && (
        <Stack gap='xs' mb='md'>
          <Text size='sm' c='dimmed'>
            Si quien debe firmar está ausente, asigne un sustituto para su firma pendiente. El sustituto cumple las mismas reglas (y, en aprobación, debe ser aprobador autorizado). Su firma quedará «en sustitución de» el titular.
          </Text>
          {slots.length === 0 ? (
            <Text size='sm' c='dimmed'>
              No hay firmas pendientes en un paso de revisión o aprobación en curso.
            </Text>
          ) : (
            slots.map((s) => (
              <Group key={s.idAssignee} justify='space-between'>
                <Text size='sm'>
                  {s.taskName}: {s.holder}
                </Text>
                <Button size='xs' variant='light' leftSection={<IconUserShare size={14} />} onClick={() => setTarget(s)} data-testid={`sgc-asignar-sustituto-${s.idAssignee}`}>
                  Asignar sustituto
                </Button>
              </Group>
            ))
          )}
        </Stack>
      )}
      {substitutions.length > 0 && (
        <Table.ScrollContainer minWidth={560}>
          <Table striped data-testid='sgc-sustituciones'>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Paso</Table.Th>
                <Table.Th>Titular</Table.Th>
                <Table.Th>Sustituto</Table.Th>
                <Table.Th>Ausencia</Table.Th>
                <Table.Th>Asignó</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {substitutions.map((x) => (
                <Table.Tr key={x.id}>
                  <Table.Td>{tasks.find((t) => t.key === x.stepKey)?.name ?? x.stepKey}</Table.Td>
                  <Table.Td>{x.original}</Table.Td>
                  <Table.Td>
                    {x.substitute}
                    <Text size='xs' c='dimmed'>
                      {x.reason}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    {x.absenceFrom || x.absenceTo ? (
                      <Text size='xs'>
                        {x.absenceFrom ?? '¿?'} → {x.absenceTo ?? '¿?'}
                      </Text>
                    ) : (
                      <Badge variant='light' color='gray' size='xs'>
                        Sin periodo
                      </Badge>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Text size='xs'>
                      {x.assignedBy} · {formatDateCO(x.assignedAt)}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
      <Modal opened={Boolean(target)} onClose={close} title={`Sustituto para ${target?.holder ?? ''}`} centered>
        <Stack>
          {target?.isApproval && approverUsers && (
            <Alert color='blue' variant='light' p='xs'>
              <Text size='xs'>Paso de aprobación: solo se ofrecen los aprobadores autorizados del proceso.</Text>
            </Alert>
          )}
          <SgcSelect label='Sustituto' data={people} value={to} onChange={setTo} searchable data-testid='sgc-sustituto-persona' />
          <Group grow>
            <TextInput type='date' label='Ausente desde' value={from} onChange={(e) => setFrom(e.currentTarget.value)} />
            <TextInput type='date' label='Ausente hasta' value={until} onChange={(e) => setUntil(e.currentTarget.value)} />
          </Group>
          <Textarea autoComplete='off' data-1p-ignore='true' data-lpignore='true' label='Motivo' required autosize minRows={2} value={reason} onChange={(e) => setReason(e.currentTarget.value)} data-testid='sgc-sustituto-motivo' />
          <Group justify='flex-end'>
            <Button variant='default' onClick={close} disabled={saving}>
              Volver
            </Button>
            <Button
              loading={saving}
              disabled={!to || reason.trim().length < 5}
              onClick={async () => {
                if (!target || !to) return;
                setSaving(true);
                try {
                  const ok = await onAssign(target.idTask, { idAssignee: target.idAssignee, toEmail: to, reason: reason.trim(), absenceFrom: from || null, absenceTo: until || null });
                  if (ok) close();
                } finally {
                  setSaving(false);
                }
              }}
              data-testid='sgc-sustituto-guardar'
            >
              Asignar
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Card>
  );
}
