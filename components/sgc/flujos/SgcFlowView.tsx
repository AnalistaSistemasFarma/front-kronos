'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Alert, Anchor, Badge, Box, Breadcrumbs, Button, Card, Flex, Grid, Group, Stack, Switch, Text, Textarea, Title } from '@mantine/core';
import {
  IconAlertCircle,
  IconArrowLeft,
  IconBuilding,
  IconCategory,
  IconCheck,
  IconChevronRight,
  IconFileText,
  IconGitBranch,
  IconHistory,
  IconProgress,
  IconRocket,
  IconTicket,
  IconTrash,
  IconUserCheck,
  IconUsersGroup,
  IconX,
} from '@tabler/icons-react';
import toast from 'react-hot-toast';
import { SGC_BASE_URL } from '../../../lib/sgc/constants';
import type { SgcAuthorizationTypeRow } from '../../../lib/sgc/db/authorizations';
import type { SgcFlowProcessSummary, SgcFlowVersionDetail, SgcFlowVersionSummary } from '../../../lib/sgc/db/flows';
import type { SgcFlowDefinition, SgcTaskDefinition } from '../../../lib/sgc/flows/definition';
import { formatDateCO } from '../tareas/format';
import { sgcHref, useSgcCompany } from '../useSgcCompany';
import { sgcSend, useSgcFetch } from '../useSgcFetch';
import SgcFlowFieldsCard from './SgcFlowFieldsCard';
import { SgcAddTaskModal, SgcChangesModal, SgcMatrixModal, SgcVersionsModal } from './SgcFlowModals';
import SgcFlowTasksCard from './SgcFlowTasksCard';
import SgcFlowTransitionsCard from './SgcFlowTransitionsCard';
import { SgcReasonModal, categoryLabel, statusColor, statusLabel } from './SgcFlowUi';
import { SGC_FLOWS_URL } from './SgcFlowsList';

/**
 * Vista interna de un flujo de Documentos (/process/sgc-documental/flujos/<id>,
 * ?version=<n> para ver otra versión). COPIA CONGELADA (2026-10-01) del
 * marcado de view-workflows de SynerLink: misma cabecera y migas, tarjetas
 * «Categoría» y «Proceso», «Flujo de Actividades», tarjetas de campos y de
 * transiciones (en el lugar de «Archivos requeridos»), botonera inferior y
 * modales. Diferencias del sistema validado, en una barra discreta arriba:
 * solo se edita un BORRADOR; guardar, publicar, descartar y crear versión
 * piden motivo y quedan en sgc.config_change_log; publicar retira la vigente.
 * El diagrama del flujo está deshabilitado, igual que en SynerLink.
 */

type Modal = null | 'save' | 'publish' | 'discard' | 'draft' | 'addTask' | 'matrix' | 'changes' | 'versions';

function pickVersion(flow: SgcFlowProcessSummary | undefined, versionParam: string | null): SgcFlowVersionSummary | null {
  if (!flow) return null;
  const n = Number(versionParam);
  return (
    (versionParam && flow.versions.find((v) => v.versionNumber === n)) ||
    flow.versions.find((v) => v.status === 'vigente') ||
    flow.versions.find((v) => v.status === 'borrador') ||
    flow.versions[0] ||
    null
  );
}

