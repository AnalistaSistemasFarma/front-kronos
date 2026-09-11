export type OrionParticipantRole = 'Solicitante' | 'Asignado' | 'Firmante';

export type OrionParticipant = {
  order: number;
  email: string;
  name: string;
  role: OrionParticipantRole;
  signatureDataUrl?: string | null;
};

function normalizeEmail(email?: string | null): string {
  return String(email || '').trim().toLowerCase();
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
  // Firmantes Orion = elección explícita en el editor (orden y personas).
  // No prellenar con solicitante / encargado / responsables de tareas del flujo:
  // en FIRMA la 1.ª tarea "Preparar documento…" estaba asignada a Juan Fonseca
  // y terminaba como firmante 1 en modo secuencial (los demás quedaban en espera).
  void _input;
  return [];
}

export type OrionUserOption = { value: string; label: string };

export function parseUserOptionLabel(label: string): string {
  return parseUserLabelName(label);
}

export function mergeParticipantSources(
  suggested: OrionParticipant[],
  signers?: Array<{ email?: string; name?: string; order?: number }> | null
): OrionParticipant[] {
  if (signers?.length) {
    return signers
      .slice()
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((s, i) => ({
        order: s.order ?? i + 1,
        email: normalizeEmail(s.email),
        name: s.name?.trim() || s.email || `Firmante ${i + 1}`,
        role: 'Firmante' as OrionParticipantRole,
      }));
  }
  return suggested.map((p, i) => ({ ...p, order: i + 1 }));
}

export function emptySignerSlot(order: number): OrionParticipant {
  return { order, email: '', name: '', role: 'Firmante' };
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
  return next.map((p, i) => ({ ...p, order: i + 1 }));
}
