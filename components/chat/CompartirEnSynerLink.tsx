'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import {
  ActionIcon,
  Alert,
  Box,
  Button,
  Container,
  Group,
  Image,
  Loader,
  Skeleton,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
  UnstyledButton,
} from '@mantine/core';
import { IconAlertCircle, IconSearch, IconSend, IconShare, IconX } from '@tabler/icons-react';
import AgentAvatar from './AgentAvatar';
import IconoAdjunto from './IconoAdjunto';
import { useChatOverview } from './useChatOverview';
import { notifyChatRefresh, toPlainPreview } from '../../lib/chat/client';
import { buildRailItems } from '../../lib/chat/rail';
import { esImagenAdjunta, formatBytes } from '../../lib/chat/attachments';
import {
  armarComentarioInicial,
  claveUltimoDestino,
  destinoInicial,
  filtrarDestinos,
  hrefDestino,
  mensajeDeAviso,
  normalizarTextoCompartido,
  ordenarDestinos,
  validarCompartido,
  type DestinoCompartir,
  type TipoDestino,
} from '../../lib/chat/compartir-share-target';
import { borrarLoteCompartido, leerLoteCompartido } from '../../lib/chat/compartir-idb';

/**
 * Pantalla «COMPARTIR EN SYNERLINK» (2026-10-22).
 *
 * Llega aquí lo que se comparte desde otra app del celular (ver
 * lib/chat/compartir-share-target.ts). Pedido de Nicolás: «para que pueda compartir
 * archivos a Orus desde otras apps» de UN toque. Por eso:
 *
 *   - los AGENTES van primero, con Orus arriba si la persona lo tiene;
 *   - viene PRESELECCIONADO el último destino usado (o Orus), así que basta
 *     con tocar «Enviar».
 *
 * El envío es el MISMO del chat (POST /api/chat/conversations/<id>/messages
 * multipart): al agente le llega un mensaje normal con adjuntos, con los
 * mismos permisos y validaciones.
 */

interface ArchivoEnPantalla {
  clave: string;
  name: string;
  type: string;
  size: number;
  blob: Blob | null;
  vista: string | null;
}

const FILTROS: { valor: 'todos' | TipoDestino; etiqueta: string }[] = [
  { valor: 'todos', etiqueta: 'Todos' },
  { valor: 'agente', etiqueta: 'Agentes' },
  { valor: 'grupo', etiqueta: 'Grupos' },
  { valor: 'persona', etiqueta: 'Personas' },
  { valor: 'proyecto', etiqueta: 'Proyectos' },
];

function leerUltimo(userId: string | undefined): string | null {
  if (!userId) return null;
  try {
    return window.localStorage.getItem(claveUltimoDestino(userId));
  } catch {
    return null;
  }
}

function guardarUltimo(userId: string | undefined, key: string): void {
  if (!userId) return;
  try {
    window.localStorage.setItem(claveUltimoDestino(userId), key);
  } catch {
    /* solo comodidad */
  }
}

async function leerError(res: Response, porDefecto: string): Promise<string> {
  try {
    const data = (await res.json()) as { error?: unknown };
    if (typeof data?.error === 'string' && data.error.trim()) return data.error;
  } catch {
    /* sin cuerpo */
  }
  return porDefecto;
}

