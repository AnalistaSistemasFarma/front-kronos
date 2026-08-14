import {
  DEFAULT_FARMADOSIS_FIELD_MAP,
  MEDICAMENTO_FIELD_MAP,
  SELECT_VALUE_ALIASES,
  labelForFieldKey,
} from './forms';

export type ProcessFieldOption = {
  id: number;
  option_label: string;
};

export type ProcessField = {
  id: number;
  field_label: string;
  field_type: string;
  required?: boolean;
  options?: ProcessFieldOption[];
};

export type IncomingField = {
  key?: string;
  label?: string;
  value?: unknown;
  id_field?: number;
  id_option?: number | null;
  value_text?: string | null;
};

export type FormValue = {
  id_field: number;
  id_option?: number | null;
  value_text?: string | null;
};

export function slugify(value: string): string {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Acepta objeto { clave: valor } o arreglo [{ key, label, value }]. */
export function normalizeIncomingFields(fields: unknown): IncomingField[] {
  if (!fields) return [];

  if (Array.isArray(fields)) {
    return fields
      .filter((item) => item && typeof item === 'object')
      .map((item) => {
        const row = item as IncomingField;
        const key = row.key != null ? String(row.key) : undefined;
        return {
          key,
          label: row.label != null ? String(row.label) : key ? labelForFieldKey(key) : undefined,
          value: row.value,
          id_field: row.id_field,
          id_option: row.id_option,
          value_text: row.value_text ?? null,
        };
      });
  }

  if (typeof fields === 'object') {
    return Object.entries(fields as Record<string, unknown>).map(([key, value]) => ({
      key,
      label: labelForFieldKey(key) || key,
      value,
    }));
  }

  return [];
}

function stringifyValue(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function matchOption(
  field: ProcessField,
  incoming: IncomingField
): { id_option: number | null; value_text: string | null } {
  if (incoming.id_option != null) {
    return { id_option: Number(incoming.id_option), value_text: incoming.value_text ?? null };
  }

  const raw = incoming.value_text ?? stringifyValue(incoming.value);
  if (raw == null || raw === '') {
    return { id_option: null, value_text: null };
  }

  if (field.field_type !== 'select') {
    return { id_option: null, value_text: raw };
  }

  const options = field.options || [];
  const asNum = Number(raw);
  const byId = options.find((o) => o.id === asNum);
  if (byId) return { id_option: byId.id, value_text: null };

  const aliased = SELECT_VALUE_ALIASES[slugify(raw)] || SELECT_VALUE_ALIASES[raw];
  const want = slugify(aliased || raw);
  const byLabel = options.find((o) => slugify(o.option_label) === want);
  if (byLabel) return { id_option: byLabel.id, value_text: null };

  return { id_option: null, value_text: raw };
}

function fieldAliases(field: ProcessField, fieldMap: Record<string, string>): Set<string> {
  const aliases = new Set<string>([slugify(field.field_label), String(field.id)]);
  for (const [from, to] of Object.entries(fieldMap)) {
    if (slugify(to) === slugify(field.field_label) || to === String(field.id)) {
      aliases.add(slugify(from));
    }
  }
  return aliases;
}

function incomingAliases(item: IncomingField, fieldMap: Record<string, string> = {}): string[] {
  const mappedLabel = item.key ? fieldMap[item.key] : undefined;
  return [
    item.key,
    item.label,
    mappedLabel,
    item.id_field != null ? String(item.id_field) : null,
  ]
    .filter((v): v is string => !!v && String(v).trim() !== '')
    .map((v) => slugify(v));
}

const MEDICAMENTO_KEY = /^medicamentos\[(\d+)\]\[(\w+)\]$/;

function stringifyIncoming(item: IncomingField): string | null {
  return item.value_text ?? stringifyValue(item.value);
}

/** Agrupa medicamentos[n][campo] en un solo campo "Medicamentos". */
export function collapseMedicamentoFields(items: IncomingField[]): IncomingField[] {
  const byIndex: Record<number, Array<{ sub: string; value: string }>> = {};
  const rest: IncomingField[] = [];

  for (const item of items) {
    const match = MEDICAMENTO_KEY.exec(item.key || '');
    if (!match) {
      rest.push(item);
      continue;
    }
    const value = stringifyIncoming(item);
    if (!value) continue;
    const index = Number(match[1]);
    (byIndex[index] ||= []).push({ sub: match[2], value });
  }

  const indices = Object.keys(byIndex)
    .map(Number)
    .sort((a, b) => a - b);
  if (indices.length === 0) return rest;

  const block = indices
    .map((index) => {
      const lines = byIndex[index].map((row) => {
        const label = MEDICAMENTO_FIELD_MAP[row.sub] || row.sub;
        return `  ${label}: ${row.value}`;
      });
      return `Medicamento ${index + 1}:\n${lines.join('\n')}`;
    })
    .join('\n\n');

  rest.push({
    key: 'medicamentos',
    label: 'Medicamentos',
    value: block,
    value_text: block,
  });
  return rest;
}

/** Normaliza + etiquetas + colapsa medicamentos. Omite vacíos. */
export function prepareIncomingFields(fields: unknown): IncomingField[] {
  return collapseMedicamentoFields(normalizeIncomingFields(fields)).filter((item) => {
    const value = stringifyIncoming(item);
    return value != null && String(value).trim() !== '';
  });
}

/**
 * Mapea campos de Farmadosis a `request_form_value`.
 * Prioridad: id_field → label/key vs field_label → FARMADOSIS_FIELD_MAP.
 */
export function mapFieldsToFormValues(
  processFields: ProcessField[],
  incoming: IncomingField[],
  fieldMap: Record<string, string> = {}
): { formValues: FormValue[]; unmatched: IncomingField[] } {
  fieldMap = { ...DEFAULT_FARMADOSIS_FIELD_MAP, ...fieldMap };
  const formValues: FormValue[] = [];
  const unmatched: IncomingField[] = [];
  const usedFieldIds = new Set<number>();

  for (const item of incoming) {
    let field: ProcessField | undefined;

    if (item.id_field != null) {
      field = processFields.find((f) => f.id === Number(item.id_field));
    }

    if (!field) {
      const aliases = incomingAliases(item, fieldMap);
      field = processFields.find((f) => {
        if (usedFieldIds.has(f.id)) return false;
        const targets = fieldAliases(f, fieldMap);
        return aliases.some((a) => targets.has(a));
      });
    }

    if (!field) {
      unmatched.push(item);
      continue;
    }

    usedFieldIds.add(field.id);
    const matched = matchOption(field, item);
    if (matched.id_option == null && (matched.value_text == null || matched.value_text === '')) {
      continue;
    }

    formValues.push({
      id_field: field.id,
      id_option: matched.id_option,
      value_text: matched.value_text,
    });
  }

  return { formValues, unmatched };
}

export function truncate(text: string, max: number): string {
  const value = String(text ?? '');
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}

export function buildDescription(params: {
  formName?: string;
  requesterName?: string;
  requesterEmail?: string;
  requesterPhone?: string;
  sourceUrl?: string;
  message?: string;
  unmatched?: IncomingField[];
}): string {
  const lines: string[] = [];
  const form = params.formName?.trim() || 'formulario';
  lines.push(`Solicitud originada en Farmadosis (${form}).`);

  const requesterBits = [
    params.requesterName?.trim(),
    params.requesterEmail?.trim(),
    params.requesterPhone?.trim(),
  ].filter(Boolean);
  if (requesterBits.length) {
    lines.push(`Solicitante: ${requesterBits.join(' · ')}`);
  }
  if (params.sourceUrl?.trim()) {
    lines.push(`Origen: ${params.sourceUrl.trim()}`);
  }
  if (params.message?.trim()) {
    lines.push('', params.message.trim());
  }
  if (params.unmatched?.length) {
    lines.push('', 'Campos adicionales:');
    for (const item of params.unmatched) {
      const label = item.label || item.key || `campo_${item.id_field ?? ''}`;
      const value = item.value_text ?? stringifyValue(item.value) ?? '';
      if (value) lines.push(`- ${label}: ${value}`);
    }
  }

  return truncate(lines.join('\n'), 1000);
}

export function buildNoteDump(params: {
  formKey?: string;
  formName?: string;
  requesterName?: string;
  requesterEmail?: string;
  requesterPhone?: string;
  sourceUrl?: string;
  externalId?: string;
  message?: string;
  fields: IncomingField[];
}): string {
  const lines = [
    'Formulario Farmadosis (registro completo)',
    `Formulario: ${params.formName || params.formKey || 'n/d'}`,
    params.externalId ? `Id externo: ${params.externalId}` : null,
    params.sourceUrl ? `URL origen: ${params.sourceUrl}` : null,
    `Solicitante: ${[params.requesterName, params.requesterEmail, params.requesterPhone].filter(Boolean).join(' · ') || 'n/d'}`,
    params.message ? `\nMensaje:\n${params.message}` : null,
    '',
    'Campos:',
    ...params.fields.map((item) => {
      const label = item.label || item.key || `id_field=${item.id_field}`;
      const value = item.value_text ?? stringifyValue(item.value) ?? '';
      return `- ${label}: ${value}`;
    }),
  ].filter((line) => line !== null) as string[];

  return lines.join('\n');
}

export function buildSubject(params: {
  subject?: string;
  formName?: string;
  requesterName?: string;
}): string {
  const explicit = params.subject?.trim();
  if (explicit) return truncate(explicit, 255);
  const form = params.formName?.trim() || 'Farmadosis';
  const who = params.requesterName?.trim();
  return truncate(who ? `${form} · ${who}` : `Farmadosis · ${form}`, 255);
}
