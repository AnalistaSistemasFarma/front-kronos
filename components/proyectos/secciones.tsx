'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  FileButton,
  Group,
  Menu,
  Stack,
  Text,
  Textarea,
  TextInput,
  ThemeIcon,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import {
  IconArchive,
  IconArchiveOff,
  IconArrowRight,
  IconChevronRight,
  IconFolder,
  IconFolderPlus,
  IconFolderUp,
  IconDots,
  IconExternalLink,
  IconFile,
  IconFileUpload,
  IconInfoCircle,
  IconLock,
  IconLogout,
  IconMail,
  IconMessagePlus,
  IconMessages,
  IconPlus,
  IconTicket,
  IconTrash,
  IconUserPlus,
} from '@tabler/icons-react';
import AgentAvatar from '../chat/AgentAvatar';
import ChatAttachmentViewer from '../chat/ChatAttachmentViewer';
import { formatBytes } from '../../lib/chat/attachments';
import {
  MAX_PROJECT_DESCRIPTION_CHARS,
  MAX_PROJECT_INSTRUCTIONS_CHARS,
  MAX_PROJECT_NAME_CHARS,
  PROJECT_ROLE_LABELS,
  type ProjectRole,
} from '../../lib/chat/projects-rules';
import type { ProyectoDetalleDto } from '../../lib/proyectos/tipos';
import { carpetaDeRutaRelativa, migas, nombreCarpeta, subcarpetas, unirCarpetas } from '../../lib/proyectos/carpetas';
import { vistaEstadoAgente, type EstadoAgenteProyectoDto } from '../../lib/proyectos/estado-agente';
import { autoriaAgente } from '../../lib/proyectos/archivos-agente';
import { LineaEstadoAgente } from './EstadoAgente';
import { fechaCorta } from './api';
import { BadgeRol } from './ui';
import css from './proyectos.module.css';

/* ───────────────────────────── Conversaciones ───────────────────────────── */

export function ListaConversaciones({
  proyecto,
  activa,
  onAbrir,
  onNueva,
  estados,
}: {
  proyecto: ProyectoDetalleDto;
  activa: number | null;
  onAbrir: (id: number) => void;
  onNueva: () => void;
  /** Estado en vivo del agente por conversación (2026-10-20). */
  estados?: ReadonlyMap<number, EstadoAgenteProyectoDto>;
}) {
  const puedeAbrir = proyecto.capabilities.write && proyecto.agents.some((a) => a.puedoEscribir);
  return (
    <Stack gap={6}>
      {proyecto.capabilities.write && (
        <Tooltip
          label={proyecto.agents.length === 0 ? 'El proyecto no tiene asistentes. Agréguelos en «Detalles».' : 'No tiene asignado ninguno de los asistentes del proyecto.'}
          disabled={puedeAbrir}
          withArrow
        >
          <div>
            <Button fullWidth variant='light' leftSection={<IconMessagePlus size={18} />} onClick={onNueva} disabled={!puedeAbrir} data-testid='proyecto-nueva-conversacion'>
              Nueva conversación
            </Button>
          </div>
        </Tooltip>
      )}
      {proyecto.conversations.length === 0 ? (
        <Stack align='center' gap={6} py='lg' px='sm'>
          <ThemeIcon size={40} radius='xl' variant='light'>
            <IconMessages size={22} />
          </ThemeIcon>
          <Text size='sm' fw={600}>
            Todavía no hay conversaciones
          </Text>
          <Text size='xs' c='dimmed' ta='center'>
            Cada conversación tiene su propia memoria; todas comparten las instrucciones, los archivos y lo vinculado al proyecto.
          </Text>
        </Stack>
      ) : (
        proyecto.conversations.map((c) => {
          // «Orus está trabajando…» (2026-10-20): el mismo estado del chat, en vivo por el pulso.
          const vista = vistaEstadoAgente(estados?.get(c.id) ?? c.agentStatus ?? null, c.agent.displayName);
          return (
          <UnstyledButton
            key={c.id}
            onClick={() => onAbrir(c.id)}
            className={`${css.fila} ${css.filaBoton} ${c.id === activa ? css.filaActiva : ''}`}
            aria-current={c.id === activa ? 'true' : undefined}
            data-testid='proyecto-conversacion'
            data-trabajando={vista.trabajando ? 'true' : undefined}
          >
            <AgentAvatar code={c.agent.code} displayName={c.agent.displayName} avatarUrl={c.agent.avatarUrl} avatarVersion={c.agent.avatarVersion} size={34} showStatus={false} withTooltip={false} working={vista.trabajando} />
            <div className={css.item} style={{ flex: 1 }}>
              <Group gap={6} wrap='nowrap' justify='space-between'>
                <Text size='sm' fw={600} className={css.truncar}>
                  {c.title ?? 'Conversación'}
                </Text>
                <Text size='xs' c='dimmed' style={{ flexShrink: 0 }}>
                  {fechaCorta(c.lastMessageAt ?? c.createdAt)}
                </Text>
              </Group>
              <Group gap={6} wrap='nowrap'>
                <Text size='xs' c='dimmed' className={css.truncar}>
                  {c.agent.displayName}
                  {c.createdBy ? ` · ${c.createdBy.name}` : ''}
                </Text>
                {c.soloLectura && <IconLock size={12} color='var(--mantine-color-dimmed)' style={{ flexShrink: 0 }} aria-label='Solo lectura' />}
              </Group>
              <LineaEstadoAgente vista={vista} subagentes='tabla' testId='proyecto-conversacion-estado' />
            </div>
          </UnstyledButton>
          );
        })
      )}
    </Stack>
  );
}

