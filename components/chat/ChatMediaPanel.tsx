'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Center, Group, Loader, Modal, Stack, Tabs, Text } from '@mantine/core';
import { IconDownload, IconFile, IconPhoto } from '@tabler/icons-react';
import { formatBytes } from '../../lib/chat/attachments';
import { chatGetJson, isAbortError, type ChatSharedFileDto } from '../../lib/chat/client';
import { ChatImageThumb, ChatImageViewer, type ImagenAdjunta } from './ChatImageViewer';

type Pagina = { items: ChatSharedFileDto[]; nextCursor: number | null };

function fecha(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('es-CO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * "MULTIMEDIA Y ARCHIVOS" de una conversación: pestañas Fotos (cuadrícula con
 * el mismo visor de las burbujas) y Archivos (lista con descarga), del más
 * reciente al más antiguo.
 *
 * Se carga SOLO al abrirse (el módulo además va con `next/dynamic`), una página
 * a la vez con "Cargar más", y nada de sondeo: es una consulta, no un hilo vivo.
 */
export default function ChatMediaPanel({
  opened,
  onClose,
  idConversation,
  titulo,
}: {
  opened: boolean;
  onClose: () => void;
  idConversation: number;
  titulo?: string;
}) {
  const [items, setItems] = useState<ChatSharedFileDto[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cargado, setCargado] = useState(false);
  const [visor, setVisor] = useState<ImagenAdjunta | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const cargar = useCallback(
    async (antes: number | null) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setCargando(true);
      setError(null);
      try {
        const qs = antes ? `?before=${antes}` : '';
        const data = await chatGetJson<Pagina>(
          `/api/chat/conversations/${idConversation}/attachments${qs}`,
          controller.signal
        );
        if (controller.signal.aborted) return;
        if (!data) {
          setError('No se pudieron cargar los archivos de la conversación.');
          return;
        }
        setItems((prev) => (antes ? [...prev, ...data.items] : data.items));
        setCursor(data.nextCursor);
        setCargado(true);
      } catch (err) {
        if (!isAbortError(err)) setError('No se pudieron cargar los archivos de la conversación.');
      } finally {
        if (!controller.signal.aborted) setCargando(false);
      }
    },
    [idConversation]
  );

  // Al abrir (o al cambiar de conversación con el panel abierto) se pide la
  // primera página; al cerrar se suelta todo.
  useEffect(() => {
    if (!opened) return;
    setItems([]);
    setCursor(null);
    setCargado(false);
    void cargar(null);
    return () => abortRef.current?.abort();
  }, [opened, cargar]);

  const fotos = useMemo(() => items.filter((i) => i.isImage), [items]);
  const archivos = useMemo(() => items.filter((i) => !i.isImage), [items]);

  const cargarMas =
    cursor !== null ? (
      <Center mt='sm'>
        <Button variant='subtle' size='xs' loading={cargando} onClick={() => void cargar(cursor)}>
          Cargar más
        </Button>
      </Center>
    ) : null;

  const vacio = (texto: string) => (
    <Text size='sm' className='chat-text-muted' ta='center' py='lg'>
      {texto}
    </Text>
  );

  return (
    <>
      <Modal
        opened={opened}
        onClose={onClose}
        title={titulo ? `Multimedia y archivos · ${titulo}` : 'Multimedia y archivos'}
        size='lg'
        centered
        lockScroll={false}
      >
        {error && (
          <Alert color='red' variant='light' mb='sm'>
            {error}
          </Alert>
        )}
        {!cargado && cargando ? (
          <Center py='xl'>
            <Loader size='sm' />
          </Center>
        ) : (
          <Tabs defaultValue='fotos' keepMounted={false}>
            <Tabs.List grow mb='sm'>
              <Tabs.Tab value='fotos' leftSection={<IconPhoto size={16} />}>
                Fotos{fotos.length > 0 ? ` (${fotos.length}${cursor !== null ? '+' : ''})` : ''}
              </Tabs.Tab>
              <Tabs.Tab value='archivos' leftSection={<IconFile size={16} />}>
                Archivos
                {archivos.length > 0 ? ` (${archivos.length}${cursor !== null ? '+' : ''})` : ''}
              </Tabs.Tab>
            </Tabs.List>

            <Tabs.Panel value='fotos'>
              {fotos.length === 0 ? (
                vacio(cursor !== null ? 'Todavía no hay fotos en lo cargado.' : 'No hay fotos en esta conversación.')
              ) : (
                <div className='chat-galeria'>
                  {fotos.map((f) => (
                    <ChatImageThumb
                      key={f.id}
                      imagen={f}
                      onAbrir={setVisor}
                      className='chat-imagen chat-galeria__foto'
                    />
                  ))}
                </div>
              )}
              {cargarMas}
            </Tabs.Panel>

            <Tabs.Panel value='archivos'>
              {archivos.length === 0 ? (
                vacio(
                  cursor !== null
                    ? 'Todavía no hay archivos en lo cargado.'
                    : 'No hay archivos en esta conversación.'
                )
              ) : (
                <Stack gap={6}>
                  {archivos.map((a) => (
                    <a
                      key={a.id}
                      href={a.downloadUrl}
                      download={a.fileName}
                      className='chat-galeria__archivo'
                      title={`Descargar ${a.fileName}`}
                    >
                      <IconFile size={20} style={{ flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <Text size='sm' fw={500} lineClamp={1}>
                          {a.fileName}
                        </Text>
                        <Text size='xs' className='chat-text-muted' lineClamp={1}>
                          {[a.sizeBytes !== null ? formatBytes(a.sizeBytes) : null, fecha(a.createdAt), a.sentBy]
                            .filter(Boolean)
                            .join(' · ')}
                        </Text>
                      </div>
                      <IconDownload size={16} style={{ flexShrink: 0 }} />
                    </a>
                  ))}
                </Stack>
              )}
              {cargarMas}
            </Tabs.Panel>
          </Tabs>
        )}
        <Group justify='flex-end' mt='md'>
          <Button variant='default' size='xs' onClick={onClose}>
            Cerrar
          </Button>
        </Group>
      </Modal>
      {visor && <ChatImageViewer imagen={visor} onClose={() => setVisor(null)} />}
    </>
  );
}
