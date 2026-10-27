'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Anchor,
  AspectRatio,
  Badge,
  Box,
  Button,
  Card,
  Center,
  Checkbox,
  FileInput,
  Grid,
  Group,
  Loader,
  Modal,
  Paper,
  Progress,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  ThemeIcon,
  Timeline,
  Title,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import {
  IconAlertTriangle,
  IconArrowDown,
  IconArrowLeft,
  IconArrowUp,
  IconCertificate,
  IconCheck,
  IconClipboardCheck,
  IconFileText,
  IconLink,
  IconListNumbers,
  IconPencil,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlus,
  IconRewindBackward10,
  IconSchool,
  IconTable,
  IconUserPlus,
  IconX,
} from '@tabler/icons-react';
import { leerJson } from './PortalContenido';
import {
  SubidaCancelada,
  formatearBytes,
  subirMaterialDirecto,
  type ArchivoSubidoAlCurso,
} from '../../lib/portal/subida-por-trozos';
import {
  contadorVideo,
  posicionPermitida,
  progresoLectura,
  reloj,
  segundosQueSuman,
  videoCompleto,
} from '../../lib/portal/visor-revision';
import { PanelRespuestas, PreviaDeMaterialFormulario, SelectorFormulario, VisorFormulario } from './FormularioPropio';
import TopEstudiantes from './TopEstudiantes';
import PreguntasMaterial from '../formacion/PreguntasMaterial';
import MiniaturaVideo from '../formacion/MiniaturaVideo';

/**
 * FORMACIÓN — sección "tipo Moodle" al final del portal de Talento Humano.
 *
 * Pedido de Cristian Baldión (2026-09-18): cursos con materiales (documento o
 * enlace), una barra de progreso que ve el formador Y el estudiante, y un
 * certificado de GSS al llegar al 100%.
 *
 * Vive en un componente aparte de `PortalContenido` (que ya es grande) y
 * hace sus propios fetch: así una recarga de materiales o de progreso no
 * repinta el carrusel de anuncios ni las políticas.
 */

interface CursoResumen {
  id: number;
  titulo: string;
  descripcion: string | null;
  activo: boolean;
  totalMateriales: number;
  totalInscritos: number;
  inscrito: boolean;
  porcentaje: number | null;
  certificado: { code: string; emitidoEl: string } | null;
}

interface Material {
  id: number;
  /** FORM = formulario propio del portal (Cristian, 2026-10-08). */
  tipo: 'DOCUMENT' | 'LINK' | 'FORM';
  formularioId?: number | null;
  titulo: string;
  orden: number;
  url: string | null;
  nombreArchivo: string | null;
  mime?: string | null;
  obligatorio: boolean;
  completadoEl: string | null;
}

interface DetalleCurso {
  curso: { id: number; titulo: string; descripcion: string | null; activo: boolean; creadoPor: string; creadoEl?: string };
  esFormador: boolean;
  /** Administrador/formador del Excel de permisos: puede marcar a mano. */
  puedeMarcarManual?: boolean;
  /** Solo para formadores: lo que se muestra al confirmar «Eliminar curso». */
  conteos?: { inscritos: number; certificados: number } | null;
  porcentaje: number;
  materiales: Material[];
  certificado: { code: string; emitidoEl: string } | null;
}

interface FilaRoster {
  correo: string;
  nombre: string;
  inscritoEl: string;
  porcentaje: number;
  materialesCompletados: number[];
  certificado: string | null;
}

const materialUrl = (cursoId: number, materialId: number) =>
  `/api/portal/courses/${cursoId}/materials/${materialId}/file`;
const certificadoUrl = (code: string) => `/api/portal/certificates/${encodeURIComponent(code)}`;

/**
 * `onSinSesion`: se llama si el servidor responde 401 al pedir los cursos,
 * para que la página de Formación (que vive aparte del portal desde
 * 2026-09-30) pueda mandar a la persona a ingresar primero.
 */
export default function PortalFormacion({
  onSinSesion,
  cursoInicialId,
  soloEstudiante = false,
}: {
  onSinSesion?: () => void;
  cursoInicialId?: number | null;
  /** En «Mi formación» del módulo: solo la vista de estudiante (la administración está al lado). */
  soloEstudiante?: boolean;
} = {}) {
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cursos, setCursos] = useState<CursoResumen[]>([]);
  const [cursosEstudiante, setCursosEstudiante] = useState<CursoResumen[]>([]);
  const [esFormador, setEsFormador] = useState(false);
  const [vista, setVista] = useState<'estudiante' | 'formador'>('estudiante');
  // En una ref: si se pasa como función en línea, no debe re-disparar la carga.
  const onSinSesionRef = useRef(onSinSesion);
  onSinSesionRef.current = onSinSesion;
  // true cuando la lista de cursos llegó de verdad (no cuando se cortó por falta de sesión).
  const cursosCargados = useRef(false);

  const cargarCursos = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/portal/courses', { cache: 'no-store' });
      if (res.status === 401 && onSinSesionRef.current) {
        onSinSesionRef.current();
        return;
      }
      const data = await leerJson(res);
      if (!res.ok) throw new Error(String(data?.error ?? 'No se pudieron cargar los cursos.'));
      const formador = data.esFormador === true;
      // El formador recibe los cursos que ADMINISTRA; en «Vista estudiante» ve los
      // de su empresa y departamento, como cualquier estudiante (2026-10-26).
      let comoEstudiante = Array.isArray(data.cursos) ? (data.cursos as CursoResumen[]) : [];
      if (formador) {
        const resE = await fetch('/api/portal/courses?vista=estudiante', { cache: 'no-store' });
        const dataE = await leerJson(resE);
        if (resE.ok && Array.isArray(dataE.cursos)) comoEstudiante = dataE.cursos as CursoResumen[];
      }
      cursosCargados.current = true;
      setCursos(Array.isArray(data.cursos) ? (data.cursos as CursoResumen[]) : []);
      setCursosEstudiante(comoEstudiante);
      setEsFormador(formador);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargarCursos();
  }, [cargarCursos]);

  const [cursoAbiertoId, setCursoAbiertoId] = useState<number | null>(null);
  const [cursoGestionId, setCursoGestionId] = useState<number | null>(null);
  // Aviso de «curso eliminado»: arriba y con color, en la lista a la que se vuelve.
  const [avisoEliminado, setAvisoEliminado] = useState<string | null>(null);

  // Invitación a un curso (Cristian, 2026-10-14): `/portal/formacion?curso=N` abre ese curso apenas cargan los cursos, UNA vez.
  const abrioInicial = useRef(false);
  useEffect(() => {
    if (cargando || abrioInicial.current || !cursoInicialId || !cursosCargados.current) return;
    abrioInicial.current = true;
    if (cursosEstudiante.some((c) => c.id === cursoInicialId && c.activo)) setCursoAbiertoId(cursoInicialId);
    else setError('El curso al que lo invitaron ya no está disponible.');
  }, [cargando, cursosEstudiante, cursoInicialId]);

  if (cargando) return <Cargando texto='Cargando formación…' />;

  return (
    <Stack gap='md'>
      {esFormador && !soloEstudiante && (
        <Group>
          <SegmentedControl
            aria-label='Vista de Formación'
            value={vista}
            onChange={(v) => setVista(v as 'estudiante' | 'formador')}
            data={[
              { value: 'estudiante', label: 'Vista estudiante' },
              { value: 'formador', label: 'Vista formador' },
            ]}
          />
        </Group>
      )}

      {error && <AvisoError texto={error} />}
      {avisoEliminado && (
        <Alert color='green' role='status' data-testid='aviso-curso-eliminado'>
          {avisoEliminado}
        </Alert>
      )}

      {vista === 'estudiante' || !esFormador || soloEstudiante ? (
        cursoAbiertoId ? (
          <VistaCursoEstudiante cursoId={cursoAbiertoId} onVolver={() => setCursoAbiertoId(null)} onCambio={cargarCursos} />
        ) : (
          <ListaCursosEstudiante cursos={cursosEstudiante.filter((c) => c.activo)} onAbrir={setCursoAbiertoId} />
        )
      ) : cursoGestionId ? (
        <VistaCursoFormador
          cursoId={cursoGestionId}
          onVolver={() => setCursoGestionId(null)}
          onCambio={cargarCursos}
          onEliminado={(titulo) => {
            setCursoGestionId(null);
            setAvisoEliminado(`Se eliminó el curso «${titulo}». Ya no aparece en Formación; sus inscripciones y certificados se conservan.`);
            void cargarCursos();
          }}
        />
      ) : (
        <ListaCursosFormador
          cursos={cursos}
          onGestionar={(id) => {
            setAvisoEliminado(null);
            setCursoGestionId(id);
          }}
          onCreado={cargarCursos}
        />
      )}
    </Stack>
  );
}

/* ─────────────────────────────── Estudiante ────────────────────────────── */

/** Mensajes de estado y error con las mismas piezas de Mantine que el resto de SynerLink. */
export function Cargando({ texto }: { texto: string }) {
  return (
    <Group gap='xs' py='md'>
      <Loader size='sm' />
      <Text size='sm' c='dimmed'>
        {texto}
      </Text>
    </Group>
  );
}

export function AvisoError({ texto }: { texto: string }) {
  return (
    <Alert color='red' icon={<IconAlertTriangle size={18} />} role='alert'>
      {texto}
    </Alert>
  );
}

function BarraProgreso({ porcentaje, mostrarCompletado = false }: { porcentaje: number; mostrarCompletado?: boolean }) {
  const valor = Math.min(100, Math.max(0, porcentaje));
  const barra = (
    <Group gap='xs' wrap='nowrap' style={{ flex: 1, minWidth: 120 }}>
      <Progress
        value={valor}
        color={valor >= 100 ? 'green' : 'blue'}
        radius='xl'
        size='md'
        style={{ flex: 1 }}
        role='progressbar'
        aria-valuenow={porcentaje}
        aria-valuemin={0}
        aria-valuemax={100}
      />
      <Text size='xs' fw={600}>
        {porcentaje}%
      </Text>
    </Group>
  );
  if (!mostrarCompletado) return barra;
  // Cristian (2026-10-08): al quedar completo, "Completado" a la derecha de la barra.
  return (
    <Group gap='sm' wrap='nowrap' data-testid='progreso-fila'>
      {barra}
      {porcentaje >= 100 && <InsigniaCompletado />}
    </Group>
  );
}

function InsigniaCompletado() {
  return (
    <Badge color='green' variant='light' leftSection={<IconCheck size={12} />} data-testid='insignia-completado'>
      Completado
    </Badge>
  );
}

