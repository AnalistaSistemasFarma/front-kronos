import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { getCompanyEndpointForUser } from '../../../../lib/health-records/access';
import {
  articuloExiste,
  crearRegistro,
  getFieldSizes,
  getNombresExistentes,
  normalizeName,
  registroExiste,
  sanitizeRecord,
} from '../../../../lib/health-records/records';
import { sapLogin, sapLogout, SapError } from '../../../../lib/sap/serviceLayer';

/**
 * Cargue masivo de registros sanitarios en una empresa. Recibe filas ya
 * mapeadas a campos U_* (el cliente lee el Excel). Valida obligatorios,
 * duplicados internos y contra SAP; crea fila por fila con su log; devuelve el
 * reporte { ok, duplicated, failed }. Todo server-side, una sola sesion SAP.
 */

const REQUIRED = ['U_Referencia', 'U_Registro_Sanitario'] as const;
const MAX_ROWS = 2000;

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userName = session.user.name || session.user.email;

    const body = await request.json().catch(() => ({}));
    const companyId = Number(body.companyId);
    const rows: Record<string, unknown>[] = Array.isArray(body.rows) ? body.rows : [];
    // Simulacion: corre TODAS las validaciones pero NO crea nada en SAP.
    const dryRun = body.dryRun === true;

    if (!companyId) return NextResponse.json({ error: 'Falta companyId' }, { status: 400 });
    if (rows.length === 0) return NextResponse.json({ error: 'No hay filas para cargar' }, { status: 400 });
    if (rows.length > MAX_ROWS) {
      return NextResponse.json({ error: `Maximo ${MAX_ROWS} filas por carga` }, { status: 400 });
    }

    const company = await getCompanyEndpointForUser(session.user.email, companyId, 'write');
    if (!company || !company.endpoint) {
      return NextResponse.json(
        { error: 'No tiene permiso de escritura en esta empresa o no esta configurada' },
        { status: 403 }
      );
    }
    const entity = company.endpoint.healthRecordsEntity!;

    const sap = await sapLogin({
      baseUrl: company.endpoint.baseUrl,
      username: company.endpoint.username,
      password: company.endpoint.password,
      companyDB: company.endpoint.companyDB,
    });

    // Tamaños de los campos en SAP, para validar el largo antes de crear
    // (así la simulación detecta "demasiado largo" sin intentar el POST).
    const fieldSizes = await getFieldSizes(sap, entity);

    // Nombres (Titular/Fabricante) ya existentes en SAP, indexados por su forma
    // normalizada, para advertir variantes por tildes/mayúsculas que fragmentan
    // reportes.
    const NAME_FIELDS = ['U_Titular', 'U_Fabricante'];
    const nombresExistentes = await getNombresExistentes(sap, entity, NAME_FIELDS);
    const FIELD_LABEL: Record<string, string> = { U_Titular: 'Titular', U_Fabricante: 'Fabricante' };
    const vistosNombres: Record<string, Map<string, string>> = {
      U_Titular: new Map(),
      U_Fabricante: new Map(),
    };

    const ok: { row: number; registro: string; docNum: number }[] = [];
    const duplicated: { row: number; registro: string; reason: string }[] = [];
    const failed: { row: number; registro: string; error: string }[] = [];
    const warnings: { row: number; field: string; value: string; similar: string }[] = [];
    const seen = new Set<string>();

    try {
      for (let i = 0; i < rows.length; i++) {
        const rowNum = i + 2; // fila 1 = encabezado en el Excel
        const record = sanitizeRecord(rows[i]);
        const registro = record.U_Registro_Sanitario ?? '';

        const faltantes = REQUIRED.filter((f) => !record[f]);
        if (faltantes.length > 0) {
          failed.push({ row: rowNum, registro, error: `Datos faltantes: ${faltantes.join(', ')}` });
          continue;
        }

        // Validar el largo de cada campo contra su tamaño en SAP (evita el 400).
        const rec = record as Record<string, string | undefined>;
        const largo = Object.entries(fieldSizes).find(
          ([field, max]) => (rec[field]?.length ?? 0) > max
        );
        if (largo) {
          const [field, max] = largo;
          failed.push({
            row: rowNum,
            registro,
            error: `El campo ${field} supera el máximo de ${max} caracteres (tiene ${rec[field]!.length})`,
          });
          continue;
        }

        // Un mismo RS puede repetirse en productos distintos; el duplicado se
        // evalua por la pareja (Referencia + Registro Sanitario).
        const dupKey = `${record.U_Referencia}||${registro}`;
        if (seen.has(dupKey)) {
          duplicated.push({ row: rowNum, registro, reason: 'Duplicado dentro del archivo (mismo producto y registro)' });
          continue;
        }

        try {
          // El articulo (Referencia) debe existir en SAP antes de asignarle un RS.
          if (!(await articuloExiste(sap, record.U_Referencia as string))) {
            failed.push({
              row: rowNum,
              registro,
              error: `El articulo '${record.U_Referencia}' no existe en SAP`,
            });
            continue;
          }
          if (await registroExiste(sap, entity, record.U_Referencia as string, registro)) {
            duplicated.push({ row: rowNum, registro, reason: 'Ya existe en SAP para este producto' });
            continue;
          }
          seen.add(dupKey);

          // Advertencia (no bloquea): Titular/Fabricante que difiere de uno ya
          // existente (o de otra fila del archivo) solo por tildes/mayúsculas.
          for (const field of NAME_FIELDS) {
            const value = rec[field];
            if (!value) continue;
            const norm = normalizeName(value);
            const existentes = nombresExistentes[field]?.get(norm);
            if (existentes && !existentes.has(value)) {
              warnings.push({
                row: rowNum,
                field: FIELD_LABEL[field],
                value,
                similar: [...existentes].slice(0, 3).join(' | '),
              });
            } else {
              const prev = vistosNombres[field].get(norm);
              if (prev && prev !== value) {
                warnings.push({ row: rowNum, field: FIELD_LABEL[field], value, similar: prev });
              }
            }
            if (!vistosNombres[field].has(norm)) vistosNombres[field].set(norm, value);
          }

          if (dryRun) {
            // Simulacion: pasa todas las validaciones, pero NO se crea.
            ok.push({ row: rowNum, registro, docNum: 0 });
            continue;
          }
          const docNum = await crearRegistro(sap, company.endpoint, record, userName, 'Creado por cargue masivo');
          ok.push({ row: rowNum, registro, docNum });
        } catch (err) {
          const msg = err instanceof SapError ? err.friendly : err instanceof Error ? err.message : 'Error';
          failed.push({ row: rowNum, registro, error: msg });
        }
      }
    } finally {
      await sapLogout(sap);
    }

    return NextResponse.json({
      dryRun,
      summary: {
        total: rows.length,
        creados: ok.length,
        duplicados: duplicated.length,
        fallidos: failed.length,
        advertencias: warnings.length,
      },
      ok,
      duplicated,
      failed,
      warnings,
    });
  } catch (error) {
    if (error instanceof SapError) {
      return NextResponse.json({ error: error.message, detail: error.detail }, { status: error.status });
    }
    console.error('Error en cargue masivo de registros sanitarios:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
