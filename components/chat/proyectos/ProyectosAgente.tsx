'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import {
  Alert,
  Badge,
  Box,
  Button,
  Center,
  Group,
  SimpleGrid,
  Skeleton,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconArrowLeft,
  IconFolder,
  IconFolderPlus,
  IconFolders,
  IconLock,
  IconMessages,
  IconUsers,
} from '@tabler/icons-react';
import AgentAvatar from '../AgentAvatar';
import { chatFetch, formatChatTime, type ChatProjectListDto } from '../../../lib/chat/client';

const ProyectoNuevoModal = dynamic(() => import('./ProyectoNuevoModal'), { ssr: false });

/**
 * PROYECTOS DE UN ASISTENTE — /process/chat/proyectos/<code>. Piloto F1.
 *
 * Mismo marco que las demás páginas del chat (Organigrama, Auditoría):
 * `app-page-shell` + `ios-process-hub`, enlace de regreso, título con ícono
 * y tarjetas `chat-agent-card`. El permiso lo decide el servidor: si el
 * asistente no tiene proyectos o la persona no lo ve, la ruta responde 404 y
 * aquí solo se pinta el aviso.
 */

/** Rejilla de tarjetas mientras llega la lista. */
function EsqueletoProyectos() {
  return (
    <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing='md' aria-hidden='true'>
      {Array.from({ length: 3 }, (_, i) => (
        <Box key={i} className='chat-agent-card'>
          <Group gap='sm' wrap='nowrap' align='flex-start'>
            <Skeleton height={36} width={36} radius='md' />
            <Stack gap={6} style={{ flex: 1 }}>
              <Skeleton height={12} width='60%' radius='sm' />
              <Skeleton height={9} width='40%' radius='sm' />
              <Skeleton height={9} width='75%' radius='sm' />
            </Stack>
          </Group>
        </Box>
      ))}
    </SimpleGrid>
  );
}

