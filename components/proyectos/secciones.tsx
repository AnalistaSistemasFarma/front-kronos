'use client';

import { useEffect, useState } from 'react';
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
import { formatBytes } from '../../lib/chat/attachments';
import {
  MAX_PROJECT_DESCRIPTION_CHARS,
  MAX_PROJECT_INSTRUCTIONS_CHARS,
  MAX_PROJECT_NAME_CHARS,
  PROJECT_ROLE_LABELS,
  type ProjectRole,
} from '../../lib/chat/projects-rules';
import type { ProyectoDetalleDto } from '../../lib/proyectos/tipos';
import { fechaCorta } from './api';
import { BadgeRol } from './ui';
import css from './proyectos.module.css';

/* ───────────────────────────── Conversaciones ───────────────────────────── */

export function ListaConversaciones({
  proyecto,
  activa,
  onAbrir,
  onNueva,
}: {
  proyecto: ProyectoDetalleDto;
  activa: number | null;
  onAbrir: (id: number) => void;
  onNueva: () => void;
}) {
  const puedeAbrir = proyecto.capabilities.write && proyecto.agents.some((a) => a.puedoEscribir);
  return (
    <Stack gap={6}>
      {proyecto.capabilities.write && (
        <Tooltip label='No tiene asignado ninguno de los asistentes del proyecto.' disabled={puedeAbrir} withArrow>
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
        proyecto.conversations.map((c) => (
          <UnstyledButton
            key={c.id}
            onClick={() => onAbrir(c.id)}
            className={`${css.fila} ${css.filaBoton} ${c.id === activa ? css.filaActiva : ''}`}
            aria-current={c.id === activa ? 'true' : undefined}
            data-testid='proyecto-conversacion'
          >
            <AgentAvatar code={c.agent.code} displayName={c.agent.displayName} avatarUrl={c.agent.avatarUrl} avatarVersion={c.agent.avatarVersion} size={34} showStatus={false} withTooltip={false} />
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
            </div>
          </UnstyledButton>
        ))
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

export function SeccionArchivos({
  proyecto,
  subiendo,
  onSubir,
  onQuitar,
}: {
  proyecto: ProyectoDetalleDto;
  subiendo: boolean;
  onSubir: (archivos: File[]) => void;
  onQuitar: (id: number) => void;
}) {
  return (
    <Stack gap={8}>
      <Group justify='space-between' wrap='wrap' gap='xs'>
        <Text size='xs' c='dimmed' style={{ flex: '1 1 220px' }}>
          Base de conocimiento del proyecto: los asistentes los leen en todas sus conversaciones.
        </Text>
        {proyecto.capabilities.contribute && (
          <FileButton onChange={(f) => onSubir(f ?? [])} multiple>
            {(props) => (
              <Button {...props} variant='light' leftSection={<IconFileUpload size={18} />} loading={subiendo} data-testid='proyecto-subir-archivos'>
                Cargar archivos
              </Button>
            )}
          </FileButton>
        )}
      </Group>
      {proyecto.files.length === 0 ? (
        <Vacio icono={<IconFile size={18} />} titulo='El proyecto no tiene archivos' texto='Cargue manuales, plantillas o listas de precios que los asistentes deban conocer.' />
      ) : (
        proyecto.files.map((f) => (
          <Group key={f.id} gap='sm' wrap='nowrap' className={css.fila} style={{ border: '1px solid var(--mantine-color-default-border)' }}>
            <ThemeIcon variant='light' size={34} radius='md' style={{ flexShrink: 0 }}>
              <IconFile size={18} />
            </ThemeIcon>
            <div className={css.item} style={{ flex: 1 }}>
              <Anchor href={f.downloadUrl} size='sm' className={css.truncar} style={{ display: 'block' }}>
                {f.fileName}
              </Anchor>
              <Text size='xs' c='dimmed' className={css.truncar}>
                {f.sizeBytes !== null ? `${formatBytes(f.sizeBytes)} · ` : ''}
                {fechaCorta(f.createdAt)}
                {f.uploadedBy ? ` · ${f.uploadedBy.name}` : ''}
              </Text>
            </div>
            {f.puedoQuitar && (
              <Tooltip label='Quitar del proyecto' withArrow>
                <ActionIcon variant='subtle' color='red' aria-label={`Quitar ${f.fileName}`} onClick={() => onQuitar(f.id)}>
                  <IconTrash size={18} />
                </ActionIcon>
              </Tooltip>
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
            Empresa: {proyecto.company.companyName} · Conectores: {proyecto.profile.label} (fijos desde la creación)
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
            {proyecto.capabilities.manageAgents && !proyecto.archived && proyecto.agents.length > 1 && (
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
