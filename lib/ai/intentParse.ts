// Detección de intención y extracción de campos desde el mensaje del usuario.

export type AssistantIntentKind = 'ticket' | 'request' | 'unknown';

export interface ParsedUserIntent {
  kind: AssistantIntentKind;
  subject: string;
  description: string;
  assigneeName: string | null;
  companyHint: string | null;
  wantsCreate: boolean;
}

function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** “caso/ticket” → Help Desk; “solicitud” (sin caso) → request-general. */
export function detectIntentKind(message: string): AssistantIntentKind {
  const m = message.toLowerCase();
  const ticketHint =
    /\b(caso|casos|ticket|tickets|help\s*desk|mesa de ayuda|incidente)\b/.test(m) ||
    /\b(chatbot|soporte\s+ti|soporte\s+tecnico)\b/.test(m);
  const requestHint =
    /\b(solicitud|solicitudes|pago|tesorer[ií]a|legalizar|tarjeta|anticipo|reembolso)\b/.test(
      m,
    );

  if (ticketHint && !/\bsolicitud(es)?\s+(de\s+)?pago\b/.test(m)) {
    return 'ticket';
  }
  if (requestHint) return 'request';
  if (/\b(crear|crea|abre|montar|necesito)\b/.test(m)) {
    // “necesito crear…” sin tipar: si dice caso→ticket; si no, desconocido
    if (/\bcaso\b/.test(m)) return 'ticket';
  }
  return 'unknown';
}

export function wantsCreateAction(message: string): boolean {
  if (parseResolveIntent(message)) return false;
  const m = message.toLowerCase();
  return (
    /\b(crea|crear|abre|abrir|genera|montar|montame|necesito|quiero)\b/.test(m) &&
    /\b(solicitud|caso|ticket|requerimiento|incidente)\b/.test(m)
  );
}

export type ResolveIntentKind = 'resolve' | 'cancel' | 'return';

export interface ParsedResolveIntent {
  requestId: number;
  kind: ResolveIntentKind;
  resolution: string;
  sendEmail: boolean;
}

/** “pon la #2079 en resuelto y diga solucionado” */
export function parseResolveIntent(message: string): ParsedResolveIntent | null {
  const m = clean(message);
  const lower = m.toLowerCase();

  const idMatch =
    m.match(
      /solicitud\s*#?\s*(\d{1,10})|#\s*(\d{1,10})|\b(?:req|id)\s*[:=]?\s*(\d{1,10})\b/i,
    ) || m.match(/\b(\d{3,10})\b/);
  if (!idMatch) return null;

  const requestId = Number(idMatch[1] || idMatch[2] || idMatch[3] || idMatch[0]);
  if (!Number.isFinite(requestId) || requestId <= 0) return null;

  const isCancel = /\b(cancel|anul)/i.test(lower);
  const isReturn = /\b(devolver|devuelv|retorn)/i.test(lower);
  const isResolve =
    /\b(resolv|resuelto|cerrar|cierra|cierro|finaliz|solucionad|marcar\s+como\s+resuelt)/i.test(
      lower,
    );

  if (!isCancel && !isReturn && !isResolve) return null;
  // Evitar confundir “crear solicitud” con resolver
  if (/\b(crear|crea|montar)\b/i.test(lower) && !isResolve && !isCancel) {
    return null;
  }

  let kind: ResolveIntentKind = 'resolve';
  if (isCancel) kind = 'cancel';
  else if (isReturn) kind = 'return';

  let resolution = '';
  const diga = m.match(
    /(?:diga|dice|diga\s+que|mensaje|resoluci[oó]n|porque|por\s+que|con\s+texto|texto)[:\s,]+(.+)$/i,
  );
  if (diga?.[1]) {
    resolution = clean(diga[1]).replace(/^["'“”]+|["'“”]+$/g, '');
  } else {
    const colon = m.match(/:\s*(.+)$/);
    if (colon?.[1] && !/^\d+$/.test(colon[1].trim())) {
      resolution = clean(colon[1]);
    }
  }

  if (!resolution) {
    resolution =
      kind === 'resolve'
        ? 'Solucionado'
        : kind === 'cancel'
          ? 'Cancelado'
          : 'Devuelto';
  }

  // Por defecto notificar por correo (el usuario lo pidió explícitamente).
  const sendEmail =
    !/\b(sin\s+correo|no\s+(?:envie|env[ií]es|notifiques)|no\s+notificar)\b/i.test(
      lower,
    );

  return {
    requestId,
    kind,
    resolution: resolution.slice(0, 255),
    sendEmail,
  };
}


export function extractAssigneeName(message: string): string | null {
  const patterns = [
    /asignad[oa]\s+a\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ\s.]{1,60})/i,
    /asign(?:e|ar|arlo|arla)?\s+a\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ\s.]{1,60})/i,
    /que\s+se\s+asign(?:e|en)\s+a\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ\s.]{1,60})/i,
    /para\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ\s.]{1,40})\s*$/i,
  ];
  for (const re of patterns) {
    const match = message.match(re);
    if (match?.[1]) {
      let name = clean(match[1]);
      name = name.replace(/[.,;:]+$/, '').trim();
      name = name.split(/\s+y\s+|\s+para\s+/i)[0]?.trim() ?? name;
      if (name.length >= 3) return name;
    }
  }
  return null;
}

