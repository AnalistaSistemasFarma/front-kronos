'use client';

import { useState } from 'react';
import { Alert, Badge, Button, Card, FileButton, Group, Image, SegmentedControl, Stack, Text, Title } from '@mantine/core';
import { IconAlertCircle, IconCheck, IconSignature, IconUpload } from '@tabler/icons-react';
import SgcSignaturePad from './SgcSignaturePad';
import { formatDateCO } from '../tareas/format';
import { sgcSend, useSgcFetch } from '../useSgcFetch';
import { SGC_MASTER_STATUS_LABELS, clearLightBackground, fitScale, inkBoundsRgba, type SgcMasterStatus } from '../../../lib/sgc/signature/ownSignature';

/**
 * «MI FIRMA» (Sprint 13, R13). Cada persona registra SU firma: dibujada o
 * subida como imagen (PNG o JPG). En el navegador se recorta a la tinta, el
 * fondo claro queda transparente y se guarda como PNG. Queda PENDIENTE hasta
 * que Aseguramiento de Calidad la valide; mientras tanto no firma documentos
 * (sigue la validada anterior, si existe). Mismas tarjetas que el maestro de
 * firmas de Calidad.
 */
interface MasterView {
  id: number;
  versionNumber: number;
  imagePng: string | null;
  registeredAt: string;
  status: SgcMasterStatus;
  captureMethod: 'dibujada' | 'imagen' | null;
  validatedBy: string | null;
  validatedAt: string | null;
  revokeReason: string | null;
}
interface Data {
  enabled: boolean;
  active: MasterView | null;
  pending: MasterView | null;
  history: MasterView[];
}

const STATUS_COLOR: Record<SgcMasterStatus, string> = { validada: 'teal', pendiente: 'orange', rechazada: 'red', revocada: 'gray' };

/** Carga una imagen (data URL u objeto) en un canvas, la recorta a la tinta y devuelve un PNG con fondo transparente. */
export async function cropToInk(src: string): Promise<string | null> {
  const img = new window.Image();
  img.src = src;
  await img.decode();
  const scale = fitScale(img.naturalWidth, img.naturalHeight, 1600);
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const full = document.createElement('canvas');
  full.width = w;
  full.height = h;
  const ctx = full.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, w, h);
  const pixels = ctx.getImageData(0, 0, w, h);
  const box = inkBoundsRgba(pixels.data, w, h);
  if (!box) return null;
  clearLightBackground(pixels.data);
  ctx.putImageData(pixels, 0, 0);
  const s = fitScale(box.width, box.height, 600);
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(box.width * s));
  out.height = Math.max(1, Math.round(box.height * s));
  out.getContext('2d')?.drawImage(full, box.x, box.y, box.width, box.height, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}

function Status({ m }: { m: MasterView }) {
  return (
    <Badge color={STATUS_COLOR[m.status]} variant='light'>
      {SGC_MASTER_STATUS_LABELS[m.status]}
    </Badge>
  );
}

