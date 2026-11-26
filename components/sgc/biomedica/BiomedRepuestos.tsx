'use client';

import { useState } from 'react';
import { ActionIcon, Alert, Badge, Button, Group, Loader, Modal, NumberInput, SegmentedControl, SimpleGrid, Stack, Switch, Table, Text, TextInput, Textarea, Tooltip } from '@mantine/core';
import { IconArrowDown, IconArrowUp, IconHistory, IconPencil, IconPlus, IconSearch, IconAdjustments } from '@tabler/icons-react';
import { sgcSend, useSgcFetch } from '../useSgcFetch';
import type { RepuestoDto, TipoMov } from '../../../lib/biomedica/repuestos';

/**
 * REPUESTOS E INSUMOS (Ingeniería biomédica, 2026-11-26): inventario aparte del de equipos. Entradas, salidas (ligadas
 * al equipo donde se usó, por su serie) y ajustes con motivo; existencias bajo el mínimo resaltadas; historial.
 */
const campo = { autoComplete: 'off', 'data-1p-ignore': 'true', 'data-lpignore': 'true' } as const;
const n = (v: number) => v.toLocaleString('es-CO', { maximumFractionDigits: 2 });
const fecha = (iso: string) => new Date(iso).toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'short', timeStyle: 'short' });

