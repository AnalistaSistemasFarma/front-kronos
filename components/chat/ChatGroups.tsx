'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useMediaQuery } from '@mantine/hooks';
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Center,
  Grid,
  Group,
  Loader,
  Stack,
  Text,
  Title,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconArrowLeft,
  IconMessage2,
  IconPlus,
  IconUsersGroup,
} from '@tabler/icons-react';
import AgentAvatar from './AgentAvatar';
import ChatGroupModal from './ChatGroupModal';
import ChatThread from './ChatThread';
import { useChatOverview } from './useChatOverview';
import {
  formatChatTime,
  toPlainPreview,
  type ChatConversationDto,
} from '../../lib/chat/client';

/**
 * GRUPOS del chat — /process/chat/grupos.
 *
 * Pantalla APARTE de /process/chat a propósito. La página de chats está armada
 * alrededor de "escoger un agente" (carpetas por empresa, un hilo por agente) y
 * meter los grupos ahí obligaba a rehacer ese armado completo. Un grupo no es
 * un agente: no tiene empresa por agente ni un hilo por agente, y su lista se
 * ordena por actividad, no por carpeta.
 *
 * Separarlas mantiene la promesa de esta tanda: **el chat directo no se toca**.
 * Si los grupos fallan, la pantalla que usan las catorce personas todos los
 * días sigue exactamente igual.
 */

