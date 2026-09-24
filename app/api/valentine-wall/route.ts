import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { withMssqlPool } from '@/lib/mssqlPool';
import {
  assertValentineWallAccess,
  parsePreferredCompanyId,
} from '@/lib/valentine/access';
import { createValentinePost, listValentinePosts } from '@/lib/valentine/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const email = String(session?.user?.email || '')
      .trim()
      .toLowerCase();
    const userId = String(session?.user?.id || '').trim();
    if (!email || !userId) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const preferred = parsePreferredCompanyId(
      req.nextUrl.searchParams.get('companyId')
    );
    const access = await assertValentineWallAccess(email, preferred);
    if (!access.ok || !access.company) {
      return NextResponse.json({ error: 'Sin acceso', reason: access.reason }, { status: 403 });
    }

    const posts = await withMssqlPool((pool) =>
      listValentinePosts(pool, userId, access.company!.idCompany)
    );
    return NextResponse.json({
      posts,
      company: access.company,
    });
  } catch (err) {
    console.error('[valentine-wall GET]', err);
    return NextResponse.json({ error: 'Error al cargar el muro' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const email = String(session?.user?.email || '')
      .trim()
      .toLowerCase();
    const userId = String(session?.user?.id || '').trim();
    const name = String(session?.user?.name || email.split('@')[0] || 'Alguien').trim();
    if (!email || !userId) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const body = (await req.json()) as {
      message?: string;
      categoryId?: string;
      toName?: string | null;
      companyId?: number | string | null;
    };

    const preferred = parsePreferredCompanyId(body.companyId);
    const access = await assertValentineWallAccess(email, preferred);
    if (!access.ok || !access.company) {
      return NextResponse.json({ error: 'Sin acceso', reason: access.reason }, { status: 403 });
    }

    const post = await withMssqlPool((pool) =>
      createValentinePost(pool, {
        idCompany: access.company!.idCompany,
        authorUserId: userId,
        authorEmail: email,
        authorName: name,
        message: String(body.message || ''),
        categoryId: String(body.categoryId || ''),
        toName: body.toName ?? null,
      })
    );

    return NextResponse.json({ post, company: access.company }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error al publicar';
    console.error('[valentine-wall POST]', err);
    const status = /vacío|inválida/i.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
