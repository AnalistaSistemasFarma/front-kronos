'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  FileInput,
  Group,
  Modal,
  NumberInput,
  Pagination,
  ScrollArea,
  SegmentedControl,
  Skeleton,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import {
  IconArchive,
  IconArrowBackUp,
  IconArrowDown,
  IconArrowUp,
  IconDeviceFloppy,
  IconDownload,
  IconFileSpreadsheet,
  IconHistory,
  IconListDetails,
  IconMaximize,
  IconMinimize,
  IconPencil,
  IconPlus,
  IconSearch,
  IconTrash,
  IconUpload,
  IconX,
} from '@tabler/icons-react';
import type { ProyectoDetalleDto } from '../../../lib/proyectos/tipos';
import { apiGet, apiSend, fechaCorta } from '../api';
import { ConfirmarModal } from '../modales';
import type { Aviso } from '../ui';

/**
 * Sección «Matrices» de un proyecto (2026-11-05; pedido de Comex: «un Excel integrado»
 * que los agentes del proyecto puedan tomar para analizar). Diseño:
 * docs/proyectos-matrices-dashboards.md.
 *
 *   - Subir un Excel o CSV: SynerLink lo lee y lo guarda como tabla (hojas, columnas con tipo).
 *   - Grilla: buscar, ordenar y paginar; descargar en Excel; historial de versiones; ficha.
 *   - PANTALLA COMPLETA y EDICIÓN dentro de SynerLink (Nicolás Rivera, 2026-11-05: «para que
 *     no tengan que hacer cosas por fuera del Excel»): doble clic en una celda para cambiarla,
 *     agregar y borrar filas; «Guardar» crea una VERSIÓN nueva (queda el historial).
 *   - Permisos del proyecto: ven todos los miembros; suben, editan y archivan dueño y editores.
 *   - Los agentes del proyecto la reciben como CSV + ficha en su carpeta de archivos.
 */

type Tipo = 'texto' | 'numero' | 'fecha' | 'booleano';
type Celda = string | number | boolean | null;

interface MatrizResumen {
  idMatrix: number;
  nombre: string;
  descripcion: string | null;
  version: number;
  archivo: string | null;
  actualizada: string;
  subidaPor: string | null;
  hojas: { idSheet: number; nombre: string; filas: number; columnas: number }[];
}

interface Detalle {
  idMatrix: number;
  nombre: string;
  descripcion: string | null;
  idVersion: number | null;
  idVersionActual: number | null;
  versiones: { idVersion: number; version: number; archivo: string; subidaPor: string | null; resumen: string | null; fecha: string }[];
  hojas: { idSheet: number; nombre: string; filas: number }[];
  hoja: { idSheet: number; nombre: string; filaEncabezados: number } | null;
  columnas: { nombre: string; tipo: Tipo }[];
  ficha: { nombre: string; tipo: Tipo; vacias: number; distintos: number; min?: number | string; max?: number | string; suma?: number }[];
  total: number;
  filas: Celda[][];
  indices: number[];
  pagina: number;
  porPagina: number;
}

const ETIQUETA_TIPO: Record<Tipo, string> = { texto: 'Texto', numero: 'Número', fecha: 'Fecha (AAAA-MM-DD)', booleano: 'Sí/No' };

function formatoCelda(v: Celda, tipo: Tipo): string {
  if (v === null) return '';
  if (typeof v === 'number') return tipo === 'numero' ? v.toLocaleString('es-CO', { maximumFractionDigits: 4 }) : String(v);
  if (typeof v === 'boolean') return v ? 'Sí' : 'No';
  return v;
}

/** Texto para editar una celda (sin separadores de miles, para no confundir el número). */
function textoEditable(v: Celda): string {
  if (v === null) return '';
  if (typeof v === 'boolean') return v ? 'Sí' : 'No';
  return String(v);
}

const clave = (fila: number, col: number) => `${fila}:${col}`;

