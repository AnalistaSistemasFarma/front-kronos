'use client';

import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Checkbox, Group, Menu, Modal, Progress, ScrollArea, Stack, Table, Text, Tooltip } from '@mantine/core';
import { IconAlertCircle, IconCircleCheck, IconLoader2, IconRobot, IconSparkles } from '@tabler/icons-react';
import toast from 'react-hot-toast';
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
type ChatAgent = { idAgent: number; code: string; displayName: string; companies: { idCompany: number }[] };
/** Espera máxima de la respuesta del agente: si está ocupado en otra conversación hace fila, así que no se falla pronto. */
const AGENT_TIMEOUT_MS = 30 * 60 * 1000;
/** Desde aquí, si el agente no está trabajando en la OC, se avisa que parece ocupado y que se puede cerrar la ventana. */
const AGENT_BUSY_HINT_MS = 2 * 60 * 1000;
/** A long answer arrives split in several chat messages: wait this long for the missing parts before giving up. */
const AGENT_PARTS_GRACE_MS = 45 * 1000;
type ReplyMessage = { id: number; role: string; body: string; attachments?: { fileName: string; contentType: string | null; downloadUrl: string }[] };
const money = (v: unknown) => (v == null || v === '' ? '—' : `$ ${Number(v).toLocaleString('es-CO')}`);

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

