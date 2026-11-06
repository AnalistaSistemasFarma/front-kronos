'use client';

import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Code, Divider, Group, Loader, NumberInput, PasswordInput, ScrollArea, SimpleGrid, Stack, Switch, Text, TextInput, Textarea, Title } from '@mantine/core';
import { IconDeviceFloppy, IconEye, IconPlayerPlay, IconPlugConnected, IconPlus } from '@tabler/icons-react';
import toast from 'react-hot-toast';
import SgcSelect from '../sgc/SgcSelect';
import { CRON_OPCIONES, DEFAULTS, ENTIDAD_LABEL, NABUCO_ENTIDADES } from '../../lib/transferencias-nabuco/constants';
import { MAPEO_ENCABEZADO_DEFECTO, MAPEO_LINEAS_DEFECTO, type FilaMapeo } from '../../lib/transferencias-nabuco/mapeo';
import { describeCron } from '../../lib/scheduler/presets';
import type { DiagnosticoNabuco } from '../../lib/transferencias-nabuco/diagnostico';
import { diagnosticoDe, errorTexto, nabucoSend, useNabucoFetch, type NabucoCompany } from './client';
import NabucoMapeo from './NabucoMapeo';
import NabucoDiagnostico from './NabucoDiagnostico';

/** Resultado de «Probar conexión» (también lo usa la pestaña Pruebas manuales). */
export interface ResultadoProbar {
  diagnostico: DiagnosticoNabuco;
  usaCambiosSinGuardar: boolean;
}

/** Datos de conexión de pantalla que se mandan a «Probar conexión» (no se guardan). */
export interface DatosConexionPantalla {
  nabuco_url: string;
  nabuco_usuario: string;
  nabuco_password: string;
  nabuco_org: string;
  ruta_token: string;
  timeout_ms: number;
}

/** Valida en el cliente qué falta (ni escrito ni guardado). null = se puede probar. */
export function faltanParaProbar(d: Partial<DatosConexionPantalla>, passwordGuardada: boolean): string | null {
  const faltan = [!d.nabuco_url?.trim() && 'la URL', !d.nabuco_usuario?.trim() && 'el usuario', !d.nabuco_password && !passwordGuardada && 'la contraseña'].filter(Boolean);
  return faltan.length ? `Falta ${faltan.join(', ')} de Nabuco (no está escrito en pantalla ni guardado).` : null;
}

