'use client';

import { Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Breadcrumbs,
  Button,
  Card,
  Flex,
  Grid,
  Group,
  Loader,
  Modal,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  Textarea,
  ThemeIcon,
  Title,
  Tooltip,
} from '@mantine/core';
import SgcSelect from '../../../../../components/sgc/SgcSelect';
import {
  IconAlertCircle,
  IconCalendarEvent,
  IconCheck,
  IconChevronRight,
  IconClock,
  IconEye,
  IconFileText,
  IconShieldCheck,
  IconThumbDown,
  IconThumbUp,
  IconUsersGroup,
  IconX,
} from '@tabler/icons-react';
import { formatDateCO } from '../../../../../components/sgc/tareas/format';
import { useSgcCompany } from '../../../../../components/sgc/useSgcCompany';
import { sgcSend, useSgcFetch } from '../../../../../components/sgc/useSgcFetch';
import { useSgcRowLink } from '../../../../../components/sgc/useSgcRowLink';
import { sgcAuthorizationColor } from '../../../../../lib/sgc/authorizations';
import type { SgcAuthorizationRow, SgcAuthorizationTypeRow } from '../../../../../lib/sgc/db/authorizations';
import type { SgcCompanyAccess } from '../../../../../lib/sgc/permissions';
import type { SgcRequestDetail } from '../../../../../lib/sgc/db/requests';
import type { SgcSignatureMeaning } from '../../../../../lib/sgc/flows/definition';
import SgcSignModal from '../../../../../components/sgc/signature/SgcSignModal';

/**
 * «Autorizaciones SGC» — MÓDULO INDEPENDIENTE del SGC. COPIA CONGELADA
 * (2026-09-30) de la bandeja de Autorizaciones de SynerLink
 * (app/(hub)/process/authorization): mismos indicadores, columnas y modales
 * de autorizar/rechazar, sobre tablas propias (sgc.authorization*). Autorizar
 * aprueba el cupo en su tarea; rechazar la devuelve a elaboración.
 */

