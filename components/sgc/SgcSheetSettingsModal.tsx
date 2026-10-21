'use client';

import React, { useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Group, Loader, Modal, NumberInput, ScrollArea, Stack, Switch, Table, Text, TextInput, UnstyledButton } from '@mantine/core';
import { IconAlertTriangle, IconCheck, IconEye, IconInfoCircle, IconRefresh } from '@tabler/icons-react';
import SgcSelect from './SgcSelect';
import SgcDocumentViewerModal from './SgcDocumentViewerModal';
import type { SgcSheetInspection } from '../../lib/sgc/pdf/viewable';
import {
  SGC_DEFAULT_SHEET_SETTINGS,
  SGC_SHEET_FITS,
  SGC_SHEET_FIT_LABELS,
  SGC_SHEET_ORIENTATIONS,
  SGC_SHEET_ORIENTATION_LABELS,
  SGC_SHEET_SCALE_MAX,
  SGC_SHEET_SCALE_MIN,
  isDefaultSheetSettings,
  type SgcSheetFit,
  type SgcSheetOrientation,
  type SgcSheetOverride,
  type SgcSheetSettings,
} from '../../lib/sgc/sheetSettings';

/**
 * AJUSTAR Y PREVISUALIZAR un Excel de la carga inicial (2026-10-21, Calidad
 * OLP). Muestra cada hoja como una grilla (columnas con su letra y las
 * primeras filas) para elegir qué sale en el PDF: orientación, tamaño, área
 * de impresión, filas de título que se repiten y columnas que no salen.
 * «Previsualizar» abre en el visor seguro el PDF REAL que generaría el
 * servidor con esos ajustes (marcado «VISTA PREVIA», no se guarda nada);
 * «Usar estos ajustes» los deja para la carga. Solo la presentación: el texto
 * del Excel no se edita aquí (corregir el contenido es una nueva versión).
 */

interface Props {
  opened: boolean;
  file: File | null;
  idCompany: number;
  initial: SgcSheetSettings | null;
  onClose: () => void;
  onApply: (settings: SgcSheetSettings | null) => void;
}

function overrideFor(settings: SgcSheetSettings, name: string): SgcSheetOverride {
  return settings.sheets.find((s) => s.name === name) ?? { name, include: true, printArea: null, titleRows: null, hiddenColumns: [] };
}

async function postExcel(idCompany: number, file: File, action: 'inspeccionar' | 'previsualizar', settings?: SgcSheetSettings): Promise<Response> {
  const form = new FormData();
  form.set('company', String(idCompany));
  form.set('file', file);
  form.set('action', action);
  if (settings) form.set('settings', JSON.stringify(settings));
  const res = await fetch('/api/sgc/master-list/files/preview', { method: 'POST', body: form });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `Error ${res.status}`);
  }
  return res;
}

