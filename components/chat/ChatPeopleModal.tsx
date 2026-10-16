'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Group,
  Loader,
  Modal,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from '@mantine/core';
import { IconAlertCircle, IconSearch } from '@tabler/icons-react';
import AgentAvatar from './AgentAvatar';
import { chatFetch, type ChatConversationDto } from '../../lib/chat/client';
import { MIN_PEOPLE_SEARCH_CHARS } from '../../lib/chat/people-rules';

/**
 * Cuadro para ESCRIBIRLE A UNA PERSONA (piloto "Personas" del chat).
 *
 * El buscador pregunta al servidor (/api/chat/people/search), que solo
 * devuelve a quienes esta persona puede escribirle: comparten una empresa con
 * el Chat y ella tiene el piloto en esa empresa. Así la lista nunca ofrece a
 * alguien a quien después no le llegaría nada.
 *
 * Al elegir, se abre (o se crea) el hilo con POST /api/chat/people/conversations,
 * que es idempotente: elegir dos veces a la misma persona abre el mismo hilo.
 */

type PersonaEncontrada = {
  id: string;
  name: string;
  email: string;
  image: string | null;
  idConversation: number | null;
};

export default function ChatPeopleModal({
  abierto,
  onCerrar,
  onAbierto,
}: {
  abierto: boolean;
  onCerrar: () => void;
  /** Se llama con el hilo abierto (nuevo o existente), para mostrarlo. */
  onAbierto: (conversacion: ChatConversationDto) => void;
}) {
  const [q, setQ] = useState('');
  const [resultados, setResultados] = useState<PersonaEncontrada[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [abriendo, setAbriendo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const aborto = useRef<AbortController | null>(null);

  // Al cerrar se limpia: la próxima vez empieza de cero.
  useEffect(() => {
    if (abierto) return;
    aborto.current?.abort();
    setQ('');
    setResultados([]);
    setError(null);
    setAbriendo(null);
  }, [abierto]);

  // Búsqueda con espera de 300 ms y cancelando la anterior (mismo criterio del
  // buscador de mensajes de ChatWorkspace).
  useEffect(() => {
    const termino = q.trim();
    if (termino.length < MIN_PEOPLE_SEARCH_CHARS) {
      aborto.current?.abort();
      setResultados([]);
      setBuscando(false);
      return;
    }
    setBuscando(true);
    const reloj = window.setTimeout(() => {
      aborto.current?.abort();
      const control = new AbortController();
      aborto.current = control;
      chatFetch(`/api/chat/people/search?q=${encodeURIComponent(termino)}`, {
        signal: control.signal,
      })
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
        .then((data) => setResultados(Array.isArray(data?.people) ? data.people : []))
        .catch((e) => {
          if ((e as Error)?.name !== 'AbortError') setResultados([]);
        })
        .finally(() => {
          if (!control.signal.aborted) setBuscando(false);
        });
    }, 300);
    return () => window.clearTimeout(reloj);
  }, [q]);

  const abrir = async (persona: PersonaEncontrada) => {
    setAbriendo(persona.id);
    setError(null);
    try {
      const res = await chatFetch('/api/chat/people/conversations', {
        method: 'POST',
        body: JSON.stringify({ idUser: persona.id }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.conversation) {
        throw new Error(data?.error ?? 'No se pudo abrir la conversación.');
      }
      onAbierto(data.conversation as ChatConversationDto);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAbriendo(null);
    }
  };

  const termino = q.trim();

  return (
    <Modal
      opened={abierto}
      onClose={onCerrar}
      title='Escribirle a una persona'
      radius='lg'
      centered
      classNames={{ content: 'chat-surface' }}
    >
      <Stack gap='sm'>
        <TextInput
          value={q}
          onChange={(event) => setQ(event.currentTarget.value)}
          placeholder='Nombre o correo…'
          leftSection={<IconSearch size={16} />}
          rightSection={buscando ? <Loader size={14} /> : null}
          radius='md'
          data-autofocus
          aria-label='Buscar una persona por nombre o correo'
        />
        <Text size='xs' className='chat-text-muted'>
          Aparecen las personas de sus empresas que tienen el Chat habilitado.
        </Text>

        {error && (
          <Alert color='red' radius='md' p='xs' icon={<IconAlertCircle size={16} />}>
            <Text size='xs'>{error}</Text>
          </Alert>
        )}

        {termino.length >= MIN_PEOPLE_SEARCH_CHARS && !buscando && resultados.length === 0 && (
          <Text size='xs' className='chat-text-muted'>
            Nadie coincide con “{termino}”.
          </Text>
        )}

        {resultados.length > 0 && (
          <ScrollArea.Autosize mah={320} type='auto'>
            <Stack gap={4}>
              {resultados.map((persona) => (
                <UnstyledButton
                  key={persona.id}
                  onClick={() => void abrir(persona)}
                  disabled={abriendo !== null}
                  className='chat-agent-card chat-agent-card--compact'
                  aria-label={`Escribirle a ${persona.name}`}
                >
                  <Group gap='sm' wrap='nowrap'>
                    <AgentAvatar
                      code={persona.id}
                      displayName={persona.name}
                      avatarUrl={persona.image}
                      size={32}
                      showStatus={false}
                      withTooltip={false}
                    />
                    <Box style={{ flex: 1, minWidth: 0 }}>
                      <Text size='sm' fw={600} lineClamp={1}>
                        {persona.name}
                      </Text>
                      <Text size='xs' className='chat-text-muted' lineClamp={1}>
                        {persona.email}
                        {persona.idConversation ? ' · ya conversaron' : ''}
                      </Text>
                    </Box>
                    {abriendo === persona.id && <Loader size={14} />}
                  </Group>
                </UnstyledButton>
              ))}
            </Stack>
          </ScrollArea.Autosize>
        )}
      </Stack>
    </Modal>
  );
}
