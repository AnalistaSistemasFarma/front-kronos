'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Button,
  Center,
  Group,
  Loader,
  Menu,
  Modal,
  ScrollArea,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
  Textarea,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import {
  IconAlertCircle,
  IconBrandWhatsapp,
  IconBriefcase,
  IconDownload,
  IconMessageForward,
  IconSearch,
  IconShare,
  IconUser,
  IconUsersGroup,
} from '@tabler/icons-react';
import { chatFetch } from '../../lib/chat/client';
import {
  AVISO_HOJA_FALLO,
  ETIQUETA_TIPO,
  MAX_NOTA_REENVIO,
  accionTrasErrorCompartir,
  elegirEstrategiaCompartir,
  enlaceWhatsApp,
  enlaceWhatsAppWeb,
  esEscritorio,
  filtrarDestinos,
  leerEntornoDispositivo,
  mensajeReenviado,
  puedeCompartirArchivo,
  tipoParaCompartir,
  type DestinoReenvio,
  type TipoDestino,
} from '../../lib/chat/compartir';
import type { AdjuntoVisor } from './ChatAttachmentViewer';

/** Por encima del visor (zIndex 400), que a su vez está por encima de Multimedia. */
const Z_COMPARTIR = 410;

export type AvisoCompartir = { color: 'green' | 'red'; texto: string };

/** ¿Hay hoja nativa de compartir con archivos en este navegador? */
function hayHojaNativa(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function' && typeof navigator.canShare === 'function';
}

/** ¿Computador (Windows, macOS, Linux)? Ahí nunca se usa la hoja nativa con archivos (2026-10-27). */
function enEscritorio(): boolean {
  const entorno = leerEntornoDispositivo();
  return entorno ? esEscritorio(entorno) : true;
}

/**
 * «COMPARTIR» del visor de adjuntos (2026-10-24). Pedido de Nicolás Rivera:
 * «quiero que podamos enviar por chat interno de SynerLink los adjuntos o por
 * WhatsApp». Reglas puras en lib/chat/compartir.ts.
 *
 *   - Reenviar por el chat: elegir persona, grupo o conversación de proyecto
 *     (solo donde puede escribir) y, si quiere, un comentario. El servidor
 *     copia el archivo y repite las dos puertas.
 *   - WhatsApp u otra app: en el celular, la hoja nativa con el ARCHIVO (Web
 *     Share nivel 2). El archivo se prepara al abrir el menú, para que el
 *     toque llame a `navigator.share` sin esperas: Safari solo abre la hoja
 *     si se pide dentro del mismo gesto. Donde no se pueden compartir
 *     archivos, Descargar + abrir WhatsApp con el nombre.
 *   - En el ESCRITORIO (2026-10-27) nunca la hoja nativa: en Windows salía
 *     vacía («No fue posible enseñarte todas las maneras…»). Directo a
 *     Descargar + WhatsApp Web. Si la hoja del celular falla por algo que no
 *     sea cancelar, el mismo respaldo con un aviso arriba.
 */