/** Tooltip de la casilla bloqueada (pedido de Cristian, 2026-10-08). */
const AYUDA_CASILLA_BLOQUEADA = 'Se marca automáticamente al revisar el material';

/** Avance de una subida directa a SharePoint, con botón para cancelar. */
interface EstadoSubida {
  nombre: string;
  subidos: number;
  total: number;
}

function ProgresoSubida({ subida, onCancelar }: { subida: EstadoSubida; onCancelar: () => void }) {
  const porcentaje = subida.total > 0 ? Math.floor((subida.subidos / subida.total) * 100) : 0;
  return (
    <Alert color='blue' role='status' aria-live='polite' data-testid='progreso-subida'>
      <Stack gap='xs'>
        <Text size='sm'>
          <strong>Subiendo a SharePoint:</strong> {subida.nombre} · {formatearBytes(subida.subidos)} de{' '}
          {formatearBytes(subida.total)} ({porcentaje}%)
        </Text>
        <BarraProgreso porcentaje={porcentaje} />
        <Group>
          <Button size='xs' variant='default' onClick={onCancelar}>
            Cancelar subida
          </Button>
        </Group>
      </Stack>
    </Alert>
  );
}

export function ListaCursosEstudiante({ cursos, onAbrir }: { cursos: CursoResumen[]; onAbrir: (id: number) => void }) {
  // «Mi formación» (Nicolás, 2026-10-26): primero lo pendiente por terminar y después lo ya completado.
  // Top 10 de estudiantes (Cristian, 2026-10-16): a la derecha de los cursos en pantallas anchas, debajo en las angostas.
  const pendientes = cursos.filter((c) => (c.porcentaje ?? 0) < 100);
  const completados = cursos.filter((c) => (c.porcentaje ?? 0) >= 100);
  const tarjeta = (c: CursoResumen) => (
    <Card
      key={c.id}
      data-testid='curso-tarjeta'
      withBorder
      radius='md'
      shadow='sm'
      padding='md'
      component='button'
      type='button'
      onClick={() => onAbrir(c.id)}
      style={{ textAlign: 'left', cursor: 'pointer' }}
    >
      <Stack gap={6}>
        <Text fw={700}>{c.titulo}</Text>
        {c.descripcion && (
          <Text size='sm' c='dimmed' lineClamp={3}>
            {c.descripcion}
          </Text>
        )}
        <Text size='xs' c='dimmed'>
          {c.totalMateriales} clase(s)
        </Text>
        <BarraProgreso porcentaje={c.porcentaje ?? 0} mostrarCompletado />
        {c.certificado && (
          <Group>
            <Badge color='teal' variant='light' leftSection={<IconCertificate size={12} />}>
              Certificado emitido
            </Badge>
          </Group>
        )}
      </Stack>
    </Card>
  );
  return (
    <SimpleGrid cols={{ base: 1, lg: 3 }} spacing='md'>
      <Stack gap='lg' style={{ gridColumn: 'span 2' }} data-testid='curso-grilla'>
        {cursos.length === 0 ? (
          <Text size='sm' c='dimmed' ta='center' py='xl'>
            Todavía no hay cursos publicados.
          </Text>
        ) : (
          <>
            <Stack gap='sm' data-testid='cursos-pendientes'>
              <Title order={4}>Pendiente por terminar ({pendientes.length})</Title>
              {pendientes.length === 0 ? (
                <Text size='sm' c='dimmed'>
                  ¡Está al día! No tiene cursos pendientes.
                </Text>
              ) : (
                <SimpleGrid cols={{ base: 1, sm: 2 }} spacing='md'>
                  {pendientes.map(tarjeta)}
                </SimpleGrid>
              )}
            </Stack>
            {completados.length > 0 && (
              <Stack gap='sm' data-testid='cursos-completados'>
                <Title order={4}>Mis cursos completados ({completados.length})</Title>
                <SimpleGrid cols={{ base: 1, sm: 2 }} spacing='md'>
                  {completados.map(tarjeta)}
                </SimpleGrid>
              </Stack>
            )}
          </>
        )}
      </Stack>
      <TopEstudiantes />
    </SimpleGrid>
  );
}

