'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Box,
  Button,
  Center,
  Group,
  Loader,
  ScrollArea,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconArrowDown,
  IconDownload,
  IconMessage2,
  IconUpload,
} from '@tabler/icons-react';
import AgentAvatar from './AgentAvatar';
import AgentTaskTable from './AgentTaskTable';
import ChatComposer, { type ChatComposerHandle } from './ChatComposer';
import ChatMarkdown from './ChatMarkdown';
import { useChatConversation } from './useChatConversation';
import { useAltoVisible } from './useAltoVisible';
import {
  describeAgentStatus,
  ESTADO_RANCIO_MS,
  formatChatTime,
  type ChatAgentDto,
  type ChatMessageDto,
} from '../../lib/chat/client';
import { formatBytes } from '../../lib/chat/attachments';

/**
 * El hilo de conversación: burbujas con Markdown real, indicador de qué está
 * haciendo el agente y la caja de escritura.
 *
 * VISUAL — de dónde sale y qué NO se copió
 * ----------------------------------------
 * La forma (ScrollArea con viewportRef, autoscroll al final, burbujas
 * `rounded-2xl` alineadas por autor) viene del historial de interacciones de
 * app/(hub)/process/request-general/view-request/page.tsx. Lo que NO se copió
 * son sus colores: allí están en duro (`bg-blue-400`, `bg-gray-100`,
 * `text-gray-800`) y no respetan el modo oscuro — una burbuja gris claro con
 * texto gris oscuro sobre fondo oscuro queda ilegible. Aquí todo sale de los
 * tokens --app-* de app/globals.css.
 */

/**
 * Adjuntos de un mensaje, como fichas descargables.
 *
 * El enlace apunta SIEMPRE a /api/chat/attachments/<id> (nunca a OneDrive):
 * ahí se vuelve a comprobar el permiso en cada descarga. Mientras el mensaje
 * está en vuelo el id todavía no existe, así que la ficha se muestra sin
 * enlace en vez de ofrecer una descarga que daría 404.
 */
function MessageAttachments({ message }: { message: ChatMessageDto }) {
  if (message.attachments.length === 0) return null;

  return (
    <Stack gap={4} mt={6}>
      {message.attachments.map((attachment) => {
        const content = (
          <>
            <IconDownload size={13} />
            <Text size='xs' lineClamp={1} className='chat-attachment__name'>
              {attachment.fileName}
            </Text>
            {attachment.sizeBytes !== null && (
              <Text size='xs' className='chat-attachment__size'>
                {formatBytes(attachment.sizeBytes)}
              </Text>
            )}
          </>
        );

        if (!attachment.downloadUrl) {
          return (
            <span key={attachment.id} className='chat-attachment'>
              {content}
            </span>
          );
        }

        return (
          <a
            key={attachment.id}
            href={attachment.downloadUrl}
            download={attachment.fileName}
            className='chat-attachment chat-attachment--link'
            title={`Descargar ${attachment.fileName}`}
          >
            {content}
          </a>
        );
      })}
    </Stack>
  );
}

