import 'server-only';
import { sql, withMssqlPool } from '../mssqlPool';
import { sendServerMessage, type EmailTableRow } from '../email/sendServerMessage';
import { DATE_FIELDS } from './fields';
import type { RecordChange } from './records';

export const EMAIL_KEYS = {
  create: 'SENDEMAILCREATEHEALTHRECORD',
  divulgation: 'SENDEMAILDIVULGATIONRECORD',
  change: 'SENDEMAILCHANGEHRVD',
  log: 'SENDEMAILLOGHEALTHRECORD',
} as const;

/** Campos cuyo cambio se notifica (los del legado + estados, para la inactivacion). */
const WATCHED_FIELDS = [
  'U_Vida_Util',
  'U_Codigo_IUM',
  'U_Codigo_CUM',
  'U_Estado_Entrada',
  'U_Estado_Comercializacion',
];

const STATE_FIELDS = ['U_Estado_Entrada', 'U_Estado_Comercializacion'];

const MAX_TABLE_ROWS = 200;

export interface NotifyContext {
  companyId: number;
  companyName: string;
}

export interface NotifyResult {
  sent: string[];
  skipped: string[];
  errors: string[];
}

type RecordLike = Record<string, unknown>;

function emptyResult(): NotifyResult {
  return { sent: [], skipped: [], errors: [] };
}

function mergeEmails(values: string[]): string {
  const seen = new Map<string, string>();
  for (const value of values) {
    for (const raw of value.split(/[,;]/)) {
      const email = raw.trim();
      if (email && !seen.has(email.toLowerCase())) seen.set(email.toLowerCase(), email);
    }
  }
  return [...seen.values()].join(',');
}

