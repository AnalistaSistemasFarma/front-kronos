'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Autocomplete,
  Badge,
  Button,
  Card,
  Checkbox,
  FileButton,
  Group,
  Loader,
  Modal,
  NumberInput,
  Pagination,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
  Tooltip,
} from '@mantine/core';
import {
  IconAlertTriangle,
  IconArrowBackUp,
  IconBox,
  IconCheck,
  IconCopy,
  IconDownload,
  IconEye,
  IconCurrencyDollar,
  IconFileSpreadsheet,
  IconHistory,
  IconLink,
  IconPencil,
  IconPlus,
  IconSearch,
  IconTool,
  IconTruckDelivery,
  IconUpload,
  IconX,
} from '@tabler/icons-react';
import SgcSelect from '../SgcSelect';
import { sgcSend, useSgcFetch } from '../useSgcFetch';
import type { AccionMovimiento, EquipoDto, EstadoEquipo, ResumenInventario } from '../../../lib/biomedica/inventario';

/**
 * INVENTARIO DE EQUIPOS BIOMÉDICOS (fase 2, 2026-11-10; formato OLP-GCC-04-FR-017). Lo usan el ingeniero
 * biomédico y el comercial con el permiso del módulo: distribuir seriales (quedan bloqueados), devolverlos,
 * marcar faltantes o dañados (se cobran con el valor unitario), artículo de SAP opcional, cargue masivo con
 * simulación y el historial de cada equipo.
 */

const ETIQUETA: Record<EstadoEquipo, string> = { bodega: 'En bodega', distribuido: 'Distribuido', faltante: 'Faltante', danado: 'Dañado' };
const COLOR: Record<EstadoEquipo, string> = { bodega: 'gray', distribuido: 'blue', faltante: 'red', danado: 'orange' };
const ACCION: Record<AccionMovimiento, { titulo: string; boton: string; color: string; icon: React.ReactNode }> = {
  distribuir: { titulo: 'Distribuir a un cliente', boton: 'Distribuir', color: 'blue', icon: <IconTruckDelivery size={16} /> },
  devolver: { titulo: 'Devolver a bodega', boton: 'Devolver', color: 'teal', icon: <IconArrowBackUp size={16} /> },
  faltante: { titulo: 'Marcar como faltantes', boton: 'Faltante', color: 'red', icon: <IconAlertTriangle size={16} /> },
  danado: { titulo: 'Marcar como dañados', boton: 'Dañado', color: 'orange', icon: <IconTool size={16} /> },
  reintegrar: { titulo: 'Reintegrar a bodega (apareció o se reparó)', boton: 'Reintegrar', color: 'grape', icon: <IconBox size={16} /> },
};
const DESDE: Record<AccionMovimiento, EstadoEquipo[]> = {
  distribuir: ['bodega'],
  devolver: ['distribuido'],
  faltante: ['distribuido', 'bodega'],
  danado: ['distribuido', 'bodega'],
  reintegrar: ['faltante', 'danado'],
};

const pesos = (n: number | null) => (n === null ? '—' : n.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 2 }));
const fecha = (iso: string | null) => (iso ? new Date(iso).toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'short', timeStyle: 'short' }) : '—');

type Lista = { total: number; page: number; pageSize: number; equipos: EquipoDto[]; resumen?: ResumenInventario };
type Filtro = { q: string; estado: string | null; cliente: string | null; ciudad: string | null; codigo: string | null };

function query(f: Filtro) {
  const p = new URLSearchParams();
  if (f.q.trim().length >= 2) p.set('q', f.q.trim());
  if (f.estado) p.set('estado', f.estado);
  if (f.cliente) p.set('cliente', f.cliente);
  if (f.ciudad) p.set('ciudad', f.ciudad);
  if (f.codigo) p.set('codigo', f.codigo);
  return p.toString();
}

export default function BiomedInventario({ idCompany, empresa = '' }: { idCompany: number; empresa?: string }) {
  const [vista, setVista] = useState<'equipos' | 'cobros' | 'valores'>('equipos');
  const [version, setVersion] = useState(0);
  const cambio = () => setVersion((v) => v + 1);
  return (
    <Stack gap='sm'>
      <SegmentedControl
        value={vista}
        onChange={(v) => setVista(v as typeof vista)}
        data={[
          { value: 'equipos', label: 'Equipos' },
          { value: 'cobros', label: 'Cobros (faltantes y dañados)' },
          { value: 'valores', label: 'Valores unitarios' },
        ]}
        w='fit-content'
        data-testid='biomed-inv-vista'
      />
      {vista === 'equipos' && <Equipos idCompany={idCompany} empresa={empresa} version={version} onCambio={cambio} />}
      {vista === 'cobros' && <Cobros idCompany={idCompany} version={version} />}
      {vista === 'valores' && <Valores idCompany={idCompany} onCambio={cambio} />}
    </Stack>
  );
}

// ── Equipos ───────────────────────────────────────────────────────────────