export default function SgcSheetSettingsModal({ opened, file, idCompany, initial, onClose, onApply }: Props) {
  const [sheets, setSheets] = useState<SgcSheetInspection[] | null>(null);
  const [settings, setSettings] = useState<SgcSheetSettings>(SGC_DEFAULT_SHEET_SETTINGS);
  const [loading, setLoading] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!opened || !file) return;
    let cancelled = false;
    setSheets(null);
    setError(null);
    setSettings(initial ?? { ...SGC_DEFAULT_SHEET_SETTINGS, sheets: [] });
    setLoading(true);
    postExcel(idCompany, file, 'inspeccionar')
      .then((res) => res.json())
      .then((body: { sheets: SgcSheetInspection[] }) => {
        if (cancelled) return;
        setSheets(body.sheets);
        // Cada hoja con su ajuste (los que ya traía o los automáticos).
        setSettings((s) => ({ ...s, sheets: body.sheets.map((x) => overrideFor(s, x.name)) }));
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : 'No se pudo leer el Excel'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [opened, file, idCompany, initial]);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const setSheet = (name: string, patch: Partial<SgcSheetOverride>) =>
    setSettings((s) => ({ ...s, sheets: s.sheets.map((x) => (x.name === name ? { ...x, ...patch } : x)) }));

  const toggleColumn = (name: string, letter: string) => {
    const o = overrideFor(settings, name);
    setSheet(name, { hiddenColumns: o.hiddenColumns.includes(letter) ? o.hiddenColumns.filter((c) => c !== letter) : [...o.hiddenColumns, letter] });
  };

  // Lo que viaja al servidor: vacíos como null y la escala solo si aplica.
  const payload = (): SgcSheetSettings => ({
    orientation: settings.orientation,
    fit: settings.fit,
    scalePct: settings.fit === 'escala' ? settings.scalePct ?? 100 : null,
    sheets: settings.sheets.map((x) => ({ ...x, printArea: x.printArea?.trim() || null, titleRows: x.titleRows?.trim() || null })),
  });

  const preview = async () => {
    if (!file) return;
    setPreviewing(true);
    setError(null);
    try {
      const res = await postExcel(idCompany, file, 'previsualizar', payload());
      const url = URL.createObjectURL(await res.blob());
      setPreviewUrl(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo generar la vista previa');
    } finally {
      setPreviewing(false);
    }
  };

  const apply = () => {
    const s = payload();
    onApply(isDefaultSheetSettings(s) ? null : s);
    onClose();
  };

  const allOut = settings.sheets.length > 0 && settings.sheets.every((x) => !x.include);

  return (
    <>
      <Modal opened={opened} onClose={onClose} title={`Ajustar y previsualizar · ${file?.name ?? ''}`} size='xl' data-testid='sgc-excel-ajustes'>
        <Stack gap='sm'>
          <Alert color='blue' icon={<IconInfoCircle size={18} />}>
            <Text size='sm'>
              Estos ajustes solo cambian cómo se imprime el Excel en el PDF: orientación, tamaño, área de impresión, filas de título y columnas que salen. El texto del documento no cambia; si hay que corregirlo, solicite una nueva versión.
            </Text>
          </Alert>
          {error && (
            <Alert color='red' icon={<IconAlertTriangle size={18} />} withCloseButton onClose={() => setError(null)} data-testid='sgc-excel-ajustes-error'>
              {error}
            </Alert>
          )}
          {loading && (
            <Group justify='center' my='md'>
              <Loader />
            </Group>
          )}

          {sheets && (
            <>
              <Group gap='sm' align='flex-end' wrap='wrap'>
                <SgcSelect
                  label='Orientación'
                  data={SGC_SHEET_ORIENTATIONS.map((o) => ({ value: o, label: SGC_SHEET_ORIENTATION_LABELS[o] }))}
                  value={settings.orientation}
                  onChange={(v) => setSettings((s) => ({ ...s, orientation: (v ?? 'auto') as SgcSheetOrientation }))}
                  allowDeselect={false}
                  w={300}
                  data-testid='sgc-excel-orientacion'
                />
                <SgcSelect
                  label='Tamaño'
                  data={SGC_SHEET_FITS.map((f) => ({ value: f, label: SGC_SHEET_FIT_LABELS[f] }))}
                  value={settings.fit}
                  onChange={(v) => setSettings((s) => ({ ...s, fit: (v ?? 'ancho') as SgcSheetFit, scalePct: v === 'escala' ? s.scalePct ?? 100 : null }))}
                  allowDeselect={false}
                  w={260}
                  data-testid='sgc-excel-tamano'
                />
                {settings.fit === 'escala' && (
                  <NumberInput
                    label='Escala (%)'
                    min={SGC_SHEET_SCALE_MIN}
                    max={SGC_SHEET_SCALE_MAX}
                    value={settings.scalePct ?? 100}
                    onChange={(v) => setSettings((s) => ({ ...s, scalePct: Number(v) || 100 }))}
                    w={120}
                    data-testid='sgc-excel-escala'
                  />
                )}
              </Group>

              {sheets.map((sh) => {
                const o = overrideFor(settings, sh.name);
                return (
                  <Card key={sh.name} withBorder radius='md' p='sm' data-testid='sgc-excel-hoja'>
                    <Stack gap='xs'>
                      <Group justify='space-between' wrap='wrap' gap='xs'>
                        <Group gap='xs'>
                          <Text fw={600} size='sm'>
                            {sh.name}
                          </Text>
                          <Badge variant='light' color='gray' size='sm'>
                            {sh.range ? `${sh.range} · ${sh.rows} filas` : 'Hoja vacía'}
                          </Badge>
                          <Badge variant='light' color='gray' size='sm'>
                            En el Excel: {sh.excelOrientation}
                          </Badge>
                        </Group>
                        <Switch label='Sale en el PDF' checked={o.include} onChange={(e) => setSheet(sh.name, { include: e.currentTarget.checked })} data-testid='sgc-excel-hoja-incluir' />
                      </Group>
                      {o.include && sh.range && (
                        <>
                          <Group gap='sm' wrap='wrap'>
                            <TextInput autoComplete='off' data-1p-ignore='true' data-lpignore='true'
                              label='Área de impresión'
                              description={`Vacío = ${sh.excelPrintArea ? `la del Excel (${sh.excelPrintArea})` : `lo que tiene contenido (${sh.range})`}`}
                              placeholder={sh.excelPrintArea ?? sh.range}
                              value={o.printArea ?? ''}
                              onChange={(e) => setSheet(sh.name, { printArea: e.currentTarget.value.toUpperCase() })}
                              w={240}
                              ff='monospace'
                              data-testid='sgc-excel-area'
                            />
                            <TextInput autoComplete='off' data-1p-ignore='true' data-lpignore='true'
                              label='Filas de título (se repiten en cada página)'
                              description={`Vacío = ${sh.excelTitleRows ? `las del Excel (${sh.excelTitleRows})` : 'ninguna'}`}
                              placeholder={sh.excelTitleRows ?? '1:3'}
                              value={o.titleRows ?? ''}
                              onChange={(e) => setSheet(sh.name, { titleRows: e.currentTarget.value })}
                              w={280}
                              ff='monospace'
                              data-testid='sgc-excel-titulos'
                            />
                          </Group>
                          <Text size='xs' c='dimmed'>
                            Toque la letra de una columna para quitarla del PDF o volver a incluirla.
                          </Text>
                          <ScrollArea type='auto' offsetScrollbars>
                            <Table withTableBorder withColumnBorders verticalSpacing={2} horizontalSpacing={6} fz='xs' data-testid='sgc-excel-grilla' style={{ minWidth: Math.min(1400, sh.columns.length * 90) }}>
                              <Table.Thead>
                                <Table.Tr>
                                  {sh.columns.map((c) => {
                                    const out = c.hiddenInExcel || o.hiddenColumns.includes(c.letter);
                                    return (
                                      <Table.Th key={c.letter} style={{ minWidth: 60, opacity: out ? 0.45 : 1 }}>
                                        <UnstyledButton
                                          onClick={() => !c.hiddenInExcel && toggleColumn(sh.name, c.letter)}
                                          disabled={c.hiddenInExcel}
                                          title={c.hiddenInExcel ? 'Oculta en el Excel' : out ? 'No sale en el PDF: toque para incluirla' : 'Sale en el PDF: toque para quitarla'}
                                          data-testid='sgc-excel-columna'
                                          data-out={out ? '1' : '0'}
                                        >
                                          <Group gap={4} wrap='nowrap'>
                                            <Text size='xs' fw={700} td={out ? 'line-through' : undefined}>
                                              {c.letter}
                                            </Text>
                                            {!out && <IconCheck size={12} color='var(--mantine-color-green-7)' />}
                                          </Group>
                                        </UnstyledButton>
                                      </Table.Th>
                                    );
                                  })}
                                </Table.Tr>
                              </Table.Thead>
                              <Table.Tbody>
                                {sh.preview.map((row, i) => (
                                  <Table.Tr key={i}>
                                    {row.map((cell, j) => {
                                      const c = sh.columns[j];
                                      const out = Boolean(c && (c.hiddenInExcel || o.hiddenColumns.includes(c.letter)));
                                      return (
                                        <Table.Td key={j} style={{ opacity: out ? 0.35 : 1, whiteSpace: 'nowrap', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                          {cell}
                                        </Table.Td>
                                      );
                                    })}
                                  </Table.Tr>
                                ))}
                              </Table.Tbody>
                            </Table>
                          </ScrollArea>
                          {sh.rows > sh.preview.length && (
                            <Text size='xs' c='dimmed'>
                              Se muestran las primeras {sh.preview.length} filas de {sh.rows}.
                            </Text>
                          )}
                        </>
                      )}
                    </Stack>
                  </Card>
                );
              })}
              {allOut && (
                <Alert color='orange' icon={<IconAlertTriangle size={16} />}>
                  Deje al menos una hoja en el PDF.
                </Alert>
              )}
            </>
          )}

          <Group justify='space-between' mt='sm' wrap='wrap'>
            <Button
              variant='subtle'
              leftSection={<IconRefresh size={16} />}
              onClick={() => setSettings({ ...SGC_DEFAULT_SHEET_SETTINGS, sheets: (sheets ?? []).map((x) => ({ name: x.name, include: true, printArea: null, titleRows: null, hiddenColumns: [] })) })}
              disabled={!sheets}
              data-testid='sgc-excel-restablecer'
            >
              Volver al ajuste automático
            </Button>
            <Group gap='xs'>
              <Button variant='default' onClick={onClose}>
                Cancelar
              </Button>
              <Button variant='light' leftSection={<IconEye size={16} />} onClick={() => void preview()} loading={previewing} disabled={!sheets || allOut} data-testid='sgc-excel-previsualizar'>
                Previsualizar
              </Button>
              <Button leftSection={<IconCheck size={16} />} onClick={apply} disabled={!sheets || allOut} data-testid='sgc-excel-usar'>
                Usar estos ajustes
              </Button>
            </Group>
          </Group>
        </Stack>
      </Modal>
      <SgcDocumentViewerModal fileUrl={previewUrl} title={`Vista previa · ${file?.name ?? ''}`} onClose={() => setPreviewUrl(null)} />
    </>
  );
}
