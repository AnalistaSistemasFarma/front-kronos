import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { escapeOData } from '@/lib/health-records/records';
import { sapGet, sapLogin, sapLogout, SapError } from '@/lib/sap/serviceLayer';

/**
 * Búsqueda de socios de negocio para firmantes externos Orion.
 * GET ?companyId=&q=
 * Devuelve { options: [{ value: email, label, cardCode, cardName, email }] }
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

    const endpoints = await prisma.sap_endpoints.findMany({
      where: { id_company: companyId },
    });
    const ep = endpoints.find((e) => e.is_active) ?? endpoints[0] ?? null;
    if (!ep?.base_url) {
      return NextResponse.json(
        { error: 'La empresa no tiene un endpoint SAP activo.' },
        { status: 409 }
      );
    }

    const sap = await sapLogin({
      baseUrl: ep.base_url,
      username: ep.username ?? '',
      password: ep.password ?? '',
      companyDB: ep.client ?? '',
    });

    try {
      const e = escapeOData(q);
      const filter = `(contains(CardName,'${e}') or contains(CardCode,'${e}') or contains(EmailAddress,'${e}')) and Valid eq 'tYES' and Frozen eq 'tNO'`;
      const path = `BusinessPartners?$filter=${encodeURIComponent(filter)}&$select=CardCode,CardName,EmailAddress&$top=25`;
      const data = await sapGet<{
        value?: Array<{ CardCode?: string; CardName?: string; EmailAddress?: string }>;
      }>(sap, path);

      const options = (data.value ?? [])
        .map((row) => {
          const cardCode = String(row.CardCode || '').trim();
          const cardName = String(row.CardName || '').trim();
          const email = String(row.EmailAddress || '')
            .trim()
            .toLowerCase();
          if (!cardCode || !email || !email.includes('@')) return null;
          return {
            value: email,
            label: `${cardName || cardCode} <${email}>`,
            cardCode,
            cardName: cardName || cardCode,
            email,
          };
        })
        .filter(Boolean);

      return NextResponse.json({ options });
    } finally {
      await sapLogout(sap);
    }
  } catch (error) {
    if (error instanceof SapError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('[orion/external-partners]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
