'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Collapse,
  FileInput,
  Group,
  Image,
  Modal,
  NumberInput,
  Paper,
  Popover,
  Stack,
  Switch,
  Text,
  Title,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import {
  IconAlertTriangle,
  IconArrowBackUp,
  IconArrowLeft,
  IconArrowBackUpDouble,
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconDownload,
  IconExternalLink,
  IconEye,
  IconFile,
  IconFileTypePdf,
  IconFlask,
  IconFolder,
  IconLink,
  IconMail,
  IconMailOpened,
  IconNotes,
  IconPaperclip,
  IconPhoto,
  IconRefresh,
  IconRobot,
  IconSend,
  IconTrash,
} from '@tabler/icons-react';
import toast from 'react-hot-toast';
import { CORREO_MAX_ADJUNTO_RESPUESTA_BYTES, CORREO_MAX_ADJUNTOS_RESPUESTA } from '../../lib/correo/constants';
import { ACUSE_A_TODOS, ACUSE_ETIQUETA, enlaceSolicitud } from '../../lib/correo/acuse';
import { fragmentoAcuse, logoAcuseUrl } from '../../lib/correo/plantillas/acuse.html';
import { htmlATexto } from '../../lib/correo/sanitize';
import type { AdjuntoInfo, ResultadoAcuse } from '../../lib/correo/types';
import { correoApi, esCancelada, fechaCorta, fechaLarga, PREVISUALIZABLES, tamano, urlAdjunto, urlSolicitud, type ConcesionCorreo, type HiloVista, type MensajeVista } from './correoClient';
import ConsultarAgenteModal from './ConsultarAgenteModal';
import { EsqueletoHiloCorreo } from './Esqueletos';
import EditorMarkdown from './EditorMarkdown';
import HtmlSeguro from './HtmlSeguro';
import { AvatarPersona } from './ui';
import css from './correo.module.css';

/**
 * Vista del HILO, al estilo Gmail (2026-10-16: se abre EN EL LUGAR de la lista, con las carpetas a la vista,
 * no en un panel lateral): barra arriba con ← para volver y las acciones (convertir en solicitud, vincular,
 * leído/no leído, abrir en Outlook, actualizar), el asunto grande con sus etiquetas, los mensajes
 * apilados (los anteriores plegados en una línea —remitente, extracto y fecha— y el último
 * desplegado), los adjuntos como fichas con vista previa y, al final, «Responder» /
 * «Responder a todos», que abren el editor en el mismo hilo (con negrita, cursiva, listas
 * y enlaces). El cuerpo siempre llega saneado del servidor y se muestra aislado.
 */
export interface HiloCorreoProps {
  conversationId: string | null;
  /** ← Volver a la lista (o el botón «atrás» del navegador). */
  onVolver: () => void;
  /** Etiqueta de la carpeta desde la que se abrió (ficha junto al asunto). */
  carpeta?: string | null;
  /** Leído / no leído escribe en el buzón: solo con CORREO_ETIQUETAR_HABILITADO. */
  escritura?: boolean;
  /** Marca el hilo (la página actualiza la lista y los contadores de forma optimista); false si falló y se revirtió. */
  marcarHilo?: (conversationId: string, leido: boolean) => Promise<boolean>;
  /** Abrir la simulación con los mensajes del hilo (crear una solicitud con este hilo). */
  onCrearSolicitud: (mensajesIds: string[]) => void;
  /** El hilo cambió (vínculo, notas, respuesta): refrescar la bandeja al cerrar. */
  onCambio: () => void;
  /** Responder desde SynerLink (Mail.Send) habilitado en el ambiente. */
  envioHabilitado?: boolean;
  /** Nombre de la persona (firma del texto «Informar en el hilo»). */
  nombreOperador?: string;
  /** Correo de la persona (para mostrar «para mí»). */
  correoOperador?: string;
}

type Resultado = { color: 'green' | 'red' | 'yellow'; texto: string; reintentarAcuse?: { confirmarExterno: boolean } } | null;

const lista = (ds: Array<{ nombre: string; correo: string }>, yo: string) =>
  ds.map((d) => (d.correo && d.correo.toLowerCase() === yo ? 'mí' : d.nombre || d.correo)).join(', ');