export default function CompartirEnSynerLink() {
  const router = useRouter();
  const sp = useSearchParams();
  const { data: session } = useSession();
  const userId = session?.user?.id;
  const overview = useChatOverview({ primeraCargaInmediata: true });

  const loteId = sp.get('lote');
  const [archivos, setArchivos] = useState<ArchivoEnPantalla[]>([]);
  const [comentario, setComentario] = useState('');
  const [cargandoLote, setCargandoLote] = useState(Boolean(loteId));
  const [aviso, setAviso] = useState<string | null>(mensajeDeAviso(sp.get('aviso')));
  const [error, setError] = useState<string | null>(sp.get('error'));
  const [proyectos, setProyectos] = useState<DestinoCompartir[]>([]);
  const [filtro, setFiltro] = useState<'todos' | TipoDestino>('todos');
  const [busqueda, setBusqueda] = useState('');
  const [seleccion, setSeleccion] = useState<DestinoCompartir | null>(null);
  const [enviando, setEnviando] = useState(false);
  const elegidoPorPersona = useRef(false);

  /* ── Lo compartido: lote del service worker o texto en la URL (respaldo) ── */
  useEffect(() => {
    let vivo = true;
    const creadas: string[] = [];
    (async () => {
      const textoUrl = normalizarTextoCompartido({
        title: sp.get('title'),
        text: sp.get('text'),
        url: sp.get('url'),
      });
      if (!loteId) {
        setComentario(armarComentarioInicial(textoUrl));
        return;
      }
      try {
        const lote = await leerLoteCompartido(loteId);
        if (!vivo) return;
        if (!lote) {
          setAviso(mensajeDeAviso('lote-vencido'));
          return;
        }
        setComentario(armarComentarioInicial(normalizarTextoCompartido(lote)));
        setArchivos(
          lote.files.map((f, i) => {
            const vista =
              f.blob && esImagenAdjunta({ contentType: f.type, fileName: f.name })
                ? URL.createObjectURL(f.blob)
                : null;
            if (vista) creadas.push(vista);
            return { clave: `${i}-${f.name}`, name: f.name, type: f.type, size: f.size, blob: f.blob, vista };
          })
        );
      } catch {
        if (vivo) setAviso(mensajeDeAviso('recepcion'));
      } finally {
        if (vivo) setCargandoLote(false);
      }
    })();
    return () => {
      vivo = false;
      creadas.forEach((u) => URL.revokeObjectURL(u));
    };
    // Solo al abrir: lo compartido no cambia mientras se está en la pantalla.
  }, [loteId]);

  /* ── Proyectos (aparte: la bandeja del chat no los trae) ── */
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/chat/compartir/proyectos', { signal: controller.signal, cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { destinos: [] }))
      .then((d: { destinos?: DestinoCompartir[] }) => setProyectos(Array.isArray(d.destinos) ? d.destinos : []))
      .catch(() => {
        /* sin proyectos: se comparte al resto */
      });
    return () => controller.abort();
  }, []);

  /* ── Destinos: agentes, personas y grupos de la bandeja + proyectos ── */
  const destinos = useMemo(() => {
    const items = buildRailItems({
      agents: overview.agents,
      conversationByAgent: overview.conversationByAgent,
      unreadByAgent: overview.unreadByAgent,
      people: overview.people,
      groups: overview.groups,
      miId: userId,
      toPreview: toPlainPreview,
    });
    const base: DestinoCompartir[] = items.map((it) => {
      if (it.kind === 'agent') {
        const conv = it.idAgent !== undefined ? overview.conversationByAgent.get(it.idAgent) : undefined;
        return {
          key: it.key,
          tipo: 'agente',
          nombre: it.name,
          detalle: 'Agente',
          avatarCode: it.avatarCode,
          avatarUrl: it.avatarUrl,
          avatarVersion: it.avatarVersion ?? null,
          idConversation: conv?.id ?? null,
          idAgent: it.idAgent,
          agentCode: it.agentCode,
          lastMessageAt: it.lastMessageAt,
        };
      }
      return {
        key: it.key,
        tipo: it.kind === 'people' ? 'persona' : 'grupo',
        nombre: it.name,
        detalle: it.kind === 'people' ? 'Persona' : 'Grupo',
        avatarCode: it.avatarCode,
        avatarUrl: it.avatarUrl,
        avatarVersion: it.avatarVersion ?? null,
        idConversation: it.idConversation ?? null,
        lastMessageAt: it.lastMessageAt,
      };
    });
    return ordenarDestinos([...base, ...proyectos]);
  }, [overview.agents, overview.conversationByAgent, overview.unreadByAgent, overview.people, overview.groups, proyectos, userId]);

  // Preselección: el último destino usado (o Orus). Solo mientras la persona
  // no haya elegido otro; si la lista se refresca, no se le cambia.
  useEffect(() => {
    if (elegidoPorPersona.current || destinos.length === 0) return;
    const inicial = destinoInicial(destinos, leerUltimo(userId));
    setSeleccion((actual) => (actual && destinos.some((d) => d.key === actual.key) ? actual : inicial));
  }, [destinos, userId]);

  const visibles = useMemo(
    () => filtrarDestinos(filtro === 'todos' ? destinos : destinos.filter((d) => d.tipo === filtro), busqueda),
    [destinos, filtro, busqueda]
  );

  const validacion = useMemo(() => validarCompartido(archivos, comentario), [archivos, comentario]);
  const faltaArchivo = archivos.some((a) => !a.blob);
  const puedeEnviar = Boolean(seleccion) && validacion.ok && !faltaArchivo && !enviando && !cargandoLote;

  const quitar = (clave: string) => {
    setArchivos((prev) => {
      const fuera = prev.find((a) => a.clave === clave);
      if (fuera?.vista) URL.revokeObjectURL(fuera.vista);
      return prev.filter((a) => a.clave !== clave);
    });
  };

  const cancelar = useCallback(async () => {
    if (loteId) await borrarLoteCompartido(loteId);
    router.replace('/process/chat');
  }, [loteId, router]);

  const enviar = async () => {
    if (!seleccion || !puedeEnviar) return;
    setEnviando(true);
    setError(null);
    try {
      let idConversation = seleccion.idConversation;
      // Agente con el que aún no hay hilo: se abre igual que desde el chat.
      if (idConversation === null && seleccion.tipo === 'agente' && seleccion.idAgent) {
        const res = await fetch('/api/chat/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idAgent: seleccion.idAgent }),
        });
        if (!res.ok) throw new Error(await leerError(res, 'No se pudo abrir la conversación.'));
        const data = (await res.json()) as { conversation?: { id?: number } };
        idConversation = data.conversation?.id ?? null;
      }
      if (!idConversation) throw new Error('No se pudo abrir la conversación.');

      const form = new FormData();
      form.append('body', comentario.trim());
      for (const a of archivos) {
        if (a.blob) form.append('files', new File([a.blob], a.name, { type: a.type || a.blob.type }));
      }
      const res = await fetch(`/api/chat/conversations/${idConversation}/messages`, { method: 'POST', body: form });
      if (!res.ok) throw new Error(await leerError(res, 'No se pudo enviar. Intente de nuevo.'));

      guardarUltimo(userId, seleccion.key);
      if (loteId) await borrarLoteCompartido(loteId);
      notifyChatRefresh();
      router.replace(hrefDestino(seleccion, idConversation));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo enviar. Intente de nuevo.');
      setEnviando(false);
    }
  };

  const sinChat = overview.ready && !overview.canUseChat;

  return (
    <Container size='sm' px='md' py='md' style={{ paddingBottom: 110 }}>
      <Stack gap='md'>
        <Group gap='xs' wrap='nowrap'>
          <IconShare size={22} style={{ color: 'var(--app-accent, #2563eb)', flexShrink: 0 }} aria-hidden />
          <Title order={3} style={{ fontSize: 'clamp(1.1rem, 4.5vw, 1.4rem)' }}>
            Compartir en SynerLink
          </Title>
        </Group>

        {aviso && (
          <Alert color='yellow' radius='md' p='sm' icon={<IconAlertCircle size={16} />}>
            <Text size='sm'>{aviso}</Text>
          </Alert>
        )}
        {error && (
          <Alert color='red' radius='md' p='sm' icon={<IconAlertCircle size={16} />} role='alert'>
            <Text size='sm'>{error}</Text>
          </Alert>
        )}
        {sinChat && (
          <Alert color='red' radius='md' p='sm' icon={<IconAlertCircle size={16} />}>
            <Text size='sm'>Su usuario no tiene el Chat habilitado. Pídale acceso a Tecnología.</Text>
          </Alert>
        )}

        {/* ── Vista previa ── */}
        {cargandoLote ? (
          <Skeleton height={88} radius='md' />
        ) : (
          archivos.length > 0 && (
            <Stack gap={6}>
              <Text size='sm' fw={600}>
                {archivos.length === 1 ? '1 archivo' : `${archivos.length} archivos`}
              </Text>
              {archivos.map((a, i) => {
                const err = validacion.errores[i] ?? (!a.blob ? `El archivo "${a.name}" no se pudo recibir.` : null);
                return (
                  <Box
                    key={a.clave}
                    className='chat-agent-card chat-agent-card--compact'
                    style={err ? { borderColor: 'var(--mantine-color-red-6)' } : undefined}
                  >
                    <Group gap='sm' wrap='nowrap'>
                      {a.vista ? (
                        <Image src={a.vista} alt='' w={48} h={48} radius='sm' fit='cover' style={{ flexShrink: 0 }} />
                      ) : (
                        <Box
                          w={48}
                          h={48}
                          style={{
                            display: 'grid',
                            placeItems: 'center',
                            borderRadius: 8,
                            flexShrink: 0,
                            background: 'color-mix(in srgb, var(--app-accent, #2563eb) 10%, transparent)',
                          }}
                        >
                          <IconoAdjunto fileName={a.name} contentType={a.type || null} size={24} />
                        </Box>
                      )}
                      <Box style={{ flex: 1, minWidth: 0 }}>
                        <Text size='sm' fw={600} lineClamp={1} style={{ wordBreak: 'break-all' }}>
                          {a.name}
                        </Text>
                        <Text size='xs' className='chat-text-muted'>
                          {formatBytes(a.size)}
                        </Text>
                        {err && (
                          <Text size='xs' c='red'>
                            {err}
                          </Text>
                        )}
                      </Box>
                      <ActionIcon
                        variant='subtle'
                        color='gray'
                        onClick={() => quitar(a.clave)}
                        aria-label={`Quitar ${a.name}`}
                        disabled={enviando}
                      >
                        <IconX size={18} />
                      </ActionIcon>
                    </Group>
                  </Box>
                );
              })}
              {validacion.errorGeneral && archivos.length > 0 && (
                <Text size='xs' c='red'>
                  {validacion.errorGeneral}
                </Text>
              )}
            </Stack>
          )
        )}

        <Textarea
          label='Comentario (opcional)'
          value={comentario}
          onChange={(e) => setComentario(e.currentTarget.value)}
          autosize
          minRows={2}
          maxRows={6}
          radius='md'
          disabled={enviando}
          // 16 px: con menos, iOS hace zoom al enfocar.
          styles={{ input: { fontSize: 16 } }}
        />

        {/* ── Destino ── */}
        <Stack gap={8}>
          <Text size='sm' fw={600}>
            Enviar a
          </Text>
          <Group gap={6} wrap='nowrap' style={{ overflowX: 'auto', paddingBottom: 2 }}>
            {FILTROS.map((f) => (
              <Button
                key={f.valor}
                size='compact-sm'
                radius='xl'
                variant={filtro === f.valor ? 'filled' : 'light'}
                onClick={() => setFiltro(f.valor)}
                style={{ flexShrink: 0 }}
              >
                {f.etiqueta}
              </Button>
            ))}
          </Group>
          <TextInput
            value={busqueda}
            onChange={(e) => setBusqueda(e.currentTarget.value)}
            placeholder='Buscar conversación…'
            leftSection={<IconSearch size={16} />}
            radius='md'
            styles={{ input: { fontSize: 16 } }}
            aria-label='Buscar conversación'
          />

          {!overview.ready && destinos.length === 0 ? (
            <Stack gap={6}>
              <Skeleton height={52} radius='md' />
              <Skeleton height={52} radius='md' />
              <Skeleton height={52} radius='md' />
            </Stack>
          ) : visibles.length === 0 ? (
            <Text size='sm' className='chat-text-muted'>
              No hay conversaciones que coincidan.
            </Text>
          ) : (
            <Stack gap={6} role='listbox' aria-label='Conversaciones'>
              {visibles.map((d) => {
                const activo = seleccion?.key === d.key;
                return (
                  <UnstyledButton
                    key={d.key}
                    role='option'
                    aria-selected={activo}
                    onClick={() => {
                      elegidoPorPersona.current = true;
                      setSeleccion(d);
                    }}
                    disabled={enviando}
                    className={`chat-agent-card chat-agent-card--compact${activo ? ' chat-agent-card--selected' : ''}`}
                  >
                    <Group gap='sm' wrap='nowrap'>
                      <AgentAvatar
                        code={d.avatarCode}
                        displayName={d.nombre}
                        avatarUrl={d.avatarUrl}
                        avatarVersion={d.avatarVersion ?? null}
                        size={36}
                        showStatus={false}
                        withTooltip={false}
                      />
                      <Box style={{ flex: 1, minWidth: 0 }}>
                        <Text size='sm' fw={600} lineClamp={1}>
                          {d.nombre}
                        </Text>
                        {d.detalle && (
                          <Text size='xs' className='chat-text-muted' lineClamp={1}>
                            {d.detalle}
                          </Text>
                        )}
                      </Box>
                    </Group>
                  </UnstyledButton>
                );
              })}
            </Stack>
          )}
        </Stack>
      </Stack>

      {/* ── Barra fija de abajo: un toque para enviar ── */}
      <Box
        style={{
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 50,
          padding: '12px 16px calc(12px + env(safe-area-inset-bottom))',
          background: 'var(--app-surface, var(--mantine-color-body))',
          borderTop: '1px solid var(--app-border, var(--border-subtle))',
        }}
      >
        <Group gap='sm' wrap='nowrap' maw={720} mx='auto'>
          <Button variant='default' radius='md' onClick={() => void cancelar()} disabled={enviando}>
            Cancelar
          </Button>
          <Button
            radius='md'
            style={{ flex: 1, minWidth: 0 }}
            leftSection={enviando ? <Loader size={16} color='white' /> : <IconSend size={18} />}
            onClick={() => void enviar()}
            disabled={!puedeEnviar}
          >
            <Text span inherit truncate>
              {seleccion ? `Enviar a ${seleccion.nombre}` : 'Elija una conversación'}
            </Text>
          </Button>
        </Group>
      </Box>
    </Container>
  );
}
