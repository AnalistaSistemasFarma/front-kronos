import { NextResponse } from 'next/server';
import { requireFarmadosisApi } from '../../../../../lib/farmadosis/auth';
import { buildExternalUrl, getFarmadosisConfig } from '../../../../../lib/farmadosis/config';
import { getFormDef, resolveFormKey } from '../../../../../lib/farmadosis/forms';
import {
  buildDescription,
  buildNoteDump,
  buildSubject,
  mapFieldsToFormValues,
  prepareIncomingFields,
} from '../../../../../lib/farmadosis/mapFields';
import {
  findUserIdByEmail,
  loadProcessFields,
  resolveFarmadosisProcess,
} from '../../../../../lib/farmadosis/processFields';
import {
  createRequestGeneral,
  findRequestIdByUrl,
  insertRequestNote,
} from '../../../../../lib/requests-general/createRequest';

export const dynamic = 'force-dynamic';

const TAG = '[farmadosis/create-request]';

type FarmadosisBody = {
  formKey?: string;
  formName?: string;
  subject?: string;
  message?: string;
  description?: string;
  requesterName?: string;
  requesterEmail?: string;
  requesterPhone?: string;
  companyId?: number;
  sourceUrl?: string;
  externalId?: string;
  fields?: unknown;
};

/**
 * POST /api/integrations/farmadosis/create-request
 * Crea una solicitud SynerLink (mismo workflow que el formulario interno).
 * Auth: Authorization: Bearer <INTEGRATION_API_KEYS>
 *
 * 201 created + id_request
 * 200 alreadyExisted: true (mismo externalId)
 * 401 key inválida
 * 422 proceso inactivo o usuario no resuelto
 * 503 proceso / empresa no configurados
 */
export async function POST(req: Request) {
  const auth = requireFarmadosisApi(req);
  if (!auth.ok) return auth.response;

  try {
    const body = (await req.json().catch(() => null)) as FarmadosisBody | null;
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Body JSON inválido' }, { status: 400 });
    }

    const formKey = resolveFormKey(body.formKey, body.formName);
    const formDef = getFormDef(formKey);
    const config = getFarmadosisConfig();
    const companyId = Number(body.companyId) > 0 ? Number(body.companyId) : config.companyId;

    if (!companyId) {
      return NextResponse.json(
        {
          error: 'Empresa no configurada',
          hint: 'Envíe companyId o defina FARMADOSIS_COMPANY_ID.',
        },
        { status: 503 }
      );
    }

    const processRow = await resolveFarmadosisProcess(formKey, config);
    if (!processRow) {
      return NextResponse.json(
        {
          error: 'Proceso Farmadosis no configurado',
          hint: formDef
            ? `Cree y active el proceso "${formDef.processName}" o defina FARMADOSIS_PROCESS_MAP.${formKey}.`
            : 'Defina FARMADOSIS_PROCESS_MAP o FARMADOSIS_PROCESS_ID.',
        },
        { status: 503 }
      );
    }

    if (!processRow.active) {
      return NextResponse.json(
        {
          error: `El proceso ${processRow.id} (${processRow.process}) está inactivo`,
          hint: 'Actívelo en Solicitudes → Workflows.',
        },
        { status: 422 }
      );
    }

    const createdby =
      (await findUserIdByEmail(body.requesterEmail)) || config.requesterUserId;
    if (!createdby) {
      return NextResponse.json(
        {
          error: 'Solicitante no resuelto',
          hint: 'Envíe requesterEmail de un usuario SynerLink o defina FARMADOSIS_REQUESTER_USER_ID.',
        },
        { status: 422 }
      );
    }

    const externalId = body.externalId?.trim();
    const externalUrl = externalId ? buildExternalUrl(formKey, externalId) : null;
    if (externalUrl) {
      const existingId = await findRequestIdByUrl(externalUrl);
      if (existingId) {
        return NextResponse.json(
          {
            message: 'Solicitud ya existía',
            id_request: existingId,
            alreadyExisted: true,
          },
          { status: 200 }
        );
      }
    }

    const incoming = prepareIncomingFields(body.fields);
    const processFields = await loadProcessFields(processRow.id);
    const { formValues, unmatched } = mapFieldsToFormValues(
      processFields,
      incoming,
      config.fieldMap
    );

    const message = body.message || body.description || '';
    const subject = buildSubject({
      subject: body.subject,
      formName: body.formName || formDef?.formName || formKey,
      requesterName: body.requesterName,
    });
    const descripcion = buildDescription({
      formName: body.formName || formDef?.formName || formKey,
      requesterName: body.requesterName,
      requesterEmail: body.requesterEmail,
      requesterPhone: body.requesterPhone,
      sourceUrl: body.sourceUrl,
      message,
      unmatched,
    });

    console.log(
      `${TAG} ▶ formKey=${formKey} process=${processRow.id} company=${companyId} fields=${formValues.length} unmatched=${unmatched.length}`
    );

    const created = await createRequestGeneral({
      company: companyId,
      subject,
      descripcion,
      process: processRow.id,
      createdby,
      url: externalUrl,
      formValues,
    });

    const note = buildNoteDump({
      formKey,
      formName: body.formName || formDef?.formName,
      requesterName: body.requesterName,
      requesterEmail: body.requesterEmail,
      requesterPhone: body.requesterPhone,
      sourceUrl: body.sourceUrl,
      externalId,
      message,
      fields: incoming,
    });

    try {
      await insertRequestNote({
        id_request: created.id_request,
        note,
        created_by: createdby,
      });
    } catch (noteErr) {
      console.error(`${TAG} nota no guardada:`, noteErr);
    }

    return NextResponse.json(
      {
        message: 'Solicitud creada correctamente',
        id_request: created.id_request,
        processId: processRow.id,
        unmatched: unmatched.map((item) => item.key || item.label).filter(Boolean),
        notifications: {
          processEmail: created.processEmail,
          taskEmails: created.taskEmails,
        },
      },
      { status: 201 }
    );
  } catch (err) {
    const error = err as Error & { status?: number };
    if (error.status === 400) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error(`${TAG} ✖`, err);
    return NextResponse.json(
      { error: 'Error al crear la solicitud', details: error.message },
      { status: 500 }
    );
  }
}
