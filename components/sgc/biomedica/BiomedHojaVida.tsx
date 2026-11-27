'use client';

import React, { useState } from 'react';
import { ActionIcon, Alert, Badge, Button, Card, Group, Loader, Modal, NumberInput, SegmentedControl, SimpleGrid, Stack, Table, Tabs, Text, Textarea, TextInput, Tooltip } from '@mantine/core';
import { IconAlertTriangle, IconBan, IconCheck, IconFileTypePdf, IconHistory, IconPlus, IconTool, IconTrash, IconFiles, IconHeartbeat } from '@tabler/icons-react';
import { sgcSend, useSgcFetch } from '../useSgcFetch';
import { CHEQUEO_SUGERIDO, ETIQUETA_RESULTADO, ETIQUETA_TIPO, TIPOS_MANTENIMIENTO, etiquetaAccion, type ItemChequeo, type ResultadoChequeo, type TipoMantenimiento } from '../../../lib/biomedica/hojaVidaTipos';
import type { HojaVidaDto } from '../../../lib/biomedica/hojaVida';
import type { EstadoEquipo } from '../../../lib/biomedica/inventario';

/**
 * HOJA DE VIDA del equipo (Ingeniería biomédica, fase 3, 2026-11-23; reunión de Nicolás Rivera con Juan Mora):
 * datos de la hoja de vida (ingreso, vida útil, periodicidad del preventivo), «Nuevo mantenimiento» con su lista de
 * chequeo, formatos diligenciados del equipo, trazabilidad (historial) y «Generar reporte» en PDF.
 */

const ETIQUETA_ESTADO: Record<EstadoEquipo, string> = { bodega: 'En bodega', distribuido: 'Distribuido', faltante: 'Faltante', danado: 'Dañado' };
const COLOR_ESTADO: Record<EstadoEquipo, string> = { bodega: 'blue', distribuido: 'teal', faltante: 'orange', danado: 'red' };
const fechaCo = (s: string | null) => (s ? s.split('-').reverse().join('/') : '—');
const fechaHora = (iso: string | null) => (iso ? new Date(iso).toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'short', timeStyle: 'short' }) : '—');
const hoy = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
const campo = { autoComplete: 'off', 'data-1p-ignore': 'true', 'data-lpignore': 'true' } as const;

