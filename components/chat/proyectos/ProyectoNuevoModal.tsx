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
  Textarea,
} from '@mantine/core';
import { IconAlertCircle, IconFolderPlus, IconInfoCircle } from '@tabler/icons-react';
import { EsqueletoListaAgentes } from '../ChatSkeletons';
import { chatFetch, chatGetJson, type ChatProjectListDto } from '../../../lib/chat/client';

/**
 * Cuadro para CREAR UN PROYECTO (hilo de agente) — piloto F1, 2026-10-17.
 *
 * Mismo armado que ChatGroupModal (nombre, empresa, personas) más lo propio
 * del proyecto: el PERFIL de conectores y las instrucciones. La reja de verdad
 * está en POST /api/chat/projects; esto es solo el formulario.
 *
 * Las personas vienen de /api/chat/projects/candidates: solo quienes tienen el
 * chat Y este asistente en esa empresa. Ofrecer a cualquiera dejaría miembros
 * que nunca pueden entrar.
 */

type Candidato = { id: string; name: string; email: string; avatarUrl: string | null; isSelf: boolean };

export default function ProyectoNuevoModal({
  abierto,
  onCerrar,
  datos,
  onCreado,
}: {
  abierto: boolean;
  onCerrar: () => void;
  /** Lo que devolvió GET /api/chat/projects?agent=… (empresas y perfiles). */
  datos: ChatProjectListDto;
  /** Se llama con el proyecto recién creado, para entrar a él. */
  onCreado: (creado: { idProject: number; idConversation: number }) => void;
}) {
  const [nombre, setNombre] = useState('');
  const [idCompany, setIdCompany] = useState<string | null>(
    datos.companies.length === 1 ? String(datos.companies[0].idCompany) : null
  );
  const [perfil, setPerfil] = useState<string | null>(
    datos.profiles.length === 1 ? datos.profiles[0].key : null
  );
  const [instrucciones, setInstrucciones] = useState('');
  const [candidatos, setCandidatos] = useState<Candidato[] | null>(null);
  const [cargando, setCargando] = useState(false);
  const [elegidos, setElegidos] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  // Al cambiar de empresa se vuelve a pedir la lista y se limpia la selección:
  // quien sirve en una empresa puede no tener el asistente en la otra.
  useEffect(() => {
    setElegidos([]);
    setCandidatos(null);
    setError(null);
    if (!abierto || !idCompany) return;

    let cancelado = false;
    setCargando(true);
    void (async () => {
      const data = await chatGetJson<{ users: Candidato[] }>(
        `/api/chat/projects/candidates?agent=${encodeURIComponent(datos.agent.code)}&idCompany=${encodeURIComponent(idCompany)}`
      );
      if (cancelado) return;
      if (!data) setError('No se pudo cargar quién puede entrar al proyecto.');
      setCandidatos(data?.users ?? null);
      setCargando(false);
    })();
    return () => {
      cancelado = true;
    };
  }, [abierto, idCompany, datos.agent.code]);

  const alternar = (id: string) =>
    setElegidos((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));

  const perfilElegido = datos.profiles.find((p) => p.key === perfil) ?? null;

  const crear = async () => {
    setError(null);
    if (nombre.trim() === '') return setError('Póngale un nombre al proyecto.');
    if (!idCompany) return setError('Escoja la empresa del proyecto.');
    if (!perfil) return setError('Escoja el perfil de conectores.');

    setGuardando(true);
    try {
      const res = await chatFetch('/api/chat/projects', {
        method: 'POST',
        body: JSON.stringify({
          agentCode: datos.agent.code,
          name: nombre.trim(),
          idCompany: Number(idCompany),
          profile: perfil,
          instructions: instrucciones,
          idUsers: elegidos,
        }),
      });
      const data = (await res.json().catch(() => null)) as
        | { idProject?: number; idConversation?: number; error?: string }
        | null;
      if (!res.ok || !data?.idProject || !data.idConversation) {
        setError(data?.error ?? 'No se pudo crear el proyecto.');
        return;
      }
      setNombre('');
      setInstrucciones('');
      setElegidos([]);
      onCreado({ idProject: data.idProject, idConversation: data.idConversation });
    } catch {
      setError('No se pudo crear el proyecto.');
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
          <IconFolderPlus size={18} />
          <Text fw={600}>Nuevo proyecto con {datos.agent.displayName}</Text>
        </Group>
      }
      size='lg'
      radius='md'
      centered
    >
      <Stack gap='sm'>
        <TextInput
          label='Nombre del proyecto'
          placeholder='Farmalógica — Operaciones, Comex Latam, Exportaciones a Venezuela…'
          value={nombre}
          onChange={(e) => setNombre(e.currentTarget.value)}
          maxLength={120}
          data-autofocus
        />

        <Select
          label='Empresa'
          description='Usted y los miembros deben tener este asistente habilitado en esa empresa.'
          placeholder='Escoja la empresa'
          data={datos.companies.map((c) => ({ value: String(c.idCompany), label: c.companyName }))}
          value={idCompany}
          onChange={setIdCompany}
          allowDeselect={false}
        />

        <Select
          label='Perfil de conectores'
          description='Define a qué sistemas puede consultar el asistente en este proyecto. No se puede cambiar después.'
          placeholder='Escoja el perfil'
          data={datos.profiles.map((p) => ({ value: p.key, label: p.label }))}
          value={perfil}
          onChange={setPerfil}
          allowDeselect={false}
        />
        {perfilElegido && (
          <Text size='xs' className='chat-text-muted' mt={-6}>
            {perfilElegido.description}
          </Text>
        )}

        <Textarea
          label='Instrucciones del proyecto'
          description='Qué papel cumple el asistente aquí y de qué temas se ocupa. Las lee en cada respuesta.'
          placeholder='Ej.: Hable solo de las operaciones de Farmalógica. Cite la fuente de cada cifra.'
          value={instrucciones}
          onChange={(e) => setInstrucciones(e.currentTarget.value)}
          autosize
          minRows={3}
          maxRows={8}
          maxLength={8000}
        />

        {cargando && <EsqueletoListaAgentes filas={3} />}

        {candidatos && (
          <Box>
            <Group gap={6} mb={4}>
              <Text size='sm' fw={600}>
                Miembros
              </Text>
              <Badge size='xs' variant='light'>
                usted queda como dueño
              </Badge>
            </Group>
            <Text size='xs' className='chat-text-muted' mb={6}>
              Solo aparecen quienes tienen este asistente en esa empresa. Los miembros ven todo lo
              trabajado en el proyecto; usted puede invitar o retirar personas después.
            </Text>
            {candidatos.filter((u) => !u.isSelf).length === 0 ? (
              <Text size='xs' className='chat-text-muted'>
                Nadie más tiene este asistente en esa empresa todavía.
              </Text>
            ) : (
              <ScrollArea.Autosize mah={200}>
                <Stack gap={4}>
                  {candidatos
                    .filter((u) => !u.isSelf)
                    .map((u) => (
                      <Checkbox
                        key={u.id}
                        checked={elegidos.includes(u.id)}
                        onChange={() => alternar(u.id)}
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
          </Box>
        )}

        <Alert color='blue' icon={<IconInfoCircle size={16} />} py={6}>
          <Text size='xs'>
            Cada conversación del proyecto tiene su propia memoria y no se mezcla con las demás
            conversaciones del asistente. Es un <b>piloto</b>: el asistente atiende como máximo dos
            conversaciones de proyecto a la vez y las demás esperan su turno.
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
          <Button onClick={() => void crear()} loading={guardando} leftSection={<IconFolderPlus size={16} />}>
            Crear proyecto
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