export function VistaCursoEstudiante({
  cursoId,
  onVolver,
  onCambio,
}: {
  cursoId: number;
  onVolver: () => void;
  onCambio: () => void;
}) {
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Resultado de una ACCIÓN (marcar, revisar): arriba y con color, sin
  // desmontar la vista (ver la convención de avisos visibles).
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);
  const [detalle, setDetalle] = useState<DetalleCurso | null>(null);
  const [marcando, setMarcando] = useState<number | null>(null);
  const [abierto, setAbierto] = useState<Material | null>(null);
  // Clase abierta en la vista de lección (video, PDF, imagen o documento).
  const [leccion, setLeccion] = useState<Material | null>(null);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/portal/courses/${cursoId}`, { cache: 'no-store' });
      const data = await leerJson(res);
      if (!res.ok) throw new Error(String(data?.error ?? 'No se pudo cargar el curso.'));
      setDetalle(data as unknown as DetalleCurso);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }, [cursoId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const puedeMarcar = detalle?.puedeMarcarManual === true;
  // Quien administra el portal (hojas ADMINISTRADORES y FORMADORES del Excel de permisos) marca y desmarca a mano TAMBIÉN en
  // «Vista estudiante»: no se le pone ningún bloqueo (Cristian, 2026-10-14, deshaciendo el cambio del 2026-10-13). El marcado
  // manual solo afecta al progreso de quien lo usa, y el servidor sigue exigiendo el permiso (403 a los demás).
  const casillasEditables = puedeMarcar;

  /** Marcado MANUAL: solo administradores/formadores (el servidor lo exige). */
  const alternarMaterial = async (materialId: number, completado: boolean) => {
    if (!casillasEditables) return;
    setMarcando(materialId);
    setAviso(null);
    try {
      const res = await fetch(`/api/portal/materials/${materialId}/progress`, {
        method: completado ? 'DELETE' : 'POST',
      });
      const data = await leerJson(res);
      if (!res.ok) throw new Error(String(data?.error ?? 'No se pudo actualizar.'));
      await cargar();
      await onCambio();
    } catch (e) {
      setAviso({ tipo: 'error', texto: (e as Error).message });
    } finally {
      setMarcando(null);
    }
  };

  const alCompletar = async (titulo: string, texto?: string) => {
    setAviso({ tipo: 'ok', texto: texto ?? `"${titulo}" quedó completado.` });
    await cargar();
    await onCambio();
  };
  // «Ver respuestas» en esta vista: SOLO para quien está en las hojas ADMINISTRADORES/FORMADORES del Excel
  // de permisos pero NO es formador del portal (`PORTAL_TH_FORMADORES`). Esa persona no tiene «Vista formador»
  // y, sin esto, perdería el acceso a las respuestas. Los formadores las ven en su vista (Cristian, 2026-10-09).
  const verRespuestasAqui = puedeMarcar && detalle?.esFormador !== true;
  const [respuestasDe, setRespuestasDe] = useState<Material | null>(null);

  /** Un ENLACE cuenta como revisado al abrirlo (lo registra el servidor). */
  const abrirEnlace = (m: Material) => {
    void fetch(`/api/portal/materials/${m.id}/vista`, { method: 'POST', keepalive: true })
      .then(async (res) => {
        const data = await leerJson(res);
        if (!res.ok) throw new Error(String(data?.error ?? 'No se pudo registrar la apertura del enlace.'));
        if (m.completadoEl === null) await alCompletar(m.titulo);
      })
      .catch((e) => setAviso({ tipo: 'error', texto: (e as Error).message }));
  };

  if (cargando) return <Cargando texto='Cargando curso…' />;
  if (error) return <AvisoError texto={error} />;
  if (!detalle) return null;

  const materiales = detalle.materiales;
  const hechos = materiales.filter((m) => m.completadoEl !== null).length;
  const conteo = (tipo: string) => materiales.filter((m) => etiquetaTipo(m) === tipo).length;
  const abrir = (m: Material) => {
    setAviso(null);
    if (m.tipo === 'FORM') setAbierto(m);
    else if (m.tipo === 'LINK') window.open(m.url ?? '#', '_blank', 'noopener,noreferrer');
    else setLeccion(m);
    if (m.tipo === 'LINK') abrirEnlace(m);
  };

  const casilla = (m: Material) => {
    const completado = m.completadoEl !== null;
    return casillasEditables ? (
      <Checkbox
        checked={completado}
        disabled={marcando === m.id}
        onChange={() => void alternarMaterial(m.id, completado)}
        aria-label={completado ? `Marcar ${m.titulo} como pendiente` : `Marcar ${m.titulo} como completado`}
        title='Puede marcar o desmarcar a mano (administrador/formador)'
      />
    ) : null;
  };

  // ── Vista de la LECCIÓN (2026-10-26): el material grande y, al lado, sus preguntas y respuestas. ──
  if (leccion) {
    const actual = materiales.find((m) => m.id === leccion.id) ?? leccion;
    const i = materiales.findIndex((m) => m.id === actual.id);
    const anterior = i > 0 ? materiales[i - 1] : null;
    const siguiente = i >= 0 && i < materiales.length - 1 ? materiales[i + 1] : null;
    return (
      <Stack gap='md' data-testid='leccion'>
        <Group justify='space-between' wrap='wrap'>
          <Button variant='subtle' leftSection={<IconArrowLeft size={16} />} onClick={() => setLeccion(null)} data-testid='volver-curso'>
            {detalle.curso.titulo}
          </Button>
          <Group gap='xs'>
            <Button variant='default' disabled={!anterior} onClick={() => anterior && abrir(anterior)}>
              ← Clase anterior
            </Button>
            <Button disabled={!siguiente} onClick={() => siguiente && abrir(siguiente)}>
              Clase siguiente →
            </Button>
          </Group>
        </Group>
        {aviso && (
          <Alert color={aviso.tipo === 'error' ? 'red' : 'green'} role={aviso.tipo === 'error' ? 'alert' : 'status'}>
            {aviso.texto}
          </Alert>
        )}
        <Grid gutter='md'>
          <Grid.Col span={{ base: 12, lg: 8 }}>
            <Stack gap='sm'>
              <VisorMaterial
                key={actual.id}
                enLinea
                cursoId={detalle.curso.id}
                material={actual}
                onCerrar={() => setLeccion(null)}
                onCompletado={() => alCompletar(actual.titulo)}
              />
              <Group gap='xs' wrap='nowrap'>
                <Badge variant='light' size='lg' circle>
                  {i + 1}
                </Badge>
                <Title order={3} style={{ overflowWrap: 'anywhere' }}>
                  {actual.titulo}
                </Title>
                {actual.completadoEl !== null && <InsigniaCompletado />}
              </Group>
            </Stack>
          </Grid.Col>
          <Grid.Col span={{ base: 12, lg: 4 }}>
            <PreguntasMaterial materialId={actual.id} />
          </Grid.Col>
        </Grid>
      </Stack>
    );
  }

  // ── PORTADA del curso (2026-10-26): encabezado, datos y temario numerado. ──
  return (
    <Stack gap='md'>
      <Group>
        <Button variant='subtle' leftSection={<IconArrowLeft size={16} />} onClick={onVolver}>
          Volver a Formación
        </Button>
      </Group>
      <Card withBorder radius='md' shadow='sm' padding='xl' data-testid='portada-curso'>
        <Stack gap='md'>
          <ThemeIcon size={56} radius='md' variant='light'>
            <IconSchool size={32} />
          </ThemeIcon>
          <Title order={1} style={{ overflowWrap: 'anywhere' }}>
            {detalle.curso.titulo}
          </Title>
          {detalle.curso.creadoEl && (
            <Text size='sm' c='dimmed'>
              Publicado el {new Date(detalle.curso.creadoEl).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' })}
            </Text>
          )}
          <Group gap='xs'>
            <Badge variant='outline' color='gray' size='lg' leftSection={<IconListNumbers size={14} />} style={{ textTransform: 'none' }}>
              {materiales.length} clase(s)
            </Badge>
            {conteo('Video') > 0 && (
              <Badge variant='outline' color='gray' size='lg' leftSection={<IconPlayerPlay size={14} />} style={{ textTransform: 'none' }}>
                {conteo('Video')} video(s)
              </Badge>
            )}
            {conteo('Documento') > 0 && (
              <Badge variant='outline' color='gray' size='lg' leftSection={<IconFileText size={14} />} style={{ textTransform: 'none' }}>
                {conteo('Documento')} documento(s)
              </Badge>
            )}
            {conteo('Formulario') > 0 && (
              <Badge variant='outline' color='gray' size='lg' leftSection={<IconClipboardCheck size={14} />} style={{ textTransform: 'none' }}>
                {conteo('Formulario')} evaluación(es)
              </Badge>
            )}
          </Group>
          {detalle.curso.descripcion && (
            <Text size='md' style={{ whiteSpace: 'pre-wrap' }}>
              {detalle.curso.descripcion}
            </Text>
          )}
          {aviso && (
            <Alert color={aviso.tipo === 'error' ? 'red' : 'green'} role={aviso.tipo === 'error' ? 'alert' : 'status'}>
              {aviso.texto}
            </Alert>
          )}
          <Stack gap={4}>
            <Text size='sm' fw={600}>
              Su avance: {hechos} de {materiales.length} clase(s)
            </Text>
            <BarraProgreso porcentaje={detalle.porcentaje} mostrarCompletado />
          </Stack>
          {detalle.certificado ? (
            <Group>
              <Button
                component='a'
                href={certificadoUrl(detalle.certificado.code)}
                target='_blank'
                rel='noopener noreferrer'
                leftSection={<IconCertificate size={16} />}
              >
                Descargar certificado
              </Button>
            </Group>
          ) : (
            detalle.porcentaje < 100 && (
              <Text size='sm' c='dimmed'>
                Complete los materiales obligatorios para obtener su certificado de finalización.
              </Text>
            )
          )}
        </Stack>
      </Card>

      <Card withBorder radius='md' shadow='sm' padding='xl'>
        <Title order={4} mb='md'>
          Temario
        </Title>
        {materiales.length === 0 ? (
          <Text size='sm' c='dimmed'>
            Este curso todavía no tiene clases.
          </Text>
        ) : (
          <Timeline active={hechos - 1} bulletSize={28} lineWidth={3} color='green'>
            {materiales.map((m, i) => {
              const completado = m.completadoEl !== null;
              return (
                <Timeline.Item
                  key={m.id}
                  bullet={
                    <Text size='xs' fw={700}>
                      {i + 1}
                    </Text>
                  }
                  data-testid='material-item'
                >
                  <Group justify='space-between' wrap='nowrap' gap='sm'>
                    <Group gap='sm' wrap='nowrap' style={{ minWidth: 0 }}>
                      {etiquetaTipo(m) === 'Video' ? (
                        <UnstyledButton onClick={() => abrir(m)} aria-label={`Ver ${m.titulo}`}>
                          <MiniaturaVideo url={materialUrl(detalle.curso.id, m.id)} titulo={m.titulo} completado={completado} />
                        </UnstyledButton>
                      ) : (
                        <ThemeIcon variant='light' size={44} radius='md' color={completado ? 'green' : 'blue'}>
                          {iconoTipo(m)}
                        </ThemeIcon>
                      )}
                      <Stack gap={2} style={{ minWidth: 0 }}>
                        <Anchor
                          component='button'
                          type='button'
                          fw={700}
                          ta='left'
                          c='var(--mantine-color-text)'
                          onClick={() => abrir(m)}
                          data-testid={m.tipo === 'FORM' ? `abrir-formulario-${m.id}` : undefined}
                        >
                          {m.titulo}
                        </Anchor>
                        <Group gap='xs'>
                          {completado ? (
                            <InsigniaCompletado />
                          ) : (
                            <Text size='xs' c='dimmed'>
                              {etiquetaTipo(m)}
                              {!m.obligatorio && ' · opcional'}
                            </Text>
                          )}
                        </Group>
                      </Stack>
                    </Group>
                    <Group gap='xs' wrap='nowrap'>
                      {m.tipo === 'FORM' && verRespuestasAqui && (
                        <Button size='xs' variant='default' leftSection={<IconTable size={14} />} onClick={() => setRespuestasDe(m)}>
                          Ver respuestas
                        </Button>
                      )}
                      {casilla(m)}
                    </Group>
                  </Group>
                </Timeline.Item>
              );
            })}
          </Timeline>
        )}
        {!casillasEditables && materiales.length > 0 && (
          <Text size='xs' c='dimmed' mt='md'>
            Cada clase se marca sola cuando la revisa: los videos hasta el final, los PDF hasta la última página, los
            formularios al enviarlos y los demás documentos y enlaces al abrirlos.
          </Text>
        )}
      </Card>

      {abierto && abierto.tipo === 'FORM' && (
        <VisorFormulario
          materialId={abierto.id}
          titulo={abierto.titulo}
          onCerrar={() => setAbierto(null)}
          onEnviado={() => alCompletar(abierto.titulo, `Respuestas enviadas: "${abierto.titulo}" quedó completado.`)}
        />
      )}
      {respuestasDe && (
        <PanelRespuestas
          materialId={respuestasDe.id}
          titulo={respuestasDe.titulo}
          onCerrar={() => setRespuestasDe(null)}
          onCambio={async () => {
            await cargar();
            await onCambio();
          }}
        />
      )}
    </Stack>
  );
}

function iconoTipo(m: Material) {
  const t = etiquetaTipo(m);
  if (t === 'Video') return <IconPlayerPlay size={22} />;
  if (t === 'Formulario') return <IconClipboardCheck size={22} />;
  if (t === 'Enlace') return <IconLink size={22} />;
  return <IconFileText size={22} />;
}

function etiquetaTipo(m: Material): string {
  if (m.tipo === 'LINK') return 'Enlace';
  if (m.tipo === 'FORM') return 'Formulario';
  const mime = (m.mime ?? '').toLowerCase();
  if (mime.startsWith('video/')) return 'Video';
  return 'Documento';
}

/* ─────────────── Visor del material + revisión (2026-10-08) ─────────────── */

interface ReglaRevision {
  tipo: 'video' | 'pdf' | 'imagen' | 'documento' | 'enlace';
  segundosMinimos: number;
  fraccionVideo: number;
  paginas?: number | null;
}

/**
 * Abre un material DENTRO del portal, en la ventana de vista previa, y mide la
 * revisión (Cristian, 2026-10-08). El servidor registra la apertura; aquí se
 * mide lo que se ve y, al cumplir la regla, se reporta. Es el servidor quien
 * marca.
 *
 * - Video: sin la barra nativa (no hay cómo saltar), velocidad fija en 1× y
 *   un contador "visto / duración" que solo corre mientras el video se
 *   reproduce de verdad (no en pausa, no con la pestaña oculta: al ocultarla
 *   se pausa). Se puede retroceder 10 s, no adelantar. Se marca al llegar al
 *   100 %.
 * - PDF: una página a la vez con "Página anterior" / "Página siguiente" y una
 *   barra de lectura (página máxima alcanzada entre el total). Se marca al
 *   llegar a la última página; el de una sola página, al abrirlo.
 * - Imagen y Word/Excel/PowerPoint: sin tiempo mínimo, el servidor los marca
 *   al registrar la apertura y la persona cierra cuando quiera.
 */
function VisorMaterial({
  cursoId,
  material,
  onCerrar,
  onCompletado,
  enLinea = false,
}: {
  cursoId: number;
  material: Material;
  onCerrar: () => void;
  onCompletado: () => Promise<void> | void;
  /** Dentro de la página (vista de la lección) en vez de ventana emergente. */
  enLinea?: boolean;
}) {
  const url = materialUrl(cursoId, material.id);
  const [regla, setRegla] = useState<ReglaRevision | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [completado, setCompletado] = useState(material.completadoEl !== null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [segundos, setSegundos] = useState(0);
  const [duracion, setDuracion] = useState(0);
  const [reproduciendo, setReproduciendo] = useState(false);
  const [cargandoVideo, setCargandoVideo] = useState(true);
  const [pdf, setPdf] = useState<{ pagina: number; maxima: number; total: number }>({ pagina: 1, maxima: 1, total: 0 });
  const reportado = useRef(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const video = useRef({ maximo: 0, acumulado: 0, ultimo: 0 });

  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const res = await fetch(`/api/portal/materials/${material.id}/vista`, { method: 'POST' });
        const data = await leerJson(res);
        if (!res.ok) throw new Error(String(data?.error ?? 'No se pudo abrir el material.'));
        if (!vivo) return;
        setToken(String(data.token));
        setRegla(data.regla as unknown as ReglaRevision);
        if (data.completado === true) {
          setCompletado(true);
          // Quedó marcado al abrirlo (imagen, Office, PDF de una página).
          if (material.completadoEl === null) await onCompletado();
        }
      } catch (e) {
        if (vivo) setError((e as Error).message);
      }
    })();
    return () => {
      vivo = false;
    };
    // Solo al abrir; `onCompletado` y `completadoEl` no deben reabrir la vista.
  }, [material.id]);

  const reportar = useCallback(
    async (cuerpo: { segundosVistos: number; duracion?: number; paginaMaxima?: number; paginasTotales?: number }) => {
      if (!token || reportado.current) return;
      reportado.current = true;
      try {
        const res = await fetch(`/api/portal/materials/${material.id}/vista/${token}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ duracion: null, ...cuerpo }),
        });
        const data = await leerJson(res);
        if (!res.ok) throw new Error(String(data?.error ?? 'No se pudo registrar la revisión.'));
        setCompletado(true);
        setAviso(null);
        await onCompletado();
      } catch (e) {
        // Se puede volver a intentar con la misma apertura.
        reportado.current = false;
        setAviso((e as Error).message);
      }
    },
    [material.id, token, onCompletado]
  );

  // Imagen y Office con un mínimo configurado por entorno (por defecto no hay):
  // cuenta el tiempo con la ventana abierta.
  const conTiempo =
    regla !== null && (regla.tipo === 'imagen' || regla.tipo === 'documento') && regla.segundosMinimos > 0;
  useEffect(() => {
    if (!conTiempo || completado) return;
    const reloj = window.setInterval(() => setSegundos((s) => s + 1), 1000);
    return () => window.clearInterval(reloj);
  }, [conTiempo, completado]);
  useEffect(() => {
    if (conTiempo && !completado && regla && segundos >= regla.segundosMinimos) void reportar({ segundosVistos: segundos });
  }, [conTiempo, completado, regla, segundos, reportar]);

  // Video: con la pestaña oculta se pausa (el contador tampoco corre).
  useEffect(() => {
    const alCambiarVisibilidad = () => {
      if (document.visibilityState !== 'visible') videoRef.current?.pause();
    };
    document.addEventListener('visibilitychange', alCambiarVisibilidad);
    return () => document.removeEventListener('visibilitychange', alCambiarVisibilidad);
  }, []);

  const alAvanzarVideo = (v: HTMLVideoElement) => {
    const estado = video.current;
    estado.acumulado += segundosQueSuman(v.currentTime - estado.ultimo, {
      velocidad: v.playbackRate,
      visible: document.visibilityState === 'visible',
      pausado: v.paused && !v.ended,
    });
    if (v.currentTime > estado.maximo && v.currentTime <= estado.maximo + 1.5) estado.maximo = v.currentTime;
    estado.ultimo = v.currentTime;
    const vistos = Math.min(estado.acumulado, Math.max(estado.maximo, v.ended ? v.duration : 0));
    setSegundos(vistos);
    if (regla && !completado && videoCompleto(vistos, v.duration, regla.fraccionVideo)) {
      void reportar({ segundosVistos: vistos, duracion: v.duration });
    }
  };
  const alBuscarVideo = (v: HTMLVideoElement) => {
    // No se puede saltar hacia adelante de lo ya visto (sí volver atrás).
    const permitida = posicionPermitida(v.currentTime, video.current.maximo);
    if (permitida !== v.currentTime) v.currentTime = permitida;
    video.current.ultimo = v.currentTime;
  };
  const alternarVideo = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => undefined);
    else v.pause();
  };
  const retrocederVideo = () => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, v.currentTime - 10);
  };

  // PDF: avanza solo con el botón; al llegar a la última página se reporta.
  const alCargarPdf = useCallback((total: number) => setPdf({ pagina: 1, maxima: 1, total }), []);
  const irAPagina = (pagina: number) => {
    setPdf((p) => {
      const siguiente = Math.max(1, Math.min(p.total, pagina));
      return { ...p, pagina: siguiente, maxima: Math.max(p.maxima, siguiente) };
    });
  };
  useEffect(() => {
    if (regla?.tipo !== 'pdf' || completado || pdf.total < 1) return;
    if (pdf.maxima >= pdf.total) {
      void reportar({ segundosVistos: 0, paginaMaxima: pdf.maxima, paginasTotales: pdf.total });
    }
  }, [regla, completado, pdf, reportar]);

  const mime = (material.mime ?? '').toLowerCase();
  const tipo = regla?.tipo ?? (mime.startsWith('video/') ? 'video' : null);
  const lectura = progresoLectura(pdf.maxima, pdf.total);

  let estadoTexto = 'Preparando…';
  if (completado) estadoTexto = '✓ Completado';
  else if (regla?.tipo === 'video') {
    estadoTexto = 'Vea el video completo: se marca cuando el contador llega a la duración.';
  } else if (regla?.tipo === 'pdf') {
    estadoTexto = pdf.total > 1 ? `Avance con "Página siguiente" hasta la última página · ${lectura} % leído` : 'Cargando documento…';
  } else if (conTiempo && regla) {
    estadoTexto = `Revisando… ${reloj(Math.min(segundos, regla.segundosMinimos))} de ${reloj(regla.segundosMinimos)}`;
  }

  const contenido = (
    <Stack gap='sm'>
      <Group justify='space-between' wrap='wrap' gap='xs'>
        <Badge
          size='lg'
          variant='light'
          color={completado ? 'green' : 'blue'}
          role='status'
          data-testid='estado-revision'
          style={{ textTransform: 'none', whiteSpace: 'normal', height: 'auto' }}
        >
          {estadoTexto}
        </Badge>
        {/* Video y PDF se revisan aquí; abrirlos aparte saltaría el control. */}
        {tipo !== 'video' && tipo !== 'pdf' && (
          <Anchor href={url} target='_blank' rel='noopener noreferrer' size='sm'>
            Abrir aparte
          </Anchor>
        )}
      </Group>
      {error && <AvisoError texto={error} />}
      {aviso && (
        <Alert color='yellow' role='alert'>
          {aviso}
        </Alert>
      )}
      {tipo === 'video' ? (
        <>
          {/* Marco 16:9 fijo desde el primer momento (Nicolás, 2026-10-26: el video se veía
              aplastado mientras cargaba) y un indicador de carga encima hasta que hay imagen. */}
          <AspectRatio ratio={16 / 9} maw='calc(70vh * 16 / 9)' mx='auto' w='100%' style={{ position: 'relative', background: '#000', borderRadius: 8, overflow: 'hidden' }}>
          {/* Sin `controls`: la barra nativa permite saltar. */}
          <video
            ref={videoRef}
            style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }}
            src={url}
            disablePictureInPicture
            playsInline
            preload='metadata'
            data-testid='video-material'
            onClick={alternarVideo}
            onContextMenu={(e) => e.preventDefault()}
            onLoadedMetadata={(e) => setDuracion(e.currentTarget.duration || 0)}
            onLoadedData={() => setCargandoVideo(false)}
            onCanPlay={() => setCargandoVideo(false)}
            onWaiting={() => setCargandoVideo(true)}
            onPlaying={() => setCargandoVideo(false)}
            onPlay={() => {
              video.current.ultimo = videoRef.current?.currentTime ?? 0;
              setReproduciendo(true);
            }}
            onPause={() => setReproduciendo(false)}
            onEnded={(e) => {
              setReproduciendo(false);
              alAvanzarVideo(e.currentTarget);
            }}
            onTimeUpdate={(e) => alAvanzarVideo(e.currentTarget)}
            onSeeking={(e) => alBuscarVideo(e.currentTarget)}
            onRateChange={(e) => {
              if (e.currentTarget.playbackRate !== 1) e.currentTarget.playbackRate = 1;
            }}
          />
          {cargandoVideo && (
            <Center style={{ position: 'absolute', inset: 0 }} data-testid='video-cargando'>
              <Stack align='center' gap='xs'>
                <Loader color='white' />
                <Text size='sm' c='white'>
                  Cargando video…
                </Text>
              </Stack>
            </Center>
          )}
          </AspectRatio>
          <Group gap='sm' wrap='nowrap'>
            <Button
              size='xs'
              disabled={duracion === 0}
              leftSection={reproduciendo ? <IconPlayerPause size={14} /> : <IconPlayerPlay size={14} />}
              onClick={alternarVideo}
            >
              {reproduciendo ? 'Pausar' : 'Reproducir'}
            </Button>
            <Button size='xs' variant='default' onClick={retrocederVideo} aria-label='Retroceder 10 segundos' leftSection={<IconRewindBackward10 size={14} />}>
              10 s
            </Button>
            <Progress
              style={{ flex: 1 }}
              radius='xl'
              value={duracion > 0 ? Math.min(100, (segundos / duracion) * 100) : 0}
              role='progressbar'
              aria-label='Tiempo visto del video'
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={duracion > 0 ? Math.min(100, Math.floor((segundos / duracion) * 100)) : 0}
            />
            <Text size='sm' fw={600} data-testid='contador-video'>
              {contadorVideo(segundos, duracion)}
            </Text>
          </Group>
        </>
      ) : tipo === 'imagen' ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img style={{ maxWidth: '100%', maxHeight: '70vh', margin: '0 auto', display: 'block' }} src={url} alt={material.titulo} />
      ) : tipo === 'pdf' ? (
        <>
          <PdfPaginado url={url} pagina={pdf.pagina} onCargado={alCargarPdf} onError={setError} />
          {pdf.total > 1 && (
            <Group gap='sm' wrap='wrap'>
              <Button size='xs' variant='default' onClick={() => irAPagina(pdf.pagina - 1)} disabled={pdf.pagina <= 1}>
                ← Página anterior
              </Button>
              <Text size='sm' fw={600} data-testid='pagina-pdf'>
                Página {pdf.pagina} de {pdf.total}
              </Text>
              <Button size='xs' onClick={() => irAPagina(pdf.pagina + 1)} disabled={pdf.pagina >= pdf.total}>
                Página siguiente →
              </Button>
              <Progress
                style={{ flex: 1, minWidth: 120 }}
                radius='xl'
                value={lectura}
                role='progressbar'
                aria-label='Lectura del documento'
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={lectura}
                data-testid='lectura-pdf'
              />
              <Text size='sm' fw={600}>
                {lectura} %
              </Text>
            </Group>
          )}
        </>
      ) : tipo === 'documento' ? (
        <Stack gap='sm' align='flex-start'>
          <Text size='sm'>Este documento se abre con su programa (Word, Excel o PowerPoint).</Text>
          <Button component='a' href={url} target='_blank' rel='noopener noreferrer'>
            Abrir documento
          </Button>
        </Stack>
      ) : null}
    </Stack>
  );

  // En la vista de la lección (2026-10-26) el visor va en la página, junto a las preguntas.
  if (enLinea) {
    return (
      <Card withBorder radius='md' shadow='sm' padding='md' data-testid='visor-material' aria-label={material.titulo}>
        {contenido}
      </Card>
    );
  }

  return (
    <Modal
      opened
      onClose={onCerrar}
      size='80rem'
      centered
      title={<Text fw={700}>{material.titulo}</Text>}
      aria-label={material.titulo}
      closeButtonProps={{ 'aria-label': 'Cerrar' }}
    >
      <div data-testid='visor-material'>{contenido}</div>
    </Modal>
  );
}

