'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FileInput,
  Group,
  List,
  Loader,
  NativeSelect,
  Paper,
  Radio,
  ScrollArea,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconAlertTriangle,
  IconCircleCheck,
  IconCode,
  IconDeviceFloppy,
  IconEye,
  IconFileImport,
  IconFileSpreadsheet,
  IconInfoCircle,
  IconRotateClockwise,
  IconSearch,
  IconSend,
  IconShieldLock,
} from '@tabler/icons-react';
import { leerJson } from './PortalContenido';
import {
  OPCIONES_SI_NO,
  MENSAJE_AUTORIZACION,
  textoDeRespuesta,
  validarPregunta,
  valoresIniciales,
  type DefinicionFormulario,
  type PreguntaFormulario,
  type Respuestas,
  type ValorRespuesta,
} from '../../lib/portal/formulario';

/**
 * FORMACIÓN — FORMULARIO PROPIO del curso (Cristian Baldión, 2026-10-08).
 *
 * "toma todas las preguntas que están ahí y créame el formulario en el curso,
 * así como el enlace que te pasé, pero que sea un formulario propio del curso".
 *
 * Comportamiento confirmado por Cristian:
 *   - se abre en la MISMA ventana de vista previa de los materiales;
 *   - UN solo botón "Enviar", al final;
 *   - si faltan obligatorias: mensaje visible arriba y desplazamiento (y foco)
 *     a la PRIMERA que falte;
 *   - al enviar con éxito: confirmación "Respuestas enviadas", botón para
 *     volver al curso, y la casilla y el "Completado" del material
 *     actualizados de inmediato en la lista (lo marca el servidor).
 *
 * El correo y el nombre se prellenan desde la sesión: el nombre se puede
 * corregir; el correo no (la respuesta se guarda con el de la sesión).
 *
 * LINEAMIENTOS GRÁFICOS (Nicolás, 2026-10-08: "no lo voy a pasar si no tiene
 * los mismos lineamientos gráficos que los otros módulos"): el CONTENIDO se
 * arma con los mismos componentes de Mantine y el mismo tema que el resto de
 * SynerLink —campos como en `app/formulario-externo/[id]/page.tsx`, tabla como
 * en el Listado maestro del SGC, avisos con `Alert` de color arriba—. La
 * VENTANA es la misma `portal-th__visor` de los demás materiales de Formación
 * (Cristian pidió que el formulario se abra ahí). Nada de colores ni estilos
 * propios: el CSS que queda es solo de distribución (tamaño de la ventana y
 * zona que se desplaza).
 */

/** Respuesta de "Otra" dentro del Radio.Group (no choca con ninguna opción real). */
const VALOR_OTRA = '__otra__';

/** Correos y respuestas largas parten línea en la celda (como `NOWRAP` en el Listado maestro del SGC). */
const QUIEBRE = { overflowWrap: 'anywhere' } as const;

/** Color del `Alert` según el tipo de aviso (verde/rojo/amarillo, convención del equipo). */
const COLOR_AVISO = { ok: 'green', error: 'red', advertencia: 'yellow' } as const;
const ICONO_AVISO = {
  ok: <IconCircleCheck size={18} />,
  error: <IconAlertCircle size={18} />,
  advertencia: <IconAlertTriangle size={18} />,
} as const;

const ID_AUTORIZACION = 'autorizacion';

type Errores = Record<string, string>;

interface DatosFormulario {
  material: { id: number; titulo: string };
  formulario: { versionId: number; version: number; definicion: DefinicionFormulario };
  prellenado: { correo: string; nombre: string };
  enviadaEl: string | null;
}

