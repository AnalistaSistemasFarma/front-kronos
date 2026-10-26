'use client';

import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Code, Group, Loader, Modal, NumberInput, ScrollArea, Stack, Table, Text, TextInput, Textarea, Title } from '@mantine/core';
import { IconAlertTriangle, IconEye, IconFileCode, IconPlugConnected, IconSend, IconWand } from '@tabler/icons-react';
import toast from 'react-hot-toast';
import SgcSelect from '../sgc/SgcSelect';
import NabucoAsistida from './NabucoAsistida';
import { PRUEBAS_MANUALES, esUrlProduccionNabuco } from '../../lib/transferencias-nabuco/constants';
import { ejemploPayload, type FilaMapeo } from '../../lib/transferencias-nabuco/mapeo';
import { errorTexto, fmtFechaHora, nabucoSend, useNabucoFetch, type NabucoCompany } from './client';

interface ConfigResumen {
  id_config: number;
  nombre: string;
  modo_simulacion: boolean;
  nabuco_url: string | null;
  ruta_solicitudes: string;
  entidad_sap: string;
  clave_lineas: string;
  mapeo_encabezado: FilaMapeo[];
  mapeo_lineas: FilaMapeo[];
}

interface Prueba {
  id_prueba: number;
  tipo: 'conexion' | 'envio';
  usuario: string;
  doc_entry: number | null;
  url: string;
  http_status: number | null;
  duracion_ms: number | null;
  error: string | null;
  creado: string;
  payload?: string | null;
  respuesta?: string | null;
}

interface Resultado {
  ok: boolean;
  url: string;
  http_status: number | null;
  duracion_ms: number;
  respuesta: string | null;
  error: string | null;
}

function bonito(t: string | null | undefined): string {
  if (!t) return '—';
  try {
    return JSON.stringify(JSON.parse(t), null, 2);
  } catch {
    return t;
  }
}

function urlSolicitudes(c: ConfigResumen): string {
  return `${(c.nabuco_url ?? '').replace(/\/+$/, '')}/${c.ruta_solicitudes.replace(/^\/+/, '')}`;
}

