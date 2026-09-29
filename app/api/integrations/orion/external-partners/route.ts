import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { escapeOData } from '@/lib/health-records/records';
import { sql, withMssqlPool } from '@/lib/mssqlPool';
import { sapGet, sapLogin, sapLogout, SapError, type SapSession } from '@/lib/sap/serviceLayer';

type PartnerOption = {
  value: string;
  label: string;
  cardCode: string;
  cardName: string;
  email: string;
  cardType: string;
  source: 'sap' | 'user';
};

type SapPartner = {
  CardCode?: string;
  CardName?: string;
  CardType?: string;
  EmailAddress?: string;
  U_HBT_MailRecep_FE?: string;
  ContactEmployees?: Array<{ Name?: string; E_Mail?: string; Active?: string }>;
};

const CARD_TYPE_LABEL: Record<string, string> = {
  cSupplier: 'Proveedor',
  cCustomer: 'Cliente',
  cLid: 'Lead',
};

/** Correo de factura electrónica (localización Colombia); no existe en todas las bases SAP. */
const FE_MAIL_FIELD = 'U_HBT_MailRecep_FE';

function cleanEmail(raw?: string | null): string {
  const email = String(raw || '')
    .split(/[;,\s]+/)[0]!
    .trim()
    .toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : '';
}

/** Variantes de mayúsculas: `contains` distingue mayúsculas en SAP HANA. */
function caseVariants(word: string): string[] {
  const lower = word.toLowerCase();
  const capital = lower.charAt(0).toUpperCase() + lower.slice(1);
  return [...new Set([word, word.toUpperCase(), lower, capital])];
}

function anyContains(field: string, value: string): string {
  return caseVariants(value)
    .map((v) => `contains(${field},'${escapeOData(v)}')`)
    .join(' or ');
}

/** Todas las palabras en el nombre (cualquier orden) o el texto completo en código/correo. */
function buildFilter(q: string, withFeMail: boolean): string {
  const words = q.split(/\s+/).filter((w) => w.length >= 2).slice(0, 4);
  const byName = words.map((w) => `(${anyContains('CardName', w)})`).join(' and ');
  const lower = escapeOData(q.toLowerCase());
  const other = [
    anyContains('CardCode', q),
    `contains(EmailAddress,'${lower}')`,
    withFeMail ? `contains(${FE_MAIL_FIELD},'${lower}')` : '',
  ].filter(Boolean);
  return `(${[byName ? `(${byName})` : '', ...other].filter(Boolean).join(' or ')}) and Valid eq 'tYES' and Frozen eq 'tNO'`;
}

async function searchPartners(sap: SapSession, q: string): Promise<SapPartner[]> {
  const run = (withFeMail: boolean) => {
    const select = ['CardCode', 'CardName', 'CardType', 'EmailAddress', 'ContactEmployees'];
    if (withFeMail) select.push(FE_MAIL_FIELD);
    const path =
      `BusinessPartners?$filter=${encodeURIComponent(buildFilter(q, withFeMail))}` +
      `&$select=${select.join(',')}&$orderby=CardName&$top=40`;
    return sapGet<{ value?: SapPartner[] }>(sap, path);
  };
  try {
    return (await run(true)).value ?? [];
  } catch (err) {
    // Bases SAP sin el campo de factura electrónica responden 400 al filtrarlo.
    if (err instanceof SapError && err.status === 400) return (await run(false)).value ?? [];
    throw err;
  }
}

/** Usuarios activos de SynerLink (cualquier empresa) cuyo nombre o correo tenga todas las palabras. */
async function searchUsers(q: string): Promise<PartnerOption[]> {
  const words = q.split(/\s+/).filter((w) => w.length >= 2).slice(0, 4);
  if (words.length === 0) return [];
  const rows = await withMssqlPool(async (pool) => {
    const request = pool.request();
    const conditions = words.map((w, i) => {
      request.input(`w${i}`, sql.NVarChar(120), `%${w}%`);
      return `(name LIKE @w${i} OR email LIKE @w${i})`;
    });
    const result = await request.query<{ name: string | null; email: string }>(
      `SELECT TOP 15 name, email FROM [user]
        WHERE isActive = 1 AND email IS NOT NULL AND email <> '' AND ${conditions.join(' AND ')}
        ORDER BY name`
    );
    return result.recordset;
  });
  return rows
    .map((u) => ({ email: cleanEmail(u.email), name: String(u.name || '').trim() }))
    .filter((u) => u.email)
    .map((u) => ({
      value: `user:${u.email}`,
      label: `${u.name || u.email} <${u.email}> · Usuario SynerLink`,
      cardCode: '',
      cardName: u.name || u.email,
      email: u.email,
      cardType: 'Usuario SynerLink',
      source: 'user' as const,
    }));
}