function FichaAdjunto({ m, a, onVer }: { m: MensajeVista; a: AdjuntoInfo; onVer: (a: AdjuntoInfo) => void }) {
  const tipo = a.tipo.toLowerCase();
  const esImagen = tipo.startsWith('image/');
  const esPdf = tipo === 'application/pdf';
  const visible = PREVISUALIZABLES.has(tipo);
  return (
    <Paper withBorder radius='md' p={8} w={{ base: '100%', xs: 220 }} data-testid='correo-adjunto'>
      <Group gap={8} wrap='nowrap'>
        <Box c={esPdf ? 'red' : esImagen ? 'blue' : 'dimmed'} style={{ flexShrink: 0, display: 'flex' }}>
          {esPdf ? <IconFileTypePdf size={28} /> : esImagen ? <IconPhoto size={28} /> : <IconFile size={28} />}
        </Box>
        <Stack gap={0} style={{ minWidth: 0, flex: 1 }}>
          <Text size='sm' fw={500} truncate title={a.nombre}>
            {a.nombre}
          </Text>
          <Text size='xs' c='dimmed'>
            {tamano(a.tamano)}
          </Text>
        </Stack>
        <Group gap={0} wrap='nowrap'>
          {visible && (
            <Tooltip label='Vista previa'>
              {esImagen ? (
                <ActionIcon variant='subtle' color='gray' onClick={() => onVer(a)} aria-label={`Ver ${a.nombre}`}>
                  <IconEye size={18} />
                </ActionIcon>
              ) : (
                <ActionIcon component='a' href={urlAdjunto(m.id, a.id, true)} target='_blank' rel='noopener noreferrer' variant='subtle' color='gray' aria-label={`Ver ${a.nombre}`}>
                  <IconEye size={18} />
                </ActionIcon>
              )}
            </Tooltip>
          )}
          <Tooltip label='Descargar'>
            <ActionIcon component='a' href={urlAdjunto(m.id, a.id)} variant='subtle' color='gray' aria-label={`Descargar ${a.nombre}`}>
              <IconDownload size={18} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>
    </Paper>
  );
}

function MensajeHilo({
  m,
  abierto,
  onToggle,
  remotas,
  yo,
  onVerAdjunto,
}: {
  m: MensajeVista;
  abierto: boolean;
  onToggle: () => void;
  remotas: boolean;
  yo: string;
  onVerAdjunto: (m: MensajeVista, a: AdjuntoInfo) => void;
}) {
  const [detalles, setDetalles] = useState(false);
  const extracto = useMemo(() => (abierto ? '' : htmlATexto(m.html).replace(/\s+/g, ' ').slice(0, 180)), [abierto, m.html]);
  const visibles = m.adjuntos.filter((a) => !a.enLinea);
  return (
    <Card withBorder radius='md' p={0} data-testid='correo-hilo-mensaje' data-abierto={abierto ? '1' : '0'}>
      <UnstyledButton
        onClick={onToggle}
        px='sm'
        py={abierto ? 'sm' : 8}
        w='100%'
        aria-expanded={abierto}
        aria-label={abierto ? `Plegar el correo de ${m.de.nombre}` : `Desplegar el correo de ${m.de.nombre}`}
        data-testid='correo-hilo-mensaje-cabecera'
      >
        <Group wrap='nowrap' gap='sm' align={abierto ? 'flex-start' : 'center'}>
          <AvatarPersona nombre={m.de.nombre} correo={m.de.correo} size={abierto ? 40 : 32} />
          <Box style={{ flex: 1, minWidth: 0 }}>
            <Group gap={6} wrap='nowrap' style={{ minWidth: 0 }}>
              <Text size='sm' fw={700} truncate style={{ flexShrink: 0, maxWidth: '60%' }}>
                {m.de.nombre || m.de.correo}
              </Text>
              {abierto && (
                <Text size='xs' c='dimmed' truncate>
                  &lt;{m.de.correo}&gt;
                </Text>
              )}
            </Group>
            {abierto ? (
              (m.para.length > 0 || m.cc.length > 0) && (
                <Group gap={2} wrap='nowrap' style={{ minWidth: 0 }}>
                  <Text size='xs' c='dimmed' truncate>
                    para {lista(m.para, yo)}
                    {m.cc.length ? `, cc ${lista(m.cc, yo)}` : ''}
                  </Text>
                  <ActionIcon
                    size='xs'
                    variant='subtle'
                    color='gray'
                    component='span'
                    role='button'
                    tabIndex={0}
                    aria-label='Ver detalles del correo'
                    onClick={(e: React.MouseEvent) => {
                      e.stopPropagation();
                      setDetalles((v) => !v);
                    }}
                    data-testid='correo-hilo-detalles'
                  >
                    {detalles ? <IconChevronUp size={12} /> : <IconChevronDown size={12} />}
                  </ActionIcon>
                </Group>
              )
            ) : (
              <Text size='xs' c='dimmed' truncate data-testid='correo-hilo-extracto'>
                {extracto}
              </Text>
            )}
          </Box>
          <Group gap={6} wrap='nowrap' style={{ flexShrink: 0 }}>
            {m.enCaso && (
              <Badge size='sm' color='teal' variant='light'>
                En el caso
              </Badge>
            )}
            {!abierto && visibles.length > 0 && <IconPaperclip size={14} aria-label='Con adjuntos' />}
            <Tooltip label={fechaLarga(m.fecha)} openDelay={300}>
              <Text size='xs' c='dimmed'>
                {/* En el celular la fecha corta, para que quepa el nombre (como la app de Gmail). */}
                {abierto ? (
                  <>
                    <span className='hidden sm:inline'>{fechaLarga(m.fecha)}</span>
                    <span className='sm:hidden'>{fechaCorta(m.fecha)}</span>
                  </>
                ) : (
                  fechaCorta(m.fecha)
                )}
              </Text>
            </Tooltip>
          </Group>
        </Group>
      </UnstyledButton>
      {abierto && (
        <Stack gap='sm' px='sm' pb='sm' pl={{ base: 'sm', sm: 64 }}>
          <Collapse in={detalles}>
            <Paper withBorder radius='sm' p='xs' data-testid='correo-hilo-detalles-panel'>
              <Stack gap={2}>
                <Text size='xs'>
                  <Text span c='dimmed' w={50} display='inline-block'>
                    De:
                  </Text>
                  {m.de.nombre} &lt;{m.de.correo}&gt;
                </Text>
                {m.para.length > 0 && (
                  <Text size='xs'>
                    <Text span c='dimmed' w={50} display='inline-block'>
                      Para:
                    </Text>
                    {m.para.map((p) => p.correo).join(', ')}
                  </Text>
                )}
                {m.cc.length > 0 && (
                  <Text size='xs'>
                    <Text span c='dimmed' w={50} display='inline-block'>
                      CC:
                    </Text>
                    {m.cc.map((p) => p.correo).join(', ')}
                  </Text>
                )}
                <Text size='xs'>
                  <Text span c='dimmed' w={50} display='inline-block'>
                    Fecha:
                  </Text>
                  {fechaLarga(m.fecha)}
                </Text>
                <Text size='xs'>
                  <Text span c='dimmed' w={50} display='inline-block'>
                    Asunto:
                  </Text>
                  {m.asunto}
                </Text>
              </Stack>
            </Paper>
          </Collapse>
          <HtmlSeguro html={m.html} remotas={remotas} titulo={`Correo de ${m.de.nombre}`} />
          {visibles.length > 0 && (
            <Stack gap={6}>
              <Text size='xs' fw={600} c='dimmed'>
                {visibles.length} adjunto(s)
              </Text>
              <Group gap='xs' wrap='wrap'>
                {visibles.map((a) => (
                  <FichaAdjunto key={a.id} m={m} a={a} onVer={(x) => onVerAdjunto(m, x)} />
                ))}
              </Group>
            </Stack>
          )}
        </Stack>
      )}
    </Card>
  );
}

