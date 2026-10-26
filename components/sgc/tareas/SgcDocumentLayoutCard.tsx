'use client';

import { useMemo, useState } from 'react';
import { Alert, Badge, Button, Card, Group, Stack, Switch, Text, Title } from '@mantine/core';
import { IconAdjustments, IconAlertTriangle, IconLayoutNavbar, IconSignature } from '@tabler/icons-react';
import SgcDocumentLayoutModal, { type SgcLayoutData } from '../signature/SgcDocumentLayoutModal';
import SgcSheetSettingsModal, { type SgcSheetSettingsSource } from '../SgcSheetSettingsModal';
import { describeSheetSettings, type SgcSheetSettings } from '../../../lib/sgc/sheetSettings';
import type { SgcSheetInspection } from '../../../lib/sgc/pdf/viewable';
import { sgcSend, useSgcFetch } from '../useSgcFetch';
import { formatDateCO } from './format';

/**
 * «Firmas en el documento» (correcciones de Calidad OLP, 2026-10-02): dónde
 * quedan las firmas Elaboró / Revisó / Aprobó dentro del documento y si el
 * documento usa el ENCABEZADO INSTITUCIONAL (el sistema pone logo, código,
 * versión, página x de y, elaboró/revisó/aprobó con su recuadro «Firma»,
 * fecha de emisión y proceso, y llena el historial de cambios). El elaborador
 * lo define durante la elaboración; los demás lo consultan.
 *
 * 2026-10-22: con un borrador en Excel, el elaborador también ajusta su
 * PRESENTACIÓN (orientación, tamaño, área, títulos, columnas y hojas) y la
 * previsualiza antes de guardarla («Ajustar y previsualizar el Excel»).
 */
