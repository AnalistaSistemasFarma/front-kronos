'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useMediaQuery } from '@mantine/hooks';
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Checkbox,
  FileButton,
  Grid,
  Group,
  Modal,
  ScrollArea,
  Skeleton,
  Stack,
  Tabs,
  Text,
  Textarea,
  Title,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconArchive,
  IconArrowLeft,
  IconFile,
  IconFileUpload,
  IconFolder,
  IconLock,
  IconLogout,
  IconMessagePlus,
  IconMessages,
  IconNotes,
  IconTrash,
  IconUserPlus,
  IconUsers,
} from '@tabler/icons-react';
import AgentAvatar from '../AgentAvatar';
import ChatThread from '../ChatThread';
import { EsqueletoHilo, EsqueletoListaAgentes } from '../ChatSkeletons';
import { formatBytes } from '../../../lib/chat/attachments';
import {
  chatFetch,
  chatGetJson,
  formatChatTime,
  type ChatAgentDto,
  type ChatProjectDetailDto,
} from '../../../lib/chat/client';

/**
 * UN PROYECTO abierto — /process/chat/proyecto/<id>. Piloto F1, 2026-10-17.
 *
 * A la izquierda, lo del proyecto en pestañas (Conversaciones, Instrucciones,
 * Archivos, Miembros); a la derecha, la conversación abierta con el MISMO
 * ChatThread del resto del chat (`chat-page-thread` + `chat-panel__header`),
 * para que se vea y se comporte igual. En el celular se muestra una cosa a la
 * vez: la lista, o la conversación con su botón de regreso.
 *
 * Lo que solo puede hacer el dueño (invitar, retirar, instrucciones, archivos,
 * archivar) se pinta solo para el dueño, pero la reja real está en el
 * servidor: estas pantallas no deciden ningún permiso.
 */

function EsqueletoPanel() {
  return (
    <Stack gap='sm' p='md' aria-hidden='true'>
      <Skeleton height={28} radius='md' />
      {Array.from({ length: 4 }, (_, i) => (
        <Skeleton key={i} height={44} radius='md' />
      ))}
    </Stack>
  );
}

type Candidato = { id: string; name: string; email: string };

