'use client';

import { useEffect, useState } from 'react';
import { Accordion, Alert, Badge, Button, Card, Code, Grid, Group, Modal, Select, Stack, Table, Tabs, Text, TextInput, Textarea, Title } from '@mantine/core';
import { IconAlertCircle, IconCheck, IconGitBranch, IconHistory, IconPlus, IconRocket, IconUsersGroup } from '@tabler/icons-react';
import SgcShell from '../../../../../components/sgc/SgcShell';
import SgcFlowEditor from '../../../../../components/sgc/flujos/SgcFlowEditor';
import { formatDateCO } from '../../../../../components/sgc/tareas/format';
import { sgcSend, useSgcFetch } from '../../../../../components/sgc/useSgcFetch';
import type { SgcCatalogs } from '../../../../../lib/sgc/db/catalogs';
import type { SgcAuthorizationTypeRow } from '../../../../../lib/sgc/db/authorizations';
import type { SgcConfigChangeRow, SgcFlowProcessSummary, SgcFlowVersionDetail } from '../../../../../lib/sgc/db/flows';
import type { SgcMatrixRow } from '../../../../../lib/sgc/db/matrix';
import { SGC_FLOW_CATEGORIES, type SgcFlowDefinition } from '../../../../../lib/sgc/flows/definition';
import type { SgcCompanyAccess } from '../../../../../lib/sgc/permissions';

/**
 * Administración de flujos validados del SGC (motor genérico; el documental
 * es el primer flujo). Crear y editar flujos SIN CÓDIGO, con versiones
 * (borrador → vigente → retirada), publicación con motivo, matriz de
 * responsables y registro de cambios de configuración (solo inserción).
 */

