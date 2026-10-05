'use client';

import { useMemo, useState } from 'react';
import { Alert, Autocomplete, Badge, Button, Card, Group, Modal, Progress, Stack, Table, Text, Textarea, Title } from '@mantine/core';
import SgcSelect, { sgcTouchComboboxProps } from '../SgcSelect';
import { IconBell, IconPlus, IconSpeakerphone, IconUserMinus, IconX } from '@tabler/icons-react';
import type { SgcRequestDetail } from '../../../lib/sgc/db/requests';
import { SGC_SCOPE_KIND_LABELS, isPersonEmail, personEmailFromInput, type SgcScopeKind } from '../../../lib/sgc/dissemination/scope';
import { useSgcFetch } from '../useSgcFetch';
import { formatDateCO } from './format';

/**
 * DIVULGACIÓN de la solicitud (Sprint 4, paso 4): alcance (toda la empresa,
 * departamentos, cargos o personas), cobertura de lectura (quién leyó, quién
 * falta), recordatorios, exclusión justificada y cierre por Calidad. Lo ven
 * el solicitante, el elaborador y Calidad; el alcance lo define el
 * elaborador o Calidad antes de la divulgación y durante ella solo Calidad
 * lo amplía.
 */
export interface SgcDisseminationCardProps {
  idCompany: number;
  view: NonNullable<SgcRequestDetail['dissemination']>;
  users: { value: string; label: string }[];
  onAction: (body: Record<string, unknown>, ok: string) => Promise<boolean>;
}

const STATUS_COLOR: Record<string, string> = { pendiente: 'blue', leido: 'green', excluido: 'gray' };

