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

function normalizeName(name?: string | null): string {
  return String(name || '').trim().toLowerCase();
}

function parseUserLabelName(label: string): string {
  const idx = label.indexOf(' - ');
  return idx > 0 ? label.slice(0, idx).trim() : label.trim();
}

type UserEmailOption = { value: string; label: string };

function resolveEmailByName(name: string | undefined, users: UserEmailOption[]): string {
  const target = normalizeName(name);
  if (!target) return '';
  const exact = users.find((u) => normalizeName(parseUserLabelName(u.label)) === target);
  if (exact?.value) return normalizeEmail(exact.value);
  const partial = users.find((u) => {
    const labelName = normalizeName(parseUserLabelName(u.label));
    return labelName.includes(target) || target.includes(labelName);
  });
  return partial?.value ? normalizeEmail(partial.value) : '';
}

export function buildOrionParticipants(input: {
  requesterName?: string | null;
  requesterEmail?: string | null;
  assigneeName?: string | null;
  assigneeEmail?: string | null;
  currentUserEmail?: string | null;
  currentUserSignature?: string | null;
  users?: UserEmailOption[];
  tasks?: Array<{ name?: string; id_assigned?: number }>;
}): OrionParticipant[] {
  const users = input.users ?? [];
  const list: OrionParticipant[] = [];
  const seen = new Set<string>();

  const add = (
    email: string | undefined,
    name: string | undefined,
    role: OrionParticipantRole,
    signatureDataUrl?: string | null
  ) => {
    let resolvedEmail = normalizeEmail(email);
    if (!resolvedEmail && name) resolvedEmail = resolveEmailByName(name, users);
    if (!resolvedEmail) return;
    if (seen.has(resolvedEmail)) return;
    seen.add(resolvedEmail);
    const me = normalizeEmail(input.currentUserEmail);
    list.push({
      order: list.length + 1,
      email: resolvedEmail,
      name: name?.trim() || resolvedEmail,
      role,
      signatureDataUrl:
        signatureDataUrl ?? (me && resolvedEmail === me ? input.currentUserSignature : null),
    });
  };

  add(input.requesterEmail ?? undefined, input.requesterName ?? undefined, 'Solicitante');
  add(
    input.assigneeEmail ?? undefined,
    input.assigneeName ?? undefined,
    'Asignado'
  );

  for (const task of input.tasks ?? []) {
    if (task.name) add(undefined, task.name, 'Firmante');
  }

  return list;
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
