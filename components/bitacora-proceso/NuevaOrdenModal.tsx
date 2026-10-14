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
import { OT_LIMITS, OT_TURNOS, OT_TURNO_LABEL, type OtTurno } from '../../lib/bitacora-proceso/constants';
import type { SapOpSnapshot } from '../../lib/bitacora-proceso/rules';
import { fmtFecha, otSend, useOtFetch } from './otClient';

/**
 * «Nueva bitácora» (solo supervisor). Hora inicio = la del servidor al abrir. Diseño para CELULAR primero:
 * modal a pantalla completa en el celular, campos de 16 px (sin zoom de iOS),
 * turno con botones grandes, auxiliares con casillas e inspector con opciones (sin combobox: en el
 * celular la lista de un Select se cierra sola, ver gotcha-select-mantine-movil)
 * y la OP de SAP con búsqueda + lista de resultados tocables. La OP es OPCIONAL.
 */
interface Usuario {
  id: string;
  name: string;
  email: string;
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
  const [area, setArea] = useState('');
  const [operarios, setOperarios] = useState<string[]>([]);
  const [filtroOp, setFiltroOp] = useState('');
  const [inspector, setInspector] = useState<string | null>(null);
  const [filtroInsp, setFiltroInsp] = useState('');
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
    setArea('');
    setOperarios([]);
    setFiltroOp('');
    setInspector(null);
    setFiltroInsp('');
    setError(null);
  }, [opened]);

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
        if (activo) setOps(body.ops ?? []);
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

  const elegirOp = (op: SapOpSnapshot) => {
    setSapOp(op);
    setProducto(op.ProductDescription ?? op.ItemNo ?? '');
    setItemCode(op.ItemNo);
    if (op.U_Cod_Lote) setLote(op.U_Cod_Lote);
  };
  const quitarOp = () => {
    setSapOp(null);
    setItemCode(null);
  };

  const lista = useMemo(() => {
    const all = usuarios.data?.usuarios ?? [];
    const f = filtroOp.trim().toLowerCase();
    const filtrados = f ? all.filter((u) => u.name.toLowerCase().includes(f) || u.email.toLowerCase().includes(f)) : all;
    // Los ya elegidos siempre arriba, para verlos sin buscar.
    return [...filtrados.filter((u) => operarios.includes(u.id)), ...filtrados.filter((u) => !operarios.includes(u.id))];
  }, [usuarios.data, filtroOp, operarios]);

  const listaInsp = useMemo(() => {
    const all = usuarios.data?.usuarios ?? [];
    const f = filtroInsp.trim().toLowerCase();
    const filtrados = f ? all.filter((u) => u.name.toLowerCase().includes(f) || u.email.toLowerCase().includes(f)) : all;
    return [...filtrados.filter((u) => u.id === inspector), ...filtrados.filter((u) => u.id !== inspector)];
  }, [usuarios.data, filtroInsp, inspector]);

  const faltantes = [!producto.trim() && 'producto', !lote.trim() && 'lote', !turno && 'turno', operarios.length === 0 && 'al menos un auxiliar', !inspector && 'inspector'].filter(Boolean);

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
        area,
        operarios,
        inspector,
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
                  <Text fw={700}>OP {sapOp.DocumentNumber}</Text>
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
              <Text size='xs' c='dimmed'>Solo OP liberadas. Consulta de solo lectura: no se modifica nada en SAP.</Text>
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
                        <Text fw={600}>OP {op.DocumentNumber} · {op.ItemNo}</Text>
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
                <Text size='sm' c='dimmed'>Sin OP liberadas que coincidan. Puede escribir el producto y el lote a mano.</Text>
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
            data={OT_TURNOS.map((t) => ({ value: t, label: OT_TURNO_LABEL[t] }))}
            data-testid='ot-turno'
          />
        </Box>
        <TextInput
          size='md'
          label='Área'
          placeholder='Ej.: Llenado estéril'
          maxLength={OT_LIMITS.area}
          value={area}
          onChange={(e) => setArea(e.currentTarget.value)}
          data-testid='ot-area'
        />

        <Box>
          <Group justify='space-between' mb={4}>
            <Text fw={500} size='md'>
              Auxiliares <Text span c='red'>*</Text>
            </Text>
            <Badge variant='light' size='lg'>{operarios.length === 1 ? '1 seleccionado' : `${operarios.length} seleccionados`}</Badge>
          </Group>
          <Text size='xs' c='dimmed' mb={6}>
            Solo los auxiliares y el inspector podrán registrar en esta bitácora. Cada persona entra con su propio usuario.
          </Text>
          <TextInput
            size='md'
            placeholder='Buscar persona'
            leftSection={<IconSearch size={18} />}
            value={filtroOp}
            onChange={(e) => setFiltroOp(e.currentTarget.value)}
            mb={6}
            data-testid='ot-operarios-buscar'
          />
          {usuarios.loading ? (
            <Loader size='sm' />
          ) : usuarios.error ? (
            <Alert color='red'>{usuarios.error}</Alert>
          ) : (
            <ScrollArea.Autosize mah={mobile ? 320 : 260} type='auto' offsetScrollbars>
              <Checkbox.Group value={operarios} onChange={setOperarios}>
                <Stack gap={6} data-testid='ot-operarios'>
                  {lista.map((u) => (
                    <Checkbox.Card key={u.id} value={u.id} radius='md' p='sm' withBorder>
                      <Group wrap='nowrap' gap='sm' mih={40}>
                        <Checkbox.Indicator size='md' />
                        <div style={{ minWidth: 0 }}>
                          <Text fw={500} truncate>{u.name}</Text>
                          <Text size='xs' c='dimmed' truncate>{u.email}</Text>
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

        <Box>
          <Text fw={500} size='md' mb={4}>
            Inspector <Text span c='red'>*</Text>
          </Text>
          <TextInput
            size='md'
            placeholder='Buscar persona'
            leftSection={<IconSearch size={18} />}
            value={filtroInsp}
            onChange={(e) => setFiltroInsp(e.currentTarget.value)}
            mb={6}
            data-testid='ot-inspector-buscar'
          />
          {usuarios.data && (
            <ScrollArea.Autosize mah={mobile ? 260 : 200} type='auto' offsetScrollbars>
              <Radio.Group value={inspector} onChange={setInspector}>
                <Stack gap={6} data-testid='ot-inspector'>
                  {listaInsp.map((u) => (
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
                  {listaInsp.length === 0 && <Text size='sm' c='dimmed'>Sin coincidencias.</Text>}
                </Stack>
              </Radio.Group>
            </ScrollArea.Autosize>
          )}
        </Box>

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