export default function SgcDocumentLayoutCard({ requestId, onMessage }: { requestId: number; onMessage: (type: 'success' | 'error', text: string) => void }) {
  const { data, error, reload } = useSgcFetch<SgcLayoutData>(`/api/sgc/requests/${requestId}/layout`);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const sheetSource = useMemo<SgcSheetSettingsSource>(
    () => ({
      load: async () => {
        const res = await fetch(`/api/sgc/requests/${requestId}/layout/sheet`, { cache: 'no-store' });
        const body = (await res.json().catch(() => ({}))) as { sheets?: SgcSheetInspection[]; sheetSettings?: SgcSheetSettings | null; error?: string };
        if (!res.ok) throw new Error(body.error || `Error ${res.status}`);
        return { sheets: body.sheets ?? [], settings: body.sheetSettings ?? null };
      },
      preview: async (settings) => {
        const res = await fetch(`/api/sgc/requests/${requestId}/layout/sheet`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'previsualizar', settings }) });
        if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error || `Error ${res.status}`);
        return res.blob();
      },
    }),
    [requestId]
  );
  if (error || !data) return null;
  if (data.participants.length === 0 && !data.canEdit) return null;
  const placed = data.fields.length;
  // D6 (E2E 2026-10-10): con 3 o más del mismo rol, los que no son titulares van al registro de firmas (no a una caja).
  const inRegister = data.inRegister?.length ?? 0;
  const total = data.participants.length - inRegister;
  const isPdf = data.draft?.format === 'pdf';
  const isExcel = data.draft?.format === 'xlsx';

  const saveSheet = async (settings: SgcSheetSettings | null) => {
    const res = await sgcSend<{ removedSignatures?: number }>(`/api/sgc/requests/${requestId}/layout/sheet`, 'POST', { action: 'guardar', settings });
    onMessage(
      'success',
      res.removedSignatures
        ? `Presentación del Excel guardada. Cambió la orientación de la hoja: vuelva a ubicar ${res.removedSignatures} firma(s).`
        : 'Presentación del Excel guardada.'
    );
    reload();
  };

  const save = async (body: Record<string, unknown>, ok: string) => {
    setBusy(true);
    try {
      await sgcSend(`/api/sgc/requests/${requestId}/layout`, 'PUT', body);
      onMessage('success', ok);
      reload();
    } catch (e) {
      onMessage('error', e instanceof Error ? e.message : String(e));
      throw e;
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card shadow='sm' p='xl' radius='md' withBorder mt='6' data-testid='sgc-firmas-documento'>
      <Group justify='space-between' mb='sm' wrap='wrap'>
        <Title order={4} className='flex items-center gap-2'>
          <IconSignature size={18} className='text-blue-6' />
          Firmas en el documento
        </Title>
        <Badge color={placed === total && total > 0 ? 'green' : 'orange'} variant='light' size='lg' radius='sm' data-testid='sgc-firmas-documento-conteo'>
          {placed} de {total} ubicada(s)
        </Badge>
      </Group>
      <Stack gap='sm'>
        <Text size='sm' c='dimmed'>
          Las firmas electrónicas (Elaboró, Revisó y Aprobó) quedan estampadas dentro del documento, en el lugar que ubique el elaborador. La firma sigue exigiendo la contraseña de SynerLink y el motivo.
        </Text>
        <Switch
          label='Usar el encabezado institucional (logo, código, versión, página x de y, elaboró, revisó, aprobó con su recuadro «Firma», fecha de emisión y proceso)'
          description={
            isPdf
              ? 'No aplica a un borrador PDF: el PDF ya trae su propio formato.'
              : data.headerMandatory
                ? 'Obligatorio en los documentos nuevos y en las nuevas versiones (Aseguramiento de Calidad). El sistema llena estos campos y el historial de cambios al generar el PDF controlado.'
                : 'El sistema llena estos campos y el historial de cambios al generar el PDF controlado.'
          }
          checked={data.institutionalHeader}
          disabled={!data.canEdit || busy || data.headerMandatory || (isPdf && !data.institutionalHeader)}
          onChange={(e) => {
            const value = e.currentTarget.checked;
            void save({ institutionalHeader: value }, value ? 'El documento usará el encabezado institucional.' : 'El documento ya no usará el encabezado institucional.').catch(() => undefined);
          }}
          data-testid='sgc-encabezado-institucional'
        />
        {isExcel && (
          <Group justify='space-between' wrap='wrap' gap='xs' data-testid='sgc-excel-presentacion'>
            <Text size='sm'>
              Presentación del Excel: <b>{data.sheetSettings ? describeSheetSettings(data.sheetSettings) : 'ajuste automático'}</b>
            </Text>
            <Button size='xs' variant='light' leftSection={<IconAdjustments size={14} />} onClick={() => setSheetOpen(true)} disabled={!data.canEdit} data-testid='sgc-excel-ajustar-borrador'>
              Ajustar y previsualizar el Excel
            </Button>
          </Group>
        )}
        {data.stale && (
          <Alert color='yellow' icon={<IconAlertTriangle size={16} />}>
            El borrador cambió después de ubicar las firmas: revise que cada caja siga en su lugar.
          </Alert>
        )}
        {placed < total && (
          <Alert color='orange' variant='light' icon={<IconAlertTriangle size={16} />} data-testid='sgc-firmas-faltan'>
            {data.institutionalHeader
              ? 'Las firmas sin ubicar irán en el recuadro «Firma» de su rol en el encabezado institucional.'
              : 'Las firmas sin ubicar irán en la portada de control del PDF (respaldo). Ubíquelas para que queden dentro del documento.'}
          </Alert>
        )}
        {inRegister > 0 && (
          <Text size='xs' c='dimmed' data-testid='sgc-firmas-registro'>
            {inRegister} firma(s) más van al «Registro de firmas» al final del documento (3 o más firmantes del mismo rol).
          </Text>
        )}
        <Group justify='space-between' wrap='wrap'>
          <Text size='xs' c='dimmed'>
            {data.savedAt ? `Última ubicación: ${formatDateCO(data.savedAt)} · ${data.savedBy}` : 'Aún no se han ubicado firmas.'}
          </Text>
          <Button leftSection={<IconLayoutNavbar size={16} />} variant={data.canEdit ? 'filled' : 'light'} onClick={() => setOpen(true)} disabled={!data.draft} data-testid='sgc-abrir-ubicar-firmas'>
            {data.canEdit ? 'Ubicar firmas en el documento' : 'Ver ubicación de firmas'}
          </Button>
        </Group>
        {!data.draft && (
          <Text size='xs' c='dimmed'>
            Cargue o edite el borrador para ubicar las firmas.
          </Text>
        )}
      </Stack>
      {isExcel && (
        <SgcSheetSettingsModal
          opened={sheetOpen}
          name={data.draft?.name ?? 'Excel'}
          source={sheetOpen ? sheetSource : null}
          onClose={() => setSheetOpen(false)}
          onApply={saveSheet}
          applyLabel='Guardar en el documento'
          notice={
            data.fields.length > 0 ? (
              <Alert color='yellow' icon={<IconAlertTriangle size={16} />}>
                Si cambia la orientación de la hoja, las {data.fields.length} firma(s) ya ubicada(s) se quitan y hay que volver a ubicarlas (el encabezado y los recuadros cambian de lugar).
              </Alert>
            ) : null
          }
        />
      )}
      {open && (
        <SgcDocumentLayoutModal
          opened={open}
          onClose={() => setOpen(false)}
          layout={data}
          onSave={async (fields) => {
            await save({ fields }, 'Ubicación de firmas guardada.');
          }}
        />
      )}
    </Card>
  );
}
