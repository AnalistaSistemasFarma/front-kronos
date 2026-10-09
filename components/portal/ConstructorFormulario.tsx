'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
  List,
  NativeSelect,
  NumberInput,
  Paper,
  Radio,
  SegmentedControl,
  Stack,
  Switch,
  Text,
  TextInput,
  Textarea,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconArrowDown,
  IconArrowUp,
  IconDeviceFloppy,
  IconEye,
  IconPlus,
  IconTrash,
} from '@tabler/icons-react';
import { PUNTOS_TOTAL, redondear2, type DefinicionFormulario, type TipoFormulario, type TipoPregunta } from '../../lib/portal/formulario';
import {
  DATOS,
  construirDefinicion,
  esCalificada,
  estadoInicial,
  preguntaVacia,
  type DatoClave,
  type Estado,
  type PreguntaEditable,
} from '../../lib/portal/constructor-formulario';

/**
 * FORMACIÓN — CONSTRUCTOR MANUAL DE FORMULARIOS (Cristian Baldión, 2026-10-09).
 *
 * `Formulario` del curso → quien crea el curso elige ENCUESTA (como el
 * SST-01-FR-001) o EVALUACIÓN, y arma las preguntas a mano, sin escribir JSON.
 *
 * EVALUACIÓN: enunciado, datos de la persona (nombre, correo, cédula), preguntas
 * de selección única con la respuesta correcta marcada y puntos por pregunta;
 * los puntos deben sumar exactamente 100. El servidor califica (las correctas
 * nunca viajan al estudiante). Se puede guardar como BORRADOR (no se puede
 * responder todavía) mientras falten correctas o puntos.
 *
 * Mismos componentes de Mantine y mismo tema que el resto de SynerLink: avisos
 * con `Alert` de color ARRIBA, etiquetas arriba de cada campo, botones al pie.
 * Al EDITAR una definición existente se conservan los campos que este editor
 * no muestra (autorización de datos, "otra respuesta", ayudas, prellenado).
 */

const TIPOS_ENCUESTA: { value: TipoPregunta; label: string }[] = [
  { value: 'texto', label: 'Texto corto' },
  { value: 'texto_largo', label: 'Texto largo' },
  { value: 'numero', label: 'Número' },
  { value: 'fecha', label: 'Fecha' },
  { value: 'seleccion', label: 'Selección única' },
  { value: 'si_no', label: 'Sí / No' },
];
const TIPOS_EVALUACION: { value: TipoPregunta; label: string }[] = [
  { value: 'seleccion', label: 'Selección única (con puntos)' },
  { value: 'texto', label: 'Texto corto (dato, sin puntos)' },
  { value: 'texto_largo', label: 'Texto largo (dato, sin puntos)' },
  { value: 'numero', label: 'Número (dato, sin puntos)' },
  { value: 'fecha', label: 'Fecha (dato, sin puntos)' },
];

