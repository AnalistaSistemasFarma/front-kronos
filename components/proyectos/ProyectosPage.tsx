'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ActionIcon, Badge, Button, Card, Group, SegmentedControl, Stack, Text, TextInput, ThemeIcon } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconBrandGithub, IconFolderPlus, IconFolders, IconLink, IconMessages, IconSearch, IconSettings, IconUsers } from '@tabler/icons-react';
import { apiGet, fechaCorta } from './api';
import NuevoProyectoModal from './NuevoProyectoModal';
import CatalogoReposModal from './permisos/CatalogoReposModal';
import type { OpcionesPermisosDto } from '../../lib/proyectos/permisos-agentes-tipos';
import { AgentesApilados, AvisoArriba, BadgeRol, CONSULTA_ESCRITORIO, Encabezado, EsqueletoTarjetas, type Aviso } from './ui';
import type { ListaProyectosDto, ProyectoResumenDto } from '../../lib/proyectos/tipos';
import type { AccesoConfigDto } from '../../lib/proyectos/config-agentes-tipos';
import css from './proyectos.module.css';
import { LineaEstadoAgente } from './EstadoAgente';
import { useEstadosAgentes } from './useEstadosAgentes';
import { resumenTrabajando, vistaEstadoAgente, type EstadoAgenteProyectoDto } from '../../lib/proyectos/estado-agente';

/**
 * Módulo «Proyectos» — la lista (/process/proyectos).
 *
 * Un proyecto es un espacio de trabajo con uno o varios asistentes, sus
 * miembros (dueño, editores y lectores), sus archivos y los correos y
 * solicitudes que se le vinculan. Aquí solo aparecen los proyectos donde la
 * persona es miembro; el servidor no devuelve nada más.
 */

function TarjetaProyecto({ p, onAbrir, estados }: { p: ProyectoResumenDto; onAbrir: () => void; estados: EstadoAgenteProyectoDto[] }) {
  // «Orus está trabajando…» (2026-10-20): quién trabaja ahora en alguna conversación del proyecto.
  const r = resumenTrabajando(estados);
  const vista = r.primero ? { ...vistaEstadoAgente(r.primero, r.primero.agent.displayName), texto: r.texto } : null;
  // Con varias conversaciones, la actividad de una sola confundiría: solo con una.
  if (vista && r.n > 1) vista.actividad = null;
  return (
    <Card
      withBorder
      radius='md'
      p='md'
      component='button'
      type='button'
      onClick={onAbrir}
      className={css.tarjeta}
      data-testid='proyecto-tarjeta'
      data-trabajando={r.n > 0 ? 'true' : undefined}
    >
      <Group justify='space-between' wrap='nowrap' gap='xs' align='flex-start'>
        <Text fw={600} size='md' lineClamp={2} style={{ minWidth: 0 }}>
          {p.name}
        </Text>
        <BadgeRol role={p.myRole} />
      </Group>
      <Group gap={6} wrap='wrap'>
        <Badge size='sm' variant='light' color='blue' style={{ textTransform: 'none' }}>
          {p.company.companyName}
        </Badge>
        <Badge size='sm' variant='outline' color='gray' style={{ textTransform: 'none' }}>
          {p.profile.label}
        </Badge>
        {p.archived && (
          <Badge size='sm' variant='light' color='yellow'>
            Archivado
          </Badge>
        )}
      </Group>
      {p.description && (
        <Text size='sm' c='dimmed' lineClamp={2}>
          {p.description}
        </Text>
      )}
      {vista && <LineaEstadoAgente vista={vista} subagentes={r.n > 1 ? 'no' : 'resumen'} testId='proyecto-tarjeta-estado' />}
      <Group justify='space-between' wrap='nowrap' gap='xs' mt='auto'>
        <AgentesApilados agentes={p.agents} />
        <Group gap={10} wrap='nowrap' c='dimmed' style={{ fontSize: 12 }}>
          <Group gap={3} wrap='nowrap' aria-label={`${p.conversationCount} conversaciones`}>
            <IconMessages size={14} /> {p.conversationCount}
          </Group>
          <Group gap={3} wrap='nowrap' aria-label={`${p.linkCount} vinculados`}>
            <IconLink size={14} /> {p.linkCount}
          </Group>
          <Group gap={3} wrap='nowrap' aria-label={`${p.memberCount} miembros`}>
            <IconUsers size={14} /> {p.memberCount}
          </Group>
          <span>{fechaCorta(p.updatedAt)}</span>
        </Group>
      </Group>
    </Card>
  );
}