function Equipos({ idCompany, empresa, version, onCambio }: { idCompany: number; empresa: string; version: number; onCambio: () => void }) {
  const [f, setF] = useState<Filtro>({ q: '', estado: null, cliente: null, ciudad: null, codigo: null });
  const [page, setPage] = useState(1);
  const pageSize = 100;
  const qs = query(f);
  const lista = useSgcFetch<Lista>(`/api/biomedica/inventario?company=${idCompany}&resumen=1&page=${page}&pageSize=${pageSize}${qs ? `&${qs}` : ''}&v=${version}`);
  const [sel, setSel] = useState<Map<number, EstadoEquipo>>(new Map());
  const ultimo = useRef<number | null>(null);
  const [accion, setAccion] = useState<AccionMovimiento | null>(null);
  const [editar, setEditar] = useState<EquipoDto | 'nuevo' | null>(null);
  const [copiar, setCopiar] = useState<EquipoDto | null>(null);
  const [masivo, setMasivo] = useState(false);
  const [historial, setHistorial] = useState<number | null>(null);
  const [sap, setSap] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [cargandoTodos, setCargandoTodos] = useState(false);
  const resumen = useRef<ResumenInventario | null>(null);
  if (lista.data?.resumen) resumen.current = lista.data.resumen;
  const r = resumen.current;

  useEffect(() => setPage(1), [qs]);

  const equipos = lista.data?.equipos ?? [];
  const todosPagina = equipos.length > 0 && equipos.every((e) => sel.has(e.id));

  const marcar = (idx: number, shift: boolean) => {
    const e = equipos[idx];
    if (!e) return;
    setSel((prev) => {
      const next = new Map(prev);
      const poner = !prev.has(e.id);
      // Mayúscula + clic: marca (o desmarca) todo el rango, como «de la 67 hasta la 83».
      const desde = shift && ultimo.current !== null ? Math.min(ultimo.current, idx) : idx;
      const hasta = shift && ultimo.current !== null ? Math.max(ultimo.current, idx) : idx;
      for (let i = desde; i <= hasta; i++) {
        const x = equipos[i]!;
        if (poner) next.set(x.id, x.estado);
        else next.delete(x.id);
      }
      return next;
    });
    ultimo.current = idx;
  };

  const seleccionarFiltrados = async () => {
    setCargandoTodos(true);
    setError(null);
    try {
      const res = await fetch(`/api/biomedica/inventario/ids?company=${idCompany}${qs ? `&${qs}` : ''}`, { cache: 'no-store' });
      const body = (await res.json().catch(() => ({}))) as { ids?: number[]; error?: string };
      if (!res.ok) throw new Error(body.error || `Error ${res.status}`);
      // El estado de cada uno lo valida el servidor; aquí basta con el filtro de estado (si lo hay).
      const estado = (f.estado as EstadoEquipo | null) ?? null;
      setSel(new Map((body.ids ?? []).map((id) => [id, estado ?? 'bodega'])));
      if (!estado) setOk('Seleccionó todo lo filtrado. Si mezcla estados, el sistema le dirá cuáles no aplican para la acción.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCargandoTodos(false);
    }
  };

  const terminado = (msg: string) => {
    setSel(new Map());
    setOk(msg);
    lista.reload();
    onCambio();
  };

  const estadosSel = new Set(sel.values());

  return (
    <Stack gap='sm'>
      {error && (
        <Alert color='red' icon={<IconAlertTriangle size={18} />} withCloseButton onClose={() => setError(null)} data-testid='biomed-inv-error'>
          {error}
        </Alert>
      )}
      {ok && (
        <Alert color='green' icon={<IconCheck size={18} />} withCloseButton onClose={() => setOk(null)}>
          {ok}
        </Alert>
      )}

      {r && (
        <Group gap='xs'>
          <Badge size='lg' variant={f.estado === null ? 'filled' : 'light'} color='dark' style={{ cursor: 'pointer' }} onClick={() => setF({ ...f, estado: null })}>
            Todos · {r.total.toLocaleString('es-CO')}
          </Badge>
          {(Object.keys(ETIQUETA) as EstadoEquipo[]).map((e) => (
            <Badge key={e} size='lg' variant={f.estado === e ? 'filled' : 'light'} color={COLOR[e]} style={{ cursor: 'pointer' }} onClick={() => setF({ ...f, estado: f.estado === e ? null : e })} data-testid={`biomed-inv-estado-${e}`}>
              {ETIQUETA[e]} · {r.porEstado[e].toLocaleString('es-CO')}
            </Badge>
          ))}
        </Group>
      )}

      <Group align='flex-end' wrap='wrap' gap='xs'>
        <TextInput autoComplete='off' data-1p-ignore='true' data-lpignore='true' leftSection={<IconSearch size={16} />} label='Buscar' placeholder='Serie, equipo, modelo, cliente o sede' value={f.q} onChange={(e) => setF({ ...f, q: e.currentTarget.value })} w={280} data-testid='biomed-inv-buscar' />
        <SgcSelect label='Cliente' searchable clearable data={r?.clientes ?? []} value={f.cliente} onChange={(v) => setF({ ...f, cliente: v })} w={260} />
        <SgcSelect label='Ciudad' searchable clearable data={r?.ciudades ?? []} value={f.ciudad} onChange={(v) => setF({ ...f, ciudad: v })} w={180} />
        <SgcSelect label='Código interno' searchable clearable data={r?.codigos ?? []} value={f.codigo} onChange={(v) => setF({ ...f, codigo: v })} w={170} />
        <Button variant='light' leftSection={<IconPlus size={16} />} onClick={() => setEditar('nuevo')} data-testid='biomed-inv-nuevo'>
          Nuevo equipo
        </Button>
        <Button variant='light' leftSection={<IconFileSpreadsheet size={16} />} onClick={() => setMasivo(true)} data-testid='biomed-inv-masivo'>
          Cargue masivo (Excel)
        </Button>
      </Group>

      <Card withBorder radius='md' p='xs' style={{ position: 'sticky', top: 0, zIndex: 3 }}>
        <Group gap='xs' wrap='wrap'>
          <Text size='sm' fw={600} data-testid='biomed-inv-seleccion'>
            {sel.size > 0 ? `${sel.size.toLocaleString('es-CO')} seleccionado(s)` : 'Seleccione equipos (Mayúscula + clic para un rango)'}
          </Text>
          {lista.data && lista.data.total > 0 && (
            <Button size='xs' variant='subtle' loading={cargandoTodos} onClick={() => void seleccionarFiltrados()}>
              Seleccionar los {lista.data.total.toLocaleString('es-CO')} filtrados
            </Button>
          )}
          {sel.size > 0 && (
            <>
              {(Object.keys(ACCION) as AccionMovimiento[]).map((a) => {
                const aplica = [...estadosSel].some((e) => DESDE[a].includes(e));
                return (
                  <Button key={a} size='xs' variant='light' color={ACCION[a].color} leftSection={ACCION[a].icon} disabled={!aplica} onClick={() => setAccion(a)} data-testid={`biomed-inv-accion-${a}`}>
                    {ACCION[a].boton}
                  </Button>
                );
              })}
              <Button size='xs' variant='light' color='gray' leftSection={<IconLink size={16} />} onClick={() => setSap(true)}>
                Artículo SAP
              </Button>
              <Button size='xs' variant='subtle' color='gray' leftSection={<IconX size={14} />} onClick={() => setSel(new Map())}>
                Limpiar
              </Button>
            </>
          )}
        </Group>
      </Card>

      {lista.error ? (
        <Alert color='orange'>{lista.error}</Alert>
      ) : !lista.data ? (
        <Group justify='center' my='xl'>
          <Loader />
        </Group>
      ) : lista.data.total === 0 ? (
        <Alert color='gray'>{r?.total === 0 ? 'El inventario está vacío. Cárguelo desde «Cargue masivo» con el formato OLP-GCC-04-FR-017.' : 'Ningún equipo coincide con el filtro.'}</Alert>
      ) : (
        <>
          <Table.ScrollContainer minWidth={1100}>
            <Table striped highlightOnHover verticalSpacing={4} fz='sm' data-testid='biomed-inv-tabla'>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={36}>
                    <Checkbox
                      aria-label='Seleccionar la página'
                      checked={todosPagina}
                      indeterminate={!todosPagina && equipos.some((e) => sel.has(e.id))}
                      onChange={() =>
                        setSel((prev) => {
                          const next = new Map(prev);
                          for (const e of equipos) {
                            if (todosPagina) next.delete(e.id);
                            else next.set(e.id, e.estado);
                          }
                          return next;
                        })
                      }
                    />
                  </Table.Th>
                  <Table.Th>Serie</Table.Th>
                  <Table.Th>Equipo</Table.Th>
                  <Table.Th>Modelo</Table.Th>
                  <Table.Th>Código</Table.Th>
                  <Table.Th>Estado</Table.Th>
                  <Table.Th>Cliente</Table.Th>
                  <Table.Th>Sede</Table.Th>
                  <Table.Th>Ciudad</Table.Th>
                  <Table.Th>Art. SAP</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {equipos.map((e, i) => (
                  <Table.Tr key={e.id} bg={sel.has(e.id) ? 'var(--mantine-color-blue-light)' : undefined} data-testid='biomed-inv-fila'>
                    <Table.Td>
                      <Checkbox aria-label={`Seleccionar ${e.serie}`} checked={sel.has(e.id)} onChange={() => undefined} onClick={(ev) => marcar(i, ev.shiftKey)} />
                    </Table.Td>
                    <Table.Td ff='monospace'>{e.serie}</Table.Td>
                    <Table.Td>{e.equipo}</Table.Td>
                    <Table.Td>{e.modelo ?? '—'}</Table.Td>
                    <Table.Td>{e.codigoInterno ?? '—'}</Table.Td>
                    <Table.Td>
                      <Tooltip label={e.observacion ?? ''} disabled={!e.observacion} withArrow multiline maw={320}>
                        <Badge variant='light' color={COLOR[e.estado]}>
                          {ETIQUETA[e.estado]}
                          {(e.estado === 'faltante' || e.estado === 'danado') && e.valorCobro !== null ? ` · ${pesos(e.valorCobro)}` : ''}
                        </Badge>
                      </Tooltip>
                    </Table.Td>
                    <Table.Td>{e.cliente ?? '—'}</Table.Td>
                    <Table.Td>{e.sede ?? '—'}</Table.Td>
                    <Table.Td>{e.ciudad ?? '—'}</Table.Td>
                    <Table.Td>{e.itemCodeSap ?? '—'}</Table.Td>
                    <Table.Td>
                      <Group gap={2} wrap='nowrap'>
                        <Tooltip label='Editar (con justificación)'>
                          <ActionIcon variant='subtle' aria-label='Editar' onClick={() => setEditar(e)}>
                            <IconPencil size={16} />
                          </ActionIcon>
                        </Tooltip>
                        <Tooltip label='Nuevo equipo con estos datos'>
                          <ActionIcon variant='subtle' aria-label='Nuevo como este' onClick={() => setCopiar(e)}>
                            <IconCopy size={16} />
                          </ActionIcon>
                        </Tooltip>
                        <Tooltip label='Historial'>
                          <ActionIcon variant='subtle' aria-label='Historial' onClick={() => setHistorial(e.id)}>
                            <IconHistory size={16} />
                          </ActionIcon>
                        </Tooltip>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
          <Group justify='space-between'>
            <Text size='xs' c='dimmed'>
              {((lista.data.page - 1) * pageSize + 1).toLocaleString('es-CO')}–{Math.min(lista.data.total, lista.data.page * pageSize).toLocaleString('es-CO')} de {lista.data.total.toLocaleString('es-CO')}
            </Text>
            <Pagination total={Math.ceil(lista.data.total / pageSize)} value={page} onChange={setPage} size='sm' />
          </Group>
        </>
      )}

      {accion && <MovimientoModal idCompany={idCompany} accion={accion} ids={[...sel.keys()]} resumen={r} onClose={() => setAccion(null)} onDone={(n) => { setAccion(null); terminado(`${n.toLocaleString('es-CO')} equipo(s): ${ACCION[accion].boton.toLowerCase()}.`); }} />}
      {editar && <EquipoModal idCompany={idCompany} equipo={editar === 'nuevo' ? null : editar} resumen={r} onClose={() => setEditar(null)} onDone={(msg) => { setEditar(null); terminado(msg); }} />}
      {masivo && <CargueModal idCompany={idCompany} empresa={empresa} resumen={r} onClose={() => setMasivo(false)} onDone={(msg) => { setMasivo(false); terminado(msg); }} />}
      {copiar && <EquipoModal idCompany={idCompany} equipo={null} base={copiar} resumen={r} onClose={() => setCopiar(null)} onDone={(msg) => { setCopiar(null); terminado(msg); }} />}
      {historial !== null && <HistorialModal idCompany={idCompany} idEquipo={historial} onClose={() => setHistorial(null)} />}
      {sap && <ArticuloSapModal idCompany={idCompany} ids={[...sel.keys()]} onClose={() => setSap(false)} onDone={(n) => { setSap(false); terminado(`Artículo de SAP actualizado en ${n.toLocaleString('es-CO')} equipo(s).`); }} />}
    </Stack>
  );
}

function MovimientoModal({ idCompany, accion, ids, resumen, onClose, onDone }: { idCompany: number; accion: AccionMovimiento; ids: number[]; resumen: ResumenInventario | null; onClose: () => void; onDone: (n: number) => void }) {
  const aBodega = accion === 'devolver' || accion === 'reintegrar';
  const [cliente, setCliente] = useState(aBodega ? (resumen?.bodega.cliente ?? '') : '');
  const [sede, setSede] = useState(aBodega ? 'Bodega' : '');
  const [zona, setZona] = useState('');
  const [ciudad, setCiudad] = useState(aBodega ? (resumen?.bodega.ciudad ?? '') : '');
  const [observacion, setObservacion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const novedad = accion === 'faltante' || accion === 'danado';
  const enviar = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await sgcSend<{ movidos: number }>('/api/biomedica/inventario/movimiento', 'POST', { company: idCompany, accion, ids, cliente, sede, zona, ciudad, observacion });
      onDone(res.movidos);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal opened onClose={onClose} title={<Text fw={700}>{ACCION[accion].titulo}</Text>} size='lg' data-testid='biomed-inv-movimiento'>
      <Stack gap='sm'>
        <Text size='sm'>
          {ids.length.toLocaleString('es-CO')} equipo(s) seleccionado(s).{' '}
          {accion === 'distribuir' && 'Quedan bloqueados: no se pueden tomar para otro contrato hasta que se devuelvan.'}
          {accion === 'devolver' && 'Vuelven a la bodega y se pueden volver a distribuir.'}
          {novedad && 'Se cobran al cliente con el valor unitario de su código interno (si el código aún no tiene valor, se toma cuando se le asigne).'}
          {accion === 'reintegrar' && 'Vuelven a la bodega (aparecieron o se repararon) y se quita su cobro.'}
        </Text>
        {error && (
          <Alert color='red' icon={<IconAlertTriangle size={18} />}>
            {error}
          </Alert>
        )}
        {(accion === 'distribuir' || aBodega) && (
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <Autocomplete label='Cliente' required={accion === 'distribuir'} data={resumen?.clientes ?? []} value={cliente} onChange={setCliente} limit={30} />
            <TextInput label='Sede' required value={sede} onChange={(e) => setSede(e.currentTarget.value)} disabled={aBodega} />
            <TextInput label='Zona' value={zona} onChange={(e) => setZona(e.currentTarget.value)} />
            <Autocomplete label='Ciudad' required={accion === 'distribuir'} data={resumen?.ciudades ?? []} value={ciudad} onChange={setCiudad} limit={30} />
          </SimpleGrid>
        )}
        <Textarea
          label={novedad ? 'Observación (qué pasó)' : accion === 'reintegrar' ? 'Justificación (por qué vuelve a bodega)' : 'Observación'}
          required={novedad || accion === 'reintegrar'}
          autosize
          minRows={2}
          maxLength={1000}
          value={observacion}
          onChange={(e) => setObservacion(e.currentTarget.value)}
          data-testid='biomed-inv-observacion'
        />
        <Group justify='flex-end'>
          <Button variant='default' onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button color={ACCION[accion].color} leftSection={ACCION[accion].icon} loading={busy} onClick={() => void enviar()} data-testid='biomed-inv-confirmar'>
            {ACCION[accion].boton}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

const CAMPOS: { k: keyof EquipoDto; label: string; requerido?: boolean }[] = [
  { k: 'serie', label: 'Serie', requerido: true },
  { k: 'modelo', label: 'Modelo' },
  { k: 'equipo', label: 'Equipo', requerido: true },
  { k: 'codigoInterno', label: 'Código interno' },
  { k: 'marca', label: 'Marca' },
  { k: 'clasificacionRiesgo', label: 'Clasificación de riesgo' },
  { k: 'registroSanitario', label: 'Registro sanitario' },
  { k: 'cliente', label: 'Cliente' },
  { k: 'sede', label: 'Sede' },
  { k: 'zona', label: 'Zona' },
  { k: 'ciudad', label: 'Ciudad' },
];

/** Campos que se eligen de los ya usados (o se escribe uno nuevo). */
function opcionesDe(k: keyof EquipoDto, r: ResumenInventario | null): string[] | null {
  if (!r) return null;
  const m: Partial<Record<keyof EquipoDto, string[] | undefined>> = {
    modelo: r.modelos,
    equipo: r.equipos,
    codigoInterno: r.codigos,
    marca: r.marcas,
    clasificacionRiesgo: r.clasificaciones,
    cliente: r.clientes,
    ciudad: r.ciudades,
  };
  return m[k] ?? null;
}

const serieLista = (s: string) =>
  s
    .split(/[\n,;]+/)
    .map((x) => x.trim())
    .filter(Boolean);

function EquipoModal({ idCompany, equipo, base, resumen, onClose, onDone }: { idCompany: number; equipo: EquipoDto | null; base?: EquipoDto | null; resumen: ResumenInventario | null; onClose: () => void; onDone: (msg: string) => void }) {
  // «Nuevo como este»: los datos del equipo de base, sin su serie.
  const origen = equipo ?? base ?? null;
  const [v, setV] = useState<Record<string, string>>(() => Object.fromEntries(CAMPOS.map((c) => [c.k, c.k === 'serie' && !equipo ? '' : String(origen?.[c.k] ?? (c.k === 'sede' && !origen ? 'Bodega' : ''))])));
  const [justificacion, setJustificacion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cambiaSerie = equipo !== null && v.serie.trim() !== equipo.serie;
  const series = equipo ? [] : serieLista(v.serie);

  const cambiar = (k: keyof EquipoDto, x: string) => {
    const next = { ...v, [k]: x };
    // Al elegir un modelo que ya existe, se llenan solos sus datos (lo más usado con ese modelo).
    const p = k === 'modelo' ? resumen?.plantillas?.[x] : undefined;
    if (p) {
      next.equipo = p.equipo ?? next.equipo;
      next.codigoInterno = p.codigoInterno ?? '';
      next.marca = p.marca ?? '';
      next.clasificacionRiesgo = p.clasificacionRiesgo ?? '';
      next.registroSanitario = p.registroSanitario ?? '';
    }
    setV(next);
  };

  const guardar = async () => {
    setBusy(true);
    setError(null);
    try {
      if (equipo) {
        const res = await sgcSend<{ changed: boolean }>(`/api/biomedica/inventario/${equipo.id}`, 'PATCH', { company: idCompany, ...v, justificacion });
        onDone(res.changed ? (cambiaSerie ? `Serie cambiada: ${equipo.serie} → ${v.serie.trim()}.` : `Equipo ${v.serie.trim()} actualizado.`) : 'Sin cambios.');
      } else {
        const { serie: _s, ...datos } = v;
        const res = await sgcSend<{ creados: number }>('/api/biomedica/inventario', 'POST', { company: idCompany, ...datos, series, justificacion });
        onDone(res.creados === 1 ? `Equipo ${series[0]} agregado al inventario.` : `${res.creados.toLocaleString('es-CO')} equipos agregados al inventario.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal opened onClose={onClose} title={<Text fw={700}>{equipo ? `Editar equipo · ${equipo.serie}` : base ? `Nuevo equipo como ${base.serie}` : 'Nuevo equipo'}</Text>} size='lg' data-testid='biomed-inv-equipo'>
      <Stack gap='sm'>
        {error && (
          <Alert color='red' icon={<IconAlertTriangle size={18} />}>
            {error}
          </Alert>
        )}
        <Text size='xs' c='dimmed'>
          {equipo
            ? 'El estado no se cambia aquí (use Distribuir, Devolver, Faltante, Dañado o Reintegrar). Todo cambio queda en el historial con su justificación.'
            : 'Elija el modelo y se llenan solos el equipo, el código, la marca y la clasificación. Puede pegar varias series (una por línea): se crea un equipo por cada una con los mismos datos.'}
        </Text>
        {!equipo && (
          <Textarea
            label={`Series (una por línea)${series.length > 1 ? ` · ${series.length} equipos` : ''}`}
            required
            autosize
            minRows={2}
            maxRows={8}
            value={v.serie}
            onChange={(e) => setV({ ...v, serie: e.currentTarget.value })}
            data-testid='biomed-inv-series'
          />
        )}
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          {CAMPOS.filter((c) => equipo || c.k !== 'serie').map((c) => {
            const opciones = opcionesDe(c.k, resumen);
            return opciones ? (
              // Elegir uno de los ya usados o escribir uno nuevo.
              <Autocomplete
                key={c.k}
                label={c.label}
                required={c.requerido}
                placeholder='Elija uno o escriba uno nuevo'
                data={opciones}
                value={v[c.k]}
                onChange={(x) => cambiar(c.k, x)}
                limit={50}
                data-testid={`biomed-inv-campo-${c.k}`}
              />
            ) : (
              <TextInput key={c.k} label={c.label} required={c.requerido} value={v[c.k]} onChange={(e) => cambiar(c.k, e.currentTarget.value)} data-testid={`biomed-inv-campo-${c.k}`} />
            );
          })}
        </SimpleGrid>
        {cambiaSerie && (
          <Alert color='orange' icon={<IconAlertTriangle size={18} />}>
            Va a cambiar la serie {equipo!.serie} por {v.serie.trim()}: queda como «cambio de serial» en el historial.
          </Alert>
        )}
        <Textarea label={equipo ? 'Justificación del cambio' : 'Observación (opcional)'} required={Boolean(equipo)} autosize minRows={2} maxLength={1000} value={justificacion} onChange={(e) => setJustificacion(e.currentTarget.value)} data-testid='biomed-inv-justificacion' />
        <Group justify='flex-end'>
          <Button variant='default' onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button loading={busy} disabled={!equipo && series.length === 0} onClick={() => void guardar()} data-testid='biomed-inv-guardar'>
            {!equipo && series.length > 1 ? `Agregar ${series.length} equipos` : 'Guardar'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

const ACCION_HISTORIAL: Record<string, string> = {
  alta: 'Alta',
  carga: 'Cargue masivo',
  carga_cambio: 'Cambio por cargue masivo',
  edicion: 'Edición',
  cambio_serial: 'Cambio de serial',
  distribuir: 'Distribuido',
  devolver: 'Devuelto a bodega',
  faltante: 'Marcado faltante',
  danado: 'Marcado dañado',
  reintegrar: 'Reintegrado a bodega',
  articulo_sap: 'Artículo de SAP',
};

function HistorialModal({ idCompany, idEquipo, onClose }: { idCompany: number; idEquipo: number; onClose: () => void }) {
  const h = useSgcFetch<{ equipo: EquipoDto; historial: { id: number; accion: string; antes: Record<string, unknown> | null; despues: Record<string, unknown> | null; justificacion: string | null; actor: string; at: string }[] }>(`/api/biomedica/inventario/${idEquipo}?company=${idCompany}`);
  const resumir = (o: Record<string, unknown> | null) =>
    o
      ? Object.entries(o)
          .filter(([, x]) => x !== null && x !== undefined && x !== '')
          .map(([k, x]) => `${k}: ${k === 'estado' ? (ETIQUETA[x as EstadoEquipo] ?? String(x)) : k === 'valorCobro' ? pesos(Number(x)) : String(x)}`)
          .join(' · ')
      : '';
  return (
    <Modal opened onClose={onClose} title={<Text fw={700}>Historial · {h.data?.equipo.serie ?? '…'}</Text>} size='xl' data-testid='biomed-inv-historial'>
      {h.error ? (
        <Alert color='orange'>{h.error}</Alert>
      ) : !h.data ? (
        <Group justify='center' my='md'>
          <Loader />
        </Group>
      ) : (
        <Table.ScrollContainer minWidth={700}>
          <Table striped verticalSpacing='xs' fz='sm'>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Fecha</Table.Th>
                <Table.Th>Acción</Table.Th>
                <Table.Th>Antes</Table.Th>
                <Table.Th>Después</Table.Th>
                <Table.Th>Justificación</Table.Th>
                <Table.Th>Por</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {h.data.historial.map((x) => (
                <Table.Tr key={x.id}>
                  <Table.Td>{fecha(x.at)}</Table.Td>
                  <Table.Td>{ACCION_HISTORIAL[x.accion] ?? x.accion}</Table.Td>
                  <Table.Td>{resumir(x.antes)}</Table.Td>
                  <Table.Td>{resumir(x.despues)}</Table.Td>
                  <Table.Td>{x.justificacion ?? '—'}</Table.Td>
                  <Table.Td>{x.actor}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </Modal>
  );
}

function ArticuloSapModal({ idCompany, ids, onClose, onDone }: { idCompany: number; ids: number[]; onClose: () => void; onDone: (n: number) => void }) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<{ itemCode: string; itemName: string }[]>([]);
  const [elegido, setElegido] = useState<{ itemCode: string; itemName: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (q.trim().length < 2) return;
    const t = setTimeout(() => {
      fetch(`/api/biomedica/inventario/articulo-sap?company=${idCompany}&q=${encodeURIComponent(q.trim())}`, { cache: 'no-store' })
        .then(async (res) => {
          const body = (await res.json().catch(() => ({}))) as { items?: typeof items; error?: string };
          if (!res.ok) throw new Error(body.error || `Error ${res.status}`);
          setItems(body.items ?? []);
        })
        .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    }, 350);
    return () => clearTimeout(t);
  }, [q, idCompany]);
  const enviar = async (item: { itemCode: string; itemName: string } | null) => {
    setBusy(true);
    setError(null);
    try {
      const res = await sgcSend<{ asignados: number }>('/api/biomedica/inventario/articulo-sap', 'POST', { company: idCompany, ids, itemCode: item?.itemCode ?? null, itemName: item?.itemName ?? null });
      onDone(res.asignados);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal opened onClose={onClose} title={<Text fw={700}>Artículo de SAP (opcional)</Text>} size='lg'>
      <Stack gap='sm'>
        <Text size='sm'>
          {ids.length.toLocaleString('es-CO')} equipo(s). Busque el artículo en el SAP de la empresa; si aún no está codificado, déjelo vacío y asígnelo después en bloque.
        </Text>
        {error && <Alert color='red'>{error}</Alert>}
        <Autocomplete
          label='Artículo'
          placeholder='Código o nombre (mínimo 2 letras)'
          value={q}
          onChange={(x) => {
            setQ(x);
            setElegido(items.find((it) => `${it.itemCode} · ${it.itemName}` === x) ?? null);
          }}
          data={items.map((it) => `${it.itemCode} · ${it.itemName}`)}
          limit={15}
        />
        <Group justify='space-between'>
          <Button variant='subtle' color='red' onClick={() => void enviar(null)} loading={busy}>
            Quitar el artículo
          </Button>
          <Group gap='xs'>
            <Button variant='default' onClick={onClose} disabled={busy}>
              Cancelar
            </Button>
            <Button disabled={!elegido} loading={busy} onClick={() => void enviar(elegido)}>
              Asignar
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}

// ── Cobros ────────────────────────────────────────────────────────────────

function Cobros({ idCompany, version }: { idCompany: number; version: number }) {
  const c = useSgcFetch<{ clientes: { cliente: string; faltantes: number; danados: number; total: number; sinValor: number }[]; total: number; sinValor: number; equipos: EquipoDto[] }>(`/api/biomedica/inventario/cobros?company=${idCompany}&v=${version}`);
  const [cliente, setCliente] = useState<string | null>(null);
  if (c.error) return <Alert color='orange'>{c.error}</Alert>;
  if (!c.data)
    return (
      <Group justify='center' my='xl'>
        <Loader />
      </Group>
    );
  const d = c.data;
  if (d.clientes.length === 0) return <Alert color='gray'>No hay equipos faltantes ni dañados.</Alert>;
  const detalle = cliente ? d.equipos.filter((e) => (e.cliente || '(sin cliente)') === cliente) : d.equipos;
  return (
    <Stack gap='sm'>
      <Group gap='md'>
        <Card withBorder radius='md' p='sm'>
          <Text size='xs' c='dimmed'>
            Total a cobrar
          </Text>
          <Text fw={700} size='xl' data-testid='biomed-inv-cobro-total'>
            {pesos(d.total)}
          </Text>
        </Card>
        {d.sinValor > 0 && (
          <Alert color='orange' icon={<IconCurrencyDollar size={18} />} maw={520}>
            {d.sinValor} equipo(s) sin valor unitario: asígnelo en «Valores unitarios» y el cobro se completa solo.
          </Alert>
        )}
      </Group>
      <Table striped highlightOnHover verticalSpacing='xs' fz='sm' data-testid='biomed-inv-cobros'>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Cliente</Table.Th>
            <Table.Th ta='right'>Faltantes</Table.Th>
            <Table.Th ta='right'>Dañados</Table.Th>
            <Table.Th ta='right'>Sin valor</Table.Th>
            <Table.Th ta='right'>Total</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {d.clientes.map((x) => (
            <Table.Tr key={x.cliente} style={{ cursor: 'pointer' }} bg={cliente === x.cliente ? 'var(--mantine-color-blue-light)' : undefined} onClick={() => setCliente(cliente === x.cliente ? null : x.cliente)}>
              <Table.Td>{x.cliente}</Table.Td>
              <Table.Td ta='right'>{x.faltantes}</Table.Td>
              <Table.Td ta='right'>{x.danados}</Table.Td>
              <Table.Td ta='right'>{x.sinValor || '—'}</Table.Td>
              <Table.Td ta='right' fw={600}>
                {pesos(x.total)}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Text size='sm' fw={600}>
        Detalle{cliente ? ` · ${cliente}` : ''} ({detalle.length})
      </Text>
      <Table.ScrollContainer minWidth={900}>
        <Table striped verticalSpacing={4} fz='sm'>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Serie</Table.Th>
              <Table.Th>Equipo</Table.Th>
              <Table.Th>Código</Table.Th>
              <Table.Th>Estado</Table.Th>
              <Table.Th>Sede</Table.Th>
              <Table.Th>Observación</Table.Th>
              <Table.Th>Desde</Table.Th>
              <Table.Th ta='right'>Valor</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {detalle.map((e) => (
              <Table.Tr key={e.id}>
                <Table.Td ff='monospace'>{e.serie}</Table.Td>
                <Table.Td>{e.equipo}</Table.Td>
                <Table.Td>{e.codigoInterno ?? '—'}</Table.Td>
                <Table.Td>
                  <Badge variant='light' color={COLOR[e.estado]}>
                    {ETIQUETA[e.estado]}
                  </Badge>
                </Table.Td>
                <Table.Td>{e.sede ?? '—'}</Table.Td>
                <Table.Td>{e.observacion ?? '—'}</Table.Td>
                <Table.Td>{fecha(e.novedadAt)}</Table.Td>
                <Table.Td ta='right'>{pesos(e.valorCobro)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Stack>
  );
}

// ── Valores unitarios ─────────────────────────────────────────────────────

function Valores({ idCompany, onCambio }: { idCompany: number; onCambio: () => void }) {
  const v = useSgcFetch<{ valores: { codigo: string; descripciones: string[]; equipos: number; valor: number | null; updatedBy: string | null; updatedAt: string | null }[] }>(`/api/biomedica/inventario/valores?company=${idCompany}`);
  const [edit, setEdit] = useState<Record<string, number | string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const guardar = async (codigo: string) => {
    setBusy(codigo);
    setMsg(null);
    try {
      const res = await sgcSend<{ valor: number; cobrosCompletados: number }>('/api/biomedica/inventario/valores', 'POST', { company: idCompany, codigo, valor: edit[codigo] });
      setMsg({ ok: true, text: `Código ${codigo}: ${pesos(res.valor)}${res.cobrosCompletados ? ` · se completó el cobro de ${res.cobrosCompletados} equipo(s)` : ''}.` });
      setEdit((e) => {
        const n = { ...e };
        delete n[codigo];
        return n;
      });
      v.reload();
      onCambio();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };
  if (v.error) return <Alert color='orange'>{v.error}</Alert>;
  if (!v.data)
    return (
      <Group justify='center' my='xl'>
        <Loader />
      </Group>
    );
  return (
    <Stack gap='sm'>
      <Text size='sm' c='dimmed'>
        Valor unitario por código interno, para cobrar los equipos faltantes o dañados. Lo ya marcado conserva el valor con que se marcó; lo que se marcó sin valor lo toma al guardarlo.
      </Text>
      {msg && (
        <Alert color={msg.ok ? 'green' : 'red'} withCloseButton onClose={() => setMsg(null)}>
          {msg.text}
        </Alert>
      )}
      {v.data.valores.length === 0 ? (
        <Alert color='gray'>Aún no hay códigos internos: cargue el inventario primero.</Alert>
      ) : (
        <Table striped verticalSpacing='xs' fz='sm' data-testid='biomed-inv-valores'>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Código interno</Table.Th>
              <Table.Th>Equipo / modelo</Table.Th>
              <Table.Th ta='right'>Equipos</Table.Th>
              <Table.Th>Valor unitario (COP)</Table.Th>
              <Table.Th>Actualizado</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {v.data.valores.map((x) => (
              <Table.Tr key={x.codigo}>
                <Table.Td ff='monospace'>{x.codigo}</Table.Td>
                <Table.Td>{x.descripciones.join(' | ') || '—'}</Table.Td>
                <Table.Td ta='right'>{x.equipos.toLocaleString('es-CO')}</Table.Td>
                <Table.Td>
                  <NumberInput size='xs' w={180} min={0} decimalScale={2} thousandSeparator='.' decimalSeparator=',' prefix='$ ' value={edit[x.codigo] ?? x.valor ?? ''} onChange={(n) => setEdit({ ...edit, [x.codigo]: n })} aria-label={`Valor ${x.codigo}`} />
                </Table.Td>
                <Table.Td>{x.updatedAt ? `${fecha(x.updatedAt)} · ${x.updatedBy}` : '—'}</Table.Td>
                <Table.Td>
                  <Button size='xs' variant='light' disabled={edit[x.codigo] === undefined || edit[x.codigo] === ''} loading={busy === x.codigo} onClick={() => void guardar(x.codigo)}>
                    Guardar
                  </Button>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Stack>
  );
}

// ── Cargue masivo con simulación ──────────────────────────────────────────

type Simulacion = {
  hoja: string;
  leidas: number;
  nuevos: number;
  cambios: number;
  iguales: number;
  errores: number;
  noEnArchivo: number;
  muestraNuevos: (Record<string, string | null> & { fila: number })[];
  muestraCambios: { fila: number; serie: string; campos: { campo: string; antes: string | null; despues: string | null }[]; estado: { antes: string; despues: string } | null }[];
  muestraErrores: { fila: number; serie: string | null; motivo: string }[];
};

function descargar(buf: ArrayBuffer, nombre: string) {
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * «Cargue masivo (Excel)»: el modal de cargue masivo de SynerLink (Registros sanitarios, listado maestro del
 * SGC): «Descargar plantilla», «Subir archivo», «Simular» y «Cargar», con el reporte por filas.
 */
function CargueModal({ idCompany, empresa, resumen, onClose, onDone }: { idCompany: number; empresa: string; resumen: ResumenInventario | null; onClose: () => void; onDone: (msg: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [sim, setSim] = useState<Simulacion | null>(null);
  const [justificacion, setJustificacion] = useState('');
  const [busy, setBusy] = useState<'simular' | 'aplicar' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const plantilla = async () => {
    try {
      const { construirPlantillaInventario, PLANTILLA_INVENTARIO_NOMBRE } = await import('../../../lib/biomedica/inventarioPlantilla');
      descargar(await construirPlantillaInventario(empresa, resumen?.plantillas ?? {}), PLANTILLA_INVENTARIO_NOMBRE);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const enviar = async (modo: 'simular' | 'aplicar') => {
    if (!file) return;
    setBusy(modo);
    setError(null);
    try {
      const form = new FormData();
      form.append('company', String(idCompany));
      form.append('file', file);
      form.append('modo', modo);
      form.append('justificacion', justificacion);
      const res = await fetch('/api/biomedica/inventario/cargue', { method: 'POST', body: form });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(String(body.error || `Error ${res.status}`));
      if (modo === 'simular') setSim(body as unknown as Simulacion);
      else onDone(`Cargue masivo: ${Number(body.creados).toLocaleString('es-CO')} equipo(s) nuevo(s) y ${Number(body.actualizados).toLocaleString('es-CO')} actualizado(s).`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const puedeAplicar = sim !== null && sim.errores === 0 && sim.nuevos + sim.cambios > 0 && (sim.cambios === 0 || justificacion.trim().length >= 5);
  const tarjetas = useMemo(
    () =>
      sim
        ? [
            { t: 'Filas leídas', n: sim.leidas, c: 'dark' },
            { t: 'Nuevos', n: sim.nuevos, c: 'green' },
            { t: 'Con cambios', n: sim.cambios, c: 'orange' },
            { t: 'Sin cambios', n: sim.iguales, c: 'gray' },
            { t: 'Con error', n: sim.errores, c: 'red' },
            { t: 'En el inventario y no en el archivo', n: sim.noEnArchivo, c: 'gray' },
          ]
        : [],
    [sim]
  );

  return (
    <Modal opened onClose={onClose} title={<Text fw={700}>Cargue masivo del inventario (Excel)</Text>} size='90rem' closeOnClickOutside={false} data-testid='biomed-inv-cargue'>
    <Stack gap='sm'>
      <Text size='sm' c='dimmed'>
        Descargue la plantilla (formato OLP-GCC-04-FR-017), llénela con uno o varios equipos y súbala. Basta la serie, el modelo y la ubicación: si el modelo ya está en el inventario, el equipo, el código, la marca y la clasificación se completan solos. Primero se SIMULA: no se escribe nada hasta «Cargar». Si una serie ya existe, la fila actualiza ese equipo; lo que está en «Bodega» queda en bodega y lo demás, distribuido. Un faltante o dañado no lo cambia un archivo.
      </Text>
      {error && (
        <Alert color='red' icon={<IconAlertTriangle size={18} />} withCloseButton onClose={() => setError(null)} data-testid='biomed-inv-cargue-error'>
          {error}
        </Alert>
      )}
      <Group>
        <Button variant='light' leftSection={<IconDownload size={16} />} onClick={() => void plantilla()} data-testid='biomed-inv-plantilla'>
          Descargar plantilla
        </Button>
        <FileButton
          onChange={(x) => {
            setFile(x);
            setSim(null);
          }}
          accept='.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        >
          {(props) => (
            <Button {...props} variant='default' leftSection={<IconUpload size={16} />} data-testid='biomed-inv-archivo'>
              Subir archivo
            </Button>
          )}
        </FileButton>
        {file && (
          <Text size='sm'>
            Archivo: <b>{file.name}</b>
          </Text>
        )}
      </Group>

      {sim && (
        <>
          <SimpleGrid cols={{ base: 2, sm: 3, lg: 6 }}>
            {tarjetas.map((x) => (
              <Card key={x.t} withBorder radius='md' p='sm'>
                <Text size='xs' c='dimmed'>
                  {x.t}
                </Text>
                <Text fw={700} size='lg' c={x.n > 0 ? x.c : 'dimmed'}>
                  {x.n.toLocaleString('es-CO')}
                </Text>
              </Card>
            ))}
          </SimpleGrid>
          {sim.errores > 0 && (
            <>
              <Alert color='red'>Corrija las filas con error en el Excel y vuelva a simular: el cargue no se aplica con errores.</Alert>
              <Table striped fz='sm' verticalSpacing={4}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Fila</Table.Th>
                    <Table.Th>Serie</Table.Th>
                    <Table.Th>Motivo</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {sim.muestraErrores.map((x) => (
                    <Table.Tr key={x.fila}>
                      <Table.Td>{x.fila}</Table.Td>
                      <Table.Td>{x.serie ?? '—'}</Table.Td>
                      <Table.Td>{x.motivo}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </>
          )}
          {sim.cambios > 0 && (
            <>
              <Text size='sm' fw={600}>
                Cambios ({sim.cambios.toLocaleString('es-CO')}{sim.cambios > sim.muestraCambios.length ? `, se muestran ${sim.muestraCambios.length}` : ''})
              </Text>
              <Table.ScrollContainer minWidth={700}>
                <Table striped fz='sm' verticalSpacing={4}>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Fila</Table.Th>
                      <Table.Th>Serie</Table.Th>
                      <Table.Th>Qué cambia</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {sim.muestraCambios.map((x) => (
                      <Table.Tr key={x.serie}>
                        <Table.Td>{x.fila}</Table.Td>
                        <Table.Td ff='monospace'>{x.serie}</Table.Td>
                        <Table.Td>
                          {[...x.campos.map((c) => `${c.campo}: ${c.antes ?? '—'} → ${c.despues ?? '—'}`), ...(x.estado ? [`estado: ${ETIQUETA[x.estado.antes as EstadoEquipo]} → ${ETIQUETA[x.estado.despues as EstadoEquipo]}`] : [])].join(' · ')}
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </>
          )}
          {sim.nuevos > 0 && (
            <>
              <Text size='sm' fw={600}>
                Nuevos ({sim.nuevos.toLocaleString('es-CO')}{sim.nuevos > sim.muestraNuevos.length ? `, se muestran ${sim.muestraNuevos.length}` : ''})
              </Text>
              <Table.ScrollContainer minWidth={900}>
                <Table striped fz='sm' verticalSpacing={4}>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Fila</Table.Th>
                      <Table.Th>Serie</Table.Th>
                      <Table.Th>Equipo</Table.Th>
                      <Table.Th>Modelo</Table.Th>
                      <Table.Th>Código</Table.Th>
                      <Table.Th>Cliente</Table.Th>
                      <Table.Th>Sede</Table.Th>
                      <Table.Th>Ciudad</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {sim.muestraNuevos.map((x) => (
                      <Table.Tr key={x.fila}>
                        <Table.Td>{x.fila}</Table.Td>
                        <Table.Td ff='monospace'>{x.serie}</Table.Td>
                        <Table.Td>{x.equipo}</Table.Td>
                        <Table.Td>{x.modelo ?? '—'}</Table.Td>
                        <Table.Td>{x.codigo_interno ?? '—'}</Table.Td>
                        <Table.Td>{x.cliente ?? '—'}</Table.Td>
                        <Table.Td>{x.sede ?? '—'}</Table.Td>
                        <Table.Td>{x.ciudad ?? '—'}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </>
          )}
          {sim.errores === 0 && sim.nuevos + sim.cambios > 0 && (
            <Textarea
              label={sim.cambios > 0 ? 'Justificación (obligatoria: el archivo cambia equipos que ya están)' : 'Observación (opcional)'}
              required={sim.cambios > 0}
              autosize
              minRows={2}
              maxLength={1000}
              value={justificacion}
              onChange={(e) => setJustificacion(e.currentTarget.value)}
            />
          )}
          {sim.errores === 0 && sim.nuevos + sim.cambios === 0 && <Alert color='gray'>El archivo no trae nada nuevo ni cambios.</Alert>}
        </>
      )}

      <Group justify='flex-end' mt='sm'>
        <Button variant='default' onClick={onClose} disabled={busy !== null}>
          Cerrar
        </Button>
        <Button variant='light' leftSection={<IconEye size={16} />} disabled={!file} loading={busy === 'simular'} onClick={() => void enviar('simular')} data-testid='biomed-inv-simular'>
          Simular
        </Button>
        <Button disabled={!puedeAplicar} loading={busy === 'aplicar'} onClick={() => void enviar('aplicar')} data-testid='biomed-inv-aplicar'>
          Cargar {sim && sim.nuevos + sim.cambios > 0 ? `(${(sim.nuevos + sim.cambios).toLocaleString('es-CO')})` : ''}
        </Button>
      </Group>
    </Stack>
    </Modal>
  );
}
