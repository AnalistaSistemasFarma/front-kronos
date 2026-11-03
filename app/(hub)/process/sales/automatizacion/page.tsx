'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Alert, Anchor, Badge, Breadcrumbs, Button, Card, Checkbox, Group, Loader, NumberInput, Select, SimpleGrid, Stack, Switch, Table, Tabs, Text, TextInput, Title,
} from '@mantine/core';
import { IconAlertTriangle, IconChevronRight, IconPlayerPlay, IconRobot, IconSearch, IconTestPipe, IconSend } from '@tabler/icons-react';
import toast from 'react-hot-toast';

/**
 * Ventas · Automatización (administración): borradores de pedido que llegan de Salesforce
 * y que la automatización pasa solos al flujo «Oferta de venta». Mismo lineamiento que
 * Transferencias Nabuco: tablero, configuración, asistida (buscar → simular → crear),
 * «Ejecutar ahora» e historial por borrador y por corrida.
 */

type Company = { idCompany: number; companyName: string };
type Config = {
  activo: boolean; simulacion: boolean; intervalo_min: number; user_sign: number | null; desde_fecha: string | null;
  solicitanteEmail: string | null; en_ejecucion_desde: string | null; updated_at: string | null;
} | null;
type Doc = {
  id: number; doc_entry: number; doc_num: number | null; card_code: string | null; card_name: string | null; doc_total: number | null;
  estado: string; destino: string | null; detalle: string | null; error: string | null; id_request_general: number | null;
  intentos: number; updated_at: string; estado_flujo: string | null; order_doc_entry: number | null; error_flujo: string | null;
};
type Run = { id: number; origen: string; inicio: string; fin: string | null; simulacion: boolean; candidatos: number; enviados: number; simulados: number; errores: number; detalle: string | null };
type Pending = { DocEntry: number; DocNum: number | null; CardCode: string; CardName: string; DocTotal: number; DocDate: string };
type Data = { companies: Company[]; companyId: number; config: Config; kpis: Record<string, number>; docs: Doc[]; runs: Run[] };

const fmt = (d?: string | null) => (d ? new Date(d).toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'short', timeStyle: 'short' }) : '—');
const money = (n?: number | null) => (n == null ? '—' : Math.round(Number(n)).toLocaleString('es-CO'));
const ESTADO: Record<string, { label: string; color: string }> = {
  simulado: { label: 'Simulado', color: 'gray' },
  enviado: { label: 'En el flujo', color: 'blue' },
  error: { label: 'Error', color: 'red' },
  descartado: { label: 'Descartado', color: 'dark' },
};
const FLUJO: Record<string, { label: string; color: string }> = {
  pending: { label: 'En curso', color: 'yellow' },
  approved: { label: 'Pedido creado', color: 'green' },
  rejected: { label: 'Rechazada', color: 'orange' },
  publish_error: { label: 'Error al crear pedido', color: 'red' },
  reject_error: { label: 'Error al rechazar', color: 'red' },
  cancelled: { label: 'Cancelada', color: 'gray' },
};
const DESTINO: Record<string, string> = { PEDIDO: 'Pedido directo', AE: 'Extracupo', AP: 'Precio' };