/* ─────────────────────────────── Vinculados ─────────────────────────────── */

function Vacio({ icono, titulo, texto }: { icono: React.ReactNode; titulo: string; texto: string }) {
  return (
    <Stack align='center' gap={4} py='md' px='sm'>
      <ThemeIcon size={36} radius='xl' variant='light' color='gray'>
        {icono}
      </ThemeIcon>
      <Text size='sm' fw={600}>
        {titulo}
      </Text>
      <Text size='xs' c='dimmed' ta='center' maw={420}>
        {texto}
      </Text>
    </Stack>
  );
}

export function SeccionVinculados({
  proyecto,
  onVincularCorreo,
  onVincularSolicitud,
  onQuitarCorreo,
  onQuitarSolicitud,
}: {
  proyecto: ProyectoDetalleDto;
  onVincularCorreo: () => void;
  onVincularSolicitud: () => void;
  onQuitarCorreo: (id: number) => void;
  onQuitarSolicitud: (id: number) => void;
}) {
  const puede = proyecto.capabilities.contribute;
  const { emails, requests } = proyecto.links;
  return (
    <Stack gap='lg'>
      <Alert variant='light' color='blue' radius='md' icon={<IconInfoCircle size={18} />} py={8}>
        <Text size='xs'>
          Los asistentes del proyecto pueden consultar lo vinculado, en solo lectura. De cada correo, los miembros y los asistentes ven el
          asunto, el remitente, la fecha y el resumen; el cuerpo solo lo abre quien lo vinculó, desde su Correo.
        </Text>
      </Alert>

      <Stack gap={8}>
        <Group justify='space-between' wrap='nowrap'>
          <Group gap={6} wrap='nowrap'>
            <IconMail size={18} />
            <Text fw={600}>Correos</Text>
            <Badge size='sm' variant='light' color='gray'>
              {emails.length}
            </Badge>
          </Group>
          {puede && (
            <Button size='xs' variant='light' leftSection={<IconPlus size={16} />} onClick={onVincularCorreo} data-testid='proyecto-vincular-correo'>
              Vincular correo
            </Button>
          )}
        </Group>
        {emails.length === 0 ? (
          <Vacio icono={<IconMail size={18} />} titulo='Sin correos vinculados' texto='Vincule hilos de su buzón para que el equipo y los asistentes tengan el contexto.' />
        ) : (
          emails.map((e) => (
            <Card key={e.id} withBorder radius='md' p='sm' data-testid='proyecto-correo'>
              <Group justify='space-between' wrap='nowrap' align='flex-start' gap='xs'>
                <div className={css.item} style={{ flex: 1 }}>
                  <Text size='sm' fw={600} lineClamp={2}>
                    {e.subject || '(Sin asunto)'}
                  </Text>
                  <Text size='xs' c='dimmed' className={css.truncar}>
                    {e.senderName ?? e.senderEmail ?? 'Remitente desconocido'}
                    {e.lastMessageAt ? ` · ${fechaCorta(e.lastMessageAt)}` : ''}
                    {e.messageCount ? ` · ${e.messageCount} ${e.messageCount === 1 ? 'mensaje' : 'mensajes'}` : ''}
                  </Text>
                </div>
                {(e.abrirUrl || e.puedoQuitar) && (
                  <Menu position='bottom-end' withinPortal>
                    <Menu.Target>
                      <ActionIcon variant='subtle' color='gray' aria-label='Opciones del correo'>
                        <IconDots size={18} />
                      </ActionIcon>
                    </Menu.Target>
                    <Menu.Dropdown>
                      {e.abrirUrl && (
                        <Menu.Item component='a' href={e.abrirUrl} leftSection={<IconExternalLink size={16} />}>
                          Abrir en mi Correo
                        </Menu.Item>
                      )}
                      {e.puedoQuitar && (
                        <Menu.Item color='red' leftSection={<IconTrash size={16} />} onClick={() => onQuitarCorreo(e.id)}>
                          Quitar del proyecto
                        </Menu.Item>
                      )}
                    </Menu.Dropdown>
                  </Menu>
                )}
              </Group>
              {e.summary && (
                <Text size='sm' mt={6} className={css.resumen}>
                  {e.summary}
                </Text>
              )}
              <Text size='xs' c='dimmed' mt={6}>
                Vinculado por {e.linkedBy?.name ?? 'alguien'} · {fechaCorta(e.linkedAt)}
              </Text>
            </Card>
          ))
        )}
      </Stack>

      <Stack gap={8}>
        <Group justify='space-between' wrap='nowrap'>
          <Group gap={6} wrap='nowrap'>
            <IconTicket size={18} />
            <Text fw={600}>Solicitudes</Text>
            <Badge size='sm' variant='light' color='gray'>
              {requests.length}
            </Badge>
          </Group>
          {puede && (
            <Button size='xs' variant='light' leftSection={<IconPlus size={16} />} onClick={onVincularSolicitud} data-testid='proyecto-vincular-solicitud'>
              Vincular solicitud
            </Button>
          )}
        </Group>
        {requests.length === 0 ? (
          <Vacio icono={<IconTicket size={18} />} titulo='Sin solicitudes vinculadas' texto={`Vincule casos de ${proyecto.company.companyName} en los que usted participa.`} />
        ) : (
          requests.map((s) => (
            <Card key={s.id} withBorder radius='md' p='sm' data-testid='proyecto-solicitud'>
              <Group justify='space-between' wrap='nowrap' align='flex-start' gap='xs'>
                <div className={css.item} style={{ flex: 1 }}>
                  <Group gap={6} wrap='nowrap'>
                    <Anchor href={s.url} size='sm' fw={700} style={{ flexShrink: 0 }}>
                      #{s.idRequest}
                    </Anchor>
                    <Text size='sm' fw={600} className={css.truncar}>
                      {s.subject}
                    </Text>
                  </Group>
                  <Group gap={6} mt={4} wrap='wrap'>
                    {s.estado && (
                      <Badge size='sm' variant='light' color={/resuel|cerrad/i.test(s.estado) ? 'green' : /cancel/i.test(s.estado) ? 'gray' : 'blue'}>
                        {s.estado}
                      </Badge>
                    )}
                    {s.processName && (
                      <Text size='xs' c='dimmed' className={css.truncar}>
                        {s.processName}
                      </Text>
                    )}
                  </Group>
                </div>
                {s.puedoQuitar && (
                  <Tooltip label='Quitar del proyecto' withArrow>
                    <ActionIcon variant='subtle' color='red' aria-label={`Quitar la solicitud ${s.idRequest}`} onClick={() => onQuitarSolicitud(s.id)}>
                      <IconTrash size={18} />
                    </ActionIcon>
                  </Tooltip>
                )}
              </Group>
              <Text size='xs' c='dimmed' mt={6}>
                Vinculada por {s.linkedBy?.name ?? 'alguien'} · {fechaCorta(s.linkedAt)}
              </Text>
            </Card>
          ))
        )}
      </Stack>
    </Stack>
  );
}