const fechaLarga = (v: string) =>
  new Date(v).toLocaleString('es-CO', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Bogota' });

/* ───────────────────────────── Ventana del formulario ───────────────────────────── */

export function VisorFormulario({
  materialId,
  titulo,
  previa,
  onCerrar,
  onEnviado,
}: {
  /** Material FORM a responder. */
  materialId?: number;
  titulo: string;
  /** Vista previa del formador: la definición directamente, sin guardar nada. */
  previa?: DefinicionFormulario;
  onCerrar: () => void;
  /** Se llama apenas el servidor confirma el envío (para refrescar la lista). */
  onEnviado?: () => Promise<void> | void;
}) {
  const [datos, setDatos] = useState<DatosFormulario | null>(
    previa
      ? {
          material: { id: 0, titulo },
          formulario: { versionId: 0, version: 0, definicion: previa },
          prellenado: { correo: 'persona@empresa.com', nombre: 'Nombre de la persona' },
          enviadaEl: null,
        }
      : null
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (previa || !materialId) return;
    let vivo = true;
    void (async () => {
      try {
        const res = await fetch(`/api/portal/materials/${materialId}/formulario`, { cache: 'no-store' });
        const data = await leerJson(res);
        if (!res.ok) throw new Error(String(data?.error ?? 'No se pudo abrir el formulario.'));
        if (vivo) setDatos(data as unknown as DatosFormulario);
      } catch (e) {
        if (vivo) setError((e as Error).message);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [materialId, previa]);

  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCerrar();
    };
    window.addEventListener('keydown', alTeclear);
    return () => window.removeEventListener('keydown', alTeclear);
  }, [onCerrar]);

  return (
    <div
      className='portal-th__visor'
      role='dialog'
      aria-modal='true'
      aria-label={titulo}
      data-testid='visor-formulario'
      onClick={(e) => {
        if (e.target === e.currentTarget) onCerrar();
      }}
    >
      <div className='portal-th__visor-caja portal-th__visor-caja--formulario'>
        <header className='portal-th__visor-barra'>
          <strong>{titulo}</strong>
          <div className='portal-th__visor-acciones'>
            <button type='button' onClick={onCerrar} aria-label='Cerrar'>
              ✕
            </button>
          </div>
        </header>
        {error && (
          <Alert color='red' icon={<IconAlertCircle size={18} />} m='md' role='alert'>
            {error}
          </Alert>
        )}
        {!datos && !error && (
          <Group gap='xs' p='md'>
            <Loader size='sm' />
            <Text size='sm' c='dimmed'>
              Cargando formulario…
            </Text>
          </Group>
        )}
        {datos && (
          <CuerpoFormulario
            key={datos.formulario.versionId}
            datos={datos}
            previa={!!previa}
            onCerrar={onCerrar}
            onEnviado={onEnviado}
          />
        )}
      </div>
    </div>
  );
}

function CuerpoFormulario({
  datos,
  previa,
  onCerrar,
  onEnviado,
}: {
  datos: DatosFormulario;
  previa: boolean;
  onCerrar: () => void;
  onEnviado?: () => Promise<void> | void;
}) {
  const definicion = datos.formulario.definicion;
  const [valores, setValores] = useState<Respuestas>(() => valoresIniciales(definicion, datos.prellenado));
  const [autoriza, setAutoriza] = useState(false);
  const [errores, setErrores] = useState<Errores>({});
  const [aviso, setAviso] = useState<{ tipo: 'error' | 'ok' | 'advertencia'; texto: string } | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [enviadaEl, setEnviadaEl] = useState<string | null>(datos.enviadaEl);
  const [recienEnviada, setRecienEnviada] = useState(false);
  const desplazable = useRef<HTMLDivElement | null>(null);

  const ponerValor = (id: string, valor: ValorRespuesta) => {
    setValores((v) => ({ ...v, [id]: valor }));
    // Al corregir, el error de esa pregunta se quita sin esperar a "Enviar".
    setErrores((e) => {
      if (!e[id]) return e;
      const copia = { ...e };
      delete copia[id];
      return copia;
    });
  };

  /** Lleva a la persona a la primera pregunta con error y la enfoca. */
  const irAlPrimerError = (lista: Errores) => {
    const orden = [ID_AUTORIZACION, ...definicion.preguntas.map((p) => p.id)];
    const primero = orden.find((id) => lista[id]);
    if (!primero) return;
    // Después de pintar los mensajes de error.
    window.requestAnimationFrame(() => {
      const bloque = document.getElementById(`fp-${primero}`);
      bloque?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const campo = bloque?.querySelector<HTMLElement>('input, textarea');
      campo?.focus({ preventScroll: true });
    });
  };

  const validarTodo = (): Errores => {
    const lista: Errores = {};
    if (definicion.autorizacion && !autoriza) lista[ID_AUTORIZACION] = MENSAJE_AUTORIZACION;
    for (const p of definicion.preguntas) {
      const e = validarPregunta(p, valores[p.id]);
      if (e) lista[p.id] = e;
    }
    return lista;
  };

  const mostrarErrores = (lista: Errores) => {
    setErrores(lista);
    const n = Object.keys(lista).filter((id) => id !== ID_AUTORIZACION).length;
    const partes: string[] = [];
    if (lista[ID_AUTORIZACION]) partes.push('acepte la autorización de tratamiento de datos');
    if (n > 0) partes.push(n === 1 ? 'revise 1 pregunta' : `revise ${n} preguntas`);
    const marcadas = Object.keys(lista).length === 1 ? 'marcada en rojo' : 'marcadas en rojo';
    setAviso({ tipo: 'error', texto: `No se pudo enviar: ${partes.join(' y ')} (${marcadas}).` });
    irAlPrimerError(lista);
  };

  const enviar = async () => {
    setAviso(null);
    const lista = validarTodo();
    if (Object.keys(lista).length > 0) return mostrarErrores(lista);
    if (previa) {
      setAviso({ tipo: 'advertencia', texto: 'Vista previa: el formulario está completo. En la vista previa no se guarda nada.' });
      desplazable.current?.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setEnviando(true);
    try {
      const res = await fetch(`/api/portal/materials/${datos.material.id}/formulario`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ versionId: datos.formulario.versionId, autorizaDatos: autoriza, respuestas: valores }),
      });
      const data = await leerJson(res);
      if (res.status === 422 && Array.isArray(data?.errores)) {
        const delServidor: Errores = {};
        for (const e of data.errores as { id: string; mensaje: string }[]) delServidor[e.id] = e.mensaje;
        return mostrarErrores(delServidor);
      }
      if (!res.ok) throw new Error(String(data?.error ?? 'No se pudieron enviar las respuestas.'));
      setEnviadaEl(String(data.enviadaEl ?? new Date().toISOString()));
      setRecienEnviada(true);
      desplazable.current?.scrollTo({ top: 0 });
      // La lista del curso se actualiza de inmediato (casilla + "Completado").
      await onEnviado?.();
    } catch (e) {
      setAviso({ tipo: 'error', texto: (e as Error).message });
      desplazable.current?.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setEnviando(false);
    }
  };

  if (enviadaEl) {
    // Misma confirmación que el formulario externo de SynerLink: ícono, título y texto atenuado.
    return (
      <Stack align='center' justify='center' gap='md' p='xl' className='portal-th__formulario-fin' data-testid='formulario-enviado'>
        {recienEnviada ? (
          <>
            <IconCircleCheck size={48} color='var(--mantine-color-green-6)' aria-hidden='true' />
            <Text fw={700} fz='xl' ta='center' role='status'>
              Respuestas enviadas
            </Text>
            <Text ta='center' c='dimmed' maw={520}>
              Gracias. Sus respuestas quedaron guardadas y el material quedó completado.
            </Text>
          </>
        ) : (
          <>
            <IconInfoCircle size={48} color='var(--mantine-color-blue-6)' aria-hidden='true' />
            <Text fw={700} fz='xl' ta='center'>
              Ya envió este formulario
            </Text>
            <Text ta='center' c='dimmed' maw={520}>
              Lo envió el {fechaLarga(enviadaEl)}. Las respuestas no se pueden modificar; si necesita corregir algo, pida a Talento Humano que lo reabra.
            </Text>
          </>
        )}
        <Button onClick={onCerrar}>Volver al curso</Button>
      </Stack>
    );
  }

  const errorAutorizacion = errores[ID_AUTORIZACION];

  return (
    <div className='portal-th__formulario' ref={desplazable} data-testid='formulario-propio'>
      {/* Aviso de resultado ARRIBA, con color y pegado mientras se baja (convención del equipo). */}
      {aviso && (
        <Alert
          className='portal-th__formulario-aviso'
          color={COLOR_AVISO[aviso.tipo]}
          icon={ICONO_AVISO[aviso.tipo]}
          role={aviso.tipo === 'error' ? 'alert' : 'status'}
          data-testid='aviso-formulario'
        >
          {aviso.texto}
        </Alert>
      )}
      <Stack gap='md' p='md'>
        {previa && (
          <Alert color='blue' icon={<IconEye size={18} />}>
            Vista previa del formador: puede llenarlo para probarlo; no se guarda nada.
          </Alert>
        )}

        <div>
          <Text fw={700} fz='xl' role='heading' aria-level={3}>
            {definicion.titulo}
          </Text>
          {definicion.descripcion && (
            <Text size='sm' c='dimmed' mt={4}>
              {definicion.descripcion}
            </Text>
          )}
          <Text size='xs' c='dimmed' mt={4}>
            Los campos marcados con{' '}
            <Text span c='red' inherit>
              *
            </Text>{' '}
            son obligatorios.
          </Text>
        </div>

        {definicion.autorizacion && (
          <Paper
            withBorder
            radius='md'
            p='md'
            component='section'
            id={`fp-${ID_AUTORIZACION}`}
            className={errorAutorizacion ? 'portal-th__formulario-pregunta--error' : undefined}
            aria-labelledby='fp-autorizacion-titulo'
          >
            <Stack gap='sm'>
              <Text id='fp-autorizacion-titulo' fw={600} role='heading' aria-level={4}>
                {definicion.autorizacion.titulo}
              </Text>
              {definicion.autorizacion.pendienteValidacion && (
                <Alert color='yellow' icon={<IconAlertTriangle size={18} />} p='xs' data-testid='autorizacion-pendiente'>
                  Texto pendiente de validación por Talento Humano o Jurídica
                </Alert>
              )}
              <ScrollArea.Autosize mah={220} type='auto' offsetScrollbars>
                <Stack gap='xs'>
                  {definicion.autorizacion.texto.map((p, i) => (
                    <Text key={i} size='sm' c='dimmed'>
                      {p}
                    </Text>
                  ))}
                </Stack>
              </ScrollArea.Autosize>
              <Checkbox
                checked={autoriza}
                aria-required='true'
                error={errorAutorizacion || undefined}
                label={
                  <>
                    {definicion.autorizacion.casilla}{' '}
                    <Text span c='red' inherit aria-hidden='true'>
                      *
                    </Text>
                  </>
                }
                onChange={(e) => {
                  setAutoriza(e.currentTarget.checked);
                  if (e.currentTarget.checked) setErrores((x) => ({ ...x, [ID_AUTORIZACION]: '' }));
                }}
              />
            </Stack>
          </Paper>
        )}

        <Paper withBorder radius='md' p='md'>
          <Stack gap='lg'>
            {definicion.preguntas.map((p, i) => (
              <CampoPregunta
                key={p.id}
                numero={i + 1}
                pregunta={p}
                valor={valores[p.id]}
                error={errores[p.id]}
                soloLectura={p.prellenar === 'correo'}
                onCambio={(v) => ponerValor(p.id, v)}
              />
            ))}
          </Stack>
        </Paper>

        <Group justify='flex-end'>
          <Button
            onClick={() => void enviar()}
            loading={enviando}
            disabled={enviando}
            leftSection={<IconSend size={16} />}
            data-testid='enviar-formulario'
          >
            Enviar
          </Button>
        </Group>
      </Stack>
    </div>
  );
}