export default function BiomedHojaVida({ idCompany, idEquipo, onClose, onChanged }: { idCompany: number; idEquipo: number; onClose: () => void; onChanged?: () => void }) {
  const h = useSgcFetch<HojaVidaDto>(`/api/biomedica/inventario/${idEquipo}/hoja-vida?company=${idCompany}`);
  const [tab, setTab] = useState<string | null>('hoja');
  const [nuevo, setNuevo] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cambio = () => {
    h.reload();
    onChanged?.();
  };

  const reporte = async () => {
    setPdfBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/biomedica/inventario/${idEquipo}/hoja-vida/pdf?company=${idCompany}`, { credentials: 'include', cache: 'no-store' });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `No se pudo generar el reporte (HTTP ${res.status}).`);
      const url = URL.createObjectURL(new Blob([await res.arrayBuffer()], { type: 'application/pdf' }));
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPdfBusy(false);
    }
  };

  const d = h.data;
  return (
    <Modal
      opened
      onClose={onClose}
      size='90rem'
      title={
        <Group gap='xs'>
          <IconHeartbeat size={20} />
          <Text fw={700}>Hoja de vida · {d ? `${d.equipo.equipo} · ${d.equipo.serie}` : '…'}</Text>
          {d && (
            <Badge color={COLOR_ESTADO[d.equipo.estado]} variant='light'>
              {ETIQUETA_ESTADO[d.equipo.estado]}
            </Badge>
          )}
        </Group>
      }
      data-testid='biomed-hoja-vida'
    >
      {h.error ? (
        <Alert color='orange'>{h.error}</Alert>
      ) : !d ? (
        <Group justify='center' my='md'>
          <Loader />
        </Group>
      ) : (
        <Stack gap='sm'>
          {error && (
            <Alert color='red' icon={<IconAlertTriangle size={16} />} withCloseButton onClose={() => setError(null)}>
              {error}
            </Alert>
          )}
          <Group justify='space-between'>
            <Text size='sm' c='dimmed'>
              {[d.equipo.marca, d.equipo.modelo, d.equipo.codigoInterno, [d.equipo.cliente, d.equipo.sede, d.equipo.ciudad].filter(Boolean).join(' · ')].filter(Boolean).join(' · ')}
            </Text>
            <Group gap='xs'>
              <Button size='xs' leftSection={<IconPlus size={14} />} onClick={() => setNuevo(true)} data-testid='biomed-mant-nuevo'>
                Nuevo mantenimiento
              </Button>
              <Button size='xs' variant='light' leftSection={<IconFileTypePdf size={14} />} loading={pdfBusy} onClick={() => void reporte()} data-testid='biomed-hv-reporte'>
                Generar reporte
              </Button>
            </Group>
          </Group>
          <Tabs value={tab} onChange={setTab}>
            <Tabs.List>
              <Tabs.Tab value='hoja' leftSection={<IconHeartbeat size={14} />}>
                Hoja de vida
              </Tabs.Tab>
              <Tabs.Tab value='mant' leftSection={<IconTool size={14} />}>
                Mantenimientos ({d.mantenimientos.filter((m) => m.estado === 'vigente').length})
              </Tabs.Tab>
              <Tabs.Tab value='formatos' leftSection={<IconFiles size={14} />}>
                Formatos diligenciados ({d.registros.length})
              </Tabs.Tab>
              <Tabs.Tab value='historial' leftSection={<IconHistory size={14} />}>
                Trazabilidad
              </Tabs.Tab>
            </Tabs.List>
            <Tabs.Panel value='hoja' pt='sm'>
              <Ficha idCompany={idCompany} idEquipo={idEquipo} d={d} onDone={cambio} />
            </Tabs.Panel>
            <Tabs.Panel value='mant' pt='sm'>
              <Mantenimientos idCompany={idCompany} idEquipo={idEquipo} d={d} onDone={cambio} />
            </Tabs.Panel>
            <Tabs.Panel value='formatos' pt='sm'>
              <Formatos d={d} />
            </Tabs.Panel>
            <Tabs.Panel value='historial' pt='sm'>
              <Historial d={d} />
            </Tabs.Panel>
          </Tabs>
        </Stack>
      )}
      {nuevo && d && (
        <NuevoMantenimiento
          idCompany={idCompany}
          idEquipo={idEquipo}
          d={d}
          onClose={() => setNuevo(false)}
          onDone={() => {
            setNuevo(false);
            setTab('mant');
            cambio();
          }}
        />
      )}
    </Modal>
  );
}

function Dato({ label, value, color }: { label: string; value: React.ReactNode; color?: string }) {
  return (
    <Card withBorder padding='xs' radius='md'>
      <Text size='xs' c='dimmed'>
        {label}
      </Text>
      <Text fw={600} c={color}>
        {value}
      </Text>
    </Card>
  );
}

function Ficha({ idCompany, idEquipo, d, onDone }: { idCompany: number; idEquipo: number; d: HojaVidaDto; onDone: () => void }) {
  const f = d.ficha;
  const [fechaIngreso, setFechaIngreso] = useState(f.fechaIngreso ?? '');
  const [vida, setVida] = useState<number | string>(f.vidaUtilAnios ?? '');
  const [periodo, setPeriodo] = useState<number | string>(f.periodicidadMeses ?? '');
  const [just, setJust] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const cambiaEscrito = (f.fechaIngreso && fechaIngreso !== f.fechaIngreso) || (f.vidaUtilAnios !== null && String(vida) !== String(f.vidaUtilAnios)) || (f.periodicidadMeses !== null && String(periodo) !== String(f.periodicidadMeses));
  const guardar = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await sgcSend<{ changed: boolean }>(`/api/biomedica/inventario/${idEquipo}/hoja-vida`, 'PATCH', {
        company: idCompany,
        fechaIngreso: fechaIngreso || null,
        vidaUtilAnios: vida === '' ? null : vida,
        periodicidadMeses: periodo === '' ? null : periodo,
        justificacion: just,
      });
      setMsg({ ok: true, t: r.changed ? 'Hoja de vida actualizada.' : 'No había cambios.' });
      setJust('');
      if (r.changed) onDone();
    } catch (e) {
      setMsg({ ok: false, t: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Stack gap='sm'>
      {msg && (
        <Alert color={msg.ok ? 'green' : 'red'} icon={msg.ok ? <IconCheck size={16} /> : <IconAlertTriangle size={16} />} withCloseButton onClose={() => setMsg(null)}>
          {msg.t}
        </Alert>
      )}
      <SimpleGrid cols={{ base: 2, md: 4 }} spacing='xs'>
        <Dato label='Último preventivo' value={fechaCo(f.ultimoPreventivo)} />
        <Dato label='Próximo preventivo' value={f.proximoMantenimiento ? `${fechaCo(f.proximoMantenimiento)}${f.vencido ? ' · vencido' : ''}` : 'Sin periodicidad'} color={f.vencido ? 'red' : undefined} />
        <Dato label='Fin de vida útil' value={fechaCo(f.finVidaUtil)} />
        <Dato label='Registro sanitario · riesgo' value={[d.equipo.registroSanitario, d.equipo.clasificacionRiesgo].filter(Boolean).join(' · ') || '—'} />
      </SimpleGrid>
      <Card withBorder padding='sm' radius='md'>
        <Text fw={600} size='sm' mb='xs'>
          Datos de la hoja de vida
        </Text>
        <SimpleGrid cols={{ base: 1, md: 3 }} spacing='xs'>
          <TextInput type='date' label='Fecha de ingreso' max={hoy()} value={fechaIngreso} onChange={(e) => setFechaIngreso(e.currentTarget.value)} {...campo} data-testid='biomed-hv-ingreso' />
          <NumberInput label='Vida útil (años)' min={1} max={50} allowDecimal={false} value={vida} onChange={setVida} data-testid='biomed-hv-vida' />
          <NumberInput label='Mantenimiento preventivo cada (meses)' min={1} max={120} allowDecimal={false} value={periodo} onChange={setPeriodo} data-testid='biomed-hv-periodo' />
        </SimpleGrid>
        {cambiaEscrito && <Textarea mt='xs' label='Por qué cambia (queda en el historial)' required minRows={2} value={just} onChange={(e) => setJust(e.currentTarget.value)} />}
        <Group justify='flex-end' mt='xs'>
          <Button size='xs' loading={busy} disabled={Boolean(cambiaEscrito) && just.trim().length < 5} onClick={() => void guardar()} data-testid='biomed-hv-guardar'>
            Guardar
          </Button>
        </Group>
      </Card>
    </Stack>
  );
}

function Mantenimientos({ idCompany, idEquipo, d, onDone }: { idCompany: number; idEquipo: number; d: HojaVidaDto; onDone: () => void }) {
  const [anular, setAnular] = useState<number | null>(null);
  const [motivo, setMotivo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmar = async () => {
    if (anular === null) return;
    setBusy(true);
    setError(null);
    try {
      await sgcSend(`/api/biomedica/inventario/${idEquipo}/mantenimientos/${anular}`, 'POST', { company: idCompany, motivo });
      setAnular(null);
      setMotivo('');
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  if (d.mantenimientos.length === 0) return <Text c='dimmed'>Sin mantenimientos registrados. Use Nuevo mantenimiento.</Text>;
  return (
    <>
      <Table.ScrollContainer minWidth={900}>
        <Table striped verticalSpacing='xs' fz='sm' data-testid='biomed-mant-tabla'>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Fecha</Table.Th>
              <Table.Th>Tipo</Table.Th>
              <Table.Th>Reporte</Table.Th>
              <Table.Th>Lista de chequeo</Table.Th>
              <Table.Th>Observaciones</Table.Th>
              <Table.Th>Responsables</Table.Th>
              <Table.Th>Próximo</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {d.mantenimientos.map((m) => (
              <Table.Tr key={m.id} style={m.estado === 'anulado' ? { opacity: 0.55 } : undefined}>
                <Table.Td>{fechaCo(m.fecha)}</Table.Td>
                <Table.Td>
                  <Badge variant='light' color={m.tipo === 'correctivo' ? 'orange' : m.tipo === 'metrologico' ? 'grape' : 'blue'}>
                    {ETIQUETA_TIPO[m.tipo]}
                  </Badge>
                  {m.estado === 'anulado' && (
                    <Badge ml={4} color='gray' variant='outline'>
                      Anulado
                    </Badge>
                  )}
                </Table.Td>
                <Table.Td>{m.numeroReporte ?? '—'}</Table.Td>
                <Table.Td>
                  {m.checklist.length === 0
                    ? '—'
                    : m.checklist.map((c) => (
                        <Text key={c.item} size='xs' c={c.resultado === 'no_ok' ? 'red' : undefined}>
                          {c.item}: <b>{ETIQUETA_RESULTADO[c.resultado]}</b>
                          {c.nota ? ` (${c.nota})` : ''}
                        </Text>
                      ))}
                </Table.Td>
                <Table.Td>
                  {m.observaciones ?? '—'}
                  {m.estado === 'anulado' && (
                    <Text size='xs' c='dimmed'>
                      Anulado por {m.anuladoPor} el {fechaHora(m.anuladoAt)}: {m.motivoAnulacion}
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>{m.responsables}</Table.Td>
                <Table.Td>{fechaCo(m.proximo)}</Table.Td>
                <Table.Td>
                  {m.estado === 'vigente' && (
                    <Tooltip label='Anular (con motivo)'>
                      <ActionIcon variant='subtle' color='red' aria-label='Anular' onClick={() => setAnular(m.id)}>
                        <IconBan size={16} />
                      </ActionIcon>
                    </Tooltip>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      <Modal opened={anular !== null} onClose={() => setAnular(null)} title={<Text fw={700}>Anular mantenimiento</Text>}>
        <Stack gap='sm'>
          <Text size='sm'>El mantenimiento no se borra: queda anulado en la hoja de vida con su motivo.</Text>
          <Textarea label='Motivo' required minRows={2} value={motivo} onChange={(e) => setMotivo(e.currentTarget.value)} data-testid='biomed-mant-motivo' />
          {error && <Alert color='red'>{error}</Alert>}
          <Group justify='flex-end'>
            <Button variant='default' onClick={() => setAnular(null)}>
              Cancelar
            </Button>
            <Button color='red' loading={busy} disabled={motivo.trim().length < 5} onClick={() => void confirmar()}>
              Anular
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}

function NuevoMantenimiento({ idCompany, idEquipo, d, onClose, onDone }: { idCompany: number; idEquipo: number; d: HojaVidaDto; onClose: () => void; onDone: () => void }) {
  const [fecha, setFecha] = useState(hoy());
  const [tipo, setTipo] = useState<TipoMantenimiento>('preventivo');
  const [reporte, setReporte] = useState('');
  const [responsables, setResponsables] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [items, setItems] = useState<ItemChequeo[]>(CHEQUEO_SUGERIDO.map((item) => ({ item, resultado: 'ok' as ResultadoChequeo, nota: null })));
  const [otro, setOtro] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setItem = (i: number, p: Partial<ItemChequeo>) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const guardar = async () => {
    setBusy(true);
    setError(null);
    try {
      await sgcSend(`/api/biomedica/inventario/${idEquipo}/mantenimientos`, 'POST', { company: idCompany, fecha, tipo, numeroReporte: reporte, responsables, observaciones, checklist: items });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal opened onClose={onClose} size='xl' title={<Text fw={700}>Nuevo mantenimiento · {d.equipo.serie}</Text>} closeOnClickOutside={false} data-testid='biomed-mant-modal'>
      <Stack gap='sm'>
        <SimpleGrid cols={{ base: 1, md: 3 }} spacing='xs'>
          <TextInput type='date' label='Fecha' required max={hoy()} value={fecha} onChange={(e) => setFecha(e.currentTarget.value)} {...campo} data-testid='biomed-mant-fecha' />
          <TextInput label='Número de reporte' value={reporte} onChange={(e) => setReporte(e.currentTarget.value)} maxLength={50} {...campo} />
          <TextInput label='Responsables' required value={responsables} onChange={(e) => setResponsables(e.currentTarget.value)} maxLength={500} {...campo} data-testid='biomed-mant-responsables' />
        </SimpleGrid>
        <div>
          <Text size='sm' fw={500} mb={4}>
            Tipo de mantenimiento
          </Text>
          <SegmentedControl value={tipo} onChange={(v) => setTipo(v as TipoMantenimiento)} data={TIPOS_MANTENIMIENTO.map((t) => ({ value: t, label: ETIQUETA_TIPO[t] }))} data-testid='biomed-mant-tipo' />
          {tipo === 'preventivo' && (
            <Text size='xs' c='dimmed' mt={4}>
              {d.ficha.periodicidadMeses ? `El próximo preventivo queda ${d.ficha.periodicidadMeses} mes(es) después.` : 'Sin periodicidad en la hoja de vida: no se calcula el próximo preventivo.'}
            </Text>
          )}
        </div>
        <Card withBorder padding='xs' radius='md'>
          <Text size='sm' fw={600} mb={4}>
            Lista de chequeo
          </Text>
          <Stack gap={6}>
            {items.map((x, i) => (
              <Group key={x.item} gap='xs' wrap='nowrap'>
                <Text size='sm' w={180}>
                  {x.item}
                </Text>
                <SegmentedControl size='xs' value={x.resultado} onChange={(v) => setItem(i, { resultado: v as ResultadoChequeo })} data={(['ok', 'no_ok', 'na'] as ResultadoChequeo[]).map((r) => ({ value: r, label: ETIQUETA_RESULTADO[r] }))} />
                <TextInput size='xs' placeholder='Nota (opcional)' style={{ flex: 1 }} value={x.nota ?? ''} onChange={(e) => setItem(i, { nota: e.currentTarget.value || null })} maxLength={300} {...campo} />
                <ActionIcon variant='subtle' color='gray' aria-label='Quitar' onClick={() => setItems((xs) => xs.filter((_, j) => j !== i))}>
                  <IconTrash size={14} />
                </ActionIcon>
              </Group>
            ))}
            <Group gap='xs'>
              <TextInput size='xs' placeholder='Otro ítem' value={otro} onChange={(e) => setOtro(e.currentTarget.value)} maxLength={120} {...campo} />
              <Button
                size='xs'
                variant='light'
                disabled={!otro.trim() || items.some((x) => x.item.toLowerCase() === otro.trim().toLowerCase())}
                onClick={() => {
                  setItems((xs) => [...xs, { item: otro.trim(), resultado: 'ok', nota: null }]);
                  setOtro('');
                }}
              >
                Agregar
              </Button>
            </Group>
          </Stack>
        </Card>
        <Textarea label='Observaciones' minRows={2} maxLength={2000} value={observaciones} onChange={(e) => setObservaciones(e.currentTarget.value)} />
        {error && (
          <Alert color='red' icon={<IconAlertTriangle size={16} />}>
            {error}
          </Alert>
        )}
        <Group justify='flex-end'>
          <Button variant='default' onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={busy} disabled={!fecha || responsables.trim().length < 2} onClick={() => void guardar()} data-testid='biomed-mant-guardar'>
            Registrar mantenimiento
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function Formatos({ d }: { d: HojaVidaDto }) {
  if (d.registros.length === 0)
    return (
      <Text c='dimmed' size='sm'>
        Sin formatos diligenciados ligados al equipo. Los formatos de Ingeniería biomédica quedan aquí cuando se diligencian con la serie de este equipo.
      </Text>
    );
  return (
    <Table striped verticalSpacing='xs' fz='sm'>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Formato</Table.Th>
          <Table.Th>Actividad</Table.Th>
          <Table.Th>Estado</Table.Th>
          <Table.Th>Fecha</Table.Th>
          <Table.Th>Diligenció</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {d.registros.map((r) => (
          <Table.Tr key={r.id}>
            <Table.Td>{r.code}</Table.Td>
            <Table.Td>{r.actividad}</Table.Td>
            <Table.Td>{r.estado}</Table.Td>
            <Table.Td>{fechaHora(r.createdAt)}</Table.Td>
            <Table.Td>{r.createdBy}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

function Historial({ d }: { d: HojaVidaDto }) {
  const resumir = (o: Record<string, unknown> | null) =>
    o
      ? Object.entries(o)
          .filter(([, x]) => x !== null && x !== undefined && x !== '')
          .map(([k, x]) => `${k}: ${k === 'estado' ? (ETIQUETA_ESTADO[x as EstadoEquipo] ?? String(x)) : Array.isArray(x) ? x.join(', ') : String(x)}`)
          .join(' · ')
      : '';
  return (
    <Table.ScrollContainer minWidth={700}>
      <Table striped verticalSpacing='xs' fz='sm' data-testid='biomed-inv-historial'>
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
          {d.historial.map((x) => (
            <Table.Tr key={x.id}>
              <Table.Td>{fechaHora(x.at)}</Table.Td>
              <Table.Td>{etiquetaAccion(x.accion)}</Table.Td>
              <Table.Td>{resumir(x.antes)}</Table.Td>
              <Table.Td>{resumir(x.despues)}</Table.Td>
              <Table.Td>{x.justificacion ?? '—'}</Table.Td>
              <Table.Td>{x.actor}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}
