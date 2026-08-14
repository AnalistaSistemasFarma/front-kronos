import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import {
  getCompanyEndpointForUser,
  userCanAccessCompany,
} from '../../../../lib/payment-assistant/access';
import {
  getOpenSupplierInvoices,
  getSupplierBankAccounts,
  buildPaymentProposal,
  type SupplierBankAccount,
} from '../../../../lib/payments/proposal';
import { sapLogin, sapLogout, SapError } from '../../../../lib/sap/serviceLayer';
import { getPool, sql } from '../../../../lib/mssqlPool';
import { prisma } from '../../../../lib/prisma';
import { PAYMENT_RUN_PROCESS_NAME } from '../../../../lib/payment-assistant/paymentRun';
import { fireAndForgetNotification, notifyNewRequest } from '../../../../lib/notificationEvents.js';

// notificationEvents.js infiere los tipos por JSDoc (taskEmails default [] -> never[]); se tipa
// aquí explícitamente para poder pasarle string[] desde TypeScript.
const notifyNewRequestTyped = notifyNewRequest as (args: {
  requestId: number;
  subject: string;
  processEmail: string | null;
  taskEmails: string[];
  requestUrl: string | null;
}) => Promise<unknown>;

/**
 * ENVÍO de una corrida de pago a AUTORIZACIÓN (Asistente de Pagos).
 *
 * POST /api/payment-assistant/submit-run?companyId=<id>
 *
 * Reutiliza el MOTOR de Autorizaciones (no se reinventa): crea una solicitud
 * (`requests_general`) + su tarea de autorización (`task_request_general`, estado 4 = pendiente,
 * `id_assigned` NULL) siguiendo el mismo patrón que
 * `app/api/requests-general/create-request/route.js`. El enrutamiento del aprobador lo resuelve el
 * mecanismo existente (tipo de autorización ∩ empresa ∩ departamento del solicitante), así que la
 * autorización cae sola en `/process/authorization`.
 *
 * Además registra una fila en `payment_run` (tabla propia del Asistente) con el total pendiente
 * nacional y el JSON de proveedores (cardCodes) nacionales seleccionados, ligada a la solicitud.
 *
 * ALCANCE DE ESCRITURA: hacia SAP SOLO LECTURA (facturas + cuentas bancarias, igual que
 * `simulate`). Las únicas escrituras nuevas son en tablas propias de Kronos
 * (`requests_general`, `process_category_request_general`, `task_request_general`, `payment_run`).
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userEmail = session.user.email;

    const companyIdRaw = request.nextUrl.searchParams.get('companyId');
    const companyId = Number(companyIdRaw);
    if (!companyIdRaw || !Number.isFinite(companyId)) {
      return NextResponse.json({ error: 'companyId requerido' }, { status: 400 });
    }

    // Acceso nivel WRITE del usuario a la empresa dentro del módulo.
    const canWrite = await userCanAccessCompany(userEmail, companyId);
    if (!canWrite) {
      return NextResponse.json(
        { error: 'No tiene acceso a esta empresa.' },
        { status: 403 }
      );
    }

    // Endpoint SAP (SOLO LECTURA) para armar la propuesta y calcular el total/selección nacional.
    const access = await getCompanyEndpointForUser(userEmail, companyId);
    if (!access || !access.endpoint) {
      return NextResponse.json(
        { error: 'La empresa no está configurada para consultar SAP.' },
        { status: 403 }
      );
    }

    // id del usuario actual (solicitante). En PRUEBAS suele ser Nicolás; en PROD el aprobador
    // debe ser DISTINTO de este solicitante (segregación de funciones).
    const currentUser = await prisma.user.findUnique({
      where: { email: userEmail },
      select: { id: true },
    });
    if (!currentUser) {
      return NextResponse.json({ error: 'Usuario no encontrado.' }, { status: 403 });
    }
    const requesterId = currentUser.id;

    // 1) Propuesta de pago NACIONAL (SOLO LECTURA), idéntico a `simulate`/`generate-disfon`.
    const ep = access.endpoint;
    const sap = await sapLogin({
      baseUrl: ep.baseUrl,
      username: ep.username,
      password: ep.password,
      companyDB: ep.companyDB,
    });

    let nationalTotal = 0;
    let nationalCardCodes: string[] = [];
    try {
      const invoices = await getOpenSupplierInvoices(sap);
      const cardCodes = [...new Set(invoices.map((i) => i.cardCode).filter(Boolean))];
      const bankByCardCode: Record<string, SupplierBankAccount[]> = {};
      const countryByCardCode: Record<string, string> = {};
      const bankResults = await Promise.allSettled(
        cardCodes.map(async (cardCode) => ({
          cardCode,
          data: await getSupplierBankAccounts(sap, cardCode),
        }))
      );
      for (const result of bankResults) {
        if (result.status === 'fulfilled') {
          bankByCardCode[result.value.cardCode] = result.value.data.accounts;
          countryByCardCode[result.value.cardCode] = result.value.data.country;
        }
      }
      const proposal = buildPaymentProposal(invoices, bankByCardCode, countryByCardCode);
      const nationalGroups = proposal.nationalGroups;
      nationalTotal = nationalGroups.reduce((sum, g) => sum + g.totalPending, 0);
      nationalCardCodes = nationalGroups.map((g) => g.cardCode).filter(Boolean);
    } finally {
      await sapLogout(sap);
    }

    // 2) Crear la solicitud + tarea de autorización + fila payment_run (transacción).
    const pool = await getPool();

    // Resolver el process_category "Corrida de Pago" (creado en KRONOSDB_PRUEBAS, ver script de
    // datos). La columna del nombre en process_category es `process`.
    const pcResult = await pool
      .request()
      .input('name', sql.NVarChar, PAYMENT_RUN_PROCESS_NAME)
      .query(
        `SELECT TOP 1 id FROM process_category WHERE process = @name AND active = 1 ORDER BY id`
      );
    const idProcessCategory = pcResult.recordset[0]?.id ?? null;
    if (!idProcessCategory) {
      return NextResponse.json(
        {
          error:
            'No existe el proceso "Corrida de Pago" en la base. Aplique primero los datos de configuración.',
        },
        { status: 500 }
      );
    }

    const now = new Date();
    const yyyyMmDd =
      `${now.getFullYear()}-` +
      `${String(now.getMonth() + 1).padStart(2, '0')}-` +
      `${String(now.getDate()).padStart(2, '0')}`;
    const subject = `Corrida de pago ${access.companyName} ${yyyyMmDd}`;

    const transaction = new sql.Transaction(pool);
    let requestId: number;
    let runId: number;
    let taskEmails: string[] = [];
    try {
      await transaction.begin();

      // 2a) requests_general (mismo patrón que create-request; status_req=1 abierta).
      const reqInsert = await new sql.Request(transaction)
        .input('descripcion', sql.NVarChar(255), subject)
        .input('subject', sql.NVarChar(255), subject)
        .input('company', sql.Int, companyId)
        .input('requester', sql.NVarChar(1000), requesterId)
        .input('process', sql.Int, idProcessCategory)
        .query(`
          INSERT INTO requests_general
            (description, subject_request, id_company, id_requester, id_process_category, status_req)
          OUTPUT INSERTED.id
          VALUES (@descripcion, @subject, @company, @requester, @process, 1);
        `);
      requestId = reqInsert.recordset[0].id;

      // 2b) Vínculo proceso<->solicitud (igual que create-request).
      await new sql.Request(transaction)
        .input('id_request', sql.Int, requestId)
        .input('process', sql.Int, idProcessCategory)
        .query(`
          INSERT INTO process_category_request_general (id_request_general, id_process_category)
          VALUES (@id_request, @process);
        `);

      // 2c) Instanciar la(s) tarea(s) del template REUTILIZANDO la lógica de create-request:
      //     solo la primera (por display_order, id) + las no secuenciales; la de autorización
      //     sin responsable se crea igual con id_assigned = NULL (estado 4 = pendiente).
      const tasksResult = await new sql.Request(transaction)
        .input('process', sql.Int, idProcessCategory)
        .query(`
          SELECT tpc.id AS id_task, tpc.is_sequential, tpc.display_order, tpc.is_authorization,
                 utrg.id_user, u.email
          FROM task_process_category tpc
          LEFT JOIN user_task_request_general utrg ON utrg.id_task = tpc.id
          LEFT JOIN [user] u ON u.id = utrg.id_user
          WHERE tpc.id_process_category = @process AND tpc.active = 1
          ORDER BY tpc.display_order, tpc.id;
        `);

      const orderKey = (r: { display_order: number | null; id_task: number }) => [
        r.display_order ?? 0,
        r.id_task,
      ];
      const rows = tasksResult.recordset as Array<{
        id_task: number;
        is_sequential: boolean;
        display_order: number | null;
        is_authorization: boolean;
        id_user: string | null;
        email: string | null;
      }>;
      const firstTaskRow = rows.reduce<(typeof rows)[number] | null>((min, r) => {
        if (!min) return r;
        const [ma, mb] = orderKey(min);
        const [ra, rb] = orderKey(r);
        return ra < ma || (ra === ma && rb < mb) ? r : min;
      }, null);
      const firstTaskId = firstTaskRow ? firstTaskRow.id_task : null;

      const createdEmails: string[] = [];
      for (const row of rows) {
        const shouldCreateNow = !row.is_sequential || row.id_task === firstTaskId;
        if (!shouldCreateNow) continue;
        const hasAssignee = row.id_user != null;
        const isAuthorization = !!row.is_authorization;
        // Tarea normal sin responsable: se omite. De autorización sin responsable: se crea con NULL.
        if (!hasAssignee && !isAuthorization) continue;

        await new sql.Request(transaction)
          .input('id_request', sql.Int, requestId)
          .input('id_task', sql.Int, row.id_task)
          .input('id_user', sql.NVarChar, hasAssignee ? row.id_user : null)
          .query(`
            INSERT INTO task_request_general (id_request_general, id_task, id_status, id_assigned)
            VALUES (@id_request, @id_task, 4, @id_user);
          `);
        if (row.email) createdEmails.push(row.email);
      }
      taskEmails = [...new Set(createdEmails)];

      // 2d) Fila propia payment_run.
      const runInsert = await new sql.Request(transaction)
        .input('id_company', sql.Int, companyId)
        .input('id_request_general', sql.Int, requestId)
        .input('created_by', sql.VarChar(64), requesterId)
        .input('total', sql.Decimal(19, 2), Number.isFinite(nationalTotal) ? nationalTotal : 0)
        .input('selection', sql.NVarChar(sql.MAX), JSON.stringify(nationalCardCodes))
        .query(`
          INSERT INTO payment_run
            (id_company, id_request_general, created_by, total, selection, auth_status)
          OUTPUT INSERTED.id
          VALUES (@id_company, @id_request_general, @created_by, @total, @selection, 'pendiente');
        `);
      runId = runInsert.recordset[0].id;

      await transaction.commit();
    } catch (dbError) {
      await transaction.rollback();
      throw dbError;
    }

    // Notificación como en create-request (no bloquea la respuesta).
    fireAndForgetNotification(
      notifyNewRequestTyped({
        requestId,
        subject,
        processEmail: null,
        taskEmails,
        requestUrl: null,
      })
    );

    return NextResponse.json({ runId, requestId, status: 'pendiente' }, { status: 201 });
  } catch (error) {
    console.error('Error enviando la corrida de pago a autorización:', error);
    const message =
      error instanceof SapError
        ? error.friendly
        : error instanceof Error
          ? error.message
          : 'Error interno';
    const status = error instanceof SapError ? 502 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
