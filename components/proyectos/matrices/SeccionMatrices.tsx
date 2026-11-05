'use client';

import { useCallback, useEffect, useState } from 'react';
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
  IconArrowDown,
  IconArrowUp,
  IconDownload,
  IconFileSpreadsheet,
  IconHistory,
  IconListDetails,
  IconSearch,
  IconUpload,
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
 *   - Permisos del proyecto: ven todos los miembros; suben y archivan dueño y editores.
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
  versiones: { idVersion: number; version: number; archivo: string; subidaPor: string | null; resumen: string | null; fecha: string }[];
  hojas: { idSheet: number; nombre: string; filas: number }[];
  hoja: { idSheet: number; nombre: string; filaEncabezados: number } | null;
  columnas: { nombre: string; tipo: Tipo }[];
  ficha: { nombre: string; tipo: Tipo; vacias: number; distintos: number; min?: number | string; max?: number | string; suma?: number }[];
  total: number;
  filas: Celda[][];
  pagina: number;
  porPagina: number;
}

const ETIQUETA_TIPO: Record<Tipo, string> = { texto: 'Texto', numero: 'Número', fecha: 'Fecha', booleano: 'Sí/No' };

function formatoCelda(v: Celda, tipo: Tipo): string {
  if (v === null) return '';
  if (typeof v === 'number') return tipo === 'numero' ? v.toLocaleString('es-CO', { maximumFractionDigits: 4 }) : String(v);
  if (typeof v === 'boolean') return v ? 'Sí' : 'No';
  return v;
}

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

  const cargar = useCallback(async () => {
    const r = await apiGet<{ matrices: MatrizResumen[] }>(base, 'No se pudieron cargar las matrices.');
    if (r.ok) {
      setMatrices(r.data.matrices);
      setAbierta((a) => (a && r.data.matrices.some((m) => m.idMatrix === a) ? a : r.data.matrices[0]?.idMatrix ?? null));
    } else if (r.error) avisar({ tipo: 'error', texto: r.error });
  }, [base, avisar]);

  useEffect(() => {
    void cargar();
  }, [cargar, version]);

  const cargarDetalle = useCallback(async () => {
    if (abierta === null) return setDetalle(null);
    setCargando(true);
    const p = new URLSearchParams({ hoja: String(hoja), pagina: String(pagina), porPagina: '100' });
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
  }, [abierta, base, hoja, pagina, qDeb, orden, verVersion, avisar]);

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
  };

  if (matrices === null) return <Skeleton h={160} radius='md' />;

  const actual = matrices.find((m) => m.idMatrix === abierta) ?? null;
  const vigente = detalle && detalle.versiones[0] && (verVersion === null || verVersion === detalle.versiones[0].idVersion);

  return (
    <Stack gap='md' data-testid='seccion-matrices'>
      <Group justify='space-between' align='flex-start'>
        <div>
          <Text fw={600}>Matrices</Text>
          <Text size='sm' c='dimmed' maw={680}>
            Suban sus matrices de Excel o CSV y consúltenlas aquí como una tabla. Los agentes del proyecto las reciben para analizarlas. Para
            actualizar una matriz, suba una versión nueva: queda el historial.
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
              maw={280}
            >
              <Text size='xs' truncate>
                {m.nombre}
              </Text>
            </Button>
          ))}
        </Group>
      )}

      {actual && (
        <Card withBorder radius='md' p='md'>
          <Stack gap='sm'>
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
                {puedeSubir && (
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

            <Group justify='space-between' wrap='wrap' gap='xs'>
              <SegmentedControl
                size='xs'
                value={vista}
                onChange={(v) => setVista(v as typeof vista)}
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
                  onChange={(v) => {
                    setHoja(Number(v));
                    setPagina(1);
                    setOrden(null);
                  }}
                  data={detalle.hojas.map((h, i) => ({ value: String(i), label: h.nombre }))}
                />
              )}
            </Group>

            {detalle && !vigente && (
              <Alert color='yellow' variant='light'>
                Está viendo una versión anterior.{' '}
                <UnstyledButton onClick={() => setVerVersion(null)} style={{ textDecoration: 'underline', fontSize: 'inherit' }}>
                  Volver a la vigente
                </UnstyledButton>
              </Alert>
            )}

            {!detalle ? (
              <Skeleton h={200} />
            ) : vista === 'datos' ? (
              <Stack gap='xs'>
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
                <ScrollArea type='auto' offsetScrollbars style={{ opacity: cargando ? 0.6 : 1 }}>
                  <Table striped highlightOnHover withTableBorder withColumnBorders stickyHeader fz='xs' miw={Math.min(detalle.columnas.length * 140, 4000)}>
                    <Table.Thead>
                      <Table.Tr>
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
                      {detalle.filas.map((f, r) => (
                        <Table.Tr key={r}>
                          {detalle.columnas.map((c, i) => (
                            <Table.Td key={i} style={{ textAlign: c.tipo === 'numero' ? 'right' : undefined, maxWidth: 320 }}>
                              <Text size='xs' lineClamp={2}>
                                {formatoCelda(f[i] ?? null, c.tipo)}
                              </Text>
                            </Table.Td>
                          ))}
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </ScrollArea>
                {detalle.total > detalle.porPagina && (
                  <Group justify='center'>
                    <Pagination size='sm' total={Math.ceil(detalle.total / detalle.porPagina)} value={detalle.pagina} onChange={setPagina} />
                  </Group>
                )}
              </Stack>
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
                        <Table.Td>{typeof c.min === 'number' ? c.min.toLocaleString('es-CO') : c.min ?? ''}</Table.Td>
                        <Table.Td>{typeof c.max === 'number' ? c.max.toLocaleString('es-CO') : c.max ?? ''}</Table.Td>
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
        </Card>
      )}

      {subir && (
        <SubirMatrizModal
          base={base}
          idMatrix={subir.idMatrix}
          nombreActual={subir.idMatrix ? actual?.nombre ?? '' : ''}
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