/**
 * Pinta UNA página del PDF en un lienzo con pdf.js (el mismo `pdfjs-dist` y
 * el mismo worker que usan Orión y el SGC; no hay dependencia nueva). Sin
 * barra de desplazamiento ni salto directo: la página la decide el visor con
 * sus botones.
 */
function PdfPaginado({
  url,
  pagina,
  onCargado,
  onError,
}: {
  url: string;
  pagina: number;
  onCargado: (total: number) => void;
  onError: (mensaje: string) => void;
}) {
  const lienzo = useRef<HTMLCanvasElement | null>(null);
  const marco = useRef<HTMLDivElement | null>(null);
  const [documento, setDocumento] = useState<import('pdfjs-dist').PDFDocumentProxy | null>(null);
  const [pintada, setPintada] = useState(0);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error('No se pudo cargar el documento.');
        const bytes = new Uint8Array(await res.arrayBuffer());
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
        const doc = await pdfjs.getDocument({ data: bytes }).promise;
        if (!vivo) return;
        setDocumento(doc);
        onCargado(doc.numPages);
      } catch (e) {
        if (vivo) onError((e as Error).message || 'No se pudo mostrar el documento.');
      }
    })();
    return () => {
      vivo = false;
    };
  }, [url, onCargado, onError]);

  useEffect(() => {
    if (!documento || !lienzo.current) return;
    let tarea: { cancel: () => void } | null = null;
    let vivo = true;
    void (async () => {
      const p = await documento.getPage(pagina);
      if (!vivo || !lienzo.current) return;
      const base = p.getViewport({ scale: 1 });
      // La página completa a la vista: se ajusta al ancho y al alto del visor.
      const ancho = Math.max(240, (marco.current?.clientWidth ?? 900) - 24);
      const alto = Math.max(240, (marco.current?.clientHeight ?? 700) - 24);
      const escala = Math.min(ancho / base.width, alto / base.height) * (window.devicePixelRatio || 1);
      const vista = p.getViewport({ scale: escala });
      const c = lienzo.current;
      c.width = vista.width;
      c.height = vista.height;
      c.style.width = `${vista.width / (window.devicePixelRatio || 1)}px`;
      const ctx = c.getContext('2d');
      if (!ctx) return;
      const render = p.render({ canvasContext: ctx, viewport: vista, canvas: c } as Parameters<typeof p.render>[0]);
      tarea = render;
      await render.promise.catch(() => undefined);
      if (vivo) setPintada(pagina);
    })();
    return () => {
      vivo = false;
      tarea?.cancel();
    };
  }, [documento, pagina]);

  return (
    <Box
      ref={marco}
      data-testid='pdf-material'
      data-pagina-pintada={pintada}
      h='70vh'
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}
    >
      {!documento && <Cargando texto='Cargando documento…' />}
      <canvas ref={lienzo} aria-label={`Página ${pagina}`} />
    </Box>
  );
}

