'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Box,
  Breadcrumbs,
  Button,
  Card,
  Checkbox,
  Chip,
  CloseButton,
  Drawer,
  Group,
  Loader,
  NavLink,
  Popover,
  Stack,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import {
  IconAdjustmentsHorizontal,
  IconAlertTriangle,
  IconCheck,
  IconChevronRight,
  IconFlask,
  IconFolders,
  IconInbox,
  IconLink,
  IconLock,
  IconMail,
  IconMailOpened,
  IconPaperclip,
  IconRefresh,
  IconSearch,
  IconX,
} from '@tabler/icons-react';
import SgcSelect from '../sgc/SgcSelect';
import type { Carpeta } from '../../lib/correo/types';
import { CorreoApiError, correoApi, fechaCorta, fechaLarga, urlSolicitud, type EstadoCorreo, type MensajeLista } from './correoClient';
import HiloDrawer from './HiloDrawer';
import SimulacionModal from './SimulacionModal';
import { AvatarPersona, carpetasOrdenadas, IconoCarpeta } from './ui';
import css from './correo.module.css';

/**
 * Módulo «Correo»: la bandeja de Outlook de la persona dentro de SynerLink (solo SU buzón:
 * el servidor lo toma de la sesión), con la distribución de Gmail: carpetas a la izquierda,
 * buscador arriba con filtros rápidos, lista densa (remitente, asunto + extracto, adjuntos y
 * fecha a la derecha, acciones al pasar el mouse) y la barra de selección para crear
 * solicitudes con simulación. En el celular: la lista primero y las carpetas en un panel.
 */

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