/** Pestaña «Pruebas manuales» (solo administradores): probar conexión y enviar un JSON a Nabuco a mano. */
export default function NabucoPruebas({ company }: { company: NabucoCompany }) {
  const { data, error, loading } = useNabucoFetch<{ configs: ConfigResumen[] }>(`/api/transferencias-nabuco/configs?company=${company.idCompany}`);
  const [sel, setSel] = useState<string | null>(null);
  const actual = data?.configs.find((c) => String(c.id_config) === sel) ?? null;
  const historialUrl = actual ? `/api/transferencias-nabuco/configs/${actual.id_config}/pruebas` : null;
  const hist = useNabucoFetch<{ pruebas: Prueba[] }>(historialUrl);

  const [ocupado, setOcupado] = useState<string | null>(null);
  const [conexion, setConexion] = useState<{ ok: boolean; texto: string } | null>(null);
  const [docEntry, setDocEntry] = useState<number | string>('');
  const [origenDoc, setOrigenDoc] = useState<number | null>(null);
  const [cuerpo, setCuerpo] = useState('');
  const [confirmar, setConfirmar] = useState(false);
  const [palabra, setPalabra] = useState('');
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [detalle, setDetalle] = useState<Prueba | null>(null);

  // Si hay configuraciones y ninguna (válida) seleccionada, se toma la primera.
  useEffect(() => {
    if (!data?.configs.length) return;
    if (!data.configs.some((c) => String(c.id_config) === sel)) setSel(String(data.configs[0].id_config));
  }, [data, sel]);
  useEffect(() => {
    setConexion(null);
    setResultado(null);
    setCuerpo('');
    setOrigenDoc(null);
  }, [sel]);

  if (loading) return <Loader />;
  if (error) return <Alert color='red'>{error}</Alert>;
  if (!data?.configs.length) return <Alert color='yellow'>Esta empresa aún no tiene configuraciones de Nabuco. Créela en la pestaña Configuración.</Alert>;

  const esProduccion = esUrlProduccionNabuco(actual?.nabuco_url);

  const probar = async () => {
    if (!actual) return;
    setOcupado('probar');
    setConexion(null);
    try {
      const res = await fetch(`/api/transferencias-nabuco/configs/${actual.id_config}/probar`, { method: 'POST' });
      const b = (await res.json().catch(() => ({}))) as { mensaje?: string; error?: string };
      setConexion({ ok: res.ok, texto: res.ok ? (b.mensaje ?? 'Conexión correcta.') : (b.error ?? `Error ${res.status}`) });
      void hist.reload();
    } catch (e) {
      setConexion({ ok: false, texto: errorTexto(e) });
    } finally {
      setOcupado(null);
    }
  };

  const armar = async () => {
    if (!actual) return;
    setOcupado('armar');
    try {
      const r = await nabucoSend<{ payload: unknown }>(`/api/transferencias-nabuco/configs/${actual.id_config}/vista-previa`, 'POST', { docEntry: Number(docEntry) });
      setCuerpo(JSON.stringify(r.payload, null, 2));
      setOrigenDoc(Number(docEntry));
    } catch (e) {
      toast.error(errorTexto(e));
    } finally {
      setOcupado(null);
    }
  };

  const cargarEjemplo = () => {
    if (!actual) return;
    setCuerpo(JSON.stringify(ejemploPayload(actual.mapeo_encabezado, actual.mapeo_lineas, actual.clave_lineas), null, 2));
    setOrigenDoc(null);
  };

  const pedirConfirmacion = () => {
    try {
      const v: unknown = JSON.parse(cuerpo);
      if (!v || typeof v !== 'object') throw new Error('El JSON debe ser un objeto o una lista.');
    } catch (e) {
      toast.error(`El JSON no es válido: ${errorTexto(e)}`);
      return;
    }
    setPalabra('');
    setConfirmar(true);
  };

  const enviar = async () => {
    if (!actual) return;
    setOcupado('enviar');
    try {
      const r = await nabucoSend<{ resultado: Resultado }>(`/api/transferencias-nabuco/configs/${actual.id_config}/pruebas`, 'POST', {
        payload: cuerpo,
        docEntry: origenDoc,
        confirmoProduccion: esProduccion ? palabra === PRUEBAS_MANUALES.palabraProduccion : undefined,
      });
      setResultado(r.resultado);
      setConfirmar(false);
      void hist.reload();
    } catch (e) {
      toast.error(errorTexto(e));
    } finally {
      setOcupado(null);
    }
  };

  const abrir = async (id: number) => {
    if (!actual) return;
    try {
      const res = await fetch(`/api/transferencias-nabuco/configs/${actual.id_config}/pruebas/${id}`, { cache: 'no-store' });
      const b = (await res.json().catch(() => ({}))) as { prueba?: Prueba; error?: string };
      if (!res.ok || !b.prueba) throw new Error(b.error ?? `Error ${res.status}`);
      setDetalle(b.prueba);
    } catch (e) {
      toast.error(errorTexto(e));
    }
  };

  return (
    <Stack gap='md'>
      <Card shadow='sm' radius='md' withBorder p='md'>
        <Group align='flex-end' gap='sm' wrap='wrap'>
          <SgcSelect
            label='Configuración'
            data={data.configs.map((c) => ({ value: String(c.id_config), label: c.nombre }))}
            value={sel}
            onChange={setSel}
            allowDeselect={false}
            w={{ base: '100%', sm: 300 }}
          />
          {actual && (
            <Text size='sm' c='dimmed'>
              {`URL: ${actual.nabuco_url ?? '(sin configurar)'}`}
            </Text>
          )}
          {esProduccion && <Badge color='red'>Producción de Nabuco</Badge>}
        </Group>
        <Text size='sm' c='dimmed' mt='xs'>
          Las pruebas manuales envían de verdad a Nabuco aunque la configuración esté en modo simulación. «Probar conexión» y el JSON libre no afectan el
          envío automático ni el tablero; la Transferencia asistida sí registra en el tablero (simulados y enviados) y no reenvía lo ya enviado.
        </Text>
      </Card>

      {actual && <NabucoAsistida key={actual.id_config} config={actual} />}

      <Card shadow='sm' radius='md' withBorder p='md'>
        <Title order={4} mb='sm'>
          Conexión
        </Title>
        <Group>
          <Button variant='light' leftSection={<IconPlugConnected size={16} />} loading={ocupado === 'probar'} onClick={() => void probar()}>
            Probar conexión
          </Button>
        </Group>
        {conexion && (
          <Alert mt='sm' color={conexion.ok ? 'green' : 'red'} title={conexion.ok ? 'OK' : 'Falló'}>
            {conexion.texto}
          </Alert>
        )}
      </Card>

      <Card shadow='sm' radius='md' withBorder p='md'>
        <Title order={4} mb='sm'>
          Solicitud a enviar
        </Title>
        <Group align='flex-end' wrap='wrap'>
          <NumberInput label={`DocEntry (${actual?.entidad_sap ?? ''})`} min={1} value={docEntry} onChange={setDocEntry} w={200} />
          <Button variant='light' leftSection={<IconFileCode size={16} />} disabled={!docEntry} loading={ocupado === 'armar'} onClick={() => void armar()}>
            Armar solicitud
          </Button>
          <Button variant='default' leftSection={<IconWand size={16} />} onClick={cargarEjemplo}>
            Cargar ejemplo
          </Button>
        </Group>
        <Textarea
          mt='sm'
          label={origenDoc ? `JSON (armado desde el DocEntry ${origenDoc}; puede editarlo)` : 'JSON libre'}
          placeholder='Arme la solicitud desde un documento, cargue el ejemplo o escriba el JSON.'
          autosize
          minRows={10}
          maxRows={30}
          value={cuerpo}
          onChange={(e) => setCuerpo(e.currentTarget.value)}
          styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)', fontSize: 13 } }}
          spellCheck={false}
        />
        <Group justify='flex-end' mt='sm'>
          <Button color='orange' leftSection={<IconSend size={16} />} disabled={!cuerpo.trim() || !actual?.nabuco_url} onClick={pedirConfirmacion}>
            Enviar a Nabuco
          </Button>
        </Group>
        {resultado && (
          <Stack gap='xs' mt='sm'>
            <Group gap='xs'>
              <Badge color={resultado.ok ? 'green' : 'red'}>{resultado.http_status ? `HTTP ${resultado.http_status}` : 'Sin respuesta HTTP'}</Badge>
              <Text size='sm'>{`${resultado.duracion_ms} ms`}</Text>
              <Text size='sm' c='dimmed'>
                {resultado.url}
              </Text>
            </Group>
            {resultado.error && <Alert color='red'>{resultado.error}</Alert>}
            <Text fw={600}>Respuesta de Nabuco</Text>
            <ScrollArea.Autosize mah={360}>
              <Code block>{bonito(resultado.respuesta)}</Code>
            </ScrollArea.Autosize>
          </Stack>
        )}
      </Card>

      <Card shadow='sm' radius='md' withBorder p='md'>
        <Title order={4} mb='sm'>
          {`Historial de pruebas manuales (últimas ${PRUEBAS_MANUALES.historial})`}
        </Title>
        {hist.loading ? (
          <Loader size='sm' />
        ) : hist.error ? (
          <Alert color='red'>{hist.error}</Alert>
        ) : !hist.data?.pruebas.length ? (
          <Text c='dimmed'>Aún no hay pruebas manuales para esta configuración.</Text>
        ) : (
          <Table.ScrollContainer minWidth={700}>
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Fecha</Table.Th>
                  <Table.Th>Usuario</Table.Th>
                  <Table.Th>Prueba</Table.Th>
                  <Table.Th>HTTP</Table.Th>
                  <Table.Th>ms</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {hist.data.pruebas.map((p) => (
                  <Table.Tr key={p.id_prueba}>
                    <Table.Td>{fmtFechaHora(p.creado)}</Table.Td>
                    <Table.Td>{p.usuario}</Table.Td>
                    <Table.Td>{p.tipo === 'conexion' ? 'Probar conexión' : p.doc_entry ? `DocEntry ${p.doc_entry}` : 'JSON libre'}</Table.Td>
                    <Table.Td>
                      <Badge color={p.error ? 'red' : 'green'} variant='light'>
                        {p.http_status ?? '—'}
                      </Badge>
                    </Table.Td>
                    <Table.Td>{p.duracion_ms ?? '—'}</Table.Td>
                    <Table.Td>
                      <Button size='xs' variant='subtle' leftSection={<IconEye size={14} />} onClick={() => void abrir(p.id_prueba)}>
                        Ver
                      </Button>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Card>

      <Modal opened={confirmar} onClose={() => setConfirmar(false)} title='Enviar a Nabuco' size='lg'>
        <Stack gap='sm'>
          <Text>{`Se enviará a ${actual ? urlSolicitudes(actual) : ''}. Esto crea una solicitud de alistamiento en Nabuco.`}</Text>
          {esProduccion && (
            <>
              <Alert color='red' icon={<IconAlertTriangle size={18} />} title='Esta URL es la de PRODUCCIÓN de Nabuco'>
                {`No parece el ambiente de pruebas. Para enviar de todas formas escriba ${PRUEBAS_MANUALES.palabraProduccion}.`}
              </Alert>
              <TextInput label={`Escriba ${PRUEBAS_MANUALES.palabraProduccion}`} value={palabra} onChange={(e) => setPalabra(e.currentTarget.value)} autoComplete='off' />
            </>
          )}
          <Group justify='flex-end'>
            <Button variant='default' onClick={() => setConfirmar(false)}>
              Cancelar
            </Button>
            <Button
              color={esProduccion ? 'red' : 'orange'}
              leftSection={<IconSend size={16} />}
              loading={ocupado === 'enviar'}
              disabled={esProduccion && palabra !== PRUEBAS_MANUALES.palabraProduccion}
              onClick={() => void enviar()}
            >
              Enviar
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={Boolean(detalle)}
        onClose={() => setDetalle(null)}
        size='xl'
        title={detalle ? `${detalle.tipo === 'conexion' ? 'Probar conexión' : detalle.doc_entry ? `DocEntry ${detalle.doc_entry}` : 'JSON libre'} · ${fmtFechaHora(detalle.creado)}` : ''}
      >
        {detalle && (
          <Stack gap='sm'>
            <Group gap='xs'>
              <Badge color={detalle.error ? 'red' : 'green'}>{detalle.http_status ? `HTTP ${detalle.http_status}` : 'Sin respuesta HTTP'}</Badge>
              <Text size='sm'>{`${detalle.duracion_ms ?? '—'} ms`}</Text>
              <Text size='sm' c='dimmed'>
                {`${detalle.usuario} · ${detalle.url}`}
              </Text>
            </Group>
            {detalle.error && <Alert color='red'>{detalle.error}</Alert>}
            {detalle.tipo === 'envio' && (
              <>
                <Text fw={600}>Payload</Text>
                <ScrollArea.Autosize mah={260}>
                  <Code block>{bonito(detalle.payload)}</Code>
                </ScrollArea.Autosize>
                <Text fw={600}>Respuesta de Nabuco</Text>
                <ScrollArea.Autosize mah={260}>
                  <Code block>{bonito(detalle.respuesta)}</Code>
                </ScrollArea.Autosize>
              </>
            )}
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}
