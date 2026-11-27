'use client';

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Alert, Badge, Button, Checkbox, Group, Menu, Modal, Progress, ScrollArea, Select, Stack, Table, Tabs, Text, Textarea, Tooltip } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconAlertCircle, IconArrowBackUp, IconCircleCheck, IconSchool, IconSend, IconFileText, IconHistory, IconLoader2, IconRobot, IconSearch, IconSparkles } from '@tabler/icons-react';
import toast from 'react-hot-toast';
import SalesSearchModal from './SalesSearchModal';
import PoDocumentViewer from './PoDocumentViewer';
import CustomerOrdersModal, { type PoLineRef } from './CustomerOrdersModal';
import { CONFIDENCE_LABEL, type Confidence } from '../../../../lib/sales/itemPrediction';
import { blockingLines, canApply, lowConfidenceIndexes, offerAiNote } from '../../../../lib/sales/pdfReview';
import { agentPatchInstruction, cleanPatch, parseLineCommand, patchContext, type LinePatch } from '../../../../lib/sales/linePatch';
import type { LearnedEntry } from '../../../../lib/sales/learnedMappings';
import { agentOrderInstruction, assembleAgentReply, chunkOrderText, isJsonAttachment, rawLineCount, mergePdfOrders, PDF_ORDER_SCHEMA, PDF_ORDER_SYSTEM_PROMPT, parsePdfOrder, pdfOrderChunkPrompt, tableHeaderRow, type PdfOrderResult } from '../../../../lib/sales/pdfOrder';

/**
 * «Montar oferta desde PDF»: lee la orden de compra del cliente con la IA NATIVA del navegador (Prompt API,
 * Gemini Nano on-device, la misma del botón «Resumir» de las solicitudes) y MONTA la oferta sola: cliente
 * (por el NIT), punto de entrega por defecto, OC, fecha de entrega y líneas validadas en SAP (las que no traen
 * código se emparejan por descripción). El PDF no sale del computador: al servidor solo van los datos leídos.
 * El comercial revisa lo marcado y crea la oferta (Nicolás Rivera, 2026-11-09).
 */

type Line = Record<string, unknown>;
type Support = 'checking' | 'unsupported' | 'ready';
type Phase = 'idle' | 'leyendo' | 'descargando' | 'analizando' | 'agente' | 'montando' | 'simulacion' | 'error';
type SimLine = Line & LineExtra & { include: boolean };
type ChatAgent = { idAgent: number; code: string; displayName: string; companies: { idCompany: number }[] };
/** Espera máxima de la respuesta del agente: si está ocupado en otra conversación hace fila, así que no se falla pronto. */
const AGENT_TIMEOUT_MS = 30 * 60 * 1000;
/** Desde aquí, si el agente no está trabajando en la OC, se avisa que parece ocupado y que se puede cerrar la ventana. */
const AGENT_BUSY_HINT_MS = 2 * 60 * 1000;
/** A long answer arrives split in several chat messages: wait this long for the missing parts before giving up. */
const AGENT_PARTS_GRACE_MS = 45 * 1000;
type ReplyMessage = { id: number; role: string; body: string; attachments?: { fileName: string; contentType: string | null; downloadUrl: string }[] };
const money = (v: unknown) => (v == null || v === '' ? '—' : `$ ${Number(v).toLocaleString('es-CO')}`);

/** Item prediction of a PO line (server side, see lib/sales/itemPrediction.ts). */
type MatchCandidate = { ItemCode: string; ItemName: string; score: number; reason: string; factor: number; line: Line };
type Match = {
  confidence: Confidence;
  reason: string;
  autoSelected: boolean;
  /** The user picked the item by hand (candidate, SAP search or previous order). */
  confirmed: boolean;
  source: { barcode: string; clientCode: string; description: string; quantity: number; price: number | null };
  candidates: MatchCandidate[];
  /** The item comes from what the users taught for this customer (directo) or for the same ingredient (similar). */
  learned?: { kind: 'directo' | 'similar'; id: number };
};
/** Extra state of a line in the review: remember the item for this customer, changed by an instruction, corrected from what was learned. */
type LineExtra = { remember?: boolean; patched?: 'usuario' | 'agente'; corrected?: boolean; factor?: number };
const CONFIDENCE_COLOR: Record<Confidence, string> = { alta: 'green', media: 'yellow', baja: 'red', ninguna: 'gray' };
const matchOf = (l: Line) => (l.match ?? null) as Match | null;

export interface PdfOffer {
  customer: { CardCode: string; CardName: string };
  lines: Line[];
  numeroOrdenCompra: string;
  fechaEntrega: string;
  warnings: string[];
  /** Líneas que la IA leyó del PDF (para comparar con las que quedaron en la oferta). */
  leidas?: number;
}