export async function getCompanyEmails(companyId: number): Promise<Record<string, string>> {
  const rows = await withMssqlPool(async (pool) => {
    const result = await pool
      .request()
      .input('companyId', sql.Int, companyId)
      .query<{ value_email: string | null; email_to_send: string | null }>(`
        SELECT ehr.value_email, ehr.email_to_send
        FROM emails_health_record ehr
        WHERE ehr.id_company = @companyId AND ehr.active = 1
      `);
    return result.recordset;
  });

  const byKey = new Map<string, string[]>();
  for (const row of rows) {
    const key = String(row.value_email ?? '').trim().toUpperCase();
    const emails = String(row.email_to_send ?? '').trim();
    if (!key || !emails) continue;
    byKey.set(key, [...(byKey.get(key) ?? []), emails]);
  }

  const out: Record<string, string> = {};
  for (const [key, values] of byKey) out[key] = mergeEmails(values);
  return out;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function text(record: RecordLike, field: string): string {
  const raw = record[field];
  const s = raw == null ? '' : String(raw).trim();
  return DATE_FIELDS.includes(field) ? s.slice(0, 10) : s;
}

function archivoCell(link: string): string {
  if (!/^https?:\/\//i.test(link)) return 'No disponible';
  return `<a href="${escapeHtml(link)}" target="_blank" style="display:inline-block;padding:6px 10px;font-size:12px;background-color:#0073e6;color:white;text-decoration:none;border-radius:3px;">Ver archivo</a>`;
}

function recordRow(record: RecordLike, companyName: string): EmailTableRow {
  return {
    Empresa: companyName,
    'Registro Sanitario': text(record, 'U_Registro_Sanitario'),
    Descripción: text(record, 'U_Descripcion'),
    País: text(record, 'U_Pais'),
    Titular: text(record, 'U_Titular'),
    Fabricante: text(record, 'U_Fabricante'),
    Referencia: text(record, 'U_Referencia'),
    'Vida útil': text(record, 'U_Vida_Util'),
    'Estado entrada': text(record, 'U_Estado_Entrada'),
    'Estado comercialización': text(record, 'U_Estado_Comercializacion'),
    Obsoleto: text(record, 'U_Obsoleto'),
    Archivo: archivoCell(text(record, 'U_SEND_Link')),
  };
}

function buildRecordTable(records: RecordLike[], companyName: string): EmailTableRow[] {
  return records.slice(0, MAX_TABLE_ROWS).map((r) => recordRow(r, companyName));
}

function block(title: string, bodyHtml: string): string {
  return `
    <div style="margin-top:20px;padding:15px;border-radius:8px;background:#f8f9fa;border:1px solid #e0e0e0;">
      <h3 style="margin:0 0 10px 0;font-size:16px;">${title}</h3>
      ${bodyHtml}
    </div>
  `;
}

function noteBody(value: string): string {
  return `
      <p style="margin:0;white-space:pre-wrap;word-break:break-word;overflow-wrap:break-word;line-height:1.6;font-size:14px;">${escapeHtml(value)}</p>
  `;
}

function buildOutro(sections: string[], detail: string): string {
  return `
    ${sections.join('\n')}

    <p style="margin-top:20px;">
      Este es un mensaje automático del módulo de Registros Sanitarios.
      ${detail}
      Si tiene alguna pregunta, por favor contacte al administrador del sistema.
    </p>
  `;
}

async function send(
  result: NotifyResult,
  ctx: NotifyContext,
  key: string,
  to: string | undefined,
  title: string,
  table: EmailTableRow[],
  outro: string
): Promise<void> {
  if (!to) {
    console.warn(
      `[health-records/notifications] ${ctx.companyName} (id ${ctx.companyId}) sin destinatarios activos para ${key}; se omite el correo.`
    );
    result.skipped.push(key);
    return;
  }
  try {
    await sendServerMessage({ userEmail: to, title, table, outro });
    result.sent.push(key);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[health-records/notifications] Fallo el correo ${key} (${ctx.companyName}):`, err);
    result.errors.push(`${key}: ${message}`);
  }
}

async function safely(fn: (result: NotifyResult) => Promise<void>): Promise<NotifyResult> {
  const result = emptyResult();
  try {
    await fn(result);
  } catch (err) {
    console.error('[health-records/notifications] Error preparando la notificación:', err);
    result.errors.push(err instanceof Error ? err.message : String(err));
  }
  return result;
}

export function toNotifyWarning(...results: NotifyResult[]): string | undefined {
  const errors = results.flatMap((r) => r.errors);
  if (errors.length === 0) return undefined;
  return `No se pudo enviar la notificación por correo (${errors.join('; ')})`;
}

export function notifyCreated(
  ctx: NotifyContext,
  records: RecordLike[],
  comentario: string
): Promise<NotifyResult> {
  return safely(async (result) => {
    if (records.length === 0) return;
    const emails = await getCompanyEmails(ctx.companyId);
    const createTo = emails[EMAIL_KEYS.create];
    const table = buildRecordTable(records, ctx.companyName);

    const single = records.length === 1;
    const registro = text(records[0], 'U_Registro_Sanitario');
    const omitted = records.length - table.length;
    const sections: string[] = [];
    if (comentario.trim()) sections.push(block('📝 Comentario', noteBody(comentario)));
    if (omitted > 0) {
      sections.push(block('Registros adicionales', noteBody(`Y ${omitted} registro(s) más que no se listan en este correo.`)));
    }

    const createTitle = single
      ? `Se ha creado un nuevo registro sanitario ${registro} - ${ctx.companyName}`
      : `Se han creado ${records.length} registros sanitarios - ${ctx.companyName}`;
    await send(
      result,
      ctx,
      EMAIL_KEYS.create,
      createTo,
      createTitle,
      table,
      buildOutro(sections, single ? `Se creó el registro sanitario ${escapeHtml(registro)}.` : `Se crearon ${records.length} registros sanitarios.`)
    );

    const divulgationTitle = single
      ? `Se ha realizado la divulgación del registro sanitario ${registro}, a los correos ${createTo || 'N/A'}`
      : `Se ha realizado la divulgación de ${records.length} registros sanitarios, a los correos ${createTo || 'N/A'}`;
    await send(
      result,
      ctx,
      EMAIL_KEYS.divulgation,
      emails[EMAIL_KEYS.divulgation],
      divulgationTitle,
      table,
      buildOutro(sections, 'Divulgación de la creación de registros sanitarios.')
    );
  });
}

export function notifyChanges(
  ctx: NotifyContext,
  record: RecordLike,
  changes: RecordChange[]
): Promise<NotifyResult> {
  return safely(async (result) => {
    const watched = changes.filter((c) => WATCHED_FIELDS.includes(c.field));
    if (watched.length === 0) return;

    const emails = await getCompanyEmails(ctx.companyId);
    const registro = text(record, 'U_Registro_Sanitario');
    const inactivated = watched.some(
      (c) => STATE_FIELDS.includes(c.field) && c.newValue.toLowerCase() === 'inactivo'
    );

    const rowsHtml = watched
      .map(
        (c) => `
          <tr>
            <td style="padding:6px 10px;border:1px solid #e0e0e0;"><strong>${escapeHtml(c.label)}</strong></td>
            <td style="padding:6px 10px;border:1px solid #e0e0e0;">${escapeHtml(c.oldValue || '(vacío)')}</td>
            <td style="padding:6px 10px;border:1px solid #e0e0e0;">${escapeHtml(c.newValue || '(vacío)')}</td>
          </tr>`
      )
      .join('');
    const changesTable = `
      <table style="border-collapse:collapse;font-size:14px;width:100%;">
        <thead>
          <tr>
            <th style="padding:6px 10px;border:1px solid #e0e0e0;text-align:left;">Campo</th>
            <th style="padding:6px 10px;border:1px solid #e0e0e0;text-align:left;">Valor anterior</th>
            <th style="padding:6px 10px;border:1px solid #e0e0e0;text-align:left;">Valor nuevo</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    `;

    const title = inactivated
      ? `⚠️ Se ha inactivado el registro sanitario ${registro} - ${ctx.companyName}`
      : `⚠️ Se han modificado campos del registro sanitario ${registro} - ${ctx.companyName}`;
    await send(
      result,
      ctx,
      EMAIL_KEYS.change,
      emails[EMAIL_KEYS.change],
      title,
      buildRecordTable([record], ctx.companyName),
      buildOutro(
        [block('✏️ Campos modificados', changesTable)],
        `Se modificó el registro sanitario ${escapeHtml(registro)}.`
      )
    );
  });
}

export function notifyObsolete(ctx: NotifyContext, record: RecordLike): Promise<NotifyResult> {
  return safely(async (result) => {
    const emails = await getCompanyEmails(ctx.companyId);
    const to = emails[EMAIL_KEYS.divulgation];
    const registro = text(record, 'U_Registro_Sanitario');
    const table = buildRecordTable([record], ctx.companyName);
    const outro = buildOutro(
      [block('⚠️ Registro obsoleto', noteBody(`El registro sanitario ${registro} fue marcado como Obsoleto.`))],
      'Notificación de obsolescencia.'
    );

    await send(
      result,
      ctx,
      EMAIL_KEYS.divulgation,
      to,
      `⚠️ El registro sanitario ${registro} ha sido marcado como Obsoleto - ${ctx.companyName}`,
      table,
      outro
    );
    await send(
      result,
      ctx,
      EMAIL_KEYS.divulgation,
      to,
      `Se ha realizado la divulgación del registro sanitario ${registro}, a los correos ${emails[EMAIL_KEYS.change] || 'N/A'}`,
      table,
      outro
    );
  });
}

export function notifyDivulgation(
  ctx: NotifyContext,
  record: RecordLike,
  userName: string
): Promise<NotifyResult> {
  return safely(async (result) => {
    const emails = await getCompanyEmails(ctx.companyId);
    const registro = text(record, 'U_Registro_Sanitario');
    await send(
      result,
      ctx,
      EMAIL_KEYS.divulgation,
      emails[EMAIL_KEYS.divulgation],
      `📢 Divulgación del registro sanitario ${registro} - ${ctx.companyName}`,
      buildRecordTable([record], ctx.companyName),
      buildOutro(
        [block('📢 Divulgación', noteBody(`${userName} envió a divulgar el registro sanitario ${registro}.`))],
        'Divulgación de registro sanitario.'
      )
    );
  });
}

export function notifyObservation(
  ctx: NotifyContext,
  record: RecordLike,
  comentario: string
): Promise<NotifyResult> {
  return safely(async (result) => {
    const emails = await getCompanyEmails(ctx.companyId);
    const logTo = emails[EMAIL_KEYS.log];
    const registro = text(record, 'U_Registro_Sanitario');
    const docNum = record.DocNum ?? '';
    const table = buildRecordTable([record], ctx.companyName);
    const outro = buildOutro(
      [block('📝 Observación agregada', noteBody(comentario))],
      `Se agregó una observación al registro sanitario ${escapeHtml(registro)}.`
    );

    const resumen = comentario.length > 120 ? `${comentario.slice(0, 117)}...` : comentario;
    await send(
      result,
      ctx,
      EMAIL_KEYS.log,
      logTo,
      `${resumen} | Registro Sanitario #${docNum}`,
      table,
      outro
    );
    await send(
      result,
      ctx,
      EMAIL_KEYS.divulgation,
      emails[EMAIL_KEYS.divulgation],
      `Se ha realizado la divulgación del registro sanitario ${registro}, a los correos ${logTo || 'N/A'}`,
      table,
      outro
    );
  });
}