async function searchSapOptions(companyId: number, q: string): Promise<PartnerOption[]> {
  const endpoints = await prisma.sap_endpoints.findMany({ where: { id_company: companyId } });
  const ep = endpoints.find((e) => e.is_active) ?? endpoints[0] ?? null;
  if (!ep?.base_url) {
    throw new SapError('La empresa no tiene un endpoint SAP activo.', 409);
  }

  const sap = await sapLogin({
    baseUrl: ep.base_url,
    username: ep.username ?? '',
    password: ep.password ?? '',
    companyDB: ep.client ?? '',
  });

  try {
    const rows = await searchPartners(sap, q);
    const seen = new Set<string>();
    const options: PartnerOption[] = [];

    for (const row of rows) {
      const cardCode = String(row.CardCode || '').trim();
      if (!cardCode) continue;
      const cardName = String(row.CardName || '').trim() || cardCode;
      const cardType = CARD_TYPE_LABEL[String(row.CardType || '')] ?? '';
      const push = (value: string, name: string, email: string) => {
        if (seen.has(value)) return;
        seen.add(value);
        options.push({
          value,
          label: `${name}${email ? ` <${email}>` : ' (sin correo)'} · ${cardCode}${cardType ? ` · ${cardType}` : ''}`,
          cardCode,
          cardName: name,
          email,
          cardType,
          source: 'sap',
        });
      };

      const mainEmail = cleanEmail(row.EmailAddress) || cleanEmail(row[FE_MAIL_FIELD]);
      const contacts = (row.ContactEmployees ?? []).filter(
        (c) => c.Active !== 'tNO' && cleanEmail(c.E_Mail)
      );
      push(cardCode, cardName, mainEmail || cleanEmail(contacts[0]?.E_Mail));
      for (const c of contacts) {
        const email = cleanEmail(c.E_Mail);
        if (email === mainEmail) continue;
        const contactName = String(c.Name || '').trim();
        push(`${cardCode}#${email}`, contactName ? `${contactName} (${cardName})` : cardName, email);
      }
    }
    return options;
  } finally {
    await sapLogout(sap);
  }
}

/**
 * Búsqueda de socios para firmantes Orion: socios de negocio SAP de la empresa y usuarios
 * activos de SynerLink.
 * GET ?companyId=&q=
 * Devuelve { options: [{ value, label, cardCode, cardName, email, cardType, source }], sapError? };
 * `email` vacío = socio sin correo en SAP (el preparador lo escribe al asignarlo).
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const companyId = Number(searchParams.get('companyId'));
    const q = (searchParams.get('q') ?? '').trim();

    if (!companyId) {
      return NextResponse.json({ error: 'Falta companyId' }, { status: 400 });
    }
    if (q.length < 2) {
      return NextResponse.json({ options: [] });
    }

    const [users, sap] = await Promise.all([
      searchUsers(q),
      searchSapOptions(companyId, q).then(
        (options) => ({ options, error: null as string | null }),
        (err: unknown) => {
          if (!(err instanceof SapError)) console.error('[orion/external-partners] SAP', err);
          return {
            options: [] as PartnerOption[],
            error: err instanceof SapError ? err.message : 'No se pudo consultar SAP',
          };
        }
      ),
    ]);

    const userEmails = new Set(users.map((u) => u.email));
    const options = [...users, ...sap.options.filter((o) => !o.email || !userEmails.has(o.email))];
    return NextResponse.json({
      options,
      ...(sap.error ? { sapError: `Socios SAP no disponibles: ${sap.error}` } : {}),
    });
  } catch (error) {
    console.error('[orion/external-partners]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}