function TypesAdmin({ company }: { company: SgcCompanyAccess }) {
  const id = company.idCompany;
  const types = useSgcFetch<{ types: SgcAuthorizationTypeRow[] }>(`/api/sgc/authorization-types?company=${id}`);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [grant, setGrant] = useState<{ idType: number; email: string; reason: string } | null>(null);
  const [revoke, setRevoke] = useState<{ id: number; reason: string } | null>(null);
  const [newType, setNewType] = useState({ code: '', name: '', description: '', reason: '' });
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: ok });
      types.reload();
      return true;
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
      return false;
    }
  };
  return (
    <Stack>
      {msg && (
        <Alert color={msg.ok ? 'green' : 'red'} icon={msg.ok ? <IconCheck size={16} /> : <IconAlertCircle size={16} />}>
          {msg.text}
        </Alert>
      )}
      <Text size='sm' c='dimmed'>
        Tipos de Autorización SGC y el GRUPO de cada tipo (quién puede tomar una autorización de grupo). Tablas propias del SGC; no se usa el tipo «Autorización de documento» de SynerLink general. Cada
        cambio pide motivo y queda en el registro de cambios.
      </Text>
      {(types.data?.types ?? []).map((t) => (
        <Card key={t.id} withBorder radius='md' p='md' data-testid='sgc-tipo-autorizacion'>
          <Group justify='space-between' mb='xs'>
            <div>
              <Text fw={700}>
                {t.code} · {t.name}{' '}
                {!t.isActive && (
                  <Badge size='xs' color='gray'>
                    Inactivo
                  </Badge>
                )}
              </Text>
              {t.description && (
                <Text size='xs' c='dimmed'>
                  {t.description}
                </Text>
              )}
            </div>
            <Button size='xs' variant='light' onClick={() => setGrant({ idType: t.id, email: '', reason: '' })}>
              Agregar persona al grupo
            </Button>
          </Group>
          {t.members.length ? (
            <Table.ScrollContainer minWidth={520}>
              <Table>
                <Table.Tbody>
                  {t.members.map((m) => (
                    <Table.Tr key={m.id}>
                      <Table.Td>{m.name ? `${m.name} (${m.email})` : m.email}</Table.Td>
                      <Table.Td>
                        <Text size='xs' c='dimmed'>
                          Otorgado por {m.grantedBy} · {m.reason}
                        </Text>
                      </Table.Td>
                      <Table.Td w={100}>
                        <Button size='xs' variant='subtle' color='red' onClick={() => setRevoke({ id: m.id, reason: '' })}>
                          Retirar
                        </Button>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          ) : (
            <Text size='sm' c='dimmed'>
              Sin personas en el grupo (solo se asigna directamente).
            </Text>
          )}
        </Card>
      ))}
      <Card withBorder radius='md' p='md'>
        <Title order={5} mb='sm'>
          Nuevo tipo de autorización
        </Title>
        <Grid>
          <Grid.Col span={{ base: 12, md: 3 }}>
            <TextInput autoComplete='off' data-1p-ignore='true' data-lpignore='true' label='Código' value={newType.code} onChange={(e) => setNewType({ ...newType, code: e.currentTarget.value.toUpperCase() })} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 4 }}>
            <TextInput autoComplete='off' data-1p-ignore='true' data-lpignore='true' label='Nombre' value={newType.name} onChange={(e) => setNewType({ ...newType, name: e.currentTarget.value })} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 5 }}>
            <TextInput autoComplete='off' data-1p-ignore='true' data-lpignore='true' label='Descripción' value={newType.description} onChange={(e) => setNewType({ ...newType, description: e.currentTarget.value })} />
          </Grid.Col>
          <Grid.Col span={12}>
            <Textarea autoComplete='off' data-1p-ignore='true' data-lpignore='true' label='Motivo' autosize minRows={1} value={newType.reason} onChange={(e) => setNewType({ ...newType, reason: e.currentTarget.value })} />
          </Grid.Col>
        </Grid>
        <Group justify='flex-end' mt='sm'>
          <Button
            disabled={!newType.code || !newType.name || newType.reason.trim().length < 5}
            onClick={async () => {
              if (await act(() => sgcSend('/api/sgc/authorization-types', 'POST', { company: id, ...newType }), 'Tipo creado.')) setNewType({ code: '', name: '', description: '', reason: '' });
            }}
          >
            Crear tipo
          </Button>
        </Group>
      </Card>
      <Modal opened={Boolean(grant)} onClose={() => setGrant(null)} title='Agregar persona al grupo' centered>
        {grant && (
          <Stack>
            <TextInput autoComplete='off' data-1p-ignore='true' data-lpignore='true' label='Correo' value={grant.email} onChange={(e) => setGrant({ ...grant, email: e.currentTarget.value })} />
            <Textarea autoComplete='off' data-1p-ignore='true' data-lpignore='true' label='Motivo' required autosize minRows={2} value={grant.reason} onChange={(e) => setGrant({ ...grant, reason: e.currentTarget.value })} />
            <Group justify='flex-end'>
              <Button
                disabled={!grant.email || grant.reason.trim().length < 5}
                onClick={async () => {
                  if (await act(() => sgcSend(`/api/sgc/authorization-types/${grant.idType}/users`, 'POST', { company: id, email: grant.email, reason: grant.reason }), 'Persona agregada al grupo.')) setGrant(null);
                }}
              >
                Agregar
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
      <Modal opened={Boolean(revoke)} onClose={() => setRevoke(null)} title='Retirar del grupo' centered>
        {revoke && (
          <Stack>
            <Textarea autoComplete='off' data-1p-ignore='true' data-lpignore='true' label='Motivo' required autosize minRows={2} value={revoke.reason} onChange={(e) => setRevoke({ ...revoke, reason: e.currentTarget.value })} />
            <Group justify='flex-end'>
              <Button
                color='red'
                disabled={revoke.reason.trim().length < 5}
                onClick={async () => {
                  if (await act(() => sgcSend(`/api/sgc/authorization-types/users/${revoke.id}/revoke`, 'POST', { company: id, reason: revoke.reason }), 'Persona retirada del grupo.')) setRevoke(null);
                }}
              >
                Retirar
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}

function AuthorizationBoard() {
  const router = useRouter();
  const rowLink = useSgcRowLink();
  const { company } = useSgcCompany();
  const [status, setStatus] = useState<string>('pendiente');
  const { data, error, loading, reload } = useSgcFetch<{ authorizations: SgcAuthorizationRow[] }>(`/api/sgc/authorizations?status=todas`);
  const [authorize, setAuthorize] = useState<SgcAuthorizationRow | null>(null);
  const [reject, setReject] = useState<SgcAuthorizationRow | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Sprint 3: autorizar un paso con firma = FIRMA ELECTRÓNICA propia del SGC (reautenticación + motivo).
  const [signFor, setSignFor] = useState<{ row: SgcAuthorizationRow; detail: SgcRequestDetail } | null>(null);
  const all = useMemo(() => data?.authorizations ?? [], [data]);
  const rows = all.filter((r) => !status || status === 'todas' || r.status === status);
  const stats = { total: all.length, pendientes: all.filter((r) => r.status === 'pendiente').length, autorizadas: all.filter((r) => r.status === 'autorizada').length, rechazadas: all.filter((r) => r.status === 'rechazada').length };
  const canConfig = Boolean(company && (company.canAdminFlows || company.canQuality));

  const decide = async (row: SgcAuthorizationRow, decision: 'autorizar' | 'rechazar') => {
    setBusy(true);
    setMsg(null);
    try {
      await sgcSend(`/api/sgc/authorizations/${row.id}/decision`, 'POST', { decision, comment });
      setMsg({ ok: true, text: decision === 'autorizar' ? 'Autorización registrada.' : 'Rechazada: el documento volvió a elaboración.' });
      setAuthorize(null);
      setReject(null);
      setComment('');
      reload();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const startAuthorize = async (row: SgcAuthorizationRow) => {
    setMsg(null);
    try {
      const res = await fetch(`/api/sgc/tasks/${row.idTask}`, { cache: 'no-store' });
      const detail = (await res.json()) as SgcRequestDetail & { error?: string };
      if (!res.ok) throw new Error(detail.error || `Error ${res.status}`);
      const focus = detail.tasks.find((t) => t.id === row.idTask);
      // Sprint 4: la capacitación se cierra desde su tarea (registro, Excel de resultados y firma «Capacitó»).
      if (focus?.myAction?.signatureMeaning === 'capacito') {
        window.location.href = `/process/sgc-documental/tareas/${row.idTask}?empresa=${detail.request.idCompany}`;
        return;
      }
      if (focus?.myAction?.signatureMeaning) setSignFor({ row, detail });
      else setAuthorize(row);
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  };

  const breadcrumbItems = [
    { title: 'Procesos', href: '/process' },
    { title: 'Autorizaciones', href: '#' },
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

  if (loading && !data) {
    return (
      <div className='min-h-screen flex items-center justify-center'>
        <Loader size='lg' />
      </div>
    );
  }

  const board = (
    <>
      <Card shadow='sm' p='lg' radius='md' withBorder mb='6'>
        <Group justify='space-between' mb='md'>
          <Title order={3} className='flex items-center gap-2'>
            <IconFileText size={20} />
            Autorizaciones
          </Title>
          <SgcSelect
            data={[
              { value: 'pendiente', label: 'Pendientes' },
              { value: 'autorizada', label: 'Autorizadas' },
              { value: 'rechazada', label: 'Rechazadas' },
              { value: 'anulada', label: 'Anuladas' },
              { value: 'todas', label: 'Todas' },
            ]}
            value={status}
            onChange={(v) => setStatus(v ?? 'pendiente')}
            allowDeselect={false}
            w={180}
            data-testid='sgc-autorizaciones-filtro'
          />
        </Group>
        <div className='overflow-x-auto'>
          <Table striped highlightOnHover data-testid='sgc-autorizaciones-tabla'>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>ID</Table.Th>
                <Table.Th>Asunto</Table.Th>
                <Table.Th>Empresa</Table.Th>
                <Table.Th>Tipo de autorización</Table.Th>
                <Table.Th>Solicitante</Table.Th>
                <Table.Th>Fecha</Table.Th>
                <Table.Th>Estado</Table.Th>
                <Table.Th>Acciones</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.length === 0 ? (
                <Table.Tr>
                  <Table.Td colSpan={8}>
                    <Text c='dimmed' ta='center' py='lg'>
                      No hay autorizaciones en este estado.
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ) : (
                rows.map((req) => {
                  const isPending = req.status === 'pendiente';
                  return (
                    <Table.Tr key={req.id} data-testid='sgc-autorizacion-fila' data-request={req.idRequest} data-status={req.status} {...rowLink(`/process/sgc-documental/tareas/${req.idTask}?empresa=${req.idCompany}`)}>
                      <Table.Td>
                        <Text size='sm' fw={700}>
                          {req.idRequest}
                        </Text>
                      </Table.Td>
                      <Table.Td style={{ minWidth: 200 }}>
                        <Text size='sm' lineClamp={2}>
                          {req.subject}
                        </Text>
                        <Text size='xs' c='dimmed'>
                          {req.taskName}
                          {req.isPool ? ' · grupo' : ''}
                        </Text>
                      </Table.Td>
                      <Table.Td>{req.company}</Table.Td>
                      <Table.Td>{req.typeName}</Table.Td>
                      <Table.Td>{req.requesterName ?? req.requesterEmail}</Table.Td>
                      <Table.Td>
                        <Group gap={4} wrap='nowrap' align='flex-start'>
                          <IconCalendarEvent size={14} className='text-gray-400' style={{ marginTop: 3 }} />
                          <Text size='xs' c='dimmed' style={{ whiteSpace: 'nowrap' }}>
                            {formatDateCO(req.requestedAt, { month: 'short' })}
                          </Text>
                        </Group>
                      </Table.Td>
                      <Table.Td style={{ whiteSpace: 'nowrap' }}>
                        <Badge variant='light' color={sgcAuthorizationColor(req.status)} size='sm'>
                          {req.statusLabel}
                        </Badge>
                        {isPending && !req.inTurn && (
                          <Text size='10px' c='dimmed'>
                            Espera turno
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td>
                        <Group gap='xs' wrap='nowrap'>
                          <Tooltip label='Ver tarea'>
                            <ActionIcon variant='light' color='blue' onClick={() => router.push(`/process/sgc-documental/tareas/${req.idTask}?empresa=${req.idCompany}`)} aria-label='Ver tarea'>
                              <IconEye size={16} />
                            </ActionIcon>
                          </Tooltip>
                          {isPending && req.inTurn && (
                            <>
                              <Tooltip label='Autorizar'>
                                <ActionIcon variant='light' color='green' onClick={() => void startAuthorize(req)} aria-label='Autorizar' data-testid='sgc-autorizar'>
                                  <IconThumbUp size={16} />
                                </ActionIcon>
                              </Tooltip>
                              <Tooltip label='Rechazar'>
                                <ActionIcon variant='light' color='red' onClick={() => setReject(req)} aria-label='Rechazar' data-testid='sgc-rechazar'>
                                  <IconThumbDown size={16} />
                                </ActionIcon>
                              </Tooltip>
                            </>
                          )}
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  );
                })
              )}
            </Table.Tbody>
          </Table>
        </div>
      </Card>
    </>
  );

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--mantine-color-body)' }}>
      <div className='max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8'>
        <Card shadow='sm' p='xl' radius='md' withBorder mb='6'>
          <Breadcrumbs separator={<IconChevronRight size={16} />} className='mb-4'>
            {breadcrumbItems}
          </Breadcrumbs>
          <Flex justify='space-between' align='center' mb='4'>
            <div>
              <Title order={1} className='text-3xl font-bold mb-2 flex items-center gap-3' data-testid='sgc-autorizaciones-titulo'>
                <IconShieldCheck size={32} className='text-blue-600' />
                Autorizaciones
              </Title>
              <Text size='lg' c='dimmed'>
                Autoriza o rechaza las aprobaciones y verificaciones del Sistema de Gestión de Calidad
              </Text>
            </div>
          </Flex>
          <Grid>
            {[
              { label: 'Total', value: stats.total, icon: IconFileText, color: 'blue' },
              { label: 'Pendientes', value: stats.pendientes, icon: IconClock, color: 'yellow' },
              { label: 'Autorizadas', value: stats.autorizadas, icon: IconCheck, color: 'green' },
              { label: 'Rechazadas', value: stats.rechazadas, icon: IconX, color: 'red' },
            ].map((k) => (
              <Grid.Col key={k.label} span={{ base: 12, sm: 6, md: 3 }}>
                <Card p='md' radius='md' withBorder style={{ backgroundColor: `var(--mantine-color-${k.color}-light)` }}>
                  <Group>
                    <k.icon size={24} color={`var(--mantine-color-${k.color}-light-color)`} />
                    <div>
                      <Text size='xs' c={`var(--mantine-color-${k.color}-light-color)`}>
                        {k.label}
                      </Text>
                      <Text size='lg' fw={600}>
                        {k.value}
                      </Text>
                    </div>
                  </Group>
                </Card>
              </Grid.Col>
            ))}
          </Grid>
        </Card>

        {(error || msg) && (
          <Alert icon={<IconAlertCircle size={20} />} title={msg?.ok ? 'Listo' : 'Error'} color={msg?.ok ? 'green' : 'red'} mb='md' data-testid='sgc-autorizaciones-mensaje'>
            {msg?.text ?? error}
          </Alert>
        )}

        {canConfig && company ? (
          <Tabs defaultValue='bandeja' keepMounted={false}>
            <Tabs.List mb='md'>
              <Tabs.Tab value='bandeja' leftSection={<IconShieldCheck size={16} />}>
                Bandeja
              </Tabs.Tab>
              <Tabs.Tab value='tipos' leftSection={<IconUsersGroup size={16} />}>
                Tipos y grupos
              </Tabs.Tab>
            </Tabs.List>
            <Tabs.Panel value='bandeja'>{board}</Tabs.Panel>
            <Tabs.Panel value='tipos'>
              <TypesAdmin company={company} />
            </Tabs.Panel>
          </Tabs>
        ) : (
          board
        )}
      </div>

      <Modal opened={Boolean(authorize)} onClose={() => setAuthorize(null)} title='Confirmar autorización' centered>
        <Stack>
          <Group gap='sm'>
            <ThemeIcon variant='light' color='green' size='lg' radius='xl'>
              <IconThumbUp size={20} />
            </ThemeIcon>
            <Text>
              ¿Deseas autorizar <strong>la solicitud #{authorize?.idRequest}</strong> ({authorize?.typeName})?
            </Text>
          </Group>
          <Textarea autoComplete='off' data-1p-ignore='true' data-lpignore='true' label='Comentario (opcional)' autosize minRows={2} value={comment} onChange={(e) => setComment(e.currentTarget.value)} />
          <Group justify='flex-end'>
            <Button variant='default' onClick={() => setAuthorize(null)} disabled={busy}>
              Cancelar
            </Button>
            <Button color='green' leftSection={<IconCheck size={16} />} onClick={() => authorize && decide(authorize, 'autorizar')} loading={busy} data-testid='sgc-autorizar-confirmar'>
              Autorizar
            </Button>
          </Group>
        </Stack>
      </Modal>

      {signFor && (() => {
        const focus = signFor.detail.tasks.find((t) => t.id === signFor.row.idTask)!;
        const d = signFor.detail;
        const draftHref = d.currentDraft
          ? d.currentDraft.kind === 'borrador_editor'
            ? `/process/sgc-documental/solicitudes/${d.request.id}/borrador?empresa=${d.request.idCompany}`
            : `/api/sgc/requests/${d.request.id}/attachments/${d.currentDraft.ref.split(':')[1]}`
          : null;
        return (
          <SgcSignModal
            opened
            onClose={() => setSignFor(null)}
            title={`Autorizar firmando · Solicitud #${signFor.row.idRequest} (${signFor.row.typeName})`}
            meaning={focus.myAction!.signatureMeaning as SgcSignatureMeaning}
            draft={d.currentDraft}
            draftHref={draftHref}
            checklist={focus.myAction!.checklist}
            submitLabel='Firmar y autorizar'
            onSign={async (payload) => {
              const res = await sgcSend<{ controlledPdf?: { status: string | null; error?: string } }>(`/api/sgc/authorizations/${signFor.row.id}/sign`, 'POST', payload);
              setSignFor(null);
              const pdf = res.controlledPdf?.status === 'generado' ? ' Se generó el PDF controlado.' : res.controlledPdf?.status === 'error' ? ` El PDF controlado quedó pendiente: ${res.controlledPdf.error ?? ''}` : '';
              setMsg({ ok: true, text: `Autorización registrada con firma electrónica.${pdf}` });
              reload();
            }}
          />
        );
      })()}

      <Modal opened={Boolean(reject)} onClose={() => setReject(null)} title={`Rechazar la solicitud #${reject?.idRequest ?? ''}`} centered>
        <Stack>
          <Text size='sm' c='dimmed'>
            Indica el motivo del rechazo. El documento vuelve a elaboración y el motivo queda en el historial.
          </Text>
          <Textarea autoComplete='off' data-1p-ignore='true' data-lpignore='true' label='Motivo del rechazo' placeholder='Escribe el motivo...' required minRows={3} autosize value={comment} onChange={(e) => setComment(e.currentTarget.value)} data-testid='sgc-rechazo-motivo' />
          <Group justify='flex-end'>
            <Button variant='default' onClick={() => setReject(null)}>
              Cancelar
            </Button>
            <Button color='red' leftSection={<IconX size={16} />} disabled={comment.trim().length < 5} onClick={() => reject && decide(reject, 'rechazar')} loading={busy}>
              Rechazar
            </Button>
          </Group>
        </Stack>
      </Modal>
    </div>
  );
}

export default function SgcAuthorizationPage() {
  return (
    <Suspense
      fallback={
        <div className='min-h-screen flex items-center justify-center'>
          <Loader size='lg' />
        </div>
      }
    >
      <AuthorizationBoard />
    </Suspense>
  );
}
