'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Chip,
  CloseButton,
  Drawer,
  Group,
  Loader,
  Modal,
  Progress,
  NavLink,
  Popover,
  Stack,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { useMediaQuery, useReducedMotion } from '@mantine/hooks';
import {
  IconAdjustmentsHorizontal,
  IconAlertTriangle,
  IconCheck,
  IconChecks,
  IconChevronRight,
  IconFlask,
  IconFolders,
  IconInbox,
  IconLink,
  IconLock,
  IconMail,
  IconMailOpened,
  IconPaperclip,
  IconPencil,
  IconRefresh,
  IconSearch,
  IconTrash,
  IconX,
} from '@tabler/icons-react';
import toast from 'react-hot-toast';
import SgcSelect from '../sgc/SgcSelect';
import { CORREO_CONFIRMAR_MARCAR_CARPETA, CORREO_MAX_ELIMINAR_SELECCION, CORREO_MAX_MARCAR_CARPETA, CORREO_MAX_MARCAR_SELECCION } from '../../lib/correo/constants';
import { EVENTO_NO_LEIDOS } from '../../lib/correo/iconoHeader';
import type { Carpeta } from '../../lib/correo/types';
import { CorreoApiError, correoApi, esCancelada, fechaCorta, fechaLarga, urlSolicitud, type EstadoCorreo, type MensajeLista, type VinculoEliminar } from './correoClient';
import { EsqueletoCarpetas, EsqueletoFilas } from './Esqueletos';
import FilaDeslizable, { type AccionDeslizar } from './FilaDeslizable';
import HiloCorreo from './HiloCorreo';
import RedactarCorreo from './RedactarCorreo';
import SimulacionModal from './SimulacionModal';
import { AvatarPersona, carpetasOrdenadas, IconoCarpeta } from './ui';
import css from './correo.module.css';

/**
 * Módulo «Correo»: la bandeja de Outlook de la persona dentro de SynerLink (solo SU buzón:
 * el servidor lo toma de la sesión), con la distribución de Gmail: carpetas a la izquierda,
 * buscador arriba con filtros rápidos, lista densa (remitente, asunto + extracto, adjuntos y
 * fecha a la derecha, acciones al pasar el mouse) y la barra de selección para crear
 * solicitudes con simulación. En el celular: la lista primero y las carpetas en un panel.
 * Desde el 2026-10-16 usa toda la pantalla (encabezado de una línea, zonas con desplazamiento
 * propio) y el hilo se abre EN EL LUGAR de la lista, con `?hilo=<id>` en la dirección: el botón
 * «atrás» del navegador vuelve a la lista y el enlace se puede reabrir (solo en el buzón propio).
 */

/** Ids de Graph (base64 con variantes URL), igual que en el servidor. */
const ID_HILO_RE = /^[A-Za-z0-9+=_-]{8,512}$/;

function hiloDeLaUrl(): string | null {
  const h = new URLSearchParams(window.location.search).get('hilo');
  return h && ID_HILO_RE.test(h) ? h : null;
}

const EMPRESA_KEY = 'correo:empresa';

interface Filtros {
  carpeta: string | null;
  desde: string;
  hasta: string;
  de: string;
  buscar: string;
  noLeidos: boolean;
  conAdjuntos: boolean;
}

const FILTROS_VACIOS: Filtros = { carpeta: null, desde: '', hasta: '', de: '', buscar: '', noLeidos: false, conAdjuntos: false };

function aParams(f: Filtros, cursor?: string | null): Record<string, string> {
  const p: Record<string, string> = {};
  if (f.carpeta) p.carpeta = f.carpeta;
  if (f.desde) p.desde = f.desde;
  if (f.hasta) p.hasta = f.hasta;
  if (f.de.trim()) p.de = f.de.trim();
  if (f.buscar.trim()) p.buscar = f.buscar.trim();
  if (f.noLeidos) p.noLeidos = '1';
  if (f.conAdjuntos) p.conAdjuntos = '1';
  if (cursor) p.cursor = cursor;
  return p;
}

/** Encabezado de UNA línea (como Gmail, para dejar la pantalla a la bandeja): título, buzón y empresa. */
function Encabezado({ estado, empresa, setEmpresa }: { estado: EstadoCorreo; empresa: string | null; setEmpresa: (v: string | null) => void }) {
  const { conexion } = estado;
  return (
    <Group className={css.encabezado} justify='space-between' wrap='nowrap' gap='sm' data-testid='correo-encabezado'>
      <Group gap={8} wrap='nowrap' style={{ minWidth: 0 }}>
        <Anchor component={Link} href='/process' size='sm' c='dimmed' visibleFrom='sm' style={{ flexShrink: 0 }}>
          Procesos
        </Anchor>
        <IconChevronRight size={14} color='var(--mantine-color-dimmed)' style={{ flexShrink: 0 }} className='hidden sm:block' />
        <Title order={1} fz={20} fw={700} className='flex items-center gap-2' style={{ flexShrink: 0 }} data-testid='correo-titulo'>
          <IconMail size={22} className='text-blue-600' style={{ flexShrink: 0 }} />
          Correo
        </Title>
        {conexion.modo === 'mock' && (
          <Badge color='grape' variant='light' leftSection={<IconFlask size={12} />} style={{ flexShrink: 0 }} data-testid='correo-modo-simulado'>
            {/* En el celular solo el ícono: no cabe junto al buzón. */}
            <span className='hidden sm:inline'>Buzón simulado (pruebas)</span>
            <span className='sm:hidden'>Pruebas</span>
          </Badge>
        )}
        {conexion.disponible && (
          <Badge color='teal' variant='light' leftSection={<IconMail size={12} />} style={{ textTransform: 'none', minWidth: 0 }} data-testid='correo-buzon'>
            {conexion.correo}
          </Badge>
        )}
      </Group>
      {estado.empresas.length > 1 && (
        <Tooltip label='Empresa de las solicitudes que cree desde el correo' openDelay={300}>
          <div style={{ flexShrink: 0 }}>
            <SgcSelect
              aria-label='Empresa de las solicitudes'
              size='xs'
              data={estado.empresas.map((c) => ({ value: String(c.idCompany), label: c.companyName }))}
              value={empresa}
              onChange={setEmpresa}
              allowDeselect={false}
              w={{ base: 150, sm: 240 }}
            />
          </div>
        </Tooltip>
      )}
    </Group>
  );
}

function NoDisponible({ estado }: { estado: EstadoCorreo }) {
  if (estado.conexion.modo === 'off') {
    return (
      <Alert color='blue' icon={<IconMail size={18} />} title='Módulo Correo en preparación' data-testid='correo-apagado'>
        El módulo Correo todavía no está habilitado en este ambiente. Tecnología le avisará cuando esté disponible.
      </Alert>
    );
  }
  return (
    <Alert color='blue' icon={<IconMail size={18} />} title='Correo disponible próximamente para su empresa' data-testid='correo-no-disponible'>
      Por ahora el módulo Correo atiende los buzones de las empresas ya habilitadas. Su buzón ({estado.conexion.correo}) se habilitará más adelante.
    </Alert>
  );
}

function AvisoPrivacidad() {
  return (
    <Group gap={6} wrap='nowrap' align='flex-start' data-testid='correo-aviso-privacidad'>
      <IconLock size={14} style={{ flexShrink: 0, marginTop: 2 }} color='var(--mantine-color-dimmed)' />
      <Text size='xs' c='dimmed'>
        Solo usted ve su buzón en SynerLink. Cada consulta queda registrada; SynerLink no guarda el contenido de los correos, salvo el extracto que usted pasa a una
        solicitud o a sus notas (Ley 1581 de 2012).
      </Text>
    </Group>
  );
}