function CampoPregunta({
  numero,
  pregunta: p,
  valor,
  error,
  soloLectura,
  onCambio,
}: {
  numero: number;
  pregunta: PreguntaFormulario;
  valor: ValorRespuesta | undefined;
  error?: string;
  soloLectura: boolean;
  onCambio: (v: ValorRespuesta) => void;
}) {
  const texto = typeof valor === 'string' ? valor : '';
  const opciones = p.tipo === 'si_no' ? [...OPCIONES_SI_NO] : (p.opciones ?? []);
  const esOtra = typeof valor === 'object' && valor !== null;
  // Mismo patrón de campo que el resto de SynerLink: etiqueta arriba, asterisco
  // rojo si es obligatoria, ayuda como descripción y error en rojo debajo.
  // `size='md'` en los campos de texto (16 px): con menos, Safari en iPhone
  // hace zoom al enfocar — mismo arreglo que en /login (ver globals.css).
  const comun = {
    label: `${numero}. ${p.texto}`,
    description: p.ayuda,
    required: p.obligatoria,
    error,
  };

  return (
    <Box id={`fp-${p.id}`} className={`portal-th__formulario-pregunta${error ? ' portal-th__formulario-pregunta--error' : ''}`}>
      {p.tipo === 'seleccion' || p.tipo === 'si_no' ? (
        <Radio.Group
          {...comun}
          size='md'
          name={`fp-${p.id}`}
          value={esOtra ? VALOR_OTRA : texto}
          onChange={(v) => {
            if (v === VALOR_OTRA) onCambio({ otra: esOtra ? (valor as { otra: string }).otra : '' });
            else onCambio(v);
          }}
        >
          <Stack gap='xs' mt='xs'>
            {opciones.map((o) => (
              <Radio key={o} value={o} label={o} size='sm' />
            ))}
            {p.permiteOtra && (
              <Group gap='sm' wrap='wrap' align='center'>
                <Radio value={VALOR_OTRA} label='Otra respuesta' size='sm' />
                <TextInput
                  aria-label={`${p.texto}: otra respuesta`}
                  placeholder='Otras'
                  maxLength={2000}
                  size='md'
                  flex='1 1 160px'
                  value={esOtra ? (valor as { otra: string }).otra : ''}
                  onFocus={() => {
                    if (!esOtra) onCambio({ otra: '' });
                  }}
                  onChange={(e) => onCambio({ otra: e.currentTarget.value })}
                />
              </Group>
            )}
          </Stack>
        </Radio.Group>
      ) : p.tipo === 'texto_largo' ? (
        <Textarea
          {...comun}
          size='md'
          autosize
          minRows={3}
          maxRows={8}
          maxLength={4000}
          placeholder='Escriba su respuesta'
          value={texto}
          onChange={(e) => onCambio(e.currentTarget.value)}
        />
      ) : (
        <TextInput
          {...comun}
          size='md'
          type={p.tipo === 'fecha' ? 'date' : 'text'}
          inputMode={p.tipo === 'numero' ? 'decimal' : p.prellenar === 'correo' ? 'email' : undefined}
          autoComplete={p.prellenar === 'correo' ? 'email' : p.prellenar === 'nombre' ? 'name' : 'off'}
          placeholder={p.tipo === 'fecha' ? undefined : 'Escriba su respuesta'}
          maxLength={2000}
          readOnly={soloLectura}
          variant={soloLectura ? 'filled' : 'default'}
          title={soloLectura ? 'Se toma del correo con el que ingresó al portal' : undefined}
          value={texto}
          onChange={(e) => onCambio(e.currentTarget.value)}
        />
      )}
    </Box>
  );
}

