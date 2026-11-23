'use client';

import { useEffect, useState } from 'react';
import { Alert, Button, Card, Group, NumberInput, Stack, Text, Title } from '@mantine/core';
import { IconAlertTriangle, IconCheck, IconDeviceFloppy } from '@tabler/icons-react';
import toast from 'react-hot-toast';
import {
  mmACm,
  OT_MARGEN_SUPERIOR_AYUDA,
  OT_MARGEN_SUPERIOR_DEFAULT_MM,
  OT_MARGEN_SUPERIOR_LABEL,
  OT_MARGEN_SUPERIOR_MAX_MM,
  OT_MARGEN_SUPERIOR_MIN_MM,
} from '../../lib/bitacora-proceso/impresion';
import type { OtCompanyAccess } from '../../lib/bitacora-proceso/rules';
import { otSend, useOtFetch } from './otClient';

/**
 * Reserved top area for the batch-record header (case #8316, 2026-11-23).
 *   - useOtMargenBatch: the company margin (default 4 cm) for the report.
 *   - OtMargenBatchCampo: number field in cm; Gestión can save it as the company default.
 *   - OtImpresionConfig: Catálogo → Impresión tab (Gestión only).
 */
export interface OtConfigImpresion {
  margenSuperiorMm: number;
  margenSuperiorCm: number;
  personalizado: boolean;
}

export function useOtMargenBatch(idCompany: number) {
  const { data, error, loading, reload } = useOtFetch<{ config: OtConfigImpresion }>(`/api/bitacora-proceso/config?company=${idCompany}`);
  return {
    config: data?.config ?? null,
    margenMm: data?.config?.margenSuperiorMm ?? OT_MARGEN_SUPERIOR_DEFAULT_MM,
    error,
    loading,
    reload,
  };
}

export function OtMargenBatchCampo({
  company,
  valorCm,
  onChange,
  guardadoCm,
  onGuardado,
  description = OT_MARGEN_SUPERIOR_AYUDA,
}: {
  company: OtCompanyAccess;
  valorCm: number;
  onChange: (cm: number) => void;
  /** Company value currently saved (to know whether there is something to save). */
  guardadoCm: number;
  onGuardado?: () => void | Promise<void>;
  description?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; text: string } | null>(null);

  const guardar = async () => {
    setBusy(true);
    setAviso(null);
    try {
      await otSend('/api/bitacora-proceso/config', 'PATCH', { company: company.idCompany, margen_superior_cm: valorCm });
      const text = `Margen superior guardado para ${company.companyName}: ${valorCm} cm.`;
      setAviso({ ok: true, text });
      toast.success(text);
      await onGuardado?.();
    } catch (e) {
      setAviso({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack gap='xs'>
      {aviso && (
        <Alert color={aviso.ok ? 'green' : 'red'} icon={aviso.ok ? <IconCheck size={18} /> : <IconAlertTriangle size={18} />} withCloseButton onClose={() => setAviso(null)} data-testid='ot-margen-aviso'>
          {aviso.text}
        </Alert>
      )}
      <Group align='flex-end' gap='sm' wrap='wrap'>
        <NumberInput
          label={OT_MARGEN_SUPERIOR_LABEL}
          description={description}
          value={valorCm}
          onChange={(v) => {
            const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
            if (Number.isFinite(n)) onChange(n);
          }}
          min={mmACm(OT_MARGEN_SUPERIOR_MIN_MM)}
          max={mmACm(OT_MARGEN_SUPERIOR_MAX_MM)}
          step={0.5}
          decimalScale={1}
          decimalSeparator=','
          clampBehavior='strict'
          suffix=' cm'
          size='md'
          style={{ flex: '1 1 260px', maxWidth: 460 }}
          data-testid='ot-margen-batch'
        />
        {company.canManage && (
          <Button
            variant='light'
            size='md'
            leftSection={<IconDeviceFloppy size={18} />}
            loading={busy}
            disabled={valorCm === guardadoCm}
            onClick={guardar}
            data-testid='ot-margen-guardar'
          >
            Guardar para la empresa
          </Button>
        )}
      </Group>
    </Stack>
  );
}

export function OtImpresionConfig({ company }: { company: OtCompanyAccess }) {
  const { config, margenMm, error, reload } = useOtMargenBatch(company.idCompany);
  const [valorCm, setValorCm] = useState(mmACm(margenMm));
  useEffect(() => setValorCm(mmACm(margenMm)), [margenMm]);
  return (
    <Card withBorder radius='md' p='md'>
      <Stack gap='sm'>
        <Title order={3} size='h5'>Impresión del informe</Title>
        <Text size='sm' c='dimmed'>
          La bitácora se imprime en la hoja del batch record. El margen superior deja en blanco, en cada página, el espacio del encabezado del lote
          batch para que el informe no lo tape. Por defecto: {mmACm(OT_MARGEN_SUPERIOR_DEFAULT_MM)} cm.
          {config && !config.personalizado ? ' Esta empresa usa el valor por defecto.' : ''}
        </Text>
        {error && <Alert color='red' icon={<IconAlertTriangle size={18} />}>{error}</Alert>}
        <OtMargenBatchCampo company={company} valorCm={valorCm} onChange={setValorCm} guardadoCm={mmACm(margenMm)} onGuardado={() => reload(true)} />
      </Stack>
    </Card>
  );
}
