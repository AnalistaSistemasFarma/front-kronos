import { NextResponse } from 'next/server';
import { requireFarmadosisApi } from '../../../../../lib/farmadosis/auth';
import { getFarmadosisConfig } from '../../../../../lib/farmadosis/config';
import { FARMADOSIS_FORMS, getFormDef, resolveFormKey } from '../../../../../lib/farmadosis/forms';
import { loadProcessFields, resolveFarmadosisProcess } from '../../../../../lib/farmadosis/processFields';

export const dynamic = 'force-dynamic';

/**
 * GET /api/integrations/farmadosis/schema?formKey=contacto
 * Catálogo Farmadosis + campos reales del proceso SynerLink si ya existe.
 */
export async function GET(req: Request) {
  const auth = requireFarmadosisApi(req);
  if (!auth.ok) return auth.response;

  try {
    const { searchParams } = new URL(req.url);
    const formKey = resolveFormKey(searchParams.get('formKey') || undefined);
    const config = getFarmadosisConfig();
    const formDef = getFormDef(formKey);
    const processRow = await resolveFarmadosisProcess(formKey, config);
    const processFields = processRow ? await loadProcessFields(processRow.id) : [];

    return NextResponse.json({
      formKey: formKey || 'default',
      formName: formDef?.formName || null,
      processName: formDef?.processName || null,
      processId: processRow?.id ?? null,
      processActive: processRow?.active ?? null,
      companyId: config.companyId,
      catalog: formDef?.fields ?? null,
      forms: Object.values(FARMADOSIS_FORMS).map((form) => form.formKey),
      fields: processFields.map((f) => ({
        id: f.id,
        label: f.field_label,
        type: f.field_type,
        required: f.required,
        options: f.options,
      })),
      hint: processRow
        ? processRow.active
          ? null
          : 'El proceso existe pero está inactivo. Actívelo en Workflows.'
        : formDef
          ? `Cree y active el proceso "${formDef.processName}" o defina FARMADOSIS_PROCESS_MAP.${formKey}.`
          : 'formKey desconocido. Use contacto | calidad | farmacovigilancia.',
    });
  } catch (err) {
    console.error('[farmadosis/schema]', err);
    return NextResponse.json(
      { error: 'Error consultando el esquema', details: (err as Error).message },
      { status: 500 }
    );
  }
}