export default function ProyectosPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const escritorio = useMediaQuery(CONSULTA_ESCRITORIO) ?? true;
  const [datos, setDatos] = useState<ListaProyectosDto | null>(null);
  const [cargando, setCargando] = useState(true);
  const [aviso, setAviso] = useState<Aviso>(null);
  const [sinModulo, setSinModulo] = useState(false);
  const [estado, setEstado] = useState<'activos' | 'archivados'>('activos');
  const [busqueda, setBusqueda] = useState('');
  const [nuevoAbierto, setNuevoAbierto] = useState(false);
  // Catálogo de repositorios (2026-10-20): solo la administración ve el botón.
  const [catalogoAdmin, setCatalogoAdmin] = useState(false);
  const [catalogoAbierto, setCatalogoAbierto] = useState(false);
  useEffect(() => {
    const ctrl = new AbortController();
    void apiGet<OpcionesPermisosDto>('/api/proyectos/permisos-agentes', '', ctrl.signal).then((r) => setCatalogoAdmin(r.ok && r.data.catalogAdmin === true));
    return () => ctrl.abort();
  }, []);
  // Configuración del módulo (2026-10-20): el botón solo se pinta a quien puede configurar.
  const [puedeConfigurar, setPuedeConfigurar] = useState(false);

  useEffect(() => {
    void (async () => {
      const r = await apiGet<AccesoConfigDto>('/api/proyectos/configuracion', '');
      setPuedeConfigurar(r.ok && r.data.companies.length > 0);
    })();
  }, []);

  const cargar = useCallback(async (est: 'activos' | 'archivados') => {
    setCargando(true);
    const r = await apiGet<ListaProyectosDto>(`/api/proyectos${est === 'archivados' ? '?archivados=1' : ''}`, 'No se pudieron cargar los proyectos.');
    setCargando(false);
    if (r.ok) {
      setDatos(r.data);
      setSinModulo(false);
    } else if (r.status === 404 || r.status === 403) {
      setSinModulo(true);
    } else if (r.error) {
      setAviso({ tipo: 'error', texto: r.error });
    }
  }, []);

  useEffect(() => {
    void cargar(estado);
  }, [cargar, estado]);

  // «?nuevo=1» abre de una vez el cuadro de nuevo proyecto (enlace directo).
  useEffect(() => {
    if (searchParams.get('nuevo') === '1') setNuevoAbierto(true);
  }, [searchParams]);

  // Estado en vivo de los agentes (2026-10-20): lo que trajo la lista y lo que entrega el pulso.
  const semillaEstados = useMemo(() => (datos?.projects ?? []).flatMap((p) => p.trabajando ?? []), [datos]);
  const estados = useEstadosAgentes(semillaEstados);
  const estadosPorProyecto = useMemo(() => {
    const m = new Map<number, EstadoAgenteProyectoDto[]>();
    for (const e of estados.values()) m.set(e.idProject, [...(m.get(e.idProject) ?? []), e]);
    return m;
  }, [estados]);

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const lista = datos?.projects ?? [];
    if (!q) return lista;
    return lista.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.company.companyName.toLowerCase().includes(q) ||
        (p.description ?? '').toLowerCase().includes(q) ||
        p.agents.some((a) => a.displayName.toLowerCase().includes(q))
    );
  }, [datos, busqueda]);

  const puedeCrear = (datos?.companies.length ?? 0) > 0 && Object.values(datos?.designables ?? {}).some((l) => l.length > 0);

  const botonNuevo = (
    <Button
      leftSection={<IconFolderPlus size={18} />}
      onClick={() => setNuevoAbierto(true)}
      disabled={!puedeCrear}
      style={{ flexShrink: 0 }}
      data-testid='proyectos-nuevo'
    >
      {escritorio ? 'Nuevo proyecto' : 'Nuevo'}
    </Button>
  );

  const irAConfigurar = () => router.push('/process/proyectos/configuracion');
  const botonConfigurar = !puedeConfigurar ? null : escritorio ? (
    <Button variant='default' leftSection={<IconSettings size={18} />} onClick={irAConfigurar} style={{ flexShrink: 0 }} data-testid='proyectos-configuracion'>
      Configuración
    </Button>
  ) : (
    <ActionIcon variant='default' size={36} radius='md' onClick={irAConfigurar} aria-label='Configuración de Proyectos' data-testid='proyectos-configuracion'>
      <IconSettings size={18} />
    </ActionIcon>
  );

  return (
    <div className={css.pantalla}>
      <Encabezado
        titulo='Proyectos'
        derecha={
          botonConfigurar || !sinModulo ? (
            <Group gap='xs' wrap='nowrap' style={{ flexShrink: 0 }}>
              {botonConfigurar}
              {!sinModulo && catalogoAdmin && (
                <Button variant='default' leftSection={<IconBrandGithub size={18} />} onClick={() => setCatalogoAbierto(true)} data-testid='proyectos-repositorios'>
                  {escritorio ? 'Repositorios' : 'Repos'}
                </Button>
              )}
              {!sinModulo && botonNuevo}
            </Group>
          ) : undefined
        }
      />

      <div className={css.barra}>
        <TextInput
          className={css.buscador}
          placeholder='Buscar por nombre, empresa o asistente'
          leftSection={<IconSearch size={16} />}
          value={busqueda}
          onChange={(e) => setBusqueda(e.currentTarget.value)}
          aria-label='Buscar proyectos'
          radius='xl'
        />
        <SegmentedControl
          value={estado}
          onChange={(v) => setEstado(v as 'activos' | 'archivados')}
          data={[
            { value: 'activos', label: 'Activos' },
            { value: 'archivados', label: 'Archivados' },
          ]}
          radius='xl'
          aria-label='Estado de los proyectos'
        />
      </div>

      {aviso && (
        <div style={{ padding: '0 4px' }}>
          <AvisoArriba aviso={aviso} onClose={() => setAviso(null)} />
        </div>
      )}

      <div className={css.listaScroll} data-testid='proyectos-lista'>
        {sinModulo ? (
          <Stack align='center' gap={8} py={48} px='md'>
            <ThemeIcon size={48} radius='xl' variant='light' color='gray'>
              <IconFolders size={26} />
            </ThemeIcon>
            <Text fw={600}>Proyectos no está habilitado para usted</Text>
            <Text size='sm' c='dimmed' ta='center' maw={420}>
              Pida a Tecnología el permiso «Proyectos» en Administración → Usuarios, para la empresa donde va a trabajar.
            </Text>
          </Stack>
        ) : cargando && !datos ? (
          <EsqueletoTarjetas />
        ) : filtrados.length === 0 ? (
          <Stack align='center' gap={8} py={48} px='md'>
            <ThemeIcon size={48} radius='xl' variant='light'>
              <IconFolders size={26} />
            </ThemeIcon>
            <Text fw={600}>{busqueda ? 'Ningún proyecto coincide con la búsqueda' : estado === 'archivados' ? 'No tiene proyectos archivados' : 'Todavía no tiene proyectos'}</Text>
            {!busqueda && estado === 'activos' && (
              <Text size='sm' c='dimmed' ta='center' maw={460}>
                Un proyecto reúne a las personas, los asistentes, los archivos y los correos y solicitudes de un mismo tema, con
                conversaciones que no se mezclan con las demás.
              </Text>
            )}
            {!busqueda && estado === 'activos' && puedeCrear && (
              <Button mt='xs' variant='light' leftSection={<IconFolderPlus size={18} />} onClick={() => setNuevoAbierto(true)}>
                Crear el primero
              </Button>
            )}
          </Stack>
        ) : (
          <div className={css.rejilla} style={cargando ? { opacity: 0.6 } : undefined}>
            {filtrados.map((p) => (
              <TarjetaProyecto
                key={p.idProject}
                p={p}
                estados={estadosPorProyecto.get(p.idProject) ?? []}
                onAbrir={() => router.push(`/process/proyectos/${p.idProject}`)}
              />
            ))}
          </div>
        )}
      </div>

      {catalogoAdmin && <CatalogoReposModal opened={catalogoAbierto} onClose={() => setCatalogoAbierto(false)} />}
      {datos && (
        <NuevoProyectoModal
          opened={nuevoAbierto}
          datos={datos}
          onClose={() => setNuevoAbierto(false)}
          onCreado={(id, equipoPedido) => {
            setNuevoAbierto(false);
            router.push(`/process/proyectos/${id}?creado=${equipoPedido ? 'equipo' : '1'}`);
          }}
        />
      )}
    </div>
  );
}
