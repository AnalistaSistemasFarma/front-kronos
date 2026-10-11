'use client';

import { useEffect, useState } from 'react';
import { Accordion, ActionIcon, Alert, Badge, Button, Checkbox, Code, Grid, Group, Modal, NumberInput, ScrollArea, SegmentedControl, Stack, Table, Text, TextInput, Textarea } from '@mantine/core';
import SgcSelect from '../SgcSelect';
import {
  IconAlertCircle,
  IconCalendarTime,
  IconCheck,
  IconGitBranch,
  IconHistory,
  IconListCheck,
  IconPlus,
  IconShieldCheck,
  IconSignature,
  IconTag,
  IconTrash,
  IconUser,
  IconUserCheck,
  IconUsersGroup,
} from '@tabler/icons-react';
import toast from 'react-hot-toast';
import type { SgcCatalogs } from '../../../lib/sgc/db/catalogs';
import type { SgcConfigChangeRow, SgcFlowVersionSummary } from '../../../lib/sgc/db/flows';
import type { SgcMatrixRow } from '../../../lib/sgc/db/matrix';
import { SGC_ASSIGNMENT_LABELS, SGC_CONDITION_LABELS, SGC_ROLE_LABELS, SGC_SIGNATURE_LABELS, type SgcTaskDefinition } from '../../../lib/sgc/flows/definition';
import { formatDateCO } from '../tareas/format';
import { sgcSend, useSgcFetch } from '../useSgcFetch';
import { useSgcRowLink } from '../useSgcRowLink';
import { LG_FIELD, ModalTitle, SgcReasonModal, statusColor, statusLabel } from './SgcFlowUi';
import { opts, type SgcAuthTypeOption } from './SgcFlowTasksCard';

const MODAL = { size: 'lg', radius: 'lg', overlayProps: { blur: 4 }, centered: true } as const;
const MODAL_CLASSES = { header: 'border-b border-gray-100 pb-4', body: 'pt-4' };

// ---------------------------------------------------------------------------
// Agregar Nueva Tarea — copia del modal homónimo de view-workflows.
// ---------------------------------------------------------------------------

export function newTaskDefaults(): Omit<SgcTaskDefinition, 'key' | 'stepOrder'> {
  return {
    name: '',
    role: 'revisor',
    assignment: 'elaborador',
    multiAssignee: false,
    signingModeDefault: null,
    signatureMeaning: null,
    targetDays: null,
    conditionKey: null,
    isAuthorization: false,
    authorizationTypeCode: null,
    poolAuthorizationTypeCode: null,
    isEnabled: true,
    description: null,
  };
}

