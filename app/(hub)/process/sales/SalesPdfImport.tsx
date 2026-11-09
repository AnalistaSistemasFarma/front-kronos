'use client';

import { useEffect, useState } from 'react';
import { Alert, Button, Group, Modal, Progress, Stack, Text, Tooltip } from '@mantine/core';
import { IconAlertCircle, IconSparkles } from '@tabler/icons-react';
import toast from 'react-hot-toast';
import { PDF_ORDER_SCHEMA, PDF_ORDER_SYSTEM_PROMPT, parsePdfOrder, pdfOrderPrompt } from '../../../../lib/sales/pdfOrder';

/**
 * «Montar oferta desde PDF»: lee la orden de compra del cliente con la IA NATIVA del navegador (Prompt API,
 * Gemini Nano on-device, la misma del botón «Resumir» de las solicitudes) y MONTA la oferta sola: cliente
 * (por el NIT), punto de entrega por defecto, OC, fecha de entrega y líneas validadas en SAP (las que no traen
 * código se emparejan por descripción). El PDF no sale del computador: al servidor solo van los datos leídos.
 * El comercial revisa lo marcado y crea la oferta (Nicolás Rivera, 2026-11-09).
 */

type Line = Record<string, unknown>;
type Support = 'checking' | 'unsupported' | 'ready';
type Phase = 'idle' | 'leyendo' | 'descargando' | 'analizando' | 'montando' | 'error';

export interface PdfOffer {
  customer: { CardCode: string; CardName: string };
  lines: Line[];
  numeroOrdenCompra: string;
  fechaEntrega: string;
  avisos: string[];
}

interface Props {
  companyId: string;
  /** Cliente ya elegido (al editar un borrador no se cambia): se usa en vez del NIT del PDF. */
  cardCode?: string;
  onLoaded: (r: PdfOffer) => void;
}

const MAX_PAGES = 5;

/** Texto de las páginas del PDF y, si casi no hay texto (escaneado), imágenes de las primeras páginas. */
async function readPdf(file: File): Promise<{ text: string; images: Blob[] }> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages = Math.min(pdf.numPages, MAX_PAGES);
  const parts: string[] = [];
  for (let i = 1; i <= pages; i++) {
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    // Agrupa por renglón (misma coordenada Y) para conservar las filas de la tabla.
    const rows = new Map<number, { x: number; s: string }[]>();
    for (const it of tc.items as { str: string; transform: number[] }[]) {
      if (!it.str?.trim()) continue;
      const y = Math.round(it.transform[5]);
      const k = [...rows.keys()].find((r) => Math.abs(r - y) <= 2) ?? y;
      rows.set(k, [...(rows.get(k) ?? []), { x: it.transform[4], s: it.str }]);
    }
    const lines = [...rows.entries()].sort((a, b) => b[0] - a[0]).map(([, cells]) => cells.sort((a, b) => a.x - b.x).map((c) => c.s).join(' | '));
    parts.push(`--- Página ${i} ---\n${lines.join('\n')}`);
  }
  const text = parts.join('\n');
  const images: Blob[] = [];
  if (text.replace(/[\s|-]|Página \d+/g, '').length < 80) {
    for (let i = 1; i <= Math.min(pages, 3); i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 1.6 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      await page.render({ canvasContext: ctx, viewport }).promise;
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
      if (blob) images.push(blob);
    }
  }
  return { text, images };
}