/* ──────────────────────────────── Formador ─────────────────────────────── */

function ListaCursosFormador({
  cursos,
  onGestionar,
  onCreado,
}: {
  cursos: CursoResumen[];
  onGestionar: (id: number) => void;
  onCreado: () => Promise<void>;
}) {
  const [titulo, setTitulo] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [creando, setCreando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const crear = async () => {
    if (!titulo.trim()) return;
    setCreando(true);
    setError(null);
    try {
      const res = await fetch('/api/portal/courses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ titulo, descripcion }),
      });
      const data = await leerJson(res);
      if (!res.ok) throw new Error(String(data?.error ?? 'No se pudo crear el curso.'));
      setTitulo('');
      setDescripcion('');
      await onCreado();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreando(false);
    }
  };

  return (
    <Stack gap='md'>
      <Card withBorder radius='md' shadow='sm' padding='md'>
        <Group align='flex-end' wrap='wrap' gap='sm'>
          <TextInput
            label='Curso nuevo'
            placeholder='Título del curso nuevo'
            value={titulo}
            onChange={(e) => setTitulo(e.currentTarget.value)}
            style={{ flex: 1, minWidth: 200 }}
          />
          <TextInput
            label='Descripción'
            placeholder='Descripción (opcional)'
            value={descripcion}
            onChange={(e) => setDescripcion(e.currentTarget.value)}
            style={{ flex: 2, minWidth: 200 }}
          />
          <Button leftSection={<IconPlus size={16} />} onClick={() => void crear()} loading={creando} disabled={!titulo.trim()}>
            Crear curso
          </Button>
        </Group>
      </Card>
      {error && <AvisoError texto={error} />}

      {cursos.length === 0 ? (
        <Text size='sm' c='dimmed' ta='center' py='xl'>
          Todavía no ha creado ningún curso.
        </Text>
      ) : (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing='md'>
          {cursos.map((c) => (
            <Card
              key={c.id}
              withBorder
              radius='md'
              shadow='sm'
              padding='md'
              component='button'
              type='button'
              onClick={() => onGestionar(c.id)}
              style={{ textAlign: 'left', cursor: 'pointer' }}
            >
              <Stack gap={6}>
                <Group gap='xs'>
                  <Text fw={700}>{c.titulo}</Text>
                  {!c.activo && (
                    <Badge color='gray' variant='light'>
                      Borrador
                    </Badge>
                  )}
                </Group>
                {c.descripcion && (
                  <Text size='sm' c='dimmed' lineClamp={3}>
                    {c.descripcion}
                  </Text>
                )}
                <Text size='xs' c='dimmed'>
                  {c.totalMateriales} material(es) · {c.totalInscritos} inscrito(s)
                </Text>
              </Stack>
            </Card>
          ))}
        </SimpleGrid>
      )}
    </Stack>
  );
}