/** Llama a «Probar conexión» de la config con los datos de pantalla y devuelve el diagnóstico (nunca lanza). */
export async function probarConexionApi(idConfig: number, datos: Partial<DatosConexionPantalla>): Promise<ResultadoProbar> {
  try {
    const res = await fetch(`/api/transferencias-nabuco/configs/${idConfig}/probar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(datos) });
    const b = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; diagnostico?: DiagnosticoNabuco; usaCambiosSinGuardar?: boolean };
    if (b.diagnostico) return { diagnostico: res.ok ? b.diagnostico : { ...b.diagnostico, http_synerlink: b.diagnostico.http_synerlink ?? res.status }, usaCambiosSinGuardar: Boolean(b.usaCambiosSinGuardar) };
    return { diagnostico: diagnosticoDe(new Error(`SynerLink respondió HTTP ${res.status}: ${b.error ?? 'sin mensaje'}`)), usaCambiosSinGuardar: false };
  } catch (e) {
    return { diagnostico: { ...diagnosticoDe(e), etapa: 'red', mensaje: `No se pudo llamar a SynerLink: ${errorTexto(e)}` }, usaCambiosSinGuardar: false };
  }
}

export function AvisoSinGuardar() {
  return (
    <Alert color='yellow' variant='light'>
      Probado con los datos de pantalla, que aún NO están guardados. Guarde para que el envío use estas credenciales.
    </Alert>
  );
}

/** Configuración tal como la devuelve la API (nunca trae la contraseña). */
interface ConfigPublica {
  id_config: number;
  nombre: string;
  activo: boolean;
  modo_simulacion: boolean;
  id_sap_endpoint: number | null;
  nabuco_url: string | null;
  nabuco_usuario: string | null;
  password_configurada: boolean;
  nabuco_org: string;
  ruta_token: string;
  ruta_solicitudes: string;
  timeout_ms: number;
  entidad_sap: string;
  filtro_odata: string | null;
  desde_fecha: string | null;
  lote_max: number;
  marcar_udf: boolean;
  udf_campo: string | null;
  udf_valor: string | null;
  clave_lineas: string;
  mapeo_encabezado: FilaMapeo[];
  mapeo_lineas: FilaMapeo[];
  max_reintentos: number;
  espera_reintento_min: number;
  alertas_correos: string[];
  alertar_fallo: boolean;
  alertar_sin_correr_min: number | null;
  cron_expression: string | null;
}
interface Endpoint {
  id: number;
  nombre: string;
  companyDB: string;
  activo: boolean;
}

type Form = Omit<ConfigPublica, 'id_config' | 'password_configurada' | 'alertas_correos' | 'cron_expression'> & {
  nabuco_password: string;
  alertas_correos: string;
  cron_expression: string;
};

function formNuevo(): Form {
  return {
    nombre: '',
    activo: false,
    modo_simulacion: true,
    id_sap_endpoint: null,
    nabuco_url: '',
    nabuco_usuario: '',
    nabuco_password: '',
    nabuco_org: DEFAULTS.org,
    ruta_token: DEFAULTS.rutaToken,
    ruta_solicitudes: DEFAULTS.rutaSolicitudes,
    timeout_ms: DEFAULTS.timeoutMs,
    entidad_sap: DEFAULTS.entidad,
    filtro_odata: '',
    desde_fecha: new Date().toISOString().slice(0, 10),
    lote_max: DEFAULTS.loteMax,
    marcar_udf: false,
    udf_campo: '',
    udf_valor: '',
    clave_lineas: DEFAULTS.claveLineas,
    mapeo_encabezado: MAPEO_ENCABEZADO_DEFECTO.map((f) => ({ ...f })),
    mapeo_lineas: MAPEO_LINEAS_DEFECTO.map((f) => ({ ...f })),
    max_reintentos: DEFAULTS.maxReintentos,
    espera_reintento_min: DEFAULTS.esperaReintentoMin,
    alertas_correos: '',
    alertar_fallo: true,
    alertar_sin_correr_min: null,
    cron_expression: DEFAULTS.cron,
  };
}

function formDe(c: ConfigPublica): Form {
  const { id_config: _i, password_configurada: _p, ...resto } = c;
  return { ...resto, nabuco_password: '', alertas_correos: c.alertas_correos.join('; '), cron_expression: c.cron_expression ?? DEFAULTS.cron };
}

/** Pestaña Configuración (solo administradores): todo lo parametrizable del módulo, por empresa. */
export default function NabucoConfiguracion({ company }: { company: NabucoCompany }) {
  const { data, error, loading, reload } = useNabucoFetch<{ configs: ConfigPublica[]; endpoints: Endpoint[] }>(`/api/transferencias-nabuco/configs?company=${company.idCompany}`);
  const [sel, setSel] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(formNuevo());
  const [guardando, setGuardando] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [docEntry, setDocEntry] = useState<number | string>('');
  const [preview, setPreview] = useState<string | null>(null);
  const [prueba, setPrueba] = useState<ResultadoProbar | null>(null);
  const [fallo, setFallo] = useState<DiagnosticoNabuco | null>(null);

  const actual = data?.configs.find((c) => String(c.id_config) === sel) ?? null;

  // Con configuraciones y ninguna (válida) seleccionada se toma la primera; '' = «Nueva configuración».
  useEffect(() => {
    if (!data?.configs.length || sel === '') return;
    if (!data.configs.some((c) => String(c.id_config) === sel)) setSel(String(data.configs[0].id_config));
  }, [data, sel]);
  useEffect(() => {
    setForm(actual ? formDe(actual) : formNuevo());
    setPreview(null);
    setPrueba(null);
  }, [actual]);

  // «Cambios sin guardar»: el formulario difiere de lo cargado (o hay una contraseña escrita).
  const sinGuardar = actual ? JSON.stringify(form) !== JSON.stringify(formDe(actual)) : false;

  const probar = async () => {
    if (!actual) return;
    const datos: DatosConexionPantalla = {
      nabuco_url: form.nabuco_url ?? '',
      nabuco_usuario: form.nabuco_usuario ?? '',
      nabuco_password: form.nabuco_password,
      nabuco_org: form.nabuco_org,
      ruta_token: form.ruta_token,
      timeout_ms: form.timeout_ms,
    };
    const falta = faltanParaProbar(datos, actual.password_configurada);
    if (falta) {
      setPrueba({ diagnostico: { ok: false, etapa: 'validacion', mensaje: falta, sugerencia: 'Complete el dato en el formulario (puede probar sin guardar). No se llamó al servidor.', duracion_ms: 0, cuando: new Date().toISOString() }, usaCambiosSinGuardar: false });
      return;
    }
    setOcupado('probar');
    setPrueba(null);
    setPrueba(await probarConexionApi(actual.id_config, datos));
    setOcupado(null);
  };

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const guardar = async () => {
    setGuardando(true);
    setFallo(null);
    try {
      const body = { ...form, company: company.idCompany, nabuco_password: form.nabuco_password || undefined };
      if (actual) {
        await nabucoSend(`/api/transferencias-nabuco/configs/${actual.id_config}`, 'PATCH', body);
        toast.success('Configuración guardada.');
        void reload();
      } else {
        const r = await nabucoSend<{ id_config: number }>('/api/transferencias-nabuco/configs', 'POST', body);
        toast.success('Configuración creada en modo simulación.');
        // Primero recarga y luego selecciona: si no, la autoselección vería un id que aún no está en la lista.
        await reload();
        setSel(String(r.id_config));
      }
    } catch (e) {
      toast.error(errorTexto(e));
      setFallo(diagnosticoDe(e));
    } finally {
      setGuardando(false);
    }
  };

  const ejecutar = async (que: 'ejecutar' | 'vista-previa') => {
    if (!actual) return;
    setOcupado(que);
    setFallo(null);
    try {
      if (que === 'vista-previa') {
        const r = await nabucoSend<{ payload: unknown }>(`/api/transferencias-nabuco/configs/${actual.id_config}/vista-previa`, 'POST', { docEntry: Number(docEntry) });
        setPreview(JSON.stringify(r.payload, null, 2));
      } else {
        const r = await nabucoSend<{ mensaje?: string; texto?: string }>(`/api/transferencias-nabuco/configs/${actual.id_config}/${que}`, 'POST');
        toast.success(r.mensaje ?? r.texto ?? 'Listo.');
      }
    } catch (e) {
      toast.error(errorTexto(e));
      setFallo(diagnosticoDe(e));
    } finally {
      setOcupado(null);
    }
  };

  if (loading) return <Loader />;
  if (error) return <Alert color='red'>{error}</Alert>;

  const cronEsComun = CRON_OPCIONES.some((o) => o.value === form.cron_expression);

  return (
    <Stack gap='md'>
      <Card shadow='sm' radius='md' withBorder p='md'>
        <Group align='flex-end' gap='sm' wrap='wrap'>
          <SgcSelect
            label='Configuración'
            placeholder='Seleccione'
            data={(data?.configs ?? []).map((c) => ({ value: String(c.id_config), label: c.nombre }))}
            value={sel || null}
            onChange={setSel}
            allowDeselect={false}
            w={{ base: '100%', sm: 300 }}
          />
          <Button variant='light' leftSection={<IconPlus size={16} />} onClick={() => setSel('')}>
            Nueva configuración
          </Button>
          {sinGuardar && <Badge color='yellow'>Cambios sin guardar</Badge>}
          {actual && (
            <>
              <Badge color={actual.activo ? 'green' : 'gray'}>{actual.activo ? 'Activa' : 'Pausada'}</Badge>
              {actual.modo_simulacion && <Badge color='blue'>Simulación</Badge>}
            </>
          )}
        </Group>
      </Card>

      <Card shadow='sm' radius='md' withBorder p='md'>
        <Title order={4} mb='sm'>
          General
        </Title>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <TextInput label='Nombre' required value={form.nombre} onChange={(e) => set('nombre', e.currentTarget.value)} />
          <SgcSelect
            label='Conexión SAP (Service Layer)'
            placeholder='La activa de la empresa'
            clearable
            data={(data?.endpoints ?? []).map((e) => ({ value: String(e.id), label: `${e.nombre} · ${e.companyDB}${e.activo ? '' : ' (inactiva)'}` }))}
            value={form.id_sap_endpoint ? String(form.id_sap_endpoint) : null}
            onChange={(v) => set('id_sap_endpoint', v ? Number(v) : null)}
          />
          <Switch label='Activa (la tarea corre según la programación)' checked={form.activo} onChange={(e) => set('activo', e.currentTarget.checked)} />
          <Switch
            label='Modo simulación (arma el payload y lo registra, pero NO envía a Nabuco)'
            checked={form.modo_simulacion}
            onChange={(e) => set('modo_simulacion', e.currentTarget.checked)}
          />
        </SimpleGrid>
      </Card>

      <Card shadow='sm' radius='md' withBorder p='md'>
        <Title order={4} mb='sm'>
          Nabuco
        </Title>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <TextInput label='URL base del API' placeholder='https://…' value={form.nabuco_url ?? ''} onChange={(e) => set('nabuco_url', e.currentTarget.value)} />
          <TextInput label='Usuario' value={form.nabuco_usuario ?? ''} onChange={(e) => set('nabuco_usuario', e.currentTarget.value)} autoComplete='off' />
          <PasswordInput
            label='Contraseña'
            description={actual?.password_configurada ? '••• configurada. Escriba solo si desea cambiarla.' : 'Se guarda cifrada; nunca se vuelve a mostrar.'}
            value={form.nabuco_password}
            onChange={(e) => set('nabuco_password', e.currentTarget.value)}
            autoComplete='new-password'
          />
          <TextInput label='Org' value={form.nabuco_org} onChange={(e) => set('nabuco_org', e.currentTarget.value)} />
          <TextInput label='Ruta de token' value={form.ruta_token} onChange={(e) => set('ruta_token', e.currentTarget.value)} />
          <TextInput label='Ruta de solicitudes' value={form.ruta_solicitudes} onChange={(e) => set('ruta_solicitudes', e.currentTarget.value)} />
          <NumberInput label='Timeout (ms)' min={1000} max={120000} step={1000} value={form.timeout_ms} onChange={(v) => set('timeout_ms', Number(v) || DEFAULTS.timeoutMs)} />
        </SimpleGrid>
        <Group mt='sm'>
          <Button variant='light' leftSection={<IconPlugConnected size={16} />} disabled={!actual} loading={ocupado === 'probar'} onClick={() => void probar()}>
            Probar conexión
          </Button>
          {!actual && <Text size='sm' c='dimmed'>Guarde la configuración para probar la conexión.</Text>}
          {actual && <Text size='sm' c='dimmed'>Prueba con los datos que están en pantalla (sin guardarlos).</Text>}
        </Group>
        {prueba && (
          <Stack gap='xs' mt='sm'>
            {prueba.usaCambiosSinGuardar && <AvisoSinGuardar />}
            <NabucoDiagnostico diagnostico={prueba.diagnostico} />
          </Stack>
        )}
      </Card>

      <Card shadow='sm' radius='md' withBorder p='md'>
        <Title order={4} mb='sm'>
          Documento disparador y control de enviados
        </Title>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <SgcSelect label='Entidad SAP' data={NABUCO_ENTIDADES.map((e) => ({ value: e, label: ENTIDAD_LABEL[e] }))} value={form.entidad_sap} allowDeselect={false} onChange={(v) => set('entidad_sap', v ?? DEFAULTS.entidad)} />
          <TextInput label='Enviar solo documentos desde' type='date' value={form.desde_fecha ?? ''} onChange={(e) => set('desde_fecha', e.currentTarget.value || null)} />
          <TextInput
            label='Filtro OData adicional (opcional)'
            placeholder="Ej. DocumentStatus eq 'bost_Open'"
            value={form.filtro_odata ?? ''}
            onChange={(e) => set('filtro_odata', e.currentTarget.value)}
          />
          <NumberInput label='Máximo de documentos por corrida' min={1} max={500} value={form.lote_max} onChange={(v) => set('lote_max', Number(v) || DEFAULTS.loteMax)} />
        </SimpleGrid>
        <Text size='sm' c='dimmed' mt='sm'>
          El log de SynerLink garantiza que un documento enviado nunca se reenvíe. Opcionalmente puede marcar además un campo de usuario en SAP (vía Service Layer).
        </Text>
        <SimpleGrid cols={{ base: 1, sm: 3 }} mt='xs'>
          <Switch label='Marcar UDF en SAP al enviar' checked={form.marcar_udf} onChange={(e) => set('marcar_udf', e.currentTarget.checked)} />
          <TextInput label='Campo UDF' placeholder='U_SEND_TraNab' disabled={!form.marcar_udf} value={form.udf_campo ?? ''} onChange={(e) => set('udf_campo', e.currentTarget.value)} />
          <TextInput label='Valor' placeholder='SI' disabled={!form.marcar_udf} value={form.udf_valor ?? ''} onChange={(e) => set('udf_valor', e.currentTarget.value)} />
        </SimpleGrid>
      </Card>

      <Card shadow='sm' radius='md' withBorder p='md'>
        <Title order={4} mb='sm'>
          Mapeo del encabezado
        </Title>
        <NabucoMapeo filas={form.mapeo_encabezado} onChange={(f) => set('mapeo_encabezado', f)} />
        <Divider my='md' />
        <Group justify='space-between' align='flex-end' mb='sm'>
          <Title order={4}>Mapeo de líneas</Title>
          <TextInput label='Clave de la lista de líneas en Nabuco' value={form.clave_lineas} onChange={(e) => set('clave_lineas', e.currentTarget.value)} w={260} />
        </Group>
        <Text size='sm' c='dimmed' mb='xs'>
          {`Se leen de ${form.entidad_sap === 'StockTransfers' || form.entidad_sap === 'InventoryTransferRequests' ? 'StockTransferLines' : 'DocumentLines'}.`}
        </Text>
        <NabucoMapeo filas={form.mapeo_lineas} onChange={(f) => set('mapeo_lineas', f)} />
      </Card>

      <Card shadow='sm' radius='md' withBorder p='md'>
        <Title order={4} mb='sm'>
          Programación y alertas
        </Title>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <SgcSelect
            label='Frecuencia'
            data={[...CRON_OPCIONES, { value: 'custom', label: 'Cron personalizado' }]}
            value={cronEsComun ? form.cron_expression : 'custom'}
            allowDeselect={false}
            onChange={(v) => v && v !== 'custom' && set('cron_expression', v)}
          />
          <TextInput label='Expresión cron' description={describeCron(form.cron_expression)} value={form.cron_expression} onChange={(e) => set('cron_expression', e.currentTarget.value)} />
          <NumberInput label='Máximo de reintentos por documento' min={0} max={20} value={form.max_reintentos} onChange={(v) => set('max_reintentos', Number(v) || 0)} />
          <NumberInput label='Minutos de espera entre reintentos' min={1} max={1440} value={form.espera_reintento_min} onChange={(v) => set('espera_reintento_min', Number(v) || DEFAULTS.esperaReintentoMin)} />
          <Textarea label='Destinatarios de alertas' description='Correos separados por punto y coma' autosize minRows={1} value={form.alertas_correos} onChange={(e) => set('alertas_correos', e.currentTarget.value)} />
          <NumberInput
            label='Alertar si la tarea no corre en (minutos)'
            description='Vacío = no alertar'
            min={5}
            value={form.alertar_sin_correr_min ?? ''}
            onChange={(v) => set('alertar_sin_correr_min', v === '' ? null : Number(v))}
          />
          <Switch label='Alertar cuando un envío falle tras agotar los reintentos' checked={form.alertar_fallo} onChange={(e) => set('alertar_fallo', e.currentTarget.checked)} />
        </SimpleGrid>
      </Card>

      {fallo && <NabucoDiagnostico diagnostico={fallo} />}
      <Group justify='flex-end'>
        {actual && (
          <Button variant='light' leftSection={<IconPlayerPlay size={16} />} loading={ocupado === 'ejecutar'} onClick={() => void ejecutar('ejecutar')}>
            Ejecutar ahora
          </Button>
        )}
        <Button leftSection={<IconDeviceFloppy size={16} />} loading={guardando} onClick={() => void guardar()}>
          {actual ? 'Guardar cambios' : 'Crear configuración'}
        </Button>
      </Group>

      {actual && (
        <Card shadow='sm' radius='md' withBorder p='md'>
          <Title order={4} mb='sm'>
            Vista previa
          </Title>
          <Text size='sm' c='dimmed' mb='xs'>
            Muestra el payload que se enviaría para un documento, con la configuración GUARDADA. No envía nada.
          </Text>
          <Group align='flex-end'>
            <NumberInput label='DocEntry' min={1} value={docEntry} onChange={setDocEntry} w={180} />
            <Button variant='light' leftSection={<IconEye size={16} />} disabled={!docEntry} loading={ocupado === 'vista-previa'} onClick={() => void ejecutar('vista-previa')}>
              Ver payload
            </Button>
          </Group>
          {preview && (
            <ScrollArea.Autosize mah={360} mt='sm'>
              <Code block>{preview}</Code>
            </ScrollArea.Autosize>
          )}
        </Card>
      )}
    </Stack>
  );
}