export function SgcAddTaskModal({ opened, onClose, onAdd, authorizationTypes }: { opened: boolean; onClose: () => void; onAdd: (t: Omit<SgcTaskDefinition, 'key' | 'stepOrder'>) => void; authorizationTypes: SgcAuthTypeOption[] }) {
  const [form, setForm] = useState(newTaskDefaults());
  useEffect(() => {
    if (!opened) setForm(newTaskDefaults());
  }, [opened]);
  const set = (p: Partial<typeof form>) => setForm((f) => ({ ...f, ...p }));
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={<ModalTitle icon={<IconPlus size={20} className='text-blue-600' />} box='bg-blue-100' title='Agregar Nueva Tarea' hint='Complete los campos para agregar una tarea' />}
      {...MODAL}
      classNames={MODAL_CLASSES}
    >
      <Stack gap='lg'>
        <Grid>
          <Grid.Col span={12}>
            <TextInput autoComplete='off' data-1p-ignore='true' data-lpignore='true' label='Nombre de la Tarea' placeholder='Ingrese el nombre de la tarea' value={form.name} onChange={(e) => set({ name: e.target.value })} required leftSection={<IconListCheck size={16} />} size='lg' classNames={LG_FIELD} data-testid='sgc-nueva-tarea-nombre' />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <SgcSelect
              label='Asignado a'
              data={opts(SGC_ASSIGNMENT_LABELS)}
              value={form.assignment}
              onChange={(v) => v && set({ assignment: v as SgcTaskDefinition['assignment'], multiAssignee: v === 'firmantes', signingModeDefault: v === 'firmantes' ? 'paralelo' : null })}
              allowDeselect={false}
              leftSection={<IconUser size={16} />}
              size='lg'
              classNames={LG_FIELD}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <SgcSelect label='Rol' data={opts(SGC_ROLE_LABELS)} value={form.role} onChange={(v) => v && set({ role: v as SgcTaskDefinition['role'] })} allowDeselect={false} leftSection={<IconUserCheck size={16} />} size='lg' classNames={LG_FIELD} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <SgcSelect
              label='Firma (significado)'
              placeholder='Sin firma'
              data={opts(SGC_SIGNATURE_LABELS)}
              value={form.signatureMeaning}
              onChange={(v) => set({ signatureMeaning: (v as SgcTaskDefinition['signatureMeaning']) ?? null })}
              clearable
              leftSection={<IconSignature size={16} />}
              size='lg'
              classNames={LG_FIELD}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <NumberInput label='Días objetivo' placeholder='Sin plazo' value={form.targetDays ?? ''} onChange={(v) => set({ targetDays: v === '' ? null : Number(v) })} min={1} max={365} hideControls leftSection={<IconCalendarTime size={16} />} size='lg' classNames={LG_FIELD} />
          </Grid.Col>
          <Grid.Col span={12}>
            <SgcSelect
              label='Grupo de verificación de Calidad'
              placeholder='Ninguno'
              data={authorizationTypes}
              value={form.poolAuthorizationTypeCode}
              onChange={(v) => set({ poolAuthorizationTypeCode: v })}
              clearable
              leftSection={<IconShieldCheck size={16} />}
              size='lg'
              classNames={LG_FIELD}
            />
          </Grid.Col>
        </Grid>

        {form.multiAssignee && (
          <SgcSelect
            label='Firmantes: en orden o en paralelo'
            data={[
              { value: 'paralelo', label: 'En paralelo' },
              { value: 'orden', label: 'En orden' },
            ]}
            value={form.signingModeDefault}
            onChange={(v) => set({ signingModeDefault: (v as 'orden' | 'paralelo') ?? 'paralelo' })}
            allowDeselect={false}
            maw={400}
          />
        )}

        <Checkbox label='Tarea de autorización' checked={form.isAuthorization} onChange={(e) => set({ isAuthorization: e.currentTarget.checked, authorizationTypeCode: e.currentTarget.checked ? form.authorizationTypeCode : null })} />

        {form.isAuthorization && (
          <SgcSelect
            mt='sm'
            label='Tipo de autorización'
            placeholder='Seleccione el tipo'
            data={authorizationTypes}
            value={form.authorizationTypeCode}
            onChange={(v) => set({ authorizationTypeCode: v })}
            searchable
            withAsterisk
            error={!form.authorizationTypeCode ? 'Selecciona el tipo de autorización' : undefined}
            maw={400}
          />
        )}

        <SgcSelect
          mt='sm'
          label='Ejecutar esta tarea solo si'
          placeholder='Siempre (sin condición)'
          data={opts(SGC_CONDITION_LABELS)}
          value={form.conditionKey}
          onChange={(v) => set({ conditionKey: (v as SgcTaskDefinition['conditionKey']) ?? null })}
          clearable
          leftSection={<IconTag size={16} />}
        />

        <Group justify='flex-end' gap='sm' mt='md'>
          <Button variant='outline' onClick={onClose} className='cursor-pointer transition-colors duration-200'>
            Cancelar
          </Button>
          <Button
            onClick={() => onAdd({ ...form, name: form.name.trim() })}
            disabled={!form.name.trim() || (form.isAuthorization && !form.authorizationTypeCode)}
            className='bg-blue-600 hover:bg-blue-700 cursor-pointer transition-colors duration-200'
            data-testid='sgc-nueva-tarea-agregar'
          >
            Agregar Tarea
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Matriz de responsables (antes pestaña de /flujos). Mismo marco de modal
// que «Observadores» / «Validadores documento» de view-workflows.
// ---------------------------------------------------------------------------

export function SgcMatrixModal({ opened, onClose, idCompany, canEdit, onCount }: { opened: boolean; onClose: () => void; idCompany: number; canEdit: boolean; onCount?: (n: number) => void }) {
  const matrix = useSgcFetch<{ matrix: SgcMatrixRow[] }>(`/api/sgc/matrix?company=${idCompany}`);
  const catalogs = useSgcFetch<SgcCatalogs>(opened ? `/api/sgc/catalogs?company=${idCompany}` : null);
  const [row, setRow] = useState({ role: 'revisor', idProcess: '', idDocumentType: '', userEmail: '', cargoName: '', reason: '' });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [deactivate, setDeactivate] = useState<number | null>(null);
  const rows = matrix.data?.matrix ?? [];
  useEffect(() => onCount?.(rows.length), [rows.length, onCount]);
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: ok });
      toast.success(ok);
      matrix.reload();
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      setMsg({ ok: false, text });
      toast.error(text);
    }
  };
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={<ModalTitle icon={<IconUsersGroup size={20} className='text-blue-600' />} box='bg-blue-100' title={`Matriz de responsables${rows.length ? ` (${rows.length})` : ''}`} hint='Quién elabora, revisa y aprueba por proceso y tipo documental' />}
      {...MODAL}
      size='xl'
    >
      <Stack gap='md' data-testid='sgc-matriz-modal'>
        {msg && (
          <Alert color={msg.ok ? 'green' : 'red'} icon={msg.ok ? <IconCheck size={16} /> : <IconAlertCircle size={16} />}>
            {msg.text}
          </Alert>
        )}
        <Alert variant='light' color='blue'>
          La matriz solo SUGIERE quién elabora, revisa y aprueba por proceso y tipo documental (la más específica gana). El elaborador decide. Las filas marcadas como ejemplo se reemplazan con la matriz definitiva.
        </Alert>
        <ScrollArea type='auto'>
          <Table striped highlightOnHover miw={640} data-testid='sgc-matriz'>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Rol</Table.Th>
                <Table.Th>Proceso</Table.Th>
                <Table.Th>Tipo documental</Table.Th>
                <Table.Th>Persona o cargo</Table.Th>
                {canEdit && <Table.Th />}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((m) => (
                <Table.Tr key={m.id}>
                  <Table.Td>{m.role}</Table.Td>
                  <Table.Td>{m.processCode ? `${m.processCode} · ${m.processName}` : 'Todos'}</Table.Td>
                  <Table.Td>{m.documentTypeCode ? `${m.documentTypeCode} · ${m.documentTypeName}` : 'Todos'}</Table.Td>
                  <Table.Td>
                    {m.userEmail ?? `Cargo: ${m.cargoName}`}
                    {m.isExample && (
                      <Badge ml='xs' size='xs' color='yellow' variant='light'>
                        Ejemplo
                      </Badge>
                    )}
                  </Table.Td>
                  {canEdit && (
                    <Table.Td>
                      <ActionIcon color='red' variant='subtle' onClick={() => setDeactivate(m.id)} title='Desactivar fila'>
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Table.Td>
                  )}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>
        {canEdit && (
          <>
            <Text fw={600} size='md'>
              Agregar fila
            </Text>
            <Grid>
              <Grid.Col span={{ base: 12, md: 4 }}>
                <SgcSelect label='Rol' data={['elaborador', 'revisor', 'aprobador']} value={row.role} onChange={(v) => setRow({ ...row, role: v ?? 'revisor' })} allowDeselect={false} />
              </Grid.Col>
              <Grid.Col span={{ base: 12, md: 4 }}>
                <SgcSelect label='Proceso' clearable placeholder='Todos' data={(catalogs.data?.processes ?? []).map((p) => ({ value: String(p.id), label: `${p.code} · ${p.name}` }))} value={row.idProcess || null} onChange={(v) => setRow({ ...row, idProcess: v ?? '' })} />
              </Grid.Col>
              <Grid.Col span={{ base: 12, md: 4 }}>
                <SgcSelect label='Tipo documental' clearable placeholder='Todos' data={(catalogs.data?.documentTypes ?? []).map((t) => ({ value: String(t.id), label: `${t.code} · ${t.name}` }))} value={row.idDocumentType || null} onChange={(v) => setRow({ ...row, idDocumentType: v ?? '' })} />
              </Grid.Col>
              <Grid.Col span={{ base: 12, md: 6 }}>
                <TextInput autoComplete='off' data-1p-ignore='true' data-lpignore='true' label='Correo (persona)' value={row.userEmail} onChange={(e) => setRow({ ...row, userEmail: e.currentTarget.value, cargoName: '' })} leftSection={<IconUser size={16} />} />
              </Grid.Col>
              <Grid.Col span={{ base: 12, md: 6 }}>
                <TextInput autoComplete='off' data-1p-ignore='true' data-lpignore='true' label='o Cargo' value={row.cargoName} onChange={(e) => setRow({ ...row, cargoName: e.currentTarget.value, userEmail: '' })} />
              </Grid.Col>
              <Grid.Col span={12}>
                <Textarea autoComplete='off' data-1p-ignore='true' data-lpignore='true' label='Motivo del cambio' required autosize minRows={1} value={row.reason} onChange={(e) => setRow({ ...row, reason: e.currentTarget.value })} />
              </Grid.Col>
            </Grid>
          </>
        )}
        <Group justify='flex-end' gap='sm' mt='md'>
          <Button variant='outline' onClick={onClose}>
            Cerrar
          </Button>
          {canEdit && (
            <Button
              leftSection={<IconCheck size={16} />}
              disabled={row.reason.trim().length < 5 || (!row.userEmail && !row.cargoName)}
              onClick={() =>
                act(async () => {
                  await sgcSend('/api/sgc/matrix', 'POST', { company: idCompany, ...row, idProcess: row.idProcess || null, idDocumentType: row.idDocumentType || null });
                  setRow({ ...row, userEmail: '', cargoName: '', reason: '' });
                }, 'Fila agregada a la matriz.')
              }
            >
              Agregar
            </Button>
          )}
        </Group>
      </Stack>
      <SgcReasonModal
        opened={deactivate !== null}
        title='Desactivar fila de la matriz'
        hint='La fila no se borra: queda inactiva y en el registro'
        icon={<IconTrash size={20} className='text-red-600' />}
        box='bg-red-100'
        label='Motivo'
        confirmLabel='Desactivar'
        confirmColor='red'
        onClose={() => setDeactivate(null)}
        onConfirm={async (reason) => {
          await act(() => sgcSend(`/api/sgc/matrix/${deactivate}/deactivate`, 'POST', { company: idCompany, reason }), 'Fila desactivada.');
          setDeactivate(null);
        }}
      />
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Registro de cambios (solo inserción).
// ---------------------------------------------------------------------------

export function SgcChangesModal({ opened, onClose, idCompany, idFlowProcess, reloadKey, onCount }: { opened: boolean; onClose: () => void; idCompany: number; idFlowProcess: number; reloadKey: number; onCount?: (n: number) => void }) {
  const [scope, setScope] = useState<'flujo' | 'todos'>('flujo');
  const changes = useSgcFetch<{ changes: SgcConfigChangeRow[] }>(`/api/sgc/flows/changes?company=${idCompany}${scope === 'flujo' ? `&process=${idFlowProcess}` : ''}&r=${reloadKey}`);
  const list = changes.data?.changes ?? [];
  useEffect(() => {
    if (scope === 'flujo') onCount?.(list.length);
  }, [list.length, scope, onCount]);
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={<ModalTitle icon={<IconHistory size={20} className='text-teal-600' />} box='bg-teal-100' title='Registro de cambios' hint='Quién, cuándo, qué cambió (antes/después) y por qué' />}
      {...MODAL}
      size='xl'
    >
      <Stack gap='md'>
        <Alert variant='light' color='teal'>
          Registro de SOLO INSERCIÓN: la base rechaza modificarlo o borrarlo.
        </Alert>
        <SegmentedControl
          value={scope}
          onChange={(v) => setScope(v as 'flujo' | 'todos')}
          data={[
            { value: 'flujo', label: 'Este flujo' },
            { value: 'todos', label: 'Toda la configuración' },
          ]}
        />
        {list.length === 0 && !changes.loading && (
          <Text size='sm' c='dimmed'>
            Sin cambios registrados.
          </Text>
        )}
        <Accordion variant='separated' data-testid='sgc-registro-cambios'>
          {list.map((c) => (
            <Accordion.Item key={c.id} value={c.id} data-testid='sgc-cambio'>
              <Accordion.Control>
                <Group gap='xs' wrap='nowrap'>
                  <Badge variant='light' size='sm'>
                    {c.action}
                  </Badge>
                  <Text size='sm' lineClamp={1}>
                    {formatDateCO(c.occurredAt, { month: 'short' })} · {c.actorEmail} · {c.reason}
                  </Text>
                </Group>
              </Accordion.Control>
              <Accordion.Panel>
                <Text size='xs' c='dimmed'>
                  Entidad: {c.entity} {c.entityId} {c.changeReference ? `· control de cambios ${c.changeReference}` : ''} {c.ip ? `· desde ${c.ip}` : ''}
                </Text>
                {c.before != null && (
                  <>
                    <Text size='xs' fw={600} mt='xs'>
                      Antes
                    </Text>
                    <Code block style={{ maxHeight: 200, overflow: 'auto' }}>
                      {JSON.stringify(c.before, null, 2)}
                    </Code>
                  </>
                )}
                {c.after != null && (
                  <>
                    <Text size='xs' fw={600} mt='xs'>
                      Después
                    </Text>
                    <Code block style={{ maxHeight: 200, overflow: 'auto' }}>
                      {JSON.stringify(c.after, null, 2)}
                    </Code>
                  </>
                )}
              </Accordion.Panel>
            </Accordion.Item>
          ))}
        </Accordion>
        <Group justify='flex-end'>
          <Button variant='outline' onClick={onClose}>
            Cerrar
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Versiones del flujo (borrador → vigente → retirada).
// ---------------------------------------------------------------------------

export function SgcVersionsModal({ opened, onClose, versions, selectedId, hrefOf }: { opened: boolean; onClose: () => void; versions: SgcFlowVersionSummary[]; selectedId: number | null; hrefOf: (v: SgcFlowVersionSummary) => string }) {
  const rowLink = useSgcRowLink();
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={<ModalTitle icon={<IconGitBranch size={20} className='text-violet-600' />} box='bg-violet-100' title={`Versiones (${versions.length})`} hint='Una sola vigente; las solicitudes en curso conservan la versión con que arrancaron' />}
      {...MODAL}
      size='xl'
    >
      <ScrollArea type='auto'>
        <Table striped highlightOnHover miw={640} data-testid='sgc-versiones'>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Versión</Table.Th>
              <Table.Th>Estado</Table.Th>
              <Table.Th>Motivo</Table.Th>
              <Table.Th>Creada</Table.Th>
              <Table.Th>Publicada</Table.Th>
              <Table.Th>Solicitudes</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {versions.map((v) => (
              <Table.Tr key={v.id} {...rowLink(hrefOf(v))} data-testid='sgc-version-fila' data-status={v.status} style={selectedId === v.id ? { fontWeight: 600 } : undefined}>
                <Table.Td>v{v.versionNumber}</Table.Td>
                <Table.Td>
                  <Badge color={statusColor(v.status)} variant='light' size='sm'>
                    {statusLabel(v.status)}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <Text size='sm' lineClamp={2}>
                    {v.changeReason}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size='xs'>
                    {formatDateCO(v.createdAt, { month: 'short' })} · {v.createdBy}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size='xs'>{v.publishedAt ? `${formatDateCO(v.publishedAt, { month: 'short' })} · ${v.publishedBy}` : '—'}</Text>
                </Table.Td>
                <Table.Td>{v.requestCount}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </ScrollArea>
    </Modal>
  );
}