export default function SgcFlowView({ idFlowProcess }: { idFlowProcess: number }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const versionParam = searchParams.get('version');
  const { estado, company } = useSgcCompany();
  const idCompany = company?.idCompany ?? null;
  const allowed = !!company && (company.canAdminFlows || company.canQuality);
  const canEdit = !!company?.canAdminFlows;

  const flows = useSgcFetch<{ flows: SgcFlowProcessSummary[] }>(allowed && idCompany ? `/api/sgc/flows?company=${idCompany}` : null);
  const types = useSgcFetch<{ types: SgcAuthorizationTypeRow[] }>(allowed && idCompany ? `/api/sgc/authorization-types?company=${idCompany}` : null);
  const flow = flows.data?.flows.find((f) => f.id === idFlowProcess);
  const selected = pickVersion(flow, versionParam);
  const version = useSgcFetch<SgcFlowVersionDetail>(selected && idCompany ? `/api/sgc/flows/versions/${selected.id}?company=${idCompany}` : null);
  const detail = version.data && version.data.version.id === selected?.id ? version.data : null;
  const draft = flow?.versions.find((v) => v.status === 'borrador') ?? null;
  const isDraft = detail?.version.status === 'borrador';

  const [isEditing, setIsEditing] = useState(false);
  const [edited, setEdited] = useState<SgcFlowDefinition | null>(null);
  const [editedProcess, setEditedProcess] = useState<{ description: string; isActive: boolean } | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [matrixCount, setMatrixCount] = useState(0);
  const [changesCount, setChangesCount] = useState(0);
  const [changesKey, setChangesKey] = useState(0);

  const authorizationTypes = useMemo(() => (types.data?.types ?? []).filter((t) => t.isActive).map((t) => ({ value: t.code, label: `${t.code} · ${t.name}` })), [types.data]);
  const originalKeys = useMemo(() => new Set((detail?.definition.tasks ?? []).map((t) => t.key)), [detail]);
  const originalFieldIds = useMemo(() => new Set((detail?.definition.formFields ?? []).map((f) => `${f.taskKey ?? ''}:${f.key}`)), [detail]);
  const shown: SgcFlowDefinition | null = isEditing && edited ? edited : detail?.definition ?? null;

  const versionHref = useCallback((n: number) => sgcHref(`${SGC_FLOWS_URL}/${idFlowProcess}`, idCompany, { version: String(n) }), [idFlowProcess, idCompany]);

  useEffect(() => {
    setIsEditing(false);
    setEdited(null);
    setModal((m) => (m === 'versions' ? null : m));
  }, [selected?.id]);

  const notify = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    if (type === 'success') toast.success(text);
    else toast.error(text);
  };
  const reloadAll = () => {
    flows.reload();
    version.reload();
    setChangesKey((k) => k + 1);
  };

  const startEditing = () => {
    if (!detail || !flow) return;
    setEdited(structuredClone(detail.definition));
    setEditedProcess({ description: flow.description ?? '', isActive: flow.isActive });
    setMessage(null);
    setIsEditing(true);
  };
  const cancelEditing = () => {
    setIsEditing(false);
    setEdited(null);
    setEditedProcess(null);
  };

  const definitionDirty = !!edited && !!detail && JSON.stringify(edited) !== JSON.stringify(detail.definition);
  const processDirty = !!editedProcess && !!flow && (editedProcess.description.trim() !== (flow.description ?? '') || editedProcess.isActive !== flow.isActive);

  const addTask = (t: Omit<SgcTaskDefinition, 'key' | 'stepOrder'>) => {
    if (!edited) return;
    let n = edited.tasks.length + 1;
    while (edited.tasks.some((x) => x.key === `tarea_${n}`)) n++;
    const stepOrder = Math.max(0, ...edited.tasks.map((x) => x.stepOrder)) + 1;
    setEdited({ ...edited, tasks: [...edited.tasks, { ...t, key: `tarea_${n}`, stepOrder }] });
    setModal(null);
  };

  if (estado.tipo === 'cargando' || (allowed && !flows.data && !flows.error) || (selected && !detail && !version.error)) {
    return (
      <div className='flex items-center justify-center' style={{ minHeight: '100vh', backgroundColor: 'var(--mantine-color-body)' }}>
        <div className='text-center'>
          <div className='animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4'></div>
          <Text size='lg'>Cargando detalles del flujo de trabajo...</Text>
        </div>
      </div>
    );
  }

  const back = () => router.push(sgcHref(SGC_FLOWS_URL, idCompany));
  const errorText =
    estado.tipo === 'error'
      ? estado.mensaje
      : !company
        ? 'No tiene acceso a Documentos en ninguna empresa activa.'
        : !allowed
          ? 'Esta sección es exclusiva de la administración de flujos validados y de Aseguramiento de Calidad.'
          : flows.error || version.error || (!flow ? 'Flujo de trabajo no encontrado' : null);
  if (errorText || !flow || !detail || !shown) {
    return (
      <div className='flex items-center justify-center' style={{ minHeight: '100vh', backgroundColor: 'var(--mantine-color-body)' }}>
        <Card shadow='sm' p='xl' radius='md' withBorder className='max-w-md'>
          <Alert icon={<IconAlertCircle size={20} />} title='Error' color='red' mb='md' data-testid='sgc-solo-flujos'>
            {errorText ?? 'El flujo no tiene versiones.'}
          </Alert>
          <Button fullWidth onClick={back} leftSection={<IconArrowLeft size={16} />}>
            Volver a Flujos de Trabajo
          </Button>
        </Card>
      </div>
    );
  }

  const v = detail.version;
  const breadcrumbItems = [
    { title: 'Documentos', href: sgcHref(SGC_BASE_URL, idCompany) },
    { title: 'Flujos', href: sgcHref(SGC_FLOWS_URL, idCompany) },
    { title: `${flow.code} · ${flow.name}`, href: '#' },
  ].map((item, index) =>
    item.href !== '#' ? (
      <Link key={index} href={item.href} passHref>
        <Anchor component='span' className='hover:text-blue-6 transition-colors'>
          {item.title}
        </Anchor>
      </Link>
    ) : (
      <span key={index} className='text-[var(--mantine-color-dimmed)]'>
        {item.title}
      </span>
    )
  );

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--mantine-color-body)' }}>
      <div className='max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8'>
        <Card shadow='sm' p='xl' radius='md' withBorder mb='6' data-testid='sgc-flujo-cabecera'>
          <Breadcrumbs separator={<IconChevronRight size={16} />} className='mb-4'>
            {breadcrumbItems}
          </Breadcrumbs>

          <Flex justify='space-between' align='center' wrap='wrap' gap='md'>
            <div>
              <Title order={1} className='text-3xl font-bold mb-2 flex items-center gap-3' data-testid='sgc-titulo'>
                <IconProgress size={32} className='text-blue-6' />
                Flujo de Trabajo #{flow.code}
              </Title>
              <Text size='lg' c='dimmed'>
                {flow.name}
              </Text>
            </div>

            <Group>
              <Button variant='light' leftSection={<IconUsersGroup size={16} />} onClick={() => setModal('matrix')} data-testid='sgc-abrir-matriz'>
                Matriz de responsables{matrixCount > 0 ? ` (${matrixCount})` : ''}
              </Button>
              <Button variant='light' color='teal' leftSection={<IconHistory size={16} />} onClick={() => setModal('changes')} data-testid='sgc-abrir-registro'>
                Registro de cambios{changesCount > 0 ? ` (${changesCount})` : ''}
              </Button>
              <Button variant='light' color='violet' leftSection={<IconGitBranch size={16} />} onClick={() => setModal('versions')} data-testid='sgc-abrir-versiones'>
                Versiones ({flow.versions.length})
              </Button>
              <Badge color={flow.isActive ? 'green' : 'gray'} size='lg' radius='sm' variant='light'>
                {flow.isActive ? 'Activo' : 'Inactivo'}
              </Badge>
            </Group>
          </Flex>
        </Card>

        {/* Barra de versión: lo único propio del sistema validado sobre el diseño de SynerLink. */}
        <Alert
          variant='light'
          color={statusColor(v.status)}
          radius='md'
          mb='lg'
          icon={<IconGitBranch size={18} />}
          data-testid='sgc-version-barra'
          styles={{ body: { width: '100%' } }}
        >
          <Group justify='space-between' wrap='wrap' gap='sm'>
            <div>
              <Group gap='xs'>
                <Text size='sm' fw={600}>
                  Versión {v.versionNumber}
                </Text>
                <Badge color={statusColor(v.status)} variant='light' size='sm' data-testid='sgc-version-estado'>
                  {v.status}
                </Badge>
                {isEditing && (
                  <Badge color={definitionDirty || processDirty ? 'orange' : 'gray'} variant='outline' size='sm'>
                    {definitionDirty || processDirty ? 'Cambios sin guardar' : 'Sin cambios'}
                  </Badge>
                )}
              </Group>
              <Text size='xs' c='dimmed' lineClamp={2} title={v.changeReason}>
                {v.changeReason} · creada por {v.createdBy} el {formatDateCO(v.createdAt, { month: 'short' })}
                {v.publishedAt ? ` · publicada por ${v.publishedBy} el ${formatDateCO(v.publishedAt, { month: 'short' })}` : ''}
                {v.status === 'vigente' ? ' · las solicitudes nuevas usan esta versión' : ''}
                {v.status === 'borrador' ? ' · solo un borrador se edita; al publicarlo, la vigente queda retirada' : ''}
                {v.status === 'retirada' ? ' · retirada: solo consulta (las solicitudes que la usan la conservan)' : ''}
              </Text>
            </div>
            <Group gap='xs'>
              {draft && draft.id !== v.id && (
                <Button size='xs' variant='light' color='orange' component={Link} href={versionHref(draft.versionNumber)} data-testid='sgc-ver-borrador'>
                  Ver borrador v{draft.versionNumber}
                </Button>
              )}
              {canEdit && !draft && (
                <Button size='xs' variant='light' leftSection={<IconGitBranch size={14} />} onClick={() => setModal('draft')} data-testid='sgc-flujo-nueva-version'>
                  Crear borrador
                </Button>
              )}
              {canEdit && isDraft && !isEditing && (
                <>
                  <Button size='xs' variant='default' leftSection={<IconTrash size={14} />} onClick={() => setModal('discard')} data-testid='sgc-flujo-descartar'>
                    Descartar
                  </Button>
                  <Button size='xs' color='green' leftSection={<IconRocket size={14} />} onClick={() => setModal('publish')} data-testid='sgc-flujo-publicar'>
                    Publicar
                  </Button>
                </>
              )}
            </Group>
          </Group>
        </Alert>

        {message && (
          <Alert color={message.type === 'success' ? 'green' : 'red'} mb='lg' icon={message.type === 'success' ? <IconCheck size={16} /> : <IconAlertCircle size={16} />} withCloseButton onClose={() => setMessage(null)} data-testid='sgc-flujos-mensaje'>
            {message.text}
          </Alert>
        )}

        <Grid gutter='lg'>
          <Grid.Col span={{ base: 12, lg: 4 }}>
            <Stack gap='lg'>
              <Card shadow='sm' p='xl' radius='md' withBorder style={{ backgroundColor: 'var(--mantine-color-indigo-light)' }}>
                <Group mb='md'>
                  <Box className='bg-indigo-500 p-2 rounded-lg' style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <IconCategory size={24} color='white' />
                  </Box>
                  <Title order={2} className='text-indigo-700'>
                    Categoría
                  </Title>
                </Group>
                <Stack gap='md'>
                  <Card withBorder radius='md' p='md'>
                    <Stack gap='sm'>
                      <Group>
                        <IconBuilding size={18} style={{ color: 'var(--mantine-color-dimmed)' }} />
                        <Text size='sm' c='dimmed' fw={500}>
                          Empresa
                        </Text>
                      </Group>
                      <Text size='lg' fw={600}>
                        {company?.companyName}
                      </Text>
                    </Stack>
                  </Card>
                  <Card withBorder radius='md' p='md'>
                    <Stack gap='sm'>
                      <Group>
                        <IconCategory size={18} style={{ color: 'var(--mantine-color-dimmed)' }} />
                        <Text size='sm' c='dimmed' fw={500}>
                          Nombre de Categoría
                        </Text>
                      </Group>
                      <Text size='lg' fw={600}>
                        {categoryLabel(flow.category)}
                      </Text>
                    </Stack>
                  </Card>
                </Stack>
              </Card>

              <Flex justify='center' align='center'>
                <div className='w-1 h-8 bg-gradient-to-b from-indigo-300 to-teal-300 rounded-full'></div>
              </Flex>

              <Card shadow='sm' p='xl' radius='md' withBorder style={{ backgroundColor: 'var(--mantine-color-teal-light)' }}>
                <Group mb='md'>
                  <Box className='bg-teal-500 p-2 rounded-lg' style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <IconProgress size={24} color='white' />
                  </Box>
                  <Title order={2} className='text-teal-700'>
                    Proceso
                  </Title>
                </Group>
                <Stack gap='md'>
                  <Card withBorder radius='md' p='md'>
                    <Stack gap='sm'>
                      <Group>
                        <IconProgress size={18} style={{ color: 'var(--mantine-color-dimmed)' }} />
                        <Text size='sm' c='dimmed' fw={500}>
                          Nombre del Proceso
                        </Text>
                      </Group>
                      <Text size='lg' fw={600}>
                        {flow.code} · {flow.name}
                      </Text>
                    </Stack>
                  </Card>
                  <Card withBorder radius='md' p='md'>
                    <Stack gap='sm'>
                      <Group>
                        <IconUserCheck size={18} style={{ color: 'var(--mantine-color-dimmed)' }} />
                        <Text size='sm' c='dimmed' fw={500}>
                          Usuario Asignado al Proceso
                        </Text>
                      </Group>
                      <Text size='lg' fw={600}>
                        {flow.ownerEmail || 'Sin asignar'}
                      </Text>
                    </Stack>
                  </Card>
                  <Card withBorder radius='md' p='md'>
                    <Stack gap='sm'>
                      <Text size='sm' c='dimmed' fw={500}>
                        Descripción
                      </Text>
                      {isEditing && editedProcess ? (
                        <Textarea value={editedProcess.description} onChange={(e) => setEditedProcess({ ...editedProcess, description: e.target.value })} placeholder='Ingrese la descripción' minRows={3} autosize />
                      ) : (
                        <Text size='md' className='whitespace-pre-line'>
                          {flow.description || 'Sin descripción'}
                        </Text>
                      )}
                    </Stack>
                  </Card>
                  <Card withBorder radius='md' p='md'>
                    <Stack gap='sm'>
                      <Text size='sm' c='dimmed' fw={500}>
                        Activo
                      </Text>
                      {isEditing && editedProcess ? (
                        <Switch checked={editedProcess.isActive} onChange={(e) => setEditedProcess({ ...editedProcess, isActive: e.target.checked })} label={editedProcess.isActive ? 'Sí' : 'No'} color='green' />
                      ) : (
                        <Group gap='xs'>
                          {flow.isActive ? (
                            <>
                              <IconCheck size={18} className='text-green-500' />
                              <Badge color='green' size='lg' variant='light'>
                                Sí
                              </Badge>
                            </>
                          ) : (
                            <>
                              <IconX size={18} style={{ color: 'var(--mantine-color-dimmed)' }} />
                              <Badge color='gray' size='lg' variant='light'>
                                No
                              </Badge>
                            </>
                          )}
                        </Group>
                      )}
                    </Stack>
                  </Card>
                  <Card withBorder radius='md' p='md'>
                    <Stack gap='sm'>
                      <Group>
                        <IconFileText size={18} style={{ color: 'var(--mantine-color-dimmed)' }} />
                        <Text size='sm' c='dimmed' fw={500}>
                          Solicitudes con esta versión
                        </Text>
                      </Group>
                      <Group gap='xs'>
                        <Badge color={v.requestCount ? 'blue' : 'gray'} size='lg' variant='light'>
                          {v.requestCount}
                        </Badge>
                        <Text size='xs' c='dimmed'>
                          Una solicitud en curso conserva la versión con que arrancó.
                        </Text>
                      </Group>
                    </Stack>
                  </Card>
                </Stack>
              </Card>
            </Stack>
          </Grid.Col>

          <Grid.Col span={{ base: 12, lg: 8 }}>
            {/* Diagrama del flujo deshabilitado, igual que en SynerLink (2026-09-02, pendiente rediseño). */}
            <SgcFlowTasksCard definition={shown} isEditing={isEditing} originalKeys={originalKeys} authorizationTypes={authorizationTypes} onChange={setEdited} onAddTask={() => setModal('addTask')} />
          </Grid.Col>
        </Grid>

        <SgcFlowFieldsCard definition={shown} isEditing={isEditing} originalFieldIds={originalFieldIds} onChange={setEdited} />

        <SgcFlowTransitionsCard definition={shown} isEditing={isEditing} onChange={setEdited} />

        <Card shadow='sm' p='lg' radius='md' withBorder mt='6'>
          <Group justify='space-between'>
            {canEdit && isDraft ? (
              !isEditing ? (
                <Button color='blue' onClick={startEditing} leftSection={<IconTicket size={16} />} data-testid='sgc-flujo-editar'>
                  Editar Flujo de Trabajo
                </Button>
              ) : (
                <Group>
                  <Button
                    color='green'
                    onClick={() => (definitionDirty || processDirty ? setModal('save') : notify('error', 'No hay cambios para guardar.'))}
                    leftSection={<IconCheck size={16} />}
                    data-testid='sgc-flujo-guardar'
                  >
                    Guardar Cambios
                  </Button>
                  <Button variant='outline' color='gray' onClick={cancelEditing} leftSection={<IconX size={16} />}>
                    Cancelar
                  </Button>
                </Group>
              )
            ) : canEdit && !draft ? (
              <Button color='blue' onClick={() => setModal('draft')} leftSection={<IconGitBranch size={16} />}>
                Crear borrador
              </Button>
            ) : canEdit && draft ? (
              <Button color='blue' component={Link} href={versionHref(draft.versionNumber)} leftSection={<IconTicket size={16} />}>
                Editar borrador v{draft.versionNumber}
              </Button>
            ) : (
              <Text size='sm' c='dimmed'>
                Solo consulta: la edición es de la administración de flujos validados.
              </Text>
            )}

            <Button variant='outline' onClick={back} leftSection={<IconArrowLeft size={16} />}>
              Volver a Flujos de Trabajo
            </Button>
          </Group>
        </Card>

        <SgcAddTaskModal opened={modal === 'addTask'} onClose={() => setModal(null)} onAdd={addTask} authorizationTypes={authorizationTypes} />
        {idCompany && <SgcMatrixModal opened={modal === 'matrix'} onClose={() => setModal(null)} idCompany={idCompany} canEdit={canEdit} onCount={setMatrixCount} />}
        {idCompany && <SgcChangesModal opened={modal === 'changes'} onClose={() => setModal(null)} idCompany={idCompany} idFlowProcess={flow.id} reloadKey={changesKey} onCount={setChangesCount} />}
        <SgcVersionsModal opened={modal === 'versions'} onClose={() => setModal(null)} versions={flow.versions} selectedId={v.id} hrefOf={(x) => versionHref(x.versionNumber)} />

        <SgcReasonModal
          opened={modal === 'save'}
          title='Guardar Cambios'
          hint='El borrador se valida completo y el antes/después queda en el registro de cambios'
          icon={<IconCheck size={20} className='text-green-600' />}
          box='bg-green-100'
          label='Motivo del cambio'
          confirmLabel='Guardar Cambios'
          confirmColor='green'
          onClose={() => setModal(null)}
          onConfirm={async (reason) => {
            try {
              if (processDirty && editedProcess) await sgcSend(`/api/sgc/flows/${flow.id}`, 'PATCH', { company: idCompany, description: editedProcess.description, isActive: editedProcess.isActive, reason });
              if (definitionDirty && edited) await sgcSend(`/api/sgc/flows/versions/${v.id}`, 'PUT', { company: idCompany, definition: edited, reason });
              setModal(null);
              cancelEditing();
              notify('success', 'Borrador guardado y registrado en el control de cambios.');
              reloadAll();
            } catch (e) {
              setModal(null);
              notify('error', e instanceof Error ? e.message : String(e));
            }
          }}
        />
        <SgcReasonModal
          opened={modal === 'publish'}
          title='Publicar versión'
          hint={`La versión vigente actual quedará retirada; las solicitudes en curso siguen con su versión`}
          icon={<IconRocket size={20} className='text-green-600' />}
          box='bg-green-100'
          label='Motivo de la publicación'
          confirmLabel='Publicar'
          confirmColor='green'
          onClose={() => setModal(null)}
          onConfirm={async (reason) => {
            try {
              await sgcSend(`/api/sgc/flows/versions/${v.id}/publish`, 'POST', { company: idCompany, reason });
              setModal(null);
              notify('success', 'Versión publicada: las solicitudes nuevas la usan; las que están en curso conservan su versión.');
              reloadAll();
            } catch (e) {
              setModal(null);
              notify('error', e instanceof Error ? e.message : String(e));
            }
          }}
        />
        <SgcReasonModal
          opened={modal === 'discard'}
          title='Descartar borrador'
          hint='El borrador se elimina, pero queda en el registro de cambios'
          icon={<IconTrash size={20} className='text-red-600' />}
          box='bg-red-100'
          label='Motivo'
          confirmLabel='Descartar'
          confirmColor='red'
          onClose={() => setModal(null)}
          onConfirm={async (reason) => {
            try {
              await sgcSend(`/api/sgc/flows/versions/${v.id}/discard`, 'POST', { company: idCompany, reason });
              setModal(null);
              notify('success', 'Borrador descartado (queda en el registro de cambios).');
              router.replace(sgcHref(`${SGC_FLOWS_URL}/${flow.id}`, idCompany));
              reloadAll();
            } catch (e) {
              setModal(null);
              notify('error', e instanceof Error ? e.message : String(e));
            }
          }}
        />
        <SgcReasonModal
          opened={modal === 'draft'}
          title='Nueva versión del flujo'
          hint='Se copia la versión vigente a un borrador editable; la vigente sigue funcionando hasta publicar'
          icon={<IconGitBranch size={20} className='text-blue-600' />}
          box='bg-blue-100'
          label='Motivo (control de cambios)'
          confirmLabel='Crear borrador'
          onClose={() => setModal(null)}
          onConfirm={async (reason) => {
            try {
              const res = await sgcSend<{ idFlowVersion: number; versionNumber: number }>(`/api/sgc/flows/${flow.id}/versions`, 'POST', { company: idCompany, reason });
              setModal(null);
              notify('success', 'Borrador creado a partir de la versión vigente.');
              router.push(versionHref(res.versionNumber));
              reloadAll();
            } catch (e) {
              setModal(null);
              notify('error', e instanceof Error ? e.message : String(e));
            }
          }}
        />
      </div>
    </div>
  );
}