/* ──────────────────────────────── Archivos ──────────────────────────────── */

/** Un lote de carga: archivos que van a una misma carpeta (null = la raíz). */
export interface LoteArchivos {
  folder: string | null;
  files: File[];
}

export function SeccionArchivos({
  proyecto,
  subiendo,
  onSubir,
  onQuitar,
  onCrearCarpeta,
  onQuitarCarpeta,
  onMover,
}: {
  proyecto: ProyectoDetalleDto;
  subiendo: boolean;
  onSubir: (lotes: LoteArchivos[]) => void;
  onQuitar: (id: number) => void;
  onCrearCarpeta: (path: string) => Promise<boolean>;
  onQuitarCarpeta: (path: string) => void;
  onMover: (id: number, folder: string | null) => void;
}) {
  // Visor del chat (2026-11-05, Nicolás Rivera: «previsualizar y compartir idéntico como lo
  // tenemos en el chat»): al tocar un archivo se abre el visor; Descargar y Compartir van adentro.
  const [visor, setVisor] = useState<number | null>(null);
  // 2026-11-06 (reunión con Juan Mora): CARPETAS. Se navega por carpetas; «Cargar carpeta» sube una
  // carpeta completa con su estructura.
  const [actual, setActual] = useState<string | null>(null);
  const [nueva, setNueva] = useState<string | null>(null);
  const inputCarpeta = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    // Atributos no estándar del selector de carpetas (Chrome, Edge, Safari y Firefox los admiten).
    inputCarpeta.current?.setAttribute('webkitdirectory', '');
    inputCarpeta.current?.setAttribute('directory', '');
  }, []);
  const todas = useMemo(() => {
    const set = new Set(proyecto.folders);
    for (const f of proyecto.files) if (f.folderPath) set.add(f.folderPath);
    return [...set];
  }, [proyecto.folders, proyecto.files]);
  // Si la carpeta en la que estaba desapareció (la quitaron), se vuelve a la raíz.
  useEffect(() => {
    if (actual && !todas.includes(actual)) setActual(null);
  }, [actual, todas]);
  const hijas = subcarpetas(todas, actual);
  const archivos = proyecto.files.filter((f) => (f.folderPath ?? null) === actual);
  const opcionesMover = [{ value: '', label: 'Raíz del proyecto' }, ...[...todas].sort((a, b) => a.localeCompare(b, 'es')).map((r) => ({ value: r, label: r }))];

  const subirCarpeta = (lista: FileList | null) => {
    const files = Array.from(lista ?? []);
    if (files.length === 0) return;
    const porCarpeta = new Map<string, File[]>();
    for (const f of files) {
      const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath ?? '';
      let folder: string | null = actual;
      try {
        folder = unirCarpetas(actual, carpetaDeRutaRelativa(rel));
      } catch {
        folder = actual;
      }
      const key = folder ?? '';
      porCarpeta.set(key, [...(porCarpeta.get(key) ?? []), f]);
    }
    onSubir([...porCarpeta.entries()].map(([k, v]) => ({ folder: k || null, files: v })));
    if (inputCarpeta.current) inputCarpeta.current.value = '';
  };

  return (
    <Stack gap={8}>
      {visor !== null && archivos.length > 0 && (
        <ChatAttachmentViewer
          adjuntos={archivos.map((f) => ({
            id: f.id,
            fileName: f.fileName,
            contentType: f.contentType,
            sizeBytes: f.sizeBytes,
            downloadUrl: f.downloadUrl,
          }))}
          indice={visor}
          onIndice={setVisor}
          onClose={() => setVisor(null)}
        />
      )}
      <Group justify='space-between' wrap='wrap' gap='xs'>
        <Text size='xs' c='dimmed' style={{ flex: '1 1 220px' }}>
          Base de conocimiento del proyecto: los asistentes los leen en todas sus conversaciones. Organícelos en carpetas.
        </Text>
        {proyecto.capabilities.contribute && (
          <Group gap='xs'>
            <Button variant='subtle' leftSection={<IconFolderPlus size={18} />} onClick={() => setNueva('')} data-testid='proyecto-nueva-carpeta'>
              Nueva carpeta
            </Button>
            <input ref={inputCarpeta} type='file' multiple hidden onChange={(e) => subirCarpeta(e.currentTarget.files)} data-testid='proyecto-input-carpeta' />
            <Button variant='subtle' leftSection={<IconFolderUp size={18} />} loading={subiendo} onClick={() => inputCarpeta.current?.click()} data-testid='proyecto-subir-carpeta'>
              Cargar carpeta
            </Button>
            <FileButton onChange={(f) => (f && f.length ? onSubir([{ folder: actual, files: f }]) : undefined)} multiple>
              {(props) => (
                <Button {...props} variant='light' leftSection={<IconFileUpload size={18} />} loading={subiendo} data-testid='proyecto-subir-archivos'>
                  Cargar archivos
                </Button>
              )}
            </FileButton>
          </Group>
        )}
      </Group>

      {/* Migas de pan de la carpeta actual. */}
      <Group gap={4} wrap='wrap' data-testid='proyecto-migas'>
        <Anchor component='button' type='button' size='sm' fw={actual ? 400 : 600} onClick={() => setActual(null)}>
          Archivos
        </Anchor>
        {migas(actual).map((m) => (
          <Group key={m.ruta} gap={4} wrap='nowrap'>
            <IconChevronRight size={14} color='var(--mantine-color-dimmed)' />
            <Anchor component='button' type='button' size='sm' fw={m.ruta === actual ? 600 : 400} onClick={() => setActual(m.ruta)}>
              {m.nombre}
            </Anchor>
          </Group>
        ))}
      </Group>

      {nueva !== null && (
        <Group gap='xs' align='flex-end' wrap='wrap'>
          <TextInput
            autoComplete='off'
            data-1p-ignore='true'
            data-lpignore='true'
            label={actual ? `Nueva carpeta dentro de «${nombreCarpeta(actual)}»` : 'Nueva carpeta'}
            value={nueva}
            onChange={(e) => setNueva(e.currentTarget.value)}
            maxLength={100}
            autoFocus
            style={{ flex: '1 1 240px' }}
            data-testid='proyecto-nueva-carpeta-nombre'
          />
          <Button
            disabled={!nueva.trim()}
            loading={subiendo}
            onClick={async () => {
              const ok = await onCrearCarpeta([actual ?? '', nueva.trim()].filter(Boolean).join('/'));
              if (ok) setNueva(null);
            }}
            data-testid='proyecto-crear-carpeta'
          >
            Crear
          </Button>
          <Button variant='default' onClick={() => setNueva(null)}>
            Cancelar
          </Button>
        </Group>
      )}

      {hijas.map((h) => (
        <Group key={h} gap='sm' wrap='nowrap' className={css.fila} style={{ border: '1px solid var(--mantine-color-default-border)' }} data-testid='proyecto-carpeta'>
          <ThemeIcon variant='light' color='yellow' size={34} radius='md' style={{ flexShrink: 0 }}>
            <IconFolder size={18} />
          </ThemeIcon>
          <div className={css.item} style={{ flex: 1 }}>
            <Anchor component='button' type='button' size='sm' fw={600} onClick={() => setActual(h)} className={css.truncar} style={{ display: 'block', textAlign: 'left', maxWidth: '100%' }}>
              {nombreCarpeta(h)}
            </Anchor>
            <Text size='xs' c='dimmed'>
              {proyecto.files.filter((f) => f.folderPath === h || f.folderPath?.startsWith(`${h}/`)).length} archivo(s)
            </Text>
          </div>
          {proyecto.capabilities.contribute && (
            <Tooltip label='Quitar la carpeta (solo si está vacía)' withArrow>
              <ActionIcon variant='subtle' color='red' aria-label={`Quitar la carpeta ${nombreCarpeta(h)}`} onClick={() => onQuitarCarpeta(h)}>
                <IconTrash size={18} />
              </ActionIcon>
            </Tooltip>
          )}
        </Group>
      ))}

      {archivos.length === 0 && hijas.length === 0 ? (
        <Vacio
          icono={<IconFile size={18} />}
          titulo={actual ? 'Esta carpeta está vacía' : 'El proyecto no tiene archivos'}
          texto={actual ? 'Cargue archivos o una carpeta completa aquí.' : 'Cargue manuales, plantillas o documentos, o una carpeta completa con su estructura.'}
        />
      ) : (
        archivos.map((f, i) => (
          <Group key={f.id} gap='sm' wrap='nowrap' className={css.fila} style={{ border: '1px solid var(--mantine-color-default-border)' }}>
            <ThemeIcon variant='light' size={34} radius='md' style={{ flexShrink: 0 }}>
              <IconFile size={18} />
            </ThemeIcon>
            <div className={css.item} style={{ flex: 1 }}>
              <Anchor
                component='button'
                type='button'
                onClick={() => setVisor(i)}
                size='sm'
                className={css.truncar}
                style={{ display: 'block', textAlign: 'left', maxWidth: '100%' }}
                data-testid='proyecto-archivo-abrir'
              >
                {f.fileName}
              </Anchor>
              <Text size='xs' c='dimmed' className={css.truncar}>
                {f.sizeBytes !== null ? `${formatBytes(f.sizeBytes)} · ` : ''}
                {fechaCorta(f.createdAt)}
                {f.uploadedByAgent
                  ? ` · ${autoriaAgente(f.uploadedByAgent.name, f.uploadedByAgent.idConversation)}`
                  : f.uploadedBy
                    ? ` · ${f.uploadedBy.name}`
                    : ''}
              </Text>
            </div>
            {f.puedoQuitar && (
              <Menu position='bottom-end' withinPortal>
                <Menu.Target>
                  <ActionIcon variant='subtle' aria-label={`Opciones de ${f.fileName}`} data-testid='proyecto-archivo-opciones'>
                    <IconDots size={18} />
                  </ActionIcon>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Label>Mover a</Menu.Label>
                  {opcionesMover
                    .filter((o) => (o.value || null) !== (f.folderPath ?? null))
                    .slice(0, 30)
                    .map((o) => (
                      <Menu.Item key={o.value || 'raiz'} leftSection={<IconArrowRight size={14} />} onClick={() => onMover(f.id, o.value || null)}>
                        {o.label}
                      </Menu.Item>
                    ))}
                  <Menu.Divider />
                  <Menu.Item color='red' leftSection={<IconTrash size={14} />} onClick={() => onQuitar(f.id)}>
                    Quitar del proyecto
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
            )}
          </Group>
        ))
      )}
    </Stack>
  );
}

