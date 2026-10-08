'use client';

import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, FileInput, Group, Loader, NumberInput, Stack, Switch, Text, TextInput, Textarea } from '@mantine/core';
import { IconAlertTriangle, IconCheck, IconPhoto } from '@tabler/icons-react';
import { sgcSend, useSgcFetch } from './useSgcFetch';
import SgcSelect from './SgcSelect';
import { SGC_EMAIL_MODES, SGC_EMAIL_MODE_LABELS } from '../../lib/sgc/pendings';

/**
 * «Encabezado y divulgación» en Configuración del SGC (correcciones de
 * Calidad OLP, 2026-10-03; solo Aseguramiento de Calidad):
 *   - LOGO de la empresa para el encabezado institucional del PDF controlado
 *     (PNG o JPEG, máx. 400 KB; queda guardado en el SGC, sin enlaces externos);
 *   - DOMINIOS de correo de la empresa: «toda la empresa», departamentos y
 *     cargos solo incluyen esos correos en la divulgación (otras personas, solo
 *     elegidas a mano como «Persona»);
 *   - UMBRAL de avance de lectura que se avisa al creador y a Calidad.
 * Cada cambio pide motivo y queda en la auditoría.
 */
interface Settings {
  idCompany: number;
  hasLogo: boolean;
  logoDataUrl: string | null;
  disseminationDomains: string[] | null;
  readThresholdPct: number;
  headerMandatory?: boolean;
  initialLoad?: { open: boolean; closedBy: string | null; closedAt: string | null; reason: string | null };
  emailMode?: string;
  uncontrolledCopies?: { types: string[]; days: number; maxDays: number };
  viewerProtection?: boolean;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('No se pudo leer la imagen.'));
    reader.readAsDataURL(file);
  });
}

