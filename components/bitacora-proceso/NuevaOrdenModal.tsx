'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Radio,
  Group,
  Loader,
  Modal,
  ScrollArea,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from '@mantine/core';
import { useDebouncedValue, useMediaQuery } from '@mantine/hooks';
import { IconAlertTriangle, IconSearch, IconX } from '@tabler/icons-react';
import { OT_LIMITS, OT_TURNO_HORARIO, OT_TURNO_LABEL, OT_TURNO_NOMBRE, OT_TURNOS, type OtTurno } from '../../lib/bitacora-proceso/constants';
import { OT_SAP_OP_ESTADO_LABEL, opPorNumero, type SapOpSnapshot } from '../../lib/bitacora-proceso/rules';
import { fmtFecha, otSend, useOtFetch } from './otClient';

/**
 * «Nueva bitácora» (solo supervisor, «desde afuera»). Hora inicio = la del servidor al abrir.
 * Reunión con Farmalógica del 2026-10-14: los OPERARIOS no tienen usuario (A1: se
 * eligen del maestro de la empresa), el ÁREA sale del catálogo (A5: precargada si
 * hay una sola). B1 (2026-10-15): se designan, por separado, el INSPECTOR y el JEFE DE
 * PRODUCCIÓN (usuarios de SynerLink, distintos entre sí y de quien abre). B5: la OP
 * (opcional) se busca entre las PLANIFICADAS y LIBERADAS; al escribir su número exacto
 * se elige sola y completa producto, código y lote.
 * Diseño para CELULAR primero: modal a pantalla completa en el celular, campos de
 * 16 px (sin zoom de iOS), turno con botones grandes, listas con casillas u opciones
 * (sin combobox: en el celular la lista de un Select se cierra sola, ver
 * gotcha-select-mantine-movil) y la OP de SAP con búsqueda + resultados tocables. La OP es OPCIONAL.
 */
interface Usuario {
  id: string;
  name: string;
  email: string;
}

interface OperadorMaestro {
  id_operador: number;
  nombre: string;
  documento: string | null;
}

interface AreaCatalogo {
  id_area: number;
  nombre: string;
}

