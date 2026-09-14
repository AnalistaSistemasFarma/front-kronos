'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Alert,
  Badge,
  Box,
  Card,
  Center,
  Group,
  Loader,
  SimpleGrid,
  Stack,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';
import { IconAlertCircle, IconArrowLeft, IconHierarchy2, IconLock } from '@tabler/icons-react';
import AgentAvatar from '../../../../../components/chat/AgentAvatar';
import { EsqueletoListaAgentes } from '../../../../../components/chat/ChatSkeletons';

/**
 * ORGANIGRAMA DE LA FLOTA, dentro de SynerLink.
 *
 * Pedido de Nicolás (2026-09-08). Ya existía como imagen, pero una imagen queda
 * vieja el día que se siembra un agente: esta pantalla se arma con lo que hay en
 * la base cada vez que se abre, así que un agente nuevo aparece solo.
 *
 * La agrupación es POR EMPRESA a propósito, no por operador ni por máquina: la
 * empresa es lo que de verdad manda en el permiso del chat, y verlo agrupado
 * así es lo que permite detectar el error más común —un agente asignado en la
 * empresa equivocada— de un vistazo.
 *
 * Solo administradores: muestra TODOS los agentes y quién opera cada uno,
 * incluidos los que quien mira no tiene permiso de usar. La reja está en el
 * endpoint; aquí solo se pinta el mensaje.
 */

type Operador = { name: string | null; email: string; company: string };

type AgenteOrg = {
  idAgent: number;
  code: string;
  displayName: string;
  handle: string | null;
  avatarUrl: string | null;
  isOrchestrator: boolean;
  company: { idCompany: number; companyName: string } | null;
  operators: Operador[];
};

/** Una tarjeta de agente, con sus operadores. */
function TarjetaAgente({ agente }: { agente: AgenteOrg }) {
  return (
    <Card withBorder radius='md' padding='sm' className='chat-surface'>
      <Group gap='sm' wrap='nowrap' align='flex-start'>
        <AgentAvatar
          code={agente.code}
          displayName={agente.displayName}
          avatarUrl={agente.avatarUrl}
          size={38}
          showStatus={false}
          withTooltip={false}
        />
        <Box style={{ minWidth: 0, flex: 1 }}>
          <Text fw={700} size='sm' lineClamp={1}>
            {agente.displayName}
          </Text>
          {agente.handle && (
            <Text size='xs' c='dimmed' lineClamp={1}>
              {agente.handle}
            </Text>
          )}

          {agente.operators.length === 0 ? (
            /* Un agente sin operador no es un detalle cosmético: nadie puede
               hablarle salvo los administradores. Se marca. */
            <Badge color='orange' variant='light' size='xs' mt={8}>
              sin operador asignado
            </Badge>
          ) : (
            <Text size='xs' mt={8} style={{ lineHeight: 1.5 }}>
              {agente.operators.map((o, i) => (
                <span key={o.email}>
                  {i > 0 && <Text span c='dimmed'> · </Text>}
                  <Tooltip label={o.email} withArrow>
                    <Text span fw={i === 0 ? 600 : 400}>
                      {o.name?.trim() || o.email}
                    </Text>
                  </Tooltip>
                </span>
              ))}
            </Text>
          )}
        </Box>
      </Group>
    </Card>
  );
}

