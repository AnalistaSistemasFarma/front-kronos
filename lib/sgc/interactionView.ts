/**
 * PRESENTACIÓN del historial de interacciones de una solicitud documental.
 *
 * Lo guardado en sgc.interaction es de solo inserción y es evidencia de
 * validación: aquí NO se cambia ni se descarta nada. Solo se decide cómo se
 * lee: quién, qué hizo, cuándo y la observación que escribió la persona. Los
 * detalles técnicos (huellas, códigos internos, correos crudos) quedan en
 * `details` para mostrarse detrás de «Ver detalle», y el texto original
 * completo va siempre en `raw`.
 *
 * Archivo puro (sin BD ni React) para poder probarlo.
 */

export interface SgcInteractionInput {
  id: string;
  kind: string;
  authorEmail: string;
  author: string | null;
  body: string;
  createdAt: string;
}

export interface SgcInteractionView {
  id: string;
  authorEmail: string;
  /** Quién (nombre; «Sistema» para el programador). */
  who: string;
  /** Qué hizo, en minúscula inicial para leerse después del nombre. */
  action: string;
  /** Lo que escribió la persona (observaciones, motivo, justificación, nota). */
  observation: string | null;
  /** Dato complementario corto y humano (p. ej. «V2 vigente desde …»). */
  note: string | null;
  /** Detalles técnicos para «Ver detalle». */
  details: string[];
  /** Evento que genera el sistema sin que nadie escriba nada. */
  automatic: boolean;
  /** Cuántos eventos automáticos iguales y seguidos agrupa esta entrada. */
  count: number;
  /** Fechas de todos los eventos agrupados (la primera es la de la entrada). */
  createdAt: string;
  groupedDates: string[];
  /** Texto original completo, tal como quedó guardado. */
  raw: string;
}

export const SGC_SYSTEM_ACTOR_EMAIL = 'sistema.sgc@synerlink';

const OBSERVATION = /^(Observaciones|Comentario|Motivo|Justificación):\s*([\s\S]*)$/;
const TECHNICAL = /SHA-256|^Contenido firmado:|^Punto de firma:|^Firmas en el manifiesto:/;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

type NameOf = (email: string) => string;