export function ConstructorFormulario({
  tipo,
  definicion,
  guardando,
  erroresServidor,
  onGuardar,
  onVistaPrevia,
  onCancelar,
}: {
  /** Tipo de un formulario NUEVO (se ignora al editar). */
  tipo: TipoFormulario;
  /** Presente = se está editando (guardar crea una versión nueva; el código no cambia). */
  definicion?: DefinicionFormulario;
  guardando: boolean;
  /** Errores que devolvió el servidor al guardar (arriba, en rojo). */
  erroresServidor: string[];
  onGuardar: (d: DefinicionFormulario) => void | Promise<void>;
  onVistaPrevia: (d: DefinicionFormulario) => void;
  onCancelar: () => void;
}) {
  const editando = !!definicion;
  const [e, setE] = useState<Estado>(() => estadoInicial(tipo, definicion));
  const [errores, setErrores] = useState<string[]>([]);
  const evaluacion = e.tipo === 'evaluacion';

  const suma = useMemo(
    () => redondear2(e.preguntas.reduce((s, p) => s + (esCalificada(e, p) && p.puntos !== '' ? Number(p.puntos) : 0), 0)),
    [e]
  );
  const calificadas = e.preguntas.filter((p) => esCalificada(e, p)).length;

  const cambiar = (parche: Partial<Estado>) => setE((x) => ({ ...x, ...parche }));
  const cambiarPregunta = (i: number, parche: Partial<PreguntaEditable>) =>
    setE((x) => ({ ...x, preguntas: x.preguntas.map((p, j) => (j === i ? { ...p, ...parche } : p)) }));
  const mover = (i: number, delta: -1 | 1) =>
    setE((x) => {
      const j = i + delta;
      if (j < 0 || j >= x.preguntas.length) return x;
      const copia = [...x.preguntas];
      [copia[i], copia[j]] = [copia[j], copia[i]];
      return { ...x, preguntas: copia };
    });
  const quitar = (i: number) => setE((x) => ({ ...x, preguntas: x.preguntas.filter((_, j) => j !== i) }));
  const agregar = () => setE((x) => ({ ...x, preguntas: [...x.preguntas, preguntaVacia(x.tipo, x.preguntas)] }));

  const cambiarTipoPregunta = (i: number, t: TipoPregunta) => {
    const p = e.preguntas[i];
    cambiarPregunta(i, {
      tipo: t,
      opciones: t === 'seleccion' && p.opciones.length < 2 ? [...p.opciones, ...Array(2 - p.opciones.length).fill('')] : p.opciones,
      correcta: t === 'seleccion' ? p.correcta : null,
      puntos: t === 'seleccion' ? p.puntos : '',
    });
  };

  const repartir = () => {
    const idx = e.preguntas.map((p, i) => (esCalificada(e, p) ? i : -1)).filter((i) => i >= 0);
    if (idx.length === 0) return;
    const base = Math.floor((PUNTOS_TOTAL / idx.length) * 100) / 100;
    const ultimo = redondear2(PUNTOS_TOTAL - base * (idx.length - 1));
    setE((x) => ({ ...x, preguntas: x.preguntas.map((p, i) => (idx.includes(i) ? { ...p, puntos: i === idx[idx.length - 1] ? ultimo : base } : p)) }));
  };

  const revisar = (): DefinicionFormulario | null => {
    const r = construirDefinicion(e);
    setErrores(r.errores);
    return r.definicion;
  };

  const todosLosErrores = [...errores, ...erroresServidor];

  // Los avisos van ARRIBA: al aparecer errores se lleva a la persona hasta ellos
  // (el botón Guardar está al final de un formulario largo).
  const avisoErrores = useRef<HTMLDivElement | null>(null);
  const firmaErrores = todosLosErrores.join('|');
  useEffect(() => {
    if (!firmaErrores) return;
    window.requestAnimationFrame(() => avisoErrores.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  }, [firmaErrores]);

  return (
    <Paper withBorder radius='md' p='md' data-testid='constructor-formulario'>
      <Stack gap='md'>
        {/* Resultado de la revisión ARRIBA y con color (convención del equipo). */}
        {todosLosErrores.length > 0 && (
          <Alert ref={avisoErrores} color='red' icon={<IconAlertCircle size={18} />} title='Revise el formulario' role='alert' data-testid='errores-constructor'>
            <List size='sm'>
              {todosLosErrores.map((m) => (
                <List.Item key={m}>{m}</List.Item>
              ))}
            </List>
          </Alert>
        )}

        <div>
          <Text fw={600}>{editando ? 'Editar formulario' : 'Nuevo formulario'}</Text>
          <Text size='sm' c='dimmed'>
            {editando
              ? 'Al guardar se crea una versión nueva; las respuestas ya enviadas conservan la versión con la que se respondieron.'
              : 'Elija si es una encuesta o una evaluación y arme las preguntas.'}
          </Text>
        </div>

        <SegmentedControl
          value={e.tipo}
          disabled={editando}
          fullWidth
          data={[
            { value: 'encuesta', label: 'Encuesta' },
            { value: 'evaluacion', label: 'Evaluación' },
          ]}
          onChange={(v) => {
            const t = v as TipoFormulario;
            setE((x) => ({
              ...estadoInicial(t),
              titulo: x.titulo,
              descripcion: x.descripcion,
            }));
          }}
          data-testid='tipo-formulario'
        />
        <Text size='xs' c='dimmed'>
          {evaluacion
            ? 'Evaluación: preguntas de selección única con la respuesta correcta y puntos que suman 100. El sistema califica y muestra la nota.'
            : 'Encuesta: respuestas libres o de selección, sin calificación (como el SST-01-FR-001 Perfil sociodemográfico).'}
        </Text>

        <TextInput label='Título' required value={e.titulo} maxLength={255} onChange={(ev) => cambiar({ titulo: ev.currentTarget.value })} data-testid='titulo-formulario' />
        <TextInput
          label='Código del formulario'
          description={editando ? 'El código no se puede cambiar al editar.' : 'Identifica el formulario; se genera solo y puede cambiarlo.'}
          value={e.codigo}
          maxLength={60}
          disabled={editando}
          onChange={(ev) => cambiar({ codigo: ev.currentTarget.value })}
        />
        <Textarea
          label={evaluacion ? 'Enunciado' : 'Descripción'}
          description={evaluacion ? 'Instrucciones que verá la persona antes de responder.' : 'Texto de presentación (opcional).'}
          autosize
          minRows={2}
          maxRows={8}
          maxLength={4000}
          value={e.descripcion}
          onChange={(ev) => cambiar({ descripcion: ev.currentTarget.value })}
        />

        {evaluacion && (
          <Group align='flex-end' gap='md' wrap='wrap'>
            <NumberInput
              label='Nota mínima para aprobar (%)'
              min={1}
              max={100}
              decimalScale={2}
              w={240}
              value={e.notaMinima}
              onChange={(v) => cambiar({ notaMinima: v === '' ? '' : Number(v) })}
              data-testid='nota-minima'
            />
            <Switch
              label='Guardar como borrador (todavía no se puede responder)'
              checked={e.borrador}
              onChange={(ev) => cambiar({ borrador: ev.currentTarget.checked })}
              data-testid='borrador'
            />
          </Group>
        )}

        <Checkbox.Group
          label='Datos que se piden a la persona'
          description='Se ponen al inicio del formulario. El nombre y el correo se toman de la sesión.'
          value={clavesActivas(e.datos)}
          onChange={(v) => cambiar({ datos: { nombre: v.includes('nombre'), correo: v.includes('correo'), cedula: v.includes('cedula') } })}
        >
          <Group gap='lg' mt='xs' wrap='wrap'>
            <Checkbox value='nombre' label='Nombre completo' />
            <Checkbox value='correo' label='Correo electrónico' />
            <Checkbox value='cedula' label='Número de cédula' />
          </Group>
        </Checkbox.Group>
        {e.datos.cedula && (
          <Text size='xs' c='dimmed'>
            La cédula es un dato personal: el formulario incluye el aviso de tratamiento de datos (Ley 1581 de 2012), pendiente de validación por Talento Humano o Jurídica.
          </Text>
        )}

        <Group justify='space-between' align='center' wrap='wrap'>
          <Text fw={600}>Preguntas ({e.preguntas.length})</Text>
          {evaluacion && (
            <Group gap='xs'>
              <Badge color={redondear2(suma) === PUNTOS_TOTAL ? 'green' : 'red'} variant='light' size='lg' data-testid='suma-puntos'>
                Puntos: {suma} / {PUNTOS_TOTAL}
              </Badge>
              <Button size='xs' variant='default' onClick={repartir} disabled={calificadas === 0}>
                Repartir puntos por igual
              </Button>
            </Group>
          )}
        </Group>

        {e.preguntas.map((p, i) => (
          <Paper key={p.id} withBorder radius='md' p='sm' data-testid={`pregunta-${i + 1}`}>
            <Stack gap='sm'>
              <Group justify='space-between' wrap='nowrap'>
                <Text size='sm' fw={600}>
                  Pregunta {i + 1}
                </Text>
                <Group gap={4} wrap='nowrap'>
                  <ActionIcon variant='subtle' aria-label='Subir pregunta' onClick={() => mover(i, -1)} disabled={i === 0}>
                    <IconArrowUp size={16} />
                  </ActionIcon>
                  <ActionIcon variant='subtle' aria-label='Bajar pregunta' onClick={() => mover(i, 1)} disabled={i === e.preguntas.length - 1}>
                    <IconArrowDown size={16} />
                  </ActionIcon>
                  <ActionIcon variant='subtle' color='red' aria-label='Quitar pregunta' onClick={() => quitar(i)}>
                    <IconTrash size={16} />
                  </ActionIcon>
                </Group>
              </Group>

              <Textarea
                label='Enunciado de la pregunta'
                required
                autosize
                minRows={1}
                maxRows={6}
                maxLength={500}
                value={p.texto}
                onChange={(ev) => cambiarPregunta(i, { texto: ev.currentTarget.value })}
              />

              <Group align='flex-end' gap='md' wrap='wrap'>
                <NativeSelect
                  label='Tipo de pregunta'
                  w={280}
                  value={p.tipo}
                  data={evaluacion ? TIPOS_EVALUACION : TIPOS_ENCUESTA}
                  onChange={(ev) => cambiarTipoPregunta(i, ev.currentTarget.value as TipoPregunta)}
                />
                {evaluacion && p.tipo === 'seleccion' && (
                  <NumberInput
                    label='Puntos'
                    required
                    min={0}
                    max={PUNTOS_TOTAL}
                    decimalScale={2}
                    w={140}
                    value={p.puntos}
                    onChange={(v) => cambiarPregunta(i, { puntos: v === '' ? '' : Number(v) })}
                  />
                )}
                {!esCalificada(e, p) && (
                  <Switch label='Obligatoria' checked={p.obligatoria} onChange={(ev) => cambiarPregunta(i, { obligatoria: ev.currentTarget.checked })} />
                )}
              </Group>

              {p.tipo === 'seleccion' && (
                <Stack gap='xs'>
                  <Text size='sm' fw={500}>
                    Opciones {evaluacion && <Text span size='xs' c='dimmed'>(marque la respuesta correcta)</Text>}
                  </Text>
                  {p.opciones.map((o, j) => (
                    <Group key={j} gap='xs' wrap='nowrap' align='center'>
                      {evaluacion && (
                        <Radio
                          checked={p.correcta === j}
                          onChange={() => cambiarPregunta(i, { correcta: j })}
                          aria-label={`Marcar la opción ${j + 1} como correcta`}
                          name={`correcta-${p.id}`}
                        />
                      )}
                      <Textarea
                        flex={1}
                        autosize
                        minRows={1}
                        maxRows={5}
                        aria-label={`Opción ${j + 1}`}
                        placeholder={`Opción ${j + 1}`}
                        maxLength={500}
                        value={o}
                        onChange={(ev) => cambiarPregunta(i, { opciones: p.opciones.map((x, k) => (k === j ? ev.currentTarget.value : x)) })}
                      />
                      <ActionIcon
                        variant='subtle'
                        color='red'
                        aria-label={`Quitar la opción ${j + 1}`}
                        onClick={() =>
                          cambiarPregunta(i, {
                            opciones: p.opciones.filter((_, k) => k !== j),
                            correcta: p.correcta === null ? null : p.correcta === j ? null : p.correcta > j ? p.correcta - 1 : p.correcta,
                          })
                        }
                      >
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Group>
                  ))}
                  <Group gap='md'>
                    <Button size='xs' variant='default' leftSection={<IconPlus size={14} />} onClick={() => cambiarPregunta(i, { opciones: [...p.opciones, ''] })}>
                      Agregar opción
                    </Button>
                    {!evaluacion && (
                      <Checkbox size='xs' label='Permitir "Otra respuesta"' checked={p.permiteOtra} onChange={(ev) => cambiarPregunta(i, { permiteOtra: ev.currentTarget.checked })} />
                    )}
                  </Group>
                </Stack>
              )}

              <TextInput
                label='Ayuda (opcional)'
                maxLength={1000}
                value={p.ayuda}
                onChange={(ev) => cambiarPregunta(i, { ayuda: ev.currentTarget.value })}
              />
            </Stack>
          </Paper>
        ))}

        <Group>
          <Button variant='default' leftSection={<IconPlus size={16} />} onClick={agregar} data-testid='agregar-pregunta'>
            Agregar pregunta
          </Button>
        </Group>

        <Group gap='xs' justify='flex-end' wrap='wrap'>
          <Button variant='default' onClick={onCancelar} disabled={guardando}>
            Cancelar
          </Button>
          <Button
            variant='default'
            leftSection={<IconEye size={16} />}
            disabled={guardando}
            onClick={() => {
              const d = revisar();
              if (d) onVistaPrevia(d);
            }}
          >
            Vista previa
          </Button>
          <Button
            leftSection={<IconDeviceFloppy size={16} />}
            loading={guardando}
            disabled={guardando}
            data-testid='guardar-formulario'
            onClick={() => {
              const d = revisar();
              if (d) void onGuardar(d);
            }}
          >
            {editando ? 'Guardar versión nueva' : evaluacion && e.borrador ? 'Guardar borrador' : 'Guardar formulario'}
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}

function clavesActivas(d: Record<DatoClave, boolean>): string[] {
  return (Object.keys(d) as DatoClave[]).filter((k) => d[k]);
}
