'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Alert,
  Anchor,
  Badge,
  Box,
  Breadcrumbs,
  Button,
  Card,
  Checkbox,
  Group,
  Loader,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import {
  IconAlertTriangle,
  IconChevronRight,
  IconFilter,
  IconFlask,
  IconLink,
  IconLock,
  IconMail,
  IconPaperclip,
  IconRefresh,
  IconSearch,
  IconX,
} from '@tabler/icons-react';
import SgcSelect from '../sgc/SgcSelect';
import type { Carpeta } from '../../lib/correo/types';
import { CorreoApiError, correoApi, fechaCorta, urlSolicitud, type EstadoCorreo, type MensajeLista } from './correoClient';
import HiloDrawer from './HiloDrawer';
import SimulacionModal from './SimulacionModal';

/**
 * Módulo «Correo»: la bandeja de Outlook de la persona dentro de SynerLink
 * (solo SU buzón: el servidor lo toma de la sesión), con filtros, hilos, respuesta y la
 * creación masiva de solicitudes con simulación. Celular primero: en pantallas
 * angostas la bandeja se muestra en tarjetas y el hilo ocupa toda la pantalla.
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
    <Card shadow='sm' p={{ base: 'md', sm: 'xl' }} radius='md' withBorder mb='md'>
      <Breadcrumbs separator={<IconChevronRight size={16} />} mb='sm' style={{ flexWrap: 'wrap' }}>
        <Anchor component={Link} href='/process'>
          Procesos
        </Anchor>
        <Text>Correo</Text>
      </Breadcrumbs>
      <Group justify='space-between' align='flex-end' wrap='wrap' gap='md'>
        <div style={{ minWidth: 0 }}>
          <Title order={1} fz={{ base: 26, sm: 30 }} className='font-bold mb-1 flex items-center gap-3' data-testid='correo-titulo'>
            <IconMail size={28} className='text-blue-600' style={{ flexShrink: 0 }} />
            Correo
          </Title>
          <Text size='md' c='dimmed'>
            Su bandeja de Outlook: revise hilos, responda y convierta correos en solicitudes
          </Text>
          <Group gap='xs' mt={6}>
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
        <Group gap='sm' align='flex-end' wrap='wrap' w={{ base: '100%', sm: 'auto' }}>
          {estado.empresas.length > 1 && (
            <SgcSelect
              label='Empresa de las solicitudes'
              size='md'
              data={estado.empresas.map((c) => ({ value: String(c.idCompany), label: c.companyName }))}
              value={empresa}
              onChange={setEmpresa}
              allowDeselect={false}
              w={{ base: '100%', sm: 240 }}
            />
          )}
        </Group>
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
      const match = e.empresas.find((c) => String(c.idCompany) === pref) ?? e.empresas[0];
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
  }, [cargarEstado]);

  useEffect(() => {
    if (!listo) return;
    correoApi
      .carpetas()
      .then((r) => setCarpetas(r.carpetas))
      .catch(() => setCarpetas([]));
  }, [listo]);

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

  const carpetaData = useMemo(
    () => carpetas.map((c) => ({ value: c.id, label: c.noLeidos ? `${c.nombre} (${c.noLeidos})` : c.nombre })),
    [carpetas]
  );

  const aplicar = () => setFiltros({ ...borrador });
  const limpiar = () => {
    setBorrador(FILTROS_VACIOS);
    setFiltros(FILTROS_VACIOS);
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

  const filaMensaje = (m: MensajeLista) => (
    <Group gap={6} wrap='nowrap' style={{ minWidth: 0 }}>
      {!m.leido && <Box w={8} h={8} style={{ borderRadius: 8, background: 'var(--mantine-color-blue-6)', flexShrink: 0 }} aria-label='No leído' />}
      <Stack gap={0} style={{ minWidth: 0 }}>
        <Text size='sm' fw={m.leido ? 500 : 700} truncate>
          {m.asunto || '(Sin asunto)'}
        </Text>
        <Text size='xs' c='dimmed' lineClamp={1}>
          {m.extracto}
        </Text>
      </Stack>
    </Group>
  );

  const etiquetas = (m: MensajeLista) => (
    <Group gap={4} wrap='nowrap'>
      {m.conAdjuntos && <IconPaperclip size={14} aria-label='Con adjuntos' />}
      {m.solicitud && (
        <Badge
          size='sm'
          color='teal'
          variant='light'
          leftSection={<IconLink size={10} />}
          component='a'
          href={urlSolicitud(m.solicitud)}
          onClick={(e: React.MouseEvent) => e.stopPropagation()}
          style={{ cursor: 'pointer' }}
          data-testid='correo-badge-solicitud'
        >
          #{m.solicitud}
        </Badge>
      )}
    </Group>
  );

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--mantine-color-body)' }}>
      <div className='max-w-7xl mx-auto py-3 sm:py-8 px-3 sm:px-6 lg:px-8'>
        <Encabezado estado={estado} empresa={empresa} setEmpresa={setEmpresa} />

        {!listo ? (
          <NoDisponible estado={estado} />
        ) : (
          <Stack gap='md'>
            <AvisoPrivacidad />
            <Card withBorder radius='md' p='sm'>
              <Stack gap='sm'>
                <Group gap='sm' align='flex-end' wrap='wrap'>
                  <SgcSelect
                    label='Carpeta'
                    data={carpetaData}
                    value={borrador.carpeta}
                    placeholder='Bandeja de entrada'
                    clearable
                    onChange={(v) => {
                      const n = { ...borrador, carpeta: v };
                      setBorrador(n);
                      setFiltros(n);
                    }}
                    w={{ base: '100%', sm: 220 }}
                  />
                  <TextInput
                    label='Buscar'
                    placeholder='Asunto, texto o remitente'
                    leftSection={<IconSearch size={16} />}
                    value={borrador.buscar}
                    onChange={(e) => setBorrador({ ...borrador, buscar: e.currentTarget.value })}
                    onKeyDown={(e) => e.key === 'Enter' && aplicar()}
                    style={{ flex: 1, minWidth: 200 }}
                    data-testid='correo-buscar'
                  />
                  <Button variant='light' leftSection={<IconFilter size={16} />} onClick={() => setFiltrosAbiertos((v) => !v)} data-testid='correo-mas-filtros'>
                    Filtros
                  </Button>
                  <Button onClick={aplicar} leftSection={<IconSearch size={16} />} data-testid='correo-aplicar'>
                    Aplicar
                  </Button>
                  <Tooltip label='Actualizar'>
                    <Button variant='default' onClick={() => cargarMensajes(filtros)} aria-label='Actualizar'>
                      <IconRefresh size={16} />
                    </Button>
                  </Tooltip>
                </Group>
                {filtrosAbiertos && (
                  <Group gap='sm' align='flex-end' wrap='wrap' data-testid='correo-filtros'>
                    <TextInput type='date' label='Desde' value={borrador.desde} onChange={(e) => setBorrador({ ...borrador, desde: e.currentTarget.value })} w={{ base: '47%', sm: 170 }} />
                    <TextInput type='date' label='Hasta' value={borrador.hasta} onChange={(e) => setBorrador({ ...borrador, hasta: e.currentTarget.value })} w={{ base: '47%', sm: 170 }} />
                    <TextInput
                      type='email'
                      label='De (correo)'
                      placeholder='persona@empresa.com'
                      value={borrador.de}
                      onChange={(e) => setBorrador({ ...borrador, de: e.currentTarget.value })}
                      w={{ base: '100%', sm: 240 }}
                    />
                    <Switch label='No leídos' checked={borrador.noLeidos} onChange={(e) => setBorrador({ ...borrador, noLeidos: e.currentTarget.checked })} />
                    <Switch label='Con adjuntos' checked={borrador.conAdjuntos} onChange={(e) => setBorrador({ ...borrador, conAdjuntos: e.currentTarget.checked })} />
                    <Button variant='subtle' leftSection={<IconX size={14} />} onClick={limpiar}>
                      Limpiar filtros
                    </Button>
                  </Group>
                )}
              </Stack>
            </Card>

            {seleccion.size > 0 && (
              <Card withBorder radius='md' p='sm' bg='var(--mantine-color-blue-light)' style={{ position: 'sticky', top: 8, zIndex: 5 }} data-testid='correo-barra-seleccion'>
                <Group justify='space-between' wrap='wrap' gap='xs'>
                  <Text size='sm' fw={600}>
                    {seleccion.size} correo(s) seleccionado(s)
                  </Text>
                  <Group gap='xs'>
                    <Button variant='default' size='sm' onClick={() => setSeleccion(new Set())}>
                      Quitar selección
                    </Button>
                    <Button size='sm' leftSection={<IconFlask size={16} />} onClick={() => setSimulacion([...seleccion])} data-testid='correo-simular'>
                      Simular creación de solicitudes
                    </Button>
                  </Group>
                </Group>
              </Card>
            )}

            {errorLista && (
              <Alert color='red' icon={<IconAlertTriangle size={18} />} title='No se pudieron cargar los correos' data-testid='correo-error-lista'>
                {errorLista}
              </Alert>
            )}

            {mensajes.length === 0 && !cargando && !errorLista ? (
              <Card withBorder radius='md' p='lg'>
                <Text c='dimmed' ta='center'>
                  No hay correos con estos filtros.
                </Text>
              </Card>
            ) : desktop ? (
              <Card withBorder radius='md' p={0}>
                <Table highlightOnHover verticalSpacing='xs' data-testid='correo-lista'>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th w={40}>
                        <Checkbox
                          aria-label='Seleccionar todos'
                          checked={todosMarcados}
                          indeterminate={seleccion.size > 0 && !todosMarcados}
                          onChange={() => setSeleccion(todosMarcados ? new Set() : new Set(mensajes.map((m) => m.id)))}
                        />
                      </Table.Th>
                      <Table.Th w={220}>De</Table.Th>
                      <Table.Th>Asunto</Table.Th>
                      <Table.Th w={110}></Table.Th>
                      <Table.Th w={100}>Fecha</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {mensajes.map((m) => (
                      <Table.Tr key={m.id} style={{ cursor: 'pointer' }} onClick={() => setHiloAbierto(m.conversationId)} data-testid='correo-fila'>
                        <Table.Td onClick={(e) => e.stopPropagation()}>
                          <Checkbox aria-label={`Seleccionar ${m.asunto}`} checked={seleccion.has(m.id)} onChange={() => toggle(m.id)} data-testid='correo-seleccionar' />
                        </Table.Td>
                        <Table.Td>
                          <Text size='sm' fw={m.leido ? 400 : 700} truncate maw={210}>
                            {m.de.nombre}
                          </Text>
                        </Table.Td>
                        <Table.Td style={{ maxWidth: 0 }}>{filaMensaje(m)}</Table.Td>
                        <Table.Td>{etiquetas(m)}</Table.Td>
                        <Table.Td>
                          <Text size='xs' c='dimmed'>
                            {fechaCorta(m.fecha)}
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Card>
            ) : (
              <Stack gap='xs' data-testid='correo-lista'>
                {mensajes.map((m) => (
                  <Card key={m.id} withBorder radius='md' p='sm' data-testid='correo-fila'>
                    <Group wrap='nowrap' align='flex-start' gap='sm'>
                      <Checkbox mt={4} aria-label={`Seleccionar ${m.asunto}`} checked={seleccion.has(m.id)} onChange={() => toggle(m.id)} data-testid='correo-seleccionar' />
                      <UnstyledButton onClick={() => setHiloAbierto(m.conversationId)} style={{ flex: 1, minWidth: 0 }}>
                        <Group justify='space-between' wrap='nowrap' gap={4}>
                          <Text size='sm' fw={m.leido ? 500 : 700} truncate>
                            {m.de.nombre}
                          </Text>
                          <Text size='xs' c='dimmed' style={{ flexShrink: 0 }}>
                            {fechaCorta(m.fecha)}
                          </Text>
                        </Group>
                        {filaMensaje(m)}
                        <Box mt={4}>{etiquetas(m)}</Box>
                      </UnstyledButton>
                    </Group>
                  </Card>
                ))}
              </Stack>
            )}
            {cargando && (
              <Group justify='center' p='md'>
                <Loader size='sm' />
              </Group>
            )}
            {siguiente && !cargando && (
              <Group justify='center'>
                <Button variant='light' onClick={() => cargarMensajes(filtros, siguiente)} data-testid='correo-cargar-mas'>
                  Cargar más correos
                </Button>
              </Group>
            )}
          </Stack>
        )}
      </div>

      <HiloDrawer
        conversationId={hiloAbierto}
        envioHabilitado={estado.conexion.envioHabilitado}
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