function ReasonModal({ opened, title, label, onClose, onConfirm, children }: { opened: boolean; title: string; label: string; onClose: () => void; onConfirm: (reason: string) => Promise<void>; children?: React.ReactNode }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal opened={opened} onClose={onClose} title={title} centered>
      <Stack>
        {children}
        <Textarea label={label} required minRows={2} autosize value={reason} onChange={(e) => setReason(e.currentTarget.value)} data-testid='sgc-modal-motivo' />
        <Group justify='flex-end'>
          <Button variant='default' onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={reason.trim().length < 5}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm(reason.trim());
                setReason('');
              } finally {
                setBusy(false);
              }
            }}
            data-testid='sgc-modal-confirmar'
          >
            Confirmar
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function FlowsTab({ company }: { company: SgcCompanyAccess }) {
  const id = company.idCompany;
  const canEdit = company.canAdminFlows;
  const flows = useSgcFetch<{ flows: SgcFlowProcessSummary[] }>(`/api/sgc/flows?company=${id}`);
  const types = useSgcFetch<{ types: SgcAuthorizationTypeRow[] }>(`/api/sgc/authorization-types?company=${id}`);
  const [selected, setSelected] = useState<number | null>(null);
  const version = useSgcFetch<SgcFlowVersionDetail>(selected ? `/api/sgc/flows/versions/${selected}?company=${id}` : null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [modal, setModal] = useState<null | { kind: 'draft'; idProcess: number } | { kind: 'publish' | 'discard'; idVersion: number }>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newFlow, setNewFlow] = useState({ code: '', name: '', category: 'otro', description: '', reason: '' });

  useEffect(() => {
    if (!selected && flows.data?.flows.length) {
      const f = flows.data.flows[0];
      setSelected(f.draftVersionId ?? f.versions.find((v) => v.status === 'vigente')?.id ?? f.versions[0]?.id ?? null);
    }
  }, [flows.data, selected]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: ok });
      flows.reload();
      version.reload();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <Stack>
      {msg && (
        <Alert color={msg.ok ? 'green' : 'red'} icon={msg.ok ? <IconCheck size={16} /> : <IconAlertCircle size={16} />} data-testid='sgc-flujos-mensaje'>
          {msg.text}
        </Alert>
      )}
      <Card withBorder radius='md' p='md'>
        <Group justify='space-between' mb='sm'>
          <Title order={4}>Procesos validados</Title>
          {canEdit && (
            <Button size='xs' leftSection={<IconPlus size={14} />} onClick={() => setCreateOpen(true)} data-testid='sgc-flujo-nuevo'>
              Nuevo flujo
            </Button>
          )}
        </Group>
        <Table.ScrollContainer minWidth={640}>
          <Table striped highlightOnHover data-testid='sgc-flujos-tabla'>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Código</Table.Th>
                <Table.Th>Flujo</Table.Th>
                <Table.Th>Categoría</Table.Th>
                <Table.Th>Versiones</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(flows.data?.flows ?? []).map((f) => (
                <Table.Tr key={f.id} data-testid='sgc-flujo-fila' data-code={f.code}>
                  <Table.Td>
                    <Text fw={700}>{f.code}</Text>
                  </Table.Td>
                  <Table.Td>
                    {f.name}
                    {!f.isActive && (
                      <Badge ml='xs' color='gray' size='xs'>
                        Inactivo
                      </Badge>
                    )}
                  </Table.Td>
                  <Table.Td>{f.category}</Table.Td>
                  <Table.Td>
                    <Group gap={4}>
                      {f.versions.map((v) => (
                        <Badge
                          key={v.id}
                          variant={selected === v.id ? 'filled' : 'light'}
                          color={v.status === 'vigente' ? 'green' : v.status === 'borrador' ? 'orange' : 'gray'}
                          style={{ cursor: 'pointer' }}
                          onClick={() => setSelected(v.id)}
                          data-testid='sgc-flujo-version'
                          data-status={v.status}
                        >
                          v{v.versionNumber} · {v.status}
                          {v.requestCount ? ` · ${v.requestCount} sol.` : ''}
                        </Badge>
                      ))}
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    {canEdit && !f.draftVersionId && (
                      <Button size='xs' variant='light' leftSection={<IconGitBranch size={14} />} onClick={() => setModal({ kind: 'draft', idProcess: f.id })} data-testid='sgc-flujo-nueva-version'>
                        Nueva versión
                      </Button>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Card>

      {version.data && (
        <Card withBorder radius='md' p='md'>
          <Group justify='space-between' mb='md'>
            <div>
              <Title order={4}>
                {version.data.process.code} · {version.data.process.name} — versión {version.data.version.versionNumber}{' '}
                <Badge color={version.data.version.status === 'vigente' ? 'green' : version.data.version.status === 'borrador' ? 'orange' : 'gray'} data-testid='sgc-version-estado'>
                  {version.data.version.status}
                </Badge>
              </Title>
              <Text size='xs' c='dimmed'>
                Motivo: {version.data.version.changeReason} · creada por {version.data.version.createdBy} el {formatDateCO(version.data.version.createdAt, { month: 'short' })}
                {version.data.version.publishedAt ? ` · publicada por ${version.data.version.publishedBy} el ${formatDateCO(version.data.version.publishedAt, { month: 'short' })}` : ''}
                {version.data.version.requestCount ? ` · ${version.data.version.requestCount} solicitud(es) usan esta versión` : ''}
              </Text>
            </div>
            {canEdit && version.data.version.status === 'borrador' && (
              <Group>
                <Button size='xs' variant='default' onClick={() => setModal({ kind: 'discard', idVersion: version.data!.version.id })}>
                  Descartar borrador
                </Button>
                <Button size='xs' color='green' leftSection={<IconRocket size={14} />} onClick={() => setModal({ kind: 'publish', idVersion: version.data!.version.id })} data-testid='sgc-flujo-publicar'>
                  Publicar
                </Button>
              </Group>
            )}
          </Group>
          <SgcFlowEditor
            definition={version.data.definition}
            editable={canEdit && version.data.version.status === 'borrador'}
            authorizationTypes={(types.data?.types ?? []).filter((t) => t.isActive).map((t) => ({ code: t.code, name: t.name }))}
            onSave={async (def: SgcFlowDefinition, reason: string) =>
              act(() => sgcSend(`/api/sgc/flows/versions/${version.data!.version.id}`, 'PUT', { company: id, definition: def, reason }), 'Borrador guardado y registrado en el control de cambios.')
            }
          />
        </Card>
      )}

      <ReasonModal
        opened={modal?.kind === 'draft'}
        title='Nueva versión del flujo'
        label='Motivo (control de cambios)'
        onClose={() => setModal(null)}
        onConfirm={async (reason) => {
          if (modal?.kind !== 'draft') return;
          await act(async () => {
            const res = await sgcSend<{ idFlowVersion: number }>(`/api/sgc/flows/${modal.idProcess}/versions`, 'POST', { company: id, reason });
            setSelected(res.idFlowVersion);
          }, 'Borrador creado a partir de la versión vigente.');
          setModal(null);
        }}
      >
        <Text size='sm'>Se copia la versión vigente a un borrador editable. La vigente sigue funcionando hasta que publique el borrador.</Text>
      </ReasonModal>
      <ReasonModal
        opened={modal?.kind === 'publish'}
        title='Publicar versión'
        label='Motivo de la publicación'
        onClose={() => setModal(null)}
        onConfirm={async (reason) => {
          if (modal?.kind !== 'publish') return;
          await act(() => sgcSend(`/api/sgc/flows/versions/${modal.idVersion}/publish`, 'POST', { company: id, reason }), 'Versión publicada: las solicitudes nuevas la usan; las que están en curso conservan su versión.');
          setModal(null);
        }}
      >
        <Text size='sm'>La versión vigente actual quedará retirada. Las solicitudes en curso siguen con la versión con la que arrancaron.</Text>
      </ReasonModal>
      <ReasonModal
        opened={modal?.kind === 'discard'}
        title='Descartar borrador'
        label='Motivo'
        onClose={() => setModal(null)}
        onConfirm={async (reason) => {
          if (modal?.kind !== 'discard') return;
          await act(() => sgcSend(`/api/sgc/flows/versions/${modal.idVersion}/discard`, 'POST', { company: id, reason }), 'Borrador descartado (queda en el registro de cambios).');
          setModal(null);
        }}
      />

      <Modal opened={createOpen} onClose={() => setCreateOpen(false)} title='Nuevo flujo validado' centered>
        <Stack>
          <TextInput label='Código' required value={newFlow.code} onChange={(e) => setNewFlow({ ...newFlow, code: e.currentTarget.value.toUpperCase() })} description='Mayúsculas, p. ej. CC (control de cambios)' data-testid='sgc-nuevo-flujo-codigo' />
          <TextInput label='Nombre' required value={newFlow.name} onChange={(e) => setNewFlow({ ...newFlow, name: e.currentTarget.value })} data-testid='sgc-nuevo-flujo-nombre' />
          <Select label='Categoría' data={SGC_FLOW_CATEGORIES.map((c) => ({ value: c, label: c }))} value={newFlow.category} onChange={(v) => setNewFlow({ ...newFlow, category: v ?? 'otro' })} allowDeselect={false} />
          <Textarea label='Descripción' autosize minRows={2} value={newFlow.description} onChange={(e) => setNewFlow({ ...newFlow, description: e.currentTarget.value })} />
          <Textarea label='Motivo (control de cambios)' required autosize minRows={2} value={newFlow.reason} onChange={(e) => setNewFlow({ ...newFlow, reason: e.currentTarget.value })} data-testid='sgc-nuevo-flujo-motivo' />
          <Text size='xs' c='dimmed'>
            Se crea con la versión 1 en borrador (solicitud → ejecución) para que la ajuste sin código y la publique.
          </Text>
          <Group justify='flex-end'>
            <Button variant='default' onClick={() => setCreateOpen(false)}>
              Cancelar
            </Button>
            <Button
              disabled={!newFlow.code || !newFlow.name || newFlow.reason.trim().length < 5}
              onClick={async () => {
                await act(async () => {
                  const res = await sgcSend<{ idFlowVersion: number }>('/api/sgc/flows', 'POST', { company: id, ...newFlow });
                  setSelected(res.idFlowVersion);
                }, 'Flujo creado con su versión 1 en borrador.');
                setCreateOpen(false);
                setNewFlow({ code: '', name: '', category: 'otro', description: '', reason: '' });
              }}
              data-testid='sgc-nuevo-flujo-crear'
            >
              Crear flujo
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}

function MatrixTab({ company }: { company: SgcCompanyAccess }) {
  const id = company.idCompany;
  const matrix = useSgcFetch<{ matrix: SgcMatrixRow[] }>(`/api/sgc/matrix?company=${id}`);
  const catalogs = useSgcFetch<SgcCatalogs>(`/api/sgc/catalogs?company=${id}`);
  const [row, setRow] = useState({ role: 'revisor', idProcess: '', idDocumentType: '', userEmail: '', cargoName: '', reason: '' });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [deactivate, setDeactivate] = useState<number | null>(null);
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: ok });
      matrix.reload();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  };
  return (
    <Stack>
      <Alert color='blue' variant='light' icon={<IconUsersGroup size={16} />}>
        La matriz solo SUGIERE quién elabora, revisa y aprueba por proceso y tipo documental (la más específica gana). El elaborador decide. Las filas marcadas como ejemplo se reemplazan con la
        matriz que entregue Nicolás.
      </Alert>
      {msg && (
        <Alert color={msg.ok ? 'green' : 'red'} icon={msg.ok ? <IconCheck size={16} /> : <IconAlertCircle size={16} />}>
          {msg.text}
        </Alert>
      )}
      <Card withBorder radius='md' p='md'>
        <Table.ScrollContainer minWidth={640}>
          <Table striped data-testid='sgc-matriz'>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Rol</Table.Th>
                <Table.Th>Proceso</Table.Th>
                <Table.Th>Tipo documental</Table.Th>
                <Table.Th>Persona o cargo</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(matrix.data?.matrix ?? []).map((m) => (
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
                  <Table.Td>
                    <Button size='xs' variant='subtle' color='red' onClick={() => setDeactivate(m.id)}>
                      Desactivar
                    </Button>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Card>
      <Card withBorder radius='md' p='md'>
        <Title order={5} mb='sm'>
          Agregar fila
        </Title>
        <Grid>
          <Grid.Col span={{ base: 12, md: 2 }}>
            <Select label='Rol' data={['elaborador', 'revisor', 'aprobador']} value={row.role} onChange={(v) => setRow({ ...row, role: v ?? 'revisor' })} allowDeselect={false} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 3 }}>
            <Select label='Proceso' clearable placeholder='Todos' data={(catalogs.data?.processes ?? []).map((p) => ({ value: String(p.id), label: `${p.code} · ${p.name}` }))} value={row.idProcess || null} onChange={(v) => setRow({ ...row, idProcess: v ?? '' })} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 3 }}>
            <Select label='Tipo documental' clearable placeholder='Todos' data={(catalogs.data?.documentTypes ?? []).map((t) => ({ value: String(t.id), label: `${t.code} · ${t.name}` }))} value={row.idDocumentType || null} onChange={(v) => setRow({ ...row, idDocumentType: v ?? '' })} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 2 }}>
            <TextInput label='Correo (persona)' value={row.userEmail} onChange={(e) => setRow({ ...row, userEmail: e.currentTarget.value, cargoName: '' })} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 2 }}>
            <TextInput label='o Cargo' value={row.cargoName} onChange={(e) => setRow({ ...row, cargoName: e.currentTarget.value, userEmail: '' })} />
          </Grid.Col>
          <Grid.Col span={12}>
            <Textarea label='Motivo del cambio' required autosize minRows={1} value={row.reason} onChange={(e) => setRow({ ...row, reason: e.currentTarget.value })} />
          </Grid.Col>
        </Grid>
        <Group justify='flex-end' mt='sm'>
          <Button
            disabled={row.reason.trim().length < 5 || (!row.userEmail && !row.cargoName)}
            onClick={() =>
              act(async () => {
                await sgcSend('/api/sgc/matrix', 'POST', { company: id, ...row, idProcess: row.idProcess || null, idDocumentType: row.idDocumentType || null });
                setRow({ ...row, userEmail: '', cargoName: '', reason: '' });
              }, 'Fila agregada a la matriz.')
            }
          >
            Agregar
          </Button>
        </Group>
      </Card>
      <ReasonModal
        opened={deactivate !== null}
        title='Desactivar fila de la matriz'
        label='Motivo'
        onClose={() => setDeactivate(null)}
        onConfirm={async (reason) => {
          await act(() => sgcSend(`/api/sgc/matrix/${deactivate}/deactivate`, 'POST', { company: id, reason }), 'Fila desactivada.');
          setDeactivate(null);
        }}
      />
    </Stack>
  );
}