export default function SalesPdfImport({ companyId, cardCode, onLoaded }: Props) {
  const [support, setSupport] = useState<Support>('checking');
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (typeof LanguageModel === 'undefined') return !cancelled && setSupport('unsupported');
      try {
        const disp = await LanguageModel.availability({ expectedInputs: [{ type: 'text', languages: ['es'] }], expectedOutputs: [{ type: 'text', languages: ['es'] }] });
        if (!cancelled) setSupport(disp === 'unavailable' ? 'unsupported' : 'ready');
      } catch {
        if (!cancelled) setSupport('unsupported');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const analyze = async (file: File | null) => {
    if (!file) return;
    setError('');
    setProgress(0);
    setPhase('leyendo');
    try {
      const { text, images } = await readPdf(file);
      if (typeof LanguageModel === 'undefined') throw new Error('Este navegador no tiene la IA local disponible.');
      const disp = await LanguageModel.availability();
      setPhase(disp === 'downloadable' || disp === 'downloading' ? 'descargando' : 'analizando');
      const session = await LanguageModel.create({
        initialPrompts: [{ role: 'system', content: PDF_ORDER_SYSTEM_PROMPT }],
        expectedInputs: [{ type: 'text', languages: ['es'] }, ...(images.length ? [{ type: 'image' as const }] : [])],
        expectedOutputs: [{ type: 'text', languages: ['es'] }],
        monitor(m) {
          m.addEventListener('downloadprogress', (e) => setProgress(Math.round(e.loaded * 100)));
        },
      });
      let raw: string;
      try {
        setPhase('analizando');
        raw = images.length
          ? await session.prompt(
              [{ role: 'user', content: [{ type: 'text', value: 'Esta es la orden de compra escaneada (imágenes de sus páginas). Devuelve el JSON pedido.' }, ...images.map((b) => ({ type: 'image' as const, value: b }))] }],
              { responseConstraint: PDF_ORDER_SCHEMA }
            )
          : await session.prompt(pdfOrderPrompt(text), { responseConstraint: PDF_ORDER_SCHEMA });
      } finally {
        session.destroy();
      }
      const r = parsePdfOrder(raw);
      if (!r.lineas.length) throw new Error('La IA no encontró líneas de productos en el PDF. Revise el archivo o use el cargue desde Excel.');
      setPhase('montando');
      const res = await fetch('/api/sales/pdf-resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: Number(companyId), nit: r.nitCliente, cardCode: cardCode || undefined, lines: r.lineas }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'No se pudo montar la oferta con los datos del PDF');
      if (!d.customer) throw new Error((d.avisos ?? []).join(' ') || 'No se identificó el cliente del PDF.');
      if (!(d.lines ?? []).length) throw new Error(`Se identificó el cliente ${d.customer.CardName}, pero ninguna línea del PDF se encontró en SAP. ${(d.avisos ?? []).join(' ')}`);
      onLoaded({ customer: d.customer, lines: d.lines, numeroOrdenCompra: r.numeroOrdenCompra, fechaEntrega: r.fechaEntrega, avisos: d.avisos ?? [] });
      setPhase('idle');
    } catch (e) {
      setError((e as Error).message);
      setPhase('error');
    }
  };

  const working = phase !== 'idle' && phase !== 'error';
  const inputId = `pdf-ia-${companyId}`;

  return (
    <>
      <Tooltip
        label={support === 'ready' ? 'Lea la OC del cliente en PDF con la IA de su navegador (el archivo no sale de su computador) y la oferta se monta sola: cliente, OC, fecha y artículos.' : 'Su navegador no tiene la IA local (Chrome de escritorio reciente con Gemini Nano, por HTTPS). Use el cargue desde Excel.'}
        multiline
        w={320}
      >
        <Button variant="light" color="violet" leftSection={<IconSparkles size={16} />} loading={working} disabled={support !== 'ready'} onClick={() => document.getElementById(inputId)?.click()}>
          Montar oferta desde PDF
        </Button>
      </Tooltip>
      <input id={inputId} type="file" accept="application/pdf" hidden onChange={(e) => { analyze(e.currentTarget.files?.[0] ?? null); e.currentTarget.value = ''; }} />

      <Modal opened={phase !== 'idle'} onClose={() => !working && setPhase('idle')} title={<Group gap={6}><IconSparkles size={18} /><Text fw={700}>Oferta desde el PDF (IA local)</Text></Group>}
        closeOnClickOutside={!working} withCloseButton={!working} zIndex={1300}>
        {working && (
          <Stack gap="xs">
            <Text size="sm" c="dimmed">
              {phase === 'leyendo' ? 'Leyendo el PDF…' : phase === 'descargando' ? `Descargando el modelo de IA del navegador (solo la primera vez)… ${progress}%` : phase === 'analizando' ? 'La IA de su navegador está leyendo la orden de compra…' : 'Identificando el cliente y los artículos en SAP…'}
            </Text>
            <Progress value={phase === 'descargando' ? progress : 100} animated color="violet" />
          </Stack>
        )}
        {phase === 'error' && <Alert color="red" icon={<IconAlertCircle size={16} />} title="No se pudo montar la oferta">{error}</Alert>}
      </Modal>
    </>
  );
}