export default function SeccionMatrices({ proyecto, version, avisar }: { proyecto: ProyectoDetalleDto; version: number; avisar: (a: Aviso) => void }) {
  const base = `/api/proyectos/${proyecto.idProject}/matrices`;
  const puedeSubir = proyecto.capabilities.contribute && !proyecto.archived;
  const [matrices, setMatrices] = useState<MatrizResumen[] | null>(null);
  const [abierta, setAbierta] = useState<number | null>(null);
  const [detalle, setDetalle] = useState<Detalle | null>(null);
  const [cargando, setCargando] = useState(false);
  const [hoja, setHoja] = useState(0);
  const [verVersion, setVerVersion] = useState<number | null>(null);
  const [q, setQ] = useState('');
  const [qDeb] = useDebouncedValue(q, 350);
  const [orden, setOrden] = useState<{ col: number; desc: boolean } | null>(null);
  const [pagina, setPagina] = useState(1);
  const [vista, setVista] = useState<'datos' | 'ficha' | 'versiones'>('datos');
  const [subir, setSubir] = useState<{ idMatrix: number | null } | null>(null);
  const [archivar, setArchivar] = useState(false);
  const [completa, setCompleta] = useState(false);

  // Edición (todo local hasta «Guardar»): celdas cambiadas, filas nuevas y filas borradas.
  const [editando, setEditando] = useState(false);
  const [cambios, setCambios] = useState<Map<string, string>>(new Map());
  const [nuevas, setNuevas] = useState<string[][]>([]);
  const [borrar, setBorrar] = useState<Set<number>>(new Set());
  const [celda, setCelda] = useState<{ fila: number; col: number; valor: string } | null>(null);
  const [guardando, setGuardando] = useState(false);
  const pendientes = cambios.size + nuevas.filter((f) => f.some((v) => v.trim())).length + borrar.size;

  const descartar = () => {
    setCambios(new Map());
    setNuevas([]);
    setBorrar(new Set());
    setCelda(null);
  };

  const cargar = useCallback(async () => {
    const r = await apiGet<{ matrices: MatrizResumen[] }>(base, 'No se pudieron cargar las matrices.');
    if (r.ok) {
      setMatrices(r.data.matrices);
      setAbierta((a) => (a && r.data.matrices.some((m) => m.idMatrix === a) ? a : (r.data.matrices[0]?.idMatrix ?? null)));
    } else if (r.error) avisar({ tipo: 'error', texto: r.error });
  }, [base, avisar]);

  useEffect(() => {
    void cargar();
  }, [cargar, version]);

  const cargarDetalle = useCallback(async () => {
    if (abierta === null) return setDetalle(null);
    setCargando(true);
    const p = new URLSearchParams({ hoja: String(hoja), pagina: String(pagina), porPagina: completa ? '200' : '100' });
    if (qDeb.trim()) p.set('q', qDeb.trim());
    if (orden) {
      p.set('orden', String(orden.col));
      if (orden.desc) p.set('desc', '1');
    }
    if (verVersion) p.set('version', String(verVersion));
    const r = await apiGet<{ matriz: Detalle }>(`${base}/${abierta}?${p}`, 'No se pudo cargar la matriz.');
    setCargando(false);
    if (r.ok) setDetalle(r.data.matriz);
    else if (r.error) avisar({ tipo: 'error', texto: r.error });
  }, [abierta, base, hoja, pagina, qDeb, orden, verVersion, completa, avisar]);

  useEffect(() => {
    void cargarDetalle();
  }, [cargarDetalle]);

  const abrir = (id: number) => {
    setAbierta(id);
    setHoja(0);
    setPagina(1);
    setQ('');
    setOrden(null);
    setVerVersion(null);
    setVista('datos');
    setEditando(false);
    descartar();
  };

  const guardarEdicion = async () => {
    if (!detalle || abierta === null || pendientes === 0) return;
    setGuardando(true);
    const r = await apiSend<{ versionNo: number; resumen: string }>(
      'POST',
      `${base}/${abierta}/editar`,
      {
        idVersionBase: detalle.idVersionActual,
        hoja,
        cambios: [...cambios.entries()].map(([k, valor]) => {
          const [fila, col] = k.split(':').map(Number);
          return { fila, col, valor };
        }),
        nuevas: nuevas.filter((f) => f.some((v) => v.trim())),
        borrar: [...borrar],
      },
      'No se pudieron guardar los cambios.'
    );
    setGuardando(false);
    if (!r.ok) return avisar({ tipo: 'error', texto: r.error });
    avisar({ tipo: 'ok', texto: `Cambios guardados como versión ${r.data.versionNo}. ${r.data.resumen}` });
    descartar();
    setEditando(false);
    await Promise.all([cargar(), cargarDetalle()]);
  };

  const confirmarCelda = (siguiente?: { fila: number; col: number } | null) => {
    if (!celda || !detalle) return;
    const pos = detalle.indices.indexOf(celda.fila);
    const original = pos >= 0 ? textoEditable(detalle.filas[pos][celda.col] ?? null) : '';
    setCambios((prev) => {
      const n = new Map(prev);
      if (celda.valor === original) n.delete(clave(celda.fila, celda.col));
      else n.set(clave(celda.fila, celda.col), celda.valor);
      return n;
    });
    if (siguiente) {
      const p2 = detalle.indices.indexOf(siguiente.fila);
      const ya = cambios.get(clave(siguiente.fila, siguiente.col));
      setCelda({ ...siguiente, valor: ya ?? (p2 >= 0 ? textoEditable(detalle.filas[p2][siguiente.col] ?? null) : '') });
    } else setCelda(null);
  };

  const editarCelda = (fila: number, col: number, v: Celda) => {
    if (!editando) return;
    const ya = cambios.get(clave(fila, col));
    setCelda({ fila, col, valor: ya ?? textoEditable(v) });
  };

  const actual = matrices?.find((m) => m.idMatrix === abierta) ?? null;
  const vigente = !!detalle && (verVersion === null || verVersion === detalle.idVersionActual);
  const puedeEditar = puedeSubir && vigente && vista === 'datos';

  const encabezado = useMemo(() => {
    if (!actual) return null;
    return (
      <Group justify='space-between' align='flex-start' wrap='nowrap'>
        <div style={{ minWidth: 0 }}>
          <Text fw={600}>{actual.nombre}</Text>
          <Text size='xs' c='dimmed'>
            Versión {actual.version} · {actual.archivo} · {fechaCorta(actual.actualizada)}
            {actual.subidaPor ? ` · ${actual.subidaPor}` : ''}
          </Text>
          {actual.descripcion && (
            <Text size='sm' mt={4}>
              {actual.descripcion}
            </Text>
          )}
        </div>
        <Group gap={6} wrap='nowrap'>
          {puedeEditar && !editando && (
            <Button size='xs' variant='light' leftSection={<IconPencil size={14} />} onClick={() => setEditando(true)} data-testid='matriz-editar'>
              Editar
            </Button>
          )}
          <Tooltip label={completa ? 'Salir de pantalla completa' : 'Pantalla completa'}>
            <ActionIcon variant='light' onClick={() => setCompleta((c) => !c)} aria-label='Pantalla completa' data-testid='matriz-completa'>
              {completa ? <IconMinimize size={16} /> : <IconMaximize size={16} />}
            </ActionIcon>
          </Tooltip>
          <Tooltip label='Descargar en Excel'>
            <ActionIcon
              variant='light'
              component='a'
              href={`${base}/${actual.idMatrix}/excel${verVersion ? `?version=${verVersion}` : ''}`}
              aria-label='Descargar en Excel'
            >
              <IconDownload size={16} />
            </ActionIcon>
          </Tooltip>
          {puedeSubir && !editando && (
            <>
              <Button size='xs' variant='light' leftSection={<IconUpload size={14} />} onClick={() => setSubir({ idMatrix: actual.idMatrix })}>
                Nueva versión
              </Button>
              <Tooltip label='Archivar matriz'>
                <ActionIcon variant='subtle' color='red' onClick={() => setArchivar(true)} aria-label='Archivar matriz'>
                  <IconArchive size={16} />
                </ActionIcon>
              </Tooltip>
            </>
          )}
        </Group>
      </Group>
    );
  }, [actual, puedeEditar, editando, completa, base, verVersion, puedeSubir]);

  if (matrices === null) return <Skeleton h={160} radius='md' />;

  const barraEdicion = editando && (
    <Alert color={pendientes > 0 ? 'yellow' : 'blue'} variant='light' p='xs'>
      <Group justify='space-between' wrap='wrap' gap='xs'>
        <Text size='sm'>
          {pendientes > 0
            ? `${pendientes} ${pendientes === 1 ? 'cambio sin guardar' : 'cambios sin guardar'}. Al guardar queda una versión nueva.`
            : 'Modo edición: doble clic en una celda para cambiarla (Enter guarda, Tab pasa a la siguiente, Esc cancela).'}
        </Text>
        <Group gap={6}>
          <Button
            size='xs'
            variant='default'
            leftSection={pendientes > 0 ? <IconArrowBackUp size={14} /> : <IconX size={14} />}
            onClick={() => {
              descartar();
              setEditando(false);
            }}
          >
            {pendientes > 0 ? 'Descartar' : 'Salir de edición'}
          </Button>
          <Button size='xs' leftSection={<IconDeviceFloppy size={14} />} disabled={pendientes === 0} loading={guardando} onClick={guardarEdicion} data-testid='matriz-guardar-edicion'>
            Guardar
          </Button>
        </Group>
      </Group>
    </Alert>
  );

  const grilla = detalle && (
    <Stack gap='xs' style={{ flex: 1, minHeight: 0 }}>
      <Group justify='space-between'>
        <TextInput
          size='xs'
          leftSection={<IconSearch size={14} />}
          placeholder='Buscar en la hoja'
          value={q}
          onChange={(e) => {
            setQ(e.currentTarget.value);
            setPagina(1);
          }}
          w={260}
        />
        <Text size='xs' c='dimmed'>
          {detalle.total.toLocaleString('es-CO')} filas{qDeb.trim() ? ' encontradas' : ''} · {detalle.columnas.length} columnas
        </Text>
      </Group>
      <ScrollArea type='auto' offsetScrollbars style={{ opacity: cargando ? 0.6 : 1, flex: 1 }} h={completa ? 'calc(100vh - 290px)' : undefined}>
        <Table striped highlightOnHover withTableBorder withColumnBorders stickyHeader fz='xs' miw={Math.min(detalle.columnas.length * 140 + (editando ? 40 : 0), 4000)}>
          <Table.Thead>
            <Table.Tr>
              {editando && <Table.Th w={36} />}
              {detalle.columnas.map((c, i) => (
                <Table.Th key={i} style={{ whiteSpace: 'nowrap' }}>
                  <UnstyledButton
                    onClick={() => {
                      setOrden((o) => (o && o.col === i ? (o.desc ? null : { col: i, desc: true }) : { col: i, desc: false }));
                      setPagina(1);
                    }}
                    title={`${ETIQUETA_TIPO[c.tipo]} · clic para ordenar`}
                  >
                    <Group gap={4} wrap='nowrap'>
                      <Text size='xs' fw={600}>
                        {c.nombre}
                      </Text>
                      {orden?.col === i && (orden.desc ? <IconArrowDown size={12} /> : <IconArrowUp size={12} />)}
                    </Group>
                  </UnstyledButton>
                </Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {detalle.filas.map((f, r) => {
              const fila = detalle.indices[r];
              const borrada = borrar.has(fila);
              return (
                <Table.Tr key={fila} style={borrada ? { textDecoration: 'line-through', opacity: 0.5 } : undefined}>
                  {editando && (
                    <Table.Td>
                      <Tooltip label={borrada ? 'No borrar' : 'Borrar fila'}>
                        <ActionIcon
                          size='sm'
                          variant='subtle'
                          color={borrada ? 'gray' : 'red'}
                          aria-label='Borrar fila'
                          onClick={() =>
                            setBorrar((prev) => {
                              const n = new Set(prev);
                              if (n.has(fila)) n.delete(fila);
                              else n.add(fila);
                              return n;
                            })
                          }
                        >
                          {borrada ? <IconArrowBackUp size={14} /> : <IconTrash size={14} />}
                        </ActionIcon>
                      </Tooltip>
                    </Table.Td>
                  )}
                  {detalle.columnas.map((c, i) => {
                    const k = clave(fila, i);
                    const cambiado = cambios.has(k);
                    const activa = celda && celda.fila === fila && celda.col === i;
                    return (
                      <Table.Td
                        key={i}
                        onDoubleClick={() => editarCelda(fila, i, f[i] ?? null)}
                        style={{
                          textAlign: c.tipo === 'numero' ? 'right' : undefined,
                          maxWidth: 320,
                          padding: activa ? 0 : undefined,
                          background: cambiado ? 'var(--mantine-color-yellow-light)' : undefined,
                          cursor: editando ? 'cell' : undefined,
                        }}
                      >
                        {activa ? (
                          <TextInput
                            size='xs'
                            autoFocus
                            value={celda.valor}
                            onChange={(e) => setCelda({ ...celda, valor: e.currentTarget.value })}
                            onBlur={() => confirmarCelda(null)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') confirmarCelda(null);
                              else if (e.key === 'Escape') setCelda(null);
                              else if (e.key === 'Tab') {
                                e.preventDefault();
                                const col = e.shiftKey ? i - 1 : i + 1;
                                confirmarCelda(col >= 0 && col < detalle.columnas.length ? { fila, col } : null);
                              }
                            }}
                            placeholder={ETIQUETA_TIPO[c.tipo]}
                            styles={{ input: { borderRadius: 0 } }}
                          />
                        ) : (
                          <Text size='xs' lineClamp={2}>
                            {cambiado ? cambios.get(k) : formatoCelda(f[i] ?? null, c.tipo)}
                          </Text>
                        )}
                      </Table.Td>
                    );
                  })}
                </Table.Tr>
              );
            })}
            {editando &&
              nuevas.map((n, r) => (
                <Table.Tr key={`nueva-${r}`} style={{ background: 'var(--mantine-color-green-light)' }}>
                  <Table.Td>
                    <ActionIcon size='sm' variant='subtle' color='red' aria-label='Quitar fila nueva' onClick={() => setNuevas((prev) => prev.filter((_, j) => j !== r))}>
                      <IconX size={14} />
                    </ActionIcon>
                  </Table.Td>
                  {detalle.columnas.map((c, i) => (
                    <Table.Td key={i} style={{ padding: 0 }}>
                      <TextInput
                        size='xs'
                        value={n[i] ?? ''}
                        placeholder={c.nombre}
                        onChange={(e) => {
                          const v = e.currentTarget.value;
                          setNuevas((prev) => prev.map((f, j) => (j === r ? f.map((x, k) => (k === i ? v : x)) : f)));
                        }}
                        styles={{ input: { borderRadius: 0 } }}
                      />
                    </Table.Td>
                  ))}
                </Table.Tr>
              ))}
          </Table.Tbody>
        </Table>
      </ScrollArea>
      <Group justify='space-between'>
        {editando ? (
          <Button
            size='xs'
            variant='light'
            color='green'
            leftSection={<IconPlus size={14} />}
            onClick={() => setNuevas((prev) => [...prev, detalle.columnas.map(() => '')])}
            data-testid='matriz-agregar-fila'
          >
            Agregar fila
          </Button>
        ) : (
          <span />
        )}
        {detalle.total > detalle.porPagina && (
          <Pagination size='sm' total={Math.ceil(detalle.total / detalle.porPagina)} value={detalle.pagina} onChange={setPagina} />
        )}
      </Group>
    </Stack>
  );

  const contenido = actual && (
    <Stack gap='sm' style={completa ? { height: '100%' } : undefined}>
      {encabezado}
      <Group justify='space-between' wrap='wrap' gap='xs'>
        <SegmentedControl
          size='xs'
          value={vista}
          onChange={(v) => setVista(v as typeof vista)}
          disabled={editando}
          data={[
            { value: 'datos', label: 'Datos' },
            { value: 'ficha', label: 'Resumen de columnas' },
            { value: 'versiones', label: `Versiones (${detalle?.versiones.length ?? actual.version})` },
          ]}
        />
        {detalle && detalle.hojas.length > 1 && (
          <SegmentedControl
            size='xs'
            value={String(hoja)}
            disabled={pendientes > 0}
            onChange={(v) => {
              setHoja(Number(v));
              setPagina(1);
              setOrden(null);
            }}
            data={detalle.hojas.map((h, i) => ({ value: String(i), label: h.nombre }))}
          />
        )}
      </Group>
      {barraEdicion}

      {detalle && !vigente && (
        <Alert color='yellow' variant='light'>
          Está viendo una versión anterior (no se puede editar).{' '}
          <UnstyledButton onClick={() => setVerVersion(null)} style={{ textDecoration: 'underline', fontSize: 'inherit' }}>
            Volver a la vigente
          </UnstyledButton>
        </Alert>
      )}

      {!detalle ? (
        <Skeleton h={200} />
      ) : vista === 'datos' ? (
        grilla
      ) : vista === 'ficha' ? (
        <ScrollArea type='auto'>
          <Table striped withTableBorder fz='xs'>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Columna</Table.Th>
                <Table.Th>Tipo</Table.Th>
                <Table.Th>Vacías</Table.Th>
                <Table.Th>Valores distintos</Table.Th>
                <Table.Th>Mínimo</Table.Th>
                <Table.Th>Máximo</Table.Th>
                <Table.Th>Suma</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {detalle.ficha.map((c) => (
                <Table.Tr key={c.nombre}>
                  <Table.Td>{c.nombre}</Table.Td>
                  <Table.Td>
                    <Badge size='xs' variant='light'>
                      {ETIQUETA_TIPO[c.tipo]}
                    </Badge>
                  </Table.Td>
                  <Table.Td>{c.vacias}</Table.Td>
                  <Table.Td>{c.distintos}</Table.Td>
                  <Table.Td>{typeof c.min === 'number' ? c.min.toLocaleString('es-CO') : (c.min ?? '')}</Table.Td>
                  <Table.Td>{typeof c.max === 'number' ? c.max.toLocaleString('es-CO') : (c.max ?? '')}</Table.Td>
                  <Table.Td>{c.suma !== undefined ? c.suma.toLocaleString('es-CO') : ''}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      ) : (
        <Stack gap={6}>
          {detalle.versiones.map((v, i) => (
            <Card key={v.idVersion} withBorder radius='sm' p='xs'>
              <Group justify='space-between' wrap='nowrap'>
                <div style={{ minWidth: 0 }}>
                  <Group gap={6}>
                    <IconHistory size={14} />
                    <Text size='sm' fw={600}>
                      Versión {v.version}
                    </Text>
                    {i === 0 && (
                      <Badge size='xs' color='green' variant='light'>
                        Vigente
                      </Badge>
                    )}
                  </Group>
                  <Text size='xs' c='dimmed'>
                    {fechaCorta(v.fecha)} · {v.subidaPor ?? '—'} · {v.archivo}
                  </Text>
                  {v.resumen && <Text size='xs'>{v.resumen}</Text>}
                </div>
                <Button
                  size='xs'
                  variant='subtle'
                  leftSection={<IconListDetails size={14} />}
                  onClick={() => {
                    setVerVersion(i === 0 ? null : v.idVersion);
                    setHoja(0);
                    setPagina(1);
                    setVista('datos');
                  }}
                >
                  Ver
                </Button>
              </Group>
            </Card>
          ))}
        </Stack>
      )}
    </Stack>
  );

  return (
    <Stack gap='md' data-testid='seccion-matrices'>
      <Group justify='space-between' align='flex-start'>
        <div>
          <Text fw={600}>Matrices</Text>
          <Text size='sm' c='dimmed' maw={680}>
            Suban sus matrices de Excel o CSV y trabájenlas aquí: buscar, ordenar, editar celdas, agregar o borrar filas. Cada cambio guardado queda
            como una versión nueva. Los agentes del proyecto las reciben para analizarlas.
          </Text>
        </div>
        {puedeSubir && (
          <Button leftSection={<IconUpload size={16} />} onClick={() => setSubir({ idMatrix: null })} data-testid='matriz-subir'>
            Subir matriz
          </Button>
        )}
      </Group>

      {matrices.length === 0 ? (
        <Alert color='blue' variant='light' icon={<IconFileSpreadsheet size={18} />}>
          Todavía no hay matrices en este proyecto.{puedeSubir ? ' Suba la primera con «Subir matriz».' : ''}
        </Alert>
      ) : (
        <Group gap='xs'>
          {matrices.map((m) => (
            <Button
              key={m.idMatrix}
              size='xs'
              variant={m.idMatrix === abierta ? 'filled' : 'light'}
              leftSection={<IconFileSpreadsheet size={14} />}
              onClick={() => abrir(m.idMatrix)}
              disabled={pendientes > 0 && m.idMatrix !== abierta}
              maw={280}
            >
              <Text size='xs' truncate>
                {m.nombre}
              </Text>
            </Button>
          ))}
        </Group>
      )}

      {actual && !completa && (
        <Card withBorder radius='md' p='md'>
          {contenido}
        </Card>
      )}

      <Modal
        opened={completa && !!actual}
        onClose={() => setCompleta(false)}
        fullScreen
        withCloseButton={false}
        closeOnEscape={!celda}
        padding='md'
        transitionProps={{ duration: 0 }}
      >
        {completa && contenido}
      </Modal>

      {subir && (
        <SubirMatrizModal
          base={base}
          idMatrix={subir.idMatrix}
          nombreActual={subir.idMatrix ? (actual?.nombre ?? '') : ''}
          onClose={() => setSubir(null)}
          onListo={async (r) => {
            setSubir(null);
            avisar({ tipo: 'ok', texto: `Matriz guardada (versión ${r.versionNo}). ${r.resumen}` });
            await cargar();
            abrir(r.idMatrix);
          }}
        />
      )}

      <ConfirmarModal
        opened={archivar}
        titulo='Archivar matriz'
        texto='La matriz deja de verse en el proyecto y deja de llegarle a los agentes. Sus versiones se conservan.'
        accion='Archivar'
        color='red'
        cargando={false}
        onClose={() => setArchivar(false)}
        onConfirmar={async () => {
          setArchivar(false);
          if (!actual) return;
          const r = await apiSend<{ ok: true }>('DELETE', `${base}/${actual.idMatrix}`);
          if (!r.ok) return avisar({ tipo: 'error', texto: r.error });
          avisar({ tipo: 'ok', texto: 'Matriz archivada.' });
          setAbierta(null);
          await cargar();
        }}
      />
    </Stack>
  );
}

function SubirMatrizModal({
  base,
  idMatrix,
  nombreActual,
  onClose,
  onListo,
}: {
  base: string;
  idMatrix: number | null;
  nombreActual: string;
  onClose: () => void;
  onListo: (r: { idMatrix: number; versionNo: number; resumen: string }) => void;
}) {
  const [archivo, setArchivo] = useState<File | null>(null);
  const [nombre, setNombre] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [fila, setFila] = useState<number | string>('');
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const guardar = async () => {
    if (!archivo) return;
    setError(null);
    setGuardando(true);
    const fd = new FormData();
    fd.set('file', archivo);
    if (idMatrix) fd.set('idMatrix', String(idMatrix));
    if (nombre.trim()) fd.set('nombre', nombre.trim());
    if (!idMatrix && descripcion.trim()) fd.set('descripcion', descripcion.trim());
    if (fila !== '' && Number(fila) > 0) fd.set('filaEncabezados', String(fila));
    const r = await apiSend<{ idMatrix: number; versionNo: number; resumen: string }>('POST', base, fd, 'No se pudo guardar la matriz.');
    setGuardando(false);
    if (!r.ok) return setError(r.error);
    onListo(r.data);
  };

  return (
    <Modal opened onClose={onClose} title={idMatrix ? `Nueva versión de «${nombreActual}»` : 'Subir matriz'} size='md'>
      <Stack gap='sm'>
        {error && (
          <Alert color='red' variant='light'>
            {error}
          </Alert>
        )}
        <FileInput
          label='Archivo'
          description='Excel (.xlsx) o CSV, hasta 25 MB. Se leen todas las hojas visibles.'
          placeholder='Elija el archivo'
          accept='.xlsx,.xlsm,.csv,.txt'
          value={archivo}
          onChange={setArchivo}
          leftSection={<IconFileSpreadsheet size={16} />}
          clearable
          data-testid='matriz-archivo'
        />
        <TextInput
          label={idMatrix ? 'Cambiar el nombre (opcional)' : 'Nombre (opcional)'}
          placeholder={idMatrix ? nombreActual : 'Si lo deja vacío, se usa el nombre del archivo'}
          maxLength={150}
          value={nombre}
          onChange={(e) => setNombre(e.currentTarget.value)}
        />
        {!idMatrix && (
          <Textarea
            label='Descripción (opcional)'
            description='Ayuda a las personas y a los agentes a entender para qué sirve.'
            autosize
            minRows={2}
            maxLength={1000}
            value={descripcion}
            onChange={(e) => setDescripcion(e.currentTarget.value)}
          />
        )}
        <NumberInput
          label='Fila de los encabezados (opcional)'
          description='Si la deja vacía, SynerLink la detecta (por ejemplo, cuando hay un título arriba de la tabla).'
          min={1}
          max={50}
          value={fila}
          onChange={setFila}
          w={260}
        />
        <Group justify='flex-end' mt='sm'>
          <Button variant='default' onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={guardar} loading={guardando} disabled={!archivo} leftSection={<IconUpload size={16} />} data-testid='matriz-guardar'>
            Guardar
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
