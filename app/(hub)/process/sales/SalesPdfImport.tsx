'use client';

import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Checkbox, Group, Modal, Progress, ScrollArea, Select, Stack, Table, Text, Tooltip } from '@mantine/core';
import { IconAlertCircle, IconSparkles } from '@tabler/icons-react';
import toast from 'react-hot-toast';
import { PDF_ORDER_SCHEMA, PDF_ORDER_SYSTEM_PROMPT, parsePdfOrder, pdfOrderPrompt, type PdfOrderResult } from '../../../../lib/sales/pdfOrder';
import type { ImportLine } from '../../../../lib/sales/linesImport';

/**
 * «Cargar PDF con IA»: lee la orden de compra del cliente con la IA NATIVA del navegador (Prompt API,
 * Gemini Nano on-device, la misma del botón «Resumir» de las solicitudes) y PROPONE las líneas de la oferta.
 * El PDF no sale del computador. Nada se agrega sin que el comercial revise y confirme (reunión 2026-11-06:
 * «que solo revise el archivo y ponga líneas, y no haga más»). Las líneas se validan contra SAP igual que el Excel.
 */

type Line = Record<string, unknown>;
type Pending = { row: number; input: ImportLine; candidates: { ItemCode: string; ItemName: string }[] };
type Support = 'checking' | 'unsupported' | 'ready';
type Phase = 'idle' | 'leyendo' | 'descargando' | 'analizando' | 'validando' | 'revision' | 'error';

interface Props {
  companyId: string;
  cardCode: string;
  onAccept: (r: { lines: Line[]; numeroOrdenCompra: string; fechaEntrega: string; nitCliente: string }) => void;
}

const MAX_PAGES = 5;
const money = (v: unknown) => (v == null || v === '' ? '—' : `$ ${Number(v).toLocaleString('es-CO')}`);

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

