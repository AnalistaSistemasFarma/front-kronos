'use client';

import { useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Box,
  Button,
  Checkbox,
  Group,
  Modal,
  ScrollArea,
  Select,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { IconAlertCircle, IconInfoCircle, IconUsersGroup } from '@tabler/icons-react';
import AgentAvatar from './AgentAvatar';
import { EsqueletoListaAgentes } from './ChatSkeletons';
import {
  chatFetch,
  chatGetJson,
  type ChatAgentCompanyDto,
  type ChatConversationDto,
} from '../../lib/chat/client';

/**
 * Cuadro para CREAR UN GRUPO: nombre, empresa, asistentes y personas.
 *
 * Pedido de Nicolás (2026-09-08). Solo administradores; la reja de verdad está
 * en POST /api/chat/groups, esto es únicamente el formulario.
 *
 * -------------------------------------------------------------------------
 * POR QUÉ LA LISTA DE PERSONAS VIENE DEL SERVIDOR Y NO ES "TODOS LOS USUARIOS"
 * -------------------------------------------------------------------------
 * Se piden a /api/chat/groups/candidates, que devuelve solo a quienes tienen el
 * chat habilitado EN ESA EMPRESA. Ofrecer la lista completa de usuarios
 * llevaría al peor error de este módulo: un grupo donde alguien figura como
 * integrante y nunca le llega nada, porque no tiene el módulo. Eso se descubre
 * días después y por queja. Aquí, si no aparece en la lista, es que hay que
 * habilitarle el chat primero.
 */

type Candidatos = {
  company: { idCompany: number; companyName: string } | null;
  users: { id: string; name: string; email: string; avatarUrl: string | null; isSelf: boolean }[];
  agents: {
    idAgent: number;
    code: string;
    displayName: string;
    handle: string | null;
    avatarUrl: string | null;
  }[];
};

export default function ChatGroupModal({
  abierto,
  onCerrar,
  companies,
  onCreado,
}: {
  abierto: boolean;
  onCerrar: () => void;
  /** Empresas donde el usuario tiene el módulo (de /api/chat/access). */
  companies: ChatAgentCompanyDto[];
  /** Se llama con el grupo recién creado, para navegar hacia él. */
  onCreado: (grupo: ChatConversationDto) => void;
}) {
  const [nombre, setNombre] = useState('');
  const [idCompany, setIdCompany] = useState<string | null>(
    companies.length === 1 ? String(companies[0].idCompany) : null
  );
  const [candidatos, setCandidatos] = useState<Candidatos | null>(null);
  const [cargando, setCargando] = useState(false);
  const [agentesElegidos, setAgentesElegidos] = useState<number[]>([]);
  const [personasElegidas, setPersonasElegidas] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  // Al cambiar de empresa se vuelve a pedir la lista Y SE LIMPIA LA SELECCIÓN:
  // un agente o una persona de la empresa anterior no es válido en la nueva, y
  // dejarlos marcados terminaría en un 403 al guardar sin que se entienda por
  // qué.
  useEffect(() => {
    setAgentesElegidos([]);
    setPersonasElegidas([]);
    setCandidatos(null);
    setError(null);

    if (!abierto || !idCompany) return;

    let cancelado = false;
    setCargando(true);
    void (async () => {
      const data = await chatGetJson<Candidatos>(
        `/api/chat/groups/candidates?idCompany=${encodeURIComponent(idCompany)}`
      );
      if (cancelado) return;
      if (!data) setError('No se pudo cargar quién puede entrar al grupo.');
      setCandidatos(data ?? null);
      setCargando(false);
    })();

    return () => {
      cancelado = true;
    };
  }, [abierto, idCompany]);

  const alternar = <T,>(lista: T[], valor: T): T[] =>
    lista.includes(valor) ? lista.filter((x) => x !== valor) : [...lista, valor];

  const crear = async () => {
    setError(null);

    if (nombre.trim() === '') {
      setError('Póngale un nombre al grupo.');
      return;
    }
    if (!idCompany) {
      setError('Escoja la empresa del grupo.');
      return;
    }
    if (agentesElegidos.length === 0) {
      setError('Escoja al menos un asistente.');
      return;
    }

    setGuardando(true);
    try {
      const res = await chatFetch('/api/chat/groups', {
        method: 'POST',
        body: JSON.stringify({
          title: nombre.trim(),
          idCompany: Number(idCompany),
          idAgents: agentesElegidos,
          idUsers: personasElegidas,
        }),
      });

      const data = (await res.json().catch(() => null)) as
        | { conversation?: ChatConversationDto; error?: string }
        | null;

      if (!res.ok) {
        // El servidor devuelve el motivo con nombres propios cuando alguien no
        // tiene el chat habilitado: se muestra tal cual, es información útil.
        setError(data?.error ?? 'No se pudo crear el grupo.');
        return;
      }
      if (!data?.conversation) {
        setError('El grupo se creó, pero no se pudo abrir. Recargue la página.');
        return;
      }

      // Se limpia para la próxima vez que se abra el cuadro.
      setNombre('');
      setAgentesElegidos([]);
      setPersonasElegidas([]);
      onCreado(data.conversation);
    } catch {
      setError('No se pudo crear el grupo.');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal
      opened={abierto}
      onClose={onCerrar}
      title={
        <Group gap={8}>
          <IconUsersGroup size={18} />
          <Text fw={600}>Nuevo grupo</Text>
        </Group>
      }
      size='lg'
      radius='md'
      centered
    >
      <Stack gap='sm'>
        <TextInput
          label='Nombre del grupo'
          placeholder='Cierre de mes, Auditoría SGD, Compras…'
          value={nombre}
          onChange={(e) => setNombre(e.currentTarget.value)}
          maxLength={120}
          data-autofocus
        />

        <Select
          label='Empresa'
          description='El grupo pertenece a una sola empresa, igual que el permiso del chat.'
          placeholder='Escoja la empresa'
          data={companies.map((c) => ({
            value: String(c.idCompany),
            label: c.companyName,
          }))}
          value={idCompany}
          onChange={setIdCompany}
          allowDeselect={false}
        />

        {cargando && <EsqueletoListaAgentes filas={4} />}

        {candidatos && (
          <>
            <Box>
              <Text size='sm' fw={600} mb={4}>
                Asistentes
              </Text>
              <Text size='xs' className='chat-text-muted' mb={6}>
                Responden <b>solo cuando se los menciona</b> con <code>@</code>. Cada uno que entre
                al grupo puede despertarse con una mención, así que agregue los que hagan falta.
              </Text>
              {candidatos.agents.length === 0 ? (
                <Alert color='orange' icon={<IconAlertCircle size={16} />} py={6}>
                  <Text size='xs'>
                    No tiene asistentes disponibles en esa empresa. Escoja otra o pida el permiso.
                  </Text>
                </Alert>
              ) : (
                <ScrollArea.Autosize mah={170}>
                  <Stack gap={4}>
                    {candidatos.agents.map((a) => (
                      <Checkbox
                        key={a.idAgent}
                        checked={agentesElegidos.includes(a.idAgent)}
                        onChange={() => setAgentesElegidos((l) => alternar(l, a.idAgent))}
                        label={
                          <Group gap={8} wrap='nowrap'>
                            <AgentAvatar
                              code={a.code}
                              displayName={a.displayName}
                              avatarUrl={a.avatarUrl}
                              size={22}
                              showStatus={false}
                              withTooltip={false}
                            />
                            <Text size='sm'>{a.displayName}</Text>
                            {a.handle && (
                              <Text size='xs' className='chat-text-muted'>
                                {a.handle}
                              </Text>
                            )}
                          </Group>
                        }
                      />
                    ))}
                  </Stack>
                </ScrollArea.Autosize>
              )}
            </Box>

            <Box>
              <Group gap={6} mb={4}>
                <Text size='sm' fw={600}>
                  Personas
                </Text>
                <Badge size='xs' variant='light'>
                  usted entra siempre
                </Badge>
              </Group>
              <Text size='xs' className='chat-text-muted' mb={6}>
                Solo aparecen quienes tienen el chat habilitado en esa empresa. Si falta alguien,
                habilíteselo en Administración → Usuarios.
              </Text>
              <ScrollArea.Autosize mah={200}>
                <Stack gap={4}>
                  {candidatos.users
                    .filter((u) => !u.isSelf)
                    .map((u) => (
                      <Checkbox
                        key={u.id}
                        checked={personasElegidas.includes(u.id)}
                        onChange={() => setPersonasElegidas((l) => alternar(l, u.id))}
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
            </Box>
          </>
        )}

        <Alert color='blue' icon={<IconInfoCircle size={16} />} py={6}>
          <Text size='xs'>
            Los asistentes pueden pasarse el turno entre ellos mencionándose, pero con un tope de{' '}
            <b>dos turnos seguidos</b> sin que escriba una persona. Al pasarse, la cadena se detiene
            y queda dicho en el grupo.
          </Text>
        </Alert>

        {error && (
          <Alert color='red' icon={<IconAlertCircle size={16} />} py={6}>
            <Text size='xs'>{error}</Text>
          </Alert>
        )}

        <Group justify='flex-end' gap='sm'>
          <Button variant='subtle' onClick={onCerrar} disabled={guardando}>
            Cancelar
          </Button>
          <Button
            onClick={() => void crear()}
            loading={guardando}
            leftSection={<IconUsersGroup size={16} />}
          >
            Crear grupo
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
