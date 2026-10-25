'use client';

import { useState } from 'react';
import { Alert, Badge, Button, Card, Code, Group, Loader, Modal, ScrollArea, SimpleGrid, Stack, Table, Text, TextInput } from '@mantine/core';
import { IconBan, IconRefresh, IconSend } from '@tabler/icons-react';
import toast from 'react-hot-toast';
import SgcSelect from '../sgc/SgcSelect';
import { ESTADO_COLOR, ESTADO_LABEL, NABUCO_ESTADOS, type NabucoEstado } from '../../lib/transferencias-nabuco/constants';
import { errorTexto, fmtFechaHora, nabucoSend, useNabucoFetch, type NabucoCompany } from './client';

interface Envio {
  id_envio: number;
  config_nombre: string;
  entidad: string;
  doc_entry: number;
  doc_num: number | null;
  estado: NabucoEstado;
  intentos: number;
  http_status: number | null;
  error: string | null;
  creado: string;
  ultimo_intento: string | null;
  proximo_intento: string | null;
  usuario_accion: string | null;
}
interface Kpi {
  estado: NabucoEstado;
  hoy: number;
  semana: number;
}
interface ConfigResumen {
  id_config: number;
  nombre: string;
  activo: boolean;
  modo_simulacion: boolean;
  last_run_date: string | null;
  last_status: string | null;
}
interface Detalle extends Envio {
  payload: string | null;
  respuesta: string | null;
}

function bonito(t: string | null): string {
  if (!t) return '—';
  try {
    return JSON.stringify(JSON.parse(t), null, 2);
  } catch {
    return t;
  }
}