export default function ProyectosAgente({ code }: { code: string }) {
  const router = useRouter();
  const [datos, setDatos] = useState<ChatProjectListDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sinAcceso, setSinAcceso] = useState(false);
  const [nuevoAbierto, setNuevoAbierto] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const res = await chatFetch(`/api/chat/projects?agent=${encodeURIComponent(code)}`);
      if (res.status === 404) {
        setSinAcceso(true);
        return;
      }
      if (!res.ok) {
        setError('No se pudieron cargar los proyectos.');
        return;
      }
      setDatos((await res.json()) as ChatProjectListDto);
      setError(null);
    } catch {
      setError('No se pudieron cargar los proyectos.');
    }
  }, [code]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const volver = (
    <Group gap='xs' mb={4}>
      <Link href={`/process/chat/${encodeURIComponent(code)}`} className='chat-text-muted' style={{ fontSize: 13 }}>
        <Group gap={4} wrap='nowrap'>
          <IconArrowLeft size={14} />
          <span>Volver al chat{datos ? ` con ${datos.agent.displayName}` : ''}</span>
        </Group>
      </Link>
    </Group>
  );

  if (sinAcceso) {
    return (
      <div className='app-page-shell app-page-shell--fill min-h-screen'>
        <div className='max-w-3xl mx-auto py-10 px-4'>
          {volver}
          <Alert icon={<IconLock size={18} />} color='yellow' radius='lg' title='Sin proyectos'>
            Este asistente no tiene proyectos habilitados, o usted no lo tiene asignado.
          </Alert>
        </div>
      </div>
    );
  }

  return (
    <div className='app-page-shell app-page-shell--fill ios-process-hub min-h-screen'>
      <div className='max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8'>
        {volver}

        <Group justify='space-between' align='flex-start' mb='lg' gap='sm'>
          <Box style={{ minWidth: 0, flex: 1 }}>
            <Group gap='sm' mb={2} wrap='nowrap'>
              <IconFolders size={26} className='chat-folder__icon' style={{ flexShrink: 0 }} />
              <Title order={1} className='ios-process-hub__title text-3xl'>
                {datos ? `Proyectos de ${datos.agent.displayName}` : 'Proyectos'}
              </Title>
            </Group>
            <Text className='ios-process-hub__subtitle'>
              Cada proyecto es un espacio aparte por empresa o tema, con sus instrucciones, sus
              archivos y sus miembros. El asistente no mezcla lo que se habla en un proyecto con lo
              de los demás.
            </Text>
          </Box>
          {datos && (
            <Button leftSection={<IconFolderPlus size={16} />} onClick={() => setNuevoAbierto(true)}>
              Nuevo proyecto
            </Button>
          )}
        </Group>

        {error && (
          <Alert color='red' radius='md' icon={<IconAlertCircle size={18} />} mb='md'>
            {error}
          </Alert>
        )}

        {!datos && !error && <EsqueletoProyectos />}

        {datos && datos.projects.length === 0 && (
          <Center py='xl'>
            <Stack align='center' gap={6}>
              <IconFolder size={30} className='chat-empty__icon' />
              <Text size='sm' fw={600}>
                Todavía no tiene proyectos con {datos.agent.displayName}
              </Text>
              <Text size='xs' ta='center' className='chat-text-muted' maw={360}>
                Cree uno por cada empresa o tema (Farmalógica, One Latam Pharma, Comex Latam…) para
                que el asistente trabaje cada uno por separado.
              </Text>
            </Stack>
          </Center>
        )}

        {datos && datos.projects.length > 0 && (
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing='md'>
            {datos.projects.map((p) => (
              <Link
                key={p.idProject}
                href={`/process/chat/proyecto/${p.idProject}`}
                className='chat-agent-card'
                style={{ textDecoration: 'none' }}
              >
                <Group gap='sm' wrap='nowrap' align='flex-start'>
                  <AgentAvatar
                    code={datos.agent.code}
                    displayName={datos.agent.displayName}
                    avatarUrl={datos.agent.avatarUrl}
                    avatarVersion={datos.agent.avatarVersion}
                    size={36}
                    showStatus={false}
                    withTooltip={false}
                  />
                  <Box style={{ minWidth: 0, flex: 1 }}>
                    <Text fw={700} size='sm' lineClamp={1}>
                      {p.name}
                    </Text>
                    <Text size='xs' className='chat-text-muted' lineClamp={1}>
                      {p.company.companyName}
                    </Text>
                    <Group gap={6} mt={8} wrap='wrap'>
                      <Badge size='xs' variant='light'>
                        {p.profile.label}
                      </Badge>
                      {p.myRole === 'owner' && (
                        <Badge size='xs' variant='light' color='grape'>
                          Dueño
                        </Badge>
                      )}
                      <Group gap={3} wrap='nowrap'>
                        <IconUsers size={12} className='chat-text-muted' />
                        <Text size='xs' className='chat-text-muted'>
                          {p.memberCount}
                        </Text>
                      </Group>
                      <Group gap={3} wrap='nowrap'>
                        <IconMessages size={12} className='chat-text-muted' />
                        <Text size='xs' className='chat-text-muted'>
                          {p.conversationCount}
                        </Text>
                      </Group>
                      <Text size='xs' className='chat-text-muted'>
                        · {formatChatTime(p.updatedAt)}
                      </Text>
                    </Group>
                  </Box>
                </Group>
              </Link>
            ))}
          </SimpleGrid>
        )}

        {datos && nuevoAbierto && (
          <ProyectoNuevoModal
            abierto={nuevoAbierto}
            onCerrar={() => setNuevoAbierto(false)}
            datos={datos}
            onCreado={({ idProject, idConversation }) => {
              setNuevoAbierto(false);
              router.push(`/process/chat/proyecto/${idProject}?conversacion=${idConversation}`);
            }}
          />
        )}
      </div>
    </div>
  );
}
