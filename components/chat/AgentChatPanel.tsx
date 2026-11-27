'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { ActionIcon, Affix, Box, Group, Paper, Text, Tooltip } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconArrowLeft, IconArrowsMaximize, IconX } from '@tabler/icons-react';
import AgentAvatar from './AgentAvatar';
import ChatThread from './ChatThread';
import {
  GENIE_CLOSE_EASING,
  GENIE_CLOSE_MS,
  GENIE_OPEN_EASING,
  GENIE_OPEN_MS,
  findChatLauncher,
  genieCloseFrames,
  genieOpenFrames,
  prefersReducedMotion,
  zoomFrames,
} from './genie';
import {
  describeAgentStatus,
  type ChatAgentDto,
  type ChatParticipantDto,
  type ChatStatusDto,
} from '../../lib/chat/client';
import { agentKey, conversationKey, saveRouteBeforeChat } from '../../lib/chat/rail';
import { Z_INDEX } from '../../lib/ui/zIndex';

/**
 * Panel flotante del chat (esquina inferior derecha).
 *
 * Reusa la CÁSCARA visual del asistente que quedó en la rama
 * Implement-New-Agent (components/ai/AiAssistantChat.tsx): `Affix` +
 * `Transition` + `Paper` con encabezado, cuerpo desplazable y caja de
 * escritura. Lo que NO se reusó es su cerebro: aquel chat corría un modelo
 * dentro del navegador y no guardaba nada. Aquí el hilo vive en la base y del
 * otro lado hay un agente de la flota.
 *
 * También abre, en la misma ventanita, los chats ENTRE PERSONAS y los GRUPOS (`conversation`):
 * antes esos solo se abrían en la página completa de chats.
 */
/**
 * Dónde queda la conversación en la página de chats: debajo de la cabecera de SynerLink y a la
 * derecha de la barra de chats. Maximizar crece hasta ahí para que el paso a la página no salte.
 */
function chatsPageArea(): { left: number; top: number; width: number; height: number } {
  const rootStyle = getComputedStyle(document.documentElement);
  const rawValue = rootStyle.getPropertyValue('--app-header-height').trim();
  const parsedValue = parseFloat(rawValue);
  const top = Number.isFinite(parsedValue) ? (rawValue.endsWith('rem') ? parsedValue * parseFloat(rootStyle.fontSize) : parsedValue) : 0;
  const barra = document.querySelector<HTMLElement>('.chat-rail--fija')?.getBoundingClientRect();
  const left = barra && barra.width > 0 ? barra.right : 0;
  return { left, top, width: window.innerWidth - left, height: window.innerHeight - top };
}

export interface FloatingConversation {
  kind: 'people' | 'group';
  idConversation: number;
  /** La otra persona o el título del grupo. */
  name: string;
  avatarCode: string;
  avatarUrl: string | null;
  participants?: ChatParticipantDto[] | null;
  nudgesMuted?: boolean;
}

