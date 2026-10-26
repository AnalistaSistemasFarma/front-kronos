'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMediaQuery } from '@mantine/hooks';
import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Grid,
  Group,
  LoadingOverlay,
  Modal,
  Paper,
  SegmentedControl,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  Title,
} from '@mantine/core';
import {
  IconBook,
  IconBuilding,
  IconChecks,
  IconDownload,
  IconFilter,
  IconPencil,
  IconPlus,
  IconSchool,
  IconUsers,
} from '@tabler/icons-react';
import {
  FilterPanel,
  ProgressRingTile,
  RequestsHeader,
  RequestsPage,
  StatFilterTile,
} from '../request-general/list/RequestListUi';
import requestListStyles from '../request-general/list/requestList.module.css';
import { downloadWorkbook } from '@/lib/dashboard/excel/excelHelpers';
import PortalFormacion, { AvisoError, Cargando, VistaCursoFormador } from '../portal/PortalFormacion';
import AlcanceCurso from './AlcanceCurso';
import ColaboradoresEmpresa from './ColaboradoresEmpresa';
import DepartamentosEmpresa from './DepartamentosEmpresa';
import DivulgarCurso from './DivulgarCurso';
import { leerJsonSeguro, type ContextoFormacion, type CursoModulo } from './tipos';

/**
 * MÓDULO FORMACIÓN (/process/formacion) — Nicolás Rivera, 2026-10-26.
 *
 * Mismo diseño que «Solicitudes y Tareas Asignadas»: RequestsPage, encabezado
 * con ruta, indicadores que filtran, panel de filtros y la lista en una tarjeta
 * con pestañas. Nada de estilos propios: solo `RequestListUi`,
 * `requestList.module.css` y Mantine (lo vigila una prueba de paridad).
 */
type Seccion = 'cursos' | 'departamentos' | 'colaboradores' | 'mi-formacion';
type FiltroEstado = 'todos' | 'publicados' | 'borradores';
const TODAS = 'todas';

const CRUMBS = [{ title: 'Procesos', href: '/process' }, { title: 'Talento Humano' }, { title: 'Formación' }];