function ChangesTab({ company }: { company: SgcCompanyAccess }) {
  const changes = useSgcFetch<{ changes: SgcConfigChangeRow[] }>(`/api/sgc/flows/changes?company=${company.idCompany}`);
  return (
    <Card withBorder radius='md' p='md'>
      <Text size='sm' c='dimmed' mb='sm'>
        Registro de SOLO INSERCIÓN (la base rechaza modificarlo o borrarlo): quién, cuándo, qué cambió (antes/después) y por qué.
      </Text>
      <Accordion variant='separated' data-testid='sgc-registro-cambios'>
        {(changes.data?.changes ?? []).map((c) => (
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
                Entidad: {c.entity} {c.entityId} {c.ip ? `· desde ${c.ip}` : ''}
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
    </Card>
  );
}

export default function SgcFlowsAdminPage() {
  return (
    <SgcShell section='Administración de flujos validados' subtitle='Procesos, tareas, responsables, formularios y transiciones del sistema validado, con versiones y control de cambios.'>
      {(company) =>
        company.canAdminFlows || company.canQuality ? (
          <Tabs defaultValue='flujos' keepMounted={false}>
            <Tabs.List mb='lg'>
              <Tabs.Tab value='flujos' leftSection={<IconGitBranch size={16} />}>
                Flujos
              </Tabs.Tab>
              <Tabs.Tab value='matriz' leftSection={<IconUsersGroup size={16} />}>
                Matriz de responsables
              </Tabs.Tab>
              <Tabs.Tab value='cambios' leftSection={<IconHistory size={16} />}>
                Registro de cambios
              </Tabs.Tab>
            </Tabs.List>
            <Tabs.Panel value='flujos'>
              <FlowsTab company={company} />
            </Tabs.Panel>
            <Tabs.Panel value='matriz'>
              <MatrixTab company={company} />
            </Tabs.Panel>
            <Tabs.Panel value='cambios'>
              <ChangesTab company={company} />
            </Tabs.Panel>
          </Tabs>
        ) : (
          <Alert color='yellow' icon={<IconAlertCircle size={16} />} data-testid='sgc-solo-flujos'>
            Esta sección es exclusiva de la administración de flujos validados y de Aseguramiento de Calidad.
          </Alert>
        )
      }
    </SgcShell>
  );
}