export default function BiomedRepuestos({ idCompany }: { idCompany: number }) {
  const [tipo, setTipo] = useState<string>('');
  const [q, setQ] = useState('');
  const r = useSgcFetch<{ items: RepuestoDto[] }>(`/api/biomedica/repuestos?company=${idCompany}${tipo ? `&tipo=${tipo}` : ''}${q.trim().length >= 2 ? `&q=${encodeURIComponent(q.trim())}` : ''}`);
  const [editar, setEditar] = useState<RepuestoDto | 'nuevo' | null>(null);
  const [mov, setMov] = useState<{ rep: RepuestoDto; tipo: TipoMov } | null>(null);
  const [hist, setHist] = useState<number | null>(null);
  const items = r.data?.items ?? [];
  const bajos = items.filter((i) => i.activo && i.bajoMinimo).length;

  return (
    <Stack gap='sm' data-testid='biomed-repuestos'>
      <Group justify='space-between'>
        <Group gap='xs'>
          <SegmentedControl size='xs' value={tipo} onChange={setTipo} data={[{ value: '', label: 'Todos' }, { value: 'repuesto', label: 'Repuestos' }, { value: 'insumo', label: 'Insumos' }]} />
          <TextInput size='xs' leftSection={<IconSearch size={14} />} placeholder='Buscar por nombre, código o modelo' value={q} onChange={(e) => setQ(e.currentTarget.value)} w={280} {...campo} />
        </Group>
        <Button size='xs' leftSection={<IconPlus size={14} />} onClick={() => setEditar('nuevo')} data-testid='biomed-rep-nuevo'>
          Nuevo repuesto o insumo
        </Button>
      </Group>
      {bajos > 0 && (
        <Alert color='orange' variant='light'>
          {bajos} referencia(s) en o por debajo de su existencia mínima.
        </Alert>
      )}
      {r.error && <Alert color='orange'>{r.error}</Alert>}
      {!r.data && !r.error && <Loader />}
      {r.data && (
        <Table striped fz='sm' verticalSpacing='xs'>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Tipo</Table.Th>
              <Table.Th>Código</Table.Th>
              <Table.Th>Nombre</Table.Th>
              <Table.Th>Modelo compatible</Table.Th>
              <Table.Th>Ubicación</Table.Th>
              <Table.Th ta='right'>Existencia</Table.Th>
              <Table.Th ta='right'>Mínimo</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {items.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={8}>
                  <Text c='dimmed' size='sm'>
                    Sin repuestos ni insumos registrados.
                  </Text>
                </Table.Td>
              </Table.Tr>
            )}
            {items.map((it) => (
              <Table.Tr key={it.id} style={it.activo ? undefined : { opacity: 0.5 }}>
                <Table.Td>
                  <Badge variant='light' color={it.tipo === 'repuesto' ? 'blue' : 'grape'}>
                    {it.tipo === 'repuesto' ? 'Repuesto' : 'Insumo'}
                  </Badge>
                </Table.Td>
                <Table.Td>{it.codigo ?? '—'}</Table.Td>
                <Table.Td>{it.nombre}</Table.Td>
                <Table.Td>{it.modeloCompatible ?? '—'}</Table.Td>
                <Table.Td>{it.ubicacion ?? '—'}</Table.Td>
                <Table.Td ta='right'>
                  <Text fw={600} c={it.bajoMinimo ? 'orange' : undefined} size='sm'>
                    {n(it.stock)} {it.unidad}
                  </Text>
                </Table.Td>
                <Table.Td ta='right'>{it.stockMinimo === null ? '—' : n(it.stockMinimo)}</Table.Td>
                <Table.Td>
                  <Group gap={2} wrap='nowrap'>
                    <Tooltip label='Entrada'>
                      <ActionIcon variant='subtle' color='green' aria-label='Entrada' disabled={!it.activo} onClick={() => setMov({ rep: it, tipo: 'entrada' })}>
                        <IconArrowDown size={16} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label='Salida (uso en un equipo)'>
                      <ActionIcon variant='subtle' color='red' aria-label='Salida' disabled={!it.activo || it.stock <= 0} onClick={() => setMov({ rep: it, tipo: 'salida' })}>
                        <IconArrowUp size={16} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label='Ajuste por conteo'>
                      <ActionIcon variant='subtle' aria-label='Ajuste' disabled={!it.activo} onClick={() => setMov({ rep: it, tipo: 'ajuste' })}>
                        <IconAdjustments size={16} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label='Historial'>
                      <ActionIcon variant='subtle' aria-label='Historial' onClick={() => setHist(it.id)}>
                        <IconHistory size={16} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label='Editar datos'>
                      <ActionIcon variant='subtle' aria-label='Editar' onClick={() => setEditar(it)}>
                        <IconPencil size={16} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
      {editar && <RepuestoModal idCompany={idCompany} rep={editar === 'nuevo' ? null : editar} onClose={() => setEditar(null)} onDone={() => { setEditar(null); r.reload(); }} />}
      {mov && <MovModal idCompany={idCompany} rep={mov.rep} tipo={mov.tipo} onClose={() => setMov(null)} onDone={() => { setMov(null); r.reload(); }} />}
      {hist !== null && <HistModal idCompany={idCompany} id={hist} onClose={() => setHist(null)} />}
    </Stack>
  );
}

function RepuestoModal({ idCompany, rep, onClose, onDone }: { idCompany: number; rep: RepuestoDto | null; onClose: () => void; onDone: () => void }) {
  const [v, setV] = useState({
    tipo: rep?.tipo ?? 'repuesto',
    codigo: rep?.codigo ?? '',
    nombre: rep?.nombre ?? '',
    unidad: rep?.unidad ?? 'unidad',
    modeloCompatible: rep?.modeloCompatible ?? '',
    ubicacion: rep?.ubicacion ?? '',
    stockMinimo: rep?.stockMinimo ?? ('' as number | string),
    itemCodeSap: rep?.itemCodeSap ?? '',
    activo: rep?.activo ?? true,
    stockInicial: '' as number | string,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (p: Partial<typeof v>) => setV((x) => ({ ...x, ...p }));
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await sgcSend('/api/biomedica/repuestos', 'POST', { company: idCompany, id: rep?.id ?? null, ...v });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal opened onClose={onClose} size='lg' title={<Text fw={700}>{rep ? `Editar · ${rep.nombre}` : 'Nuevo repuesto o insumo'}</Text>}>
      <Stack gap='sm'>
        <SegmentedControl value={v.tipo} onChange={(x) => set({ tipo: x as typeof v.tipo })} data={[{ value: 'repuesto', label: 'Repuesto' }, { value: 'insumo', label: 'Insumo' }]} w='fit-content' />
        <SimpleGrid cols={2} spacing='xs'>
          <TextInput label='Nombre' required value={v.nombre} onChange={(e) => set({ nombre: e.currentTarget.value })} {...campo} />
          <TextInput label='Código' value={v.codigo} onChange={(e) => set({ codigo: e.currentTarget.value })} {...campo} />
          <TextInput label='Unidad' value={v.unidad} onChange={(e) => set({ unidad: e.currentTarget.value })} {...campo} />
          <TextInput label='Modelo compatible' value={v.modeloCompatible} onChange={(e) => set({ modeloCompatible: e.currentTarget.value })} {...campo} />
          <TextInput label='Ubicación' value={v.ubicacion} onChange={(e) => set({ ubicacion: e.currentTarget.value })} {...campo} />
          <NumberInput label='Existencia mínima' min={0} decimalScale={2} value={v.stockMinimo} onChange={(x) => set({ stockMinimo: x })} />
          <TextInput label='Artículo de SAP (opcional)' value={v.itemCodeSap} onChange={(e) => set({ itemCodeSap: e.currentTarget.value })} {...campo} />
          {!rep && <NumberInput label='Existencia inicial' min={0} decimalScale={2} value={v.stockInicial} onChange={(x) => set({ stockInicial: x })} />}
        </SimpleGrid>
        {rep && <Switch label='Activo' checked={v.activo} onChange={(e) => set({ activo: e.currentTarget.checked })} />}
        {rep && (
          <Text size='xs' c='dimmed'>
            La existencia no se edita aquí: cambia con entradas, salidas y ajustes.
          </Text>
        )}
        {error && <Alert color='red'>{error}</Alert>}
        <Group justify='flex-end'>
          <Button variant='default' onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={busy} disabled={v.nombre.trim().length < 2} onClick={() => void save()} data-testid='biomed-rep-guardar'>
            Guardar
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function MovModal({ idCompany, rep, tipo, onClose, onDone }: { idCompany: number; rep: RepuestoDto; tipo: TipoMov; onClose: () => void; onDone: () => void }) {
  const [cantidad, setCantidad] = useState<number | string>(tipo === 'ajuste' ? rep.stock : '');
  const [serie, setSerie] = useState('');
  const [referencia, setReferencia] = useState('');
  const [observacion, setObservacion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titulo = tipo === 'entrada' ? 'Entrada' : tipo === 'salida' ? 'Salida' : 'Ajuste por conteo';
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      let idEquipo: number | null = null;
      if (tipo === 'salida' && serie.trim()) {
        const res = await fetch(`/api/biomedica/inventario?company=${idCompany}&q=${encodeURIComponent(serie.trim())}&pageSize=5`, { cache: 'no-store' });
        const d = (await res.json().catch(() => ({}))) as { equipos?: { id: number; serie: string }[] };
        const eq = (d.equipos ?? []).find((x) => x.serie.toLowerCase() === serie.trim().toLowerCase());
        if (!eq) throw new Error(`No hay un equipo con la serie ${serie.trim()} en el inventario.`);
        idEquipo = eq.id;
      }
      await sgcSend(`/api/biomedica/repuestos/${rep.id}`, 'POST', { company: idCompany, tipo, cantidad, idEquipo, referencia, observacion });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal opened onClose={onClose} title={<Text fw={700}>{titulo} · {rep.nombre}</Text>}>
      <Stack gap='sm'>
        <Text size='sm' c='dimmed'>
          Existencia actual: {n(rep.stock)} {rep.unidad}
        </Text>
        <NumberInput label={tipo === 'ajuste' ? 'Existencia contada' : 'Cantidad'} required min={0} decimalScale={2} value={cantidad} onChange={setCantidad} data-testid='biomed-rep-cantidad' />
        {tipo === 'salida' && <TextInput label='Serie del equipo donde se usó (opcional)' value={serie} onChange={(e) => setSerie(e.currentTarget.value)} {...campo} />}
        <TextInput label='Referencia (factura, reporte de mantenimiento…)' value={referencia} onChange={(e) => setReferencia(e.currentTarget.value)} maxLength={100} {...campo} />
        <Textarea label={tipo === 'ajuste' ? 'Motivo del ajuste' : 'Observación'} required={tipo === 'ajuste'} minRows={2} value={observacion} onChange={(e) => setObservacion(e.currentTarget.value)} />
        {error && <Alert color='red'>{error}</Alert>}
        <Group justify='flex-end'>
          <Button variant='default' onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={busy} disabled={cantidad === '' || (tipo === 'ajuste' && observacion.trim().length < 5)} onClick={() => void save()} data-testid='biomed-rep-mover'>
            Registrar
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function HistModal({ idCompany, id, onClose }: { idCompany: number; id: number; onClose: () => void }) {
  const h = useSgcFetch<{ repuesto: RepuestoDto; movimientos: { id: number; tipo: TipoMov; cantidad: number; stockResultante: number; equipo: string | null; referencia: string | null; observacion: string | null; actor: string; at: string }[] }>(
    `/api/biomedica/repuestos/${id}?company=${idCompany}`
  );
  return (
    <Modal opened onClose={onClose} size='xl' title={<Text fw={700}>Historial · {h.data?.repuesto.nombre ?? '…'}</Text>}>
      {h.error ? (
        <Alert color='orange'>{h.error}</Alert>
      ) : !h.data ? (
        <Loader />
      ) : (
        <Table striped fz='sm' verticalSpacing='xs'>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Fecha</Table.Th>
              <Table.Th>Movimiento</Table.Th>
              <Table.Th ta='right'>Cantidad</Table.Th>
              <Table.Th ta='right'>Queda</Table.Th>
              <Table.Th>Equipo</Table.Th>
              <Table.Th>Referencia / observación</Table.Th>
              <Table.Th>Por</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {h.data.movimientos.map((m) => (
              <Table.Tr key={m.id}>
                <Table.Td>{fecha(m.at)}</Table.Td>
                <Table.Td>{m.tipo === 'entrada' ? 'Entrada' : m.tipo === 'salida' ? 'Salida' : 'Ajuste'}</Table.Td>
                <Table.Td ta='right'>{n(m.cantidad)}</Table.Td>
                <Table.Td ta='right'>{n(m.stockResultante)}</Table.Td>
                <Table.Td>{m.equipo ?? '—'}</Table.Td>
                <Table.Td>{[m.referencia, m.observacion].filter(Boolean).join(' · ') || '—'}</Table.Td>
                <Table.Td>{m.actor}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Modal>
  );
}