export default function CompartirAdjunto({ adjunto, onAviso }: { adjunto: AdjuntoVisor; onAviso: (aviso: AvisoCompartir) => void }) {
  const [reenviar, setReenviar] = useState(false);
  const [sinHoja, setSinHoja] = useState(false);
  // Respaldo abierto porque la hoja del celular falló (aviso arriba).
  const [hojaFallo, setHojaFallo] = useState(false);
  // Se decide en el navegador al tocar; en el servidor se asume escritorio.
  const [escritorio, setEscritorio] = useState(true);
  // El archivo listo para la hoja nativa (se prepara al abrir el menú).
  const [archivo, setArchivo] = useState<File | null>(null);
  const [preparando, setPreparando] = useState(false);
  const pedido = useRef<AbortController | null>(null);

  // Otro adjunto (flechas del visor): lo preparado ya no sirve.
  useEffect(() => {
    setArchivo(null);
    setPreparando(false);
    pedido.current?.abort();
    pedido.current = null;
  }, [adjunto.id]);
  useEffect(() => () => pedido.current?.abort(), []);

  const preparar = useCallback(() => {
    // En el escritorio no se usa la hoja nativa: no hace falta bajar el archivo.
    if (enEscritorio() || !hayHojaNativa() || archivo || pedido.current) return;
    const ctrl = new AbortController();
    pedido.current = ctrl;
    setPreparando(true);
    fetch(adjunto.downloadUrl, { credentials: 'same-origin', signal: ctrl.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        if (ctrl.signal.aborted) return;
        setArchivo(new File([blob], adjunto.fileName, { type: tipoParaCompartir(adjunto.contentType, adjunto.fileName) }));
      })
      .catch(() => {
        /* Sin el archivo, el toque cae a Descargar + WhatsApp. */
      })
      .finally(() => {
        if (pedido.current === ctrl) pedido.current = null;
        if (!ctrl.signal.aborted) setPreparando(false);
      });
  }, [adjunto.downloadUrl, adjunto.fileName, adjunto.contentType, archivo]);

  const abrirRespaldo = (porFallo: boolean) => {
    setHojaFallo(porFallo);
    setSinHoja(true);
  };

  const compartirFuera = () => {
    const esc = enEscritorio();
    setEscritorio(esc);
    const estrategia = elegirEstrategiaCompartir({
      escritorio: esc,
      puedeArchivo: !!archivo && puedeCompartirArchivo(navigator, archivo),
    });
    if (estrategia === 'hoja-nativa' && archivo) {
      // Se llama en el mismo gesto (Safari solo abre la hoja así).
      let promesa: Promise<void>;
      try {
        promesa = navigator.share({ files: [archivo], title: adjunto.fileName });
      } catch (e) {
        if (accionTrasErrorCompartir(e) === 'respaldo') abrirRespaldo(true);
        return;
      }
      promesa.catch((e: unknown) => {
        // Cerrar la hoja sin elegir app no es un error.
        if (accionTrasErrorCompartir(e) === 'respaldo') abrirRespaldo(true);
      });
      return;
    }
    abrirRespaldo(false);
  };

  return (
    <>
      <Menu position='bottom-end' withinPortal zIndex={Z_COMPARTIR} onOpen={preparar} shadow='md'>
        <Menu.Target>
          <Tooltip label='Compartir' withArrow>
            <ActionIcon variant='subtle' color='gray' aria-label={`Compartir ${adjunto.fileName}`} data-testid='chat-visor-compartir'>
              <IconShare size={17} />
            </ActionIcon>
          </Tooltip>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Label>Compartir</Menu.Label>
          <Menu.Item leftSection={<IconMessageForward size={16} />} onClick={() => setReenviar(true)} data-testid='chat-compartir-reenviar'>
            Reenviar por el chat
          </Menu.Item>
          <Menu.Item
            leftSection={preparando ? <Loader size={14} /> : <IconBrandWhatsapp size={16} />}
            onClick={compartirFuera}
            disabled={preparando}
            data-testid='chat-compartir-fuera'
          >
            {preparando ? 'Preparando el archivo…' : 'WhatsApp u otra app'}
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>

      {reenviar && (
        <ReenviarModal
          adjunto={adjunto}
          onClose={() => setReenviar(false)}
          onListo={(texto) => {
            setReenviar(false);
            onAviso({ color: 'green', texto });
          }}
        />
      )}

      <Modal
        opened={sinHoja}
        onClose={() => setSinHoja(false)}
        title='Compartir por WhatsApp'
        centered
        zIndex={Z_COMPARTIR}
        size='sm'
      >
        <Stack gap='sm' data-testid='chat-compartir-respaldo'>
          {/* El aviso va ARRIBA, donde se ve sin desplazarse. */}
          {hojaFallo && (
            <Alert color='orange' variant='light' icon={<IconAlertCircle size={16} />} py={8} data-testid='chat-compartir-hoja-fallo'>
              <Text size='sm'>{AVISO_HOJA_FALLO}</Text>
            </Alert>
          )}
          {escritorio ? (
            <Text size='sm'>
              1. Descargue el archivo. 2. Abra WhatsApp Web (o la app de WhatsApp del computador), elija el chat y adjunte el archivo
              descargado con el clip.
            </Text>
          ) : (
            !hojaFallo && (
              <Text size='sm'>
                Este dispositivo no puede enviar el archivo directamente a otra app. Descárguelo y luego adjúntelo en WhatsApp.
              </Text>
            )
          )}
          <Text size='xs' className='chat-text-muted'>
            Por seguridad no se genera ningún enlace público: el archivo solo se abre con una sesión de SynerLink.
          </Text>
          <Group grow>
            <Button component='a' href={adjunto.downloadUrl} download={adjunto.fileName} variant='light' leftSection={<IconDownload size={16} />}>
              Descargar
            </Button>
            <Button
              component='a'
              href={escritorio ? enlaceWhatsAppWeb(adjunto.fileName) : enlaceWhatsApp(adjunto.fileName)}
              target='_blank'
              rel='noopener noreferrer'
              color='green'
              leftSection={<IconBrandWhatsapp size={16} />}
              data-testid='chat-compartir-whatsapp'
            >
              {escritorio ? 'Abrir WhatsApp Web' : 'Abrir WhatsApp'}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}

/* ─────────────────────────── Reenviar por el chat ─────────────────────────── */

const ICONO_TIPO: Record<TipoDestino, typeof IconUser> = {
  persona: IconUser,
  grupo: IconUsersGroup,
  proyecto: IconBriefcase,
};

function ReenviarModal({ adjunto, onClose, onListo }: { adjunto: AdjuntoVisor; onClose: () => void; onListo: (texto: string) => void }) {
  const movil = useMediaQuery('(max-width: 768px)') ?? false;
  const [destinos, setDestinos] = useState<DestinoReenvio[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState('');
  const [tipo, setTipo] = useState<TipoDestino | 'todos'>('todos');
  const [elegido, setElegido] = useState<DestinoReenvio | null>(null);
  const [nota, setNota] = useState('');
  const [enviando, setEnviando] = useState(false);
  const url = `/api/chat/attachments/${adjunto.id}/reenviar`;

  useEffect(() => {
    const ctrl = new AbortController();
    chatFetch(url, { signal: ctrl.signal })
      .then(async (res) => {
        const datos = (await res.json().catch(() => null)) as { destinos?: DestinoReenvio[]; error?: string } | null;
        if (ctrl.signal.aborted) return;
        if (!res.ok) throw new Error(datos?.error || 'No se pudieron cargar las conversaciones.');
        setDestinos(datos?.destinos ?? []);
      })
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : 'No se pudieron cargar las conversaciones.');
      });
    return () => ctrl.abort();
  }, [url]);

  const visibles = useMemo(() => filtrarDestinos(destinos ?? [], busqueda, tipo), [destinos, busqueda, tipo]);

  const enviar = async () => {
    if (!elegido || enviando) return;
    setEnviando(true);
    setError(null);
    try {
      const res = await chatFetch(url, {
        method: 'POST',
        body: JSON.stringify({ idConversation: elegido.idConversation, body: nota.trim() || undefined }),
      });
      const datos = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(datos?.error || 'No se pudo reenviar el archivo.');
      onListo(mensajeReenviado(adjunto.fileName, elegido));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo reenviar el archivo.');
      setEnviando(false);
    }
  };

  return (
    <Modal
      opened
      onClose={onClose}
      title={`Reenviar «${adjunto.fileName}»`}
      centered
      fullScreen={movil}
      size='md'
      zIndex={Z_COMPARTIR}
      styles={{ title: { fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }}
    >
      <Stack gap='sm' data-testid='chat-reenviar'>
        {/* El aviso va ARRIBA, donde se ve sin desplazarse. */}
        {error && (
          <Alert color='red' variant='light' icon={<IconAlertCircle size={16} />} py={8} data-testid='chat-reenviar-error'>
            <Text size='sm'>{error}</Text>
          </Alert>
        )}
        <TextInput
          placeholder='Buscar persona, grupo o proyecto'
          leftSection={<IconSearch size={16} />}
          value={busqueda}
          onChange={(e) => setBusqueda(e.currentTarget.value)}
          aria-label='Buscar destino'
        />
        <SegmentedControl
          size='xs'
          fullWidth
          value={tipo}
          onChange={(v) => setTipo(v as TipoDestino | 'todos')}
          data={[
            { value: 'todos', label: 'Todos' },
            { value: 'persona', label: 'Personas' },
            { value: 'grupo', label: 'Grupos' },
            { value: 'proyecto', label: 'Proyectos' },
          ]}
          aria-label='Tipo de destino'
        />
        <ScrollArea.Autosize mah={movil ? 'calc(100dvh - 360px)' : 320} type='auto' offsetScrollbars>
          {destinos === null && !error ? (
            <Center py='lg'>
              <Loader size='sm' />
            </Center>
          ) : visibles.length === 0 ? (
            <Text size='sm' className='chat-text-muted' ta='center' py='md'>
              {destinos && destinos.length === 0
                ? 'No tiene conversaciones con personas, grupos ni proyectos donde pueda reenviarlo.'
                : 'Ninguna conversación coincide con la búsqueda.'}
            </Text>
          ) : (
            <Stack gap={4} role='listbox' aria-label='Destinos'>
              {visibles.map((d) => {
                const Icono = ICONO_TIPO[d.tipo];
                const activo = elegido?.idConversation === d.idConversation;
                return (
                  <UnstyledButton
                    key={d.idConversation}
                    role='option'
                    aria-selected={activo}
                    onClick={() => setElegido(d)}
                    className={`chat-compartir__destino${activo ? ' chat-compartir__destino--activo' : ''}`}
                    data-testid='chat-reenviar-destino'
                  >
                    <Group gap='sm' wrap='nowrap'>
                      <Icono size={18} style={{ flexShrink: 0 }} />
                      <Stack gap={0} style={{ minWidth: 0, flex: 1 }}>
                        <Text size='sm' fw={500} lineClamp={1}>
                          {d.titulo}
                        </Text>
                        <Text size='xs' className='chat-text-muted' lineClamp={1}>
                          {ETIQUETA_TIPO[d.tipo]}
                          {d.detalle ? ` · ${d.detalle}` : ''}
                        </Text>
                      </Stack>
                    </Group>
                  </UnstyledButton>
                );
              })}
            </Stack>
          )}
        </ScrollArea.Autosize>
        <Textarea
          placeholder='Comentario (opcional)'
          autosize
          minRows={1}
          maxRows={4}
          maxLength={MAX_NOTA_REENVIO}
          value={nota}
          onChange={(e) => setNota(e.currentTarget.value)}
          aria-label='Comentario'
        />
        <Group justify='flex-end' gap='xs'>
          <Button variant='default' onClick={onClose} disabled={enviando}>
            Cancelar
          </Button>
          <Button
            onClick={enviar}
            loading={enviando}
            disabled={!elegido}
            leftSection={<IconMessageForward size={16} />}
            data-testid='chat-reenviar-enviar'
          >
            {elegido ? `Reenviar a ${elegido.titulo.length > 24 ? `${elegido.titulo.slice(0, 23)}…` : elegido.titulo}` : 'Reenviar'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