/** Carpetas de la barra lateral (escritorio) o del panel (celular). */
function ListaCarpetas({
  carpetas,
  actual,
  cargando,
  onElegir,
}: {
  carpetas: Carpeta[];
  actual: string | null;
  cargando: boolean;
  onElegir: (id: string | null) => void;
}) {
  const orden = carpetasOrdenadas(carpetas);
  // Primera consulta de carpetas (con sus no leídos): la forma de la lista, no un «Recibidos» suelto que luego salta.
  if (!orden.length && cargando) return <EsqueletoCarpetas />;
  const items = orden.length ? orden : [{ id: '', nombre: 'Bandeja de entrada', etiqueta: 'Recibidos', tipo: 'entrada' as const, total: 0, noLeidos: 0 }];
  return (
    <Stack gap={2} data-testid='correo-carpetas'>
      {items.map((c) => {
        const activa = c.tipo === 'entrada' ? !actual || actual === c.id : actual === c.id;
        const cuenta = c.tipo === 'borradores' ? c.total : c.noLeidos;
        return (
          <NavLink
            key={c.id || c.tipo}
            active={activa}
            label={c.etiqueta}
            leftSection={<IconoCarpeta tipo={c.tipo} />}
            rightSection={
              cuenta > 0 ? (
                <Text size='xs' fw={activa || c.tipo === 'entrada' ? 700 : 500}>
                  {cuenta.toLocaleString('es-CO')}
                </Text>
              ) : null
            }
            onClick={() => onElegir(c.tipo === 'entrada' ? null : c.id)}
            fw={activa ? 700 : 500}
            styles={{ root: { borderRadius: 'var(--mantine-radius-xl)', paddingBlock: 6 }, label: { fontSize: 14 } }}
            title={c.nombre}
            data-testid='correo-carpeta'
            data-activa={activa ? '1' : '0'}
          />
        );
      })}
    </Stack>
  );
}