export function VistaCursoFormador({
  cursoId,
  onVolver,
  onCambio,
  onEliminado,
}: {
  cursoId: number;
  onVolver: () => void;
  onCambio: () => Promise<void>;
  onEliminado: (titulo: string) => void;
}) {
  const [detalle, setDetalle] = useState<DetalleCurso | null>(null);
  const [roster, setRoster] = useState<FilaRoster[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Error de una ACCIÓN (guardar, quitar, reemplazar): se muestra arriba sin
  // tapar la vista, para que el formador no pierda lo que estaba editando.
  const [errorAccion, setErrorAccion] = useState<string | null>(null);
  // Resultado de restablecer un curso a un estudiante: arriba y con color, como los demás avisos de acción.
  const [avisoAccion, setAvisoAccion] = useState<string | null>(null);
  const [restableciendo, setRestableciendo] = useState<string | null>(null);
  const [trabajandoRestablecer, setTrabajandoRestablecer] = useState(false);
  // «Eliminar curso» (Cristian, 2026-10-22): borrado lógico con confirmación.
  const [confirmarEliminar, setConfirmarEliminar] = useState(false);
  const [eliminando, setEliminando] = useState(false);
  const [errorEliminar, setErrorEliminar] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const [resCurso, resRoster] = await Promise.all([
        fetch(`/api/portal/courses/${cursoId}`, { cache: 'no-store' }),
        fetch(`/api/portal/courses/${cursoId}/roster`, { cache: 'no-store' }),
      ]);
      const dataCurso = await leerJson(resCurso);
      if (!resCurso.ok) throw new Error(String(dataCurso?.error ?? 'No se pudo cargar el curso.'));
      setDetalle(dataCurso as unknown as DetalleCurso);

      const dataRoster = await leerJson(resRoster);
      if (!resRoster.ok) throw new Error(String(dataRoster?.error ?? 'No se pudo cargar el progreso.'));
      setRoster(Array.isArray(dataRoster.estudiantes) ? (dataRoster.estudiantes as FilaRoster[]) : []);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [cursoId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  // ── Subida DIRECTA a SharePoint (sin tope de peso; Cristian, 2026-10-08) ──
  // El archivo va del navegador a la carpeta FORMACION por trozos; el
  // servidor solo abre la sesión y después registra el material.
  const [subida, setSubida] = useState<EstadoSubida | null>(null);
  const cancelarSubidaRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!subida) return;
    // Cerrar la pestaña a mitad de un video de 500 MB lo deja a medias.
    const alSalir = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', alSalir);
    return () => window.removeEventListener('beforeunload', alSalir);
  }, [subida]);

  const subirDirecto = async (archivo: File): Promise<ArchivoSubidoAlCurso> => {
    const control = new AbortController();
    cancelarSubidaRef.current = control;
    setSubida({ nombre: archivo.name, subidos: 0, total: archivo.size });
    try {
      return await subirMaterialDirecto(cursoId, archivo, {
        signal: control.signal,
        onProgreso: (subidos, total) => setSubida({ nombre: archivo.name, subidos, total }),
      });
    } finally {
      cancelarSubidaRef.current = null;
      setSubida(null);
    }
  };

  const mensajeDeSubida = (e: unknown, porDefecto: string) =>
    e instanceof SubidaCancelada ? 'Subida cancelada. No se agregó nada al curso.' : (e as Error)?.message || porDefecto;

  // «Video» es un DOCUMENTO de video (MP4): va aparte porque así lo buscan los formadores (Nicolás, 2026-10-26).
  const [tipoNuevo, setTipoNuevo] = useState<'VIDEO' | 'DOCUMENT' | 'LINK' | 'FORM'>('DOCUMENT');
  const [formularioNuevo, setFormularioNuevo] = useState<{ id: number | null; titulo: string }>({ id: null, titulo: '' });
  const [respuestasDe, setRespuestasDe] = useState<Material | null>(null);
  const [previaDe, setPreviaDe] = useState<Material | null>(null);
  const [tituloNuevo, setTituloNuevo] = useState('');
  const [urlNueva, setUrlNueva] = useState('');
  const [archivoNuevo, setArchivoNuevo] = useState<File | null>(null);
  const [obligatorioNuevo, setObligatorioNuevo] = useState(true);
  const [subiendo, setSubiendo] = useState(false);

  const agregarMaterial = async () => {
    if (!tituloNuevo.trim() && tipoNuevo !== 'FORM') return;
    if (tipoNuevo === 'FORM' && !formularioNuevo.id) return;
    if (tipoNuevo === 'LINK' && !urlNueva.trim()) return;
    if ((tipoNuevo === 'DOCUMENT' || tipoNuevo === 'VIDEO') && !archivoNuevo) return;
    if (tipoNuevo === 'VIDEO' && archivoNuevo && !archivoNuevo.type.startsWith('video/')) {
      setErrorAccion('El archivo no es un video. Use un archivo MP4.');
      return;
    }

    setSubiendo(true);
    setErrorAccion(null);
    try {
      const cuerpo: Record<string, unknown> = {
        type: tipoNuevo === 'VIDEO' ? 'DOCUMENT' : tipoNuevo,
        title: tituloNuevo,
        required: String(obligatorioNuevo),
      };
      if (tipoNuevo === 'LINK') cuerpo.url = urlNueva;
      else if (tipoNuevo === 'FORM') cuerpo.formularioId = formularioNuevo.id;
      else if (archivoNuevo) Object.assign(cuerpo, await subirDirecto(archivoNuevo));

      const res = await fetch(`/api/portal/courses/${cursoId}/materials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpo),
      });
      const data = await leerJson(res);
      if (!res.ok) throw new Error(String(data?.error ?? 'No se pudo agregar el material.'));

      setTituloNuevo('');
      setUrlNueva('');
      setArchivoNuevo(null);
      setObligatorioNuevo(true);
      await cargar();
    } catch (e) {
      setErrorAccion(mensajeDeSubida(e, 'No se pudo agregar el material.'));
    } finally {
      setSubiendo(false);
    }
  };

  const quitarMaterial = async (materialId: number) => {
    if (
      !window.confirm(
        '¿Quitar este material del curso? Deja de contar para el progreso y su archivo se mueve a la carpeta ' +
          'FORMACION/ELIMINADOS de SharePoint (no se borra).'
      )
    )
      return;
    setErrorAccion(null);
    try {
      const res = await fetch(`/api/portal/courses/${cursoId}/materials/${materialId}`, { method: 'DELETE' });
      const data = await leerJson(res);
      if (!res.ok) throw new Error(String(data?.error ?? 'No se pudo quitar el material.'));
      await cargar();
    } catch (e) {
      setErrorAccion((e as Error).message);
    }
  };

  /** PATCH del material (JSON). Devuelve true si salió bien. */
  const guardarMaterial = async (materialId: number, cambios: Record<string, unknown>): Promise<boolean> => {
    setErrorAccion(null);
    try {
      const res = await fetch(`/api/portal/courses/${cursoId}/materials/${materialId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cambios),
      });
      const data = await leerJson(res);
      if (!res.ok) throw new Error(String(data?.error ?? 'No se pudo guardar el material.'));
      return true;
    } catch (e) {
      setErrorAccion((e as Error).message);
      return false;
    }
  };

  /** Reemplaza el archivo (o convierte un enlace en documento). */
  const reemplazarArchivo = async (materialId: number, archivo: File): Promise<boolean> => {
    setErrorAccion(null);
    try {
      const subido = await subirDirecto(archivo);
      const res = await fetch(`/api/portal/courses/${cursoId}/materials/${materialId}/file`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subido),
      });
      const data = await leerJson(res);
      if (!res.ok) throw new Error(String(data?.error ?? 'No se pudo reemplazar el archivo.'));
      return true;
    } catch (e) {
      setErrorAccion(mensajeDeSubida(e, 'No se pudo reemplazar el archivo.'));
      return false;
    }
  };

  const moverMaterial = async (materialId: number, mover: 'arriba' | 'abajo') => {
    if (await guardarMaterial(materialId, { mover })) await cargar();
  };

  const [editandoCurso, setEditandoCurso] = useState(false);
  // Menú de edición OCULTO por defecto (Cristian, 2026-10-14): al entrar solo se ven el nombre del curso y el progreso de los
  // estudiantes; el botón «Editar» muestra título, publicar, materiales y agregar material.
  const [modoEdicion, setModoEdicion] = useState(false);
  // Invitar a una persona al curso por correo.
  const [invitando, setInvitando] = useState(false);
  const [correoInvitar, setCorreoInvitar] = useState('');
  const [enviandoInvitacion, setEnviandoInvitacion] = useState(false);
  const [resultadoInvitacion, setResultadoInvitacion] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);
  const panelInvitar = useRef<HTMLFormElement | null>(null);
  // El resultado de enviar queda a la vista: si el formulario quedó fuera de pantalla, se baja hasta él.
  useEffect(() => {
    if (!resultadoInvitacion) return;
    window.requestAnimationFrame(() => panelInvitar.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
  }, [resultadoInvitacion]);
  const [tituloCurso, setTituloCurso] = useState('');
  const [descripcionCurso, setDescripcionCurso] = useState('');
  const [guardandoCurso, setGuardandoCurso] = useState(false);

  const empezarEdicionCurso = () => {
    if (!detalle) return;
    setTituloCurso(detalle.curso.titulo);
    setDescripcionCurso(detalle.curso.descripcion ?? '');
    setEditandoCurso(true);
  };

  const guardarCurso = async () => {
    if (!tituloCurso.trim()) {
      setErrorAccion('El título del curso no puede quedar vacío.');
      return;
    }
    setGuardandoCurso(true);
    setErrorAccion(null);
    try {
      const res = await fetch(`/api/portal/courses/${cursoId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ titulo: tituloCurso, descripcion: descripcionCurso }),
      });
      const data = await leerJson(res);
      if (!res.ok) throw new Error(String(data?.error ?? 'No se pudo guardar el curso.'));
      setEditandoCurso(false);
      await cargar();
      await onCambio();
    } catch (e) {
      setErrorAccion((e as Error).message);
    } finally {
      setGuardandoCurso(false);
    }
  };

  const publicar = async (activo: boolean) => {
    try {
      const res = await fetch(`/api/portal/courses/${cursoId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activo }),
      });
      const data = await leerJson(res);
      if (!res.ok) throw new Error(String(data?.error ?? 'No se pudo actualizar el curso.'));
      await cargar();
      await onCambio();
    } catch (e) {
      setErrorAccion((e as Error).message);
    }
  };

  const eliminarElCurso = async () => {
    setEliminando(true);
    setErrorEliminar(null);
    try {
      const res = await fetch(`/api/portal/courses/${cursoId}`, { method: 'DELETE' });
      const data = await leerJson(res);
      if (!res.ok) throw new Error(String(data?.error ?? 'No se pudo eliminar el curso.'));
      setConfirmarEliminar(false);
      onEliminado(detalle?.curso.titulo ?? 'el curso');
    } catch (e) {
      setErrorEliminar((e as Error).message);
    } finally {
      setEliminando(false);
    }
  };

  if (error) return <AvisoError texto={error} />;
  const restablecerEstudiante = async (fila: FilaRoster) => {
    setTrabajandoRestablecer(true);
    setErrorAccion(null);
    setAvisoAccion(null);
    try {
      const res = await fetch(`/api/portal/courses/${cursoId}/restablecer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ correo: fila.correo }),
      });
      const data = await leerJson(res);
      if (!res.ok) throw new Error(String(data?.error ?? 'No se pudo restablecer el curso.'));
      setRestableciendo(null);
      await cargar();
      await onCambio();
      const n = (v: unknown, uno: string, varios: string) => `${Number(v ?? 0)} ${Number(v ?? 0) === 1 ? uno : varios}`;
      setAvisoAccion(
        `Curso restablecido para ${fila.nombre}: se borraron ${n(data.progresos, 'avance', 'avances')}, ${n(data.respuestas, 'respuesta de formularios', 'respuestas de formularios')} y ${n(data.certificados, 'certificado', 'certificados')}. Puede volver a hacerlo desde cero.`
      );
    } catch (e) {
      setErrorAccion((e as Error).message);
    } finally {
      setTrabajandoRestablecer(false);
    }
  };

  const enviarInvitacion = async () => {
    const correo = correoInvitar.trim();
    if (!correo) {
      setResultadoInvitacion({ tipo: 'error', texto: 'Escriba el correo de la persona.' });
      return;
    }
    setEnviandoInvitacion(true);
    setResultadoInvitacion(null);
    try {
      const res = await fetch(`/api/portal/courses/${cursoId}/invitar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ correo }),
      });
      const data = await leerJson(res);
      if (!res.ok) throw new Error(String(data?.error ?? 'No se pudo enviar la invitación.'));
      setCorreoInvitar('');
      setResultadoInvitacion({
        tipo: 'ok',
        texto: `Invitación enviada a ${String(data.correo ?? correo)}. ${data.yaInscrito ? 'Ya estaba inscrita en el curso.' : 'Quedó inscrita en el curso.'}`,
      });
      await cargar();
    } catch (e) {
      setResultadoInvitacion({ tipo: 'error', texto: (e as Error).message });
    } finally {
      setEnviandoInvitacion(false);
    }
  };

  if (!detalle || !roster) return <Cargando texto='Cargando…' />;

  return (
    <Stack gap='md'>
      <Group>
        <Button variant='subtle' leftSection={<IconArrowLeft size={16} />} onClick={onVolver}>
          Volver a Formación
        </Button>
      </Group>
      {errorAccion && <AvisoError texto={errorAccion} />}
      {avisoAccion && (
        <Alert color='green' role='status' data-testid='aviso-restablecer'>
          {avisoAccion}
        </Alert>
      )}
      {subida && <ProgresoSubida subida={subida} onCancelar={() => cancelarSubidaRef.current?.abort()} />}
      <Modal
        opened={confirmarEliminar}
        onClose={() => !eliminando && setConfirmarEliminar(false)}
        title='Eliminar curso'
        centered
        data-testid='confirmar-eliminar-curso'
      >
        <Stack gap='sm'>
          <Text size='sm'>
            Va a eliminar el curso <strong>«{detalle.curso.titulo}»</strong>. Dejará de aparecer en Formación para todos,
            estudiantes y formadores.
          </Text>
          {(() => {
            const inscritos = detalle.conteos?.inscritos ?? roster.length;
            const certificados = detalle.conteos?.certificados ?? 0;
            const plural = (n: number, uno: string, varios: string) => `${n.toLocaleString('es-CO')} ${n === 1 ? uno : varios}`;
            return inscritos > 0 || certificados > 0 ? (
              <Alert color='red' icon={<IconAlertTriangle size={18} />} p='sm' data-testid='eliminar-curso-advertencia'>
                <Text size='sm' fw={600}>
                  Este curso tiene {plural(inscritos, 'persona inscrita', 'personas inscritas')} y{' '}
                  {plural(certificados, 'certificado emitido', 'certificados emitidos')}.
                </Text>
                <Text size='sm'>
                  Ya no podrán seguir avanzando en él. Sus inscripciones y certificados se conservan, y los certificados
                  emitidos siguen siendo verificables.
                </Text>
              </Alert>
            ) : (
              <Text size='sm' c='dimmed'>
                No tiene personas inscritas ni certificados emitidos.
              </Text>
            );
          })()}
          <Text size='sm' c='dimmed'>
            Los archivos del curso en SharePoint no se borran.
          </Text>
          {errorEliminar && (
            <Text size='sm' c='red' role='alert'>
              {errorEliminar}
            </Text>
          )}
          <Group justify='flex-end'>
            <Button variant='default' onClick={() => setConfirmarEliminar(false)} disabled={eliminando}>
              Cancelar
            </Button>
            <Button color='red' loading={eliminando} onClick={() => void eliminarElCurso()} data-testid='eliminar-curso-si'>
              Sí, eliminar curso
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Card withBorder radius='md' shadow='sm' padding='lg'>
        <Stack gap='sm'>
          {editandoCurso ? (
            <Stack gap='sm'>
              <TextInput
                aria-label='Título del curso'
                label='Título del curso'
                value={tituloCurso}
                maxLength={255}
                onChange={(e) => setTituloCurso(e.currentTarget.value)}
              />
              <Textarea
                aria-label='Descripción del curso'
                label='Descripción'
                placeholder='Descripción (opcional)'
                value={descripcionCurso}
                maxLength={4000}
                autosize
                minRows={3}
                onChange={(e) => setDescripcionCurso(e.currentTarget.value)}
              />
              <Group gap='sm'>
                <Button onClick={() => void guardarCurso()} loading={guardandoCurso}>
                  Guardar
                </Button>
                <Button variant='default' onClick={() => setEditandoCurso(false)} disabled={guardandoCurso}>
                  Cancelar
                </Button>
              </Group>
            </Stack>
          ) : (
            <Group justify='space-between' wrap='wrap' gap='sm'>
              <Group gap='xs' wrap='nowrap' style={{ minWidth: 0 }}>
                <Title order={3}>{detalle.curso.titulo}</Title>
                {!detalle.curso.activo && (
                  <Badge color='gray' variant='light'>
                    Borrador
                  </Badge>
                )}
                {modoEdicion && (
                  <Tooltip label='Editar título y descripción' withArrow>
                    <ActionIcon variant='subtle' color='gray' aria-label='Editar título y descripción' onClick={empezarEdicionCurso}>
                      <IconPencil size={16} />
                    </ActionIcon>
                  </Tooltip>
                )}
              </Group>
              <Group gap='xs'>
                {modoEdicion && (
                  <Button variant='light' onClick={() => void publicar(!detalle.curso.activo)}>
                    {detalle.curso.activo ? 'Pasar a borrador' : 'Publicar curso'}
                  </Button>
                )}
                {modoEdicion && detalle.esFormador && (
                  <Button
                    color='red'
                    variant='light'
                    onClick={() => {
                      setErrorEliminar(null);
                      setConfirmarEliminar(true);
                    }}
                    data-testid='eliminar-curso'
                  >
                    Eliminar curso
                  </Button>
                )}
                {!modoEdicion && (
                  <Button
                    leftSection={<IconPlus size={16} />}
                    onClick={() => {
                      setModoEdicion(true);
                      setTipoNuevo('VIDEO');
                      window.requestAnimationFrame(() =>
                        document.querySelector('[data-testid="agregar-clase"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                      );
                    }}
                    data-testid='agregar-video'
                  >
                    Agregar video o clase
                  </Button>
                )}
                <Button
                  variant={modoEdicion ? 'filled' : 'default'}
                  leftSection={<IconPencil size={16} />}
                  aria-expanded={modoEdicion}
                  onClick={() => {
                    if (modoEdicion) setEditandoCurso(false);
                    setModoEdicion(!modoEdicion);
                  }}
                  data-testid='alternar-edicion'
                >
                  {modoEdicion ? 'Cerrar edición' : 'Editar'}
                </Button>
              </Group>
            </Group>
          )}
          {!editandoCurso && detalle.curso.descripcion && (
            <Text size='sm' c='dimmed'>
              {detalle.curso.descripcion}
            </Text>
          )}
          {!detalle.curso.activo && (
            <Alert color='yellow'>Este curso está en borrador: los estudiantes todavía no lo ven.</Alert>
          )}
        </Stack>
      </Card>

      {modoEdicion && (
        <Card withBorder radius='md' shadow='sm' padding='lg' data-testid='menu-edicion'>
          <Stack gap='sm'>
            <Title order={4}>Clases del curso</Title>
            <Text size='sm' c='dimmed'>
              Cada clase es un video, un documento, un enlace o un formulario. Ordénelas con las flechas; así aparecen en el
              temario.
            </Text>
            <Stack gap='xs' component='ul' style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {detalle.materiales.map((m, i) => (
                <FilaMaterialFormador
                  key={m.id}
                  cursoId={detalle.curso.id}
                  material={m}
                  esPrimero={i === 0}
                  esUltimo={i === detalle.materiales.length - 1}
                  onGuardar={guardarMaterial}
                  onReemplazar={reemplazarArchivo}
                  onMover={moverMaterial}
                  onQuitar={quitarMaterial}
                  onRecargar={cargar}
                  puedeVerRespuestas={detalle.puedeMarcarManual === true}
                  onVerRespuestas={setRespuestasDe}
                  onVerPrevia={setPreviaDe}
                />
              ))}
              {detalle.materiales.length === 0 && (
                <Text size='sm' c='dimmed'>
                  Todavía no hay clases. Agregue la primera abajo.
                </Text>
              )}
            </Stack>

            <Paper withBorder radius='md' p='md' data-testid='agregar-clase'>
              <Stack gap='sm'>
                <Title order={5}>Agregar una clase</Title>
                <SegmentedControl
                  value={tipoNuevo}
                  onChange={(v) => {
                    setTipoNuevo(v as 'VIDEO' | 'DOCUMENT' | 'LINK' | 'FORM');
                    setArchivoNuevo(null);
                  }}
                  data={[
                    { value: 'VIDEO', label: 'Video' },
                    { value: 'DOCUMENT', label: 'Documento' },
                    { value: 'LINK', label: 'Enlace' },
                    { value: 'FORM', label: 'Formulario' },
                  ]}
                />
                <Text size='xs' c='dimmed'>
                  {tipoNuevo === 'VIDEO'
                    ? 'Suba el video en MP4. Se guarda en SharePoint (carpeta FORMACION) y el estudiante lo ve dentro del curso, sin poder adelantarlo.'
                    : tipoNuevo === 'DOCUMENT'
                      ? 'PDF, Word, Excel, PowerPoint o imagen. Los PDF se leen página por página dentro del curso.'
                      : tipoNuevo === 'LINK'
                        ? 'Un enlace externo (por ejemplo, un video de YouTube o una página). Se abre en otra pestaña.'
                        : 'Una evaluación o encuesta propia de SynerLink, o importada de Microsoft Forms.'}
                </Text>
                <TextInput
                  label='Título de la clase'
                  placeholder={tipoNuevo === 'FORM' ? 'Título (opcional)' : tipoNuevo === 'VIDEO' ? 'Ej.: Bienvenida a la compañía' : 'Título del material'}
                  value={tituloNuevo}
                  onChange={(e) => setTituloNuevo(e.currentTarget.value)}
                />
                {tipoNuevo === 'FORM' ? (
                  <SelectorFormulario valor={formularioNuevo.id} onCambio={(id, titulo) => setFormularioNuevo({ id, titulo })} />
                ) : tipoNuevo === 'LINK' ? (
                  <TextInput placeholder='https://…' value={urlNueva} onChange={(e) => setUrlNueva(e.currentTarget.value)} />
                ) : (
                  <FileInput
                    label={tipoNuevo === 'VIDEO' ? 'Archivo de video' : 'Archivo'}
                    placeholder={tipoNuevo === 'VIDEO' ? 'Seleccione el video (MP4)' : 'Seleccione el archivo'}
                    accept={tipoNuevo === 'VIDEO' ? 'video/mp4' : undefined}
                    value={archivoNuevo}
                    onChange={setArchivoNuevo}
                    clearable
                  />
                )}
                <Checkbox
                  checked={obligatorioNuevo}
                  onChange={(e) => setObligatorioNuevo(e.currentTarget.checked)}
                  label='Obligatorio para completar el curso'
                />
                <Group>
                  <Button leftSection={<IconPlus size={16} />} onClick={() => void agregarMaterial()} loading={subiendo}>
                    {subiendo ? (subida ? 'Subiendo…' : 'Agregando…') : 'Agregar clase'}
                  </Button>
                </Group>
              </Stack>
            </Paper>
          </Stack>
        </Card>
      )}

      {respuestasDe && (
        <PanelRespuestas materialId={respuestasDe.id} titulo={respuestasDe.titulo} onCerrar={() => setRespuestasDe(null)} onCambio={cargar} />
      )}
      {previaDe?.formularioId && (
        <PreviaDeMaterialFormulario formularioId={previaDe.formularioId} titulo={previaDe.titulo} onCerrar={() => setPreviaDe(null)} />
      )}

      <Card withBorder radius='md' shadow='sm' padding='lg'>
        <Stack gap='sm'>
          <Group justify='space-between' wrap='wrap'>
            <Title order={4}>Progreso de los estudiantes</Title>
            <Button
              variant='default'
              leftSection={<IconUserPlus size={16} />}
              aria-expanded={invitando}
              onClick={() => {
                setResultadoInvitacion(null);
                setInvitando(!invitando);
              }}
              data-testid='invitar-curso'
            >
              Invitar al Curso
            </Button>
          </Group>
          {invitando && (
            <Paper
              withBorder
              radius='md'
              p='md'
              component='form'
              ref={panelInvitar}
              data-testid='invitar-form'
              onSubmit={(ev: React.FormEvent<HTMLFormElement>) => {
                ev.preventDefault();
                void enviarInvitacion();
              }}
            >
              <Stack gap='sm'>
                {/* El resultado va ARRIBA del formulario y con color, a la vista donde se hizo clic. */}
                {resultadoInvitacion && (
                  <Alert
                    color={resultadoInvitacion.tipo === 'error' ? 'red' : 'green'}
                    role={resultadoInvitacion.tipo === 'error' ? 'alert' : 'status'}
                    data-tipo={resultadoInvitacion.tipo}
                    data-testid='invitar-aviso'
                  >
                    {resultadoInvitacion.texto}
                  </Alert>
                )}
                <TextInput
                  label='Correo de la persona a invitar'
                  type='email'
                  inputMode='email'
                  autoComplete='off'
                  placeholder='nombre@gsslatam.com'
                  maxLength={255}
                  value={correoInvitar}
                  onChange={(e) => setCorreoInvitar(e.currentTarget.value)}
                  data-testid='invitar-correo'
                  description='Recibirá un mensaje con el enlace al curso y quedará inscrita.'
                  autoFocus
                />
                <Group justify='flex-end' gap='sm'>
                  <Button variant='default' onClick={() => setInvitando(false)} disabled={enviandoInvitacion}>
                    Cerrar
                  </Button>
                  <Button type='submit' loading={enviandoInvitacion} data-testid='invitar-enviar'>
                    Enviar
                  </Button>
                </Group>
              </Stack>
            </Paper>
          )}
          {roster.length === 0 ? (
            <Text size='sm' c='dimmed' ta='center' py='md'>
              Todavía no hay estudiantes inscritos.
            </Text>
          ) : (
            <Box className='overflow-x-auto'>
              <Table striped highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Nombre</Table.Th>
                    <Table.Th>Correo</Table.Th>
                    <Table.Th>Progreso</Table.Th>
                    <Table.Th>Certificado</Table.Th>
                    {detalle.puedeMarcarManual === true && <Table.Th>Acciones</Table.Th>}
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {roster.map((f) => (
                    <Table.Tr key={f.correo}>
                      <Table.Td>{f.nombre}</Table.Td>
                      <Table.Td>{f.correo}</Table.Td>
                      <Table.Td style={{ minWidth: 160 }}>
                        <BarraProgreso porcentaje={f.porcentaje} />
                      </Table.Td>
                      <Table.Td>
                        {f.certificado ? (
                          <Anchor href={certificadoUrl(f.certificado)} target='_blank' rel='noopener noreferrer' size='sm'>
                            Ver
                          </Anchor>
                        ) : (
                          '—'
                        )}
                      </Table.Td>
                      {detalle.puedeMarcarManual === true && (
                        <Table.Td>
                          {restableciendo === f.correo ? (
                            <Group gap='xs' wrap='wrap' data-testid='restablecer-confirmar'>
                              <Text size='xs'>¿Borrar su progreso, sus respuestas y su certificado?</Text>
                              <Button size='xs' color='red' loading={trabajandoRestablecer} onClick={() => void restablecerEstudiante(f)} data-testid='restablecer-si'>
                                Sí, restablecer
                              </Button>
                              <Button size='xs' variant='default' disabled={trabajandoRestablecer} onClick={() => setRestableciendo(null)}>
                                No
                              </Button>
                            </Group>
                          ) : (
                            <Button
                              size='xs'
                              variant='default'
                              aria-label={`Restablecer el curso para ${f.nombre}`}
                              onClick={() => {
                                setAvisoAccion(null);
                                setErrorAccion(null);
                                setRestableciendo(f.correo);
                              }}
                              data-testid='restablecer-curso'
                            >
                              Restablecer
                            </Button>
                          )}
                        </Table.Td>
                      )}
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Box>
          )}
        </Stack>
      </Card>
    </Stack>
  );
}

/**
 * Un material en la vista del formador, con edición EN LÍNEA (lápiz →
 * Guardar/Cancelar): título, tipo, enlace, reemplazo del archivo, la marca
 * de obligatorio y el orden (↑/↓). Pedido de Cristian, 2026-09-30.
 */
function FilaMaterialFormador({
  cursoId,
  material: m,
  esPrimero,
  esUltimo,
  onGuardar,
  onReemplazar,
  onMover,
  onQuitar,
  onRecargar,
  puedeVerRespuestas = false,
  onVerRespuestas,
  onVerPrevia,
}: {
  cursoId: number;
  material: Material;
  puedeVerRespuestas?: boolean;
  onVerRespuestas?: (m: Material) => void;
  onVerPrevia?: (m: Material) => void;
  esPrimero: boolean;
  esUltimo: boolean;
  onGuardar: (materialId: number, cambios: Record<string, unknown>) => Promise<boolean>;
  onReemplazar: (materialId: number, archivo: File) => Promise<boolean>;
  onMover: (materialId: number, mover: 'arriba' | 'abajo') => Promise<void>;
  onQuitar: (materialId: number) => Promise<void>;
  onRecargar: () => Promise<void>;
}) {
  const [editando, setEditando] = useState(false);
  const [titulo, setTitulo] = useState(m.titulo);
  const [tipo, setTipo] = useState<'DOCUMENT' | 'LINK' | 'FORM'>(m.tipo);
  const [url, setUrl] = useState(m.url ?? '');
  const [archivo, setArchivo] = useState<File | null>(null);
  const [obligatorio, setObligatorio] = useState(m.obligatorio);
  const [guardando, setGuardando] = useState(false);

  const empezar = () => {
    setTitulo(m.titulo);
    setTipo(m.tipo);
    setUrl(m.url ?? '');
    setArchivo(null);
    setObligatorio(m.obligatorio);
    setEditando(true);
  };

  // Pasar de enlace a documento exige subir un archivo.
  const faltaArchivo = tipo === 'DOCUMENT' && m.tipo === 'LINK' && !archivo;
  const faltaUrl = tipo === 'LINK' && !url.trim();

  const guardar = async () => {
    if (!titulo.trim() || faltaArchivo || faltaUrl) return;
    setGuardando(true);
    try {
      // 1) El archivo primero: si falla, no se toca nada más.
      if (tipo === 'DOCUMENT' && archivo) {
        if (!(await onReemplazar(m.id, archivo))) return;
      }
      // 2) Los demás campos.
      const cambios: Record<string, unknown> = { titulo, obligatorio };
      if (tipo === 'LINK' && m.tipo !== 'FORM') {
        cambios.tipo = 'LINK';
        cambios.url = url;
      }
      if (!(await onGuardar(m.id, cambios))) {
        await onRecargar();
        return;
      }
      setEditando(false);
      await onRecargar();
    } finally {
      setGuardando(false);
    }
  };

  if (!editando) {
    return (
      <Paper component='li' withBorder radius='md' p='sm' data-testid='material-item'>
        <Group justify='space-between' wrap='nowrap' gap='sm'>
          <Group gap='sm' wrap='nowrap' style={{ minWidth: 0 }}>
          {m.tipo === 'DOCUMENT' && (m.mime ?? '').toLowerCase().startsWith('video/') && (
            <MiniaturaVideo url={materialUrl(cursoId, m.id)} titulo={m.titulo} ancho={96} />
          )}
          <Stack gap={0} style={{ minWidth: 0 }}>
            {m.tipo === 'FORM' ? (
              <Anchor component='button' type='button' fw={600} ta='left' onClick={() => onVerPrevia?.(m)}>
                {m.titulo}
              </Anchor>
            ) : (
              <Anchor
                href={m.tipo === 'LINK' ? (m.url ?? '#') : materialUrl(cursoId, m.id)}
                target='_blank'
                rel='noopener noreferrer'
                fw={600}
              >
                {m.titulo}
              </Anchor>
            )}
            <Text size='xs' c='dimmed'>
              {m.tipo === 'LINK' ? 'Enlace' : m.tipo === 'FORM' ? 'Formulario propio' : 'Documento'}
              {m.tipo === 'DOCUMENT' && m.nombreArchivo && ` · ${m.nombreArchivo}`}
              {!m.obligatorio && ' · opcional'}
            </Text>
          </Stack>
          </Group>
          <Group gap={4} wrap='nowrap'>
            {m.tipo === 'FORM' && puedeVerRespuestas && (
              <Button size='xs' variant='default' leftSection={<IconTable size={14} />} onClick={() => onVerRespuestas?.(m)}>
                Respuestas
              </Button>
            )}
            <Tooltip label='Subir' withArrow>
              <ActionIcon variant='subtle' color='gray' aria-label='Subir un puesto' disabled={esPrimero} onClick={() => void onMover(m.id, 'arriba')}>
                <IconArrowUp size={16} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label='Bajar' withArrow>
              <ActionIcon variant='subtle' color='gray' aria-label='Bajar un puesto' disabled={esUltimo} onClick={() => void onMover(m.id, 'abajo')}>
                <IconArrowDown size={16} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label='Editar' withArrow>
              <ActionIcon variant='subtle' color='gray' aria-label='Editar material' onClick={empezar}>
                <IconPencil size={16} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label='Quitar' withArrow>
              <ActionIcon variant='subtle' color='red' aria-label='Quitar material' onClick={() => void onQuitar(m.id)}>
                <IconX size={16} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>
      </Paper>
    );
  }

  return (
    <Paper component='li' withBorder radius='md' p='md' data-testid='material-item'>
      <Stack gap='sm'>
        {m.tipo !== 'FORM' && (
          <SegmentedControl
            value={tipo}
            onChange={(v) => setTipo(v as 'DOCUMENT' | 'LINK')}
            data={[
              { value: 'DOCUMENT', label: 'Documento' },
              { value: 'LINK', label: 'Enlace' },
            ]}
          />
        )}
        <TextInput
          aria-label='Título del material'
          placeholder='Título del material'
          value={titulo}
          maxLength={255}
          onChange={(e) => setTitulo(e.currentTarget.value)}
        />
        {m.tipo === 'FORM' ? (
          <Text size='sm' c='dimmed'>
            Formulario propio: las preguntas se editan en «Formularios» al agregar un material.
          </Text>
        ) : tipo === 'LINK' ? (
          <TextInput aria-label='Enlace' placeholder='https://…' value={url} onChange={(e) => setUrl(e.currentTarget.value)} />
        ) : (
          <FileInput
            label={m.tipo === 'DOCUMENT' ? `Reemplazar archivo (actual: ${m.nombreArchivo ?? 'sin nombre'})` : 'Archivo del documento'}
            placeholder='Seleccione el archivo'
            value={archivo}
            onChange={setArchivo}
            clearable
          />
        )}
        <Checkbox
          checked={obligatorio}
          onChange={(e) => setObligatorio(e.currentTarget.checked)}
          label='Obligatorio para completar el curso'
        />
        {(archivo || (tipo === 'LINK' && m.tipo === 'DOCUMENT')) && (
          <Alert color='yellow'>
            El archivo anterior se moverá a la carpeta FORMACION/ELIMINADOS de SharePoint (no se borra). Quien ya había
            completado este material conserva su avance.
          </Alert>
        )}
        <Group gap='sm'>
          <Button onClick={() => void guardar()} loading={guardando} disabled={!titulo.trim() || faltaArchivo || faltaUrl}>
            Guardar
          </Button>
          <Button variant='default' onClick={() => setEditando(false)} disabled={guardando}>
            Cancelar
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}
