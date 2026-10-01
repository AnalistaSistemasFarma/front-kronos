'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Breadcrumbs,
  Button,
  Card,
  Divider,
  Flex,
  Grid,
  Group,
  Loader,
  Modal,
  Select,
  Stack,
  Text,
  Textarea,
  Title,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconArrowLeft,
  IconBuilding,
  IconCalendar,
  IconCheck,
  IconChevronRight,
  IconFileDescription,
  IconLock,
  IconProgress,
  IconSignature,
  IconTag,
  IconTicket,
  IconX,
} from '@tabler/icons-react';
import { sendMessage } from '../../email/utils/sendMessage';
import type { SgcRequestDetail } from '../../../lib/sgc/db/requests';
import type { SgcSignatureMeaning } from '../../../lib/sgc/flows/definition';
import { sgcStatusColor } from '../../../lib/sgc/flows/engine';
import type { SgcMatrixSuggestion } from '../../../lib/sgc/flows/matrix';
import { sgcSend, useSgcFetch } from '../useSgcFetch';
import { formatDateCO } from './format';
import SgcAdditionalInfo from './SgcAdditionalInfo';
import SgcAttachmentsCard from './SgcAttachmentsCard';
import SgcInteractionHistory from './SgcInteractionHistory';
import SgcSignersPanel from './SgcSignersPanel';
import SgcTasksModal from './SgcTasksModal';
import SgcSignModal from '../signature/SgcSignModal';
import SgcSignaturesCard from '../signature/SgcSignaturesCard';
import SgcDisseminationCard from './SgcDisseminationCard';
import SgcReadingPanel from './SgcReadingPanel';
import SgcTrainingCard from './SgcTrainingCard';

/**
 * Vista interna de una solicitud documental y de una «Tarea documental».
 * COPIA CONGELADA (2026-09-30) de la estructura de
 * app/(hub)/process/request-general/view-activities (modo «tarea») y
 * view-request (modo «solicitud») de SynerLink: misma cabecera, mismas
 * tarjetas, mismos rótulos y el mismo flujo «Editar Tarea → Guardar Cambios»,
 * sobre la capa de datos y las APIs propias del SGC (/api/sgc/**). Se depuró
 * lo que no aplica (SAPSEND, tesorería, Orión) y se partió en componentes.
 */
export interface SgcRequestViewProps {
  mode: 'tarea' | 'solicitud';
  id: number;
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className='pb-2'>
      <Text size='sm' color='gray.6' fw={500}>
        {label}
      </Text>
      <Text size='sm'>{children}</Text>
    </div>
  );
}