function fechaCorta(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function ModuloFormacion() {
  const parametros = useSearchParams();
  const router = useRouter();
  const isMobile = useMediaQuery('(max-width: 48em)');
  const [ctx, setCtx] = useState<ContextoFormacion | null>(null);
  const [sinPermiso, setSinPermiso] = useState(false);
  const [cursos, setCursos] = useState<CursoModulo[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // «Mi formación» primero: lo que la persona tiene pendiente por terminar (Nicolás, 2026-10-26).
  const [seccion, setSeccion] = useState<Seccion>('mi-formacion');
  const [estado, setEstado] = useState<FiltroEstado>('todos');
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const [empresaFiltro, setEmpresaFiltro] = useState<string | null>(null);
  const [cursoId, setCursoId] = useState<number | null>(null);
  const [detalle, setDetalle] = useState<{ activo: boolean; materiales: Array<{ id: number; titulo: string }> } | null>(null);
  const [crear, setCrear] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const cargarContexto = useCallback(async () => {
    const res = await fetch('/api/formacion/contexto', { cache: 'no-store' });
    if (res.status === 403 || res.status === 401) {
      setSinPermiso(true);
      return;
    }
    const data = await leerJsonSeguro(res);
    if (!res.ok) throw new Error(String(data.error ?? 'No se pudo cargar Formación.'));
    setCtx(data as unknown as ContextoFormacion);
  }, []);

  const cargarCursos = useCallback(async () => {
    const res = await fetch('/api/portal/courses', { cache: 'no-store' });
    const data = await leerJsonSeguro(res);
    if (!res.ok) throw new Error(String(data.error ?? 'No se pudieron cargar los cursos.'));
    setCursos((data.cursos as CursoModulo[]) ?? []);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        await cargarContexto();
        await cargarCursos();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setCargando(false);
      }
    })();
  }, [cargarContexto, cargarCursos]);

  // `?curso=N` abre ese curso (enlaces del ícono del header y de la divulgación).
  useEffect(() => {
    const n = Number(parametros.get('curso'));
    if (Number.isInteger(n) && n > 0) setCursoId(n);
  }, [parametros]);

  const cargarDetalle = useCallback(async (id: number) => {
    const res = await fetch(`/api/portal/courses/${id}`, { cache: 'no-store' });
    const data = await leerJsonSeguro(res);
    if (!res.ok) return;
    const curso = data.curso as { activo: boolean };
    const materiales = (data.materiales as Array<{ id: number; titulo: string }>) ?? [];
    setDetalle({ activo: curso.activo, materiales: materiales.map((m) => ({ id: m.id, titulo: m.titulo })) });
  }, []);

  useEffect(() => {
    setDetalle(null);
    if (cursoId && ctx) void cargarDetalle(cursoId);
  }, [cursoId, ctx, cargarDetalle]);

  const abrirCurso = (id: number | null) => {
    setCursoId(id);
    setAviso(null);
    router.replace(id ? `/process/formacion?curso=${id}` : '/process/formacion', { scroll: false });
  };

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return cursos.filter((c) => {
      if (estado === 'publicados' && !c.activo) return false;
      if (estado === 'borradores' && c.activo) return false;
      if (empresaFiltro === TODAS && c.empresaId !== null) return false;
      if (empresaFiltro && empresaFiltro !== TODAS && String(c.empresaId) !== empresaFiltro) return false;
      if (q && !`${c.titulo} ${c.descripcion ?? ''} ${c.creadoPor}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [cursos, estado, empresaFiltro, busqueda]);

  const publicados = cursos.filter((c) => c.activo).length;
  const inscritos = cursos.reduce((t, c) => t + (c.totalInscritos ?? 0), 0);
  const conAlcance = cursos.filter((c) => c.alcance === 'definido').length;

  const exportar = async () => {
    setExportando(true);
    try {
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      wb.creator = 'SynerLink';
      const ws = wb.addWorksheet('Cursos');
      ws.columns = [
        { header: 'ID', key: 'id', width: 8 },
        { header: 'Curso', key: 'titulo', width: 40 },
        { header: 'Empresa', key: 'empresa', width: 24 },
        { header: 'Alcance', key: 'alcance', width: 26 },
        { header: 'Materiales', key: 'materiales', width: 12 },
        { header: 'Inscritos', key: 'inscritos', width: 12 },
        { header: 'Estado', key: 'estado', width: 12 },
        { header: 'Creado por', key: 'creadoPor', width: 30 },
        { header: 'Creado el', key: 'creadoEl', width: 14 },
      ];
      ws.getRow(1).font = { bold: true };
      for (const c of filtrados) {
        ws.addRow({
          id: c.id,
          titulo: c.titulo,
          empresa: c.empresa ?? 'Todas las empresas',
          alcance: c.alcance === 'todas' ? 'Todas las empresas y departamentos' : `${c.alcancesActivos} regla(s) activa(s)`,
          materiales: c.totalMateriales,
          inscritos: c.totalInscritos,
          estado: c.activo ? 'Publicado' : 'Borrador',
          creadoPor: c.creadoPor,
          creadoEl: fechaCorta(c.creadoEl),
        });
      }
      await downloadWorkbook(wb, `Formacion-cursos-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } finally {
      setExportando(false);
    }
  };

  if (cargando) {
    return (
      <RequestsPage>
        <RequestsHeader crumbs={CRUMBS} title='Formación' subtitle='Cursos, materiales, progreso y certificados' />
        <Cargando texto='Cargando Formación…' />
      </RequestsPage>
    );
  }

  // Sin el permiso del módulo —o al abrir un pendiente del ícono del header
  // (`?vista=estudiante`)—: su propia formación, como estudiante.
  const comoEstudiante = parametros.get('vista') === 'estudiante';
  if (sinPermiso || !ctx || comoEstudiante) {
    return (
      <RequestsPage>
        <RequestsHeader crumbs={CRUMBS} title='Formación' subtitle='Sus cursos, materiales y certificados' />
        {error && <AvisoError texto={error} />}
        {comoEstudiante && ctx && (
          <Group mt='md'>
            <Button variant='subtle' onClick={() => router.replace('/process/formacion')}>
              Ir a la administración de Formación
            </Button>
          </Group>
        )}
        <Box mt='md'>
          <PortalFormacion cursoInicialId={cursoId} />
        </Box>
      </RequestsPage>
    );
  }

  const empresasFiltro = [
    ...(ctx.esGlobal ? [{ value: TODAS, label: 'Todas las empresas (GSS)' }] : []),
    ...ctx.empresas.map((e) => ({ value: String(e.id), label: e.nombre })),
  ];

  return (
    <RequestsPage>
      <RequestsHeader
        crumbs={CRUMBS}
        title='Formación'
        subtitle='Cursos por empresa y departamento, materiales, divulgación y certificados'
        actions={
          <>
            <Button variant='default' radius='xl' leftSection={<IconDownload size={16} />} loading={exportando} onClick={() => void exportar()}>
              Descargar Excel
            </Button>
            <Button radius='xl' leftSection={<IconPlus size={16} />} onClick={() => setCrear(true)} data-testid='nuevo-curso'>
              Nuevo curso
            </Button>
          </>
        }
      />

      {error && <AvisoError texto={error} />}
      {aviso && (
        <Alert color='green' role='status' mt='md'>
          {aviso}
        </Alert>
      )}

      {cursoId ? (
        <Stack gap='md' mt='md'>
          <VistaCursoFormador
            cursoId={cursoId}
            onVolver={() => abrirCurso(null)}
            onCambio={async () => {
              await cargarCursos();
              await cargarDetalle(cursoId);
            }}
            onEliminado={(titulo) => {
              abrirCurso(null);
              setAviso(`Se eliminó el curso «${titulo}». Ya no aparece en Formación; sus inscripciones y certificados se conservan.`);
              void cargarCursos();
            }}
          />
          <AlcanceCurso cursoId={cursoId} ctx={ctx} />
          {detalle && <DivulgarCurso cursoId={cursoId} activo={detalle.activo} materiales={detalle.materiales} />}
        </Stack>
      ) : (
        <>
          {seccion === 'cursos' && (
            <>
            <div className={requestListStyles.statGrid}>
              <StatFilterTile
                icon={<IconBook size={20} />}
                label='Cursos'
                value={cursos.length}
                hint={`${publicados} publicados · ${cursos.length - publicados} borradores`}
                tone='info'
                active={estado === 'todos'}
                onClick={() => setEstado('todos')}
                ariaLabel='Mostrar todos los cursos'
              />
              <StatFilterTile
                icon={<IconChecks size={20} />}
                label='Publicados'
                value={publicados}
                tone='ok'
                active={estado === 'publicados'}
                onClick={() => setEstado('publicados')}
                ariaLabel='Filtrar cursos publicados'
              />
              <StatFilterTile
                icon={<IconPencil size={20} />}
                label='Borradores'
                value={cursos.length - publicados}
                tone='warning'
                active={estado === 'borradores'}
                onClick={() => setEstado('borradores')}
                ariaLabel='Filtrar cursos en borrador'
              />
              <StatFilterTile icon={<IconUsers size={20} />} label='Inscritos' value={inscritos} tone='violet' />
              <ProgressRingTile
                label='Con alcance por departamento'
                done={conAlcance}
                total={cursos.length}
                percent={cursos.length ? Math.round((conAlcance / cursos.length) * 100) : 0}
              />
            </div>

            <FilterPanel expanded={filtrosAbiertos} onToggle={() => setFiltrosAbiertos((v) => !v)} icon={<IconFilter size={18} />}>
              {filtrosAbiertos && (
                <Box p='md' pt={0}>
                  <Grid>
                    <Grid.Col span={{ base: 12, md: 6 }}>
                      <TextInput label='Buscar' placeholder='Curso, descripción o formador' value={busqueda} onChange={(e) => setBusqueda(e.currentTarget.value)} />
                    </Grid.Col>
                    <Grid.Col span={{ base: 12, md: 6 }}>
                      <Select label='Empresa' placeholder='Todas' value={empresaFiltro} onChange={setEmpresaFiltro} data={empresasFiltro} clearable searchable />
                    </Grid.Col>
                  </Grid>
                </Box>
              )}
            </FilterPanel>
            </>
          )}

          <Card shadow='sm' radius='md' withBorder className='overflow-hidden' mt='md'>
            <LoadingOverlay visible={false} />
            <Group justify='space-between' mb='md' wrap='wrap' gap='sm'>
              <Title order={3} className='flex items-center gap-2 text-lg sm:text-xl'>
                <IconSchool size={20} />
                {seccion === 'cursos'
                  ? 'Cursos que administro'
                  : seccion === 'departamentos'
                    ? 'Departamentos por empresa'
                    : seccion === 'colaboradores'
                      ? 'Colaboradores por departamento'
                      : 'Mi formación'}
              </Title>
              <SegmentedControl
                fullWidth={isMobile}
                size={isMobile ? 'xs' : 'sm'}
                w={{ base: '100%', sm: 'auto' }}
                value={seccion}
                onChange={(v) => setSeccion(v as Seccion)}
                data={[
                  { value: 'mi-formacion', label: 'Mi formación' },
                  { value: 'cursos', label: `Cursos (${filtrados.length})` },
                  { value: 'departamentos', label: 'Departamentos' },
                  { value: 'colaboradores', label: 'Colaboradores' },
                ]}
              />
            </Group>

            {seccion === 'departamentos' && <DepartamentosEmpresa ctx={ctx} onGuardado={cargarContexto} />}
            {seccion === 'colaboradores' && <ColaboradoresEmpresa ctx={ctx} />}
            {seccion === 'mi-formacion' && <ListaMiFormacion />}
            {seccion === 'cursos' && (
              <>
                {/* Móvil: tarjetas apiladas en lugar de la tabla ancha */}
                <Stack gap='xs' hiddenFrom='md'>
                  {filtrados.length === 0 ? (
                    <Text size='sm' c='dimmed' ta='center' py='xl'>
                      No se encontraron cursos
                    </Text>
                  ) : (
                    filtrados.map((c) => (
                      <Paper
                        key={c.id}
                        withBorder
                        radius='md'
                        p='sm'
                        role='button'
                        tabIndex={0}
                        onClick={() => abrirCurso(c.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') abrirCurso(c.id);
                        }}
                        style={{ cursor: 'pointer' }}
                      >
                        <Group justify='space-between' wrap='nowrap' gap='xs' mb={4}>
                          <Text size='sm' fw={700}>
                            #{c.id}
                          </Text>
                          <EstadoCurso activo={c.activo} />
                        </Group>
                        <Text size='sm' fw={600} lineClamp={2}>
                          {c.titulo}
                        </Text>
                        <Text size='xs' c='dimmed' mt={6}>
                          {[c.empresa ?? 'Todas las empresas', `${c.totalMateriales} material(es)`, `${c.totalInscritos} inscrito(s)`].join(' · ')}
                        </Text>
                      </Paper>
                    ))
                  )}
                </Stack>

                <Box visibleFrom='md' className='overflow-x-auto'>
                  <Table striped highlightOnHover>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>ID</Table.Th>
                        <Table.Th>Curso</Table.Th>
                        <Table.Th>Empresa</Table.Th>
                        <Table.Th>Alcance</Table.Th>
                        <Table.Th>Materiales</Table.Th>
                        <Table.Th>Inscritos</Table.Th>
                        <Table.Th>Estado</Table.Th>
                        <Table.Th>Fecha</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {filtrados.length === 0 ? (
                        <Table.Tr>
                          <Table.Td colSpan={8}>
                            <Stack align='center' gap={4} py='xl'>
                              <IconSchool size={48} color='var(--mantine-color-gray-5)' />
                              <Text c='dimmed' size='lg'>
                                No se encontraron cursos
                              </Text>
                              <Text c='dimmed' size='sm'>
                                No hay cursos con los filtros actuales
                              </Text>
                            </Stack>
                          </Table.Td>
                        </Table.Tr>
                      ) : (
                        filtrados.map((c) => (
                          <Table.Tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => abrirCurso(c.id)} data-testid='fila-curso'>
                            <Table.Td>
                              <Text size='sm' fw={700}>
                                #{c.id}
                              </Text>
                            </Table.Td>
                            <Table.Td>
                              <Text size='sm' fw={600}>
                                {c.titulo}
                              </Text>
                              {c.descripcion && (
                                <Text size='xs' c='dimmed' lineClamp={1}>
                                  {c.descripcion}
                                </Text>
                              )}
                            </Table.Td>
                            <Table.Td>
                              <Text size='sm'>{c.empresa ?? 'Todas las empresas'}</Text>
                            </Table.Td>
                            <Table.Td>
                              <Badge variant='light' color={c.alcance === 'todas' ? 'blue' : 'violet'} leftSection={<IconBuilding size={12} />}>
                                {c.alcance === 'todas' ? 'Todos' : `${c.alcancesActivos} activo(s)`}
                              </Badge>
                            </Table.Td>
                            <Table.Td>{c.totalMateriales}</Table.Td>
                            <Table.Td>{c.totalInscritos}</Table.Td>
                            <Table.Td>
                              <EstadoCurso activo={c.activo} />
                            </Table.Td>
                            <Table.Td>
                              <Text size='sm'>{fechaCorta(c.creadoEl)}</Text>
                            </Table.Td>
                          </Table.Tr>
                        ))
                      )}
                    </Table.Tbody>
                  </Table>
                </Box>
              </>
            )}
          </Card>
        </>
      )}

      <NuevoCurso
        abierto={crear}
        ctx={ctx}
        onCerrar={() => setCrear(false)}
        onCreado={async (id) => {
          setCrear(false);
          await cargarCursos();
          abrirCurso(id);
        }}
      />
    </RequestsPage>
  );
}