function MessageBubble({
  message,
  agent,
  nueva = false,
}: {
  message: ChatMessageDto;
  agent: ChatAgentDto;
  /** Llegó DESPUÉS de abrir el hilo: solo esas se animan (ver ChatThread). */
  nueva?: boolean;
}) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  if (isSystem) {
    return (
      <Center>
        <Box className={`chat-bubble chat-bubble--system${nueva ? ' chat-bubble--nueva' : ''}`}>
          <ChatMarkdown content={message.body} />
          <MessageAttachments message={message} />
        </Box>
      </Center>
    );
  }

  return (
    <Group
      align='flex-end'
      gap='xs'
      justify={isUser ? 'flex-end' : 'flex-start'}
      wrap='nowrap'
    >
      {!isUser && (
        <Box style={{ flexShrink: 0 }}>
          <AgentAvatar
            code={agent.code}
            displayName={agent.displayName}
            avatarUrl={agent.avatarUrl}
            size={28}
            showStatus={false}
            withTooltip={false}
          />
        </Box>
      )}

      <Box
        className={[
          'chat-bubble',
          isUser ? 'chat-bubble--user' : 'chat-bubble--agent',
          nueva ? 'chat-bubble--nueva' : '',
          message.pending ? 'chat-bubble--pending' : '',
          message.failed ? 'chat-bubble--failed' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {!isUser && (
          <Text size='xs' fw={600} className='chat-bubble__author'>
            {agent.displayName}
          </Text>
        )}

        {message.body.trim().length > 0 && <ChatMarkdown content={message.body} />}
        <MessageAttachments message={message} />

        <Text size='xs' className='chat-bubble__meta'>
          {message.failed
            ? 'No se pudo enviar'
            : message.pending
              ? 'Enviando…'
              : formatChatTime(message.createdAt)}
        </Text>
      </Box>
    </Group>
  );
}

/**
 * Aviso de "su mensaje llegó pero nadie ha contestado".
 *
 * POR QUÉ EXISTE (preocupación de Nicolás, 2026-09-08): hoy, cuando un
 * asistente NO PUEDE responder, el chat se ve igual que cuando sí puede. Y las
 * causas son varias: se le agotó la cuota de la sesión —le pasó a Troy, y los
 * usuarios esperaron hasta las 11 sin saberlo—, se le venció la autenticación
 * (Cali y Mark, esta misma mañana), se congeló el proceso, o está apagada la
 * máquina donde corre.
 *
 * En los cuatro casos el usuario ve lo mismo: NADA. Y se queda esperando.
 *
 * Este aviso NO adivina la causa: informa el hecho, que es lo que la persona
 * necesita para dejar de esperar y buscar por otro lado. Se muestra solo cuando
 * el último mensaje del hilo es del usuario y ya pasó el umbral sin respuesta.
 *
 * Va en el FRONT y no en el conector a propósito: el conector está copiado en
 * la máquina de cada bot (quince copias hoy), así que un cambio allá hay que
 * repartirlo quince veces y repetirlo con cada bot nuevo. Aquí es un solo
 * lugar y aplica a todos los agentes, incluidos los que se siembren mañana.
 */
function SinRespuesta({
  agent,
  ultimoMensaje,
  status,
}: {
  agent: ChatAgentDto;
  ultimoMensaje: ChatMessageDto | undefined;
  status: Parameters<typeof describeAgentStatus>[0];
}) {
  // Un tic propio: si el aviso dependiera solo de que lleguen mensajes, en un
  // hilo callado nunca aparecería — que es exactamente el caso que importa.
  const [, setTic] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTic((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  if (!ultimoMensaje || ultimoMensaje.role !== 'user') return null;

  // Si el agente está trabajando DE VERDAD (estado fresco), no se avisa nada:
  // el indicador ya le está mostrando qué hace.
  const view = describeAgentStatus(status);
  if (view.busy) return null;

  const desde = Date.parse(ultimoMensaje.createdAt);
  if (Number.isNaN(desde)) return null;
  const transcurrido = Date.now() - desde;
  if (transcurrido < ESTADO_RANCIO_MS) return null;

  const minutos = Math.floor(transcurrido / 60_000);
  const cuanto =
    minutos < 60
      ? `${minutos} minutos`
      : `${Math.floor(minutos / 60)} h ${minutos % 60 ? `${minutos % 60} min` : ''}`.trim();

  return (
    <Alert
      color='orange'
      radius='md'
      icon={<IconAlertCircle size={18} />}
      role='status'
      aria-live='polite'
    >
      <Text size='xs'>
        Su mensaje llegó, pero <b>{agent.displayName}</b> no ha respondido en {cuanto}. Puede que
        haya agotado su cuota de la sesión, que se le haya vencido el acceso o que esté fuera de
        servicio. {view.stale ? 'Su indicador quedó colgado, que es otra señal de lo mismo. ' : ''}
        Si es urgente, avísele a Nicolás Rivera.
      </Text>
    </Alert>
  );
}

/** Indicador de "qué está haciendo el agente" — lo que evita el efecto congelado. */
function AgentActivity({
  agent,
  status,
}: {
  agent: ChatAgentDto;
  status: Parameters<typeof describeAgentStatus>[0];
}) {
  const view = describeAgentStatus(status);
  if (!view.busy) return null;

  return (
    <Box role='status' aria-live='polite'>
      <Group gap='xs' align='center' className='chat-activity'>
        <AgentAvatar
          code={agent.code}
          displayName={agent.displayName}
          avatarUrl={agent.avatarUrl}
          size={24}
          showStatus={false}
          withTooltip={false}
        />
        <span className='chat-typing' aria-hidden>
          <i />
          <i />
          <i />
        </span>
        <Text size='xs' className='chat-activity__label'>
          {view.label}
        </Text>
      </Group>

      {/* Solo aparece cuando el agente reporta sub-agentes trabajando. */}
      <AgentTaskTable tasks={status?.tasks} />
    </Box>
  );
}

export default function ChatThread({
  agent,
  active = true,
  height,
}: {
  agent: ChatAgentDto;
  /** El hilo está a la vista (marca leído y arranca el sondeo). */
  active?: boolean;
  /** Alto del área de mensajes. Sin valor, ocupa el espacio disponible. */
  height?: string | number;
}) {
  const thread = useChatConversation(agent.idAgent, active);

  // Mantiene `--alto-visible` al día: es lo que permite que el compositor no
  // quede debajo del teclado en el celular (ver el propio hook).
  //
  // Y cuando ese alto cambia —o sea, cuando sale o se guarda el teclado— el
  // hilo vuelve al fondo: al encogerse el contenedor, los últimos mensajes se
  // salen de la vista y había que desplazar para ver lo que uno acababa de
  // escribir. Solo se hace si el usuario YA estaba abajo: si subió a leer algo
  // viejo, el teclado no debe arrancarle la lectura.
  useAltoVisible(
    useCallback(() => {
      const viewport = viewportRef.current;
      if (!viewport || !stickToBottomRef.current) return;
      // En el mismo cuadro el navegador todavía no reacomodó el layout con el
      // alto nuevo; se espera al siguiente. Y se baja con `smooth` para que la
      // conversación acompañe al teclado en vez de saltar de golpe.
      requestAnimationFrame(() => {
        viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'smooth' });
      });
    }, [])
  );
  const viewportRef = useRef<HTMLDivElement>(null);
  const [stickToBottom, setStickToBottom] = useState(true);
  // Espejo en referencia: el aviso del teclado se registra una sola vez y
  // necesita leer el valor VIGENTE, no el del primer render.
  const stickToBottomRef = useRef(true);
  stickToBottomRef.current = stickToBottom;
  const lastCountRef = useRef(0);

  // Qué mensajes ya estaban cuando se abrió la conversación. Solo se animan
  // los que llegan DESPUÉS: si se animara todo, al entrar a un hilo largo la
  // pantalla entera se sacudiría, que es justo lo contrario de lo que se
  // busca. Se llena una sola vez, con el primer lote que llega.
  const yaEstaban = useRef<Set<string | number> | null>(null);
  if (yaEstaban.current === null && thread.messages.length > 0) {
    yaEstaban.current = new Set(thread.messages.map((m) => m.id));
  }

  // Autoscroll al final SOLO si el usuario ya estaba abajo: si subió a leer
  // algo, un mensaje nuevo no debe arrancarle la vista.
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const grew = thread.messages.length > lastCountRef.current;
    lastCountRef.current = thread.messages.length;
    if (!grew || !stickToBottom) return;
    viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'smooth' });
  }, [thread.messages, stickToBottom]);

  // Al abrir el hilo, al fondo sin animación.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || thread.loading) return;
    viewport.scrollTop = viewport.scrollHeight;
  }, [thread.loading, agent.idAgent]);

  /**
   * PEGADO AL FONDO de verdad, mientras el usuario esté abajo.
   *
   * El efecto de arriba solo reacciona a que CAMBIE LA CANTIDAD de mensajes, y
   * eso no alcanza: lo último de la conversación es el indicador de actividad,
   * que aparece DESPUÉS de enviar y además crece solo (cambia el texto, se le
   * suma la tabla de sub-tareas). Nicolás lo reportó así: "cuando envío un
   * mensaje no baja hasta abajo correctamente, se ve cortado" — y en su
   * captura el indicador quedaba partido por la mitad.
   *
   * Un observador de tamaño sobre el contenido cubre TODOS los casos, no solo
   * ese: el indicador que crece, una imagen del Markdown que termina de
   * cargar, las fichas de adjuntos, el mensaje que se reacomoda al cambiar el
   * ancho.
   *
   * El ajuste es INSTANTÁNEO a propósito. Con `smooth` el observador y la
   * animación se pelean por la posición y el resultado es peor que el
   * problema. La entrada de las burbujas sigue animada, que es de donde viene
   * la sensación de fluidez.
   *
   * No hay bucle: desplazarse no cambia el tamaño del contenido.
   */
  const contenidoRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const contenido = contenidoRef.current;
    const viewport = viewportRef.current;
    if (!contenido || !viewport || typeof ResizeObserver === 'undefined') return;

    const observador = new ResizeObserver(() => {
      if (!stickToBottomRef.current) return;
      viewport.scrollTop = viewport.scrollHeight;
    });
    observador.observe(contenido);
    return () => observador.disconnect();
  }, [agent.idAgent]);

  // ── Arrastrar y soltar archivos sobre la conversación ────────────────────
  // El área de soltar es TODO el hilo (mensajes + compositor), no solo la caja
  // de texto: es donde la gente suelta por instinto. Los archivos se entregan
  // al compositor por su ref, así la validación y el tope por mensaje siguen
  // viviendo en un solo lugar.
  const composerRef = useRef<ChatComposerHandle>(null);
  const [dragging, setDragging] = useState(false);
  // Contador de entradas/salidas: sin él, pasar el cursor por encima de un
  // hijo dispara dragleave del padre y el aviso parpadea.
  const dragDepth = useRef(0);

  const composerDisabled = thread.loading || thread.conversation === null;

  /** Solo reaccionamos si lo que se arrastra son ARCHIVOS (no texto ni enlaces). */
  const dragTraeArchivos = (event: React.DragEvent) =>
    Array.from(event.dataTransfer?.types ?? []).includes('Files');

  const onDragEnter = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (composerDisabled || !dragTraeArchivos(event)) return;
      event.preventDefault();
      dragDepth.current += 1;
      setDragging(true);
    },
    [composerDisabled]
  );

  const onDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (composerDisabled || !dragTraeArchivos(event)) return;
      // Sin este preventDefault el navegador ABRE el archivo en una pestaña
      // en vez de dejarnos soltarlo.
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    },
    [composerDisabled]
  );

  const onDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!dragTraeArchivos(event)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  }, []);

  /**
   * Pegar con el foco en cualquier parte de la conversación, no solo en la
   * caja de texto: uno toma la captura, hace clic en el chat y pega.
   *
   * Si el pegado ya lo atendió el compositor (el foco estaba en la caja), ese
   * manejador llamó a `preventDefault` y aquí no se hace nada: si no, la misma
   * imagen entraría dos veces.
   */
  const onPaste = useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>) => {
      if (composerDisabled || event.defaultPrevented) return;
      const pegados = Array.from(event.clipboardData?.files ?? []);
      if (pegados.length === 0) return;
      event.preventDefault();
      composerRef.current?.addFiles(pegados);
    },
    [composerDisabled]
  );

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      dragDepth.current = 0;
      setDragging(false);
      if (composerDisabled || !dragTraeArchivos(event)) return;
      event.preventDefault();
      const soltados = Array.from(event.dataTransfer.files ?? []);
      if (soltados.length === 0) return;
      composerRef.current?.addFiles(soltados);
    },
    [composerDisabled]
  );

  const onScrollPositionChange = ({ y }: { x: number; y: number }) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const distanceToBottom = viewport.scrollHeight - viewport.clientHeight - y;
    setStickToBottom(distanceToBottom < 80);
  };

  /**
   * Bajar del todo, a mano.
   *
   * Pedido de Nicolás (2026-09-08): "a veces se sube pero toca bajar de nuevo
   * al mensaje más reciente". Subir a leer algo viejo desactiva el
   * autodesplazamiento a propósito —para no arrancarle la lectura—, y entonces
   * volver abajo era trabajo manual: en una conversación larga, mucho trabajo.
   *
   * El botón solo aparece cuando uno NO está abajo, que es cuando sirve. Al
   * pulsarlo, además de bajar, se vuelve a activar el pegado al fondo: quien
   * baja a propósito quiere seguir la conversación en vivo.
   */
  const bajarDelTodo = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    setStickToBottom(true);
    stickToBottomRef.current = true;
    viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'smooth' });
  }, []);

  return (
    <Box
      className={`chat-thread${dragging ? ' chat-thread--dragging' : ''}`}
      style={height ? { height } : undefined}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onPaste={onPaste}
    >
      {dragging && (
        <Box className='chat-thread__dropzone' aria-hidden>
          <Stack align='center' gap={4}>
            <IconUpload size={26} />
            <Text size='sm' fw={600}>
              Suelte los archivos aquí
            </Text>
            <Text size='xs' className='chat-text-muted'>
              Se adjuntan al mensaje; usted decide cuándo enviarlo.
            </Text>
          </Stack>
        </Box>
      )}
      <ScrollArea
        className='chat-thread__scroll'
        viewportRef={viewportRef}
        onScrollPositionChange={onScrollPositionChange}
        offsetScrollbars
      >
        <Stack gap='sm' p='sm' ref={contenidoRef}>
          {thread.hasOlder && (
            <Center>
              <Button
                size='xs'
                variant='subtle'
                loading={thread.loadingOlder}
                onClick={() => void thread.loadOlder()}
              >
                Ver mensajes anteriores
              </Button>
            </Center>
          )}

          {thread.loading && thread.messages.length === 0 && (
            <Center py='xl'>
              <Loader size='sm' />
            </Center>
          )}

          {!thread.loading && thread.messages.length === 0 && !thread.error && (
            <Center py='xl'>
              <Stack align='center' gap={6}>
                <IconMessage2 size={28} className='chat-empty__icon' />
                <Text size='sm' fw={600}>
                  Todavía no han hablado
                </Text>
                <Text size='xs' ta='center' className='chat-text-muted' maw={320}>
                  {agent.description ||
                    `Escríbale a ${agent.displayName} para empezar la conversación.`}
                </Text>
              </Stack>
            </Center>
          )}

          {thread.messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              agent={agent}
              nueva={yaEstaban.current ? !yaEstaban.current.has(message.id) : false}
            />
          ))}

          <AgentActivity agent={agent} status={thread.status} />

          <SinRespuesta
            agent={agent}
            ultimoMensaje={thread.messages[thread.messages.length - 1]}
            status={thread.status}
          />
        </Stack>
      </ScrollArea>

      {thread.error && (
        <Alert
          icon={<IconAlertCircle size={16} />}
          color='red'
          radius='md'
          mx='sm'
          mb='xs'
          py={6}
        >
          <Text size='xs'>{thread.error}</Text>
        </Alert>
      )}

      {/* Flotante sobre la conversación, no en la fila del compositor: ahí
          taparía la caja de escribir. Se esconde solo cuando ya está abajo. */}
      {!stickToBottom && (
        <Tooltip label='Bajar al mensaje más reciente' withArrow position='left'>
          <ActionIcon
            className='chat-thread__bajar'
            variant='filled'
            color='blue'
            radius='xl'
            size={38}
            onClick={bajarDelTodo}
            aria-label='Bajar al mensaje más reciente'
          >
            <IconArrowDown size={20} />
          </ActionIcon>
        </Tooltip>
      )}

      <Box className='chat-thread__composer'>
        <ChatComposer
          ref={composerRef}
          onSend={(body, files) => thread.send(body, files)}
          sending={thread.sending}
          disabled={composerDisabled}
          placeholder={`Escríbale a ${agent.displayName}…`}
        />
      </Box>
    </Box>
  );
}
