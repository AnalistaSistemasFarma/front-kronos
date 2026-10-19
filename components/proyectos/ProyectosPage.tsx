'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Badge, Button, Card, Group, SegmentedControl, Stack, Text, TextInput, ThemeIcon } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconFolderPlus, IconFolders, IconLink, IconMessages, IconSearch, IconUsers } from '@tabler/icons-react';
import { apiGet, fechaCorta } from './api';
import NuevoProyectoModal from './NuevoProyectoModal';
import { AgentesApilados, AvisoArriba, BadgeRol, CONSULTA_ESCRITORIO, Encabezado, EsqueletoTarjetas, type Aviso } from './ui';
import type { ListaProyectosDto, ProyectoResumenDto } from '../../lib/proyectos/tipos';
import css from './proyectos.module.css';

/**
 * Módulo «Proyectos» — la lista (/process/proyectos).
 *
 * Un proyecto es un espacio de trabajo con uno o varios asistentes, sus
 * miembros (dueño, editores y lectores), sus archivos y los correos y
 * solicitudes que se le vinculan. Aquí solo aparecen los proyectos donde la
 * persona es miembro; el servidor no devuelve nada más.
 */

function TarjetaProyecto({ p, onAbrir }: { p: ProyectoResumenDto; onAbrir: () => void }) {
  return (
    <Card withBorder radius='md' p='md' component='button' type='button' onClick={onAbrir} className={css.tarjeta} data-testid='proyecto-tarjeta'>
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

  return (
    <div className={css.pantalla}>
      <Encabezado titulo='Proyectos' derecha={!sinModulo ? botonNuevo : undefined} />

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
              <TarjetaProyecto key={p.idProject} p={p} onAbrir={() => router.push(`/process/proyectos/${p.idProject}`)} />
            ))}
          </div>
        )}
      </div>

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