export default function SalesPdfImport({ companyId, cardCode, onAccept }: Props) {
  const [support, setSupport] = useState<Support>('checking');
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [header, setHeader] = useState<Omit<PdfOrderResult, 'lineas'> | null>(null);
  const [ok, setOk] = useState<(Line & { include: boolean })[]>([]);
  const [pending, setPending] = useState<(Pending & { choice: string | null })[]>([]);
  const [errors, setErrors] = useState<{ row: number; error: string }[]>([]);

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

  const validate = async (lines: ImportLine[], matchByDescription: boolean) => {
    const res = await fetch('/api/sales/lines-validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyId: Number(companyId), cardCode, lines, matchByDescription }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || 'No se pudieron validar las líneas en SAP');
    return d as { lines: Line[]; errors: { row: number; error: string }[]; pending?: Pending[] };
  };

  const analyze = async (file: File | null) => {
    if (!file) return;
    if (!cardCode) {
      toast.error('Elija primero el cliente: el precio de lista depende de él.');
      return;
    }
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
      setPhase('validando');
      const v = await validate(r.lineas, true);
      setHeader({ numeroOrdenCompra: r.numeroOrdenCompra, nitCliente: r.nitCliente, fechaEntrega: r.fechaEntrega });
      setOk(v.lines.map((l) => ({ ...l, include: true })));
      setPending((v.pending ?? []).map((p) => ({ ...p, choice: p.candidates.length === 1 ? p.candidates[0].ItemCode : null })));
      setErrors(v.errors ?? []);
      setPhase('revision');
    } catch (e) {
      setError((e as Error).message);
      setPhase('error');
    }
  };

  const accept = async () => {
    try {
      const chosen = pending.filter((p) => p.choice).map((p) => ({ ...p.input, ItemCode: String(p.choice) }));
      let extra: Line[] = [];
      if (chosen.length) {
        const v = await validate(chosen, false);
        extra = v.lines;
        if (v.errors?.length) toast.error(v.errors.map((e) => e.error).join('\n'), { style: { whiteSpace: 'pre-line' } });
      }
      const lines = [...ok.filter((l) => l.include).map(({ include: _i, ...l }) => l), ...extra];
      if (!lines.length) {
        toast.error('No eligió ninguna línea.');
        return;
      }
      onAccept({ lines, numeroOrdenCompra: header?.numeroOrdenCompra ?? '', fechaEntrega: header?.fechaEntrega ?? '', nitCliente: header?.nitCliente ?? '' });
      setPhase('idle');
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const working = phase === 'leyendo' || phase === 'descargando' || phase === 'analizando' || phase === 'validando';
  const inputId = `pdf-ia-${companyId}`;
  const nitMismatch = header?.nitCliente && cardCode && !cardCode.replace(/\D/g, '').startsWith(header.nitCliente.replace(/\D/g, '').slice(0, 9));

  return (
    <>
      <Tooltip
        label={support === 'ready' ? 'Lee la OC del cliente en PDF con la IA de su navegador (el archivo no sale de su computador) y propone las líneas.' : 'Su navegador no tiene la IA local (Chrome de escritorio reciente con Gemini Nano). Use el cargue desde Excel.'}
        multiline
        w={300}
      >
        <Button variant="subtle" color="violet" leftSection={<IconSparkles size={16} />} loading={working} disabled={support !== 'ready'}
          onClick={() => (cardCode ? document.getElementById(inputId)?.click() : toast.error('Elija primero el cliente.'))}>
          Cargar PDF con IA
        </Button>
      </Tooltip>
      <input id={inputId} type="file" accept="application/pdf" hidden onChange={(e) => { analyze(e.currentTarget.files?.[0] ?? null); e.currentTarget.value = ''; }} />

      <Modal opened={phase !== 'idle'} onClose={() => !working && setPhase('idle')} title={<Group gap={6}><IconSparkles size={18} /><Text fw={700}>Propuesta de líneas desde el PDF (IA local)</Text></Group>}
        size="xl" closeOnClickOutside={!working} withCloseButton={!working} zIndex={1300}>
        {working && (
          <Stack gap="xs">
            <Text size="sm" c="dimmed">
              {phase === 'leyendo' ? 'Leyendo el PDF…' : phase === 'descargando' ? `Descargando el modelo de IA del navegador (solo la primera vez)… ${progress}%` : phase === 'analizando' ? 'La IA de su navegador está leyendo la orden de compra…' : 'Validando los artículos en SAP…'}
            </Text>
            <Progress value={phase === 'descargando' ? progress : 100} animated color="violet" />
          </Stack>
        )}
        {phase === 'error' && <Alert color="red" icon={<IconAlertCircle size={16} />} title="No se pudo leer el PDF">{error}</Alert>}
        {phase === 'revision' && (
          <Stack gap="sm">
            <Group gap="lg">
              <Text size="sm"><Text span c="dimmed">OC: </Text>{header?.numeroOrdenCompra || '—'}</Text>
              <Text size="sm"><Text span c="dimmed">NIT en el PDF: </Text>{header?.nitCliente || '—'}</Text>
              <Text size="sm"><Text span c="dimmed">Entrega: </Text>{header?.fechaEntrega || '—'}</Text>
            </Group>
            {nitMismatch && <Alert color="yellow">El NIT del PDF no coincide con el cliente elegido ({cardCode}). Revise que la OC sea de este cliente.</Alert>}
            <ScrollArea.Autosize mah={420}>
              <Table striped withTableBorder verticalSpacing={4}>
                <Table.Thead>
                  <Table.Tr><Table.Th /><Table.Th>Artículo en SAP</Table.Th><Table.Th style={{ textAlign: 'right' }}>Cantidad</Table.Th><Table.Th style={{ textAlign: 'right' }}>Precio OC</Table.Th><Table.Th style={{ textAlign: 'right' }}>Precio lista</Table.Th></Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {ok.map((l, i) => (
                    <Table.Tr key={`ok-${i}`}>
                      <Table.Td><Checkbox checked={l.include} onChange={(e) => { const c = e.currentTarget.checked; setOk((p) => p.map((x, j) => (j === i ? { ...x, include: c } : x))); }} /></Table.Td>
                      <Table.Td><Badge size="xs" color="green" mr={6}>SAP</Badge>{String(l.ItemCode)} · {String(l.ItemDescription ?? '')}</Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>{Number(l.Quantity).toLocaleString('es-CO')}</Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>{money(l.UnitPrice)}</Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>{money(l.ListPrice)}</Table.Td>
                    </Table.Tr>
                  ))}
                  {pending.map((p, i) => (
                    <Table.Tr key={`p-${i}`}>
                      <Table.Td />
                      <Table.Td>
                        <Text size="xs" c="dimmed">En el PDF: {p.input.ItemCode ? `${p.input.ItemCode} · ` : ''}{p.input.ItemDescription}</Text>
                        <Select size="xs" placeholder={p.candidates.length ? 'Elija el artículo de SAP (o déjelo vacío para omitir)' : 'Sin coincidencias en SAP: se omite'} disabled={!p.candidates.length} clearable
                          data={p.candidates.map((c) => ({ value: c.ItemCode, label: `${c.ItemCode} · ${c.ItemName}` }))} value={p.choice}
                          onChange={(v) => setPending((x) => x.map((y, j) => (j === i ? { ...y, choice: v } : y)))} comboboxProps={{ zIndex: 1400 }} />
                      </Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>{Number(p.input.Quantity).toLocaleString('es-CO')}</Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>{money(p.input.UnitPrice)}</Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>—</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea.Autosize>
            {errors.length > 0 && <Alert color="orange" title="No se pudieron usar">{errors.map((e) => <Text key={e.row} size="xs">{e.error}</Text>)}</Alert>}
            <Text size="xs" c="dimmed">Revise cada línea antes de agregarla: la IA puede equivocarse. El precio de lista sale de SAP; el de la OC queda como precio de venta.</Text>
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setPhase('idle')}>Cancelar</Button>
              <Button color="violet" onClick={accept}>Agregar a la oferta</Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </>
  );
}