function EstadoCurso({ activo }: { activo: boolean }) {
  return (
    <Badge color={activo ? 'green' : 'gray'} variant='light'>
      {activo ? 'Publicado' : 'Borrador'}
    </Badge>
  );
}

/** Los cursos de quien administra, como estudiante (los de su empresa y departamento). */
function ListaMiFormacion() {
  return <PortalFormacion soloEstudiante />;
}

function NuevoCurso({
  abierto,
  ctx,
  onCerrar,
  onCreado,
}: {
  abierto: boolean;
  ctx: ContextoFormacion;
  onCerrar: () => void;
  onCreado: (id: number) => Promise<void>;
}) {
  const opciones = [
    ...(ctx.esGlobal ? [{ value: TODAS, label: 'Todas las empresas' }] : []),
    ...ctx.empresas.map((e) => ({ value: String(e.id), label: e.nombre })),
  ];
  const [titulo, setTitulo] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [empresa, setEmpresa] = useState<string | null>(opciones[0]?.value ?? null);
  const [creando, setCreando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const crear = async () => {
    setCreando(true);
    setError(null);
    try {
      const res = await fetch('/api/portal/courses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ titulo, descripcion, empresaId: empresa && empresa !== TODAS ? Number(empresa) : null }),
      });
      const data = await leerJsonSeguro(res);
      if (!res.ok) throw new Error(String(data.error ?? 'No se pudo crear el curso.'));
      setTitulo('');
      setDescripcion('');
      await onCreado(Number((data.curso as { id: number }).id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreando(false);
    }
  };

  return (
    <Modal opened={abierto} onClose={() => !creando && onCerrar()} title='Nuevo curso' centered>
      <Stack gap='sm'>
        {error && <AvisoError texto={error} />}
        <TextInput label='Título' required maxLength={255} value={titulo} onChange={(e) => setTitulo(e.currentTarget.value)} data-autofocus />
        <Textarea label='Descripción' autosize minRows={2} value={descripcion} onChange={(e) => setDescripcion(e.currentTarget.value)} />
        <Select
          label='Empresa'
          description='Quién administra el curso. Después defina en qué empresas y departamentos está activo.'
          value={empresa}
          onChange={setEmpresa}
          data={opciones}
          allowDeselect={false}
        />
        <Text size='xs' c='dimmed'>
          El curso se crea en borrador: agregue los materiales y publíquelo cuando esté listo.
        </Text>
        <Group justify='flex-end'>
          <Button variant='default' onClick={onCerrar} disabled={creando}>
            Cancelar
          </Button>
          <Button onClick={() => void crear()} loading={creando} disabled={!titulo.trim() || !empresa}>
            Crear curso
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