export default function CorreoPage() {
  const desktop = useMediaQuery('(min-width: 62em)') ?? false;
  const reducirMovimiento = useReducedMotion();
  const [estado, setEstado] = useState<EstadoCorreo | null>(null);
  const [errorEstado, setErrorEstado] = useState<{ status: number; mensaje: string } | null>(null);
  const [empresa, setEmpresaState] = useState<string | null>(null);
  const [carpetas, setCarpetas] = useState<Carpeta[]>([]);
  const [filtros, setFiltros] = useState<Filtros>(FILTROS_VACIOS);
  const [borrador, setBorrador] = useState<Filtros>(FILTROS_VACIOS);
  const [mensajes, setMensajes] = useState<MensajeLista[]>([]);
  const [siguiente, setSiguiente] = useState<string | null>(null);
  /** Filtros a los que corresponde la lista mostrada: si no son los actuales, la lista es de otra carpeta/búsqueda y NO se muestra. */
  const [listaDe, setListaDe] = useState<Filtros | null>(null);
  /** 'refresco' = misma carpeta (lista atenuada); 'mas' = «Cargar más» (esqueletos al final); 'nueva' = otra carpeta/búsqueda. */
  const [carga, setCarga] = useState<'nueva' | 'refresco' | 'mas' | null>(null);
  const peticion = useRef<{ id: number; ctrl: AbortController | null }>({ id: 0, ctrl: null });
  const [cargandoCarpetas, setCargandoCarpetas] = useState(false);
  const peticionCarpetas = useRef<AbortController | null>(null);
  const [errorLista, setErrorLista] = useState<string | null>(null);
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  /** «Seleccionar los N correos de esta carpeta» (como Gmail): la selección es la carpeta entera, no solo la página. */
  const [todaCarpeta, setTodaCarpeta] = useState(false);
  /** Avance de «Marcar todo» (lotes de 200 en el servidor). */
  const [marcado, setMarcado] = useState<{ leido: boolean; hechos: number; total: number } | null>(null);
  const detenerMarcado = useRef(false);
  const [confirmarMarcado, setConfirmarMarcado] = useState<{ leido: boolean; total: number } | null>(null);
  /** Hilo abierto EN EL LUGAR de la lista; vive en la dirección (?hilo=) para que «atrás» vuelva a la lista. */
  const [hiloAbierto, setHiloAbierto] = useState<string | null>(null);
  const [simulacion, setSimulacion] = useState<string[] | null>(null);
  const [hayCambios, setHayCambios] = useState(false);
  const [versionHilo, setVersionHilo] = useState(0);
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(false);
  const [panelCarpetas, setPanelCarpetas] = useState(false);
  /** Eliminar correos de hilos vinculados (solicitud o proyecto): confirmación antes de moverlos a la Papelera. */
  /** Redactar (2026-10-19): ventana de correo nuevo y el aviso de envío (arriba, en verde, hasta cerrarlo). */
  const [redactando, setRedactando] = useState(false);
  const [avisoEnvio, setAvisoEnvio] = useState<string | null>(null);
  const [confirmarEliminar, setConfirmarEliminar] = useState<{ filas: MensajeLista[]; vinculos: VinculoEliminar[] } | null>(null);
  /** Lista y filtros VIGENTES (para «Deshacer», que llega segundos después de eliminar). */
  const listaDeRef = useRef<Filtros | null>(null);
  const filtrosRef = useRef<Filtros>(FILTROS_VACIOS);
  listaDeRef.current = listaDe;
  filtrosRef.current = filtros;

  const cargarEstado = useCallback(async () => {
    try {
      const e = await correoApi.estado();
      setEstado(e);
      let pref: string | null = null;
      try {
        pref = window.sessionStorage.getItem(EMPRESA_KEY);
      } catch {
        /* sin almacenamiento */
      }
      const match =
        e.empresas.find((c) => String(c.idCompany) === pref) ?? e.empresas.find((c) => c.idCompany === e.empresaBuzon) ?? e.empresas[0];
      if (match) setEmpresaState(String(match.idCompany));
    } catch (e) {
      setErrorEstado({ status: e instanceof CorreoApiError ? e.status : 500, mensaje: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  useEffect(() => {
    void cargarEstado();
    // Enlace desde una solicitud o compartido: /process/correo?hilo=<conversationId> (siempre del buzón propio).
    const leer = () => setHiloAbierto(hiloDeLaUrl());
    leer();
    window.addEventListener('popstate', leer);
    return () => window.removeEventListener('popstate', leer);
  }, [cargarEstado]);

  const abrirHilo = useCallback((id: string) => {
    if (!ID_HILO_RE.test(id)) return;
    const url = `${window.location.pathname}?${new URLSearchParams({ hilo: id })}`;
    // Abierto desde la lista: una entrada nueva en el historial, para que «atrás» vuelva a la lista.
    if (hiloDeLaUrl()) window.history.replaceState({ ...window.history.state, correoHilo: true }, '', url);
    else window.history.pushState({ ...window.history.state, correoHilo: true }, '', url);
    setHiloAbierto(id);
  }, []);

  const cerrarHilo = useCallback(() => {
    // Si el hilo se abrió desde la lista, se vuelve con el historial (como «atrás»); si llegó por enlace, se reemplaza.
    if (window.history.state?.correoHilo) window.history.back();
    else {
      window.history.replaceState(window.history.state, '', window.location.pathname);
      setHiloAbierto(null);
    }
  }, []);

  const listo = Boolean(estado?.conexion.disponible);

  /**
   * Carrera de respuestas: si la persona cambia rápido de carpeta (Recibidos → Enviados → Recibidos), solo vale la
   * ÚLTIMA consulta. La anterior se cancela (AbortController) y, si igual llega, se descarta por su número de petición.
   */
  const cargarMensajes = useCallback(async (f: Filtros, opciones: { cursor?: string | null; refresco?: boolean } = {}) => {
    const { cursor = null, refresco = false } = opciones;
    peticion.current.ctrl?.abort();
    const ctrl = new AbortController();
    const id = ++peticion.current.id;
    peticion.current.ctrl = ctrl;
    setCarga(cursor ? 'mas' : refresco ? 'refresco' : 'nueva');
    setErrorLista(null);
    try {
      const r = await correoApi.mensajes(aParams(f, cursor), ctrl.signal);
      if (id !== peticion.current.id) return;
      setMensajes((prev) => (cursor ? [...prev, ...r.mensajes] : r.mensajes));
      setSiguiente(r.siguiente);
      setListaDe(f);
    } catch (e) {
      if (id !== peticion.current.id || esCancelada(e)) return;
      setErrorLista(e instanceof Error ? e.message : String(e));
      if (!cursor) {
        setMensajes([]);
        setSiguiente(null);
        setListaDe(f);
      }
    } finally {
      if (id === peticion.current.id) setCarga(null);
    }
  }, []);

  const cargarCarpetas = useCallback(() => {
    peticionCarpetas.current?.abort();
    const ctrl = new AbortController();
    peticionCarpetas.current = ctrl;
    setCargandoCarpetas(true);
    correoApi
      .carpetas(ctrl.signal)
      .then((r) => {
        if (peticionCarpetas.current === ctrl) setCarpetas(r.carpetas);
      })
      .catch((e) => {
        if (peticionCarpetas.current === ctrl && !esCancelada(e)) setCarpetas([]);
      })
      .finally(() => {
        if (peticionCarpetas.current === ctrl) setCargandoCarpetas(false);
      });
  }, []);

  // Al salir del módulo se cancela lo que esté en vuelo.
  useEffect(
    () => () => {
      peticion.current.ctrl?.abort();
      peticionCarpetas.current?.abort();
    },
    []
  );

  useEffect(() => {
    if (listo) cargarCarpetas();
  }, [listo, cargarCarpetas]);

  useEffect(() => {
    if (!listo) return;
    setSeleccion(new Set());
    setTodaCarpeta(false);
    void cargarMensajes(filtros);
  }, [listo, filtros, cargarMensajes]);

  // Al volver a la lista (← o «atrás» del navegador) tras cambios en el hilo, la carpeta se actualiza.
  useEffect(() => {
    if (hiloAbierto || !hayCambios) return;
    setHayCambios(false);
    void cargarMensajes(filtros, { refresco: true });
  }, [hiloAbierto, hayCambios, filtros, cargarMensajes]);

  const setEmpresa = (v: string | null) => {
    setEmpresaState(v);
    try {
      if (v) window.sessionStorage.setItem(EMPRESA_KEY, v);
    } catch {
      /* sin almacenamiento */
    }
  };

  const toggle = (id: string) => {
    setTodaCarpeta(false);
    setSeleccion((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };
  // La lista solo se muestra si es de los filtros ACTUALES: al cambiar de Recibidos a Enviados las filas viejas
  // desaparecen en el mismo render del clic (sin esperar al efecto) y en su lugar salen los esqueletos.
  const desactualizada = listaDe !== filtros;
  const visibles = desactualizada ? [] : mensajes;
  const cargando = carga !== null || desactualizada;
  const todosMarcados = visibles.length > 0 && visibles.every((m) => seleccion.has(m.id));

  const aplicar = () => {
    setFiltros({ ...borrador });
    setFiltrosAbiertos(false);
  };
  /** Cambia un filtro y lo aplica de una vez (chips, carpeta, quitar un filtro activo). */
  const cambiar = (parcial: Partial<Filtros>) => {
    const n = { ...filtros, ...borrador, ...parcial };
    setBorrador(n);
    setFiltros(n);
  };
  const limpiar = () => {
    const n = { ...FILTROS_VACIOS, carpeta: filtros.carpeta };
    setBorrador(n);
    setFiltros(n);
    setFiltrosAbiertos(false);
  };
  const refrescar = () => {
    void cargarMensajes(filtros, { refresco: true });
    cargarCarpetas();
  };

  const carpetaActual = useMemo(() => {
    const orden = carpetasOrdenadas(carpetas);
    return filtros.carpeta ? orden.find((c) => c.id === filtros.carpeta) : orden.find((c) => c.tipo === 'entrada');
  }, [carpetas, filtros.carpeta]);

  const hayFiltros = Boolean(filtros.buscar.trim() || filtros.desde || filtros.hasta || filtros.de.trim() || filtros.noLeidos || filtros.conAdjuntos);

  // Icono del Correo en la cabecera: cada cambio del contador de la Bandeja de entrada (optimista, reversión o
  // consulta) se avisa al instante, sin esperar a su caché de 3 minutos.
  const noLeidosBandeja = carpetasOrdenadas(carpetas).find((c) => c.tipo === 'entrada')?.noLeidos;
  useEffect(() => {
    if (typeof noLeidosBandeja === 'number') window.dispatchEvent(new CustomEvent(EVENTO_NO_LEIDOS, { detail: { noLeidos: noLeidosBandeja } }));
  }, [noLeidosBandeja]);

  /** Suma (o resta) no leídos a la carpeta abierta, de forma optimista. */
  const ajustarNoLeidos = (delta: number) => {
    const id = carpetaActual?.id;
    if (!id || !delta) return;
    setCarpetas((prev) => prev.map((c) => (c.id === id ? { ...c, noLeidos: Math.max(0, c.noLeidos + delta) } : c)));
  };

  /**
   * Leído / no leído de filas (selección o hilo): se pinta YA (filas en negrita o no y contadores) y, si Microsoft
   * falla, se revierte tal cual estaba. `cambiar` decide qué filas cambian y a qué estado.
   */
  const optimista = async (
    cambiar: (m: MensajeLista) => boolean | null,
    llamar: () => Promise<{ cambiados: number; fallidos?: number }>,
    silencioso = false
  ): Promise<boolean> => {
    const previos = new Map<string, boolean>();
    let delta = 0;
    setMensajes((prev) =>
      prev.map((m) => {
        const nuevo = cambiar(m);
        if (nuevo === null || nuevo === m.leido) return m;
        previos.set(m.id, m.leido);
        return { ...m, leido: nuevo };
      })
    );
    for (const m of mensajes) {
      const nuevo = cambiar(m);
      if (nuevo !== null && nuevo !== m.leido) delta += nuevo ? -1 : 1;
    }
    const carpetasAntes = carpetas;
    ajustarNoLeidos(delta);
    try {
      const r = await llamar();
      if (r.fallidos) {
        toast.error(`${r.fallidos} correo(s) no se pudieron marcar (pudieron moverse o borrarse).`);
        void cargarMensajes(filtros, { refresco: true });
      }
      // Al abrir un hilo (silencioso) el contador ya se ajustó arriba: no se vuelve a consultar Graph.
      if (!silencioso) cargarCarpetas();
      return true;
    } catch (e) {
      setMensajes((prev) => prev.map((m) => (previos.has(m.id) ? { ...m, leido: previos.get(m.id)! } : m)));
      setCarpetas(carpetasAntes);
      if (!silencioso) toast.error(`No se pudo marcar: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  };

  const marcarSeleccion = async (leido: boolean) => {
    if (todaCarpeta) return marcarCarpetaEntera(leido);
    const ids = [...seleccion];
    const set = new Set(ids);
    const ok = await optimista(
      (m) => (set.has(m.id) ? leido : null),
      async () => {
        let cambiados = 0;
        let fallidos = 0;
        for (let i = 0; i < ids.length; i += CORREO_MAX_MARCAR_SELECCION) {
          const r = await correoApi.marcarSeleccion(ids.slice(i, i + CORREO_MAX_MARCAR_SELECCION), leido);
          cambiados += r.cambiados;
          fallidos += r.fallidos;
        }
        return { cambiados, fallidos };
      }
    );
    if (ok) {
      setSeleccion(new Set());
      toast.success(leido ? 'Marcados como leídos' : 'Marcados como no leídos');
    }
  };

  /** El hilo abierto (al abrirlo o desde su barra): todas sus filas («leído») o la más reciente («no leído»). */
  const marcarHilo = (conversationId: string, leido: boolean, opciones: { silencioso?: boolean } = {}) => {
    const delHilo = mensajes.filter((m) => m.conversationId === conversationId);
    const ultimo = delHilo.reduce<MensajeLista | null>((u, m) => (!u || m.fecha > u.fecha ? m : u), null);
    return optimista(
      (m) => (m.conversationId !== conversationId ? null : leido ? true : m === ultimo || m.id === ultimo?.id ? false : null),
      () => correoApi.marcarLeido(conversationId, leido),
      Boolean(opciones.silencioso)
    );
  };

  /**
   * «Marcar todo como leído» o la carpeta entera seleccionada: el servidor marca de a 200 por `$batch` (20 por lote
   * de Graph) y el navegador repite mostrando el avance, con «Detener», confirmación desde 500 y tope de 5.000.
   */
  const marcarCarpetaEntera = async (leido: boolean, confirmado = false) => {
    if (!carpetaActual || marcado) return;
    const pendientes = leido ? carpetaActual.noLeidos : Math.max(0, carpetaActual.total - carpetaActual.noLeidos);
    if (pendientes === 0) {
      toast.success(leido ? 'No hay correos sin leer en esta carpeta' : 'No hay correos leídos en esta carpeta');
      return;
    }
    if (pendientes > CORREO_CONFIRMAR_MARCAR_CARPETA && !confirmado) {
      setConfirmarMarcado({ leido, total: pendientes });
      return;
    }
    const total = Math.min(pendientes, CORREO_MAX_MARCAR_CARPETA);
    const carpetasAntes = carpetas;
    detenerMarcado.current = false;
    setMarcado({ leido, hechos: 0, total });
    // Optimista: las filas visibles y el contador de la carpeta.
    setMensajes((prev) => prev.map((m) => ({ ...m, leido })));
    ajustarNoLeidos(leido ? -carpetaActual.noLeidos : pendientes);
    let hechos = 0;
    let restantes = pendientes;
    let error: string | null = null;
    try {
      while (!detenerMarcado.current && hechos < CORREO_MAX_MARCAR_CARPETA) {
        const r = await correoApi.marcarCarpeta(filtros.carpeta, leido);
        hechos += r.cambiados;
        restantes = r.restantes;
        setMarcado({ leido, hechos: Math.min(hechos, total), total });
        if (r.restantes === 0 || r.cambiados === 0) break;
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      setMarcado(null);
      setSeleccion(new Set());
      setTodaCarpeta(false);
    }
    if (error && hechos === 0) {
      // Nada se marcó: se revierte lo optimista.
      setCarpetas(carpetasAntes);
      void cargarMensajes(filtros, { refresco: true });
      toast.error(`No se pudo marcar la carpeta: ${error}`);
      return;
    }
    if (error || restantes > 0) {
      // Parcial (error, «Detener» o tope): se trae el estado real.
      void cargarMensajes(filtros, { refresco: true });
      toast(
        `Se marcaron ${hechos.toLocaleString('es-CO')} correo(s); quedan ${restantes.toLocaleString('es-CO')}.${error ? ` (${error})` : ' Use otra vez «Marcar todo» para continuar.'}`
      );
    } else {
      toast.success(`${hechos.toLocaleString('es-CO')} correo(s) marcados como ${leido ? 'leídos' : 'no leídos'}`);
    }
    cargarCarpetas();
  };

  /** Vínculos que la lista ya conoce (solicitud propia o proyecto del chat): se avisa ANTES de eliminar. */
  const vinculosDeFilas = (filas: MensajeLista[]): VinculoEliminar[] =>
    filas
      .filter((m) => m.solicitud || (m.proyectos?.length ?? 0) > 0)
      .map((m) => ({ mensajeId: m.id, conversationId: m.conversationId, idRequest: m.solicitud, proyectos: m.proyectos ?? [] }));

  /** Vuelve a poner filas en su posición, solo si la lista sigue siendo la misma carpeta y búsqueda. */
  const reinsertar = (lista: Filtros | null, filas: Array<{ fila: MensajeLista; indice: number }>): boolean => {
    if (!filas.length) return true;
    if (listaDeRef.current !== lista) return false;
    setMensajes((prev) => {
      const arr = prev.filter((m) => !filas.some((f) => f.fila.id === m.id));
      for (const f of [...filas].sort((a, b) => a.indice - b.indice)) arr.splice(Math.min(f.indice, arr.length), 0, f.fila);
      return arr;
    });
    return true;
  };

  /**
   * Eliminar (deslizar a la izquierda, botón de la fila, tecla Supr o la barra de selección): el correo sale de la lista
   * YA y el servidor lo MUEVE a «Elementos eliminados» (nunca lo borra). El aviso trae «Deshacer» por 7 segundos.
   */
  const eliminar = async (filas: MensajeLista[], confirmado = false) => {
    if (!filas.length) return;
    if (!confirmado) {
      const vinculos = vinculosDeFilas(filas);
      if (vinculos.length) {
        setConfirmarEliminar({ filas, vinculos });
        return;
      }
    }
    const lista = listaDe;
    const posiciones = filas.map((fila) => ({ fila, indice: Math.max(0, mensajes.findIndex((m) => m.id === fila.id)) }));
    const ids = filas.map((f) => f.id);
    const quitar = new Set(ids);
    const carpetasAntes = carpetas;
    setMensajes((prev) => prev.filter((m) => !quitar.has(m.id)));
    setSeleccion((prev) => new Set([...prev].filter((id) => !quitar.has(id))));
    ajustarNoLeidos(-filas.filter((f) => !f.leido).length);
    const eliminados = new Map<string, string>();
    const comprobantes: string[] = [];
    let noMovidos = 0;
    let error: string | null = null;
    let pendienteConfirmar: { filas: MensajeLista[]; vinculos: VinculoEliminar[] } | null = null;
    for (let i = 0; i < ids.length; i += CORREO_MAX_ELIMINAR_SELECCION) {
      const lote = ids.slice(i, i + CORREO_MAX_ELIMINAR_SELECCION);
      try {
        const r = await correoApi.eliminar(lote, confirmado);
        if ('vinculados' in r) {
          // Se vinculó mientras tanto (otra pestaña): confirmación para este lote y los que faltan.
          const resto = new Set(ids.slice(i));
          pendienteConfirmar = { filas: filas.filter((f) => resto.has(f.id)), vinculos: r.vinculados };
          break;
        }
        for (const e of r.resultado.eliminados) eliminados.set(e.id, e.nuevoId);
        if (r.resultado.deshacer) comprobantes.push(r.resultado.deshacer);
        noMovidos += r.resultado.fallidos.length;
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
        break;
      }
    }
    // Lo que no se movió vuelve a la lista.
    reinsertar(
      lista,
      posiciones.filter((p) => !eliminados.has(p.fila.id))
    );
    if (pendienteConfirmar) setConfirmarEliminar(pendienteConfirmar);
    if (eliminados.size === 0) {
      setCarpetas(carpetasAntes);
      if (error) toast.error(`No se pudo eliminar: ${error}`);
      else if (noMovidos) toast.error('No se encontró el correo en su buzón (pudo moverse o borrarse).');
      return;
    }
    cargarCarpetas();
    if (error || noMovidos) toast.error(`${noMovidos || ids.length - eliminados.size} correo(s) no se pudieron eliminar${error ? `: ${error}` : ' (pudieron moverse o borrarse).'}`);
    const n = eliminados.size;
    const deshacer = async () => {
      const restaurados = new Map<string, string>();
      let fallo: string | null = null;
      for (const c of comprobantes) {
        try {
          const r = await correoApi.deshacerEliminar(c);
          for (const x of r.restaurados) restaurados.set(x.id, x.nuevoId);
        } catch (e) {
          fallo = e instanceof Error ? e.message : String(e);
        }
      }
      const vuelven = posiciones.flatMap((p) => {
        const enPapelera = eliminados.get(p.fila.id);
        const nuevoId = enPapelera ? restaurados.get(enPapelera) : undefined;
        return nuevoId ? [{ fila: { ...p.fila, id: nuevoId }, indice: p.indice }] : [];
      });
      // Si la persona ya cambió de carpeta, la lista vigente se vuelve a consultar.
      if (vuelven.length && !reinsertar(lista, vuelven)) void cargarMensajes(filtrosRef.current, { refresco: true });
      if (vuelven.length) {
        cargarCarpetas();
        toast.success(vuelven.length === 1 ? 'Correo restaurado' : `${vuelven.length} correos restaurados`);
      }
      if (fallo || vuelven.length < n) toast.error(`${n - vuelven.length} correo(s) no se pudieron restaurar${fallo ? `: ${fallo}` : ''}. Búsquelos en la Papelera.`);
    };
    toast.success(
      (t) => (
        <span className={css.avisoDeshacer} data-testid='correo-aviso-eliminado'>
          <span>{n === 1 ? 'Correo movido a la Papelera.' : `${n} correos movidos a la Papelera.`}</span>
          {/* Botón nativo: el aviso se pinta FUERA del MantineProvider (AppToaster). */}
          <button
            type='button'
            className={css.botonDeshacer}
            onClick={() => {
              toast.dismiss(t.id);
              void deshacer();
            }}
            data-testid='correo-deshacer'
          >
            Deshacer
          </button>
        </span>
      ),
      { duration: 7000 }
    );
  };

  /** Deslizar a la derecha: leído ↔ no leído de UNA fila (se pinta ya; si Microsoft falla, se revierte). */
  const alternarLeido = (m: MensajeLista) => {
    const leido = !m.leido;
    void optimista(
      (x) => (x.id === m.id ? leido : null),
      () => correoApi.marcarSeleccion([m.id], leido)
    );
  };

  if (errorEstado) {
    return (
      <Box p='md'>
        <Alert color={errorEstado.status === 403 ? 'yellow' : 'red'} icon={<IconAlertTriangle size={18} />} title='Correo' data-testid='correo-sin-acceso'>
          {errorEstado.status === 403 ? 'No tiene acceso al módulo Correo. Pídalo a TI (Administración → Usuarios).' : errorEstado.mensaje}
        </Alert>
      </Box>
    );
  }
  if (!estado) {
    return (
      <Group justify='center' mt='xl'>
        <Loader />
      </Group>
    );
  }

  const idEmpresa = Number(empresa) || estado.empresas[0]?.idCompany;
  /** Leído / no leído escribe en el buzón (Mail.ReadWrite): mismo interruptor que las categorías (CORREO_ETIQUETAR_HABILITADO). */
  const escritura = estado.conexion.etiquetarHabilitado;
  /**
   * Eliminar = mover a la Papelera (CORREO_ELIMINAR_HABILITADO y la escritura encendidos). En la Papelera misma no se
   * ofrece: el módulo nunca borra de forma permanente.
   */
  const puedeEliminar = Boolean(estado.conexion.eliminarHabilitado) && escritura && carpetaActual?.tipo !== 'eliminados';
  const quitarSeleccion = () => {
    setTodaCarpeta(false);
    setSeleccion(new Set());
  };

  const badgeSolicitud = (m: MensajeLista) =>
    m.solicitud ? (
      <Badge
        size='sm'
        color='teal'
        variant='light'
        leftSection={<IconLink size={10} />}
        component='a'
        href={urlSolicitud(m.solicitud)}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
        style={{ cursor: 'pointer', flexShrink: 0 }}
        data-testid='correo-badge-solicitud'
      >
        #{m.solicitud}
      </Badge>
    ) : null;

  const abrir = (m: MensajeLista) => abrirHilo(m.conversationId);
  const teclaFila = (e: React.KeyboardEvent, m: MensajeLista) => {
    if (e.key === 'Enter') abrir(m);
    if (e.key === 'Delete' && puedeEliminar && e.target === e.currentTarget) {
      e.preventDefault();
      void eliminar([m]);
    }
    if (e.key === ' ' && e.target === e.currentTarget) {
      e.preventDefault();
      toggle(m.id);
    }
  };

  // ---------------------------------------------------------------- buscador y chips
  const filtrosAvanzados = (
    <Stack gap='sm' data-testid='correo-filtros' w={{ base: 'calc(100vw - 48px)', xs: 340 }}>
      <TextInput
        type='email'
        label='De'
        placeholder='persona@empresa.com'
        value={borrador.de}
        onChange={(e) => setBorrador({ ...borrador, de: e.currentTarget.value })}
        onKeyDown={(e) => e.key === 'Enter' && aplicar()}
      />
      <Group grow gap='sm'>
        <TextInput type='date' label='Desde' value={borrador.desde} onChange={(e) => setBorrador({ ...borrador, desde: e.currentTarget.value })} />
        <TextInput type='date' label='Hasta' value={borrador.hasta} onChange={(e) => setBorrador({ ...borrador, hasta: e.currentTarget.value })} />
      </Group>
      <Group justify='space-between'>
        <Button variant='subtle' leftSection={<IconX size={14} />} onClick={limpiar}>
          Limpiar filtros
        </Button>
        <Button onClick={aplicar} leftSection={<IconSearch size={16} />} data-testid='correo-aplicar'>
          Buscar
        </Button>
      </Group>
    </Stack>
  );

  const buscador = (
    <TextInput
      className={css.busqueda}
      radius='xl'
      size={desktop ? 'md' : 'sm'}
      placeholder='Buscar en el correo'
      aria-label='Buscar en el correo'
      leftSection={<IconSearch size={18} />}
      value={borrador.buscar}
      onChange={(e) => setBorrador({ ...borrador, buscar: e.currentTarget.value })}
      onKeyDown={(e) => e.key === 'Enter' && aplicar()}
      rightSectionWidth={borrador.buscar ? 68 : 40}
      rightSection={
        <Group gap={0} wrap='nowrap'>
          {borrador.buscar && <CloseButton size='sm' aria-label='Borrar la búsqueda' onClick={() => cambiar({ buscar: '' })} />}
          <Popover opened={filtrosAbiertos} onChange={setFiltrosAbiertos} position='bottom-end' shadow='md' withinPortal trapFocus>
            <Popover.Target>
              <Tooltip label='Mostrar opciones de búsqueda'>
                <ActionIcon variant='subtle' color='gray' radius='xl' onClick={() => setFiltrosAbiertos((v) => !v)} aria-label='Opciones de búsqueda' data-testid='correo-mas-filtros'>
                  <IconAdjustmentsHorizontal size={18} />
                </ActionIcon>
              </Tooltip>
            </Popover.Target>
            <Popover.Dropdown>{filtrosAvanzados}</Popover.Dropdown>
          </Popover>
        </Group>
      }
      style={{ flex: 1, minWidth: 0 }}
      data-testid='correo-buscar'
    />
  );

  const chipsActivos: Array<{ k: string; texto: string; quitar: Partial<Filtros> }> = [];
  if (filtros.buscar.trim()) chipsActivos.push({ k: 'buscar', texto: `«${filtros.buscar.trim()}»`, quitar: { buscar: '' } });
  if (filtros.de.trim()) chipsActivos.push({ k: 'de', texto: `De: ${filtros.de.trim()}`, quitar: { de: '' } });
  if (filtros.desde) chipsActivos.push({ k: 'desde', texto: `Desde ${filtros.desde}`, quitar: { desde: '' } });
  if (filtros.hasta) chipsActivos.push({ k: 'hasta', texto: `Hasta ${filtros.hasta}`, quitar: { hasta: '' } });

  const chips = (
    <div className={css.chips} data-testid='correo-chips'>
      <Chip size='sm' checked={filtros.noLeidos} onChange={(v) => cambiar({ noLeidos: v })} icon={<IconCheck size={14} />} data-testid='correo-chip-no-leidos'>
        No leídos
      </Chip>
      <Chip size='sm' checked={filtros.conAdjuntos} onChange={(v) => cambiar({ conAdjuntos: v })} icon={<IconCheck size={14} />} data-testid='correo-chip-adjuntos'>
        Con adjuntos
      </Chip>
      {chipsActivos.map((c) => (
        <Badge
          key={c.k}
          variant='light'
          size='lg'
          radius='xl'
          style={{ textTransform: 'none', flexShrink: 0, fontWeight: 500 }}
          rightSection={<CloseButton size='xs' aria-label={`Quitar ${c.texto}`} onClick={() => cambiar(c.quitar)} />}
          data-testid='correo-chip-activo'
        >
          {c.texto}
        </Badge>
      ))}
      {hayFiltros && (
        <Button size='compact-sm' variant='subtle' onClick={limpiar} style={{ flexShrink: 0 }}>
          Quitar filtros
        </Button>
      )}
    </div>
  );

  // ---------------------------------------------------------------- barra de herramientas / selección
  const barra = (
    <div className={`${css.toolbar} ${seleccion.size > 0 ? css.toolbarSeleccion : ''}`}>
      {desktop && (
        <Tooltip label={todosMarcados ? 'Quitar selección' : 'Seleccionar todos'}>
          <Checkbox
            aria-label='Seleccionar todos'
            checked={todosMarcados}
            indeterminate={seleccion.size > 0 && !todosMarcados}
            onChange={() => {
              setTodaCarpeta(false);
              setSeleccion(todosMarcados ? new Set() : new Set(visibles.map((m) => m.id)));
            }}
            disabled={desactualizada}
            mx={6}
            data-testid='correo-seleccionar-todos'
          />
        </Tooltip>
      )}
      {seleccion.size > 0 ? (
        <Group justify='space-between' wrap='nowrap' gap='xs' style={{ flex: 1, minWidth: 0 }} data-testid='correo-barra-seleccion'>
          <Group gap='xs' wrap='nowrap' style={{ minWidth: 0 }}>
            {!desktop && <CloseButton aria-label='Quitar selección' onClick={quitarSeleccion} />}
            <Text size='sm' fw={600} truncate data-testid='correo-seleccion-texto'>
              {todaCarpeta && carpetaActual
                ? `Todos los ${carpetaActual.total.toLocaleString('es-CO')} correos de ${carpetaActual.etiqueta}`
                : `${seleccion.size} correo(s) seleccionado(s)`}
            </Text>
          </Group>
          <Group gap={4} wrap='nowrap'>
            {escritura && (
              <>
                <Tooltip label='Marcar como leído'>
                  <ActionIcon variant='subtle' color='gray' radius='xl' size='lg' onClick={() => void marcarSeleccion(true)} disabled={Boolean(marcado)} aria-label='Marcar como leído' data-testid='correo-sel-leido'>
                    <IconMailOpened size={18} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label='Marcar como no leído'>
                  <ActionIcon variant='subtle' color='gray' radius='xl' size='lg' onClick={() => void marcarSeleccion(false)} disabled={Boolean(marcado)} aria-label='Marcar como no leído' data-testid='correo-sel-no-leido'>
                    <IconMail size={18} />
                  </ActionIcon>
                </Tooltip>
              </>
            )}
            {puedeEliminar && !todaCarpeta && (
              <Tooltip label='Eliminar (a la Papelera)'>
                <ActionIcon
                  variant='subtle'
                  color='gray'
                  radius='xl'
                  size='lg'
                  onClick={() => void eliminar(mensajes.filter((m) => seleccion.has(m.id)))}
                  disabled={Boolean(marcado)}
                  aria-label='Eliminar'
                  data-testid='correo-sel-eliminar'
                >
                  <IconTrash size={18} />
                </ActionIcon>
              </Tooltip>
            )}
            {desktop && (
              <Button variant='subtle' size='compact-sm' onClick={quitarSeleccion}>
                Quitar selección
              </Button>
            )}
            {/* Simular / crear trabaja con correos concretos (máx. 50): no con la carpeta entera. */}
            {!todaCarpeta && (
              <Button size={desktop ? 'compact-md' : 'compact-sm'} leftSection={<IconFlask size={16} />} onClick={() => setSimulacion([...seleccion])} data-testid='correo-simular'>
                {desktop ? 'Simular / Crear solicitudes' : 'Crear solicitudes'}
              </Button>
            )}
          </Group>
        </Group>
      ) : (
        <Group justify='space-between' wrap='nowrap' gap='xs' style={{ flex: 1, minWidth: 0 }}>
          <Group gap={4} wrap='nowrap'>
            <Tooltip label='Actualizar'>
              <ActionIcon variant='subtle' color='gray' radius='xl' size='lg' onClick={refrescar} aria-label='Actualizar' data-testid='correo-actualizar'>
                <IconRefresh size={18} />
              </ActionIcon>
            </Tooltip>
            {escritura && (carpetaActual?.noLeidos ?? 0) > 0 && (
              <Tooltip label='Marcar todo como leído'>
                <ActionIcon variant='subtle' color='gray' radius='xl' size='lg' onClick={() => void marcarCarpetaEntera(true)} disabled={Boolean(marcado)} aria-label='Marcar todo como leído' data-testid='correo-marcar-todo'>
                  <IconChecks size={18} />
                </ActionIcon>
              </Tooltip>
            )}
            <Text size='sm' fw={600} truncate>
              {carpetaActual?.etiqueta ?? 'Recibidos'}
            </Text>
          </Group>
          <Text size='xs' c='dimmed' style={{ flexShrink: 0 }}>
            {visibles.length > 0 ? `${visibles.length.toLocaleString('es-CO')}${siguiente ? '+' : ''} correo(s)` : ''}
          </Text>
        </Group>
      )}
    </div>
  );

  // ---------------------------------------------------------------- selección de la carpeta entera y avance
  const totalCarpeta = carpetaActual?.total ?? 0;
  const puedeTodaCarpeta = escritura && desktop && todosMarcados && !hayFiltros && totalCarpeta > visibles.length;
  const avisoSeleccion =
    todaCarpeta && carpetaActual ? (
      <div className={css.avisoSeleccion} data-testid='correo-aviso-seleccion'>
        <Text size='sm'>
          Se seleccionaron los {totalCarpeta.toLocaleString('es-CO')} correos de {carpetaActual.etiqueta}.
        </Text>
        <Button variant='subtle' size='compact-sm' onClick={quitarSeleccion}>
          Quitar la selección
        </Button>
      </div>
    ) : puedeTodaCarpeta && carpetaActual ? (
      <div className={css.avisoSeleccion} data-testid='correo-aviso-seleccion'>
        <Text size='sm'>Se seleccionaron los {visibles.length} correos de esta página.</Text>
        <Button variant='subtle' size='compact-sm' onClick={() => setTodaCarpeta(true)} data-testid='correo-seleccionar-carpeta'>
          Seleccionar los {totalCarpeta.toLocaleString('es-CO')} correos de {carpetaActual.etiqueta}
        </Button>
      </div>
    ) : null;

  const progresoMarcado = marcado ? (
    <div className={css.avisoSeleccion} role='status' data-testid='correo-marcado-progreso'>
      <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
        <Text size='sm'>
          Marcando como {marcado.leido ? 'leídos' : 'no leídos'}: {marcado.hechos.toLocaleString('es-CO')} de {marcado.total.toLocaleString('es-CO')}…
        </Text>
        <Progress value={marcado.total ? (marcado.hechos / marcado.total) * 100 : 0} size='sm' animated={!reducirMovimiento} aria-label='Avance' />
      </Stack>
      <Button variant='default' size='compact-sm' onClick={() => (detenerMarcado.current = true)} data-testid='correo-marcado-detener'>
        Detener
      </Button>
    </div>
  ) : null;

  // ---------------------------------------------------------------- filas
  /** Deslizar: a la izquierda elimina (o pide confirmación si el hilo está vinculado); a la derecha, leído / no leído. */
  const deslizar = (m: MensajeLista): { izquierda: AccionDeslizar | null; derecha: AccionDeslizar | null } => ({
    izquierda: puedeEliminar
      ? { etiqueta: 'Eliminar', icono: <IconTrash size={20} />, color: 'rojo', salida: vinculosDeFilas([m]).length ? 'volver' : 'salir', alSoltar: () => void eliminar([m]) }
      : null,
    derecha: escritura
      ? { etiqueta: m.leido ? 'No leído' : 'Leído', icono: m.leido ? <IconMail size={20} /> : <IconMailOpened size={20} />, color: 'azul', salida: 'volver', alSoltar: () => alternarLeido(m) }
      : null,
  });

  const filaEscritorio = (m: MensajeLista) => {
    const sel = seleccion.has(m.id);
    return (
      <FilaDeslizable key={m.id} {...deslizar(m)} reducirMovimiento={reducirMovimiento}>
        <div
          className={css.fila}
          data-leido={m.leido ? '1' : '0'}
          data-seleccionado={sel ? '1' : '0'}
          onClick={() => abrir(m)}
          onKeyDown={(e) => teclaFila(e, m)}
          role='row'
          tabIndex={0}
          aria-label={`${m.leido ? '' : 'No leído. '}${m.de.nombre}: ${m.asunto || '(Sin asunto)'}`}
          data-testid='correo-fila'
        >
          <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex' }}>
            <Checkbox aria-label={`Seleccionar ${m.asunto}`} checked={sel} onChange={() => toggle(m.id)} data-testid='correo-seleccionar' />
          </div>
          <div className={`${css.de} ${m.leido ? '' : css.fuerte}`} title={m.de.correo}>
            {m.de.nombre || m.de.correo}
          </div>
          <div className={css.asunto}>
            {badgeSolicitud(m)}
            <span className={css.asuntoTexto}>
              <span className={m.leido ? undefined : css.fuerte}>{m.asunto || '(Sin asunto)'}</span>
              {m.extracto && <span className={css.extracto}> — {m.extracto}</span>}
            </span>
          </div>
          <div className={css.meta}>
            <span className={css.fecha}>
              {m.conAdjuntos && <IconPaperclip size={15} aria-label='Con adjuntos' />}
              <Tooltip label={fechaLarga(m.fecha)} openDelay={400}>
                <span>{fechaCorta(m.fecha)}</span>
              </Tooltip>
            </span>
            <span className={css.acciones} onClick={(e) => e.stopPropagation()}>
              <Tooltip label='Abrir el hilo'>
                <ActionIcon variant='subtle' color='gray' radius='xl' onClick={() => abrir(m)} aria-label={`Abrir ${m.asunto}`} data-testid='correo-fila-abrir'>
                  <IconMailOpened size={18} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label='Convertir en solicitud'>
                <ActionIcon variant='subtle' color='gray' radius='xl' onClick={() => setSimulacion([m.id])} aria-label={`Convertir en solicitud ${m.asunto}`} data-testid='correo-fila-crear'>
                  <IconFlask size={18} />
                </ActionIcon>
              </Tooltip>
              {puedeEliminar && (
                <Tooltip label='Eliminar (a la Papelera)'>
                  <ActionIcon variant='subtle' color='gray' radius='xl' onClick={() => void eliminar([m])} aria-label={`Eliminar ${m.asunto}`} data-testid='correo-fila-eliminar'>
                    <IconTrash size={18} />
                  </ActionIcon>
                </Tooltip>
              )}
            </span>
          </div>
        </div>
      </FilaDeslizable>
    );
  };

  const filaMovil = (m: MensajeLista) => {
    const sel = seleccion.has(m.id);
    const fuerte = m.leido ? undefined : css.fuerte;
    return (
      <FilaDeslizable key={m.id} {...deslizar(m)} reducirMovimiento={reducirMovimiento}>
        <div className={css.filaMovil} data-seleccionado={sel ? '1' : '0'} data-leido={m.leido ? '1' : '0'} onClick={() => abrir(m)} data-testid='correo-fila'>
          <button
            type='button'
            className={css.avatarSel}
            role='checkbox'
            aria-checked={sel}
            aria-label={`Seleccionar ${m.asunto}`}
            onClick={(e) => {
              e.stopPropagation();
              toggle(m.id);
            }}
            data-testid='correo-seleccionar'
          >
            {sel ? (
              <span className={css.avatarMarcado}>
                <IconCheck size={20} />
              </span>
            ) : (
              <AvatarPersona nombre={m.de.nombre} correo={m.de.correo} size={40} />
            )}
          </button>
          <div className={css.cuerpoMovil}>
            <div className={css.lineaMovil}>
              <Text size='sm' className={`${css.truncar} ${fuerte ?? ''}`}>
                {m.de.nombre || m.de.correo}
              </Text>
              <Text size='xs' c={m.leido ? 'dimmed' : undefined} className={fuerte} style={{ flexShrink: 0 }}>
                {fechaCorta(m.fecha)}
              </Text>
            </div>
            <Text size='sm' className={`${css.truncar} ${fuerte ?? ''}`}>
              {m.asunto || '(Sin asunto)'}
            </Text>
            <div className={css.lineaMovil}>
              <Text size='sm' c='dimmed' className={css.truncar}>
                {m.extracto}
              </Text>
              <Group gap={4} wrap='nowrap' style={{ flexShrink: 0 }}>
                {m.conAdjuntos && <IconPaperclip size={14} aria-label='Con adjuntos' />}
                {badgeSolicitud(m)}
              </Group>
            </div>
          </div>
        </div>
      </FilaDeslizable>
    );
  };

  const vacio = (
    <Stack align='center' gap='xs' p='xl' data-testid='correo-vacio'>
      <IconInbox size={40} color='var(--mantine-color-dimmed)' />
      <Text c='dimmed' ta='center'>
        {hayFiltros ? 'No hay correos con estos filtros.' : 'No hay correos en esta carpeta.'}
      </Text>
    </Stack>
  );

  const bandeja = (
    <Card withBorder radius='md' p={0} className={css.bandeja} style={hiloAbierto ? { display: 'none' } : undefined} data-testid='correo-bandeja'>
      {barra}
      {avisoSeleccion}
      {progresoMarcado}
      {/* La lista se desplaza por dentro (la barra queda fija); oculta, no desmontada, mientras se lee un hilo: al volver conserva la posición. */}
      <div className={css.listaScroll} data-testid='correo-lista-scroll'>
        {errorLista && !desactualizada && (
          <Alert color='red' icon={<IconAlertTriangle size={18} />} title='No se pudieron cargar los correos' m='sm' data-testid='correo-error-lista'>
            {errorLista}
          </Alert>
        )}
        {desactualizada ? (
          <EsqueletoFilas movil={!desktop} />
        ) : visibles.length === 0 && !cargando && !errorLista ? (
          vacio
        ) : (
          <div
            role='grid'
            aria-label='Correos'
            aria-busy={carga === 'refresco'}
            className={carga === 'refresco' ? css.listaAtenuada : undefined}
            data-testid='correo-lista'
          >
            {visibles.map((m) => (desktop ? filaEscritorio(m) : filaMovil(m)))}
          </div>
        )}
        {carga === 'mas' && <EsqueletoFilas filas={3} movil={!desktop} />}
        {cargando && (
          <Text className='sr-only' role='status' data-testid='correo-cargando'>
            Cargando correos…
          </Text>
        )}
        {siguiente && !cargando && (
          <Group justify='center' p='sm'>
            <Button variant='light' onClick={() => cargarMensajes(filtros, { cursor: siguiente })} data-testid='correo-cargar-mas'>
              Cargar más correos
            </Button>
          </Group>
        )}
        {!desktop && (
          <Box p='sm'>
            <AvisoPrivacidad />
          </Box>
        )}
      </div>
    </Card>
  );

  const hilo = hiloAbierto ? (
    <Card withBorder radius='md' p={0} className={css.panelHilo}>
      <HiloCorreo
        key={`${hiloAbierto}-${versionHilo}`}
        conversationId={hiloAbierto}
        carpeta={carpetaActual?.etiqueta ?? null}
        envioHabilitado={estado.conexion.envioHabilitado}
        nombreOperador={estado.usuario.nombre}
        correoOperador={estado.usuario.email}
        onVolver={cerrarHilo}
        escritura={escritura}
        marcarHilo={marcarHilo}
        onCambio={() => setHayCambios(true)}
        onCrearSolicitud={(ids) => setSimulacion(ids)}
      />
    </Card>
  ) : null;

  const envio = estado.conexion.envioHabilitado;
  const textoSinEnvio = 'Enviar correos desde SynerLink no está habilitado en este ambiente.';
  const botonRedactar = (
    <Tooltip label={textoSinEnvio} disabled={envio} withArrow>
      <div>
        <Button
          size='md'
          radius='lg'
          variant='light'
          leftSection={<IconPencil size={20} />}
          onClick={() => setRedactando(true)}
          disabled={!envio}
          fullWidth
          justify='flex-start'
          data-testid='correo-redactar-btn'
        >
          Redactar
        </Button>
      </div>
    </Tooltip>
  );
  const avisoEnviado = avisoEnvio ? (
    <Alert color='green' variant='light' icon={<IconCheck size={18} />} withCloseButton onClose={() => setAvisoEnvio(null)} p='xs' style={{ flex: '0 0 auto' }} data-testid='correo-aviso-enviado'>
      <Text size='sm'>{avisoEnvio}</Text>
    </Alert>
  ) : null;
  const alEnviar = ({ destinatarios, asunto }: { destinatarios: number; asunto: string }) => {
    setAvisoEnvio(`Correo ${asunto ? `«${asunto}» ` : ''}enviado desde su buzón a ${destinatarios === 1 ? '1 destinatario' : `${destinatarios} destinatarios`}. Quedó en Enviados.`);
    // Los contadores (y la lista, si está en Enviados) se refrescan sin desmontar el aviso.
    cargarCarpetas();
    if (carpetaActual?.tipo === 'enviados') void cargarMensajes(filtrosRef.current, { refresco: true });
  };
  const redactar = (
    <RedactarCorreo
      abierto={redactando}
      desktop={desktop}
      correoOperador={estado.conexion.correo}
      dominiosGrupo={estado.dominiosGrupo ?? []}
      onCerrar={() => setRedactando(false)}
      onEnviado={alEnviar}
    />
  );

  const elegirCarpeta = (id: string | null) => {
    cambiar({ carpeta: id });
    setPanelCarpetas(false);
    // Como Gmail: elegir una carpeta con un hilo abierto vuelve a la lista (de esa carpeta).
    if (hiloAbierto) cerrarHilo();
  };

  return (
    <div className={css.pantalla}>
      <Encabezado estado={estado} empresa={empresa} setEmpresa={setEmpresa} />
      {listo && avisoEnviado}

      {!listo ? (
        <NoDisponible estado={estado} />
      ) : desktop ? (
        <div className={css.layout}>
          <aside className={css.sidebar}>
            <Stack gap='md'>
              {botonRedactar}
              <ListaCarpetas carpetas={carpetas} actual={filtros.carpeta} cargando={cargandoCarpetas} onElegir={elegirCarpeta} />
              <AvisoPrivacidad />
            </Stack>
          </aside>
          <div className={css.principal}>
            <div className={css.fijo}>{buscador}</div>
            {!hiloAbierto && chips}
            {bandeja}
            {hilo}
          </div>
        </div>
      ) : (
        <div className={css.principal}>
          {/* Celular: el hilo es una vista a pantalla completa con ← (sin buscador ni chips encima). */}
          {!hiloAbierto && (
            <>
              <Group gap='xs' wrap='nowrap' className={css.fijo}>
                <Tooltip label='Carpetas'>
                  <ActionIcon variant='default' radius='xl' size={36} onClick={() => setPanelCarpetas(true)} aria-label='Carpetas' data-testid='correo-menu-carpetas'>
                    <IconFolders size={18} />
                  </ActionIcon>
                </Tooltip>
                {buscador}
              </Group>
              {chips}
            </>
          )}
          {bandeja}
          {hilo}
          {!hiloAbierto && !redactando && envio && (
            <Button
              className={css.fabRedactar}
              size='lg'
              radius='xl'
              leftSection={<IconPencil size={20} />}
              onClick={() => setRedactando(true)}
              aria-label='Redactar correo nuevo'
              data-testid='correo-redactar-fab'
            >
              Redactar
            </Button>
          )}
          <Drawer opened={panelCarpetas} onClose={() => setPanelCarpetas(false)} position='left' size='80%' title='Carpetas' data-testid='correo-carpetas-drawer'>
            <ListaCarpetas carpetas={carpetas} actual={filtros.carpeta} cargando={cargandoCarpetas} onElegir={elegirCarpeta} />
          </Drawer>
        </div>
      )}

      {listo && redactar}
      <Modal
        opened={Boolean(confirmarMarcado)}
        onClose={() => setConfirmarMarcado(null)}
        title={confirmarMarcado?.leido ? 'Marcar todo como leído' : 'Marcar todo como no leído'}
        centered
        data-testid='correo-confirmar-marcado'
      >
        {confirmarMarcado && (
          <Stack gap='sm'>
            <Text size='sm'>
              Va a marcar {confirmarMarcado.total.toLocaleString('es-CO')} correos de {carpetaActual?.etiqueta ?? 'esta carpeta'} como{' '}
              {confirmarMarcado.leido ? 'leídos' : 'no leídos'} en su buzón de Outlook.
              {confirmarMarcado.total > CORREO_MAX_MARCAR_CARPETA
                ? ` Por seguridad se marcan como máximo ${CORREO_MAX_MARCAR_CARPETA.toLocaleString('es-CO')} por vez; luego puede repetir.`
                : ''}
            </Text>
            <Group justify='flex-end'>
              <Button variant='default' onClick={() => setConfirmarMarcado(null)}>
                Cancelar
              </Button>
              <Button
                onClick={() => {
                  const c = confirmarMarcado;
                  setConfirmarMarcado(null);
                  void marcarCarpetaEntera(c.leido, true);
                }}
                data-testid='correo-confirmar-marcado-si'
              >
                Marcar {Math.min(confirmarMarcado.total, CORREO_MAX_MARCAR_CARPETA).toLocaleString('es-CO')} correos
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>

      <Modal
        opened={Boolean(confirmarEliminar)}
        onClose={() => setConfirmarEliminar(null)}
        title={confirmarEliminar && confirmarEliminar.filas.length > 1 ? 'Eliminar correos vinculados' : 'Eliminar un correo vinculado'}
        centered
        data-testid='correo-confirmar-eliminar'
      >
        {confirmarEliminar && (
          <Stack gap='sm'>
            <Alert color='yellow' icon={<IconAlertTriangle size={18} />} p='sm'>
              <Text size='sm' fw={600} mb={4}>
                {confirmarEliminar.vinculos.length === 1 ? 'El hilo de este correo está vinculado a:' : 'Los hilos de estos correos están vinculados a:'}
              </Text>
              <Stack gap={2} data-testid='correo-confirmar-eliminar-vinculos'>
                {[...new Map(confirmarEliminar.vinculos.map((v) => [v.conversationId, v])).values()].map((v) => (
                  <Text size='sm' key={v.conversationId}>
                    {[v.idRequest ? `Solicitud #${v.idRequest}` : null, ...v.proyectos.map((p) => `Proyecto «${p}»`)].filter(Boolean).join(' · ')}
                  </Text>
                ))}
              </Stack>
            </Alert>
            <Text size='sm'>
              {confirmarEliminar.filas.length === 1 ? 'El correo se moverá' : `Los ${confirmarEliminar.filas.length} correos se moverán`} a la Papelera de Outlook; no
              se borra. La solicitud y el proyecto conservan el vínculo, las notas y la copia que ya tienen. Podrá deshacerlo enseguida o restaurarlo desde la
              Papelera.
            </Text>
            <Group justify='flex-end'>
              <Button variant='default' onClick={() => setConfirmarEliminar(null)}>
                Cancelar
              </Button>
              <Button
                color='red'
                leftSection={<IconTrash size={16} />}
                onClick={() => {
                  const c = confirmarEliminar;
                  setConfirmarEliminar(null);
                  void eliminar(c.filas, true);
                }}
                data-testid='correo-confirmar-eliminar-si'
              >
                Eliminar
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>

      {simulacion && idEmpresa && (
        <SimulacionModal
          opened={Boolean(simulacion)}
          mensajesIds={simulacion}
          empresas={estado.empresas}
          empresaInicial={idEmpresa}
          idOperador={estado.usuario.id}
          etiquetarHabilitado={estado.conexion.etiquetarHabilitado}
          envioHabilitado={estado.conexion.envioHabilitado}
          nombreOperador={estado.usuario.nombre}
          onClose={(huboCreadas) => {
            setSimulacion(null);
            // Se refresca al CERRAR (no durante la creación): el resumen no se desmonta.
            if (huboCreadas) {
              setSeleccion(new Set());
              void cargarMensajes(filtros, { refresco: true });
              // Con el hilo abierto, se vuelve a leer (ya con su solicitud vinculada) sin salir de él.
              if (hiloAbierto) setVersionHilo((v) => v + 1);
            }
          }}
        />
      )}
    </div>
  );
}