export default function SgcRequestView({ mode, id }: SgcRequestViewProps) {
  const router = useRouter();
  const { data: session } = useSession();
  const me = (session?.user?.email ?? '').toLowerCase();
  const url = mode === 'tarea' ? `/api/sgc/tasks/${id}` : `/api/sgc/requests/${id}`;
  const { data, error, loading, reload } = useSgcFetch<SgcRequestDetail>(url);
  const idCompany = data?.request.idCompany ?? null;
  const users = useSgcFetch<{ users: { email: string; name: string | null }[] }>(idCompany ? `/api/sgc/users?company=${idCompany}` : null);
  const sugg = useSgcFetch<{ suggestion: SgcMatrixSuggestion[] }>(
    idCompany && data?.permissions.canChangeSigners
      ? `/api/sgc/matrix?company=${idCompany}&process=${data.request.process?.id ?? ''}&documentType=${data.request.documentType?.id ?? ''}`
      : null
  );
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [tasksOpen, setTasksOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [decision, setDecision] = useState<string | null>(null);
  const [resolution, setResolution] = useState('');
  const [saving, setSaving] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [signOpen, setSignOpen] = useState(false);

  const userOptions = useMemo(() => (users.data?.users ?? []).map((u) => ({ value: u.email, label: u.name ? `${u.name} (${u.email})` : u.email })), [users.data]);

  const run = useCallback(
    async (fn: () => Promise<unknown>, ok: string) => {
      setMessage(null);
      try {
        await fn();
        setMessage({ type: 'success', text: ok });
        reload();
        return true;
      } catch (e) {
        setMessage({ type: 'error', text: e instanceof Error ? e.message : String(e) });
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return false;
      }
    },
    [reload]
  );

  if (loading && !data) {
    return (
      <div className='min-h-screen flex items-center justify-center'>
        <Group gap='sm'>
          <Loader size='sm' />
          <Text c='dimmed'>Cargando...</Text>
        </Group>
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className='max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8'>
        <Alert color='red' icon={<IconAlertCircle size={16} />} title='Error'>
          {error ?? 'No se encontró la información.'}
        </Alert>
      </div>
    );
  }

  const { request, permissions } = data;
  const focus = mode === 'tarea' ? data.tasks.find((t) => t.id === data.focusTaskId) ?? null : null;
  const task = focus ?? data.tasks.filter((t) => t.status === 'abierta' || t.status === 'en_espera').at(-1) ?? null;
  const myAction = focus?.myAction ?? null;
  const resolved = mode === 'tarea' ? Boolean(focus && focus.status !== 'abierta') : request.status === 'completada' || request.status === 'cancelada';
  const statusLabel = mode === 'tarea' ? focus?.statusLabel ?? '' : request.statusLabel;
  const breadcrumbItems = [
    { title: 'Procesos', href: '/process' },
    mode === 'tarea'
      ? { title: 'Tareas documentales', href: `/process/sgc-documental/tareas?empresa=${request.idCompany}` }
      : { title: 'Solicitudes documentales', href: `/process/sgc-documental/solicitudes?empresa=${request.idCompany}` },
    { title: mode === 'tarea' ? 'Tarea' : 'Solicitud', href: '#' },
  ].map((item, index) =>
    item.href !== '#' ? (
      <Link key={index} href={item.href} passHref>
        <Anchor component='span' className='hover:text-blue-600 transition-colors'>
          {item.title}
        </Anchor>
      </Link>
    ) : (
      <Text key={index} component='span' c='dimmed'>
        {item.title}
      </Text>
    )
  );

  const decisionOptions =
    myAction?.kind === 'enviar'
      ? [{ value: 'aprobar', label: 'Resuelto — enviar a revisión' }]
      : focus?.role === 'capacitacion'
        ? [{ value: 'aprobar', label: 'Resuelto — cerrar la capacitación' }]
        : [
            { value: 'aprobar', label: focus?.isAuthorization ? 'Resuelto — autorizar (aprobar)' : 'Resuelto — aprobar' },
            ...(focus?.canReturn === false ? [] : [{ value: 'devolver', label: 'Devuelto — devolver a elaboración' }]),
          ];

  const saveDecision = async () => {
    if (!focus || !decision) {
      setMessage({ type: 'error', text: 'Selecciona el estado de la tarea.' });
      return;
    }
    if (decision === 'devolver' && resolution.trim().length < 5) {
      setMessage({ type: 'error', text: 'Escriba las observaciones de la devolución (mínimo 5 caracteres).' });
      return;
    }
    // Sprint 3: aprobar (o enviar) un paso con firma abre la FIRMA ELECTRÓNICA (reautenticación + motivo).
    if (decision === 'aprobar' && myAction?.signatureMeaning) {
      setSignOpen(true);
      return;
    }
    setSaving(true);
    const ok = await run(() => sgcSend(`/api/sgc/tasks/${focus.id}/decision`, 'POST', { decision, comment: resolution }), 'Tarea actualizada correctamente.');
    setSaving(false);
    if (ok) {
      setIsEditing(false);
      setDecision(null);
      setResolution('');
    }
  };

  const signatureLabel = focus?.signatureLabel;
  // Sprint 4: «Capacitó» se firma sobre el Excel de resultados cargado (no sobre el borrador).
  const signContent =
    myAction?.signatureMeaning === 'capacito'
      ? data.training?.upload
        ? { ref: `training_upload:${data.training.upload.id}`, name: data.training.upload.fileName, sha256: data.training.upload.sha256 }
        : null
      : data.currentDraft;
  const onDisseminationAction = (body: Record<string, unknown>, ok: string) => run(() => sgcSend(`/api/sgc/requests/${request.id}/dissemination`, 'POST', body), ok);
  const draftHref = data.currentDraft
    ? data.currentDraft.kind === 'borrador_editor'
      ? `/process/sgc-documental/solicitudes/${request.id}/borrador?empresa=${request.idCompany}`
      : `/api/sgc/requests/${request.id}/attachments/${data.currentDraft.ref.split(':')[1]}`
    : null;

  return (
    <div className='app-canvas'>
      <div className='max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8'>
        <Card shadow='sm' p='xl' radius='md' withBorder mb='6'>
          <Breadcrumbs separator={<IconChevronRight size={16} />} className='mb-4'>
            {breadcrumbItems}
          </Breadcrumbs>
          <Flex justify='space-between' align='center' mb='4'>
            <div>
              <Title order={1} className='text-3xl font-bold text-gray-900 mb-2 flex items-center gap-3' data-testid='sgc-tarea-titulo'>
                <IconFileDescription size={32} className='text-blue-6' />
                {mode === 'tarea' ? `Tarea #${focus?.id ?? id} - Solicitud #${request.id}` : `Solicitud #${request.id}`}
              </Title>
              <Text size='lg'>{mode === 'tarea' ? focus?.name : request.subject}</Text>
            </div>
            <Group>
              <Badge color={sgcStatusColor(statusLabel)} size='lg' radius='sm' variant='light' data-testid='sgc-tarea-estado'>
                {statusLabel}
              </Badge>
            </Group>
          </Flex>
          {resolved && (
            <Alert icon={<IconCheck size={16} />} title={mode === 'tarea' ? 'Tarea Resuelta' : 'Solicitud Resuelta'} color='teal' mb='4'>
              {mode === 'tarea' ? 'Esta tarea ha sido resuelta y no se puede modificar.' : 'Esta solicitud ha sido resuelta y no se puede modificar.'}
            </Alert>
          )}
          {message && (
            <Alert color={message.type === 'success' ? 'green' : 'red'} mt='sm' icon={message.type === 'success' ? <IconCheck size={16} /> : <IconAlertCircle size={16} />} data-testid='sgc-mensaje'>
              {message.text}
            </Alert>
          )}
        </Card>

        {mode === 'tarea' && focus && data.reading && (
          <SgcReadingPanel
            idTask={focus.id}
            requestId={request.id}
            reading={data.reading}
            canSign={myAction?.kind === 'leer'}
            onDone={(text) => {
              setMessage({ type: 'success', text });
              reload();
            }}
          />
        )}

        <div className='flex flex-col lg:flex-row gap-6'>
          <div className={`flex-1 order-2 lg:order-1 min-w-0 space-y-5${mode === 'tarea' ? ' lg:sticky lg:top-6 self-start' : ''}`}>
            {!data.readerOnly && (
            <SgcInteractionHistory
              variant={mode}
              items={data.interactions}
              currentEmail={me}
              users={userOptions}
              canNote={permissions.canNote}
              onSend={async (body, emails) => {
                const ok = await run(() => sgcSend(`/api/sgc/requests/${request.id}/notes`, 'POST', { body, notifyEmails: emails }), 'Nota agregada.');
                if (ok && emails.length) {
                  await sendMessage(
                    `Nueva Nota en la Solicitud documental #${request.id} - ${request.subject}`,
                    emails.join('; '),
                    [{ 'ID de la Solicitud': request.id, Asunto: request.subject, Proceso: request.flow.name, Empresa: request.company, Nota: body }],
                    `Este es un mensaje automático del Sistema de Gestión de Calidad (SGC documental). Se ha agregado una nueva nota a la solicitud #${request.id}.`,
                    'https://farmalogica.com.co/imagenes/logos/logo20.png',
                    []
                  ).catch(() => undefined);
                }
              }}
            />
            )}
          </div>

          <div className='w-full lg:w-150 order-1 lg:order-2'>
            <Card shadow='sm' p='xl' radius='md' withBorder>
              <Title order={4} mb='md' className='flex items-center gap-2'>
                <IconFileDescription size={18} />
                {mode === 'tarea' ? 'Detalles de la Tarea' : 'Detalles de la Solicitud'}
              </Title>
              <DetailRow label='Fecha y Hora de Creación'>{formatDateCO(request.createdAt)}</DetailRow>
              {mode === 'tarea' && focus?.startedAt && <DetailRow label='Fecha de Inicio de Ejecución'>{formatDateCO(focus.startedAt)}</DetailRow>}
              <DetailRow label='Solicitante'>{request.requester}</DetailRow>
              <DetailRow label='Asignado a'>{(mode === 'tarea' ? focus?.assignedLabel : task?.assignedLabel) || request.elaborator}</DetailRow>
              <Stack gap='md'>
                <div>
                  <Text size='sm' color='gray.6' fw={500}>
                    Compañia
                  </Text>
                  <Card withBorder radius='md' p='md' mt='xs'>
                    <Group>
                      <IconBuilding size={16} />
                      <Text size='sm'>{request.company}</Text>
                    </Group>
                  </Card>
                </div>
                <div>
                  <Text size='sm' color='gray.6' fw={500}>
                    Asunto
                  </Text>
                  <Card withBorder radius='md' p='md' mt='xs'>
                    <Group>
                      <IconFileDescription size={16} />
                      <Text size='sm'>{request.subject}</Text>
                    </Group>
                  </Card>
                </div>
                <div>
                  <Text size='sm' color='gray.6' fw={500}>
                    Descripción
                  </Text>
                  <Card withBorder radius='md' p='md' mt='xs'>
                    <Text size='sm' className='whitespace-pre-line text-gray-700'>
                      {request.description}
                    </Text>
                  </Card>
                </div>
                <Divider />
                {((mode === 'tarea' && focus?.resolution && focus.status !== 'abierta') || (mode === 'solicitud' && (request.closedAt || request.cancelReason))) && (
                  <div>
                    <Text fw={600} mb='xs'>
                      {mode === 'tarea' ? 'Resolución de la Tarea' : 'Resolución de la Solicitud'}
                    </Text>
                    <Card withBorder radius='md' p='md' bg='teal.0' className='border-teal-300'>
                      <Stack gap='sm'>
                        <Group>
                          <IconCheck size={20} className='text-teal-6' />
                          <Text size='sm' fw={500} className='text-teal-7'>
                            Resolución Aplicada
                          </Text>
                        </Group>
                        <Text size='sm' className='whitespace-pre-line text-gray-700'>
                          {mode === 'tarea' ? focus?.resolution : request.cancelReason ?? request.statusLabel}
                        </Text>
                        <Group>
                          <IconCalendar size={16} className='text-gray-5' />
                          <Text size='xs' color='gray.6'>
                            Fecha de Resolución: {formatDateCO(mode === 'tarea' ? focus?.endedAt : request.closedAt)}
                          </Text>
                          <Text size='xs' color='gray.6'>
                            Resuelto Por: {mode === 'tarea' ? focus?.resolvedBy : request.closedBy}
                          </Text>
                        </Group>
                      </Stack>
                    </Card>
                  </div>
                )}
                <div>
                  <Text fw={600} mb='xs'>
                    {mode === 'tarea' ? 'Información de la Tarea' : 'Información de la Solicitud'}
                  </Text>
                  <Grid>
                    <Grid.Col span={{ base: 12, md: 6 }}>
                      <Card withBorder radius='md' p='md'>
                        <Group>
                          <IconTag size={16} />
                          <div>
                            <Text size='xs' color='gray.6'>
                              Categoría
                            </Text>
                            <Text size='sm'>{request.requestTypeLabel}</Text>
                          </div>
                        </Group>
                      </Card>
                    </Grid.Col>
                    <Grid.Col span={{ base: 12, md: 6 }}>
                      <Card withBorder radius='md' p='md'>
                        <Group>
                          <IconProgress size={16} />
                          <div>
                            <Text size='xs' color='gray.6'>
                              Proceso
                            </Text>
                            <Text size='sm'>
                              {request.flow.name} · v{request.flow.version}
                            </Text>
                          </div>
                        </Group>
                      </Card>
                    </Grid.Col>
                    <Grid.Col span={12}>
                      <Card withBorder radius='md' p='md'>
                        <Group>
                          <IconFileDescription size={16} />
                          <div>
                            <Text size='xs' color='gray.6'>
                              Documento
                            </Text>
                            <Text size='sm'>
                              {request.document
                                ? `${request.document.code} · ${request.document.title}`
                                : `Nuevo · ${request.process?.code ?? ''} ${request.process?.name ?? ''} · ${request.documentType?.name ?? ''}`}
                            </Text>
                          </div>
                        </Group>
                      </Card>
                    </Grid.Col>
                  </Grid>
                </div>

                {mode === 'tarea' && focus && (
                  <>
                    <div>
                      <Title order={4} mb='md' className='flex items-center gap-2'>
                        <IconProgress size={18} className='text-blue-6' />
                        Cambiar Estado de la Tarea
                      </Title>
                      {isEditing ? (
                        <Stack>
                          <Select
                            label='Estado de la Tarea'
                            placeholder='Selecciona estado'
                            data={decisionOptions}
                            value={decision}
                            onChange={setDecision}
                            data-testid='sgc-decision'
                          />
                        </Stack>
                      ) : (
                        <Card withBorder radius='md' p='md'>
                          <Group>
                            <IconProgress size={16} />
                            <div>
                              <Text size='xs' color='gray.6'>
                                Estado Actual
                              </Text>
                              <Badge color={sgcStatusColor(focus.statusLabel)} size='lg' radius='sm' variant='light'>
                                {focus.statusLabel}
                              </Badge>
                            </div>
                          </Group>
                        </Card>
                      )}
                    </div>
                    <Divider />
                    <div>
                      <Group justify='space-between' mb='md'>
                        <Title order={4} className='flex items-center gap-2'>
                          <IconCheck size={18} className='text-green-6' />
                          Resolución de la Tarea
                        </Title>
                        {isEditing && (
                          <ActionIcon variant='subtle' onClick={() => setIsEditing(false)}>
                            <IconX size={16} />
                          </ActionIcon>
                        )}
                      </Group>
                      {isEditing && (
                        <Stack>
                          <Textarea
                            label={decision === 'devolver' ? 'Observaciones de la devolución' : 'Descripción de la resolución'}
                            placeholder={decision === 'devolver' ? 'Qué debe corregir el elaborador…' : 'Describe la resolución aplicada...'}
                            value={resolution}
                            onChange={(e) => setResolution(e.currentTarget.value)}
                            minRows={3}
                            data-testid='sgc-resolucion'
                          />
                          {signatureLabel && (
                            <Alert color='blue' variant='light' icon={<IconSignature size={16} />} title={`Punto de firma: ${signatureLabel}`} data-testid='sgc-firma-pendiente'>
                              <Text size='sm'>{data.signatureNotice}</Text>
                            </Alert>
                          )}
                        </Stack>
                      )}
                      <br />
                      {focus.myWaiting && (
                        <Alert color='gray' icon={<IconLock size={16} />} mb='md' data-testid='sgc-espera-turno'>
                          Esta tarea se firma en orden: aún no es su turno. Se le notificará cuando le toque.
                        </Alert>
                      )}
                      {focus.status === 'abierta' && !myAction && !focus.myWaiting && permissions.isElaborator && focus.key !== 'elaboracion' && (
                        <Alert color='gray' icon={<IconLock size={16} />} mb='md'>
                          El elaborador no revisa ni aprueba su propio documento.
                        </Alert>
                      )}
                      {focus.status === 'en_espera' && (
                        <Alert color='yellow' icon={<IconLock size={16} />} mb='md'>
                          Este paso quedó en espera: la solicitud usa una versión del flujo anterior a la que habilitó la divulgación y la capacitación. Calidad puede cancelarla y pedirla de nuevo con el flujo vigente.
                        </Alert>
                      )}
                      {myAction?.kind === 'leer' && (
                        <Alert color='blue' icon={<IconLock size={16} />} mb='md'>
                          Esta es una lectura obligatoria: lea el documento arriba hasta el final y use «Leído».
                        </Alert>
                      )}
                      <Group justify='space-between'>
                        <Group>
                          {!isEditing ? (
                            <Button color='blue' onClick={() => setIsEditing(true)} leftSection={<IconTicket size={16} />} disabled={!myAction || myAction.kind === 'leer'} data-testid='sgc-editar-tarea'>
                              Editar Tarea
                            </Button>
                          ) : (
                            <>
                              <Button color='green' onClick={saveDecision} leftSection={<IconCheck size={16} />} loading={saving} data-testid='sgc-guardar-tarea'>
                                Guardar Cambios
                              </Button>
                              <Button variant='outline' color='gray' onClick={() => setIsEditing(false)} leftSection={<IconX size={16} />}>
                                Cancelar
                              </Button>
                            </>
                          )}
                          <Button color='blue' onClick={() => setTasksOpen(true)} leftSection={<IconTicket size={16} />} data-testid='sgc-ver-tareas'>
                            Ver Tareas
                          </Button>
                        </Group>
                      </Group>
                    </div>
                  </>
                )}
              </Stack>
            </Card>
          </div>
        </div>

        {data.dissemination && (
          <SgcDisseminationCard idCompany={request.idCompany} view={data.dissemination} users={userOptions} onAction={onDisseminationAction} />
        )}

        {data.training && (
          <SgcTrainingCard
            view={data.training}
            onSave={(body) => run(() => sgcSend(`/api/sgc/requests/${request.id}/training`, 'POST', body), 'Capacitación registrada.')}
            onUpload={(file) =>
              run(async () => {
                const form = new FormData();
                form.append('file', file);
                const res = await fetch(`/api/sgc/requests/${request.id}/training/results`, { method: 'POST', body: form });
                const body = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error((body as { error?: string }).error || `Error ${res.status}`);
              }, 'Resultados de la capacitación cargados.')
            }
          />
        )}

        {!data.readerOnly && (
        <>
        <SgcSignersPanel
          steps={data.steps}
          canEdit={permissions.canChangeSigners}
          users={userOptions.filter((u) => u.value !== request.elaboratorEmail.toLowerCase())}
          suggestion={sugg.data?.suggestion ?? null}
          onSave={async (stepKey, signers, signingMode, reason) => {
            await run(() => sgcSend(`/api/sgc/requests/${request.id}/signers`, 'POST', { stepKey, signers, mode: signingMode, reason }), 'Firmantes actualizados.');
          }}
        />

        <SgcAdditionalInfo
          fields={data.formFields}
          canEdit={permissions.canEditForm}
          onSave={async (key, value) => {
            await run(() => sgcSend(`/api/sgc/requests/${request.id}/form-values`, 'PUT', { values: { [key]: value } }), 'Campo actualizado.');
          }}
        />

        <SgcSignaturesCard
          data={data}
          onRetryPdf={async () => {
            await run(() => sgcSend(`/api/sgc/requests/${request.id}/controlled-pdf`, 'POST', {}), 'PDF controlado generado.');
          }}
        />

        <SgcAttachmentsCard
          requestId={request.id}
          attachments={data.attachments}
          canUploadDraft={permissions.canUploadDraft}
          canUploadSupport={permissions.canUploadSupport}
          canWithdraw={(a) => request.status === 'abierta' && (a.uploadedByEmail.toLowerCase() === me || permissions.isElaborator || permissions.isQuality)}
          onUpload={async (file, purpose) => {
            await run(async () => {
              const form = new FormData();
              form.append('file', file);
              form.append('purpose', purpose);
              const res = await fetch(`/api/sgc/requests/${request.id}/attachments`, { method: 'POST', body: form });
              const body = await res.json().catch(() => ({}));
              if (!res.ok) throw new Error((body as { error?: string }).error || `Error ${res.status}`);
            }, 'Archivo cargado.');
          }}
          onWithdraw={async (idAttachment, reason) => {
            await run(() => sgcSend(`/api/sgc/requests/${request.id}/attachments/${idAttachment}/withdraw`, 'POST', { reason }), 'Adjunto retirado.');
          }}
        />
        </>
        )}

        <Card shadow='sm' p='lg' radius='md' withBorder mt='6'>
          <Group justify='space-between'>
            <Group>
              {mode === 'solicitud' && (
                <Button color='blue' onClick={() => setTasksOpen(true)} leftSection={<IconTicket size={16} />} data-testid='sgc-ver-tareas'>
                  Ver Tareas
                </Button>
              )}
              {permissions.canCancel && (
                <Button color='red' variant='outline' onClick={() => setCancelOpen(true)} leftSection={<IconX size={16} />} data-testid='sgc-cancelar-solicitud'>
                  Cancelar solicitud
                </Button>
              )}
              {mode === 'tarea' && (
                <Button variant='subtle' onClick={() => router.push(`/process/sgc-documental/solicitudes/${request.id}?empresa=${request.idCompany}`)}>
                  Ver solicitud #{request.id}
                </Button>
              )}
              {resolved && (
                <Text size='sm' color='dimmed'>
                  {mode === 'tarea' ? 'Las tareas resueltas no se pueden modificar.' : 'Las solicitudes completadas no se pueden modificar.'}
                </Text>
              )}
            </Group>
            <Button
              variant='outline'
              onClick={() => router.push(mode === 'tarea' ? `/process/sgc-documental/tareas?empresa=${request.idCompany}` : `/process/sgc-documental/solicitudes?empresa=${request.idCompany}`)}
              leftSection={<IconArrowLeft size={16} />}
            >
              Volver al Panel
            </Button>
          </Group>
        </Card>

        <SgcTasksModal
          opened={tasksOpen}
          onClose={() => setTasksOpen(false)}
          requestId={request.id}
          tasks={data.tasks}
          users={userOptions}
          onViewTask={(idTask) => {
            setTasksOpen(false);
            router.push(`/process/sgc-documental/tareas/${idTask}?empresa=${request.idCompany}`);
          }}
          onReassign={async (idTask, toEmail, reason) => {
            await run(() => sgcSend(`/api/sgc/tasks/${idTask}/reassign`, 'POST', { toEmail, reason }), 'Tarea reasignada.');
          }}
        />

        {focus && myAction?.signatureMeaning && (
          <SgcSignModal
            opened={signOpen}
            onClose={() => setSignOpen(false)}
            title={`Firmar · ${focus.name} · Solicitud #${request.id}`}
            meaning={myAction.signatureMeaning as SgcSignatureMeaning}
            draft={signContent}
            draftHref={myAction.signatureMeaning === 'capacito' ? null : draftHref}
            checklist={myAction.checklist}
            submitLabel={myAction.kind === 'enviar' ? 'Firmar y enviar a revisión' : myAction.signatureMeaning === 'capacito' ? 'Firmar «Capacitó» y cerrar' : undefined}
            onSign={async (payload) => {
              const res = await sgcSend<{ controlledPdf?: { status: string | null; error?: string }; published?: { code: string; versionNumber: number; obsolete: { versionNumber: number } | null } | null }>(`/api/sgc/tasks/${focus.id}/sign`, 'POST', { ...payload, comment: payload.comment || resolution, idAssignee: myAction.idAssignee });
              setSignOpen(false);
              setIsEditing(false);
              setDecision(null);
              setResolution('');
              const pdf = res.controlledPdf?.status === 'generado' ? ' Se generó el PDF controlado.' : res.controlledPdf?.status === 'error' ? ` El PDF controlado quedó pendiente: ${res.controlledPdf.error ?? ''}` : '';
              const vig = res.published ? ` ${res.published.code} V${res.published.versionNumber} quedó VIGENTE${res.published.obsolete ? ` y la V${res.published.obsolete.versionNumber} OBSOLETA` : ''}.` : '';
              setMessage({ type: 'success', text: `Firma registrada. Tarea actualizada correctamente.${pdf}${vig}` });
              reload();
            }}
          />
        )}

        <Modal opened={cancelOpen} onClose={() => setCancelOpen(false)} title={`Cancelar la solicitud #${request.id}`} centered>
          <Stack>
            <Text size='sm' c='dimmed'>
              Cancelar es una acción (no un paso): cierra la solicitud y anula las tareas pendientes. Queda en el historial.
            </Text>
            <Textarea label='Motivo de la cancelación' required minRows={3} autosize value={cancelReason} onChange={(e) => setCancelReason(e.currentTarget.value)} data-testid='sgc-cancelar-motivo' />
            <Group justify='flex-end'>
              <Button variant='default' onClick={() => setCancelOpen(false)}>
                Volver
              </Button>
              <Button
                color='red'
                disabled={cancelReason.trim().length < 5}
                onClick={async () => {
                  const ok = await run(() => sgcSend(`/api/sgc/requests/${request.id}/cancel`, 'POST', { reason: cancelReason.trim() }), 'Solicitud cancelada.');
                  if (ok) setCancelOpen(false);
                }}
                data-testid='sgc-cancelar-confirmar'
              >
                Cancelar solicitud
              </Button>
            </Group>
          </Stack>
        </Modal>
      </div>
    </div>
  );
}