export default function SgcCompanySettings({ idCompany }: { idCompany: number }) {
  const { data, error, reload } = useSgcFetch<Settings>(`/api/sgc/company-settings?company=${idCompany}`);
  const [logo, setLogo] = useState<File | null>(null);
  const [domains, setDomains] = useState('');
  const [threshold, setThreshold] = useState<number | string>(90);
  const [reason, setReason] = useState('');
  const [emailMode, setEmailMode] = useState<string>('nunca');
  // Sprint 11: copias no controladas y protección del visor.
  const [copyTypes, setCopyTypes] = useState('FO, FR');
  const [copyDays, setCopyDays] = useState<number | string>(30);
  const [copyMaxDays, setCopyMaxDays] = useState<number | string>(90);
  const [viewerProtection, setViewerProtection] = useState(true);
  const [closeReason, setCloseReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!data) return;
    setDomains((data.disseminationDomains ?? []).join(', '));
    setThreshold(data.readThresholdPct);
    setEmailMode(data.emailMode ?? 'nunca');
    if (data.uncontrolledCopies) {
      setCopyTypes(data.uncontrolledCopies.types.join(', '));
      setCopyDays(data.uncontrolledCopies.days);
      setCopyMaxDays(data.uncontrolledCopies.maxDays);
    }
    setViewerProtection(data.viewerProtection ?? true);
  }, [data]);

  if (error) {
    return (
      <Alert color='red' icon={<IconAlertTriangle size={18} />}>
        {error}
      </Alert>
    );
  }
  if (!data) {
    return (
      <Group justify='center' my='xl'>
        <Loader />
      </Group>
    );
  }

  const save = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      const body: Record<string, unknown> = { company: idCompany, reason, disseminationDomains: domains, readThresholdPct: Number(threshold), emailMode, uncontrolledCopyTypes: copyTypes, uncontrolledCopyDays: Number(copyDays), uncontrolledCopyMaxDays: Number(copyMaxDays), viewerProtection };
      if (logo) body.logoDataUrl = await fileToDataUrl(logo);
      await sgcSend('/api/sgc/company-settings', 'PUT', body);
      setFeedback({ ok: true, text: 'Configuración guardada y registrada en la auditoría.' });
      setLogo(null);
      setReason('');
      reload();
    } catch (e) {
      setFeedback({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  // Sprint 9: cierre de la carga inicial (Calidad, con motivo; no se cierra con documentos pendientes de archivo).
  const closeLoad = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      await sgcSend('/api/sgc/company-settings/initial-load', 'POST', { company: idCompany, reason: closeReason });
      setFeedback({ ok: true, text: 'Carga inicial cerrada: desde ahora los documentos nuevos entran por una solicitud documental.' });
      setCloseReason('');
      reload();
    } catch (e) {
      setFeedback({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card withBorder radius='md' p='lg' data-testid='sgc-config-empresa'>
      <Stack gap='md'>
        {feedback && (
          <Alert color={feedback.ok ? 'green' : 'red'} icon={feedback.ok ? <IconCheck size={16} /> : <IconAlertTriangle size={16} />} data-testid='sgc-config-empresa-mensaje'>
            {feedback.text}
          </Alert>
        )}
        <div data-testid='sgc-config-encabezado-carga'>
          <Text fw={600} size='sm' mb={4}>
            Encabezado institucional y carga inicial
          </Text>
          <Group gap='xs' wrap='wrap'>
            <Badge color={data.headerMandatory === false ? 'gray' : 'blue'} variant='light' data-testid='sgc-config-encabezado-obligatorio'>
              {data.headerMandatory === false ? 'Encabezado opcional por documento' : 'Encabezado obligatorio en documentos nuevos y nuevas versiones'}
            </Badge>
            <Badge color={data.initialLoad?.open === false ? 'gray' : 'green'} variant='light' data-testid='sgc-config-carga-inicial'>
              {data.initialLoad?.open === false ? 'Carga inicial cerrada' : 'Carga inicial abierta'}
            </Badge>
          </Group>
          <Text size='xs' c='dimmed' mt={4}>
            {data.initialLoad?.open === false
              ? `La cerró ${data.initialLoad.closedBy ?? '—'} el ${data.initialLoad.closedAt?.slice(0, 10) ?? '—'}: ${data.initialLoad.reason ?? ''}`
              : 'Mientras la carga inicial está abierta, Calidad sube los documentos vigentes con su propio encabezado (uno a uno o desde el listado maestro en Excel).'}
          </Text>
          {data.initialLoad?.open !== false && (
            <Group align='flex-end' mt='xs' wrap='wrap'>
              <TextInput label='Motivo del cierre' placeholder='Carga del listado maestro terminada y verificada' value={closeReason} onChange={(e) => setCloseReason(e.currentTarget.value)} autoComplete='off' style={{ flex: 1, minWidth: 260 }} data-testid='sgc-config-cierre-motivo' />
              <Button color='orange' variant='light' onClick={() => void closeLoad()} loading={busy} disabled={closeReason.trim().length < 10} data-testid='sgc-config-cerrar-carga'>
                Cerrar carga inicial
              </Button>
            </Group>
          )}
        </div>
        <div>
          <Text fw={600} size='sm' mb={4}>
            Logo del encabezado institucional
          </Text>
          <Group align='flex-end' wrap='wrap'>
            {data.logoDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={data.logoDataUrl} alt='Logo de la empresa' style={{ height: 56, border: '1px solid var(--mantine-color-gray-3)', borderRadius: 6, padding: 4, background: '#fff' }} data-testid='sgc-config-logo' />
            ) : (
              <Text size='sm' c='dimmed'>
                Sin logo: el encabezado muestra el nombre de la empresa.
              </Text>
            )}
            <FileInput placeholder='Cargar logo (PNG o JPEG, máx. 400 KB)' accept='image/png,image/jpeg' value={logo} onChange={setLogo} leftSection={<IconPhoto size={16} />} w={340} data-testid='sgc-config-logo-archivo' />
          </Group>
        </div>
        <TextInput
          label='Dominios de correo de la empresa'
          description='«Toda la empresa», departamentos y cargos solo incluyen estos correos en la divulgación. A una persona de otra empresa se le asigna lectura solo eligiéndola como «Persona». Vacío = sin filtro.'
          placeholder='onelatampharma.com'
          value={domains}
          onChange={(e) => setDomains(e.currentTarget.value)}
          autoComplete='off'
          data-testid='sgc-config-dominios'
        />
        <SgcSelect
          label='Correo del SGC'
          description='Los avisos siempre llegan a la campana y al tablero «Mis pendientes». El correo es opcional: por defecto, ninguno.'
          data={SGC_EMAIL_MODES.map((m) => ({ value: m, label: SGC_EMAIL_MODE_LABELS[m] }))}
          value={emailMode}
          onChange={(v) => setEmailMode(v ?? 'nunca')}
          allowDeselect={false}
          w={360}
          data-testid='sgc-config-correo'
        />
        <Group align='flex-end' wrap='wrap'>
          <TextInput label='Copias no controladas: tipos documentales' description='Códigos que admiten copia no controlada (por defecto formatos FO, FR).' value={copyTypes} onChange={(e) => setCopyTypes(e.currentTarget.value.toUpperCase())} w={300} autoComplete='off' data-testid='sgc-config-copias-tipos' />
          <NumberInput label='Días por defecto' min={1} max={365} value={copyDays} onChange={setCopyDays} w={140} />
          <NumberInput label='Días máximos' min={1} max={365} value={copyMaxDays} onChange={setCopyMaxDays} w={140} />
        </Group>
        <Switch
          label='Protección del visor: marca de agua en mosaico, ocultar el documento sin foco y registrar «Imprimir pantalla»'
          description='Una página web no puede impedir una captura de pantalla: la marca identifica a quién se le filtró y el intento queda en la auditoría.'
          checked={viewerProtection}
          onChange={(e) => setViewerProtection(e.currentTarget.checked)}
          data-testid='sgc-config-visor'
        />
        <NumberInput label='Umbral de aviso de avance de lectura (%)' description='Al llegar a este porcentaje de lectura se avisa una vez al creador del documento y a Calidad.' min={1} max={100} value={threshold} onChange={setThreshold} w={320} data-testid='sgc-config-umbral' />
        <Textarea label='Motivo del cambio' description='Mínimo 10 caracteres: queda en el control de cambios.' autosize minRows={2} value={reason} onChange={(e) => setReason(e.currentTarget.value)} autoComplete='off' data-testid='sgc-config-empresa-motivo' />
        <Group justify='flex-end'>
          <Button onClick={() => void save()} loading={busy} disabled={reason.trim().length < 10} data-testid='sgc-config-empresa-guardar'>
            Guardar
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}