/* ──────────────────────────────── Miembros ──────────────────────────────── */

export function SeccionMiembros({
  proyecto,
  miId,
  onInvitar,
  onCambiarRol,
  onRetirar,
}: {
  proyecto: ProyectoDetalleDto;
  miId: string | undefined;
  onInvitar: () => void;
  onCambiarRol: (idUser: string, role: 'editor' | 'reader') => void;
  onRetirar: (idUser: string, esYo: boolean) => void;
}) {
  const admin = proyecto.capabilities.manageMembers;
  return (
    <Stack gap={8}>
      <Group justify='space-between' wrap='wrap' gap='xs'>
        <Text size='xs' c='dimmed' style={{ flex: '1 1 220px' }}>
          Dueño: administra todo. Editor: conversa con los asistentes, vincula y carga archivos. Lector: solo consulta.
        </Text>
        {admin && (
          <Button variant='light' leftSection={<IconUserPlus size={18} />} onClick={onInvitar} data-testid='proyecto-invitar'>
            Invitar personas
          </Button>
        )}
      </Group>
      {proyecto.members.map((m) => {
        const esYo = m.id === miId;
        return (
          <Group key={m.id} gap='sm' wrap='nowrap' className={css.fila} style={{ border: '1px solid var(--mantine-color-default-border)' }} data-testid='proyecto-miembro'>
            <AgentAvatar code={m.id} displayName={m.name} avatarUrl={m.avatarUrl} size={34} showStatus={false} withTooltip={false} />
            <div className={css.item} style={{ flex: 1 }}>
              <Text size='sm' fw={500} className={css.truncar}>
                {m.name}
                {esYo ? ' (usted)' : ''}
              </Text>
              <Text size='xs' c='dimmed' className={css.truncar}>
                {m.email}
              </Text>
            </div>
            {admin && m.role !== 'owner' ? (
              <Menu position='bottom-end' withinPortal>
                <Menu.Target>
                  <Button variant='default' size='xs' rightSection={<IconDots size={14} />} aria-label={`Rol de ${m.name}: ${PROJECT_ROLE_LABELS[m.role]}`}>
                    {PROJECT_ROLE_LABELS[m.role]}
                  </Button>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Label>Rol</Menu.Label>
                  {(['editor', 'reader'] as const).map((r) => (
                    <Menu.Item key={r} onClick={() => onCambiarRol(m.id, r)} disabled={m.role === r}>
                      {PROJECT_ROLE_LABELS[r]}
                    </Menu.Item>
                  ))}
                  <Menu.Divider />
                  <Menu.Item color='red' leftSection={<IconTrash size={16} />} onClick={() => onRetirar(m.id, false)}>
                    Retirar del proyecto
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
            ) : (
              <Group gap={4} wrap='nowrap'>
                <BadgeRol role={m.role as ProjectRole} />
                {esYo && proyecto.capabilities.leave && (
                  <Tooltip label='Salir del proyecto' withArrow>
                    <ActionIcon variant='subtle' color='red' aria-label='Salir del proyecto' onClick={() => onRetirar(m.id, true)}>
                      <IconLogout size={18} />
                    </ActionIcon>
                  </Tooltip>
                )}
              </Group>
            )}
          </Group>
        );
      })}
    </Stack>
  );
}