export default function SgcOwnSignature({ idCompany }: { idCompany: number }) {
  const { data, error, reload } = useSgcFetch<Data>(`/api/sgc/signature/own?company=${idCompany}`);
  const [mode, setMode] = useState<'dibujada' | 'imagen'>('dibujada');
  const [image, setImage] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const take = async (src: string) => {
    setMsg(null);
    try {
      const png = await cropToInk(src);
      if (!png) setMsg({ ok: false, text: 'La imagen no tiene trazo: dibuje su firma o suba una foto clara de ella sobre fondo blanco.' });
      setImage(png);
    } catch {
      setMsg({ ok: false, text: 'No se pudo leer la imagen. Use un PNG o JPG.' });
    }
  };

  if (error) return <Alert color='red'>{error}</Alert>;
  if (!data) return null;
  if (!data.enabled) {
    return (
      <Alert color='blue' icon={<IconAlertCircle size={16} />} data-testid='sgc-mi-firma-apagada'>
        La firma propia no está habilitada en esta empresa: encenderla requiere el aval de la Dra. Adriana Cárdenas. Mientras tanto, Aseguramiento de Calidad registra su firma en la inducción.
      </Alert>
    );
  }
  return (
    <Stack data-testid='sgc-mi-firma'>
      {msg && (
        <Alert color={msg.ok ? 'green' : 'red'} icon={msg.ok ? <IconCheck size={16} /> : <IconAlertCircle size={16} />} data-testid='sgc-mi-firma-mensaje'>
          {msg.text}
        </Alert>
      )}
      <Card withBorder radius='md' p='lg'>
        <Title order={4} mb='sm' className='flex items-center gap-2'>
          <IconSignature size={18} /> Mi firma
        </Title>
        <Stack gap='xs'>
          {data.active ? (
            <Group>
              {data.active.imagePng && <Image src={data.active.imagePng} alt='Mi firma validada' h={60} w='auto' fit='contain' />}
              <Status m={data.active} />
              <Text size='xs' c='dimmed'>
                Validada por {data.active.validatedBy ?? 'Aseguramiento de Calidad'}
                {data.active.validatedAt ? ` · ${formatDateCO(data.active.validatedAt)}` : ''}
              </Text>
            </Group>
          ) : (
            <Text size='sm' c='dimmed'>
              Aún no tiene una firma validada: sus firmas electrónicas se registran igual (contraseña, significado y motivo), pero sin el trazo.
            </Text>
          )}
          {data.pending && (
            <Group data-testid='sgc-mi-firma-pendiente'>
              {data.pending.imagePng && <Image src={data.pending.imagePng} alt='Firma pendiente' h={60} w='auto' fit='contain' />}
              <Status m={data.pending} />
              <Text size='xs' c='dimmed'>
                Registrada {formatDateCO(data.pending.registeredAt)}. No firma documentos hasta que Calidad la valide.
              </Text>
            </Group>
          )}
        </Stack>
      </Card>

      <Card withBorder radius='md' p='lg'>
        <Title order={4} mb='sm'>
          {data.active || data.pending ? 'Registrar una nueva firma' : 'Registrar mi firma'}
        </Title>
        <Stack>
          <SegmentedControl
            value={mode}
            onChange={(v) => {
              setMode(v as 'dibujada' | 'imagen');
              setImage(null);
            }}
            data={[
              { value: 'dibujada', label: 'Dibujarla' },
              { value: 'imagen', label: 'Subir una imagen (PNG o JPG)' },
            ]}
            data-testid='sgc-mi-firma-modo'
          />
          {image ? (
            <Group>
              <Image src={image} alt='Firma recortada' h={80} w='auto' fit='contain' radius='sm' data-testid='sgc-mi-firma-vista' />
              <Button variant='default' onClick={() => setImage(null)}>
                Cambiar
              </Button>
            </Group>
          ) : mode === 'dibujada' ? (
            <SgcSignaturePad onSave={(url) => void take(url)} />
          ) : (
            <FileButton
              accept='image/png,image/jpeg'
              onChange={(file) => {
                if (!file) return;
                const url = URL.createObjectURL(file);
                void take(url).finally(() => URL.revokeObjectURL(url));
              }}
            >
              {(props) => (
                <Button {...props} variant='light' leftSection={<IconUpload size={14} />} data-testid='sgc-mi-firma-subir'>
                  Elegir imagen
                </Button>
              )}
            </FileButton>
          )}
          <Text size='xs' c='dimmed'>
            Solo usted puede registrar su firma. Se recorta a la tinta y queda pendiente hasta que Aseguramiento de Calidad la valide (por ejemplo, comparándola con su documento de identidad).
          </Text>
          <Group justify='flex-end'>
            <Button
              disabled={!image}
              loading={busy}
              onClick={async () => {
                setBusy(true);
                setMsg(null);
                try {
                  await sgcSend('/api/sgc/signature/own', 'POST', { company: idCompany, imagePng: image, method: mode });
                  setMsg({ ok: true, text: 'Firma registrada: queda pendiente de la validación de Aseguramiento de Calidad.' });
                  setImage(null);
                  reload();
                } catch (e) {
                  setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
                } finally {
                  setBusy(false);
                }
              }}
              data-testid='sgc-mi-firma-registrar'
            >
              Registrar mi firma
            </Button>
          </Group>
        </Stack>
      </Card>
    </Stack>
  );
}