/* ─────────────────────── Respuestas (administradores/formadores) ─────────────────────── */

interface TablaRespuestas {
  curso: { id: number; titulo: string };
  material: { id: number; titulo: string };
  formulario: { codigo: string; titulo: string; version: number };
  columnas: { id: string; texto: string }[];
  filas: { id: number; correo: string; enviadaEl: string; version: number; autorizacionVersion: string | null; respuestas: Respuestas }[];
}

/**
 * Tabla de respuestas de UN material formulario, con exportación a Excel y
 * "Reabrir". Solo la ve quien esté en ADMINISTRADORES/FORMADORES del Excel de
 * permisos — el servidor lo vuelve a exigir en cada ruta (403).
 */
export function PanelRespuestas({ materialId, titulo, onCerrar, onCambio }: { materialId: number; titulo: string; onCerrar: () => void; onCambio?: () => Promise<void> | void }) {
  const [tabla, setTabla] = useState<TablaRespuestas | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [filtro, setFiltro] = useState('');

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/portal/materials/${materialId}/respuestas`, { cache: 'no-store' });
      const data = await leerJson(res);
      if (!res.ok) throw new Error(String(data?.error ?? 'No se pudieron cargar las respuestas.'));
      setTabla(data as unknown as TablaRespuestas);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [materialId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCerrar();
    };
    window.addEventListener('keydown', alTeclear);
    return () => window.removeEventListener('keydown', alTeclear);
  }, [onCerrar]);

  const reabrir = async (fila: TablaRespuestas['filas'][number]) => {
    if (
      !window.confirm(
        `¿Reabrir el formulario de ${fila.correo}? Se borran sus respuestas y la marca de completado de este material, y la persona deberá responderlo de nuevo.`
      )
    )
      return;
    setAviso(null);
    try {
      const res = await fetch(`/api/portal/materials/${materialId}/respuestas/${fila.id}`, { method: 'DELETE' });
      const data = await leerJson(res);
      if (!res.ok) throw new Error(String(data?.error ?? 'No se pudo reabrir.'));
      setAviso(`Formulario reabierto para ${fila.correo}.`);
      await cargar();
      await onCambio?.();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const filas = useMemo(() => {
    const f = filtro.trim().toLowerCase();
    if (!tabla || !f) return tabla?.filas ?? [];
    return tabla.filas.filter((x) =>
      [x.correo, ...Object.values(x.respuestas).map((v) => textoDeRespuesta(v))].some((t) => t.toLowerCase().includes(f))
    );
  }, [tabla, filtro]);

  return (
    <div
      className='portal-th__visor'
      role='dialog'
      aria-modal='true'
      aria-label={`Respuestas: ${titulo}`}
      data-testid='panel-respuestas'
      onClick={(e) => {
        if (e.target === e.currentTarget) onCerrar();
      }}
    >
      <div className='portal-th__visor-caja portal-th__visor-caja--respuestas'>
        <header className='portal-th__visor-barra'>
          <strong>Respuestas · {titulo}</strong>
          <div className='portal-th__visor-acciones'>
            <button type='button' onClick={onCerrar} aria-label='Cerrar'>
              ✕
            </button>
          </div>
        </header>
        {/* Resultado de "Reabrir" ARRIBA y con color (convención del equipo). */}
        {(error || aviso) && (
          <Stack gap='xs' px='md' pt='md'>
            {error && (
              <Alert color='red' icon={<IconAlertCircle size={18} />} role='alert'>
                {error}
              </Alert>
            )}
            {aviso && (
              <Alert color='green' icon={<IconCircleCheck size={18} />} role='status'>
                {aviso}
              </Alert>
            )}
          </Stack>
        )}
        {/* Barra como en el Listado maestro del SGC: buscador con ícono, conteo atenuado y acción principal. */}
        <Group gap='sm' p='md' wrap='wrap' align='center'>
          <TextInput
            type='search'
            aria-label='Buscar en las respuestas'
            placeholder='Buscar por correo o respuesta'
            leftSection={<IconSearch size={16} />}
            size='md'
            value={filtro}
            onChange={(e) => setFiltro(e.currentTarget.value)}
            flex='1 1 240px'
          />
          <Button
            component='a'
            href={`/api/portal/materials/${materialId}/respuestas/excel`}
            leftSection={<IconFileSpreadsheet size={16} />}
            data-testid='exportar-excel'
          >
            Exportar a Excel
          </Button>
        </Group>
        <Stack gap='xs' px='md'>
          <Alert color='yellow' icon={<IconShieldLock size={18} />} p='xs'>
            Datos personales sensibles (Ley 1581 de 2012): uso exclusivo de Talento Humano y del SG-SST. No los reenvíe ni los publique.
          </Alert>
          <Text size='sm' c='dimmed' data-testid='conteo-respuestas'>
            {tabla ? `${tabla.filas.length} respuesta(s) · ${tabla.curso.titulo}` : 'Cargando…'}
          </Text>
        </Stack>
        <ScrollArea flex={1} mih={0} type='auto' px='md' pb='md'>
          {tabla && tabla.filas.length === 0 ? (
            <Text c='dimmed' ta='center' my='xl'>
              Todavía nadie ha enviado este formulario.
            </Text>
          ) : (
            tabla && (
              <Table
                striped
                highlightOnHover
                stickyHeader
                verticalSpacing='sm'
                miw={(tabla.columnas.length + 3) * 160}
                data-testid='tabla-respuestas'
              >
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th miw={200}>Correo</Table.Th>
                    <Table.Th miw={160}>Enviado</Table.Th>
                    {tabla.columnas.map((c, i) => (
                      <Table.Th key={c.id} title={`${i + 1}. ${c.texto}`} miw={140} maw={280}>
                        <Text inherit lineClamp={3}>
                          {i + 1}. {c.texto}
                        </Text>
                      </Table.Th>
                    ))}
                    <Table.Th>Acciones</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {filas.map((f) => (
                    <Table.Tr key={f.id}>
                      <Table.Td style={QUIEBRE}>{f.correo}</Table.Td>
                      <Table.Td>{fechaLarga(f.enviadaEl)}</Table.Td>
                      {tabla.columnas.map((c) => (
                        <Table.Td key={c.id} maw={280} style={QUIEBRE}>
                          {textoDeRespuesta(f.respuestas[c.id])}
                        </Table.Td>
                      ))}
                      <Table.Td>
                        <Button
                          size='xs'
                          variant='light'
                          color='red'
                          leftSection={<IconRotateClockwise size={14} />}
                          onClick={() => void reabrir(f)}
                        >
                          Reabrir
                        </Button>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            )
          )}
        </ScrollArea>
      </div>
    </div>
  );
}

/* ─────────────────────────── Formador: elegir / importar / editar ─────────────────────────── */

export interface FormularioResumen {
  id: number;
  codigo: string;
  titulo: string;
  version: number;
  materiales: number;
}

/**
 * Selector de formulario para un material nuevo tipo "Formulario", con
 * IMPORTAR (archivo .json o pegado), VISTA PREVIA y EDITAR (el JSON de la
 * definición; guardar crea una versión nueva). El editor visual pregunta por
 * pregunta queda para una entrega posterior.
 */
export function SelectorFormulario({
  valor,
  onCambio,
}: {
  valor: number | null;
  onCambio: (id: number | null, titulo: string) => void;
}) {
  const [lista, setLista] = useState<FormularioResumen[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ modo: 'importar' | 'editar'; texto: string; id?: number } | null>(null);
  const [erroresJson, setErroresJson] = useState<string[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [previa, setPrevia] = useState<DefinicionFormulario | null>(null);

  const cargar = useCallback(async (): Promise<FormularioResumen[]> => {
    try {
      const res = await fetch('/api/portal/formularios', { cache: 'no-store' });
      const data = await leerJson(res);
      if (!res.ok) throw new Error(String(data?.error ?? 'No se pudieron cargar los formularios.'));
      const l = Array.isArray(data.formularios) ? (data.formularios as FormularioResumen[]) : [];
      setLista(l);
      return l;
    } catch (e) {
      setError((e as Error).message);
      return [];
    }
  }, []);

  useEffect(() => {
    void cargar().then((l) => {
      if (valor === null && l.length > 0) onCambio(l[0].id, l[0].titulo);
    });
    // Solo al montar: elegir el primero por defecto.
  }, []);

  const definicionDe = async (id: number): Promise<DefinicionFormulario | null> => {
    const res = await fetch(`/api/portal/formularios/${id}`, { cache: 'no-store' });
    const data = await leerJson(res);
    if (!res.ok) {
      setError(String(data?.error ?? 'No se pudo cargar el formulario.'));
      return null;
    }
    return (data.formulario as { definicion: DefinicionFormulario }).definicion;
  };

  const verPrevia = async () => {
    if (!valor) return;
    setError(null);
    const d = await definicionDe(valor);
    if (d) setPrevia(d);
  };

  const empezarEdicion = async () => {
    if (!valor) return;
    setError(null);
    const d = await definicionDe(valor);
    if (d) setEditor({ modo: 'editar', id: valor, texto: JSON.stringify(d, null, 2) });
  };

  const guardar = async () => {
    if (!editor) return;
    setGuardando(true);
    setErroresJson([]);
    setError(null);
    try {
      const res = await fetch(editor.modo === 'importar' ? '/api/portal/formularios' : `/api/portal/formularios/${editor.id}`, {
        method: editor.modo === 'importar' ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: editor.texto,
      });
      const data = await leerJson(res);
      if (!res.ok) {
        setErroresJson(Array.isArray(data?.errores) ? (data.errores as string[]) : []);
        throw new Error(String(data?.error ?? 'No se pudo guardar.'));
      }
      const f = data.formulario as { id: number; titulo: string; version: number };
      setAviso(editor.modo === 'importar' ? `Formulario importado: ${f.titulo}.` : `Versión ${f.version} guardada: ${f.titulo}.`);
      setEditor(null);
      await cargar();
      onCambio(f.id, f.titulo);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  };

  return (
    // Dentro de la fila "Agregar material" de Formación; los controles son los de
    // Mantine que usa el resto de SynerLink (`.portal-th__mantine` aísla los
    // estilos de etiqueta de esa fila — ver globals.css).
    <Stack gap='sm' w='100%' className='portal-th__mantine' data-testid='selector-formulario'>
      {/* Resultado de importar/guardar ARRIBA y con color (convención del equipo). */}
      {aviso && (
        <Alert color='green' icon={<IconCircleCheck size={18} />} role='status'>
          {aviso}
        </Alert>
      )}
      {error && (
        <Alert color='red' icon={<IconAlertCircle size={18} />} role='alert'>
          {error}
        </Alert>
      )}
      {lista && lista.length === 0 && (
        <Text size='sm' c='dimmed'>
          Todavía no hay formularios: importe uno.
        </Text>
      )}
      {lista && lista.length > 0 && (
        // Selector nativo de Mantine: en el celular abre la lista del sistema
        // (mismo criterio que `SgcSelect` para el toque).
        <NativeSelect
          label='Formulario'
          value={valor === null ? '' : String(valor)}
          data={lista.map((f) => ({ value: String(f.id), label: `${f.titulo} · v${f.version}` }))}
          onChange={(e) => {
            const f = lista.find((x) => x.id === Number(e.currentTarget.value));
            onCambio(f ? f.id : null, f?.titulo ?? '');
          }}
        />
      )}
      <Group gap='xs' wrap='wrap'>
        <Button variant='default' leftSection={<IconEye size={16} />} onClick={() => void verPrevia()} disabled={!valor}>
          Vista previa
        </Button>
        <Button variant='default' leftSection={<IconCode size={16} />} onClick={() => void empezarEdicion()} disabled={!valor}>
          Editar (JSON)
        </Button>
        <Button
          variant='default'
          leftSection={<IconFileImport size={16} />}
          onClick={() => {
            setErroresJson([]);
            setEditor({ modo: 'importar', texto: '' });
          }}
        >
          Importar formulario
        </Button>
      </Group>
      {editor && (
        <Paper withBorder radius='md' p='md'>
          <Stack gap='sm'>
            <Text size='sm' c='dimmed'>
              {editor.modo === 'importar'
                ? 'Pegue la definición JSON del formulario o cárguela desde un archivo .json.'
                : 'Al guardar se crea una versión nueva; las respuestas ya enviadas conservan la versión con la que se respondieron.'}
            </Text>
            {erroresJson.length > 0 && (
              <Alert color='red' icon={<IconAlertCircle size={18} />} title='Revise la definición'>
                <List size='sm'>
                  {erroresJson.map((e) => (
                    <List.Item key={e}>{e}</List.Item>
                  ))}
                </List>
              </Alert>
            )}
            {editor.modo === 'importar' && (
              <FileInput
                label='Archivo JSON del formulario'
                placeholder='Elegir archivo .json'
                accept='application/json,.json'
                leftSection={<IconFileImport size={16} />}
                clearable
                onChange={async (archivo) => {
                  if (archivo) setEditor({ modo: 'importar', texto: await archivo.text() });
                }}
              />
            )}
            <Textarea
              label='Definición JSON del formulario'
              autosize
              minRows={12}
              maxRows={24}
              spellCheck={false}
              ff='monospace'
              value={editor.texto}
              onChange={(e) => setEditor({ ...editor, texto: e.currentTarget.value })}
            />
            <Group gap='xs' justify='flex-end' wrap='wrap'>
              <Button variant='default' onClick={() => setEditor(null)} disabled={guardando}>
                Cancelar
              </Button>
              <Button
                variant='default'
                leftSection={<IconEye size={16} />}
                disabled={!editor.texto.trim()}
                onClick={() => {
                  try {
                    setPrevia(JSON.parse(editor.texto) as DefinicionFormulario);
                    setErroresJson([]);
                  } catch {
                    setErroresJson(['JSON mal formado.']);
                  }
                }}
              >
                Vista previa del JSON
              </Button>
              <Button
                leftSection={editor.modo === 'importar' ? <IconFileImport size={16} /> : <IconDeviceFloppy size={16} />}
                onClick={() => void guardar()}
                loading={guardando}
                disabled={guardando || !editor.texto.trim()}
              >
                {editor.modo === 'importar' ? 'Importar' : 'Guardar versión nueva'}
              </Button>
            </Group>
          </Stack>
        </Paper>
      )}
      {previa && Array.isArray(previa.preguntas) && (
        <VisorFormulario titulo={`Vista previa · ${previa.titulo ?? ''}`} previa={previa} onCerrar={() => setPrevia(null)} />
      )}
    </Stack>
  );
}

/** Vista previa de un material formulario ya agregado (vista formador). */
export function PreviaDeMaterialFormulario({ formularioId, titulo, onCerrar }: { formularioId: number; titulo: string; onCerrar: () => void }) {
  const [definicion, setDefinicion] = useState<DefinicionFormulario | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void (async () => {
      const res = await fetch(`/api/portal/formularios/${formularioId}`, { cache: 'no-store' });
      const data = await leerJson(res);
      if (!res.ok) setError(String(data?.error ?? 'No se pudo cargar el formulario.'));
      else setDefinicion((data.formulario as { definicion: DefinicionFormulario }).definicion);
    })();
  }, [formularioId]);
  if (error) {
    return (
      <Alert color='red' icon={<IconAlertCircle size={18} />} role='alert' mb='sm'>
        {error}
      </Alert>
    );
  }
  if (!definicion) return null;
  return <VisorFormulario titulo={`Vista previa · ${titulo}`} previa={definicion} onCerrar={onCerrar} />;
}