export default function AgentChatPanel({
  agent,
  conversation = null,
  currentUserId,
  status,
  opened,
  onClose,
}: {
  agent: ChatAgentDto | null;
  /** Chat con una persona o un grupo (en lugar de `agent`). */
  conversation?: FloatingConversation | null;
  /** Quién soy: distingue mis mensajes en los chats de personas y grupos. */
  currentUserId?: string;
  status: ChatStatusDto | null;
  opened: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const isOpen = opened && (agent !== null || conversation !== null);

  // Durante la animación de cierre el padre ya pasó `agent = null`: se conserva el último
  // chat para seguir pintando la ventana mientras se "absorbe" hacia su ícono.
  const [visibleAgent, setVisibleAgent] = useState<ChatAgentDto | null>(agent);
  const [visibleConversation, setVisibleConversation] = useState<FloatingConversation | null>(conversation);
  if (isOpen && (agent !== visibleAgent || conversation !== visibleConversation)) {
    setVisibleAgent(agent);
    setVisibleConversation(agent ? null : conversation);
  }
  const [montado, setMontado] = useState(isOpen);
  if (isOpen && !montado) setMontado(true);

  const view = describeAgentStatus(status);
  // Lo que pinta la ventana, sea agente, persona o grupo.
  const panelWindow = visibleAgent
    ? {
        clave: agentKey(visibleAgent.idAgent),
        nombre: visibleAgent.displayName,
        detalle: view.label,
        destino: `/process/chat?agent=${encodeURIComponent(visibleAgent.code)}`,
      }
    : visibleConversation
      ? {
          clave: conversationKey(visibleConversation.idConversation),
          nombre: visibleConversation.name,
          detalle: visibleConversation.kind === 'group' ? 'Grupo' : 'Conversación privada',
          destino:
            visibleConversation.kind === 'group'
              ? `/process/chat/grupo/${visibleConversation.idConversation}`
              : `/process/chat/persona/${visibleConversation.idConversation}`,
        }
      : null;

  // En el celular el panel flotante de 460 px queda como una ventanita con
  // márgenes y hay que hacer scroll de página para llegar a escribir. Ahí el
  // chat pasa a PANTALLA COMPLETA, al estilo de las aplicaciones de mensajería:
  // encabezado fijo, mensajes ocupando todo el alto y el compositor pegado
  // abajo. En escritorio no cambia nada. (Con `montado` y no `abierto`: así no
  // cambia de tamaño a mitad de la animación de cierre.)
  const enPantallaPequena = useMediaQuery('(max-width: 768px)');
  const aPantallaCompleta = Boolean(enPantallaPequena) && montado;

  // ── Animaciones (genio al abrir/cerrar, zoom al maximizar) ──
  const paperRef = useRef<HTMLDivElement | null>(null);
  const animacionRef = useRef<Animation | null>(null);
  const wasOpenRef = useRef(false);
  // Al maximizar, la ventana ya creció hasta cubrir la pantalla: se cierra sin genio.
  const maximizandoRef = useRef(false);
  // Open requested while the window was not in the DOM yet (see `setPaperNode`).
  const pendingOpenRef = useRef(false);
  // Lo último pintado, para animar desde el ref de la ventana (fuera del efecto).
  const lastRef = useRef({ aPantallaCompleta, clave: panelWindow?.clave ?? null });
  useLayoutEffect(() => {
    lastRef.current = { aPantallaCompleta, clave: panelWindow?.clave ?? null };
  });

  /** Genio (o deslizamiento en el celular) al abrir o cerrar la ventana `el`. */
  const animar = (el: HTMLDivElement, abriendo: boolean) => {
    const { aPantallaCompleta: completa, clave } = lastRef.current;
    const rect = el.getBoundingClientRect();
    const icono = clave ? findChatLauncher(clave)?.getBoundingClientRect() ?? null : null;
    const cuadros = completa
      ? // Celular: sube desde abajo / baja al cerrar (no hay barra de íconos a la vista).
        abriendo
        ? [{ transform: 'translateY(100%)' }, { transform: 'translateY(0)' }]
        : [{ transform: 'translateY(0)' }, { transform: 'translateY(100%)' }]
      : abriendo
        ? genieOpenFrames(rect, icono)
        : genieCloseFrames(rect, icono);
    const animacion = el.animate(cuadros, {
      duration: abriendo ? GENIE_OPEN_MS : GENIE_CLOSE_MS,
      easing: abriendo ? GENIE_OPEN_EASING : GENIE_CLOSE_EASING,
      // Al abrir, `backwards` mantiene el primer cuadro (dentro del ícono) mientras espera;
      // al cerrar se queda en el último cuadro (invisible) hasta desmontarse.
      fill: abriendo ? 'backwards' : 'forwards',
    });
    animacionRef.current = animacion;
    if (abriendo) {
      // Al abrir, el primer pintado del hilo (mensajes, markdown, avatares) bloquea el hilo
      // principal y el navegador se saltaba la animación entera. Se queda en pausa dentro del
      // ícono y arranca dos cuadros después, ya pintado.
      animacion.pause();
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (animacionRef.current === animacion) animacion.play();
        })
      );
    }
    animacion.onfinish = () => {
      if (animacionRef.current !== animacion) return;
      animacionRef.current = null;
      if (!abriendo) setMontado(false);
    };
  };

  /**
   * La PRIMERA vez que se abre, el `Affix` de Mantine pinta la ventana en un portal que se crea
   * un instante después (en un efecto): cuando corre el efecto de abajo, la ventana aún no está
   * en el DOM y la animación se saltaba. Por eso solo se veía de la segunda vez en adelante.
   * Este ref se llama justo cuando la ventana entra al DOM (antes de pintarse): ahí arranca la
   * apertura que quedó pendiente, sin que se alcance a ver la ventana grande un instante.
   */
  const setPaperNode = (node: HTMLDivElement | null) => {
    paperRef.current = node;
    if (node && pendingOpenRef.current) {
      pendingOpenRef.current = false;
      if (typeof node.animate === 'function') animar(node, true);
    }
  };

  useLayoutEffect(() => {
    if (isOpen === wasOpenRef.current) return;
    wasOpenRef.current = isOpen;
    const el = paperRef.current;
    animacionRef.current?.cancel();
    animacionRef.current = null;
    pendingOpenRef.current = false;

    const sinAnimacion =
      typeof window === 'undefined' ||
      typeof Element.prototype.animate !== 'function' ||
      prefersReducedMotion() ||
      (!isOpen && maximizandoRef.current);
    if (sinAnimacion || (!el && !isOpen)) {
      maximizandoRef.current = false;
      if (!isOpen) setMontado(false);
      return;
    }
    if (!el) {
      // Opening and the window is not in the DOM yet (first time): `setPaperNode` animates it.
      pendingOpenRef.current = true;
      return;
    }
    animar(el, isOpen);
    // Only the change of `isOpen` matters; the rest is read from `lastRef`.
  }, [isOpen]);

  useEffect(() => () => animacionRef.current?.cancel(), []);

  // Maximizar: la ventana crece hasta ocupar el lugar de la página de chats (debajo de la
  // cabecera y al lado de la barra de chats) y luego se abre esa página. Se cierra solo cuando
  // la página ya pintó su conversación, para no dejar ver un instante la pantalla de atrás.
  const destinoMaximizar = panelWindow?.destino ?? '';
  const maximizar = (e: MouseEvent<HTMLAnchorElement>) => {
    // Ctrl/Cmd/Shift o botón del medio: que el enlace haga lo suyo (pestaña nueva, etc.).
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    const el = paperRef.current;
    maximizandoRef.current = true;
    if (el && typeof el.animate === 'function' && !prefersReducedMotion()) {
      animacionRef.current?.cancel();
      const fromRect = el.getBoundingClientRect();
      // Se suelta del Affix (anclado abajo a la derecha) para poder crecer hasta los cuatro
      // bordes con su tamaño real. React no maneja `position`, así que no lo pisa; la ventana
      // se desmonta al cerrar.
      el.style.position = 'fixed';
      const animacion = el.animate(zoomFrames(fromRect, chatsPageArea()), {
        duration: 320,
        easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
        fill: 'forwards',
      });
      animacionRef.current = animacion;
      animacion.onfinish = () => goToChatsPage();
    } else {
      goToChatsPage();
    }
  };
  const goToChatsPage = () => {
    // Si venía de Solicitudes (u otra pantalla), al cerrar el chat ampliado vuelve ahí.
    // Se guarda en sessionStorage y también en ?from= por si el almacenamiento falla.
    const fromUrl = `${window.location.pathname}${window.location.search}`;
    let destino = destinoMaximizar;
    if (!pathname.startsWith('/process/chat') && fromUrl.startsWith('/') && !fromUrl.startsWith('/process/chat')) {
      saveRouteBeforeChat(fromUrl);
      const sep = destino.includes('?') ? '&' : '?';
      destino = `${destino}${sep}from=${encodeURIComponent(fromUrl)}`;
    }
    router.push(destino);
    // Ya en la página de chats solo cambia la consulta (la ruta no): no hay cambio de ruta
    // que esperar.
    if (pathname.startsWith('/process/chat')) closeWhenPagePainted();
    // Respaldo: si la navegación no llega, la ventana no se queda tapando la pantalla.
    window.setTimeout(() => {
      if (maximizandoRef.current) onClose();
    }, 8000);
  };
  useEffect(() => {
    if (!maximizandoRef.current || !pathname.startsWith('/process/chat')) return;
    closeWhenPagePainted();
    // Solo importa la llegada a la página de chats.
  }, [pathname]);

  /**
   * Antes la ventana se cerraba apenas cambiaba la dirección, cuando la página de chats aún no
   * había pintado nada: se veía la ventana grande, luego un instante la pantalla de atrás y
   * después el chat. Ahora espera a que aparezca el marco de la conversación (`.chat-escritorio`)
   * y se desvanece encima de él. Si no aparece en 5 s, se cierra igual.
   */
  const closeWhenPagePainted = () => {
    const inicio = performance.now();
    const check = () => {
      if (!maximizandoRef.current) return;
      const pageEl = document.querySelector('.chat-escritorio');
      if (!pageEl && performance.now() - inicio < 5000) {
        requestAnimationFrame(check);
        return;
      }
      const el = paperRef.current;
      if (!pageEl || !el || typeof el.animate !== 'function' || prefersReducedMotion()) {
        onClose();
        return;
      }
      // Un cuadro más para que la conversación termine de pintarse debajo.
      requestAnimationFrame(() => {
        const fundido = el.animate([{ opacity: 1 }, { opacity: 0 }], {
          duration: 160,
          easing: 'ease-out',
          fill: 'forwards',
        });
        fundido.onfinish = () => onClose();
      });
    };
    requestAnimationFrame(check);
  };

  // Con el chat a pantalla completa, el documento de atrás no debe desplazarse:
  // si no, el "rebote" del scroll de la página se lleva el teclado y el
  // compositor. Se restaura siempre al cerrar o al desmontar.
  useEffect(() => {
    if (!aPantallaCompleta) return;
    const previo = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previo;
    };
  }, [aPantallaCompleta]);

  return (
    <Affix
      position={
        aPantallaCompleta ? { top: 0, right: 0, bottom: 0, left: 0 } : { bottom: 24, right: 24 }
      }
      // Below every modal: previews and dialogs must cover the panel (lib/ui/zIndex.ts).
      zIndex={Z_INDEX.agentChatPanel}
    >
      {montado && panelWindow ? (
            <Paper
              ref={setPaperNode}
              style={{
                // dvh y no vh en los dos casos: con el teclado del móvil
                // abierto, `vh` sigue midiendo la pantalla completa y el
                // compositor queda debajo, tapado.
                width: aPantallaCompleta ? '100vw' : 'min(460px, calc(100vw - 32px))',
                // `--alto-visible` la publica useAltoVisible desde el visual
                // viewport, que es lo único que se encoge cuando sale el teclado
                // del celular. Sin eso el compositor queda debajo del teclado.
                height: aPantallaCompleta
                  ? 'var(--alto-visible, 100dvh)'
                  : 'min(640px, calc(var(--alto-visible, 100dvh) - 96px))',
                // EL ALTO NO ALCANZA — hacía falta también el DESPLAZAMIENTO.
                //
                // Reporte de un usuario en iPhone: "cuando se le da al cuadro
                // para escribir se pierde el máximo del chat, no se respetan
                // los tamaños, y cuando sale el teclado se vuelve loco".
                //
                // La causa: al enfocar la caja, iOS corre el *visual viewport*
                // hacia abajo dentro del de diseño para dejar el campo a la
                // vista (`vv.offsetTop`). Este panel es `fixed` anclado al
                // viewport de DISEÑO, así que se queda arriba: su parte
                // superior se sale de la pantalla y por debajo asoma la página
                // que está detrás. El alto correcto no sirve de nada si el
                // bloque está corrido.
                //
                // `--desplazamiento-visible` la publica el mismo hook con
                // `vv.offsetTop`. Con el margen, el panel baja exactamente lo
                // que bajó el área visible y queda calcado sobre ella. Va como
                // margen y no como `transform` porque las animaciones de abrir,
                // cerrar y maximizar (genie.ts) usan `transform`.
                marginTop: aPantallaCompleta ? 'var(--desplazamiento-visible, 0px)' : undefined,
                borderRadius: aPantallaCompleta ? 0 : undefined,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
              }}
              className='chat-panel'
              shadow='xl'
              radius={aPantallaCompleta ? 0 : 'lg'}
              withBorder
              role='dialog'
              aria-label={`Conversación con ${panelWindow.nombre}`}
            >
              <Group
                justify='space-between'
                p='sm'
                wrap='nowrap'
                className='chat-panel__header'
              >
                <Group gap='sm' wrap='nowrap' style={{ minWidth: 0 }}>
                  {aPantallaCompleta && (
                    <ActionIcon
                      variant='subtle'
                      color='gray'
                      onClick={onClose}
                      aria-label='Volver'
                    >
                      <IconArrowLeft size={20} />
                    </ActionIcon>
                  )}
                  {visibleAgent ? (
                    <AgentAvatar
                      code={visibleAgent.code}
                      working={visibleAgent.busy}
                      displayName={visibleAgent.displayName}
                      avatarUrl={visibleAgent.avatarUrl}
                      status={status}
                      size={34}
                      withTooltip={false}
                    />
                  ) : visibleConversation ? (
                    <AgentAvatar
                      code={visibleConversation.avatarCode}
                      displayName={visibleConversation.name}
                      avatarUrl={visibleConversation.avatarUrl}
                      size={34}
                      showStatus={false}
                      withTooltip={false}
                    />
                  ) : null}
                  <Box style={{ minWidth: 0 }}>
                    <Text fw={600} size='sm' lineClamp={1}>
                      {panelWindow.nombre}
                    </Text>
                    <Text size='xs' lineClamp={1} className='chat-text-muted'>
                      {panelWindow.detalle}
                    </Text>
                  </Box>
                </Group>

                <Group gap={2} wrap='nowrap'>
                  {/* A pantalla completa no tiene sentido "maximizar" ni una
                      segunda X: la flecha de la izquierda ya cierra. */}
                  {!aPantallaCompleta && (
                  <Tooltip label='Abrir en la página de chats' withArrow>
                    <ActionIcon
                      component={Link}
                      href={destinoMaximizar}
                      variant='subtle'
                      color='gray'
                      onClick={maximizar}
                      aria-label='Abrir en la página de chats'
                    >
                      <IconArrowsMaximize size={16} />
                    </ActionIcon>
                  </Tooltip>
                  )}
                  {!aPantallaCompleta && (
                  <ActionIcon
                    variant='subtle'
                    color='gray'
                    onClick={onClose}
                    aria-label='Cerrar conversación'
                  >
                    <IconX size={18} />
                  </ActionIcon>
                  )}
                </Group>
              </Group>

              {/* `key`: al pasar de un chat a otro, el hilo arranca limpio. */}
              <Box key={panelWindow.clave} style={{ flex: 1, minHeight: 0, display: 'flex' }}>
                {visibleAgent ? (
                  <ChatThread agent={visibleAgent} active={isOpen} />
                ) : visibleConversation?.kind === 'group' ? (
                  <ChatThread
                    group={{
                      idConversation: visibleConversation.idConversation,
                      title: visibleConversation.name,
                      participants: visibleConversation.participants,
                    }}
                    currentUserId={currentUserId}
                    active={isOpen}
                  />
                ) : visibleConversation ? (
                  <ChatThread
                    person={{
                      idConversation: visibleConversation.idConversation,
                      name: visibleConversation.name,
                      nudgesMuted: Boolean(visibleConversation.nudgesMuted),
                    }}
                    currentUserId={currentUserId}
                    active={isOpen}
                  />
                ) : null}
              </Box>
            </Paper>
      ) : null}
    </Affix>
  );
}