function GroupCard({
  grupo,
  seleccionado,
  onSelect,
}: {
  grupo: ChatConversationDto;
  seleccionado: boolean;
  onSelect: () => void;
}) {
  const agentes = (grupo.participants ?? []).filter((p) => p.kind === 'agent');
  const personas = (grupo.participants ?? []).filter((p) => p.kind === 'user');
  const trabajando = (grupo.agentStatuses ?? []).filter((s) => s.state !== 'idle');

  return (
    <UnstyledButton
      onClick={onSelect}
      className={[
        'chat-agent-card',
        'chat-agent-card--compact',
        seleccionado ? 'chat-agent-card--selected' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-label={`Abrir el grupo ${grupo.title ?? ''}`}
    >
      <Group gap='sm' wrap='nowrap' align='flex-start'>
        <Box style={{ flexShrink: 0, position: 'relative' }}>
          <IconUsersGroup size={34} className='chat-empty__icon' />
          {grupo.unreadCount > 0 && (
            <Badge size='xs' circle className='chat-grupo__contador'>
              {grupo.unreadCount}
            </Badge>
          )}
        </Box>

        <Box style={{ flex: 1, minWidth: 0 }}>
          <Group gap={6} wrap='nowrap' justify='space-between'>
            <Text size='sm' fw={600} lineClamp={1}>
              {grupo.title ?? 'Grupo'}
            </Text>
            {grupo.lastMessageAt && (
              <Text size='xs' className='chat-text-muted' style={{ flexShrink: 0 }}>
                {formatChatTime(grupo.lastMessageAt)}
              </Text>
            )}
          </Group>

          <Text size='xs' className='chat-text-muted' lineClamp={1}>
            {grupo.company?.companyName ?? 'Sin empresa'} · {personas.length}{' '}
            {personas.length === 1 ? 'persona' : 'personas'} · {agentes.length}{' '}
            {agentes.length === 1 ? 'asistente' : 'asistentes'}
          </Text>

          {trabajando.length > 0 ? (
            <Text size='xs' c='blue' lineClamp={1}>
              {trabajando.length === 1
                ? `${trabajando[0].agentName ?? 'Un asistente'} está trabajando…`
                : `${trabajando.length} asistentes trabajando…`}
            </Text>
          ) : (
            grupo.lastMessage && (
              <Text size='xs' className='chat-text-muted' lineClamp={1}>
                {toPlainPreview(grupo.lastMessage.preview)}
              </Text>
            )
          )}
        </Box>
      </Group>
    </UnstyledButton>
  );
}

export default function ChatGroups({ initialGroupId }: { initialGroupId?: number }) {
  const router = useRouter();
  const { data: session } = useSession();
  const overview = useChatOverview();
  const enPantallaAngosta = useMediaQuery('(max-width: 992px)');

  const [seleccionado, setSeleccionado] = useState<number | null>(initialGroupId ?? null);
  const [modalAbierto, setModalAbierto] = useState(false);

  // El id del usuario de la sesión: en un grupo es lo que distingue MIS
  // mensajes de los de las otras personas (sin él, TODO se pintaría como
  // ajeno, alineado a la izquierda). Sale de `session.user.id`, que el callback
  // de NextAuth llena con `token.sub` (app/api/auth/[...nextauth]/route.ts).
  const miId = session?.user?.id;

  const grupos = useMemo(() => overview.groups, [overview.groups]);

  const grupoActual = useMemo(
    () => grupos.find((g) => g.id === seleccionado) ?? null,
    [grupos, seleccionado]
  );

  // Al llegar por enlace directo (una notificación) el grupo todavía no está en
  // la lista mientras carga. Cuando llega, se refleja en el título.
  useEffect(() => {
    if (initialGroupId) setSeleccionado(initialGroupId);
  }, [initialGroupId]);

  const abrir = (id: number) => {
    setSeleccionado(id);
    router.replace(`/process/chat/grupo/${id}`, { scroll: false });
  };

  if (!overview.ready) {
    return (
      <div className='app-page-shell app-page-shell--fill min-h-screen'>
        <Center py='xl'>
          <Loader size='sm' />
        </Center>
      </div>
    );
  }

  if (!overview.canUseChat) {
    return (
      <div className='app-page-shell app-page-shell--fill min-h-screen'>
        <Alert color='orange' icon={<IconAlertCircle size={18} />} radius='md'>
          <Text size='sm'>No tiene habilitado el módulo de Asistentes IA.</Text>
        </Alert>
      </div>
    );
  }

  // En pantalla angosta: maestro-detalle. Con un grupo abierto se muestra solo
  // la conversación (si no, quedaría debajo de la lista, fuera de la vista).
  const soloConversacion = Boolean(enPantallaAngosta && grupoActual);

  const lista = (
    <Stack gap='xs'>
      <Group justify='space-between' align='center'>
        <Group gap={8}>
          <IconUsersGroup size={20} />
          <Title order={4}>Grupos</Title>
          {overview.groupUnread > 0 && (
            <Badge size='sm' color='red'>
              {overview.groupUnread}
            </Badge>
          )}
        </Group>

        {overview.canCreateGroups && (
          <Tooltip label='Crear un grupo' withArrow>
            <Button
              size='xs'
              leftSection={<IconPlus size={14} />}
              onClick={() => setModalAbierto(true)}
            >
              Nuevo
            </Button>
          </Tooltip>
        )}
      </Group>

      {grupos.length === 0 ? (
        <Alert color='blue' icon={<IconMessage2 size={16} />} radius='md' py={8}>
          <Text size='xs'>
            Todavía no está en ningún grupo.
            {overview.canCreateGroups
              ? ' Cree uno con el botón de arriba.'
              : ' Un administrador puede crear uno y agregarlo.'}
          </Text>
        </Alert>
      ) : (
        grupos.map((g) => (
          <GroupCard
            key={g.id}
            grupo={g}
            seleccionado={g.id === seleccionado}
            onSelect={() => abrir(g.id)}
          />
        ))
      )}
    </Stack>
  );

  return (
    <div className='app-page-shell app-page-shell--fill min-h-screen'>
      <Group justify='space-between' align='center' mb='sm'>
        <Group gap={8}>
          {soloConversacion ? (
            <Tooltip label='Volver a los grupos' withArrow>
              <ActionIcon
                variant='subtle'
                onClick={() => {
                  setSeleccionado(null);
                  router.replace('/process/chat/grupos', { scroll: false });
                }}
                aria-label='Volver a los grupos'
              >
                <IconArrowLeft size={18} />
              </ActionIcon>
            </Tooltip>
          ) : (
            <Tooltip label='Volver a los asistentes' withArrow>
              <ActionIcon component={Link} href='/process/chat' variant='subtle' aria-label='Volver a los asistentes'>
                <IconArrowLeft size={18} />
              </ActionIcon>
            </Tooltip>
          )}
          <Text fw={600}>{soloConversacion ? grupoActual?.title : 'Asistentes IA'}</Text>
        </Group>
      </Group>

      {soloConversacion && grupoActual ? (
        <Box className='chat-page-thread'>
          <ChatThread
            group={{
              idConversation: grupoActual.id,
              title: grupoActual.title ?? 'Grupo',
              participants: grupoActual.participants,
            }}
            currentUserId={miId}
          />
        </Box>
      ) : (
        <Grid gutter='md'>
          <Grid.Col span={{ base: 12, lg: 4 }}>{lista}</Grid.Col>
          <Grid.Col span={{ base: 12, lg: 8 }}>
            {grupoActual ? (
              <Box className='chat-page-thread'>
                <ChatThread
                  group={{
                    idConversation: grupoActual.id,
                    title: grupoActual.title ?? 'Grupo',
                    participants: grupoActual.participants,
                  }}
                  currentUserId={miId}
                />
              </Box>
            ) : (
              <Center py='xl'>
                <Stack align='center' gap={6}>
                  <IconUsersGroup size={30} className='chat-empty__icon' />
                  <Text size='sm' fw={600}>
                    Escoja un grupo
                  </Text>
                  <Text size='xs' className='chat-text-muted' ta='center' maw={320}>
                    En un grupo conviven personas y asistentes. Los asistentes responden solo
                    cuando se los menciona con <code>@</code>.
                  </Text>
                </Stack>
              </Center>
            )}
          </Grid.Col>
        </Grid>
      )}

      {overview.canCreateGroups && (
        <ChatGroupModal
          abierto={modalAbierto}
          onCerrar={() => setModalAbierto(false)}
          companies={overview.agents.flatMap((a) => a.companies).filter(
            // Empresas sin repetir: un agente puede estar en varias y varios
            // agentes comparten empresa.
            (c, i, arr) => arr.findIndex((x) => x.idCompany === c.idCompany) === i
          )}
          onCreado={(grupo) => {
            setModalAbierto(false);
            overview.refresh();
            abrir(grupo.id);
          }}
        />
      )}
    </div>
  );
}