export default function SalesPdfImport({ companyId, companyName, cardCode, onLoaded }: Props) {
  const [support, setSupport] = useState<Support>('checking');
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  /** Simulación: lo que se montaría, antes de agregarlo a la oferta (Nicolás Rivera, 2026-11-09). */
  const [sim, setSim] = useState<(Omit<PdfOffer, 'lines'> & { lines: (Line & { include: boolean })[] }) | null>(null);
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
        const delaEmpresa = (a: ChatAgent) => a.companies?.some((c) => String(c.idCompany) === String(companyId));
        setAgents([...((d.agents ?? []) as ChatAgent[])].sort((x, y) => Number(delaEmpresa(y)) - Number(delaEmpresa(x))));
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
  const resolveAndSimulate = async (r: PdfOrderResult, avisosPrevios: string[]) => {
      if (!r.lineas.length) throw new Error('No se encontraron líneas de productos en el PDF. Revise el archivo o use el cargue desde Excel.');
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
      setSim({
        customer: d.customer, lines: (d.lines as Line[]).map((l) => ({ ...l, include: true })), numeroOrdenCompra: r.numeroOrdenCompra,
        fechaEntrega: r.fechaEntrega, avisos: [...avisosPrevios, ...(d.avisos ?? [])], leidas: r.lineas.length,
      });
      setPhase('simulacion');
  };

  /**
   * «Montar con agente»: le envía la OC al agente asignado por el chat de SynerLink (su conversación directa, con
   * los mismos permisos del chat), espera su respuesta en JSON y sigue igual que con la IA del navegador.
   */
  const analyzeWithAgent = async (file: File | null, a: ChatAgent | null) => {
    if (!file || !a) return;
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
      const avisos = descartadas > 0 ? [`${a.displayName} leyó ${leidas} líneas; ${descartadas} se descartaron por no tener cantidad válida o descripción/código.`] : [];
      await resolveAndSimulate(r, avisos);
    } catch (e) {
      setLive(null);
      setError((e as Error).message);
      setPhase('error');
    }
  };

  const working = phase !== 'idle' && phase !== 'error' && phase !== 'simulacion';

  /** Agrega a la oferta lo simulado (solo las líneas marcadas). */
  const apply = () => {
    if (!sim) return;
    const lines = sim.lines.filter((l) => l.include).map(({ include: _i, ...l }) => l);
    if (!lines.length) return;
    onLoaded({ ...sim, lines });
    setSim(null);
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

      <Modal opened={phase !== 'idle' && !(phase === 'agente' && minimized)} onClose={() => (phase === 'agente' ? setMinimized(true) : !working && setPhase('idle'))} size={phase === 'simulacion' ? 'xl' : 'md'} title={<Group gap={6}><IconSparkles size={18} /><Text fw={700}>{agent && (phase === 'agente' || conversationId) ? `Oferta desde el PDF (con ${agent.displayName})` : 'Oferta desde el PDF (IA local)'}</Text></Group>}
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
          <Stack gap="sm">
            <Text size="sm" c="dimmed">Simulación: así quedaría la oferta con lo que la IA leyó del PDF. Nada se agrega hasta que confirme.</Text>
            <Group gap="lg" wrap="wrap">
              <Text size="sm"><Text span c="dimmed">Cliente: </Text><b>{sim.customer.CardName}</b> ({sim.customer.CardCode})</Text>
              <Text size="sm"><Text span c="dimmed">OC: </Text>{sim.numeroOrdenCompra || '—'}</Text>
              <Text size="sm"><Text span c="dimmed">Entrega: </Text>{sim.fechaEntrega || '— (indíquela)'}</Text>
              <Text size="sm"><Text span c="dimmed">Líneas: </Text>{sim.lines.length}{sim.leidas && sim.leidas !== sim.lines.length ? ` de ${sim.leidas} leídas en el PDF` : ''}</Text>
            </Group>
            {sim.avisos.length > 0 && <Alert color="orange" variant="light">{sim.avisos.map((a, i) => <Text key={i} size="xs">{a}</Text>)}</Alert>}
            <ScrollArea.Autosize mah={420}>
              <Table striped withTableBorder verticalSpacing={4}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th><Checkbox checked={sim.lines.every((l) => l.include)} indeterminate={sim.lines.some((l) => l.include) && !sim.lines.every((l) => l.include)}
                      onChange={(e) => { const c = e.currentTarget.checked; setSim({ ...sim, lines: sim.lines.map((l) => ({ ...l, include: c })) }); }} /></Table.Th>
                    <Table.Th title="Renglón de la OC">#</Table.Th><Table.Th>Artículo en SAP</Table.Th><Table.Th style={{ textAlign: 'right' }}>Cantidad</Table.Th>
                    <Table.Th style={{ textAlign: 'right' }}>Precio OC</Table.Th><Table.Th style={{ textAlign: 'right' }}>Precio lista</Table.Th>
                    <Table.Th style={{ textAlign: 'right' }}>Total línea</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {sim.lines.map((l, i) => (
                    <Table.Tr key={i}>
                      <Table.Td><Checkbox checked={l.include} onChange={(e) => { const c = e.currentTarget.checked; setSim({ ...sim, lines: sim.lines.map((x, j) => (j === i ? { ...x, include: c } : x)) }); }} /></Table.Td>
                      <Table.Td><Text size="xs" c="dimmed">{String(l.row ?? i + 1)}</Text></Table.Td>
                      <Table.Td>
                        <Text size="sm">{String(l.ItemCode)} · {String(l.ItemDescription ?? '')}</Text>
                        {l.aiNote ? <Badge size="xs" variant="light" color={String(l.aiNote).startsWith('Revisar') ? 'orange' : 'violet'} style={{ whiteSpace: 'normal', height: 'auto' }}>✨ {String(l.aiNote)}</Badge> : null}
                      </Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>{Number(l.Quantity).toLocaleString('es-CO')}</Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>{money(l.UnitPrice)}</Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>{money(l.ListPrice)}</Table.Td>
                      <Table.Td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}><Text size="sm" fw={500} c={l.include ? undefined : 'dimmed'}>{money(Number(l.Quantity ?? 0) * Number(l.UnitPrice ?? 0))}</Text></Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea.Autosize>
            <Group justify="flex-end">
              <Text fw={700}>
                Total del documento (antes de impuestos): {money(sim.lines.filter((l) => l.include).reduce((a, l) => a + Number(l.Quantity ?? 0) * Number(l.UnitPrice ?? 0), 0))}
              </Text>
            </Group>
            <Group justify="space-between">
              <Text size="xs" c="dimmed">Desmarque las líneas que no correspondan. Lo marcado «Revisar» se eligió por la descripción.</Text>
              <Group gap="xs">
                <Button variant="default" onClick={() => { setSim(null); setPhase('idle'); }}>Cancelar</Button>
                <Button color="violet" disabled={!sim.lines.some((l) => l.include)} onClick={apply}>
                  Agregar a la oferta ({sim.lines.filter((l) => l.include).length})
                </Button>
              </Group>
            </Group>
          </Stack>
        )}
      </Modal>
    </>
  );
}