export default function ProyectoWorkspace({ idProject }: { idProject: number }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: sesion } = useSession();
  const miId = sesion?.user?.id as string | undefined;
  const enCelular = useMediaQuery('(max-width: 62em)') ?? false;

  const [proyecto, setProyecto] = useState<ChatProjectDetailDto | null>(null);
  const [sinAcceso, setSinAcceso] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [pestana, setPestana] = useState<string | null>('conversaciones');
  const [idConversacion, setIdConversacion] = useState<number | null>(() => {
    const n = Number(searchParams.get('conversacion'));
    return Number.isInteger(n) && n > 0 ? n : null;
  });

  const [instrucciones, setInstrucciones] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [invitarAbierto, setInvitarAbierto] = useState(false);
  const [candidatos, setCandidatos] = useState<Candidato[] | null>(null);
  const [elegidos, setElegidos] = useState<string[]>([]);
  const [archivarAbierto, setArchivarAbierto] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const res = await chatFetch(`/api/chat/projects/${idProject}`);
      if (res.status === 404) {
        setSinAcceso(true);
        return;
      }
      if (!res.ok) {
        setError('No se pudo cargar el proyecto.');
        return;
      }
      const data = (await res.json()) as { project: ChatProjectDetailDto };
      setProyecto(data.project);
      setInstrucciones(data.project.instructions ?? '');
      setError(null);
      // En escritorio se abre de una vez la conversación más reciente.
      setIdConversacion((actual) => actual ?? (enCelular ? null : data.project.conversations[0]?.id ?? null));
    } catch {
      setError('No se pudo cargar el proyecto.');
    }
  }, [idProject, enCelular]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const esDueno = proyecto?.myRole === 'owner';

  // ChatThread espera un ChatAgentDto completo; el proyecto trae lo justo.
  const agente: ChatAgentDto | null = useMemo(
    () =>
      proyecto
        ? {
            ...proyecto.agent,
            description: null,
            sortOrder: 0,
            companies: [{ ...proyecto.company, isPrimary: false }],
            busy: false,
          }
        : null,
    [proyecto]
  );

  const conversacionAbierta = proyecto?.conversations.find((c) => c.id === idConversacion) ?? null;

  /* ────────────────────────────── Acciones ─────────────────────────────── */

  const accion = async (fn: () => Promise<Response>, okMsg: string | null, errMsg: string) => {
    setAviso(null);
    setError(null);
    try {
      const res = await fn();
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setError(data?.error ?? errMsg);
        return false;
      }
      if (okMsg) setAviso(okMsg);
      await cargar();
      return true;
    } catch {
      setError(errMsg);
      return false;
    }
  };

  const nuevaConversacion = async () => {
    setError(null);
    try {
      const res = await chatFetch(`/api/chat/projects/${idProject}/conversations`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const data = (await res.json().catch(() => null)) as { idConversation?: number; error?: string } | null;
      if (!res.ok || !data?.idConversation) {
        setError(data?.error ?? 'No se pudo crear la conversación.');
        return;
      }
      setIdConversacion(data.idConversation);
      await cargar();
    } catch {
      setError('No se pudo crear la conversación.');
    }
  };

  const guardarInstrucciones = async () => {
    setGuardando(true);
    await accion(
      () =>
        chatFetch(`/api/chat/projects/${idProject}`, {
          method: 'PATCH',
          body: JSON.stringify({ instructions: instrucciones }),
        }),
      'Instrucciones guardadas. El asistente las usa desde su próxima respuesta.',
      'No se pudieron guardar las instrucciones.'
    );
    setGuardando(false);
  };

  const subirArchivos = async (archivos: File[]) => {
    if (archivos.length === 0) return;
    const form = new FormData();
    for (const a of archivos) form.append('files', a);
    setGuardando(true);
    // Multipart: sin Content-Type a mano, lo pone el navegador con su borde.
    await accion(
      () =>
        fetch(`/api/chat/projects/${idProject}/files`, {
          method: 'POST',
          body: form,
          credentials: 'same-origin',
          cache: 'no-store',
        }),
      'Archivos cargados al proyecto.',
      'No se pudieron cargar los archivos.'
    );
    setGuardando(false);
  };

  const abrirInvitar = async () => {
    setElegidos([]);
    setCandidatos(null);
    setInvitarAbierto(true);
    const data = await chatGetJson<{ users: Candidato[] }>(`/api/chat/projects/${idProject}/members`);
    setCandidatos(data?.users ?? []);
  };

  const invitar = async () => {
    setGuardando(true);
    const ok = await accion(
      () =>
        chatFetch(`/api/chat/projects/${idProject}/members`, {
          method: 'POST',
          body: JSON.stringify({ idUsers: elegidos }),
        }),
      'Personas agregadas al proyecto.',
      'No se pudo invitar.'
    );
    setGuardando(false);
    if (ok) setInvitarAbierto(false);
  };

  const retirar = (idUser: string, esYo: boolean) =>
    accion(
      () => chatFetch(`/api/chat/projects/${idProject}/members?idUser=${encodeURIComponent(idUser)}`, { method: 'DELETE' }),
      esYo ? null : 'Persona retirada del proyecto.',
      'No se pudo retirar a la persona.'
    ).then((ok) => {
      if (ok && esYo) router.push(`/process/chat/proyectos/${encodeURIComponent(proyecto?.agent.code ?? '')}`);
    });

  const archivar = async () => {
    setGuardando(true);
    const ok = await accion(
      () => chatFetch(`/api/chat/projects/${idProject}`, { method: 'DELETE' }),
      null,
      'No se pudo archivar el proyecto.'
    );
    setGuardando(false);
    if (ok) router.push(`/process/chat/proyectos/${encodeURIComponent(proyecto?.agent.code ?? '')}`);
  };

  /* ────────────────────────────── Render ──────────────────────────────── */

  if (sinAcceso) {
    return (
      <div className='app-page-shell app-page-shell--fill min-h-screen'>
        <div className='max-w-3xl mx-auto py-10 px-4'>
          <Alert icon={<IconLock size={18} />} color='yellow' radius='lg' title='Proyecto no disponible'>
            Este proyecto no existe, fue archivado o usted no forma parte de él.
          </Alert>
        </div>
      </div>
    );
  }

  const volver = (
    <Group gap='xs' mb={4}>
      <Link
        href={proyecto ? `/process/chat/proyectos/${encodeURIComponent(proyecto.agent.code)}` : '/process/chat'}
        className='chat-text-muted'
        style={{ fontSize: 13 }}
      >
        <Group gap={4} wrap='nowrap'>
          <IconArrowLeft size={14} />
          <span>{proyecto ? `Proyectos de ${proyecto.agent.displayName}` : 'Volver a Chat'}</span>
        </Group>
      </Link>
    </Group>
  );

  const panel = proyecto ? (
    <Box className='chat-page-thread' style={{ position: 'static' }}>
      <Tabs value={pestana} onChange={setPestana} keepMounted={false} style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
        <Tabs.List grow className='chat-panel__header'>
          <Tabs.Tab value='conversaciones' leftSection={<IconMessages size={14} />}>
            Conversaciones
          </Tabs.Tab>
          <Tabs.Tab value='instrucciones' leftSection={<IconNotes size={14} />}>
            Instrucciones
          </Tabs.Tab>
          <Tabs.Tab value='archivos' leftSection={<IconFile size={14} />}>
            Archivos
          </Tabs.Tab>
          <Tabs.Tab value='miembros' leftSection={<IconUsers size={14} />}>
            Miembros
          </Tabs.Tab>
        </Tabs.List>

        <ScrollArea style={{ flex: 1, minHeight: 0 }} type='auto'>
          <Tabs.Panel value='conversaciones' p='sm'>
            <Stack gap='xs'>
              <Button
                variant='light'
                leftSection={<IconMessagePlus size={16} />}
                onClick={() => void nuevaConversacion()}
              >
                Nueva conversación
              </Button>
              {proyecto.conversations.length === 0 && (
                <Text size='xs' className='chat-text-muted' ta='center' py='md'>
                  Todavía no hay conversaciones en este proyecto.
                </Text>
              )}
              {proyecto.conversations.map((c) => (
                <UnstyledButton
                  key={c.id}
                  onClick={() => setIdConversacion(c.id)}
                  className={`chat-agent-card chat-agent-card--compact${c.id === idConversacion ? ' chat-agent-card--selected' : ''}`}
                  aria-current={c.id === idConversacion ? 'true' : undefined}
                >
                  <Text size='sm' fw={600} lineClamp={1}>
                    {c.title ?? 'Conversación'}
                  </Text>
                  <Text size='xs' className='chat-text-muted'>
                    {c.lastMessageAt ? formatChatTime(c.lastMessageAt) : formatChatTime(c.createdAt)}
                  </Text>
                </UnstyledButton>
              ))}
            </Stack>
          </Tabs.Panel>

          <Tabs.Panel value='instrucciones' p='sm'>
            <Stack gap='xs'>
              <Text size='xs' className='chat-text-muted'>
                El asistente las lee en cada respuesta de este proyecto, en todas sus conversaciones.
              </Text>
              <Textarea
                value={instrucciones}
                onChange={(e) => setInstrucciones(e.currentTarget.value)}
                autosize
                minRows={6}
                maxRows={16}
                maxLength={8000}
                readOnly={!esDueno}
                placeholder={esDueno ? 'Qué papel cumple el asistente aquí y de qué temas se ocupa.' : 'Sin instrucciones.'}
              />
              {esDueno && (
                <Group justify='flex-end'>
                  <Button
                    size='xs'
                    onClick={() => void guardarInstrucciones()}
                    loading={guardando}
                    disabled={(proyecto.instructions ?? '') === instrucciones}
                  >
                    Guardar
                  </Button>
                </Group>
              )}
            </Stack>
          </Tabs.Panel>

          <Tabs.Panel value='archivos' p='sm'>
            <Stack gap='xs'>
              <Text size='xs' className='chat-text-muted'>
                Base de conocimiento del proyecto: el asistente los puede leer en todas sus
                conversaciones.
              </Text>
              {esDueno && (
                <FileButton onChange={(f) => void subirArchivos(f ?? [])} multiple>
                  {(props) => (
                    <Button {...props} variant='light' leftSection={<IconFileUpload size={16} />} loading={guardando}>
                      Cargar archivos
                    </Button>
                  )}
                </FileButton>
              )}
              {proyecto.files.length === 0 && (
                <Text size='xs' className='chat-text-muted' ta='center' py='md'>
                  El proyecto no tiene archivos.
                </Text>
              )}
              {proyecto.files.map((f) => (
                <Group key={f.id} gap='xs' wrap='nowrap' className='chat-agent-card chat-agent-card--compact'>
                  <IconFile size={16} className='chat-folder__icon' style={{ flexShrink: 0 }} />
                  <Box style={{ minWidth: 0, flex: 1 }}>
                    <Text size='sm' lineClamp={1} component='a' href={f.downloadUrl}>
                      {f.fileName}
                    </Text>
                    <Text size='xs' className='chat-text-muted'>
                      {f.sizeBytes !== null ? formatBytes(f.sizeBytes) : ''} · {formatChatTime(f.createdAt)}
                    </Text>
                  </Box>
                  {esDueno && (
                    <Tooltip label='Quitar del proyecto' withArrow>
                      <ActionIcon
                        variant='subtle'
                        color='red'
                        aria-label={`Quitar ${f.fileName}`}
                        onClick={() =>
                          void accion(
                            () => chatFetch(`/api/chat/projects/${idProject}/files/${f.id}`, { method: 'DELETE' }),
                            'Archivo quitado del proyecto.',
                            'No se pudo quitar el archivo.'
                          )
                        }
                      >
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Tooltip>
                  )}
                </Group>
              ))}
            </Stack>
          </Tabs.Panel>

          <Tabs.Panel value='miembros' p='sm'>
            <Stack gap='xs'>
              {esDueno && (
                <Button variant='light' leftSection={<IconUserPlus size={16} />} onClick={() => void abrirInvitar()}>
                  Invitar personas
                </Button>
              )}
              {proyecto.members.map((m) => {
                const esYo = m.id === miId;
                return (
                  <Group key={m.id} gap='xs' wrap='nowrap' className='chat-agent-card chat-agent-card--compact'>
                    <AgentAvatar
                      code={m.id}
                      displayName={m.name}
                      avatarUrl={m.avatarUrl}
                      size={28}
                      showStatus={false}
                      withTooltip={false}
                    />
                    <Box style={{ minWidth: 0, flex: 1 }}>
                      <Text size='sm' lineClamp={1}>
                        {m.name}
                        {esYo ? ' (usted)' : ''}
                      </Text>
                      <Text size='xs' className='chat-text-muted' lineClamp={1}>
                        {m.email}
                      </Text>
                    </Box>
                    {m.role === 'owner' ? (
                      <Badge size='xs' variant='light' color='grape'>
                        Dueño
                      </Badge>
                    ) : esDueno || esYo ? (
                      <Tooltip label={esYo ? 'Salir del proyecto' : 'Retirar del proyecto'} withArrow>
                        <ActionIcon
                          variant='subtle'
                          color='red'
                          aria-label={esYo ? 'Salir del proyecto' : `Retirar a ${m.name}`}
                          onClick={() => void retirar(m.id, esYo)}
                        >
                          {esYo ? <IconLogout size={16} /> : <IconTrash size={16} />}
                        </ActionIcon>
                      </Tooltip>
                    ) : null}
                  </Group>
                );
              })}
              {esDueno && (
                <Button
                  variant='subtle'
                  color='red'
                  leftSection={<IconArchive size={16} />}
                  onClick={() => setArchivarAbierto(true)}
                  mt='sm'
                >
                  Archivar el proyecto
                </Button>
              )}
            </Stack>
          </Tabs.Panel>
        </ScrollArea>
      </Tabs>
    </Box>
  ) : (
    <Box className='chat-page-thread' style={{ position: 'static' }}>
      <EsqueletoPanel />
    </Box>
  );

  const hilo =
    proyecto && agente && conversacionAbierta ? (
      <Box className='chat-page-thread'>
        <Group justify='space-between' p='sm' className='chat-panel__header' wrap='nowrap'>
          <Group gap='sm' wrap='nowrap' style={{ minWidth: 0 }}>
            {enCelular && (
              <ActionIcon variant='subtle' color='gray' onClick={() => setIdConversacion(null)} aria-label='Volver al proyecto'>
                <IconArrowLeft size={18} />
              </ActionIcon>
            )}
            <AgentAvatar
              code={agente.code}
              displayName={agente.displayName}
              avatarUrl={agente.avatarUrl}
              avatarVersion={agente.avatarVersion}
              size={36}
              showStatus={false}
              withTooltip={false}
            />
            <Box style={{ minWidth: 0 }}>
              <Text fw={600} size='sm' lineClamp={1}>
                {conversacionAbierta.title ?? 'Conversación'}
              </Text>
              <Text size='xs' className='chat-text-muted' lineClamp={1}>
                {proyecto.name} · {agente.displayName}
              </Text>
            </Box>
          </Group>
        </Group>
        <ChatThread
          key={conversacionAbierta.id}
          agent={agente}
          project={{ idConversation: conversacionAbierta.id, name: proyecto.name }}
          currentUserId={miId}
          active
        />
      </Box>
    ) : (
      <Box className='chat-page-thread'>
        {proyecto ? (
          <Stack align='center' justify='center' gap={6} style={{ flex: 1 }} p='lg'>
            <IconFolder size={30} className='chat-empty__icon' />
            <Text size='sm' fw={600}>
              Escoja o cree una conversación
            </Text>
            <Text size='xs' ta='center' className='chat-text-muted' maw={340}>
              Cada conversación del proyecto tiene su propia memoria; todas comparten las
              instrucciones y los archivos del proyecto.
            </Text>
          </Stack>
        ) : (
          <EsqueletoHilo />
        )}
      </Box>
    );

  return (
    <div className='app-page-shell app-page-shell--fill ios-process-hub min-h-screen'>
      <div className='max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8'>
        {volver}

        <Group justify='space-between' align='flex-start' mb='md' gap='sm' wrap='nowrap'>
          <Box style={{ minWidth: 0, flex: 1 }}>
            {proyecto ? (
              <>
                <Title order={1} className='ios-process-hub__title text-2xl' lineClamp={1}>
                  {proyecto.name}
                </Title>
                <Group gap={6} mt={4} wrap='wrap'>
                  <Text size='xs' className='chat-text-muted'>
                    {proyecto.company.companyName}
                  </Text>
                  <Badge size='xs' variant='light'>
                    {proyecto.profile.label}
                  </Badge>
                  <Text size='xs' className='chat-text-muted'>
                    · {proyecto.members.length} {proyecto.members.length === 1 ? 'miembro' : 'miembros'} · con{' '}
                    {proyecto.agent.displayName}
                  </Text>
                </Group>
              </>
            ) : (
              <Stack gap={6}>
                <Skeleton height={22} width={260} radius='sm' />
                <Skeleton height={10} width={200} radius='sm' />
              </Stack>
            )}
          </Box>
        </Group>

        {error && (
          <Alert color='red' radius='md' icon={<IconAlertCircle size={18} />} mb='sm' withCloseButton onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
        {aviso && (
          <Alert color='green' radius='md' mb='sm' withCloseButton onClose={() => setAviso(null)}>
            {aviso}
          </Alert>
        )}

        {enCelular ? (
          idConversacion !== null && conversacionAbierta ? hilo : panel
        ) : (
          <Grid gutter='md'>
            <Grid.Col span={{ base: 12, md: 4 }}>{panel}</Grid.Col>
            <Grid.Col span={{ base: 12, md: 8 }}>{hilo}</Grid.Col>
          </Grid>
        )}
      </div>

      <Modal
        opened={invitarAbierto}
        onClose={() => setInvitarAbierto(false)}
        title={
          <Group gap={8}>
            <IconUserPlus size={18} />
            <Text fw={600}>Invitar al proyecto</Text>
          </Group>
        }
        size='md'
        radius='md'
        centered
      >
        <Stack gap='sm'>
          <Text size='xs' className='chat-text-muted'>
            Solo aparecen quienes tienen este asistente en {proyecto?.company.companyName ?? 'la empresa del proyecto'}.
            Verán todo lo trabajado en el proyecto.
          </Text>
          {candidatos === null && <EsqueletoListaAgentes filas={3} />}
          {candidatos && candidatos.length === 0 && (
            <Text size='sm' className='chat-text-muted'>
              No hay más personas que se puedan invitar.
            </Text>
          )}
          {candidatos && candidatos.length > 0 && (
            <ScrollArea.Autosize mah={260}>
              <Stack gap={4}>
                {candidatos.map((u) => (
                  <Checkbox
                    key={u.id}
                    checked={elegidos.includes(u.id)}
                    onChange={() =>
                      setElegidos((l) => (l.includes(u.id) ? l.filter((x) => x !== u.id) : [...l, u.id]))
                    }
                    label={
                      <Box>
                        <Text size='sm'>{u.name}</Text>
                        <Text size='xs' className='chat-text-muted'>
                          {u.email}
                        </Text>
                      </Box>
                    }
                  />
                ))}
              </Stack>
            </ScrollArea.Autosize>
          )}
          <Group justify='flex-end' gap='sm'>
            <Button variant='subtle' onClick={() => setInvitarAbierto(false)} disabled={guardando}>
              Cancelar
            </Button>
            <Button
              onClick={() => void invitar()}
              loading={guardando}
              disabled={elegidos.length === 0}
              leftSection={<IconUserPlus size={16} />}
            >
              Invitar
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={archivarAbierto}
        onClose={() => (guardando ? undefined : setArchivarAbierto(false))}
        title='Archivar el proyecto'
        radius='lg'
        centered
        classNames={{ content: 'chat-surface' }}
      >
        <Stack gap='sm'>
          <Text size='sm'>
            Va a archivar <strong>{proyecto?.name}</strong>. Nadie podrá volver a abrirlo y el
            asistente dejará de atender sus conversaciones.
          </Text>
          <Text size='xs' className='chat-text-muted'>
            Las conversaciones no se borran: quedan para la auditoría.
          </Text>
          <Group justify='flex-end' gap='xs'>
            <Button variant='subtle' color='gray' onClick={() => setArchivarAbierto(false)} disabled={guardando}>
              Cancelar
            </Button>
            <Button color='red' onClick={() => void archivar()} loading={guardando}>
              Archivar
            </Button>
          </Group>
        </Stack>
      </Modal>
    </div>
  );
}