export default function OrganigramaAgentesPage() {
  const [agentes, setAgentes] = useState<AgenteOrg[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sinPermiso, setSinPermiso] = useState(false);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const res = await fetch('/api/chat/organigrama');
        if (res.status === 403) {
          if (vivo) setSinPermiso(true);
          return;
        }
        if (!res.ok) {
          if (vivo) setError('No se pudo cargar el organigrama.');
          return;
        }
        const datos = await res.json();
        if (vivo) setAgentes(datos.agents ?? []);
      } catch {
        if (vivo) setError('No se pudo cargar el organigrama.');
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  if (sinPermiso) {
    return (
      <div className='app-page-shell app-page-shell--fill min-h-screen'>
        <div className='max-w-3xl mx-auto py-10 px-4'>
          <Alert icon={<IconLock size={18} />} color='yellow' radius='lg' title='Sin acceso'>
            El organigrama de la flota está reservado a los administradores.
          </Alert>
        </div>
      </div>
    );
  }

  const orquestador = agentes?.find((a) => a.isOrchestrator) ?? null;
  const resto = (agentes ?? []).filter((a) => !a.isOrchestrator);

  // Agrupación por empresa, conservando el orden en que vienen los agentes
  // (sort_order), para que la vista no baile entre recargas.
  const porEmpresa = new Map<string, AgenteOrg[]>();
  for (const a of resto) {
    const clave = a.company?.companyName ?? 'Sin empresa asignada';
    if (!porEmpresa.has(clave)) porEmpresa.set(clave, []);
    porEmpresa.get(clave)!.push(a);
  }
  const empresas = [...porEmpresa.entries()].sort(
    (x, y) => y[1].length - x[1].length || x[0].localeCompare(y[0], 'es')
  );

  return (
    <div className='app-page-shell app-page-shell--fill ios-process-hub min-h-screen'>
      <div className='max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8'>
        <Group gap='xs' mb={4}>
          <Link href='/process/chat' className='chat-text-muted' style={{ fontSize: 13 }}>
            <Group gap={4} wrap='nowrap'>
              <IconArrowLeft size={14} />
              <span>Volver a Chat</span>
            </Group>
          </Link>
        </Group>

        <Group gap='sm' mb={2} wrap='nowrap'>
          <IconHierarchy2 size={26} className='chat-folder__icon' />
          <Title order={1} className='ios-process-hub__title text-3xl'>
            Organigrama de la flota
          </Title>
        </Group>
        <Text className='ios-process-hub__subtitle' mb='lg'>
          Los asistentes agrupados por empresa, con quién opera cada uno. Se arma con los datos de
          SynerLink en el momento de abrirlo: un asistente nuevo aparece aquí solo.
        </Text>

        {error && (
          <Alert color='red' radius='md' icon={<IconAlertCircle size={18} />} mb='md'>
            {error}
          </Alert>
        )}

        {!agentes && !error && <EsqueletoListaAgentes filas={6} />}

        {agentes && (
          <Stack gap='xl'>
            {orquestador && (
              <div>
                <Text fw={600} size='sm' mb={6}>
                  Orquestador
                </Text>
                <Card
                  withBorder
                  radius='md'
                  padding='md'
                  style={{
                    background: 'var(--mantine-primary-color-light)',
                    borderColor: 'var(--mantine-primary-color-filled)',
                  }}
                >
                  <Group gap='md' wrap='nowrap'>
                    <AgentAvatar
                      code={orquestador.code}
                      displayName={orquestador.displayName}
                      avatarUrl={orquestador.avatarUrl}
                      size={52}
                      showStatus={false}
                      withTooltip={false}
                    />
                    <Box>
                      <Text fw={700} size='lg'>
                        {orquestador.displayName}
                      </Text>
                      <Text size='xs' c='dimmed'>
                        {orquestador.handle} · {orquestador.company?.companyName}
                      </Text>
                      <Text size='xs' mt={6}>
                        Coordina la flota y opera la plataforma. Administra:{' '}
                        {orquestador.operators.map((o) => o.name?.trim() || o.email).join(' · ') ||
                          '—'}
                      </Text>
                    </Box>
                  </Group>
                </Card>
              </div>
            )}

            {empresas.map(([empresa, lista]) => (
              <div key={empresa}>
                <Group gap='xs' mb={8} wrap='nowrap'>
                  <Text fw={600} size='sm'>
                    {empresa}
                  </Text>
                  <Badge variant='light' color='gray' size='sm'>
                    {lista.length} {lista.length === 1 ? 'asistente' : 'asistentes'}
                  </Badge>
                </Group>
                <SimpleGrid cols={{ base: 1, xs: 2, md: 3, lg: 4 }} spacing='sm'>
                  {lista.map((a) => (
                    <TarjetaAgente key={a.idAgent} agente={a} />
                  ))}
                </SimpleGrid>
              </div>
            ))}

            <Text size='xs' c='dimmed'>
              {agentes.length} asistentes activos en {empresas.length}{' '}
              {empresas.length === 1 ? 'empresa' : 'empresas'}. Los bots de la flota que todavía no
              están en SynerLink no aparecen aquí: no existen en esta base.
            </Text>
          </Stack>
        )}
      </div>
    </div>
  );
}