export default function NuevaOrdenModal({
  opened,
  onClose,
  idCompany,
  onCreated,
}: {
  opened: boolean;
  onClose: () => void;
  idCompany: number;
  onCreated: (orden: { id: number; consecutivo: number }) => void;
}) {
  const mobile = useMediaQuery('(max-width: 48em)') ?? false;
  const usuarios = useOtFetch<{ usuarios: Usuario[] }>(opened ? `/api/bitacora-proceso/usuarios?company=${idCompany}` : null);
  const maestro = useOtFetch<{ operadores: OperadorMaestro[] }>(opened ? `/api/bitacora-proceso/operadores?company=${idCompany}` : null);
  const areasCat = useOtFetch<{ areas: AreaCatalogo[] }>(opened ? `/api/bitacora-proceso/areas?company=${idCompany}` : null);

  const [sapOp, setSapOp] = useState<SapOpSnapshot | null>(null);
  const [opQuery, setOpQuery] = useState('');
  const [opDebounced] = useDebouncedValue(opQuery.trim(), 400);
  const [ops, setOps] = useState<SapOpSnapshot[]>([]);
  const [opBusy, setOpBusy] = useState(false);
  const [opError, setOpError] = useState<string | null>(null);

  const [producto, setProducto] = useState('');
  const [itemCode, setItemCode] = useState<string | null>(null);
  const [lote, setLote] = useState('');
  const [turno, setTurno] = useState<OtTurno | ''>('');
  const [idArea, setIdArea] = useState<string | null>(null);
  const [operarios, setOperarios] = useState<string[]>([]);
  const [filtroOp, setFiltroOp] = useState('');
  const [inspector, setInspector] = useState<string | null>(null);
  const [jefe, setJefe] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!opened) return;
    setSapOp(null);
    setOpQuery('');
    setOps([]);
    setOpError(null);
    setProducto('');
    setItemCode(null);
    setLote('');
    setTurno('');
    setIdArea(null);
    setOperarios([]);
    setFiltroOp('');
    setInspector(null);
    setJefe(null);
    setError(null);
  }, [opened]);

  // A5: si la empresa tiene una sola área activa, viene seleccionada.
  const areas = areasCat.data?.areas ?? [];
  useEffect(() => {
    if (opened && areas.length === 1) setIdArea(String(areas[0].id_area));
  }, [opened, areas]);

  useEffect(() => {
    if (!opened || sapOp || opDebounced.length < 2) {
      setOps([]);
      return;
    }
    let activo = true;
    setOpBusy(true);
    setOpError(null);
    fetch(`/api/bitacora-proceso/sap-op?company=${idCompany}&q=${encodeURIComponent(opDebounced)}`, { cache: 'no-store' })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as { ops?: SapOpSnapshot[]; error?: string };
        if (!res.ok) throw new Error(body.error || `Error ${res.status}`);
        if (!activo) return;
        const lista = body.ops ?? [];
        // B5: número exacto de OP → se elige sola y completa producto, código y lote.
        const exacta = opPorNumero(opDebounced, lista);
        if (exacta) elegirOp(exacta);
        else setOps(lista);
      })
      .catch((e: unknown) => {
        if (activo) setOpError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (activo) setOpBusy(false);
      });
    return () => {
      activo = false;
    };
  }, [opDebounced, opened, sapOp, idCompany]);

  function elegirOp(op: SapOpSnapshot) {
    setSapOp(op);
    setProducto(op.ProductDescription ?? op.ItemNo ?? '');
    setItemCode(op.ItemNo);
    if (op.U_Cod_Lote) setLote(op.U_Cod_Lote);
    setOps([]);
  }
  const quitarOp = () => {
    setSapOp(null);
    setItemCode(null);
  };

  const lista = useMemo(() => {
    const all = maestro.data?.operadores ?? [];
    const f = filtroOp.trim().toLowerCase();
    const filtrados = f ? all.filter((u) => u.nombre.toLowerCase().includes(f) || (u.documento ?? '').toLowerCase().includes(f)) : all;
    // Los ya elegidos siempre arriba, para verlos sin buscar.
    const elegido = (u: OperadorMaestro) => operarios.includes(String(u.id_operador));
    return [...filtrados.filter(elegido), ...filtrados.filter((u) => !elegido(u))];
  }, [maestro.data, filtroOp, operarios]);

  const faltantes = [
    !producto.trim() && 'producto',
    !lote.trim() && 'lote',
    !turno && 'turno',
    areas.length > 0 && !idArea && 'área',
    operarios.length === 0 && 'al menos un operario',
    !inspector && 'inspector',
    !jefe && 'jefe de producción',
  ].filter(Boolean);

  const submit = async () => {
    if (faltantes.length) {
      setError(`Complete: ${faltantes.join(', ')}.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await otSend<{ orden: { id: number; consecutivo: number } }>('/api/bitacora-proceso', 'POST', {
        company: idCompany,
        producto,
        itemCode,
        lote,
        turno,
        idArea: idArea ? Number(idArea) : null,
        operadores: operarios.map(Number),
        inspector,
        jefeProduccion: jefe,
        sapOp,
      });
      onCreated(res.orden);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={<Text fw={700} size='lg'>Nueva bitácora</Text>}
      fullScreen={mobile}
      size='lg'
      radius={mobile ? 0 : 'md'}
      closeOnClickOutside={!busy}
      data-testid='ot-nueva-modal'
    >
      <Stack gap='md' pb={mobile ? 96 : 0}>
        {error && (
          <Alert color='red' icon={<IconAlertTriangle size={18} />} withCloseButton onClose={() => setError(null)} data-testid='ot-nueva-error'>
            {error}
          </Alert>
        )}

        <Box>
          <Text fw={600} size='md' mb={4}>
            Orden de producción de SAP <Text span c='dimmed' fw={400}>(opcional)</Text>
          </Text>
          {sapOp ? (
            <Card withBorder radius='md' p='sm' data-testid='ot-op-elegida'>
              <Group justify='space-between' wrap='nowrap' align='flex-start'>
                <div style={{ minWidth: 0 }}>
                  <Group gap={6}>
                    <Text fw={700}>OP {sapOp.DocumentNumber}</Text>
                    {sapOp.ProductionOrderStatus && <Badge variant='light' color={sapOp.ProductionOrderStatus === 'boposPlanned' ? 'yellow' : 'green'}>{OT_SAP_OP_ESTADO_LABEL[sapOp.ProductionOrderStatus] ?? sapOp.ProductionOrderStatus}</Badge>}
                  </Group>
                  <Text size='sm'>{sapOp.ItemNo} · {sapOp.ProductDescription}</Text>
                  <Text size='sm' c='dimmed'>
                    Lote {sapOp.U_Cod_Lote ?? '—'} · Vence {fmtFecha(sapOp.U_FecVen_lote)} · Bodega {sapOp.Warehouse ?? '—'}
                  </Text>
                </div>
                <ActionIcon variant='subtle' color='gray' size='xl' onClick={quitarOp} aria-label='Quitar la OP' title='Quitar la OP' data-testid='ot-op-quitar'>
                  <IconX size={20} />
                </ActionIcon>
              </Group>
            </Card>
          ) : (
            <Stack gap={6}>
              <TextInput
                size='md'
                placeholder='Buscar por número de OP, artículo, producto o lote'
                leftSection={<IconSearch size={18} />}
                rightSection={opBusy ? <Loader size='xs' /> : null}
                value={opQuery}
                onChange={(e) => setOpQuery(e.currentTarget.value)}
                data-testid='ot-op-buscar'
              />
              <Text size='xs' c='dimmed'>OP planificadas o liberadas. Escriba el número de la OP para traer el producto y el lote. Consulta de solo lectura: no se modifica nada en SAP.</Text>
              {opError && (
                <Alert color='yellow' icon={<IconAlertTriangle size={16} />}>
                  {opError}
                </Alert>
              )}
              {ops.length > 0 && (
                <Stack gap={6} data-testid='ot-op-resultados'>
                  {ops.map((op) => (
                    <UnstyledButton key={op.AbsoluteEntry} onClick={() => elegirOp(op)} style={{ display: 'block', width: '100%' }}>
                      <Card withBorder radius='md' p='sm' mih={64}>
                        <Group gap={6} wrap='nowrap'>
                          <Text fw={600}>OP {op.DocumentNumber} · {op.ItemNo}</Text>
                          {op.ProductionOrderStatus && <Badge variant='light' color={op.ProductionOrderStatus === 'boposPlanned' ? 'yellow' : 'green'}>{OT_SAP_OP_ESTADO_LABEL[op.ProductionOrderStatus] ?? op.ProductionOrderStatus}</Badge>}
                        </Group>
                        <Text size='sm'>{op.ProductDescription}</Text>
                        <Text size='sm' c='dimmed'>
                          Lote {op.U_Cod_Lote ?? '—'} · {op.Warehouse ?? ''}
                        </Text>
                      </Card>
                    </UnstyledButton>
                  ))}
                </Stack>
              )}
              {!opBusy && !opError && opDebounced.length >= 2 && ops.length === 0 && (
                <Text size='sm' c='dimmed'>Sin OP planificadas o liberadas que coincidan. Puede escribir el producto y el lote a mano.</Text>
              )}
            </Stack>
          )}
        </Box>

        <TextInput
          size='md'
          label='Producto'
          required
          maxLength={OT_LIMITS.producto}
          value={producto}
          onChange={(e) => setProducto(e.currentTarget.value)}
          data-testid='ot-producto'
        />
        <TextInput
          size='md'
          label='Lote'
          required
          maxLength={OT_LIMITS.lote}
          value={lote}
          onChange={(e) => setLote(e.currentTarget.value)}
          data-testid='ot-lote'
        />
        <Box>
          <Text fw={500} size='md' mb={4}>
            Turno <Text span c='red'>*</Text>
          </Text>
          <SegmentedControl
            fullWidth
            size='lg'
            value={turno}
            onChange={(v) => setTurno(v as OtTurno)}
            data={OT_TURNOS.map((t) => ({
              value: t,
              label: (
                <Box component='span' display='block' lh={1.2} aria-label={OT_TURNO_LABEL[t]}>
                  <Text span fw={600} display='block'>{OT_TURNO_NOMBRE[t]}</Text>
                  <Text span size='sm' display='block'>{OT_TURNO_HORARIO[t]}</Text>
                </Box>
              ),
            }))}
            data-testid='ot-turno'
          />
        </Box>
        <Box>
          <Text fw={500} size='md' mb={4}>
            Área {areas.length > 0 && <Text span c='red'>*</Text>}
          </Text>
          {areasCat.loading ? (
            <Loader size='sm' />
          ) : areasCat.error ? (
            <Alert color='red'>{areasCat.error}</Alert>
          ) : areas.length === 0 ? (
            <Text size='sm' c='dimmed'>La empresa no tiene áreas en el catálogo: la bitácora queda sin área.</Text>
          ) : (
            <Radio.Group value={idArea} onChange={setIdArea}>
              <Stack gap={6} data-testid='ot-area'>
                {areas.map((a) => (
                  <Radio.Card key={a.id_area} value={String(a.id_area)} radius='md' p='sm' withBorder>
                    <Group wrap='nowrap' gap='sm' mih={40}>
                      <Radio.Indicator size='md' />
                      <Text fw={500}>{a.nombre}</Text>
                    </Group>
                  </Radio.Card>
                ))}
              </Stack>
            </Radio.Group>
          )}
        </Box>

        <Box>
          <Group justify='space-between' mb={4}>
            <Text fw={500} size='md'>
              Operarios <Text span c='red'>*</Text>
            </Text>
            <Badge variant='light' size='lg'>{operarios.length === 1 ? '1 seleccionado' : `${operarios.length} seleccionados`}</Badge>
          </Group>
          <Text size='xs' c='dimmed' mb={6}>
            Los operarios no tienen usuario: en la tablet cada uno toca su nombre y la actividad. Se administran en el catálogo (Operarios).
          </Text>
          <TextInput
            size='md'
            placeholder='Buscar operario'
            leftSection={<IconSearch size={18} />}
            value={filtroOp}
            onChange={(e) => setFiltroOp(e.currentTarget.value)}
            mb={6}
            data-testid='ot-operarios-buscar'
          />
          {maestro.loading ? (
            <Loader size='sm' />
          ) : maestro.error ? (
            <Alert color='red'>{maestro.error}</Alert>
          ) : (maestro.data?.operadores ?? []).length === 0 ? (
            <Alert color='yellow' icon={<IconAlertTriangle size={16} />}>
              No hay operarios activos en el maestro. Agréguelos en el catálogo (Operarios) antes de abrir la bitácora.
            </Alert>
          ) : (
            <ScrollArea.Autosize mah={mobile ? 320 : 260} type='auto' offsetScrollbars>
              <Checkbox.Group value={operarios} onChange={setOperarios}>
                <Stack gap={6} data-testid='ot-operarios'>
                  {lista.map((u) => (
                    <Checkbox.Card key={u.id_operador} value={String(u.id_operador)} radius='md' p='sm' withBorder>
                      <Group wrap='nowrap' gap='sm' mih={40}>
                        <Checkbox.Indicator size='md' />
                        <div style={{ minWidth: 0 }}>
                          <Text fw={500} truncate>{u.nombre}</Text>
                          {u.documento && <Text size='xs' c='dimmed' truncate>Doc. {u.documento}</Text>}
                        </div>
                      </Group>
                    </Checkbox.Card>
                  ))}
                  {lista.length === 0 && <Text size='sm' c='dimmed'>Sin coincidencias.</Text>}
                </Stack>
              </Checkbox.Group>
            </ScrollArea.Autosize>
          )}
        </Box>

        <PersonaPicker
          titulo='Inspector'
          descripcion='Da su visto bueno después del cierre del supervisor.'
          usuarios={usuarios.data?.usuarios ?? null}
          value={inspector}
          onChange={setInspector}
          excluir={jefe}
          mobile={mobile}
          testId='ot-inspector'
        />
        <PersonaPicker
          titulo='Jefe de producción'
          descripcion='Da el último visto bueno, después del inspector.'
          usuarios={usuarios.data?.usuarios ?? null}
          value={jefe}
          onChange={setJefe}
          excluir={inspector}
          mobile={mobile}
          testId='ot-jefe'
        />

        <Box
          pos={mobile ? 'fixed' : 'static'}
          bottom={0}
          left={0}
          right={0}
          p={mobile ? 'md' : 0}
          bg='var(--mantine-color-body)'
          style={mobile ? { borderTop: '1px solid var(--mantine-color-default-border)', zIndex: 2 } : undefined}
        >
          <Group grow={mobile} justify='flex-end' gap='sm'>
            <Button variant='default' size='lg' onClick={onClose} disabled={busy}>
              Cancelar
            </Button>
            <Button size='lg' onClick={submit} loading={busy} data-testid='ot-abrir'>
              Abrir bitácora
            </Button>
          </Group>
        </Box>
      </Stack>
    </Modal>
  );
}

/** Lista de personas (usuarios de la empresa) con búsqueda; sin combobox (celular). */
function PersonaPicker({
  titulo,
  descripcion,
  usuarios,
  value,
  onChange,
  excluir,
  mobile,
  testId,
}: {
  titulo: string;
  descripcion: string;
  usuarios: Usuario[] | null;
  value: string | null;
  onChange: (v: string | null) => void;
  /** La otra persona ya elegida (inspector y jefe son distintos). */
  excluir: string | null;
  mobile: boolean;
  testId: string;
}) {
  const [filtro, setFiltro] = useState('');
  const lista = useMemo(() => {
    const all = (usuarios ?? []).filter((u) => u.id !== excluir);
    const f = filtro.trim().toLowerCase();
    const filtrados = f ? all.filter((u) => u.name.toLowerCase().includes(f) || u.email.toLowerCase().includes(f)) : all;
    return [...filtrados.filter((u) => u.id === value), ...filtrados.filter((u) => u.id !== value)];
  }, [usuarios, filtro, value, excluir]);
  return (
    <Box>
      <Text fw={500} size='md' mb={4}>
        {titulo} <Text span c='red'>*</Text>
      </Text>
      <Text size='xs' c='dimmed' mb={6}>{descripcion}</Text>
      <TextInput size='md' placeholder='Buscar persona' leftSection={<IconSearch size={18} />} value={filtro} onChange={(e) => setFiltro(e.currentTarget.value)} mb={6} data-testid={`${testId}-buscar`} />
      {usuarios === null ? (
        <Loader size='sm' />
      ) : (
        <ScrollArea.Autosize mah={mobile ? 260 : 200} type='auto' offsetScrollbars>
          <Radio.Group value={value} onChange={onChange}>
            <Stack gap={6} data-testid={testId}>
              {lista.map((u) => (
                <Radio.Card key={u.id} value={u.id} radius='md' p='sm' withBorder>
                  <Group wrap='nowrap' gap='sm' mih={40}>
                    <Radio.Indicator size='md' />
                    <div style={{ minWidth: 0 }}>
                      <Text fw={500} truncate>{u.name}</Text>
                      <Text size='xs' c='dimmed' truncate>{u.email}</Text>
                    </div>
                  </Group>
                </Radio.Card>
              ))}
              {lista.length === 0 && <Text size='sm' c='dimmed'>Sin coincidencias.</Text>}
            </Stack>
          </Radio.Group>
        </ScrollArea.Autosize>
      )}
    </Box>
  );
}
