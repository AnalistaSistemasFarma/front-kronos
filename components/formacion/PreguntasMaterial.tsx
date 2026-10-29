'use client';

import { useCallback, useEffect, useState } from 'react';
import { ActionIcon, Alert, Avatar, Badge, Box, Button, Card, Group, Loader, Menu, Stack, Text, Textarea, Title } from '@mantine/core';
import { IconArrowBackUp, IconDots, IconHeart, IconHeartFilled, IconMessageQuestion, IconSend, IconTrash } from '@tabler/icons-react';
import { haceCuanto, MAX_TEXTO_PREGUNTA, type PreguntaDto } from '../../lib/formacion/preguntas';
import { leerJsonSeguro } from './tipos';

/**
 * FORMACIÓN — preguntas y respuestas de un material (Nicolás Rivera,
 * 2026-10-26; referencia: el panel de comentarios junto al video). Respuestas
 * de un nivel, «me gusta», etiqueta «Formador» y eliminar (autor o formador).
 */
function iniciales(nombre: string): string {
  return (
    nombre
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p.charAt(0).toUpperCase())
      .join('') || '?'
  );
}

export default function PreguntasMaterial({ materialId }: { materialId: number }) {
  const [preguntas, setPreguntas] = useState<PreguntaDto[]>([]);
  const [total, setTotal] = useState(0);
  const [modera, setModera] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [respondiendo, setRespondiendo] = useState<number | null>(null);
  const [respuesta, setRespuesta] = useState('');
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(`/api/portal/materials/${materialId}/preguntas`, { cache: 'no-store' });
      const data = await leerJsonSeguro(res);
      if (!res.ok) throw new Error(String(data.error ?? 'No se pudieron cargar las preguntas.'));
      setPreguntas((data.preguntas as PreguntaDto[]) ?? []);
      setTotal(Number(data.total ?? 0));
      setModera(data.modera === true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }, [materialId]);

  useEffect(() => {
    setCargando(true);
    setError(null);
    void cargar();
  }, [cargar]);

  const publicar = async (contenido: string, parentId: number | null) => {
    if (!contenido.trim()) return false;
    setEnviando(true);
    setError(null);
    try {
      const res = await fetch(`/api/portal/materials/${materialId}/preguntas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texto: contenido, parentId }),
      });
      const data = await leerJsonSeguro(res);
      if (!res.ok) throw new Error(String(data.error ?? 'No se pudo publicar.'));
      await cargar();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setEnviando(false);
    }
  };

  const meGusta = async (p: PreguntaDto) => {
    const res = await fetch(`/api/portal/preguntas/${p.id}/like`, { method: 'POST' });
    if (res.ok) await cargar();
  };

  const eliminar = async (p: PreguntaDto) => {
    if (!window.confirm('¿Eliminar este comentario?')) return;
    const res = await fetch(`/api/portal/preguntas/${p.id}`, { method: 'DELETE' });
    const data = await leerJsonSeguro(res);
    if (!res.ok) setError(String(data.error ?? 'No se pudo eliminar.'));
    await cargar();
  };

  const Comentario = ({ p, esRespuesta }: { p: PreguntaDto; esRespuesta?: boolean }) => (
    <Group align='flex-start' gap='sm' wrap='nowrap' data-testid='pregunta'>
      <Avatar radius='xl' size={esRespuesta ? 'sm' : 'md'} color={p.esFormador ? 'green' : 'blue'}>
        {p.eliminada ? '–' : iniciales(p.nombre)}
      </Avatar>
      <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
        <Group gap='xs' justify='space-between' wrap='nowrap'>
          <Group gap='xs' wrap='wrap'>
            {!p.eliminada && (
              <Text size='sm' fw={700}>
                {p.nombre}
              </Text>
            )}
            {p.esFormador && (
              <Badge size='sm' color='green' variant='light'>
                Formador
              </Badge>
            )}
            <Text size='xs' c='dimmed'>
              {haceCuanto(p.creadoEl)}
            </Text>
          </Group>
          {!p.eliminada && (p.propia || modera) && (
            <Menu position='bottom-end' withinPortal>
              <Menu.Target>
                <ActionIcon variant='subtle' color='gray' size='sm' aria-label='Más opciones'>
                  <IconDots size={16} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item color='red' leftSection={<IconTrash size={14} />} onClick={() => void eliminar(p)}>
                  Eliminar
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          )}
        </Group>
        <Text size='sm' c={p.eliminada ? 'dimmed' : undefined} fs={p.eliminada ? 'italic' : undefined} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          {p.texto}
        </Text>
        {!p.eliminada && (
          <Group gap='md'>
            <Button
              variant='subtle'
              color={p.meGusta ? 'red' : 'gray'}
              size='compact-xs'
              leftSection={p.meGusta ? <IconHeartFilled size={14} /> : <IconHeart size={14} />}
              onClick={() => void meGusta(p)}
              aria-label={p.meGusta ? 'Quitar me gusta' : 'Me gusta'}
            >
              {p.likes}
            </Button>
            {!esRespuesta && (
              <Button
                variant='subtle'
                color='gray'
                size='compact-xs'
                leftSection={<IconArrowBackUp size={14} />}
                onClick={() => {
                  setRespondiendo(respondiendo === p.id ? null : p.id);
                  setRespuesta('');
                }}
              >
                Responder
              </Button>
            )}
          </Group>
        )}
      </Stack>
    </Group>
  );

  return (
    <Card withBorder radius='md' shadow='sm' padding='md' data-testid='preguntas-material'>
      <Stack gap='sm'>
        <Title order={4} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <IconMessageQuestion size={20} /> Preguntas y respuestas ({total})
        </Title>
        {error && (
          <Alert color='red' role='alert'>
            {error}
          </Alert>
        )}
        <Group align='flex-end' gap='xs' wrap='nowrap'>
          <Textarea
            placeholder='Escriba su pregunta o aporte'
            aria-label='Escriba su pregunta o aporte'
            value={texto}
            maxLength={MAX_TEXTO_PREGUNTA}
            autosize
            minRows={1}
            maxRows={6}
            onChange={(e) => setTexto(e.currentTarget.value)}
            style={{ flex: 1 }}
          />
          <ActionIcon
            size='lg'
            variant='filled'
            aria-label='Publicar'
            loading={enviando}
            disabled={!texto.trim()}
            onClick={() => void publicar(texto, null).then((ok) => ok && setTexto(''))}
          >
            <IconSend size={18} />
          </ActionIcon>
        </Group>

        {cargando ? (
          <Loader size='sm' />
        ) : preguntas.length === 0 ? (
          <Text size='sm' c='dimmed' ta='center' py='md'>
            Todavía no hay preguntas. ¡Sea la primera persona en preguntar!
          </Text>
        ) : (
          <Stack gap='md'>
            {preguntas.map((p) => (
              <Stack key={p.id} gap='sm'>
                <Comentario p={p} />
                {(p.respuestas.length > 0 || respondiendo === p.id) && (
                  <Box ml={18} pl='md' style={{ borderLeft: '2px solid var(--mantine-color-default-border)' }}>
                    <Stack gap='sm'>
                      {p.respuestas.map((r) => (
                        <Comentario key={r.id} p={r} esRespuesta />
                      ))}
                      {respondiendo === p.id && (
                        <Group align='flex-end' gap='xs' wrap='nowrap'>
                          <Textarea
                            placeholder='Escriba su respuesta'
                            aria-label='Escriba su respuesta'
                            value={respuesta}
                            maxLength={MAX_TEXTO_PREGUNTA}
                            autosize
                            minRows={1}
                            maxRows={5}
                            onChange={(e) => setRespuesta(e.currentTarget.value)}
                            style={{ flex: 1 }}
                            autoFocus
                          />
                          <ActionIcon
                            size='lg'
                            variant='filled'
                            aria-label='Responder'
                            loading={enviando}
                            disabled={!respuesta.trim()}
                            onClick={() =>
                              void publicar(respuesta, p.id).then((ok) => {
                                if (ok) {
                                  setRespuesta('');
                                  setRespondiendo(null);
                                }
                              })
                            }
                          >
                            <IconSend size={18} />
                          </ActionIcon>
                        </Group>
                      )}
                    </Stack>
                  </Box>
                )}
              </Stack>
            ))}
          </Stack>
        )}
      </Stack>
    </Card>
  );
}
