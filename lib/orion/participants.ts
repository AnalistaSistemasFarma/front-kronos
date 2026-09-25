export type OrionParticipantRole = 'Solicitante' | 'Asignado' | 'Firmante';

export type OrionParticipantType = 'internal' | 'external';

export type OrionParticipant = {
  order: number;
  email: string;
  name: string;
  role: OrionParticipantRole;
  signatureDataUrl?: string | null;
  /** internal = usuario SynerLink; external = socio de negocio. */
  type?: OrionParticipantType;
  /** CardCode SAP cuando type = external. */
  cardCode?: string | null;
  /** Enviar correo con link al enviar a firma. */
  notifyByEmail?: boolean;
  /** Exige huella dactilar para este firmante. */
  requireFingerprint?: boolean;
  /**
   * ID visual de la firma en el documento (editable).
   * Por defecto coincide con `order`.
   */
  signatureMarkId?: number;
};

/** ID de marca visible en cajas / PDF (fallback a order). */
export function resolveSignatureMarkId(person: {
  order: number;
  signatureMarkId?: number | null;
}): number {
  const n = Number(person.signatureMarkId);
  if (Number.isFinite(n) && n >= 1) return Math.trunc(n);
  const order = Number(person.order);
  return Number.isFinite(order) && order >= 1 ? Math.trunc(order) : 1;
}

function normalizeEmail(email?: string | null): string {
  return String(email || '')
    .trim()
    .toLowerCase();
}

function parseUserLabelName(label: string): string {
  const idx = label.indexOf(' - ');
  return idx > 0 ? label.slice(0, idx).trim() : label.trim();
}

/** Firmantes se eligen en el editor; no se prellenan desde el flujo. */
export function buildOrionParticipants(_input?: {
  requesterName?: string | null;
  requesterEmail?: string | null;
  assigneeName?: string | null;
  assigneeEmail?: string | null;
  currentUserEmail?: string | null;
  currentUserSignature?: string | null;
  users?: Array<{ value: string; label: string }>;
  tasks?: Array<{ name?: string; id_assigned?: number }>;
}): OrionParticipant[] {
  void _input;
  return [];
}

export type OrionUserOption = { value: string; label: string };

export function parseUserOptionLabel(label: string): string {
  return parseUserLabelName(label);
}

export function mergeParticipantSources(
  suggested: OrionParticipant[],
  signers?: Array<{
    email?: string;
    name?: string;
    order?: number;
    type?: string;
    cardCode?: string | null;
    notifyByEmail?: boolean | null;
    requireFingerprint?: boolean | null;
    signatureMarkId?: number | null;
  }> | null
): OrionParticipant[] {
  if (signers?.length) {
    return signers
      .slice()
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((s, i) => {
        const type: OrionParticipantType =
          String(s.type || '').toLowerCase() === 'external' ? 'external' : 'internal';
        const order = s.order ?? i + 1;
        const markRaw = Number(s.signatureMarkId);
        return {
          order,
          email: normalizeEmail(s.email),
          name: s.name?.trim() || s.email || `Firmante ${i + 1}`,
          role: 'Firmante' as OrionParticipantRole,
          type,
          cardCode: s.cardCode ?? null,
          notifyByEmail:
            s.notifyByEmail == null ? true : Boolean(s.notifyByEmail),
          requireFingerprint: Boolean(s.requireFingerprint),
          signatureMarkId:
            Number.isFinite(markRaw) && markRaw >= 1 ? Math.trunc(markRaw) : order,
        };
      });
  }
  return suggested.map((p, i) => ({
    ...p,
    order: i + 1,
    signatureMarkId: resolveSignatureMarkId({ ...p, order: i + 1 }),
  }));
}

export function emptySignerSlot(order: number): OrionParticipant {
  return {
    order,
    email: '',
    name: '',
    role: 'Firmante',
    type: 'internal',
    cardCode: null,
    notifyByEmail: true,
    requireFingerprint: false,
    signatureMarkId: order,
  };
}

export function resizeParticipantSlots(
  list: OrionParticipant[],
  count: number
): OrionParticipant[] {
  const clamped = Math.min(10, Math.max(1, count));
  const next = list.slice(0, clamped);
  while (next.length < clamped) {
    next.push(emptySignerSlot(next.length + 1));
  }
  return next.map((p, i) => {
    const order = i + 1;
    const mark = resolveSignatureMarkId(p);
    // Si el mark seguía al order anterior y no fue personalizado, realinear.
    const prevOrder = Number(p.order);
    const markFollowedOrder =
      Number.isFinite(prevOrder) && prevOrder >= 1 && mark === Math.trunc(prevOrder);
    return {
      ...p,
      order,
      signatureMarkId: markFollowedOrder ? order : mark,
    };
  });
}