/* ──────────────────────────────── Detalles ──────────────────────────────── */

export function SeccionDetalles({
  proyecto,
  guardando,
  onGuardar,
  onDesignar,
  onRetirarAgente,
  onArchivar,
  onRestaurar,
}: {
  proyecto: ProyectoDetalleDto;
  guardando: boolean;
  onGuardar: (cambios: { name: string; description: string; instructions: string }) => void;
  onDesignar: () => void;
  onRetirarAgente: (code: string) => void;
  onArchivar: () => void;
  onRestaurar: () => void;
}) {
  const puedeEditar = proyecto.capabilities.edit && !proyecto.archived;
  const [nombre, setNombre] = useState(proyecto.name);
  const [descripcion, setDescripcion] = useState(proyecto.description ?? '');
  const [instrucciones, setInstrucciones] = useState(proyecto.instructions ?? '');
  useEffect(() => {
    setNombre(proyecto.name);
    setDescripcion(proyecto.description ?? '');
    setInstrucciones(proyecto.instructions ?? '');
  }, [proyecto.name, proyecto.description, proyecto.instructions]);
  const cambio = nombre !== proyecto.name || descripcion !== (proyecto.description ?? '') || instrucciones !== (proyecto.instructions ?? '');

  return (
    <Stack gap='lg'>
      <Stack gap='sm'>
        <TextInput label='Nombre' value={nombre} onChange={(e) => setNombre(e.currentTarget.value)} readOnly={!puedeEditar} maxLength={MAX_PROJECT_NAME_CHARS} />
        <Textarea
          label='Descripción'
          value={descripcion}
          onChange={(e) => setDescripcion(e.currentTarget.value)}
          readOnly={!puedeEditar}
          maxLength={MAX_PROJECT_DESCRIPTION_CHARS}
          autosize
          minRows={2}
          maxRows={4}
          placeholder={puedeEditar ? 'De qué se trata el proyecto.' : 'Sin descripción.'}
        />
        <Textarea
          label='Instrucciones para los asistentes'
          description='Las leen en cada respuesta, en todas las conversaciones del proyecto.'
          value={instrucciones}
          onChange={(e) => setInstrucciones(e.currentTarget.value)}
          readOnly={!puedeEditar}
          maxLength={MAX_PROJECT_INSTRUCTIONS_CHARS}
          autosize
          minRows={4}
          maxRows={14}
          placeholder={puedeEditar ? 'Qué papel cumplen los asistentes aquí y de qué temas se ocupan.' : 'Sin instrucciones.'}
        />
        <Group gap={6} wrap='wrap'>
          <Text size='xs' c='dimmed'>
            Empresa: {proyecto.company.companyName} ·{' '}
            {proyecto.agents.length === 0 && proyecto.conversationCount === 0
              ? 'Conectores: se escogen al agregar el primer asistente'
              : `Conectores: ${proyecto.profile.label} (fijos desde la creación)`}
          </Text>
        </Group>
        {puedeEditar && (
          <Group justify='flex-end'>
            <Button onClick={() => onGuardar({ name: nombre, description: descripcion, instructions: instrucciones })} loading={guardando} disabled={!cambio || !nombre.trim()}>
              Guardar cambios
            </Button>
          </Group>
        )}
      </Stack>

      <Stack gap={8}>
        <Group justify='space-between' wrap='nowrap'>
          <Text fw={600}>Asistentes</Text>
          {proyecto.capabilities.manageAgents && !proyecto.archived && (
            <Button size='xs' variant='light' leftSection={<IconPlus size={16} />} onClick={onDesignar} data-testid='proyecto-designar'>
              Agregar asistente
            </Button>
          )}
        </Group>
        {proyecto.agents.length === 0 && (
          <Text size='sm' c='dimmed' data-testid='proyecto-sin-asistentes'>
            Este proyecto no tiene asistentes: es de las personas. Puede agregar uno o varios cuando los necesite.
          </Text>
        )}
        {proyecto.agents.map((a) => (
          <Group key={a.code} gap='sm' wrap='nowrap' className={css.fila} style={{ border: '1px solid var(--mantine-color-default-border)' }}>
            <AgentAvatar code={a.code} displayName={a.displayName} avatarUrl={a.avatarUrl} avatarVersion={a.avatarVersion} size={34} showStatus={false} withTooltip={false} />
            <div className={css.item} style={{ flex: 1 }}>
              <Text size='sm' fw={600} className={css.truncar}>
                {a.displayName}
              </Text>
              <Text size='xs' c={a.puedoEscribir ? 'dimmed' : 'orange'} className={css.truncar}>
                {a.puedoEscribir ? a.handle ?? 'Disponible' : a.motivo ?? 'Solo lectura'}
              </Text>
            </div>
            {proyecto.capabilities.manageAgents && !proyecto.archived && (
              <Tooltip label='Retirar del proyecto' withArrow>
                <ActionIcon variant='subtle' color='red' aria-label={`Retirar a ${a.displayName}`} onClick={() => onRetirarAgente(a.code)}>
                  <IconTrash size={18} />
                </ActionIcon>
              </Tooltip>
            )}
          </Group>
        ))}
      </Stack>

      {proyecto.capabilities.archive && (
        <Card withBorder radius='md' p='sm'>
          {proyecto.archived ? (
            <Group justify='space-between' wrap='wrap' gap='xs'>
              <Text size='sm' style={{ flex: '1 1 220px' }}>
                El proyecto está archivado: solo usted lo ve. Restáurelo para que los miembros vuelvan a entrar.
              </Text>
              <Button variant='light' leftSection={<IconArchiveOff size={18} />} onClick={onRestaurar}>
                Restaurar
              </Button>
            </Group>
          ) : (
            <Group justify='space-between' wrap='wrap' gap='xs'>
              <Text size='sm' style={{ flex: '1 1 220px' }}>
                Archivar cierra el proyecto para los miembros y los asistentes. No se borra nada.
              </Text>
              <Button variant='subtle' color='red' leftSection={<IconArchive size={18} />} onClick={onArchivar} data-testid='proyecto-archivar'>
                Archivar
              </Button>
            </Group>
          )}
        </Card>
      )}
    </Stack>
  );
}