export default function HiloCorreo({
  conversationId,
  onVolver,
  carpeta = null,
  escritura = false,
  marcarHilo,
  onCrearSolicitud,
  onCambio,
  envioHabilitado = true,
  nombreOperador = '',
  correoOperador = '',
}: HiloCorreoProps) {
  const desktop = useMediaQuery('(min-width: 48em)') ?? true;
  const [hilo, setHilo] = useState<HiloVista | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remotas, setRemotas] = useState(false);
  const [resultado, setResultado] = useState<Resultado>(null);
  const [texto, setTexto] = useState('');
  const [todos, setTodos] = useState(false);
  const [redactando, setRedactando] = useState(false);
  const [archivos, setArchivos] = useState<File[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);
  const [idVincular, setIdVincular] = useState<number | string>('');
  const [vinculando, setVinculando] = useState(false);
  const [acuseVincular, setAcuseVincular] = useState(true);
  const [confirmarInforme, setConfirmarInforme] = useState(false);
  const [reintentando, setReintentando] = useState(false);
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());
  const [verAdjunto, setVerAdjunto] = useState<{ url: string; nombre: string } | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  /** «Consultar a un agente»: selector y accesos vigentes de sus agentes a este hilo. */
  const [agenteAbierto, setAgenteAbierto] = useState(false);
  const [compartidos, setCompartidos] = useState<ConcesionCorreo[]>([]);
  const [revocando, setRevocando] = useState<number | null>(null);
  /** Solo vale la respuesta del ÚLTIMO hilo pedido (si se abre otro antes de que llegue, la anterior se cancela). */
  const peticion = useRef<AbortController | null>(null);
  const yo = correoOperador.toLowerCase();

  const cargar = useCallback(
    async (conRemotas: boolean) => {
      if (!conversationId) return;
      peticion.current?.abort();
      const ctrl = new AbortController();
      peticion.current = ctrl;
      setCargando(true);
      setError(null);
      try {
        const r = await correoApi.hilo(conversationId, conRemotas, ctrl.signal);
        if (peticion.current !== ctrl) return;
        setHilo(r.hilo);
        // Como Gmail: el último y los no leídos desplegados; los demás en una línea.
        setAbiertos((prev) => {
          const n = new Set([...prev].filter((id) => r.hilo.mensajes.some((m) => m.id === id)));
          const ult = r.hilo.mensajes[r.hilo.mensajes.length - 1];
          if (ult) n.add(ult.id);
          for (const m of r.hilo.mensajes) if (!m.leido) n.add(m.id);
          return n;
        });
      } catch (e) {
        if (peticion.current !== ctrl || esCancelada(e)) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (peticion.current === ctrl) setCargando(false);
      }
    },
    [conversationId]
  );

  useEffect(() => {
    setHilo(null);
    setRemotas(false);
    setResultado(null);
    setTexto('');
    setArchivos([]);
    setTodos(false);
    setRedactando(false);
    setIdVincular('');
    setAcuseVincular(true);
    setConfirmarInforme(false);
    setAbiertos(new Set());
    setError(null);
    setCompartidos([]);
    setAgenteAbierto(false);
    if (conversationId) void cargar(false);
    else {
      peticion.current?.abort();
      peticion.current = null;
      setCargando(false);
    }
  }, [conversationId, cargar]);

  useEffect(() => () => peticion.current?.abort(), []);

  const cargarCompartidos = useCallback(async () => {
    if (!conversationId) return;
    try {
      const r = await correoApi.compartidos(conversationId);
      setCompartidos(r.compartidos);
    } catch {
      setCompartidos([]);
    }
  }, [conversationId]);

  useEffect(() => {
    if (hilo?.conversationId) void cargarCompartidos();
  }, [hilo?.conversationId, cargarCompartidos]);

  const revocar = async (c: ConcesionCorreo) => {
    setRevocando(c.id);
    try {
      await correoApi.revocar(c.id);
      toast.success(`Se revocó el acceso de ${c.agente.displayName} a este hilo`);
      setCompartidos((l) => l.filter((x) => x.id !== c.id));
    } catch (e) {
      setResultado({ color: 'red', texto: e instanceof Error ? e.message : String(e) });
    } finally {
      setRevocando(null);
    }
  };

  const ultimo = hilo?.mensajes[hilo.mensajes.length - 1] ?? null;
  const variosDestinatarios = Boolean(ultimo && [ultimo.de, ...ultimo.para, ...ultimo.cc].filter((d) => d.correo && d.correo.toLowerCase() !== yo).length > 1);

  const abrirRedaccion = (aTodos: boolean) => {
    setTodos(aTodos);
    setRedactando(true);
    requestAnimationFrame(() => editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
  };

  const descartar = () => {
    setTexto('');
    setArchivos([]);
    setRedactando(false);
  };

  const enviar = async () => {
    if (!ultimo || !texto.trim()) return;
    const grande = archivos.find((f) => f.size > CORREO_MAX_ADJUNTO_RESPUESTA_BYTES);
    if (grande) {
      setResultado({ color: 'red', texto: `«${grande.name}» pesa más de 3 MB.` });
      return;
    }
    setEnviando(true);
    setResultado(null);
    try {
      const r = await correoApi.responder({ mensajeId: ultimo.id, texto, todos, archivos });
      const extra = r.notaEnSolicitud ? ` Quedó como nota en la solicitud #${r.notaEnSolicitud}.` : '';
      setResultado({ color: 'green', texto: `Respuesta enviada desde su buzón.${extra}` });
      toast.success('Respuesta enviada');
      setTexto('');
      setArchivos([]);
      setRedactando(false);
      onCambio();
      void cargar(remotas);
    } catch (e) {
      setResultado({ color: 'red', texto: `No se envió la respuesta: ${e instanceof Error ? e.message : String(e)}` });
      toast.error('No se envió la respuesta');
    } finally {
      setEnviando(false);
    }
  };

  const agregarNotas = async () => {
    if (!hilo) return;
    setSincronizando(true);
    try {
      const r = await correoApi.notas(hilo.conversationId);
      setResultado({ color: 'green', texto: r.agregadas ? `Se agregaron ${r.agregadas} correo(s) como notas de la solicitud #${r.idRequest}.` : 'No había correos nuevos para agregar.' });
      onCambio();
      void cargar(remotas);
    } catch (e) {
      setResultado({ color: 'red', texto: e instanceof Error ? e.message : String(e) });
    } finally {
      setSincronizando(false);
    }
  };

  /** Mensaje del vínculo + estado del acuse (con «Reintentar respuesta» si no salió). */
  const resultadoAcuse = (base: string, a: ResultadoAcuse | undefined): Resultado => {
    if (!a || a.estado === 'DESHABILITADO') return { color: 'green', texto: base };
    if (a.estado === 'ENVIADO' || a.estado === 'YA_ENVIADO') return { color: 'green', texto: `${base} Se informó en el hilo a todos los participantes.` };
    const reintentable = a.estado === 'ERROR' || a.codigo === 'EXTERNO_SIN_CONFIRMAR';
    return {
      color: 'yellow',
      texto: `${base} No se respondió en el hilo: ${a.mensaje ?? 'error'}`,
      ...(reintentable ? { reintentarAcuse: { confirmarExterno: a.codigo === 'EXTERNO_SIN_CONFIRMAR' } } : {}),
    };
  };

  const reintentarAcuse = async (confirmarExterno: boolean) => {
    if (!hilo) return;
    setReintentando(true);
    try {
      const { acuse } = await correoApi.reintentarAcuse(hilo.conversationId, ACUSE_A_TODOS.todos, confirmarExterno || ACUSE_A_TODOS.confirmarExterno);
      setResultado(resultadoAcuse('', acuse));
      setConfirmarInforme(false);
      onCambio();
      void cargar(remotas);
    } catch (e) {
      setResultado({ color: 'red', texto: e instanceof Error ? e.message : String(e) });
    } finally {
      setReintentando(false);
    }
  };

  const vincular = async () => {
    if (!hilo || !Number(idVincular)) return;
    setVinculando(true);
    try {
      const enviar = envioHabilitado && acuseVincular;
      const r = await correoApi.vincular(hilo.conversationId, Number(idVincular), enviar ? ACUSE_A_TODOS : undefined);
      setResultado(resultadoAcuse(`Hilo vinculado a la solicitud #${r.vinculo.idRequest}.`, r.acuse));
      onCambio();
      void cargar(remotas);
    } catch (e) {
      setResultado({ color: 'red', texto: e instanceof Error ? e.message : String(e) });
    } finally {
      setVinculando(false);
    }
  };

  const bloqueadas = hilo?.mensajes.reduce((s, m) => s + m.remotasBloqueadas, 0) ?? 0;
  const toggle = (id: string) =>
    setAbiertos((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const todosAbiertos = Boolean(hilo && hilo.mensajes.every((m) => abiertos.has(m.id)));

  const [marcando, setMarcando] = useState(false);
  const [vincularAbierto, setVincularAbierto] = useState(false);
  const leidoHilo = Boolean(hilo && hilo.mensajes.every((m) => m.leido));
  const enlaceOutlook = ultimo?.enlaceOutlook ?? null;

  /** Pinta el estado leído del hilo ya (optimista) y devuelve cómo revertirlo. */
  const pintarLeido = (leido: boolean) => {
    const previo = new Map((hilo?.mensajes ?? []).map((m) => [m.id, m.leido]));
    setHilo((h) => (h ? { ...h, mensajes: h.mensajes.map((m, i) => (leido ? { ...m, leido: true } : i === h.mensajes.length - 1 ? { ...m, leido: false } : m)) } : h));
    return () => setHilo((h) => (h ? { ...h, mensajes: h.mensajes.map((m) => (previo.has(m.id) ? { ...m, leido: previo.get(m.id)! } : m)) } : h));
  };

  /** Como Gmail: «leído» marca todo el hilo; «no leído» deja sin leer el último y vuelve a la lista. */
  const marcar = async () => {
    if (!hilo || !marcarHilo) return;
    const leido = !leidoHilo;
    const revertir = pintarLeido(leido);
    setMarcando(true);
    const ok = await marcarHilo(hilo.conversationId, leido);
    setMarcando(false);
    if (!ok) return revertir();
    toast.success(leido ? 'Hilo marcado como leído' : 'Hilo marcado como no leído');
    if (!leido) onVolver();
  };

  // Al abrir un hilo con correos sin leer, se marcan como leídos (como Gmail), una sola vez por hilo.
  const autoMarcado = useRef<string | null>(null);
  useEffect(() => {
    if (!hilo || !escritura || !marcarHilo || autoMarcado.current === hilo.conversationId) return;
    autoMarcado.current = hilo.conversationId;
    if (hilo.mensajes.every((m) => m.leido)) return;
    const revertir = pintarLeido(true);
    void marcarHilo(hilo.conversationId, true).then((ok) => {
      if (!ok) revertir();
    });
  }, [hilo, escritura, marcarHilo]);

  const accion = (label: string, icono: React.ReactNode, props: Record<string, unknown>) => (
    <Tooltip label={label}>
      <ActionIcon variant='subtle' color='gray' radius='xl' size='lg' aria-label={label} {...props}>
        {icono}
      </ActionIcon>
    </Tooltip>
  );

  return (
    <section className={css.hilo} aria-label='Hilo de correo' aria-busy={cargando} data-testid='correo-hilo'>
      <div className={css.toolbar} data-testid='correo-hilo-barra'>
        {accion('Volver a la lista', <IconArrowLeft size={20} />, { onClick: onVolver, 'data-testid': 'correo-hilo-volver' })}
        <span className={css.separador} aria-hidden='true' />
        {hilo &&
          !hilo.vinculo &&
          accion('Convertir en solicitud', <IconFlask size={19} />, {
            onClick: () => onCrearSolicitud(hilo.mensajes.filter((m) => m.de.correo).map((m) => m.id)),
            'data-testid': 'correo-hilo-crear',
          })}
        {hilo && !hilo.vinculo && (
          <Popover opened={vincularAbierto} onChange={setVincularAbierto} position='bottom-start' shadow='md' withinPortal trapFocus>
            <Popover.Target>
              <Tooltip label='Vincular a una solicitud'>
                <ActionIcon
                  variant='subtle'
                  color='gray'
                  radius='xl'
                  size='lg'
                  aria-label='Vincular a una solicitud'
                  onClick={() => setVincularAbierto((v) => !v)}
                  data-testid='correo-hilo-vincular-btn'
                >
                  <IconLink size={19} />
                </ActionIcon>
              </Tooltip>
            </Popover.Target>
            <Popover.Dropdown>
              <Stack gap='xs' w={{ base: 'calc(100vw - 48px)', xs: 300 }} data-testid='correo-hilo-vincular-panel'>
                <Text size='sm' fw={600}>
                  Vincular a una solicitud existente
                </Text>
                <NumberInput
                  size='sm'
                  placeholder='N.º de solicitud'
                  aria-label='Número de la solicitud existente'
                  value={idVincular}
                  onChange={setIdVincular}
                  min={1}
                  hideControls
                  data-autofocus
                />
                {envioHabilitado && (
                  <Checkbox
                    size='xs'
                    label={`Al vincular, ${ACUSE_ETIQUETA.charAt(0).toLowerCase()}${ACUSE_ETIQUETA.slice(1)}`}
                    checked={acuseVincular}
                    onChange={(e) => setAcuseVincular(e.currentTarget.checked)}
                    data-testid='correo-hilo-acuse'
                  />
                )}
                <Group justify='flex-end'>
                  <Button
                    size='xs'
                    leftSection={<IconLink size={14} />}
                    onClick={async () => {
                      await vincular();
                      setVincularAbierto(false);
                    }}
                    loading={vinculando}
                    disabled={!Number(idVincular)}
                    data-testid='correo-hilo-vincular'
                  >
                    Vincular
                  </Button>
                </Group>
              </Stack>
            </Popover.Dropdown>
          </Popover>
        )}
        {hilo &&
          accion('Consultar a un agente', <IconRobot size={19} />, {
            onClick: () => setAgenteAbierto(true),
            'data-testid': 'correo-hilo-agente',
          })}
        {hilo &&
          escritura &&
          marcarHilo &&
          accion(leidoHilo ? 'Marcar como no leído' : 'Marcar como leído', leidoHilo ? <IconMail size={19} /> : <IconMailOpened size={19} />, {
            onClick: marcar,
            loading: marcando,
            'data-testid': 'correo-hilo-leido',
          })}
        {enlaceOutlook &&
          accion('Abrir en Outlook', <IconExternalLink size={19} />, {
            component: 'a',
            href: enlaceOutlook,
            target: '_blank',
            rel: 'noopener noreferrer',
            'data-testid': 'correo-hilo-outlook',
          })}
        {accion('Actualizar', <IconRefresh size={19} />, { onClick: () => void cargar(remotas), disabled: !conversationId, 'data-testid': 'correo-hilo-actualizar' })}
        {hilo && (
          <Text size='xs' c='dimmed' ml='auto' style={{ flexShrink: 0 }}>
            {hilo.mensajes.length} {hilo.mensajes.length === 1 ? 'mensaje' : 'mensajes'}
          </Text>
        )}
      </div>
      <div className={css.hiloScroll}>
        <Stack gap='sm' className={css.hiloContenido}>
          {hilo && (
            <Group gap='xs' align='center' wrap='wrap' pl={{ base: 0, sm: 64 }} data-testid='correo-hilo-cabecera'>
              <Title order={2} fz={{ base: 20, sm: 22 }} fw={400} style={{ overflowWrap: 'anywhere' }} data-testid='correo-hilo-asunto'>
                {hilo.asunto || '(Sin asunto)'}
              </Title>
              {carpeta && (
                <Badge color='gray' variant='light' radius='sm' leftSection={<IconFolder size={12} />} style={{ textTransform: 'none' }} data-testid='correo-hilo-carpeta'>
                  {carpeta}
                </Badge>
              )}
              {hilo.vinculo && (
                <Badge
                  component='a'
                  href={urlSolicitud(hilo.vinculo.idRequest)}
                  color='teal'
                  variant='light'
                  radius='sm'
                  leftSection={<IconLink size={12} />}
                  style={{ cursor: 'pointer', textTransform: 'none' }}
                  data-testid='correo-hilo-badge-solicitud'
                >
                  #{hilo.vinculo.idRequest}
                </Badge>
              )}
            </Group>
          )}
          {resultado && (
            <Alert
              color={resultado.color}
              icon={resultado.color === 'green' ? <IconCheck size={18} /> : <IconAlertTriangle size={18} />}
              withCloseButton
              onClose={() => setResultado(null)}
              data-testid='correo-hilo-resultado'
            >
              <Stack gap={6}>
                <Text size='sm'>{resultado.texto.trim()}</Text>
                {resultado.reintentarAcuse && (
                  <Group>
                    <Button
                      size='xs'
                      variant='light'
                      color='orange'
                      loading={reintentando}
                      onClick={() => reintentarAcuse(resultado.reintentarAcuse!.confirmarExterno)}
                      data-testid='correo-hilo-reintentar-acuse'
                    >
                      {resultado.reintentarAcuse.confirmarExterno ? 'Confirmar y responder' : 'Reintentar respuesta'}
                    </Button>
                  </Group>
                )}
              </Stack>
            </Alert>
          )}
          {error && (
            <Alert color='red' icon={<IconAlertTriangle size={18} />} title='No se pudo abrir el hilo'>
              {error}
            </Alert>
          )}
          {Boolean(conversationId) && !hilo && !error && <EsqueletoHiloCorreo />}
          {hilo && (
            <>
              {hilo.vinculo && (
                <Card withBorder radius='md' p='sm' bg='var(--mantine-color-teal-light)' data-testid='correo-hilo-vinculo'>
                  <Group justify='space-between' wrap='wrap' gap='xs'>
                    <Group gap='xs'>
                      <IconLink size={18} />
                      <Text size='sm'>
                        Vinculado a la{' '}
                        <Anchor href={urlSolicitud(hilo.vinculo.idRequest)} fw={700}>
                          solicitud #{hilo.vinculo.idRequest}
                        </Anchor>
                        {hilo.vinculo.origen === 'CREADA' ? ' (creada desde este hilo)' : ''}
                      </Text>
                    </Group>
                    <Group gap='xs'>
                      {envioHabilitado &&
                        (hilo.vinculo.acuseEnviadoEn ? (
                          <Button size='xs' variant='default' disabled leftSection={<IconCheck size={14} />} data-testid='correo-hilo-informado'>
                            Informado el {new Date(hilo.vinculo.acuseEnviadoEn).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })}
                          </Button>
                        ) : (
                          <Button size='xs' variant='light' color='teal' onClick={() => setConfirmarInforme((v) => !v)} data-testid='correo-hilo-informar'>
                            Informar en el hilo
                          </Button>
                        ))}
                      {hilo.pendientes > 0 ? (
                        <Button size='xs' leftSection={<IconNotes size={14} />} onClick={agregarNotas} loading={sincronizando} data-testid='correo-hilo-agregar-notas'>
                          Agregar {hilo.pendientes} correo(s) nuevo(s) al caso
                        </Button>
                      ) : (
                        <Badge color='teal' variant='light'>
                          Caso al día
                        </Badge>
                      )}
                    </Group>
                  </Group>
                  {confirmarInforme && envioHabilitado && !hilo.vinculo.acuseEnviadoEn && (
                    <Stack gap={6} mt='xs' data-testid='correo-hilo-informar-confirmar'>
                      <Text size='xs' fw={600}>
                        Se responderá a todos los participantes del hilo con este correo (encima del historial):
                      </Text>
                      <div data-testid='correo-hilo-informar-previa'>
                        <HtmlSeguro
                          html={fragmentoAcuse({
                            id: hilo.vinculo.idRequest,
                            titulo: hilo.vinculo.asunto ?? hilo.asunto ?? '',
                            enlace: enlaceSolicitud(typeof window !== 'undefined' ? window.location.origin : '', hilo.vinculo.idRequest),
                            firma: nombreOperador,
                            creada: hilo.vinculo.creadoEn,
                            logoUrl: logoAcuseUrl(typeof window !== 'undefined' ? window.location.origin : ''),
                          })}
                          remotas
                          titulo='Vista previa de la respuesta en el hilo'
                        />
                      </div>
                      <Group gap='xs'>
                        <Button size='xs' color='teal' loading={reintentando} onClick={() => reintentarAcuse(true)} data-testid='correo-hilo-informar-enviar'>
                          Enviar a todos
                        </Button>
                        <Button size='xs' variant='default' onClick={() => setConfirmarInforme(false)}>
                          Cancelar
                        </Button>
                      </Group>
                    </Stack>
                  )}
                </Card>
              )}

              {compartidos.map((c) => (
                <Card key={c.id} withBorder radius='md' p='xs' bg='var(--mantine-color-blue-light)' data-testid='correo-hilo-compartido'>
                  <Group justify='space-between' wrap='wrap' gap='xs'>
                    <Group gap='xs' wrap='nowrap' style={{ minWidth: 0 }}>
                      <IconRobot size={18} style={{ flexShrink: 0 }} />
                      <Text size='sm' style={{ minWidth: 0 }}>
                        Compartido con <b>{c.agente.displayName}</b>
                        <Text span size='xs' c='dimmed'>
                          {' '}
                          · hasta el {fechaLarga(c.venceEn)}
                        </Text>
                      </Text>
                    </Group>
                    <Group gap={6}>
                      {c.agente.code && (
                        <Button size='compact-xs' variant='subtle' onClick={() => router.push(`/process/chat/${encodeURIComponent(c.agente.code)}`)} data-testid='correo-hilo-compartido-chat'>
                          Abrir el chat
                        </Button>
                      )}
                      <Button size='compact-xs' variant='light' color='red' loading={revocando === c.id} onClick={() => revocar(c)} data-testid='correo-hilo-revocar'>
                        Revocar
                      </Button>
                    </Group>
                  </Group>
                </Card>
              ))}

              {bloqueadas > 0 && !remotas && (
                <Alert color='gray' icon={<IconPhoto size={18} />} data-testid='correo-imagenes-bloqueadas'>
                  <Group justify='space-between' wrap='wrap' gap='xs'>
                    <Text size='sm'>Se bloquearon {bloqueadas} imagen(es) remota(s) para proteger su privacidad.</Text>
                    <Button
                      size='xs'
                      variant='default'
                      onClick={() => {
                        setRemotas(true);
                        void cargar(true);
                      }}
                    >
                      Mostrar imágenes
                    </Button>
                  </Group>
                </Alert>
              )}

              {hilo.mensajes.length > 1 && (
                <Group justify='flex-end'>
                  <Button
                    size='compact-xs'
                    variant='subtle'
                    color='gray'
                    onClick={() => setAbiertos(todosAbiertos ? new Set(ultimo ? [ultimo.id] : []) : new Set(hilo.mensajes.map((m) => m.id)))}
                    data-testid='correo-hilo-expandir-todos'
                  >
                    {todosAbiertos ? 'Plegar los anteriores' : 'Desplegar todos'}
                  </Button>
                </Group>
              )}

              <Stack gap={6}>
                {hilo.mensajes.map((m) => (
                  <MensajeHilo
                    key={m.id}
                    m={m}
                    abierto={abiertos.has(m.id)}
                    onToggle={() => toggle(m.id)}
                    remotas={remotas}
                    yo={yo}
                    onVerAdjunto={(msg, a) => setVerAdjunto({ url: urlAdjunto(msg.id, a.id, true), nombre: a.nombre })}
                  />
                ))}
              </Stack>

              {ultimo && envioHabilitado && !redactando && (
                <Group gap='sm' mt='xs' pl={{ base: 0, sm: 64 }} data-testid='correo-acciones-respuesta'>
                  <Button variant='default' radius='xl' leftSection={<IconArrowBackUp size={18} />} onClick={() => abrirRedaccion(false)} data-testid='correo-responder-btn'>
                    Responder
                  </Button>
                  {variosDestinatarios && (
                    <Button variant='default' radius='xl' leftSection={<IconArrowBackUpDouble size={18} />} onClick={() => abrirRedaccion(true)} data-testid='correo-responder-todos-btn'>
                      Responder a todos
                    </Button>
                  )}
                </Group>
              )}

              {ultimo && envioHabilitado && redactando && (
                <Card withBorder radius='md' p='sm' shadow='sm' ref={editorRef} data-testid='correo-responder'>
                  <Group wrap='nowrap' align='flex-start' gap='sm'>
                    {desktop && <AvatarPersona nombre={nombreOperador} correo={correoOperador} size={40} />}
                    <Stack gap='xs' style={{ flex: 1, minWidth: 0 }}>
                      <Group justify='space-between' wrap='nowrap' gap='xs'>
                        <Group gap={6} wrap='nowrap' style={{ minWidth: 0 }}>
                          {todos ? <IconArrowBackUpDouble size={16} /> : <IconArrowBackUp size={16} />}
                          <Text size='sm' truncate data-testid='correo-responder-para'>
                            {todos ? 'Responder a todos' : `Responder a ${ultimo.de.nombre || ultimo.de.correo}`}
                          </Text>
                        </Group>
                        {variosDestinatarios && <Switch size='xs' label='A todos' checked={todos} onChange={(e) => setTodos(e.currentTarget.checked)} />}
                      </Group>
                      <Text size='xs' c='dimmed'>
                        Sale desde su propio buzón, como respuesta al último mensaje del hilo.
                        {hilo.vinculo ? ` Quedará como nota en la solicitud #${hilo.vinculo.idRequest}.` : ''}
                      </Text>
                      <EditorMarkdown value={texto} onChange={setTexto} placeholder='Escriba su respuesta…' autoFocus disabled={enviando} testId='correo-respuesta-texto' />
                      <FileInput
                        multiple
                        clearable
                        size='xs'
                        placeholder={`Adjuntar archivos (máx. ${CORREO_MAX_ADJUNTOS_RESPUESTA}, 3 MB c/u)`}
                        leftSection={<IconPaperclip size={14} />}
                        value={archivos}
                        onChange={(f) => setArchivos((f ?? []).slice(0, CORREO_MAX_ADJUNTOS_RESPUESTA))}
                        aria-label='Adjuntos de la respuesta'
                      />
                      <Group justify='space-between' wrap='nowrap' gap='xs'>
                        <Button radius='xl' leftSection={<IconSend size={16} />} onClick={enviar} loading={enviando} disabled={!texto.trim()} data-testid='correo-respuesta-enviar'>
                          Enviar
                        </Button>
                        <Tooltip label='Descartar borrador'>
                          <ActionIcon variant='subtle' color='gray' size='lg' onClick={descartar} disabled={enviando} aria-label='Descartar borrador' data-testid='correo-respuesta-descartar'>
                            <IconTrash size={18} />
                          </ActionIcon>
                        </Tooltip>
                      </Group>
                    </Stack>
                  </Group>
                </Card>
              )}
            </>
          )}
        </Stack>
      </div>
      {hilo && (
        <ConsultarAgenteModal
          opened={agenteAbierto}
          onClose={() => setAgenteAbierto(false)}
          conversationId={hilo.conversationId}
          asunto={hilo.asunto}
          onCompartido={({ agente }) => {
            setAgenteAbierto(false);
            toast.success(`Hilo compartido con ${agente.displayName}`);
            router.push(`/process/chat/${encodeURIComponent(agente.code)}`);
          }}
        />
      )}
      <Modal opened={Boolean(verAdjunto)} onClose={() => setVerAdjunto(null)} title={verAdjunto?.nombre} size='xl' centered data-testid='correo-adjunto-previa'>
        {verAdjunto && <Image src={verAdjunto.url} alt={verAdjunto.nombre} fit='contain' mah='75vh' />}
      </Modal>
    </section>
  );
}