export function extractSubject(message: string, kind: AssistantIntentKind): string {
  const m = clean(message);

  // “diga/diga que/que diga …”
  const diga = m.match(
    /(?:el\s+cual\s+)?diga(?:\s+que)?[,:]?\s+(.+?)(?:\s+y\s+que\s+se\s+asigne|\s+asignad|\s*$)/i,
  );
  if (diga?.[1]) {
    const s = clean(diga[1]);
    if (s.length >= 4) return s.slice(0, 120);
  }

  // “ayuda para mi chatbot”
  const ayuda = m.match(/necesito\s+ayuda\s+para\s+(.+?)(?:\s+y\s+|,|$)/i);
  if (ayuda?.[1]) {
    return `Ayuda para ${clean(ayuda[1])}`.slice(0, 120);
  }

  const de = m.match(
    /(?:solicitud|caso|ticket)\s+(?:de\s+|sobre\s+|para\s+)?(.+?)(?:\s+y\s+que|\s+asignad|$)/i,
  );
  if (de?.[1]) {
    const s = clean(de[1]);
    if (s.length >= 4 && !/^el\s+cual/i.test(s)) return s.slice(0, 120);
  }

  if (kind === 'ticket') return 'Caso de soporte';
  if (kind === 'request') return 'Nueva solicitud';
  return 'Nuevo registro';
}

export function extractDescription(message: string): string {
  const d = clean(message);
  if (d.length >= 10) return d.slice(0, 1000);
  return `Detalle: ${d}`.slice(0, 1000);
}

export function extractCompanyHint(message: string): string | null {
  const m = message.match(
    /\b(onelatampharma|onelatam|farmalogica|farmal[oó]gica|gss)\b/i,
  );
  return m?.[1] ? clean(m[1]) : null;
}

export function parseUserIntent(message: string): ParsedUserIntent {
  if (parseResolveIntent(message)) {
    return {
      kind: 'unknown',
      subject: '',
      description: message,
      assigneeName: null,
      companyHint: null,
      wantsCreate: false,
    };
  }
  const kind = detectIntentKind(message);
  return {
    kind,
    subject: extractSubject(message, kind),
    description: extractDescription(message),
    assigneeName: extractAssigneeName(message),
    companyHint: extractCompanyHint(message),
    wantsCreate: wantsCreateAction(message),
  };
}

export type WorkspaceQueryFocus =
  | 'all'
  | 'requests'
  | 'assigned'
  | 'tickets'
  | 'dashboard'
  | 'page';

/**
 * Preguntas informativas: “cuántas solicitudes tengo”, “qué hay en esta página”, etc.
 */