export default function SgcDisseminationCard({ idCompany, view, users, onAction }: SgcDisseminationCardProps) {
  const catalogs = useSgcFetch<{ departments: { id: number; name: string }[] }>(view.canEditScope ? `/api/sgc/catalogs?company=${idCompany}` : null);
  const cargos = useSgcFetch<{ cargos: { id: number; name: string }[]; members: { idCargo: number }[] }>(view.canEditScope ? `/api/sgc/cargo-members?company=${idCompany}` : null);
  const [kind, setKind] = useState<SgcScopeKind>('departamento');
  const [target, setTarget] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [reason, setReason] = useState('');
  const [modal, setModal] = useState<{ type: 'retirar' | 'excluir' | 'cerrar'; id?: number; label: string } | null>(null);
  const [modalReason, setModalReason] = useState('');
  const withMembers = useMemo(() => new Set((cargos.data?.members ?? []).map((m) => m.idCargo)), [cargos.data]);
  const c = view.coverage;

  const targetOptions =
    kind === 'departamento'
      ? (catalogs.data?.departments ?? []).map((d) => ({ value: String(d.id), label: d.name }))
      : kind === 'cargo'
        ? (cargos.data?.cargos ?? []).map((x) => ({ value: String(x.id), label: `${x.name}${withMembers.has(x.id) ? '' : ' (sin personas registradas)'}` }))
        : [];

  const add = async () => {
    const entry = kind === 'departamento' ? { kind, idDepartment: Number(target) } : kind === 'cargo' ? { kind, idCargo: Number(target) } : kind === 'persona' ? { kind, email: personEmailFromInput(email, users) } : { kind };
    const ok = await onAction({ action: 'agregar', entry, reason }, view.open ? 'Alcance ampliado: las personas nuevas recibieron su tarea de lectura.' : 'Alcance de divulgación actualizado.');
    if (ok) {
      setTarget(null);
      setEmail('');
      setReason('');
    }
  };

  const ready = reason.trim().length >= 5 && (kind === 'empresa' || (kind === 'persona' ? isPersonEmail(email, users) : Boolean(target)));

  return (
    <Card shadow='sm' p='xl' radius='md' withBorder mt='6' data-testid='sgc-divulgacion'>
      <Group justify='space-between' mb='sm'>
        <Title order={4} className='flex items-center gap-2'>
          <IconSpeakerphone size={18} className='text-blue-6' />
          Divulgación · lectura obligatoria
        </Title>
        {view.started && (
          <Badge color={view.open ? 'blue' : 'green'} variant='light' size='lg' radius='sm'>
            {view.open ? 'En curso' : 'Cerrada'}
          </Badge>
        )}
      </Group>
      <Text size='sm' c='dimmed' mb='md'>
        Al aprobarse el documento, cada persona del alcance lo lee hasta el final y firma «Leído». Mientras tanto, la versión anterior sigue vigente. Si nadie define el alcance, se toma el departamento dueño del proceso.
      </Text>

      <Text fw={600} size='sm' mb={4}>
        Alcance
      </Text>
      {view.scope.length === 0 ? (
        <Text size='sm' c='dimmed' mb='sm'>
          Sin definir (se usará el departamento dueño del proceso).
        </Text>
      ) : (
        <Stack gap={4} mb='sm' data-testid='sgc-alcance-lista'>
          {view.scope.map((s) => (
            <Group key={s.id} justify='space-between' wrap='nowrap'>
              <Text size='sm'>
                {s.label}{' '}
                <Text span size='xs' c='dimmed'>
                  · {s.addedBy} · {formatDateCO(s.addedAt)}
                </Text>
              </Text>
              {view.canRemoveScope && (
                <Button size='xs' variant='subtle' color='red' leftSection={<IconX size={12} />} onClick={() => setModal({ type: 'retirar', id: s.id, label: s.label })}>
                  Retirar
                </Button>
              )}
            </Group>
          ))}
        </Stack>
      )}
      {view.withoutAccess.length > 0 && (
        <Alert color='yellow' mb='sm' data-testid='sgc-alcance-sin-acceso'>
          {view.withoutAccess.length} persona(s) del alcance no tienen acceso al SGC y no reciben tarea de lectura: {view.withoutAccess.join(', ')}. Otórgueles el permiso de consulta del SGC y amplíe el alcance con ellas, o deje constancia.
        </Alert>
      )}
      {view.companyDomains && (
        <Text size='xs' c='dimmed' mb='sm' data-testid='sgc-alcance-dominios'>
          «Toda la empresa», departamentos y cargos solo incluyen correos de la empresa ({view.companyDomains.map((d) => `@${d}`).join(', ')}). A una persona de otra empresa se le asigna lectura solo eligiéndola como «Persona».
        </Text>
      )}
      {view.outsideCompany.length > 0 && (
        <Alert color='gray' mb='sm' data-testid='sgc-alcance-otra-empresa'>
          {view.outsideCompany.length} persona(s) de otra empresa quedan por fuera del alcance automático: {view.outsideCompany.join(', ')}. Si alguna debe leer el documento, agréguela como «Persona».
        </Alert>
      )}

      {view.canEditScope && (
        <Card withBorder radius='md' p='md' mb='md'>
          <Group align='flex-end' wrap='wrap'>
            <SgcSelect
              label='Agregar al alcance'
              data={(Object.keys(SGC_SCOPE_KIND_LABELS) as SgcScopeKind[]).map((k) => ({ value: k, label: SGC_SCOPE_KIND_LABELS[k] }))}
              value={kind}
              onChange={(v) => {
                setKind((v as SgcScopeKind) ?? 'departamento');
                setTarget(null);
              }}
              allowDeselect={false}
              w={180}
              data-testid='sgc-alcance-clase'
            />
            {(kind === 'departamento' || kind === 'cargo') && (
              <SgcSelect label={kind === 'departamento' ? 'Departamento' : 'Cargo'} data={targetOptions} value={target} onChange={setTarget} searchable w={280} data-testid='sgc-alcance-destino' />
            )}
            {kind === 'persona' && <Autocomplete comboboxProps={sgcTouchComboboxProps()} autoComplete='off' data-1p-ignore='true' data-lpignore='true' label='Correo de la persona' data={users} value={email} onChange={setEmail} w={300} data-testid='sgc-alcance-persona' />}
            <Textarea autoComplete='off' data-1p-ignore='true' data-lpignore='true' label='Motivo' autosize minRows={1} value={reason} onChange={(e) => setReason(e.currentTarget.value)} w={260} data-testid='sgc-alcance-motivo' />
            <Button leftSection={<IconPlus size={14} />} disabled={!ready} onClick={add} data-testid='sgc-alcance-agregar'>
              Agregar
            </Button>
          </Group>
          {kind === 'cargo' && (
            <Text size='xs' c='dimmed' mt='xs'>
              Las personas de cada cargo las registra Calidad en «Configuración → Personas por cargo».
            </Text>
          )}
        </Card>
      )}

      {view.started && (
        <>
          <Group justify='space-between' mb={4}>
            <Text fw={600} size='sm'>
              Cobertura de lectura
            </Text>
            <Text size='sm' data-testid='sgc-cobertura'>
              {c.read} de {c.total - c.excluded} leyeron ({c.percent} %) · {c.pending} pendiente(s) · {c.excluded} excluida(s)
            </Text>
          </Group>
          <Progress value={c.percent} color={c.complete ? 'green' : 'blue'} mb={4} />
          <Text size='xs' c='dimmed' mb='md' data-testid='sgc-umbral-lectura'>
            Aviso de avance al creador y a Calidad al llegar al {view.threshold.pct} % de lectura
            {view.threshold.notifiedAt ? ` · avisado el ${formatDateCO(view.threshold.notifiedAt)}` : ' · aún no se ha alcanzado'}.
          </Text>
          {view.doubts.length > 0 && (
            <Alert color='orange' variant='light' mb='md' title={`«No entendí» (${view.doubts.length})`} data-testid='sgc-no-entendi-lista'>
              <Stack gap={4}>
                {view.doubts.map((d, i) => (
                  <Text key={i} size='sm'>
                    <b>{d.name ?? d.email}</b> · {formatDateCO(d.at)}: {d.body.split('\n').slice(1).join(' ')}
                  </Text>
                ))}
              </Stack>
            </Alert>
          )}
          <Table.ScrollContainer minWidth={720}>
            <Table striped highlightOnHover data-testid='sgc-lectores'>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Persona</Table.Th>
                  <Table.Th>Estado</Table.Th>
                  <Table.Th>Abrió</Table.Th>
                  <Table.Th>Llegó al final</Table.Th>
                  <Table.Th>Firmó «Leído»</Table.Th>
                  <Table.Th>Recordatorios</Table.Th>
                  {view.canManage && <Table.Th />}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {view.readers.map((r) => (
                  <Table.Tr key={r.id} data-testid={`sgc-lector-${r.email}`}>
                    <Table.Td>
                      <Text size='sm'>{r.name ?? r.email}</Text>
                      <Text size='xs' c='dimmed'>
                        {r.email}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge color={STATUS_COLOR[r.status] ?? 'gray'} variant='light'>
                        {r.statusLabel}
                      </Badge>
                      {r.excludeReason && (
                        <Text size='xs' c='dimmed'>
                          {r.excludeReason}
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>{r.openedAt ? formatDateCO(r.openedAt) : '—'}</Table.Td>
                    <Table.Td>{r.reachedEndAt ? formatDateCO(r.reachedEndAt) : '—'}</Table.Td>
                    <Table.Td>{r.signedAt ? formatDateCO(r.signedAt) : '—'}</Table.Td>
                    <Table.Td>{r.remindersSent}</Table.Td>
                    {view.canManage && (
                      <Table.Td>
                        {r.status === 'pendiente' && (
                          <Button size='xs' variant='subtle' color='gray' leftSection={<IconUserMinus size={12} />} onClick={() => setModal({ type: 'excluir', id: r.id, label: r.email })}>
                            Excluir
                          </Button>
                        )}
                      </Table.Td>
                    )}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
          {view.canManage && (
            <Group mt='md'>
              <Button variant='light' leftSection={<IconBell size={14} />} disabled={c.pending === 0} onClick={() => onAction({ action: 'recordatorio' }, 'Recordatorio enviado a quienes no han firmado.')} data-testid='sgc-divulgacion-recordatorio'>
                Enviar recordatorio a pendientes
              </Button>
              <Button variant='outline' color='orange' onClick={() => setModal({ type: 'cerrar', label: 'la divulgación' })} data-testid='sgc-divulgacion-cerrar'>
                Cerrar divulgación con justificación
              </Button>
            </Group>
          )}
        </>
      )}

      <Modal
        opened={Boolean(modal)}
        onClose={() => setModal(null)}
        title={modal?.type === 'retirar' ? 'Retirar del alcance' : modal?.type === 'excluir' ? `Excluir la lectura de ${modal?.label}` : 'Cerrar la divulgación'}
        centered
      >
        <Stack>
          <Text size='sm' c='dimmed'>
            {modal?.type === 'cerrar'
              ? 'Las lecturas pendientes quedan excluidas con esta justificación y el documento pasa a la capacitación. Queda en el historial y en la auditoría.'
              : modal?.type === 'excluir'
                ? 'La persona deja de tener la lectura pendiente (no se borra: queda excluida con la justificación).'
                : 'La entrada se retira del alcance (no se borra: queda en el historial).'}
          </Text>
          <Textarea autoComplete='off' data-1p-ignore='true' data-lpignore='true' label={modal?.type === 'retirar' ? 'Motivo' : 'Justificación'} required autosize minRows={3} value={modalReason} onChange={(e) => setModalReason(e.currentTarget.value)} data-testid='sgc-divulgacion-motivo' />
          <Group justify='flex-end'>
            <Button variant='default' onClick={() => setModal(null)}>
              Volver
            </Button>
            <Button
              color='orange'
              disabled={modalReason.trim().length < (modal?.type === 'retirar' ? 5 : 10)}
              onClick={async () => {
                if (!modal) return;
                const body =
                  modal.type === 'retirar'
                    ? { action: 'retirar', idScope: modal.id, reason: modalReason.trim() }
                    : modal.type === 'excluir'
                      ? { action: 'excluir', idReadRecord: modal.id, reason: modalReason.trim() }
                      : { action: 'cerrar', reason: modalReason.trim() };
                const ok = await onAction(body, modal.type === 'cerrar' ? 'Divulgación cerrada.' : modal.type === 'excluir' ? 'Lectura excluida.' : 'Entrada retirada del alcance.');
                if (ok) {
                  setModal(null);
                  setModalReason('');
                }
              }}
              data-testid='sgc-divulgacion-confirmar'
            >
              Confirmar
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Card>
  );
}
