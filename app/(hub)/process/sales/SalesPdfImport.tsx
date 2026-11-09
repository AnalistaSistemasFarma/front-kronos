'use client';

import { useEffect, useState } from 'react';
import { Alert, Button, Group, Modal, Progress, Stack, Text, Tooltip } from '@mantine/core';
import { IconAlertCircle, IconSparkles } from '@tabler/icons-react';
import toast from 'react-hot-toast';
import { chunkOrderText, mergePdfOrders, PDF_ORDER_SCHEMA, PDF_ORDER_SYSTEM_PROMPT, parsePdfOrder, pdfOrderChunkPrompt, tableHeaderRow, type PdfOrderResult } from '../../../../lib/sales/pdfOrder';

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
  /** Líneas que la IA leyó del PDF (para comparar con las que quedaron en la oferta). */
  leidas?: number;
}

interface Props {
  companyId: string;
  /** Cliente ya elegido (al editar un borrador no se cambia): se usa en vez del NIT del PDF. */
  cardCode?: string;
  onLoaded: (r: PdfOffer) => void;
}

/** Páginas que se leen (una OC larga trae varias hojas). */
const MAX_PAGES = 15;

/** Texto de las páginas del PDF y, si casi no hay texto (escaneado), imágenes de las primeras páginas. */
async function readPdf(file: File): Promise<{ pages: string[]; images: Blob[] }> {
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
    // Escaneado: una imagen por página (cada una se pregunta aparte).
    for (let i = 1; i <= pages; i++) {
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
  return { pages: parts, images };
}

export default function SalesPdfImport({ companyId, cardCode, onLoaded }: Props) {
  const [support, setSupport] = useState<Support>('checking');
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  /** Avance de la lectura por fragmentos (OC de varias hojas). */
  const [step, setStep] = useState<{ k: number; n: number } | null>(null);

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
      const { pages, images } = await readPdf(file);
      if (typeof LanguageModel === 'undefined') throw new Error('Este navegador no tiene la IA local disponible.');
      const disp = await LanguageModel.availability();
      setPhase(disp === 'downloadable' || disp === 'downloading' ? 'descargando' : 'analizando');
      const opts: LanguageModelCreateOptions = {
        initialPrompts: [{ role: 'system', content: PDF_ORDER_SYSTEM_PROMPT }],
        expectedInputs: [{ type: 'text', languages: ['es'] }, ...(images.length ? [{ type: 'image' as const }] : [])],
        expectedOutputs: [{ type: 'text', languages: ['es'] }],
      };
      const lm = LanguageModel;
      const base = await lm.create({
        ...opts,
        monitor(m) {
          m.addEventListener('downloadprogress', (e) => setProgress(Math.round(e.loaded * 100)));
        },
      });
      /** Sesión limpia por fragmento (sin el texto de los anteriores): clone() o, si no existe, una nueva. */
      const fresh = () => (base.clone ? base.clone() : lm.create(opts));
      // Ventana de contexto pequeña: fragmentos según la cuota real del modelo (≈ 3 caracteres por token,
      // dejando espacio para las instrucciones y la respuesta), y una sesión nueva por fragmento.
      const quota = Number(base.inputQuota ?? 0);
      const maxChars = quota > 0 ? Math.min(6000, Math.max(1500, Math.floor((quota - 1200) * 1.5))) : 3000;
      const header = tableHeaderRow(pages);
      const parts: PdfOrderResult[] = [];
      const fallos: number[] = [];
      try {
        setPhase('analizando');
        const tasks: (() => Promise<string>)[] = images.length
          ? images.map((b) => async () => {
              const s = await fresh();
              try {
                return await s.prompt(
                  [{ role: 'user', content: [{ type: 'text', value: 'Página escaneada de una orden de compra. Extrae todas sus líneas de producto y, si aparecen, el número de la orden, el NIT del cliente y la fecha de entrega. Devuelve el JSON pedido.' }, { type: 'image', value: b }] }],
                  { responseConstraint: PDF_ORDER_SCHEMA }
                );
              } finally {
                s.destroy();
              }
            })
          : chunkOrderText(pages, maxChars).map((chunk, i, all) => async () => {
              const s = await fresh();
              try {
                return await s.prompt(pdfOrderChunkPrompt(chunk, i + 1, all.length, header), { responseConstraint: PDF_ORDER_SCHEMA });
              } finally {
                s.destroy();
              }
            });
        for (let t = 0; t < tasks.length; t++) {
          setStep({ k: t + 1, n: tasks.length });
          try {
            parts.push(parsePdfOrder(await tasks[t]()));
          } catch {
            fallos.push(t + 1);
          }
        }
      } finally {
        base.destroy();
        setStep(null);
      }
      const r = mergePdfOrders(parts);
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
      const avisoFallos = fallos.length ? [`La IA no pudo leer ${fallos.length === 1 ? 'la parte' : 'las partes'} ${fallos.join(', ')} del PDF: compare las líneas con el documento.`] : [];
      onLoaded({ customer: d.customer, lines: d.lines, numeroOrdenCompra: r.numeroOrdenCompra, fechaEntrega: r.fechaEntrega, avisos: [...avisoFallos, ...(d.avisos ?? [])], leidas: r.lineas.length });
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
              {phase === 'leyendo' ? 'Leyendo el PDF…' : phase === 'descargando' ? `Descargando el modelo de IA del navegador (solo la primera vez)… ${progress}%` : phase === 'analizando' ? `La IA de su navegador está leyendo la orden de compra${step ? ` (parte ${step.k} de ${step.n})` : ''}…` : 'Identificando el cliente y los artículos en SAP…'}
            </Text>
            <Progress value={phase === 'descargando' ? progress : step ? Math.round((step.k / step.n) * 100) : 100} animated color="violet" />
          </Stack>
        )}
        {phase === 'error' && <Alert color="red" icon={<IconAlertCircle size={16} />} title="No se pudo montar la oferta">{error}</Alert>}
      </Modal>
    </>
  );
}