/** Tablero: KPIs de hoy y 7 días, última corrida por config, filtros y envíos con detalle. */
export default function NabucoTablero({ company }: { company: NabucoCompany }) {
  const [estado, setEstado] = useState<string | null>(null);
  const [config, setConfig] = useState<string | null>(null);
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [detalle, setDetalle] = useState<Detalle | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const qs = new URLSearchParams({ company: String(company.idCompany) });
  if (estado) qs.set('estado', estado);
  if (config) qs.set('config', config);
  if (desde) qs.set('desde', desde);
  if (hasta) qs.set('hasta', hasta);
  const { data, error, loading, reload } = useNabucoFetch<{ envios: Envio[]; kpis: Kpi[]; configs: ConfigResumen[] }>(`/api/transferencias-nabuco/envios?${qs}`, 60000);

  const kpi = (e: NabucoEstado, k: 'hoy' | 'semana') => data?.kpis.find((x) => x.estado === e)?.[k] ?? 0;

  const abrir = async (id: number) => {
    try {
      const r = await fetch(`/api/transferencias-nabuco/envios/${id}`, { cache: 'no-store' });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error);
      setDetalle(b.envio);
    } catch (e) {
      toast.error(errorTexto(e));
    }
  };

  const accion = async (id: number, a: 'reintentar' | 'descartar' | 'enviar') => {
    setOcupado(true);
    try {
      const r = await nabucoSend<{ texto?: string }>(`/api/transferencias-nabuco/envios/${id}`, 'POST', { accion: a });
      toast.success(r.texto ?? (a === 'descartar' ? 'Envío descartado.' : 'Envío reprogramado para la próxima corrida.'));
      setDetalle(null);
      void reload();
    } catch (e) {
      toast.error(errorTexto(e));
    } finally {
      setOcupado(false);
    }
  };

  return (
    <Stack gap='md'>
      <SimpleGrid cols={{ base: 2, sm: 4 }}>
        {(['enviado', 'error', 'pendiente', 'simulado'] as NabucoEstado[]).map((e) => (
          <Card key={e} shadow='sm' radius='md' withBorder p='md'>
            <Text size='sm' c='dimmed'>
              {ESTADO_LABEL[e]}
            </Text>
            <Text fz={28} fw={700} c={ESTADO_COLOR[e]}>
              {kpi(e, 'hoy')}
            </Text>
            <Text size='xs' c='dimmed'>{`Hoy · ${kpi(e, 'semana')} en 7 días`}</Text>
          </Card>
        ))}
      </SimpleGrid>

      {data?.configs.length ? (
        <Card shadow='sm' radius='md' withBorder p='md'>
          <Text fw={600} mb='xs'>
            Última corrida por configuración
          </Text>
          <Stack gap={4}>
            {data.configs.map((c) => (
              <Group key={c.id_config} gap='xs' wrap='wrap'>
                <Text size='sm' fw={500}>
                  {c.nombre}
                </Text>
                {!c.activo && <Badge color='gray'>Pausada</Badge>}
                {c.modo_simulacion && <Badge color='blue'>Simulación</Badge>}
                <Text size='sm' c='dimmed'>
                  {c.last_run_date ? fmtFechaHora(c.last_run_date) : 'Sin corridas'}
                </Text>
                {c.last_status && <Badge color={c.last_status === 'ok' ? 'green' : 'red'} variant='light'>{c.last_status === 'ok' ? 'Correcta' : 'Error'}</Badge>}
              </Group>
            ))}
          </Stack>
        </Card>
      ) : null}

      <Card shadow='sm' radius='md' withBorder p='md'>
        <Group align='flex-end' gap='sm' wrap='wrap' mb='md'>
          <SgcSelect label='Configuración' clearable data={(data?.configs ?? []).map((c) => ({ value: String(c.id_config), label: c.nombre }))} value={config} onChange={setConfig} w={220} />
          <SgcSelect label='Estado' clearable data={NABUCO_ESTADOS.map((e) => ({ value: e, label: ESTADO_LABEL[e] }))} value={estado} onChange={setEstado} w={170} />
          <TextInput label='Desde' type='date' value={desde} onChange={(e) => setDesde(e.currentTarget.value)} />
          <TextInput label='Hasta' type='date' value={hasta} onChange={(e) => setHasta(e.currentTarget.value)} />
          <Button variant='light' leftSection={<IconRefresh size={16} />} onClick={() => void reload()}>
            Actualizar
          </Button>
        </Group>
        {loading && <Loader />}
        {error && <Alert color='red'>{error}</Alert>}
        {data && data.envios.length === 0 && <Text c='dimmed'>No hay envíos con estos filtros.</Text>}
        {data && data.envios.length > 0 && (
          <Table.ScrollContainer minWidth={900}>
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Documento</Table.Th>
                  <Table.Th>Configuración</Table.Th>
                  <Table.Th>Estado</Table.Th>
                  <Table.Th>Intentos</Table.Th>
                  <Table.Th>Último intento</Table.Th>
                  <Table.Th>Error</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data.envios.map((e) => (
                  <Table.Tr key={e.id_envio} style={{ cursor: 'pointer' }} onClick={() => void abrir(e.id_envio)}>
                    <Table.Td>{`${e.entidad} ${e.doc_num ?? ''} (DocEntry ${e.doc_entry})`}</Table.Td>
                    <Table.Td>{e.config_nombre}</Table.Td>
                    <Table.Td>
                      <Badge color={ESTADO_COLOR[e.estado]} variant='light'>
                        {ESTADO_LABEL[e.estado]}
                      </Badge>
                    </Table.Td>
                    <Table.Td>{e.intentos}</Table.Td>
                    <Table.Td>{fmtFechaHora(e.ultimo_intento ?? e.creado)}</Table.Td>
                    <Table.Td>
                      <Text size='sm' lineClamp={1}>
                        {e.error ?? '—'}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Card>

      <Modal opened={Boolean(detalle)} onClose={() => setDetalle(null)} size='xl' title={detalle ? `${detalle.entidad} ${detalle.doc_num ?? ''} · DocEntry ${detalle.doc_entry}` : ''}>
        {detalle && (
          <Stack gap='sm'>
            <Group gap='xs'>
              <Badge color={ESTADO_COLOR[detalle.estado]}>{ESTADO_LABEL[detalle.estado]}</Badge>
              <Text size='sm'>{`Intentos: ${detalle.intentos}`}</Text>
              {detalle.http_status && <Text size='sm'>{`HTTP ${detalle.http_status}`}</Text>}
              {detalle.proximo_intento && <Text size='sm' c='dimmed'>{`Próximo intento: ${fmtFechaHora(detalle.proximo_intento)}`}</Text>}
              {detalle.usuario_accion && <Text size='sm' c='dimmed'>{`Última acción manual: ${detalle.usuario_accion}`}</Text>}
            </Group>
            {detalle.error && <Alert color='red'>{detalle.error}</Alert>}
            <Text fw={600}>Payload</Text>
            <ScrollArea.Autosize mah={260}>
              <Code block>{bonito(detalle.payload)}</Code>
            </ScrollArea.Autosize>
            <Text fw={600}>Respuesta de Nabuco</Text>
            <ScrollArea.Autosize mah={200}>
              <Code block>{bonito(detalle.respuesta)}</Code>
            </ScrollArea.Autosize>
            {company.canAdministrar && detalle.estado !== 'enviado' && (
              <Group justify='flex-end'>
                <Button variant='default' leftSection={<IconBan size={16} />} loading={ocupado} disabled={detalle.estado === 'descartado'} onClick={() => void accion(detalle.id_envio, 'descartar')}>
                  Descartar
                </Button>
                <Button variant='light' leftSection={<IconRefresh size={16} />} loading={ocupado} onClick={() => void accion(detalle.id_envio, 'reintentar')}>
                  Reintentar
                </Button>
                <Button leftSection={<IconSend size={16} />} loading={ocupado} onClick={() => void accion(detalle.id_envio, 'enviar')}>
                  Enviar ahora
                </Button>
              </Group>
            )}
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}