function lowerFirst(s: string): string {
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

function names(list: string, nameOf: NameOf): string {
  return list.replace(EMAIL, (e) => nameOf(e));
}

function pool(code: string): string {
  return `el grupo ${code.toLowerCase().replace(/_/g, ' ')}`;
}

/** Significado de firma («Revisó») a partir de «Revisó (firmado electrónicamente)». */
function meaningOf(signText: string): string {
  return signText.replace(/\s*\(.*$/, '').trim();
}

const DECISION_VERBS = ['Envió el documento', 'Aprobó', 'Devolvió a elaboración', 'Leyó el documento hasta el final y firmó «Leído»', 'Cerró la capacitación'];

/** «Aprobó en «Revisión» como integrante del grupo X.» → partes (sin regex con cuantificadores anidados). */
function parseDecision(first: string): { verb: string; task: string; group: string | null } | null {
  const verb = DECISION_VERBS.find((v) => first.startsWith(`${v} en «`));
  if (!verb || !first.endsWith('.')) return null;
  const rest = first.slice(`${verb} en «`.length, -1);
  const close = rest.indexOf('»');
  if (close < 0) return null;
  const tail = rest.slice(close + 1);
  if (tail && !tail.startsWith(' como integrante del grupo ')) return null;
  return { verb, task: rest.slice(0, close), group: tail ? tail.slice(' como integrante del grupo '.length) : null };
}

/** «Tarea «X» (ronda 2) asignada a: a, b · firma en orden.» → partes. */
function parseAssigned(first: string): { task: string; round: string | null; list: string; mode: string | null } | null {
  if (!first.startsWith('Tarea «') || !first.endsWith('.')) return null;
  const close = first.indexOf('»');
  const marker = first.indexOf(' asignada a: ', close);
  if (close < 0 || marker < 0) return null;
  const between = first.slice(close + 1, marker);
  const round = between.match(/^ \(ronda (\d+)\)$/)?.[1] ?? null;
  if (between && !round) return null;
  let list = first.slice(marker + ' asignada a: '.length, -1);
  let mode: string | null = null;
  for (const m of ['en orden', 'en paralelo']) {
    if (list.endsWith(` · firma ${m}`)) {
      mode = m;
      list = list.slice(0, -` · firma ${m}`.length);
    }
  }
  return { task: first.slice('Tarea «'.length, close), round, list, mode };
}

interface Parsed {
  action: string;
  note?: string | null;
  details?: string[];
  automatic?: boolean;
  /** Líneas ya consumidas por el patrón (no van a observación ni detalle). */
  consumed?: number[];
}

/** Interpreta la primera línea (y las que le correspondan) según su patrón. */
function parse(kind: string, lines: string[], nameOf: NameOf): Parsed {
  const first = lines[0] ?? '';
  let m: RegExpMatchArray | null;

  if (kind === 'nota') return { action: 'agregó una nota', consumed: [] };

  const assigned = parseAssigned(first);
  if (assigned) {
    const who = assigned.list
      .split(', ')
      .map((p) => (p.startsWith('grupo ') ? pool(p.slice(6)) : nameOf(p)))
      .join(', ');
    return {
      action: `«${assigned.task}» quedó asignada a ${who}`,
      note: [assigned.round ? `Ronda ${assigned.round}` : null, assigned.mode ? `Firma ${assigned.mode}` : null].filter(Boolean).join(' · ') || null,
      automatic: true,
    };
  }

  if ((m = first.match(/^Solicitud documental creada \((.+)\)\. Flujo «(.+)» versión (\d+)\.$/))) {
    return { action: `creó la solicitud (${lowerFirst(m[1])})`, details: [`Flujo «${m[2]}», versión ${m[3]}.`] };
  }

  const decided = parseDecision(first);
  if (decided) {
    const { verb, task, group } = decided;
    const consumed: number[] = [];
    let signed: string | null = null;
    let signReason: string | null = null;
    const extra: string[] = [];
    lines.forEach((l, i) => {
      if (i === 0) return;
      const s = l.match(/^Firma electrónica: (.+?)\. Motivo: ([\s\S]*)$/);
      if (s) {
        signed = meaningOf(s[1]);
        signReason = s[2].trim();
        consumed.push(i);
        return;
      }
      const c = l.match(/^Lista de chequeo de Calidad: (.+)\.$/);
      if (c) {
        extra.push(`Lista de chequeo: ${c[1]}`);
        consumed.push(i);
      }
    });
    const base =
      verb === 'Envió el documento'
        ? `envió el documento desde «${task}»`
        : verb === 'Aprobó'
          ? `aprobó «${task}»`
          : verb === 'Devolvió a elaboración'
            ? `devolvió el documento a elaboración desde «${task}»`
            : verb === 'Cerró la capacitación'
              ? 'cerró la capacitación'
              : 'leyó el documento completo';
    const sign = signed && !/Leído/.test(verb) ? ` y firmó como «${signed}»` : /Leído/.test(verb) ? ' y firmó «Leído»' : '';
    const details = group ? [`Como integrante de ${pool(group)}.`] : [];
    return {
      action: `${base}${sign}`,
      note: [extra.join(' · ') || null, signReason ? `Motivo de la firma: ${signReason}` : null].filter(Boolean).join('\n') || null,
      details,
      consumed,
    };
  }

  if ((m = first.match(/^Solicitud cerrada: (.+)\.$/))) {
    const vig = lines[1]?.match(/^(\S+) V(\d+) VIGENTE desde (\S+); próxima revisión ([^.]+)\./);
    const obs = lines[1]?.match(/La V(\d+) queda OBSOLETA\./);
    return {
      action: `cerró la solicitud (${lowerFirst(m[1])})`,
      note: vig ? `${vig[1]} V${vig[2]} vigente desde ${vig[3]}; próxima revisión ${vig[4]}.${obs ? ` La V${obs[1]} queda obsoleta.` : ''}` : null,
      automatic: true,
      consumed: vig ? [1] : [],
    };
  }

  if ((m = first.match(/^Reasignó «(.+)» de (\S+) a (\S+)\.$/))) {
    return { action: `reasignó «${m[1]}» de ${nameOf(m[2])} a ${nameOf(m[3])}` };
  }

  if (/^Canceló la solicitud\.$/.test(first)) {
    const annul = lines.findIndex((l, i) => i > 0 && /quedó ANULADA/.test(l));
    return {
      action: 'canceló la solicitud',
      note: annul > 0 ? lines[annul].replace('ANULADA', 'anulada') : null,
      consumed: annul > 0 ? [annul] : [],
    };
  }

  if ((m = first.match(/^Excluyó la lectura de (\S+)\.$/))) {
    return { action: `excluyó la lectura de ${nameOf(m[1])}` };
  }

  if ((m = first.match(/^Divulgación cerrada por Aseguramiento de Calidad: (\d+) lectura\(s\) firmada\(s\), (\d+) pendiente\(s\) excluida\(s\)\.$/))) {
    return { action: `cerró la divulgación: ${m[1]} lectura(s) firmada(s), ${m[2]} pendiente(s) excluida(s)` };
  }

  if ((m = first.match(/^Adjuntó (el borrador|un soporte): (.+)\.$/))) {
    return { action: `adjuntó ${m[1]} «${m[2]}»` };
  }

  if ((m = first.match(/^Retiró el adjunto (.+) \(no se borra: queda en el historial\)\.$/))) {
    return { action: `retiró el adjunto «${m[1]}»`, details: ['El archivo no se borra: queda en el historial.'] };
  }

  if ((m = first.match(/^Guardó la revisión (\d+) del borrador en el editor de la app(?:: ([\s\S]+)|\.)$/))) {
    return { action: `guardó la revisión ${m[1]} del borrador`, note: m[2]?.trim() || null };
  }

  if ((m = first.match(/^No se pudo generar el PDF controlado: (.+)$/))) {
    return { action: 'no pudo generar el PDF controlado', note: `${m[1]} ${lines.slice(1).join(' ')}`.trim(), automatic: true, consumed: lines.map((_, i) => i).slice(1) };
  }

  if ((m = first.match(/^PDF controlado generado: (\S+ V\d+) \((.+)\)\.$/))) {
    return { action: `generó el PDF controlado ${m[1]}`, note: lowerFirst(m[2]).replace(/^./, (c) => c.toUpperCase()) + '.', automatic: true };
  }

  if ((m = first.match(/^(Registró|Actualizó) la capacitación: (.+?) \((.+?)\)\. (.+)$/))) {
    return { action: `${lowerFirst(m[1])} la capacitación «${m[2]}»`, note: `${m[3]}. ${m[4]}` };
  }

  if ((m = first.match(/^Cargó los resultados de la capacitación: (.+?) \(SHA-256 (\w+)\)\.$/))) {
    const sum = lines[1]?.match(/(\d+) aprobaron, (\d+) reprobaron y (\d+) sin resultado/);
    return {
      action: `cargó los resultados de la capacitación «${m[1]}»`,
      note: sum ? `${sum[1]} aprobaron, ${sum[2]} reprobaron, ${sum[3]} sin resultado.` : null,
      details: [`SHA-256 del archivo: ${m[2]}`, ...lines.slice(1)],
      consumed: lines.map((_, i) => i).slice(1),
    };
  }

  if ((m = first.match(/^Recordatorio automático de lectura \(cada (\d+) días\) a (\d+) persona\(s\): (.+)\.$/))) {
    return { action: `envió un recordatorio automático de lectura a ${m[2]} persona(s)`, details: [`Cada ${m[1]} días.`, `Destinatarios: ${names(m[3], nameOf)}.`], automatic: true };
  }

  if ((m = first.match(/^Envió recordatorio de lectura a (\d+) persona\(s\): (.+)\.$/))) {
    return { action: `envió un recordatorio de lectura a ${m[1]} persona(s)`, details: [`Destinatarios: ${names(m[2], nameOf)}.`] };
  }

  if ((m = first.match(/^Divulgación iniciada: (\d+) persona\(s\) deben leer el documento hasta el final y firmar «Leyó»\.$/))) {
    const rest = lines.slice(1).map((l) => names(l.replace(/ al SGC/g, ''), nameOf));
    return { action: `inició la divulgación: ${m[1]} persona(s) deben leer y firmar`, note: rest.join('\n') || null, automatic: true, consumed: lines.map((_, i) => i).slice(1) };
  }

  if ((m = first.match(/^Agregó al alcance de divulgación: (Toda la empresa|Departamento|Cargo|Persona) ?(.*?)\.(.*)$/))) {
    const what = m[1] === 'Toda la empresa' ? 'toda la empresa' : m[1] === 'Persona' && m[2] ? nameOf(m[2]) : `un ${m[1].toLowerCase()}`;
    const extra = m[3].trim();
    const nuevos = extra.match(/Nuevos lectores: (\d+)\./);
    return {
      action: `agregó ${what} al alcance de divulgación`,
      note: nuevos ? `Nuevos lectores: ${nuevos[1]}.` : null,
      details: [first],
    };
  }

  if ((m = first.match(/^Retiró del alcance de divulgación: (.+)\.$/))) {
    return { action: 'retiró un grupo del alcance de divulgación', details: [`Alcance: ${names(m[1], nameOf)}`] };
  }

  if ((m = first.match(/^La solicitud llegó a «(.+)»\./))) {
    return { action: `la solicitud quedó en espera en «${m[1]}»`, automatic: true };
  }

  if ((m = first.match(/^(Asignó|Cambió) los firmantes de «(.+)»\.$/))) {
    const consumed: number[] = [];
    const add: string[] = [];
    const remove: string[] = [];
    let mode: string | null = null;
    const details: string[] = [];
    lines.forEach((l, i) => {
      if (i === 0) return;
      let s: RegExpMatchArray | null;
      if ((s = l.match(/^\+ (\S+) \(orden (\d+)\)$/))) {
        add.push(nameOf(s[1]));
        details.push(`Agregó a ${nameOf(s[1])} (orden ${s[2]}).`);
        consumed.push(i);
      } else if ((s = l.match(/^− (\S+)$/))) {
        remove.push(nameOf(s[1]));
        consumed.push(i);
      } else if ((s = l.match(/^↕ (\S+) → orden (\d+)$/))) {
        details.push(`Cambió el orden de ${nameOf(s[1])} a ${s[2]}.`);
        consumed.push(i);
      } else if ((s = l.match(/^Modo de firma: (.+)$/))) {
        mode = s[1];
        consumed.push(i);
      }
    });
    const parts = [add.length ? `agregó a ${add.join(', ')}` : null, remove.length ? `quitó a ${remove.join(', ')}` : null].filter(Boolean);
    return {
      action: `${lowerFirst(m[1])} los firmantes de «${m[2]}»${parts.length ? `: ${parts.join('; ')}` : ''}`,
      note: mode ? `Firma ${mode}.` : null,
      details,
      consumed,
    };
  }

  return { action: lowerFirst(first) };
}

/** Una interacción, tal como se lee en pantalla. */
export function presentInteraction(item: SgcInteractionInput, nameOf: NameOf): SgcInteractionView {
  const lines = item.body.split('\n').map((l) => l.trimEnd());
  const p = parse(item.kind, lines, nameOf);
  const consumed = new Set(p.consumed ?? []);
  const observations: string[] = [];
  const details: string[] = [...(p.details ?? [])];
  const notes: string[] = p.note ? [p.note] : [];

  if (item.kind === 'nota') {
    observations.push(item.body.trim());
  } else {
    lines.forEach((l, i) => {
      if (i === 0 || consumed.has(i) || !l.trim()) return;
      const o = l.match(OBSERVATION);
      if (o) observations.push(o[2].trim());
      else if (TECHNICAL.test(l)) details.push(l);
      else notes.push(names(l, nameOf));
    });
  }

  const isSystem = item.authorEmail.toLowerCase() === SGC_SYSTEM_ACTOR_EMAIL;
  return {
    id: item.id,
    authorEmail: item.authorEmail,
    who: isSystem ? 'Sistema' : item.author || item.authorEmail,
    action: p.action,
    observation: observations.join('\n') || null,
    note: notes.join('\n') || null,
    details: [...new Set(details)],
    automatic: !!p.automatic || item.kind === 'sistema' || isSystem,
    count: 1,
    createdAt: item.createdAt,
    groupedDates: [item.createdAt],
    raw: item.body,
  };
}

const SAME_WINDOW_MS = 60_000;

/**
 * El historial completo para mostrar: agrupa los eventos automáticos iguales
 * y seguidos, y quita la repetición exacta de una misma acción de la misma
 * persona en el mismo minuto. Ningún registro se pierde: lo agrupado queda en
 * `count` y `groupedDates`, y el texto original en `raw`.
 */
export function presentInteractions(items: SgcInteractionInput[], nameOf: NameOf): SgcInteractionView[] {
  const out: SgcInteractionView[] = [];
  for (const item of items) {
    const v = presentInteraction(item, nameOf);
    const prev = out[out.length - 1];
    const sameText = prev && prev.authorEmail.toLowerCase() === v.authorEmail.toLowerCase() && prev.action === v.action && prev.observation === v.observation;
    const close = prev && Math.abs(new Date(v.createdAt).getTime() - new Date(prev.groupedDates[prev.groupedDates.length - 1]).getTime()) <= SAME_WINDOW_MS;
    if (prev && sameText && (v.automatic || close)) {
      prev.count += 1;
      prev.groupedDates.push(v.createdAt);
      prev.details = [...new Set([...prev.details, ...v.details])];
      if (v.raw !== prev.raw) prev.raw = `${prev.raw}\n—\n${v.raw}`;
      continue;
    }
    out.push(v);
  }
  return out;
}
