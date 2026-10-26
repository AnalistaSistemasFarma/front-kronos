'use client';

import { useState } from 'react';
import { Accordion, Alert, Badge, Button, Card, Checkbox, Code, Group, Modal, NumberInput, Progress, ScrollArea, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { IconAlertTriangle, IconEye, IconPlayerPlay, IconSearch, IconSend } from '@tabler/icons-react';
import { ASISTIDA, ESTADO_COLOR, ESTADO_LABEL, PRUEBAS_MANUALES, esUrlProduccionNabuco, type NabucoEstado } from '../../lib/transferencias-nabuco/constants';
import type { DocPendiente } from '../../lib/transferencias-nabuco/asistidaReglas';
import { errorTexto, nabucoSend } from './client';

interface ConfigAsistida {
  id_config: number;
  nabuco_url: string | null;
  entidad_sap: string;
}

interface Simulado {
  docEntry: number;
  docNum: number | null;
  ok: boolean;
  payload?: Record<string, unknown> | null;
  error?: string | null;
}

interface Creado {
  docEntry: number;
  docNum: number | null;
  estado: 'enviado' | 'error' | 'ya_enviado' | 'omitido';
  http_status?: number | null;
  respuesta?: string | null;
  error?: string | null;
  id_envio?: number | null;
}

interface DetalleEnvio {
  id_envio: number;
  doc_entry: number;
  doc_num: number | null;
  estado: NabucoEstado;
  intentos: number;
  http_status: number | null;
  error: string | null;
  payload: string | null;
  respuesta: string | null;
}

const ESTADO_CREAR: Record<Creado['estado'], { label: string; color: string }> = {
  enviado: { label: 'Enviado', color: 'green' },
  error: { label: 'Error', color: 'red' },
  ya_enviado: { label: 'Ya enviado', color: 'gray' },
  omitido: { label: 'Omitido', color: 'yellow' },
};

function estadoLog(d: DocPendiente): { label: string; color: string } {
  if (d.estado_log === 'nuevo') return { label: 'Nuevo', color: 'cyan' };
  if (d.estado_log === 'error') return { label: `Error (${d.intentos} intento${d.intentos === 1 ? '' : 's'})`, color: 'red' };
  return { label: ESTADO_LABEL[d.estado_log], color: ESTADO_COLOR[d.estado_log] };
}

/** DocDate de SAP viene como medianoche UTC («2026-10-25T00:00:00Z»): se muestra el día tal cual, sin zona. */
function fechaSap(v: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v ?? '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '—';
}

function bonito(t: string | null | undefined): string {
  if (!t) return '—';
  try {
    return JSON.stringify(JSON.parse(t), null, 2);
  } catch {
    return t;
  }
}

function resumir(t: string | null | undefined, n = 120): string {
  if (!t) return '—';
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

function enTandas<T>(lista: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < lista.length; i += n) out.push(lista.slice(i, i + n));
  return out;
}

/**
 * «Transferencia asistida» (pestaña Pruebas manuales): Buscar pendientes en SAP → Simular (arma y
 * registra 'simulado') → Crear (envía de verdad los que salieron bien). Simular/Crear se mandan en
 * tandas para mostrar el progreso; el servidor procesa cada tanda en orden y con el lock de la config.
 */
export default function NabucoAsistida({ config }: { config: ConfigAsistida }) {
  const base = `/api/transferencias-nabuco/configs/${config.id_config}`;
  const esProduccion = esUrlProduccionNabuco(config.nabuco_url);
  const [limite, setLimite] = useState<number | string>(ASISTIDA.limiteDefecto);
  const [docs, setDocs] = useState<DocPendiente[] | null>(null);
  const [hayMas, setHayMas] = useState(false);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [simulados, setSimulados] = useState<Simulado[] | null>(null);
  const [creados, setCreados] = useState<Creado[] | null>(null);
  const [ocupado, setOcupado] = useState<null | 'buscar' | 'simular' | 'crear'>(null);
  const [progreso, setProgreso] = useState<{ hechos: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState(false);
  const [palabra, setPalabra] = useState('');
  const [detalle, setDetalle] = useState<DetalleEnvio | null>(null);

  const listos = (simulados ?? []).filter((s) => s.ok);
  const tieneTotal = Boolean(docs?.some((d) => d.DocTotal !== undefined));

  const cambiarSeleccion = (s: Set<number>) => {
    setSel(s);
    setSimulados(null); // la simulación vale para la selección con la que se hizo
    setCreados(null);
  };

  const buscar = async () => {
    setOcupado('buscar');
    setError(null);
    setSimulados(null);
    setCreados(null);
    try {
      const res = await fetch(`${base}/pendientes?limite=${Number(limite) || ASISTIDA.limiteDefecto}`, { cache: 'no-store' });
      const b = (await res.json().catch(() => ({}))) as { documentos?: DocPendiente[]; hayMas?: boolean; error?: string };
      if (!res.ok || !b.documentos) throw new Error(b.error ?? `Error ${res.status}`);
      setDocs(b.documentos);
      setHayMas(Boolean(b.hayMas));
      setSel(new Set(b.documentos.map((d) => d.DocEntry)));
    } catch (e) {
      setError(errorTexto(e));
    } finally {
      setOcupado(null);
    }
  };

  /** Recorre los DocEntry en tandas; si una tanda falla, se detiene y muestra el error. */
  async function porTandas<R>(accion: 'simular' | 'crear', lista: number[], extra: Record<string, unknown>, alAvanzar: (r: R[]) => void) {
    setOcupado(accion);
    setError(null);
    setProgreso({ hechos: 0, total: lista.length });
    const acumulado: R[] = [];
    try {
      for (const tanda of enTandas(lista, ASISTIDA.tanda)) {
        const r = await nabucoSend<{ resultados: R[] }>(`${base}/${accion}`, 'POST', { docEntries: tanda, ...extra });
        acumulado.push(...r.resultados);
        alAvanzar([...acumulado]);
        setProgreso({ hechos: acumulado.length, total: lista.length });
      }
    } catch (e) {
      setError(`${accion === 'simular' ? 'Simular' : 'Crear'} se detuvo tras ${acumulado.length} de ${lista.length}: ${errorTexto(e)}`);
    } finally {
      setOcupado(null);
      setProgreso(null);
    }
  }

  const ordenSeleccion = () => (docs ?? []).map((d) => d.DocEntry).filter((n) => sel.has(n));

  const simular = async () => {
    setSimulados([]);
    setCreados(null);
    await porTandas<Simulado>('simular', ordenSeleccion(), {}, setSimulados);
  };

  const crear = async () => {
    setConfirmar(false);
    setCreados([]);
    await porTandas<Creado>('crear', listos.map((s) => s.docEntry), { confirmoProduccion: esProduccion ? palabra === PRUEBAS_MANUALES.palabraProduccion : undefined }, setCreados);
  };

  const abrir = async (id: number) => {
    try {
      const res = await fetch(`/api/transferencias-nabuco/envios/${id}`, { cache: 'no-store' });
      const b = (await res.json().catch(() => ({}))) as { envio?: DetalleEnvio; error?: string };
      if (!res.ok || !b.envio) throw new Error(b.error ?? `Error ${res.status}`);
      setDetalle(b.envio);
    } catch (e) {
      setError(errorTexto(e));
    }
  };

  const cuenta = (estado: Creado['estado']) => (creados ?? []).filter((c) => c.estado === estado).length;

  return (
    <Card shadow='sm' radius='md' withBorder p='md'>
      <Title order={4} mb='xs'>
        Transferencia asistida
      </Title>
      <Text size='sm' c='dimmed' mb='sm'>
        {`Busca en SAP los documentos de ${config.entidad_sap} que cumplen el filtro de la configuración y aún no se han enviado. «Simular» arma las solicitudes sin enviarlas; «Crear» las envía de verdad a Nabuco aunque la configuración esté en modo simulación.`}
      </Text>
      {error && (
        <Alert color='red' mb='sm' withCloseButton onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      <Group align='flex-end' wrap='wrap'>
        <NumberInput label='Máximo de documentos' min={1} max={ASISTIDA.limiteMax} value={limite} onChange={setLimite} w={180} disabled={Boolean(ocupado)} />
        <Button leftSection={<IconSearch size={16} />} loading={ocupado === 'buscar'} disabled={Boolean(ocupado)} onClick={() => void buscar()}>
          Buscar pendientes
        </Button>
        <Button variant='light' leftSection={<IconPlayerPlay size={16} />} loading={ocupado === 'simular'} disabled={Boolean(ocupado) || !sel.size} onClick={() => void simular()}>
          {`Simular (${sel.size})`}
        </Button>
        <Button
          color={esProduccion ? 'red' : 'orange'}
          leftSection={<IconSend size={16} />}
          loading={ocupado === 'crear'}
          disabled={Boolean(ocupado) || !listos.length || !config.nabuco_url || Boolean(creados)}
          onClick={() => {
            setPalabra('');
            setConfirmar(true);
          }}
        >
          {`Crear (${listos.length})`}
        </Button>
      </Group>

      {progreso && (
        <Stack gap={4} mt='sm'>
          <Text size='sm'>{`${ocupado === 'crear' ? 'Creando' : 'Simulando'}… ${progreso.hechos} de ${progreso.total}`}</Text>
          <Progress value={progreso.total ? (progreso.hechos / progreso.total) * 100 : 0} animated />
        </Stack>
      )}

      {docs && (
        <Stack gap='xs' mt='md'>
          {docs.length === 0 ? (
            <Alert color='green'>No hay documentos pendientes: todo lo que cumple el filtro ya está enviado o descartado.</Alert>
          ) : (
            <>
              <Text fw={600}>{`Estos documentos se van a transferir a Nabuco (${config.nabuco_url ?? 'sin URL configurada'})`}</Text>
              {hayMas && <Alert color='yellow'>{`Hay más pendientes de los ${docs.length} mostrados (los más recientes primero). Aumente el máximo o procese estos primero.`}</Alert>}
              <Group gap='xs'>
                <Button size='xs' variant='subtle' disabled={Boolean(ocupado)} onClick={() => cambiarSeleccion(new Set(docs.map((d) => d.DocEntry)))}>
                  Seleccionar todos
                </Button>
                <Button size='xs' variant='subtle' disabled={Boolean(ocupado)} onClick={() => cambiarSeleccion(new Set())}>
                  Ninguno
                </Button>
                <Text size='sm' c='dimmed'>{`${sel.size} de ${docs.length} seleccionados`}</Text>
              </Group>
              <Table.ScrollContainer minWidth={700}>
                <Table striped highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th />
                      <Table.Th>DocNum</Table.Th>
                      <Table.Th>DocEntry</Table.Th>
                      <Table.Th>Fecha</Table.Th>
                      <Table.Th>Cliente</Table.Th>
                      {tieneTotal && <Table.Th>Total</Table.Th>}
                      <Table.Th>Estado en el log</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {docs.map((d) => {
                      const e = estadoLog(d);
                      return (
                        <Table.Tr key={d.DocEntry}>
                          <Table.Td>
                            <Checkbox
                              aria-label={`Seleccionar ${d.DocNum ?? d.DocEntry}`}
                              checked={sel.has(d.DocEntry)}
                              disabled={Boolean(ocupado)}
                              onChange={(ev) => {
                                const s = new Set(sel);
                                if (ev.currentTarget.checked) s.add(d.DocEntry);
                                else s.delete(d.DocEntry);
                                cambiarSeleccion(s);
                              }}
                            />
                          </Table.Td>
                          <Table.Td>{d.DocNum ?? '—'}</Table.Td>
                          <Table.Td>{d.DocEntry}</Table.Td>
                          <Table.Td>{fechaSap(d.DocDate)}</Table.Td>
                          <Table.Td>{d.CardName ?? '—'}</Table.Td>
                          {tieneTotal && <Table.Td>{typeof d.DocTotal === 'number' ? d.DocTotal.toLocaleString('es-CO') : '—'}</Table.Td>}
                          <Table.Td>
                            <Badge color={e.color} variant='light'>
                              {e.label}
                            </Badge>
                          </Table.Td>
                        </Table.Tr>
                      );
                    })}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </>
          )}
        </Stack>
      )}

      {simulados && simulados.length > 0 && (
        <Stack gap='xs' mt='md'>
          <Group gap='xs'>
            <Title order={5}>Simulación</Title>
            <Badge color='green'>{`${listos.length} listos para crear`}</Badge>
            <Badge color={simulados.length - listos.length ? 'red' : 'gray'}>{`${simulados.length - listos.length} con errores`}</Badge>
          </Group>
          <Accordion variant='separated' multiple>
            {simulados.map((s) => (
              <Accordion.Item key={s.docEntry} value={String(s.docEntry)}>
                <Accordion.Control>
                  <Group gap='xs'>
                    <Badge color={s.ok ? 'green' : 'red'}>{s.ok ? 'OK' : 'Error'}</Badge>
                    <Text size='sm'>{`DocNum ${s.docNum ?? '—'} · DocEntry ${s.docEntry}`}</Text>
                  </Group>
                </Accordion.Control>
                <Accordion.Panel>
                  {s.error && (
                    <Alert color='red' mb='xs'>
                      {s.error}
                    </Alert>
                  )}
                  {s.payload && (
                    <ScrollArea.Autosize mah={360}>
                      <Code block>{JSON.stringify(s.payload, null, 2)}</Code>
                    </ScrollArea.Autosize>
                  )}
                </Accordion.Panel>
              </Accordion.Item>
            ))}
          </Accordion>
        </Stack>
      )}

      {creados && creados.length > 0 && (
        <Stack gap='xs' mt='md'>
          <Group gap='xs'>
            <Title order={5}>Resultado de Crear</Title>
            <Badge color='green'>{`${cuenta('enviado')} enviados`}</Badge>
            <Badge color='red'>{`${cuenta('error')} con error`}</Badge>
            <Badge color='gray'>{`${cuenta('ya_enviado')} ya enviados`}</Badge>
            <Badge color='yellow'>{`${cuenta('omitido')} omitidos`}</Badge>
          </Group>
          <Table.ScrollContainer minWidth={700}>
            <Table striped>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>DocNum</Table.Th>
                  <Table.Th>DocEntry</Table.Th>
                  <Table.Th>Resultado</Table.Th>
                  <Table.Th>HTTP</Table.Th>
                  <Table.Th>Respuesta</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {creados.map((c) => (
                  <Table.Tr key={c.docEntry}>
                    <Table.Td>{c.docNum ?? '—'}</Table.Td>
                    <Table.Td>{c.docEntry}</Table.Td>
                    <Table.Td>
                      <Badge color={ESTADO_CREAR[c.estado].color} variant='light'>
                        {ESTADO_CREAR[c.estado].label}
                      </Badge>
                    </Table.Td>
                    <Table.Td>{c.http_status ?? '—'}</Table.Td>
                    <Table.Td>
                      <Text size='xs' style={{ wordBreak: 'break-all' }}>
                        {resumir(c.error ? `${c.error}${c.respuesta ? ` · ${c.respuesta}` : ''}` : c.respuesta)}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      {c.id_envio && (
                        <Button size='xs' variant='subtle' leftSection={<IconEye size={14} />} onClick={() => void abrir(c.id_envio as number)}>
                          Ver detalle
                        </Button>
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Stack>
      )}

      <Modal opened={confirmar} onClose={() => setConfirmar(false)} title='Crear solicitudes en Nabuco' size='lg'>
        <Stack gap='sm'>
          <Text>{`Se crearán ${listos.length} solicitudes de alistamiento en Nabuco (${config.nabuco_url ?? ''}). Se envían una por una y quedan registradas en el tablero; los documentos ya enviados no se reenvían.`}</Text>
          {esProduccion && (
            <>
              <Alert color='red' icon={<IconAlertTriangle size={18} />} title='Esta URL es la de PRODUCCIÓN de Nabuco'>
                {`No parece el ambiente de pruebas. Para crear de todas formas escriba ${PRUEBAS_MANUALES.palabraProduccion}.`}
              </Alert>
              <TextInput label={`Escriba ${PRUEBAS_MANUALES.palabraProduccion}`} value={palabra} onChange={(e) => setPalabra(e.currentTarget.value)} autoComplete='off' />
            </>
          )}
          <Group justify='flex-end'>
            <Button variant='default' onClick={() => setConfirmar(false)}>
              Cancelar
            </Button>
            <Button color={esProduccion ? 'red' : 'orange'} leftSection={<IconSend size={16} />} disabled={esProduccion && palabra !== PRUEBAS_MANUALES.palabraProduccion} onClick={() => void crear()}>
              {`Crear ${listos.length}`}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={Boolean(detalle)} onClose={() => setDetalle(null)} size='xl' title={detalle ? `${config.entidad_sap} ${detalle.doc_num ?? ''} · DocEntry ${detalle.doc_entry}` : ''}>
        {detalle && (
          <Stack gap='sm'>
            <Group gap='xs'>
              <Badge color={ESTADO_COLOR[detalle.estado]}>{ESTADO_LABEL[detalle.estado]}</Badge>
              <Text size='sm'>{`Intentos: ${detalle.intentos}`}</Text>
              {detalle.http_status && <Text size='sm'>{`HTTP ${detalle.http_status}`}</Text>}
            </Group>
            {detalle.error && <Alert color='red'>{detalle.error}</Alert>}
            <Text fw={600}>Payload</Text>
            <ScrollArea.Autosize mah={260}>
              <Code block>{bonito(detalle.payload)}</Code>
            </ScrollArea.Autosize>
            <Text fw={600}>Respuesta de Nabuco</Text>
            <ScrollArea.Autosize mah={260}>
              <Code block>{bonito(detalle.respuesta)}</Code>
            </ScrollArea.Autosize>
          </Stack>
        )}
      </Modal>
    </Card>
  );
}