async function call(method: string, body?: unknown, qs = '') {
  const res = await fetch(`/api/sales/automatizacion${qs}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(d.error || `Error ${res.status}`), { data: d });
  return d;
}

export default function VentasAutomatizacionPage() {
  const [companyId, setCompanyId] = useState<number | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState({ activo: false, simulacion: true, intervalo_min: 10, user_sign: '' as string | number, desde_fecha: '', solicitanteEmail: '' });
  const [pending, setPending] = useState<Pending[] | null>(null);
  const [sel, setSel] = useState<number[]>([]);
  const [simRes, setSimRes] = useState<Record<number, { destino?: string | null; detalle?: string; error?: string; estado: string }>>({});

  const load = useCallback(async (cid?: number | null) => {
    try {
      const d: Data = await call('GET', undefined, cid ? `?companyId=${cid}` : '');
      setData(d);
      setCompanyId(d.companyId);
      setError(null);
      const c = d.config;
      setForm({
        activo: Boolean(c?.activo), simulacion: c ? Boolean(c.simulacion) : true, intervalo_min: c?.intervalo_min ?? 10,
        user_sign: c?.user_sign ?? '', desde_fecha: c?.desde_fecha ?? '', solicitanteEmail: c?.solicitanteEmail ?? '',
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    load(null);
  }, [load]);

  const run = async (accion: 'ejecutar' | 'simular' | 'crear', docEntries?: number[]) => {
    if (!companyId) return;
    setBusy(accion);
    try {
      const r = await call('POST', { companyId, accion, docEntries });
      toast.success(r.resumen ?? 'Listo');
      if (accion !== 'ejecutar') {
        const m: typeof simRes = {};
        for (const x of r.resultados ?? []) m[x.docEntry] = x;
        setSimRes((p) => ({ ...p, ...m }));
      }
      await load(companyId);
      if (accion === 'crear') setPending((p) => (p ? p.filter((x) => !(docEntries ?? []).includes(x.DocEntry)) : p));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (error && !data) {
    return (
      <Alert color='yellow' icon={<IconAlertTriangle size={18} />} title='Ventas · Automatización' m='md'>
        {error}
      </Alert>
    );
  }
  if (!data) return <Group justify='center' mt='xl'><Loader /></Group>;
  const cfg = data.config;
  const k = data.kpis ?? {};
  const company = data.companies.find((c) => c.idCompany === companyId);

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--mantine-color-body)' }}>
      <div className='max-w-7xl mx-auto py-3 sm:py-8 px-3 sm:px-6 lg:px-8'>
        <Card shadow='sm' p={{ base: 'md', sm: 'xl' }} radius='md' withBorder mb='md'>
          <Breadcrumbs separator={<IconChevronRight size={16} />} mb='sm' style={{ flexWrap: 'wrap' }}>
            <Anchor component={Link} href='/process'>Procesos</Anchor>
            <Text>Ventas · Automatización</Text>
          </Breadcrumbs>
          <Group justify='space-between' align='flex-end' wrap='wrap' gap='md'>
            <div style={{ minWidth: 0 }}>
              <Title order={1} fz={{ base: 26, sm: 30 }} className='font-bold mb-1 flex items-center gap-3'>
                <IconRobot size={28} style={{ flexShrink: 0, color: 'var(--mantine-primary-color-filled)' }} />
                Ventas · Automatización
              </Title>
              <Text size='md' c='dimmed'>
                {`Borradores de Salesforce que pasan solos al flujo «Oferta de venta» · ${company?.companyName.trim() ?? ''}`}
              </Text>
            </div>
            <Group gap='sm'>
              {data.companies.length > 1 && (
                <Select data={data.companies.map((c) => ({ value: String(c.idCompany), label: c.companyName }))} value={String(companyId)}
                  onChange={(v) => v && load(Number(v))} allowDeselect={false} w={220} />
              )}
              <Badge size='lg' color={cfg?.activo ? (cfg.simulacion ? 'yellow' : 'green') : 'gray'} variant='light'>
                {cfg?.activo ? (cfg.simulacion ? 'Activa · simulación' : 'Activa') : 'Pausada'}
              </Badge>
              <Button leftSection={<IconPlayerPlay size={16} />} loading={busy === 'ejecutar'} disabled={!cfg || cfg.user_sign == null} onClick={() => run('ejecutar')}>
                Ejecutar ahora
              </Button>
            </Group>
          </Group>
          {cfg?.simulacion && (
            <Alert color='yellow' variant='light' mt='md' icon={<IconTestPipe size={18} />}>
              Modo simulación: la automatización solo registra qué haría con cada borrador; no crea solicitudes ni toca SAP. Desde «Asistida» puede pasar al flujo los que elija.
            </Alert>
          )}
        </Card>

        <Tabs defaultValue='tablero' keepMounted={false}>
          <Tabs.List mb='md'>
            <Tabs.Tab value='tablero'>Tablero</Tabs.Tab>
            <Tabs.Tab value='asistida'>Asistida</Tabs.Tab>
            <Tabs.Tab value='configuracion'>Configuración</Tabs.Tab>
            <Tabs.Tab value='corridas'>Corridas</Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value='tablero'>
            <SimpleGrid cols={{ base: 2, sm: 5 }} mb='md'>
              {[
                ['Pasados hoy', k.enviados_hoy, 'blue'],
                ['En curso en el flujo', k.en_flujo, 'yellow'],
                ['Con pedido', k.con_pedido, 'green'],
                ['Simulados', k.simulados, 'gray'],
                ['Con error', k.con_error, 'red'],
              ].map(([label, n, color]) => (
                <Card key={String(label)} withBorder radius='md' p='md'>
                  <Text size='sm' c='dimmed'>{label}</Text>
                  <Text fz={28} fw={700} c={String(color)}>{Number(n ?? 0)}</Text>
                </Card>
              ))}
            </SimpleGrid>
            <Card withBorder radius='md' p='md'>
              <Text fw={600} mb='sm'>Borradores procesados</Text>
              {data.docs.length === 0 ? (
                <Text c='dimmed' size='sm'>Todavía no hay borradores procesados. Use «Ejecutar ahora» o la pestaña «Asistida».</Text>
              ) : (
                <Table.ScrollContainer minWidth={1000}>
                  <Table striped highlightOnHover verticalSpacing='xs'>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Borrador</Table.Th><Table.Th>Cliente</Table.Th><Table.Th>Total</Table.Th><Table.Th>Automatización</Table.Th>
                        <Table.Th>Flujo</Table.Th><Table.Th>Detalle</Table.Th><Table.Th>Actualizado</Table.Th><Table.Th />
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {data.docs.map((d) => (
                        <Table.Tr key={d.id}>
                          <Table.Td>{d.doc_num ?? d.doc_entry}</Table.Td>
                          <Table.Td><Text size='sm'>{d.card_code}</Text><Text size='xs' c='dimmed'>{d.card_name}</Text></Table.Td>
                          <Table.Td>{money(d.doc_total)}</Table.Td>
                          <Table.Td>
                            <Badge color={ESTADO[d.estado]?.color ?? 'gray'} variant='light'>{ESTADO[d.estado]?.label ?? d.estado}</Badge>
                            {d.destino && <Text size='xs' c='dimmed'>{DESTINO[d.destino] ?? d.destino}</Text>}
                          </Table.Td>
                          <Table.Td>
                            {d.estado_flujo ? <Badge color={FLUJO[d.estado_flujo]?.color ?? 'gray'} variant='light'>{FLUJO[d.estado_flujo]?.label ?? d.estado_flujo}</Badge> : '—'}
                            {d.id_request_general && <Text size='xs'><Anchor component={Link} href={`/process/request-general/view-request?id=${d.id_request_general}`}>Solicitud #{d.id_request_general}</Anchor></Text>}
                            {d.order_doc_entry && <Text size='xs' c='dimmed'>Pedido {d.order_doc_entry}</Text>}
                          </Table.Td>
                          <Table.Td style={{ maxWidth: 320 }}>
                            <Text size='xs' c={d.error || d.error_flujo ? 'red' : undefined}>{d.error ?? d.error_flujo ?? d.detalle ?? ''}</Text>
                          </Table.Td>
                          <Table.Td><Text size='xs'>{fmt(d.updated_at)}</Text></Table.Td>
                          <Table.Td>
                            {(d.estado === 'error' || d.estado === 'simulado') && (
                              <Button size='compact-xs' variant='subtle' color='gray' onClick={async () => { await call('POST', { companyId, accion: 'descartar', idDoc: d.id }).catch((e) => toast.error(e.message)); load(companyId); }}>
                                Descartar
                              </Button>
                            )}
                            {d.estado === 'descartado' && (
                              <Button size='compact-xs' variant='subtle' onClick={async () => { await call('POST', { companyId, accion: 'reactivar', idDoc: d.id }).catch((e) => toast.error(e.message)); load(companyId); }}>
                                Reactivar
                              </Button>
                            )}
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
              )}
            </Card>
          </Tabs.Panel>

          <Tabs.Panel value='asistida'>
            <Card withBorder radius='md' p='md'>
              <Group justify='space-between' mb='sm' wrap='wrap'>
                <Text fw={600}>Buscar pendientes → Simular → Pasar al flujo</Text>
                <Group gap='xs'>
                  <Button variant='light' leftSection={<IconSearch size={16} />} loading={busy === 'buscar'} disabled={!cfg || cfg.user_sign == null}
                    onClick={async () => {
                      setBusy('buscar');
                      try {
                        const r = await call('GET', undefined, `?companyId=${companyId}&pendientes=1`);
                        setPending(r.pendientes ?? []);
                        setSel([]);
                        setSimRes({});
                      } catch (e) {
                        toast.error((e as Error).message);
                      } finally {
                        setBusy(null);
                      }
                    }}>
                    Buscar pendientes
                  </Button>
                  <Button variant='light' color='gray' leftSection={<IconTestPipe size={16} />} disabled={!sel.length} loading={busy === 'simular'} onClick={() => run('simular', sel)}>
                    Simular ({sel.length})
                  </Button>
                  <Button leftSection={<IconSend size={16} />} disabled={!sel.length} loading={busy === 'crear'}
                    onClick={() => { if (window.confirm(`Se pasarán ${sel.length} borrador(es) al flujo «Oferta de venta». ¿Continuar?`)) run('crear', sel); }}>
                    Pasar al flujo ({sel.length})
                  </Button>
                </Group>
              </Group>
              {cfg?.user_sign == null && <Alert color='yellow' variant='light' mb='sm'>Configure primero el usuario SAP de la integración en «Configuración».</Alert>}
              {pending == null ? (
                <Text c='dimmed' size='sm'>Pulse «Buscar pendientes» para ver los borradores de Salesforce que aún no pasan al flujo (máximo 30 por acción).</Text>
              ) : pending.length === 0 ? (
                <Text c='dimmed' size='sm'>No hay borradores pendientes.</Text>
              ) : (
                <Table.ScrollContainer minWidth={900}>
                  <Table striped verticalSpacing='xs'>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th w={40}>
                          <Checkbox checked={sel.length > 0 && sel.length === Math.min(30, pending.length)} indeterminate={sel.length > 0 && sel.length < Math.min(30, pending.length)}
                            onChange={(e) => setSel(e.currentTarget.checked ? pending.slice(0, 30).map((p) => p.DocEntry) : [])} aria-label='Elegir todos' />
                        </Table.Th>
                        <Table.Th>Borrador</Table.Th><Table.Th>Fecha</Table.Th><Table.Th>Cliente</Table.Th><Table.Th>Total</Table.Th><Table.Th>Simulación</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {pending.map((p) => {
                        const s = simRes[p.DocEntry];
                        return (
                          <Table.Tr key={p.DocEntry}>
                            <Table.Td>
                              <Checkbox checked={sel.includes(p.DocEntry)} aria-label={`Elegir ${p.DocEntry}`}
                                onChange={(e) => setSel((prev) => (e.currentTarget.checked ? (prev.length < 30 ? [...prev, p.DocEntry] : prev) : prev.filter((x) => x !== p.DocEntry)))} />
                            </Table.Td>
                            <Table.Td>{p.DocNum ?? p.DocEntry}</Table.Td>
                            <Table.Td>{String(p.DocDate ?? '').slice(0, 10)}</Table.Td>
                            <Table.Td><Text size='sm'>{p.CardCode}</Text><Text size='xs' c='dimmed'>{p.CardName}</Text></Table.Td>
                            <Table.Td>{money(p.DocTotal)}</Table.Td>
                            <Table.Td style={{ maxWidth: 360 }}>
                              {s ? (
                                <Text size='xs' c={s.error ? 'red' : undefined}>
                                  {s.estado === 'enviado' ? `Pasado al flujo · ${s.detalle ?? ''}` : s.error ?? `${s.destino ? `${DESTINO[s.destino] ?? s.destino}: ` : ''}${s.detalle ?? ''}`}
                                </Text>
                              ) : (
                                <Text size='xs' c='dimmed'>—</Text>
                              )}
                            </Table.Td>
                          </Table.Tr>
                        );
                      })}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
              )}
            </Card>
          </Tabs.Panel>

          <Tabs.Panel value='configuracion'>
            <Card withBorder radius='md' p='md' maw={720}>
              <Stack>
                <Switch label='Automatización activa (corre sola según el intervalo)' checked={form.activo} onChange={(e) => setForm({ ...form, activo: e.currentTarget.checked })} />
                <Switch label='Modo simulación (no crea solicitudes ni toca SAP)' checked={form.simulacion} onChange={(e) => setForm({ ...form, simulacion: e.currentTarget.checked })} />
                <NumberInput label='Cada cuántos minutos corre' min={5} max={1440} value={form.intervalo_min} onChange={(v) => setForm({ ...form, intervalo_min: Number(v) || 10 })} />
                <NumberInput label='Usuario SAP que crea los borradores (UserSign)'
                  description='El usuario de la integración de Salesforce (ServiceLayer_01). En la base productiva de OLP es el 30; en la de pruebas puede ser otro.'
                  min={1} value={form.user_sign} onChange={(v) => setForm({ ...form, user_sign: v === '' ? '' : Number(v) })} />
                <TextInput label='Tomar borradores desde (fecha)' type='date' value={form.desde_fecha} onChange={(e) => setForm({ ...form, desde_fecha: e.currentTarget.value })} />
                <TextInput label='Solicitante en SynerLink (correo)' description='A nombre de quién quedan las solicitudes creadas por la automatización.'
                  value={form.solicitanteEmail} onChange={(e) => setForm({ ...form, solicitanteEmail: e.currentTarget.value })} />
                {cfg?.updated_at && <Text size='xs' c='dimmed'>Última actualización: {fmt(cfg.updated_at)}</Text>}
                <Group justify='flex-end'>
                  <Button loading={busy === 'guardar'} onClick={async () => {
                    setBusy('guardar');
                    try {
                      await call('PUT', { companyId, config: form });
                      toast.success('Configuración guardada');
                      await load(companyId);
                    } catch (e) {
                      toast.error((e as Error).message);
                    } finally {
                      setBusy(null);
                    }
                  }}>
                    Guardar
                  </Button>
                </Group>
              </Stack>
            </Card>
          </Tabs.Panel>

          <Tabs.Panel value='corridas'>
            <Card withBorder radius='md' p='md'>
              {data.runs.length === 0 ? (
                <Text c='dimmed' size='sm'>Sin corridas todavía.</Text>
              ) : (
                <Table.ScrollContainer minWidth={800}>
                  <Table striped verticalSpacing='xs'>
                    <Table.Thead>
                      <Table.Tr><Table.Th>Inicio</Table.Th><Table.Th>Origen</Table.Th><Table.Th>Modo</Table.Th><Table.Th>Nuevos</Table.Th><Table.Th>Al flujo</Table.Th><Table.Th>Simulados</Table.Th><Table.Th>Errores</Table.Th><Table.Th>Resumen</Table.Th></Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {data.runs.map((r) => (
                        <Table.Tr key={r.id}>
                          <Table.Td><Text size='xs'>{fmt(r.inicio)}</Text></Table.Td>
                          <Table.Td>{r.origen === 'programada' ? 'Programada' : r.origen === 'manual' ? 'Ejecutar ahora' : 'Asistida'}</Table.Td>
                          <Table.Td>{r.simulacion ? 'Simulación' : 'Real'}</Table.Td>
                          <Table.Td>{r.candidatos}</Table.Td><Table.Td>{r.enviados}</Table.Td><Table.Td>{r.simulados}</Table.Td>
                          <Table.Td><Text c={r.errores ? 'red' : undefined}>{r.errores}</Text></Table.Td>
                          <Table.Td style={{ maxWidth: 380 }}><Text size='xs'>{r.detalle}</Text></Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
              )}
            </Card>
          </Tabs.Panel>
        </Tabs>
      </div>
    </div>
  );
}
