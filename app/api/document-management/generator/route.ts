import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { prisma } from '../../../../lib/prisma';
import { getPool, sql } from '../../../../lib/mssqlPool';
import { buildGeneratorDocumentsWhere } from '../../../../lib/document-management/generatorQuery';

/**
 * Subproceso PROPIO del Generador de Documentos (fix pedido por Nicolás,
 * 2026-09-02): antes este módulo se gateaba con el permiso GENERAL de
 * Gestión Documental (lib/document-management/access.ts::getDocumentManagementAccess
 * -- cualquiera de sus tres subprocesos), igual que un botón más dentro de
 * ese módulo. Ahora tiene su PROPIO subproceso independiente
 * ('/process/document-management/generador', sembrado por
 * prisma/seeds/document-management-generador-subprocess.sql), asignable por
 * su cuenta desde el admin de usuarios sin tener que dar también
 * lectura/escritura del módulo documental completo. Resuelto en línea (no en
 * lib/document-management/access.ts) a propósito: es un permiso propio de
 * ESTE módulo, no una variante del acceso general de Gestión Documental.
 */
const DOCUMENT_GENERATOR_URL = '/process/document-management/generador';

interface DocumentGeneratorCompanyAccess {
  idCompany: number;
  companyName: string;
}

async function getDocumentGeneratorAccess(userEmail: string): Promise<DocumentGeneratorCompanyAccess[]> {
  const rows = await prisma.subprocessUserCompany.findMany({
    where: {
      companyUser: { user: { email: userEmail } },
      subprocess: { subprocess_url: DOCUMENT_GENERATOR_URL },
    },
    include: { companyUser: { include: { company: true } } },
  });

  const byCompany = new Map<number, DocumentGeneratorCompanyAccess>();
  for (const row of rows) {
    const company = row.companyUser.company;
    if (!byCompany.has(company.id_company)) {
      byCompany.set(company.id_company, { idCompany: company.id_company, companyName: company.company });
    }
  }
  return [...byCompany.values()];
}

/**
 * Sprint 7 — "Generador de Documentos".
 *
 * Lista TODOS los documentos en estado "Vigente" (ya autorizados/publicados,
 * ver lib/document-management/workflowStates.ts — se llega ahí solo vía la
 * acción `publicar_vigente`) de las empresas a las que el usuario tiene el
 * permiso propio del Generador (ver arriba).
 *
 * Para cada documento resuelve si está o no ligado a un proceso
 * (`document.id_process`, referencia BLANDA a `process_category.id` — ver
 * el comentario del modelo Document en prisma/schema.prisma) y, si lo está,
 * el NOMBRE de ese proceso vía un lookup aparte en SQL crudo (esa tabla no
 * está modelada en Prisma).
 *
 * HALLAZGO IMPORTANTE (documentado también en el mensaje de cierre del
 * sprint): hoy `id_process` no distingue procesos de negocio (Auditorías,
 * No Conformidades, Ingeniería Biomédica — el catálogo que llegará en el
 * Sprint 9). Todo documento que pasa por el flujo de aprobación de 14
 * estados (Sprint 6) queda con el MISMO `id_process`, el de
 * `DOCUMENT_WORKFLOW_PROCESS_NAME` ("Gestión Documental — Ciclo de vida del
 * documento"): es el proceso interno de SynerLink que orquesta el flujo, no
 * una categoría de negocio. Los únicos documentos con `id_process IS NULL`
 * hoy son los cargados directo en Fase 1 (carga histórica, sin flujo). Por
 * eso, mientras no exista el catálogo de procesos de negocio del Sprint 9,
 * "con proceso" / "sin proceso" en este listado equivale en la práctica a
 * "pasó por el flujo de aprobación" / "carga histórica directa" — no a una
 * categoría específica.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const access = await getDocumentGeneratorAccess(session.user.email);
    const readableCompanyIds = access.map((a) => a.idCompany);
    if (readableCompanyIds.length === 0) {
      return NextResponse.json({ documents: [], companies: access });
    }

    const { searchParams } = new URL(request.url);
    const companyIdParam = searchParams.get('companyId');
    const documentTypeIdParam = searchParams.get('documentTypeId');

    const companyId = companyIdParam ? Number(companyIdParam) : null;
    if (companyId && !readableCompanyIds.includes(companyId)) {
      return NextResponse.json({ error: 'Sin acceso a esa empresa' }, { status: 403 });
    }

    const documents = await prisma.document.findMany({
      // Filtro extraído a lib/document-management/generatorQuery.ts
      // (buildGeneratorDocumentsWhere) para poder probar por separado, sin
      // BD, que id_process: { not: null } SIEMPRE está presente -- 2026-09-02
      // (pedido de Nicolás): el Generador solo debe listar documentos que YA
      // fueron autorizados por el flujo de 14 estados. id_process IS NULL =
      // carga histórica de Fase 1, nunca pasó por aprobación -- se excluye
      // aunque esté marcado "Vigente".
      where: buildGeneratorDocumentsWhere({
        companyId,
        readableCompanyIds,
        documentTypeId: documentTypeIdParam ? Number(documentTypeIdParam) : null,
      }),
      include: {
        documentType: true,
        company: true,
        owner: { select: { id: true, name: true, email: true } },
        versions: {
          orderBy: { version_number: 'desc' },
          take: 1,
        },
      },
      orderBy: { updated_at: 'desc' },
    });

    // Resuelve el NOMBRE del proceso (process_category, SQL crudo) para los
    // documentos que tienen id_process. Un solo lookup batch, no N+1.
    const processIds = [...new Set(documents.map((d) => d.id_process).filter((v): v is number => v != null))];
    const processNameById = new Map<number, string>();
    if (processIds.length > 0) {
      const pool = await getPool();
      const placeholders = processIds.map((_, i) => `@p${i}`).join(', ');
      const req = pool.request();
      processIds.forEach((id, i) => req.input(`p${i}`, sql.Int, id));
      const result = await req.query(
        `SELECT id, process FROM process_category WHERE id IN (${placeholders})`
      );
      for (const row of result.recordset as Array<{ id: number; process: string }>) {
        processNameById.set(row.id, row.process);
      }
    }

    const documentsWithProcess = documents.map((d) => ({
      ...d,
      processName: d.id_process != null ? processNameById.get(d.id_process) ?? null : null,
    }));

    return NextResponse.json({ documents: documentsWithProcess, companies: access });
  } catch (error) {
    console.error('Error listando documentos vigentes (Generador de Documentos):', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