function Encabezado({ estado, empresa, setEmpresa }: { estado: EstadoCorreo; empresa: string | null; setEmpresa: (v: string | null) => void }) {
  const { conexion } = estado;
  return (
    <Card shadow='sm' p={{ base: 'md', sm: 'lg' }} radius='md' withBorder mb='md'>
      <Breadcrumbs separator={<IconChevronRight size={16} />} mb='xs' style={{ flexWrap: 'wrap' }}>
        <Anchor component={Link} href='/process'>
          Procesos
        </Anchor>
        <Text>Correo</Text>
      </Breadcrumbs>
      <Group justify='space-between' align='flex-end' wrap='wrap' gap='md'>
        <div style={{ minWidth: 0 }}>
          <Title order={1} fz={{ base: 24, sm: 28 }} className='font-bold mb-1 flex items-center gap-3' data-testid='correo-titulo'>
            <IconMail size={26} className='text-blue-600' style={{ flexShrink: 0 }} />
            Correo
          </Title>
          <Group gap='xs'>
            <Text size='sm' c='dimmed' visibleFrom='sm'>
              Su bandeja de Outlook: revise hilos, responda y convierta correos en solicitudes
            </Text>
            {conexion.modo === 'mock' && (
              <Badge color='grape' variant='light' leftSection={<IconFlask size={12} />} data-testid='correo-modo-simulado'>
                Buzón simulado (pruebas)
              </Badge>
            )}
            {conexion.disponible && (
              <Badge color='teal' variant='light' leftSection={<IconMail size={12} />} style={{ textTransform: 'none' }} data-testid='correo-buzon'>
                {conexion.correo}
              </Badge>
            )}
          </Group>
        </div>
        {estado.empresas.length > 1 && (
          <SgcSelect
            label='Empresa de las solicitudes'
            size='sm'
            data={estado.empresas.map((c) => ({ value: String(c.idCompany), label: c.companyName }))}
            value={empresa}
            onChange={setEmpresa}
            allowDeselect={false}
            w={{ base: '100%', sm: 240 }}
          />
        )}
      </Group>
    </Card>
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
function ListaCarpetas({ carpetas, actual, onElegir }: { carpetas: Carpeta[]; actual: string | null; onElegir: (id: string | null) => void }) {
  const orden = carpetasOrdenadas(carpetas);
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
  const [estado, setEstado] = useState<EstadoCorreo | null>(null);
  const [errorEstado, setErrorEstado] = useState<{ status: number; mensaje: string } | null>(null);
  const [empresa, setEmpresaState] = useState<string | null>(null);
  const [carpetas, setCarpetas] = useState<Carpeta[]>([]);
  const [filtros, setFiltros] = useState<Filtros>(FILTROS_VACIOS);
  const [borrador, setBorrador] = useState<Filtros>(FILTROS_VACIOS);
  const [mensajes, setMensajes] = useState<MensajeLista[]>([]);
  const [siguiente, setSiguiente] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [errorLista, setErrorLista] = useState<string | null>(null);
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [hiloAbierto, setHiloAbierto] = useState<string | null>(null);
  const [simulacion, setSimulacion] = useState<string[] | null>(null);
  const [hayCambios, setHayCambios] = useState(false);
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(false);
  const [panelCarpetas, setPanelCarpetas] = useState(false);

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
    // Enlace desde una solicitud: /process/correo?hilo=<conversationId>
    const hilo = new URLSearchParams(window.location.search).get('hilo');
    if (hilo && /^[A-Za-z0-9+=_-]{8,512}$/.test(hilo)) setHiloAbierto(hilo);
    if (hilo) window.history.replaceState(null, '', window.location.pathname);
  }, [cargarEstado]);

  const listo = Boolean(estado?.conexion.disponible);

  const cargarMensajes = useCallback(async (f: Filtros, cursor?: string | null) => {
    setCargando(true);
    setErrorLista(null);
    try {
      const r = await correoApi.mensajes(aParams(f, cursor));
      setMensajes((prev) => (cursor ? [...prev, ...r.mensajes] : r.mensajes));
      setSiguiente(r.siguiente);
    } catch (e) {
      setErrorLista(e instanceof Error ? e.message : String(e));
    } finally {
      setCargando(false);
    }
  }, []);

  const cargarCarpetas = useCallback(() => {
    correoApi
      .carpetas()
      .then((r) => setCarpetas(r.carpetas))
      .catch(() => setCarpetas([]));
  }, []);

  useEffect(() => {
    if (listo) cargarCarpetas();
  }, [listo, cargarCarpetas]);

  useEffect(() => {
    if (!listo) return;
    setSeleccion(new Set());
    void cargarMensajes(filtros);
  }, [listo, filtros, cargarMensajes]);

  const setEmpresa = (v: string | null) => {
    setEmpresaState(v);
    try {
      if (v) window.sessionStorage.setItem(EMPRESA_KEY, v);
    } catch {
      /* sin almacenamiento */
    }
  };

  const toggle = (id: string) =>
    setSeleccion((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const todosMarcados = mensajes.length > 0 && mensajes.every((m) => seleccion.has(m.id));

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
    void cargarMensajes(filtros);
    cargarCarpetas();
  };

  const carpetaActual = useMemo(() => {
    const orden = carpetasOrdenadas(carpetas);
    return filtros.carpeta ? orden.find((c) => c.id === filtros.carpeta) : orden.find((c) => c.tipo === 'entrada');
  }, [carpetas, filtros.carpeta]);

  const hayFiltros = Boolean(filtros.buscar.trim() || filtros.desde || filtros.hasta || filtros.de.trim() || filtros.noLeidos || filtros.conAdjuntos);

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

  const abrir = (m: MensajeLista) => setHiloAbierto(m.conversationId);
  const teclaFila = (e: React.KeyboardEvent, m: MensajeLista) => {
    if (e.key === 'Enter') abrir(m);
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
            onChange={() => setSeleccion(todosMarcados ? new Set() : new Set(mensajes.map((m) => m.id)))}
            mx={6}
            data-testid='correo-seleccionar-todos'
          />
        </Tooltip>
      )}
      {seleccion.size > 0 ? (
        <Group justify='space-between' wrap='nowrap' gap='xs' style={{ flex: 1, minWidth: 0 }} data-testid='correo-barra-seleccion'>
          <Group gap='xs' wrap='nowrap' style={{ minWidth: 0 }}>
            {!desktop && <CloseButton aria-label='Quitar selección' onClick={() => setSeleccion(new Set())} />}
            <Text size='sm' fw={600} truncate>
              {seleccion.size} correo(s) seleccionado(s)
            </Text>
          </Group>
          <Group gap='xs' wrap='nowrap'>
            {desktop && (
              <Button variant='subtle' size='compact-sm' onClick={() => setSeleccion(new Set())}>
                Quitar selección
              </Button>
            )}
            <Button size={desktop ? 'compact-md' : 'compact-sm'} leftSection={<IconFlask size={16} />} onClick={() => setSimulacion([...seleccion])} data-testid='correo-simular'>
              {desktop ? 'Simular / Crear solicitudes' : 'Crear solicitudes'}
            </Button>
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
            <Text size='sm' fw={600} truncate>
              {carpetaActual?.etiqueta ?? 'Recibidos'}
            </Text>
          </Group>
          <Text size='xs' c='dimmed' style={{ flexShrink: 0 }}>
            {mensajes.length > 0 ? `${mensajes.length.toLocaleString('es-CO')}${siguiente ? '+' : ''} correo(s)` : ''}
          </Text>
        </Group>
      )}
    </div>
  );

  // ---------------------------------------------------------------- filas
  const filaEscritorio = (m: MensajeLista) => {
    const sel = seleccion.has(m.id);
    return (
      <div
        key={m.id}
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
          </span>
        </div>
      </div>
    );
  };

  const filaMovil = (m: MensajeLista) => {
    const sel = seleccion.has(m.id);
    const fuerte = m.leido ? undefined : css.fuerte;
    return (
      <div key={m.id} className={css.filaMovil} data-seleccionado={sel ? '1' : '0'} onClick={() => abrir(m)} data-testid='correo-fila'>
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
    <Card withBorder radius='md' p={0} className={css.bandeja}>
      {barra}
      {errorLista && (
        <Alert color='red' icon={<IconAlertTriangle size={18} />} title='No se pudieron cargar los correos' m='sm' data-testid='correo-error-lista'>
          {errorLista}
        </Alert>
      )}
      {mensajes.length === 0 && !cargando && !errorLista ? (
        vacio
      ) : (
        <div role='grid' aria-label='Correos' data-testid='correo-lista'>
          {mensajes.map((m) => (desktop ? filaEscritorio(m) : filaMovil(m)))}
        </div>
      )}
      {cargando && (
        <Group justify='center' p='md'>
          <Loader size='sm' />
        </Group>
      )}
      {siguiente && !cargando && (
        <Group justify='center' p='sm'>
          <Button variant='light' onClick={() => cargarMensajes(filtros, siguiente)} data-testid='correo-cargar-mas'>
            Cargar más correos
          </Button>
        </Group>
      )}
    </Card>
  );

  const elegirCarpeta = (id: string | null) => {
    cambiar({ carpeta: id });
    setPanelCarpetas(false);
  };

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--mantine-color-body)' }}>
      <div className='max-w-[1600px] mx-auto py-3 sm:py-6 px-3 sm:px-6 lg:px-8'>
        <Encabezado estado={estado} empresa={empresa} setEmpresa={setEmpresa} />

        {!listo ? (
          <NoDisponible estado={estado} />
        ) : desktop ? (
          <div className={css.layout}>
            <aside className={css.sidebar}>
              <Stack gap='md'>
                <ListaCarpetas carpetas={carpetas} actual={filtros.carpeta} onElegir={elegirCarpeta} />
                <AvisoPrivacidad />
              </Stack>
            </aside>
            <Stack gap='sm' style={{ minWidth: 0 }}>
              {buscador}
              {chips}
              {bandeja}
            </Stack>
          </div>
        ) : (
          <Stack gap='sm'>
            <Group gap='xs' wrap='nowrap'>
              <Tooltip label='Carpetas'>
                <ActionIcon variant='default' radius='xl' size={36} onClick={() => setPanelCarpetas(true)} aria-label='Carpetas' data-testid='correo-menu-carpetas'>
                  <IconFolders size={18} />
                </ActionIcon>
              </Tooltip>
              {buscador}
            </Group>
            {chips}
            {bandeja}
            <AvisoPrivacidad />
            <Drawer opened={panelCarpetas} onClose={() => setPanelCarpetas(false)} position='left' size='80%' title='Carpetas' data-testid='correo-carpetas-drawer'>
              <ListaCarpetas carpetas={carpetas} actual={filtros.carpeta} onElegir={elegirCarpeta} />
            </Drawer>
          </Stack>
        )}
      </div>

      <HiloDrawer
        conversationId={hiloAbierto}
        envioHabilitado={estado.conexion.envioHabilitado}
        nombreOperador={estado.usuario.nombre}
        correoOperador={estado.usuario.email}
        onClose={() => {
          setHiloAbierto(null);
          if (hayCambios) {
            setHayCambios(false);
            void cargarMensajes(filtros);
          }
        }}
        onCambio={() => setHayCambios(true)}
        onCrearSolicitud={(ids) => setSimulacion(ids)}
      />

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
              void cargarMensajes(filtros);
              if (hiloAbierto) setHiloAbierto(null);
            }
          }}
        />
      )}
    </div>
  );
}