interface Props {
  companyId: string;
  /** Nombre de la empresa (va en la instrucción al agente). */
  companyName?: string;
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

/** Waits for the agent's JSON answer after message `sentId` (text or attached .json). null on timeout. */
async function pollAgentJson(convId: number, sentId: number, timeoutMs: number): Promise<string | null> {
  const start = Date.now();
  const tried = new Set<string>();
  while (Date.now() - start < timeoutMs) {
    await new Promise((res) => setTimeout(res, 3000));
    const g = await fetch(`/api/chat/conversations/${convId}/messages?limit=30`, { cache: 'no-store' }).catch(() => null);
    const gd = g && g.ok ? await g.json().catch(() => ({})) : {};
    const after = ((gd.messages ?? []) as ReplyMessage[]).filter((x) => x.id > sentId && x.role === 'agent').sort((x, y) => x.id - y.id);
    for (const f of after.flatMap((x) => x.attachments ?? []).filter(isJsonAttachment)) {
      if (tried.has(f.downloadUrl)) continue;
      tried.add(f.downloadUrl);
      const fr = await fetch(f.downloadUrl, { cache: 'no-store' }).catch(() => null);
      const a = assembleAgentReply([fr && fr.ok ? await fr.text().catch(() => '') : '']);
      if (a.status === 'ok') return a.json;
    }
    const a = assembleAgentReply(after.map((x) => x.body ?? ''));
    if (a.status === 'ok') return a.json;
  }
  return null;
}

export default function SalesPdfImport({ companyId, companyName, cardCode, onLoaded }: Props) {
  const [support, setSupport] = useState<Support>('checking');
  const [phase, setPhase] = useState<Phase>('idle');
  const isMobile = useMediaQuery('(max-width: 48em)');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  /** Simulación: lo que se montaría, antes de agregarlo a la oferta (Nicolás Rivera, 2026-11-09). */
  const [sim, setSim] = useState<(Omit<PdfOffer, 'lines'> & { lines: SimLine[] }) | null>(null);
  /** Filas visibles de la simulación: se dibujan de a 100 (una OC de 360 líneas colgaba el navegador). */
  const [simShown, setSimShown] = useState(100);
  /** Rows of the simulation table, to jump to the next Baja line. */
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);
  const lowCursor = useRef(-1);
  const jumpToLow = (lowIndexes: number[]) => {
    const next = lowIndexes.find((i) => i > lowCursor.current) ?? lowIndexes[0];
    lowCursor.current = next;
    if (next >= simShown) setSimShown(next + 1);
    setTimeout(() => rowRefs.current[next]?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  };
  /** Uploaded PO file, shown next to the lines so the user can compare (Nicolás Rivera, 2026-11-27). */
  const [docFile, setDocFile] = useState<File | null>(null);
  const [docUrl, setDocUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!docFile) return setDocUrl(null);
    const url = URL.createObjectURL(docFile);
    setDocUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [docFile]);
  const docIsPdf = Boolean(docFile && (docFile.type === 'application/pdf' || /\.pdf$/i.test(docFile.name)));
  const docIsImage = Boolean(docFile?.type.startsWith('image/'));
  const hasDoc = Boolean(docUrl && (docIsPdf || docIsImage));
  const [showDoc, setShowDoc] = useState(true);
  /** Split layout from 1024 px; below that the lines and the document go in tabs. */
  const isWide = useMediaQuery('(min-width: 1024px)');
  const [mobileTab, setMobileTab] = useState<string | null>('lineas');
  /** Width of the document panel, in % of the split area. */
  const [docPct, setDocPct] = useState(42);
  const [dragging, setDragging] = useState(false);
  const splitRef = useRef<HTMLDivElement | null>(null);
  const startDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(true);
    const move = (ev: PointerEvent) => {
      const r = splitRef.current?.getBoundingClientRect();
      if (!r || !r.width) return;
      setDocPct(Math.min(65, Math.max(25, ((r.right - ev.clientX) / r.width) * 100)));
    };
    const up = () => {
      setDragging(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  /** Avance de la lectura por fragmentos (OC de varias hojas). */
  const [step, setStep] = useState<{ k: number; n: number } | null>(null);
  /** Agentes del chat asignados al usuario, de CUALQUIER empresa («Montar con agente»; Nicolás Rivera, 2026-11-24:
   *  el agente solo lee el PDF, así que no tiene que ser de la empresa de la oferta). El chat valida el permiso. */
  const [agents, setAgents] = useState<ChatAgent[]>([]);
  const [agent, setAgent] = useState<ChatAgent | null>(null);
  const [conversationId, setConversationId] = useState<number | null>(null);
  /** Estado en vivo del agente mientras lee la OC (el mismo indicador del chat: «Pensando…», «Leyendo el adjunto…»). */
  const [live, setLive] = useState<{ sentAt: number; delivered: boolean; state: string | null; label: string | null; tasks: { desc: string }[] } | null>(null);
  const [now, setNow] = useState(Date.now());
  /** Ventana cerrada mientras el agente trabaja: la espera sigue y al responder se abre la simulación. */
  const [minimized, setMinimized] = useState(false);
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [live]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/chat/access', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d?.canUseChat) return;
        // Primero los de la empresa de la oferta; después los demás.
        const isFromCompany = (a: ChatAgent) => a.companies?.some((c) => String(c.idCompany) === String(companyId));
        setAgents([...((d.agents ?? []) as ChatAgent[])].sort((x, y) => Number(isFromCompany(y)) - Number(isFromCompany(x))));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [companyId]);

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
    setDocFile(file);
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
      const avisoFallos = fallos.length ? [`La IA no pudo leer ${fallos.length === 1 ? 'la parte' : 'las partes'} ${fallos.join(', ')} del PDF: compare las líneas con el documento.`] : [];
      await resolveAndSimulate(r, avisoFallos);
    } catch (e) {
      setError((e as Error).message);
      setPhase('error');
    }
  };

  /** Con lo leído del PDF (por la IA del navegador o por el agente): cliente y artículos en SAP, y la simulación. */
  const resolveAndSimulate = async (r: PdfOrderResult, previousWarnings: string[]) => {
      if (!r.lineas.length) throw new Error('No se encontraron líneas de productos en el PDF. Revise el archivo o use el cargue desde Excel.');
      setPhase('montando');
      const res = await fetch('/api/sales/pdf-resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: Number(companyId), nit: r.nitCliente, cardCode: cardCode || undefined, lines: r.lineas }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'No se pudo montar la oferta con los datos del PDF');
      if (!d.customer) throw new Error((d.warnings ?? []).join(' ') || 'No se identificó el cliente del PDF.');
      if (!(d.lines ?? []).length) throw new Error(`Se identificó el cliente ${d.customer.CardName}, pero ninguna línea del PDF se encontró en SAP. ${(d.warnings ?? []).join(' ')}`);
      setSimShown(100);
      setSim({
        customer: d.customer, lines: (d.lines as Line[]).map((l) => ({ ...l, include: Boolean(l.ItemCode) })), numeroOrdenCompra: r.numeroOrdenCompra,
        fechaEntrega: r.fechaEntrega, warnings: [...previousWarnings, ...(d.warnings ?? [])], leidas: r.lineas.length,
      });
      setPhase('simulacion');
  };

  /**
   * «Montar con agente»: le envía la OC al agente asignado por el chat de SynerLink (su conversación directa, con
   * los mismos permisos del chat), espera su respuesta en JSON y sigue igual que con la IA del navegador.
   */
  const analyzeWithAgent = async (file: File | null, a: ChatAgent | null) => {
    if (!file || !a) return;
    setDocFile(file);
    setError('');
    setAgent(a);
    setConversationId(null);
    setPhase('agente');
    try {
      const c = await fetch('/api/chat/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idAgent: a.idAgent }) });
      const cd = await c.json().catch(() => ({}));
      if (!c.ok || !cd.conversation?.id) throw new Error(cd.error || `No se pudo abrir la conversación con ${a.displayName}.`);
      const convId = Number(cd.conversation.id);
      setConversationId(convId);
      const form = new FormData();
      form.append('body', agentOrderInstruction(companyName ?? `empresa ${companyId}`, file.name));
      form.append('files', file, file.name);
      const m = await fetch(`/api/chat/conversations/${convId}/messages`, { method: 'POST', body: form });
      const md = await m.json().catch(() => ({}));
      if (!m.ok || !md.message?.id) throw new Error(md.error || `No se pudo enviar la OC a ${a.displayName}.`);
      const sentId = Number(md.message.id);
      // Espera la respuesta del agente (mensaje posterior al nuestro que no sea del usuario) y, mientras tanto,
      // muestra su estado en vivo (recibido, qué está haciendo, subtareas).
      const start = Date.now();
      setLive({ sentAt: start, delivered: false, state: null, label: null, tasks: [] });
      let reply: string | null = null;
      let incompleteSince: number | null = null;
      let seenParts = 0;
      const triedFiles = new Set<string>();
      while (Date.now() - start < AGENT_TIMEOUT_MS) {
        await new Promise((res) => setTimeout(res, 3000));
        const [g, st] = await Promise.all([
          fetch(`/api/chat/conversations/${convId}/messages?limit=30`, { cache: 'no-store' }),
          fetch(`/api/chat/conversations/${convId}/status`, { cache: 'no-store' }).catch(() => null),
        ]);
        const gd = await g.json().catch(() => ({}));
        const sd = st && st.ok ? await st.json().catch(() => ({})) : {};
        const mine = ((gd.messages ?? []) as { id: number; deliveredAt?: string | null }[]).find((x) => x.id === sentId);
        setLive((prev) => prev && {
          ...prev,
          delivered: prev.delivered || Boolean(mine?.deliveredAt) || (sd.status?.state && sd.status.state !== 'idle'),
          state: sd.status?.state ?? prev.state,
          label: sd.status?.label ?? null,
          tasks: Array.isArray(sd.status?.tasks) ? sd.status.tasks : [],
        });
        // Agent messages after the request, in order. A long answer comes split in several messages (the
        // channel cuts at 40,000 characters), so they are joined until the JSON parses.
        const after = ((gd.messages ?? []) as ReplyMessage[]).filter((x) => x.id > sentId && x.role === 'agent').sort((x, y) => x.id - y.id);
        // The agent may also send the JSON as an attached .json file.
        for (const f of after.flatMap((x) => x.attachments ?? []).filter(isJsonAttachment)) {
          if (triedFiles.has(f.downloadUrl)) continue;
          triedFiles.add(f.downloadUrl);
          const fr = await fetch(f.downloadUrl, { cache: 'no-store' }).catch(() => null);
          const text = fr && fr.ok ? await fr.text().catch(() => '') : '';
          const fromFile = assembleAgentReply([text]);
          if (fromFile.status === 'ok') {
            reply = fromFile.json;
            break;
          }
        }
        if (reply) break;
        const assembled = assembleAgentReply(after.map((x) => x.body ?? ''));
        if (assembled.status === 'ok') {
          reply = assembled.json;
          break;
        }
        if (assembled.status === 'incomplete') {
          // Restart the grace period every time a new part arrives.
          if (assembled.parts !== seenParts) {
            seenParts = assembled.parts;
            incompleteSince = Date.now();
          }
          const idle = !sd.status?.state || sd.status.state === 'idle';
          if (incompleteSince && idle && Date.now() - incompleteSince > AGENT_PARTS_GRACE_MS) {
            throw new Error(`${a.displayName} respondió en ${assembled.parts === 1 ? 'un mensaje' : `${assembled.parts} mensajes`}, pero el JSON llegó incompleto (no se pudo leer). Revise la respuesta en el chat e intente de nuevo o use el cargue desde Excel.`);
          }
        }
      }
      if (!reply) throw new Error(`${a.displayName} no respondió en ${AGENT_TIMEOUT_MS / 60000} minutos. Cuando responda, verá su lectura en el chat; puede intentarlo de nuevo.`);
      setLive(null);
      setMinimized(false);
      const r = parsePdfOrder(reply);
      const leidas = rawLineCount(reply);
      const descartadas = leidas - r.lineas.length;
      const warnings = descartadas > 0 ? [`${a.displayName} leyó ${leidas} líneas; ${descartadas} se descartaron por no tener cantidad válida o descripción/código.`] : [];
      await resolveAndSimulate(r, warnings);
    } catch (e) {
      setLive(null);
      setError((e as Error).message);
      setPhase('error');
    }
  };

  const working = phase !== 'idle' && phase !== 'error' && phase !== 'simulacion';

  /** Line whose item is being searched by hand (index in sim.lines). */
  const [pickFor, setPickFor] = useState<number | null>(null);
  /** Customer's previous documents: undefined = closed, null = whole PO, number = one line (index in sim.lines). */
  const [ordersFor, setOrdersFor] = useState<number | null | undefined>(undefined);
  const poLineRefs: PoLineRef[] = (sim?.lines ?? []).map((l, i) => {
    const m = matchOf(l);
    return { index: i, row: String(l.row ?? i + 1), codes: [...new Set([String(l.ItemCode || ''), ...(m?.candidates.map((c) => c.ItemCode) ?? [])].filter(Boolean))] };
  });
  const setLine = (i: number, f: (l: SimLine) => SimLine) =>
    setSim((prev) => (prev ? { ...prev, lines: prev.lines.map((x, j) => (j === i ? f(x) : x)) } : prev));
  /** The user picks one of the suggested candidates. */
  /** What the PO prints for a line plus the chosen item: the learned mapping (see lib/sales/learnedMappings.ts). */
  const entryOf = (l: SimLine, item?: Record<string, unknown>, factor?: number): LearnedEntry | null => {
    const m = matchOf(l);
    const code = String(item?.ItemCode ?? l.ItemCode ?? '');
    if (!m || !code) return null;
    return {
      clientCode: m.source.clientCode || null, barcode: m.source.barcode || null, description: m.source.description || null,
      itemCode: code, itemName: String(item?.ItemDescription ?? l.ItemDescription ?? ''), factor: factor ?? l.factor ?? 1,
    };
  };
  /** Saves or forgets learned mappings (KRONOSDB only, never SAP). */
  const learn = async (action: 'save' | 'forget', entries: LearnedEntry[], source: 'usuario' | 'agente' = 'usuario'): Promise<boolean> => {
    if (!sim || !entries.length) return false;
    try {
      const res = await fetch('/api/sales/learned', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, companyId: Number(companyId), cardCode: sim.customer.CardCode, source, entries }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'No se pudo guardar lo aprendido.');
      return true;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    }
  };
  /** Conversation with the agent about the lines (instructions and answers). */
  const [chatText, setChatText] = useState('');
  const [chatBusy, setChatBusy] = useState<string | null>(null);
  const [chatLog, setChatLog] = useState<{ who: 'usuario' | 'agente' | 'sistema'; text: string }[]>([]);
  const say = (who: 'usuario' | 'agente' | 'sistema', text: string) => setChatLog((x) => [...x.slice(-5), { who, text }]);
  /** Undo stack of the instructions: previous lines and the mappings they saved. */
  const [undoStack, setUndoStack] = useState<{ lines: SimLine[]; saved: LearnedEntry[]; source: 'usuario' | 'agente' }[]>([]);

  /**
   * «Que la corrija sola»: after something is learned, the lines the user has not touched are predicted again;
   * those that now come from what was learned take the new item with a «Sugerencia corregida» badge.
   */
  const selfCorrect = async () => {
    if (!sim) return;
    const pending = sim.lines
      .map((l, i) => ({ l, i, m: matchOf(l) }))
      .filter(({ l, m }) => m && !m.confirmed && !l.patched);
    if (!pending.length) return;
    try {
      const res = await fetch('/api/sales/pdf-resolve', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: Number(companyId), cardCode: sim.customer.CardCode,
          lines: pending.map(({ l, m }) => ({
            row: Number(l.row), ItemCode: '', Quantity: m!.source.quantity, UnitPrice: m!.source.price, WarehouseCode: '', ItemDescription: m!.source.description,
            ...(m!.source.barcode ? { Barcode: m!.source.barcode } : {}), ...(m!.source.clientCode ? { ClientCode: m!.source.clientCode } : {}),
          })),
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return;
      const fresh = new Map(((d.lines ?? []) as Line[]).filter((x) => matchOf(x)?.learned && x.ItemCode).map((x) => [Number(x.row), x]));
      const n = pending.filter(({ l }) => fresh.has(Number(l.row)) && fresh.get(Number(l.row))!.ItemCode !== l.ItemCode).length;
      if (!n) return;
      setSim((prev) => prev && {
        ...prev,
        lines: prev.lines.map((l) => {
          const f = fresh.get(Number(l.row));
          const m = matchOf(l);
          if (!f || !m || m.confirmed || l.patched || f.ItemCode === l.ItemCode) return l;
          return { ...l, ...f, include: l.include, corrected: true };
        }),
      });
      say('sistema', `Se corrigieron ${n} línea(s) con lo aprendido.`);
    } catch {
      /* the correction is a suggestion: nothing to do */
    }
  };

  /** Remembers (or not) the item the user chose for a line, then lets the other lines correct themselves. */
  const rememberChoice = async (entry: LearnedEntry | null) => {
    if (!entry) return;
    if (await learn('save', [entry])) await selfCorrect();
  };

  /** The user picks one of the suggested candidates. */
  const chooseCandidate = (i: number, code: string | null) => {
    if (!sim) return;
    const cur = sim.lines[i];
    const c = matchOf(cur)?.candidates.find((x) => x.ItemCode === code);
    setLine(i, (l) => {
      const m = matchOf(l);
      if (!m || !c) return l;
      return { ...l, ...c.line, include: true, remember: true, factor: c.factor, corrected: false, match: { ...m, confirmed: true, reason: c.reason } };
    });
    if (c && c.ItemCode !== cur.ItemCode) void rememberChoice(entryOf(cur, { ItemCode: c.ItemCode, ItemDescription: c.ItemName }, c.factor));
  };
  /** The user (or an instruction) chose an item in SAP: it is validated (price list, warehouse) with the PO quantity and price. */
  const chooseSearched = async (
    i: number, row: Record<string, unknown>, reason = 'Elegido por el usuario', opts: { factor?: number; remember?: boolean; patched?: 'usuario' | 'agente' } = {}
  ): Promise<Line | null> => {
    if (!sim) return null;
    const l = sim.lines[i];
    const m = matchOf(l);
    const factor = opts.factor && opts.factor > 0 ? opts.factor : 1;
    const qty = Number(m?.source.quantity ?? l.Quantity) * factor;
    const srcPrice = m ? m.source.price : (l.UnitPrice as number | null);
    const price = srcPrice == null ? null : Math.round((Number(srcPrice) / factor) * 10000) / 10000;
    try {
      const res = await fetch('/api/sales/lines-validate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: Number(companyId), cardCode: sim.customer.CardCode, lines: [{ row: 1, ItemCode: String(row.ItemCode), Quantity: qty, UnitPrice: price, WarehouseCode: '', ItemDescription: '' }] }),
      });
      const d = await res.json().catch(() => ({}));
      const v = (d.lines ?? [])[0] as Line | undefined;
      if (!res.ok || !v) throw new Error(d.error || (d.errors ?? [])[0]?.error || 'No se pudo validar el artículo en SAP.');
      const remember = opts.remember ?? true;
      setLine(i, (x) => {
        const mm = matchOf(x);
        const cand: MatchCandidate = { ItemCode: String(v.ItemCode), ItemName: String(v.ItemDescription ?? ''), score: 0, reason, factor, line: { ...v, row: x.row } };
        return {
          ...x, ...v, row: x.row, include: true, remember, factor, corrected: false, ...(opts.patched ? { patched: opts.patched } : {}),
          match: mm ? { ...mm, learned: undefined, confirmed: true, reason: cand.reason, candidates: [cand, ...mm.candidates.filter((c) => c.ItemCode !== cand.ItemCode)] } : undefined,
        };
      });
      if (!opts.patched && remember) void rememberChoice(entryOf(l, v, factor));
      return v;
    } catch (e) {
      toast.error((e as Error).message);
      return null;
    }
  };

  /** Applies a patch (from the parser or the agent) to the lines on screen; can be undone. Never touches SAP. */
  const applyPatch = async (patch: LinePatch, source: 'usuario' | 'agente') => {
    if (!sim) return;
    const before = sim.lines;
    const saved: LearnedEntry[] = [];
    const rowIndex = (n: number) => sim.lines.findIndex((l, i) => Number(l.row ?? i + 1) === n);
    let fails = 0;
    for (const ch of patch.changes) {
      const i = rowIndex(ch.line);
      if (i < 0) continue;
      const l = sim.lines[i];
      const m = matchOf(l);
      if (ch.itemCode) {
        const v = await chooseSearched(i, { ItemCode: ch.itemCode }, source === 'agente' ? `Indicado por ${agent?.displayName ?? 'el agente'}` : 'Indicado por el usuario', { factor: ch.factor ?? l.factor ?? 1, remember: ch.remember !== false, patched: source });
        if (!v) { fails++; continue; }
        if (ch.remember !== false) { const e = entryOf(l, v, ch.factor ?? l.factor ?? 1); if (e) saved.push(e); }
      } else if (ch.factor && m) {
        const f = ch.factor;
        setLine(i, (x) => ({ ...x, factor: f, Quantity: Number(m.source.quantity) * f, UnitPrice: m.source.price == null ? x.UnitPrice : Math.round((Number(m.source.price) / f) * 10000) / 10000, patched: source }));
        if (ch.remember && l.ItemCode) { const e = entryOf(l, undefined, f); if (e) saved.push(e); }
      }
      if (ch.quantity != null) setLine(i, (x) => ({ ...x, Quantity: ch.quantity, patched: source }));
      if (ch.price != null) setLine(i, (x) => ({ ...x, UnitPrice: ch.price, patched: source }));
      if (ch.include !== undefined) setLine(i, (x) => ({ ...x, include: ch.include as boolean, patched: source }));
    }
    setUndoStack((u) => [...u.slice(-9), { lines: before, saved, source }]);
    if (fails) say('sistema', `${fails} cambio(s) no se aplicaron: el artículo no se encontró o no se pudo validar en SAP.`);
    if (saved.length && (await learn('save', saved, source))) {
      say('sistema', `Aprendido para ${sim.customer.CardName}: ${[...new Set(saved.map((e) => e.itemCode))].join(', ')}.`);
      await selfCorrect();
    }
  };

  const undo = async () => {
    const last = undoStack[undoStack.length - 1];
    if (!last) return;
    setUndoStack((u) => u.slice(0, -1));
    setSim((prev) => prev && { ...prev, lines: last.lines });
    if (last.saved.length) await learn('forget', last.saved, last.source);
    say('sistema', 'Se deshizo el último cambio.');
  };

  /** Instruction typed by the user: common commands are applied at once; anything else goes to the agent. */
  const sendInstruction = async () => {
    const text = chatText.trim();
    if (!sim || !text || chatBusy) return;
    const rows = sim.lines.map((l, i) => Number(l.row ?? i + 1));
    say('usuario', text);
    setChatText('');
    const local = parseLineCommand(text, rows);
    if (local) {
      setChatBusy('Aplicando…');
      try {
        await applyPatch(local, 'usuario');
        say('sistema', local.message);
      } finally {
        setChatBusy(null);
      }
      return;
    }
    const a = agent ?? agents[0] ?? null;
    if (!a) {
      say('sistema', 'No tiene un agente del chat asignado. Use instrucciones como: la línea 2 es PTCZ0111; quita la línea 3; las cantidades vienen en cajas de 10.');
      return;
    }
    setChatBusy(`${a.displayName} está revisando la instrucción…`);
    try {
      let convId = conversationId;
      if (!convId) {
        const c = await fetch('/api/chat/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idAgent: a.idAgent }) });
        const cd = await c.json().catch(() => ({}));
        if (!c.ok || !cd.conversation?.id) throw new Error(cd.error || `No se pudo abrir la conversación con ${a.displayName}.`);
        convId = Number(cd.conversation.id);
        setConversationId(convId);
        setAgent(a);
      }
      const form = new FormData();
      form.append('body', agentPatchInstruction(companyName ?? `empresa ${companyId}`, sim.customer, text));
      form.append('files', new File([JSON.stringify({ customer: sim.customer, lines: patchContext(sim.lines) }, null, 1)], 'contexto-oferta.json', { type: 'application/json' }));
      const r = await fetch(`/api/chat/conversations/${convId}/messages`, { method: 'POST', body: form });
      const md = await r.json().catch(() => ({}));
      if (!r.ok || !md.message?.id) throw new Error(md.error || `No se pudo enviar la instrucción a ${a.displayName}.`);
      const json = await pollAgentJson(convId, Number(md.message.id), 10 * 60 * 1000);
      if (!json) throw new Error(`${a.displayName} no respondió en 10 minutos. Revise la conversación en el chat.`);
      const patch = cleanPatch(JSON.parse(json), rows);
      say('agente', patch.message || (patch.changes.length ? `${patch.changes.length} cambio(s).` : 'Sin cambios.'));
      if (patch.changes.length) await applyPatch(patch, 'agente');
    } catch (e) {
      say('sistema', (e as Error).message);
    } finally {
      setChatBusy(null);
    }
  };

  /** Agrega a la oferta lo simulado (las líneas marcadas; solo bloquean las que no tienen artículo). */
  const apply = () => {
    if (!sim || !canApply(sim.lines)) return;
    const lines = sim.lines.filter((l) => l.include).map(({ include: _i, match, remember: _r, patched: _p, corrected: _c, factor: _f, ...l }) => {
      const m = match as Match | undefined;
      return m ? { ...l, aiNote: offerAiNote(m) } : l;
    });
    if (!lines.length) return;
    // The review notices of the simulation no longer apply once the lines go to the offer.
    const warnings = sim.warnings.filter((a) => !/por confirmar: revise|confianza Baja: rev|sin artículo en SAP: búsquelo/.test(a));
    onLoaded({ ...sim, warnings, lines });
    setSim(null);
    setDocFile(null);
    setChatLog([]);
    setUndoStack([]);
    setPhase('idle');
  };
  const inputId = `pdf-ia-${companyId}`;
  const agentInputId = `pdf-agente-${companyId}`;

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
      {phase === 'agente' && minimized && (
        <Button variant="subtle" color="indigo" size="xs" leftSection={<IconLoader2 size={14} className="animate-spin" />} onClick={() => setMinimized(false)}>
          {agent?.displayName} leyendo la OC…
        </Button>
      )}
      <input id={inputId} type="file" accept="application/pdf" hidden onChange={(e) => { analyze(e.currentTarget.files?.[0] ?? null); e.currentTarget.value = ''; }} />
      {agents.length > 0 && (
        <>
          {agents.length === 1 ? (
            <Tooltip label={`Envía la OC a ${agents[0].displayName} por el chat de SynerLink; lee el PDF completo y la oferta se monta con su respuesta.`} multiline w={300}>
              <Button variant="light" color="indigo" leftSection={<IconRobot size={16} />} loading={working} onClick={() => { setAgent(agents[0]); document.getElementById(agentInputId)?.click(); }}>
                Montar con {agents[0].displayName}
              </Button>
            </Tooltip>
          ) : (
            <Menu withinPortal zIndex={1200}>
              <Menu.Target>
                <Button variant="light" color="indigo" leftSection={<IconRobot size={16} />} loading={working}>Montar con agente</Button>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>Enviar la OC a</Menu.Label>
                {agents.map((a) => (
                  <Menu.Item key={a.idAgent} leftSection={<IconRobot size={14} />} onClick={() => { setAgent(a); document.getElementById(agentInputId)?.click(); }}>
                    {a.displayName}
                  </Menu.Item>
                ))}
              </Menu.Dropdown>
            </Menu>
          )}
          <input id={agentInputId} type="file" accept="application/pdf" hidden onChange={(e) => { analyzeWithAgent(e.currentTarget.files?.[0] ?? null, agent); e.currentTarget.value = ''; }} />
        </>
      )}

      <Modal opened={phase !== 'idle' && !(phase === 'agente' && minimized)} onClose={() => (phase === 'agente' ? setMinimized(true) : !working && setPhase('idle'))} size={phase === 'simulacion' ? '95vw' : 'md'} fullScreen={phase === 'simulacion' && Boolean(isMobile)}
        styles={phase === 'simulacion' ? {
          // Large review layout: the lines table fills the height; summary, warnings, total and buttons stay visible.
          content: { maxWidth: isMobile ? undefined : 1600, height: isMobile ? undefined : '90vh', display: 'flex', flexDirection: 'column' },
          body: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' },
        } : undefined}
        title={<Group gap={6}><IconSparkles size={18} /><Text fw={700}>{agent && (phase === 'agente' || conversationId) ? `Oferta desde el PDF (con ${agent.displayName})` : 'Oferta desde el PDF (IA local)'}</Text></Group>}
        closeOnClickOutside={!working || phase === 'agente'} withCloseButton={!working || phase === 'agente'} zIndex={1300}>
        {phase === 'agente' && live && (
          <Stack gap={6} mb="sm">
            {(() => {
              const seg = Math.floor((now - live.sentAt) / 1000);
              const t = `${Math.floor(seg / 60)}:${String(seg % 60).padStart(2, '0')}`;
              const paso = (ok: boolean, activo: boolean, texto: string) => (
                <Group gap={6} wrap="nowrap">
                  {ok ? <IconCircleCheck size={16} color="var(--mantine-color-teal-6)" /> : activo ? <IconLoader2 size={16} className="animate-spin" /> : <IconLoader2 size={16} opacity={0.3} />}
                  <Text size="sm" c={ok || activo ? undefined : 'dimmed'}>{texto}</Text>
                </Group>
              );
              const trabajando = live.state === 'thinking' || live.state === 'tool';
              return (
                <>
                  {paso(true, false, `Orden de compra enviada a ${agent?.displayName ?? 'el agente'}`)}
                  {paso(live.delivered, !live.delivered, live.delivered ? `${agent?.displayName ?? 'El agente'} la recibió` : 'Esperando a que el agente la reciba…')}
                  {paso(false, live.delivered, trabajando ? `${live.label || (live.state === 'tool' ? 'Usando una herramienta…' : 'Pensando…')}` : live.delivered ? 'Leyendo la orden de compra…' : 'Leer la orden de compra')}
                  {live.tasks.length > 0 && (
                    <Stack gap={2} pl={24}>
                      {live.tasks.slice(0, 4).map((tk, i) => <Text key={i} size="xs" c="dimmed">• {tk.desc}</Text>)}
                    </Stack>
                  )}
                  <Text size="xs" c="dimmed">Tiempo: {t}</Text>
                  {now - live.sentAt > AGENT_BUSY_HINT_MS && !(live.state === 'thinking' || live.state === 'tool') && (
                    <Alert color="blue" variant="light" p="xs">
                      {agent?.displayName ?? 'El agente'} parece ocupado en otra conversación: atiende la OC cuando termine. Puede cerrar esta ventana y seguir; cuando responda, se abre la simulación.
                    </Alert>
                  )}
                </>
              );
            })()}
          </Stack>
        )}
        {working && (
          <Stack gap="xs">
            <Text size="sm" c="dimmed">
              {phase === 'leyendo' ? 'Leyendo el PDF…' : phase === 'descargando' ? `Descargando el modelo de IA del navegador (solo la primera vez)… ${progress}%` : phase === 'analizando' ? `La IA de su navegador está leyendo la orden de compra${step ? ` (parte ${step.k} de ${step.n})` : ''}…` : phase === 'agente' ? `${agent?.displayName ?? 'El agente'} está leyendo la orden de compra (puede tardar unos minutos)…` : 'Identificando el cliente y los artículos en SAP…'}
            </Text>
            <Progress value={phase === 'descargando' ? progress : step ? Math.round((step.k / step.n) * 100) : 100} animated color="violet" />
          </Stack>
        )}
        {phase === 'error' && <Alert color="red" icon={<IconAlertCircle size={16} />} title="No se pudo montar la oferta">{error}</Alert>}
        {conversationId && (phase === 'agente' || phase === 'error') && (
          <Text size="xs" c="dimmed" mt="xs">La conversación queda en su chat con {agent?.displayName}: <a href={`/process/chat?agent=${encodeURIComponent(agent?.code ?? "")}`} target="_blank" rel="noreferrer">abrirla</a>.</Text>
        )}
        {phase === 'simulacion' && sim && (
          <Stack gap="sm" style={{ flex: 1, minHeight: 0 }}>
            <Text size="sm" c="dimmed">Simulación: así quedaría la oferta con lo que la IA leyó del PDF. Nada se agrega hasta que pulse Agregar a la oferta.</Text>
            <Group gap="lg" wrap="wrap">
              <Text size="sm"><Text span c="dimmed">Cliente: </Text><b>{sim.customer.CardName}</b> ({sim.customer.CardCode})</Text>
              <Text size="sm"><Text span c="dimmed">OC: </Text>{sim.numeroOrdenCompra || '—'}</Text>
              <Text size="sm"><Text span c="dimmed">Entrega: </Text>{sim.fechaEntrega || '— (indíquela)'}</Text>
              <Text size="sm"><Text span c="dimmed">Líneas: </Text>{sim.lines.length}{sim.leidas && sim.leidas !== sim.lines.length ? ` de ${sim.leidas} leídas en el PDF` : ''}</Text>
              <Button size="compact-xs" variant="light" color="violet" leftSection={<IconHistory size={14} />} onClick={() => setOrdersFor(null)}>
                Pedidos anteriores del cliente
              </Button>
              {hasDoc && isWide && (
                <Button size="compact-xs" variant={showDoc ? 'light' : 'filled'} color="gray" leftSection={<IconFileText size={14} />} onClick={() => setShowDoc((v) => !v)}>
                  {showDoc ? 'Ocultar documento' : 'Ver documento'}
                </Button>
              )}
            </Group>
            {sim.warnings.length > 0 && <Alert color="orange" variant="light">{sim.warnings.map((a, i) => <Text key={i} size="xs">{a}</Text>)}</Alert>}
            <style>{'tr:hover > .po-row-num p { font-weight: 700; color: var(--mantine-color-violet-filled); }'}</style>
            {(() => {
              const linesTable = (
              <ScrollArea style={{ flex: 1, minHeight: 200 }} type="auto" offsetScrollbars>
                <Table striped highlightOnHover withTableBorder stickyHeader verticalSpacing={4} miw={hasDoc && isWide && showDoc ? 760 : 900}>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th><Checkbox checked={sim.lines.every((l) => l.include)} indeterminate={sim.lines.some((l) => l.include) && !sim.lines.every((l) => l.include)}
                        onChange={(e) => { const c = e.currentTarget.checked; setSim({ ...sim, lines: sim.lines.map((l) => ({ ...l, include: c })) }); }} /></Table.Th>
                      <Table.Th title="Renglón de la OC">#</Table.Th><Table.Th style={{ minWidth: hasDoc && isWide && showDoc ? 360 : 480, width: '55%' }}>Artículo en SAP</Table.Th><Table.Th style={{ textAlign: 'right' }}>Cantidad</Table.Th>
                      <Table.Th style={{ textAlign: 'right' }}>Precio OC</Table.Th><Table.Th style={{ textAlign: 'right' }}>Precio lista</Table.Th>
                      <Table.Th style={{ textAlign: 'right' }}>Total línea</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {sim.lines.slice(0, simShown).map((l, i) => (
                      <Table.Tr key={i} ref={(el) => { rowRefs.current[i] = el; }} data-confianza={matchOf(l)?.confidence}
                        style={matchOf(l)?.confidence === 'baja' && l.ItemCode && !l.patched ? { background: 'var(--mantine-color-red-light)', boxShadow: 'inset 3px 0 0 var(--mantine-color-red-filled)' }
                          : l.patched || l.corrected ? { background: 'var(--mantine-color-violet-light)', boxShadow: 'inset 3px 0 0 var(--mantine-color-violet-filled)' } : undefined}>
                        <Table.Td><Checkbox checked={l.include} onChange={(e) => { const c = e.currentTarget.checked; setSim({ ...sim, lines: sim.lines.map((x, j) => (j === i ? { ...x, include: c } : x)) }); }} /></Table.Td>
                        <Table.Td className="po-row-num"><Text size="xs" c="dimmed">{String(l.row ?? i + 1)}</Text></Table.Td>
                        <Table.Td>
                          {(() => {
                            const m = matchOf(l);
                            if (!m) {
                              return (
                                <>
                                  <Text size="sm">{String(l.ItemCode)} · {String(l.ItemDescription ?? '')}</Text>
                                  {l.aiNote ? <Badge size="xs" variant="light" color={String(l.aiNote).startsWith('Revisar') ? 'orange' : 'violet'} style={{ whiteSpace: 'normal', height: 'auto' }}>✨ {String(l.aiNote)}</Badge> : null}
                                </>
                              );
                            }
                            const sourceText = [m.source.barcode && `EAN ${m.source.barcode}`, m.source.clientCode && `Ref. cliente ${m.source.clientCode}`, m.source.description, `${Number(m.source.quantity).toLocaleString('es-CO')} a ${money(m.source.price)}`].filter(Boolean).join(' · ');
                            return (
                              <Stack gap={2}>
                                <Text size="xs" c="dimmed">En la OC: {sourceText || 'sin datos del artículo'}</Text>
                                <Group gap={6} wrap="nowrap" align="center">
                                  <Badge size="sm" color={CONFIDENCE_COLOR[m.confidence]} variant={m.confidence === 'alta' ? 'filled' : 'light'} style={{ flexShrink: 0 }}>
                                    {CONFIDENCE_LABEL[m.confidence]}
                                  </Badge>
                                  {m.candidates.length > 0 ? (
                                    <Select
                                      size="xs" style={{ flex: 1, minWidth: 320 }} comboboxProps={{ zIndex: 1400, withinPortal: true, width: 'max-content', position: 'bottom-start' }} allowDeselect={false}
                                      aria-label="Artículo sugerido"
                                      title={(() => { const c = m.candidates.find((x) => x.ItemCode === String(l.ItemCode || '')); return c ? `${c.ItemCode} · ${c.ItemName}` : undefined; })()}
                                      value={String(l.ItemCode || '') || null}
                                      data={m.candidates.map((c) => ({ value: c.ItemCode, label: `${c.ItemCode} · ${c.ItemName}${c.score ? ` (${Math.round(c.score * 100)} %)` : ''}` }))}
                                      onChange={(v) => chooseCandidate(i, v)}
                                    />
                                  ) : (
                                    <Text size="sm" c="dimmed" style={{ flex: 1 }}>Sin artículo sugerido</Text>
                                  )}
                                  <Tooltip label="Buscar otro artículo en SAP" withinPortal zIndex={1400}>
                                    <Button size="compact-xs" variant="subtle" onClick={() => setPickFor(i)} aria-label="Buscar artículo"><IconSearch size={14} /></Button>
                                  </Tooltip>
                                  <Tooltip label="Ver pedidos anteriores" withinPortal zIndex={1400}>
                                    <Button size="compact-xs" variant="subtle" color="violet" onClick={() => setOrdersFor(i)} aria-label="Ver pedidos anteriores"><IconHistory size={14} /></Button>
                                  </Tooltip>
                                </Group>
                                <Text size="xs" c={m.confidence === 'ninguna' ? 'red' : 'dimmed'}>{m.reason}</Text>
                                {(m.learned || l.patched || l.corrected || l.remember !== undefined) && (
                                  <Group gap={6} wrap="wrap">
                                    {l.patched && <Badge size="xs" color="violet" variant="light">{l.patched === 'agente' ? `Cambiado por ${agent?.displayName ?? 'el agente'}` : 'Cambiado por su indicación'}</Badge>}
                                    {l.corrected && <Badge size="xs" color="grape" variant="light">Sugerencia corregida</Badge>}
                                    {m.learned && !l.corrected && <Badge size="xs" color="teal" variant="light" leftSection={<IconSchool size={11} />}>{m.learned.kind === 'directo' ? 'Aprendido' : 'Sugerencia corregida'}</Badge>}
                                    {m.learned && (
                                      <Button size="compact-xs" variant="subtle" color="gray"
                                        onClick={async () => { const e = entryOf(l); if (e && (await learn('forget', [e]))) { setLine(i, (x) => ({ ...x, remember: false, match: { ...matchOf(x)!, learned: undefined } })); toast.success('Se olvidó lo aprendido para esta línea.'); } }}>
                                        Olvidar
                                      </Button>
                                    )}
                                    {l.remember !== undefined && !m.learned && Boolean(l.ItemCode) && (
                                      <Checkbox size="xs" label="Recordar para este cliente" checked={l.remember}
                                        onChange={async (ev) => {
                                          const on = ev.currentTarget.checked;
                                          const e = entryOf(l);
                                          if (e && (await learn(on ? 'save' : 'forget', [e]))) setLine(i, (x) => ({ ...x, remember: on }));
                                        }} />
                                    )}
                                  </Group>
                                )}
                              </Stack>
                            );
                          })()}
                        </Table.Td>
                        <Table.Td style={{ textAlign: 'right' }}>{Number(l.Quantity).toLocaleString('es-CO')}</Table.Td>
                        <Table.Td style={{ textAlign: 'right' }}>{money(l.UnitPrice)}</Table.Td>
                        <Table.Td style={{ textAlign: 'right' }}>{money(l.ListPrice)}</Table.Td>
                        <Table.Td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}><Text size="sm" fw={500} c={l.include ? undefined : 'dimmed'}>{money(Number(l.Quantity ?? 0) * Number(l.UnitPrice ?? 0))}</Text></Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
                {sim.lines.length > simShown && (
                  <Group justify="center" my="xs">
                    <Button size="xs" variant="light" onClick={() => setSimShown((n) => n + 100)}>
                      Mostrar 100 más (se ven {simShown} de {sim.lines.length})
                    </Button>
                  </Group>
                )}
              </ScrollArea>
              );
              const chatBox = (
                <Stack gap={4} mt={6} data-testid="po-instrucciones">
                  {chatLog.length > 0 && (
                    <Stack gap={2} style={{ maxHeight: 96, overflowY: 'auto' }}>
                      {chatLog.map((c, k) => (
                        <Text key={k} size="xs" c={c.who === 'sistema' ? 'dimmed' : undefined}>
                          <b>{c.who === 'usuario' ? 'Usted' : c.who === 'agente' ? (agent?.displayName ?? 'Agente') : 'Formulario'}:</b> {c.text}
                        </Text>
                      ))}
                    </Stack>
                  )}
                  <Group gap={6} wrap="nowrap" align="flex-end">
                    <Textarea
                      style={{ flex: 1 }} autosize minRows={1} maxRows={3} aria-label="Instrucción para las líneas" value={chatText} disabled={Boolean(chatBusy)}
                      placeholder="Indique cambios: la línea 2 es PTCZ0111; quita la línea 3; las cantidades vienen en cajas de 10"
                      onChange={(e) => setChatText(e.currentTarget.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendInstruction(); } }}
                    />
                    <Tooltip label="Aplicar la instrucción (las que no son comandos simples las resuelve su agente)" withinPortal zIndex={1400} multiline w={260}>
                      <Button color="indigo" variant="light" onClick={() => void sendInstruction()} loading={Boolean(chatBusy)} disabled={!chatText.trim()} aria-label="Aplicar instrucción" leftSection={<IconSend size={14} />}>Aplicar</Button>
                    </Tooltip>
                    {undoStack.length > 0 && (
                      <Tooltip label="Deshacer el último cambio (también olvida lo que aprendió)" withinPortal zIndex={1400}>
                        <Button variant="default" onClick={() => void undo()} disabled={Boolean(chatBusy)} aria-label="Deshacer" leftSection={<IconArrowBackUp size={14} />}>Deshacer</Button>
                      </Tooltip>
                    )}
                  </Group>
                  {chatBusy && <Text size="xs" c="dimmed">{chatBusy}</Text>}
                </Stack>
              );
              const left = <>{linesTable}{chatBox}</>;
              const viewer = hasDoc && docFile && docUrl ? <PoDocumentViewer file={docFile} url={docUrl} passive={dragging} /> : null;
              if (!viewer) return left;
              if (isWide) {
                return (
                  <div ref={splitRef} style={{ flex: 1, minHeight: 200, display: 'flex', userSelect: dragging ? 'none' : undefined }}>
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>{left}</div>
                    {showDoc && (
                      <>
                        <div role="separator" aria-orientation="vertical" aria-label="Cambiar el ancho del documento" title="Arrastre para cambiar el ancho"
                          onPointerDown={startDrag} onDoubleClick={() => setDocPct(42)}
                          style={{ width: 12, flexShrink: 0, cursor: 'col-resize', display: 'flex', justifyContent: 'center', touchAction: 'none' }}>
                          <div style={{ width: 3, borderRadius: 2, background: dragging ? 'var(--mantine-color-violet-filled)' : 'var(--mantine-color-default-border)' }} />
                        </div>
                        <div style={{ width: `${docPct}%`, flexShrink: 0, minWidth: 0, display: 'flex', flexDirection: 'column' }}>{viewer}</div>
                      </>
                    )}
                  </div>
                );
              }
              return (
                <div style={{ flex: 1, minHeight: 300, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <Tabs value={mobileTab} onChange={setMobileTab} keepMounted={false}>
                    <Tabs.List grow>
                      <Tabs.Tab value="lineas">Líneas</Tabs.Tab>
                      <Tabs.Tab value="documento" leftSection={<IconFileText size={14} />}>Documento</Tabs.Tab>
                    </Tabs.List>
                  </Tabs>
                  {mobileTab === 'documento' ? <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>{viewer}</div> : left}
                </div>
              );
            })()}
            <Group justify="flex-end">
              <Text fw={700}>
                Total del documento (antes de impuestos): {money(sim.lines.filter((l) => l.include).reduce((a, l) => a + Number(l.Quantity ?? 0) * Number(l.UnitPrice ?? 0), 0))}
              </Text>
            </Group>
            <Group justify="space-between">
              {(() => {
                const blockingIndexes = blockingLines(sim.lines);
                const lowIndexes = lowConfidenceIndexes(sim.lines);
                return (
                  <Stack gap={2}>
                    {blockingIndexes > 0 ? (
                      <Text size="xs" c="orange" fw={600}>Faltan {blockingIndexes} línea(s) sin artículo: elija el artículo o desmárquelas.</Text>
                    ) : (
                      <Text size="xs" c="dimmed">Desmarque las líneas que no correspondan. Confianza Alta: código de barras, código o catálogo del cliente, o historial claro.</Text>
                    )}
                    {lowIndexes.length > 0 && (
                      <Group gap={6}>
                        <Text size="xs" c="red">{lowIndexes.length} {lowIndexes.length === 1 ? 'línea' : 'líneas'} con confianza Baja: revíselas.</Text>
                        <Button size="compact-xs" variant="subtle" color="red" onClick={() => jumpToLow(lowIndexes)}>Ir a la siguiente</Button>
                      </Group>
                    )}
                  </Stack>
                );
              })()}
              <Group gap="xs">
                <Button variant="default" onClick={() => { setSim(null); setDocFile(null); setChatLog([]); setUndoStack([]); setPhase('idle'); }}>Cancelar</Button>
                <Button color="violet" disabled={!canApply(sim.lines)} onClick={apply}>
                  Agregar a la oferta ({sim.lines.filter((l) => l.include).length})
                </Button>
              </Group>
            </Group>
          </Stack>
        )}
      </Modal>
      {ordersFor !== undefined && sim && (
        <CustomerOrdersModal
          opened
          onClose={() => setOrdersFor(undefined)}
          companyId={companyId}
          cardCode={sim.customer.CardCode}
          customerName={sim.customer.CardName}
          poLines={poLineRefs}
          forLine={ordersFor}
          onUse={(i, code) => { setOrdersFor(undefined); void chooseSearched(i, { ItemCode: code }, 'Elegido de un pedido anterior del cliente'); }}
        />
      )}
      {pickFor != null && sim && (
        <SalesSearchModal
          opened
          onClose={() => setPickFor(null)}
          companyId={companyId}
          kind="item"
          cardCode={sim.customer.CardCode}
          initialQuery={String(matchOf(sim.lines[pickFor])?.source.description ?? '').split(/\s+/).slice(0, 1).join(' ')}
          zIndex={1400}
          onSelect={(row) => { const i = pickFor; setPickFor(null); void chooseSearched(i, row); }}
        />
      )}
    </>
  );
}