export function parseWorkspaceQuery(
  message: string,
): WorkspaceQueryFocus | null {
  if (parseResolveIntent(message)) return null;
  if (wantsCreateAction(message)) return null;
  if (parseHowToIntent(message)) return null;

  const m = message.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');

  // “qué ves / qué hay en mi pantalla”
  if (
    /\b(esta\s+pagina|esta\s+pantalla|aqui|acá|en\s+pantalla|en\s+esta\s+vista|mi\s+pantalla|en\s+la\s+que\s+estoy)\b/.test(
      m,
    ) ||
    /\bque\s+(hay|ves|veo)\s+(aqui|acá|en\s+esta|en\s+mi)\b/.test(m) ||
    /\bdime\s+que\s+(hay|ves)\b/.test(m) ||
    /\bnecesito\s+que\s+me\s+digas\s+que\s+ves\b/.test(m)
  ) {
    return 'page';
  }

  const asksInfo =
    /\b(cuant[oa]s?|cuantos|dime|digame|decir|mostrame|muestrame|resumen|que\s+hay|que\s+tengo|tengo|mis|mi\s+dashboard|estado\s+de|listado|lista)\b/.test(
      m,
    ) ||
    /\b(que\s+esta\s+en|que\s+aparece|informame|consulta)\b/.test(m);

  if (!asksInfo && !/\?/.test(message)) {
    if (
      !/\b(mis\s+solicitudes|mis\s+casos|mis\s+tickets|dashboard\s+personal|dashboard\s+solicitudes)\b/.test(
        m,
      )
    ) {
      return null;
    }
  }

  if (
    /\b(dashboard\s+personal|asignad|a\s+mi\s+cargo|que\s+gestiono|solicitado)\b/.test(
      m,
    )
  ) {
    return 'dashboard';
  }
  if (/\b(caso|casos|ticket|tickets|help\s*desk)\b/.test(m)) {
    return 'tickets';
  }
  if (
    /\b(solicitud(es)?\s+asignad|asignadas\s+a\s+m[ií])\b/.test(m) ||
    /\basignadas\b/.test(m)
  ) {
    return 'assigned';
  }
  if (/\b(solicitud|solicitudes)\b/.test(m)) {
    return 'requests';
  }
  if (/\b(todo\s+mi\s+espacio|resumen\s+general|synerlink)\b/.test(m)) {
    return 'all';
  }
  if (/\b(dashboard|resumen|tengo)\b/.test(m) || asksInfo) {
    // Sin “esta página”: resumen corto orientado a dashboard si lo menciona
    if (/\bdashboard\b/.test(m)) return 'dashboard';
    return 'all';
  }
  return null;
}

export type HowToTopic =
  | 'ticket'
  | 'request'
  | 'workflow'
  | 'dashboard'
  | 'resolve'
  | 'general';

export interface ParsedHowToIntent {
  topic: HowToTopic;
  /** El usuario también quiere que lo ejecute (“créamelo”). */
  alsoCreate: boolean;
}

/** “ven cómo se crea un ticket” / “explícame el flujo de contratos”. */
export function parseHowToIntent(message: string): ParsedHowToIntent | null {
  if (parseResolveIntent(message)) return null;
  const m = message.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');

  const how =
    /\b(como|cómo|ven\s+como|explicame|explícame|ensename|enséñame|pasos|guia|guía|que\s+es|qué\s+es|donde|dónde|para\s+que\s+sirve)\b/.test(
      m,
    ) || /\b(manual|tutorial|flujo\s+de)\b/.test(m);

  if (!how) return null;

  // Si solo dice “crear un caso…” sin “cómo”, lo maneja wantsCreate.
  if (wantsCreateAction(message) && !/\b(como|cómo|ven\s+como|explic)\b/.test(m)) {
    return null;
  }

  let topic: HowToTopic = 'general';
  if (/\b(ticket|caso|help\s*desk|mesa)\b/.test(m)) topic = 'ticket';
  else if (/\b(solicitud|pago|tesorer)\b/.test(m)) topic = 'request';
  else if (/\b(flujo|workflow|contrato|autoriz)\b/.test(m)) topic = 'workflow';
  else if (/\b(dashboard|tablero)\b/.test(m)) topic = 'dashboard';
  else if (/\b(resolv|cerrar|cancel)\b/.test(m)) topic = 'resolve';

  const alsoCreate =
    /\b(creame|creamelo|crealo|creala|montamelo|hazmelo|hagamoslo|ejecutalo)\b/.test(
      m,
    ) || /\by\s+(crealo|creamelo|creame|hazlo)\b/.test(m);

  return { topic, alsoCreate };
}
