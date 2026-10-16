import { prisma } from '../prisma';
import farmalogica from './farmalogica.json';
import { PREDICCIONES_COMPANY_ID } from './access';

/**
 * Última predicción publicada para una empresa.
 *
 * El generador (analytics/predictivo/run_nightly.sh) guarda cada corrida en la
 * tabla predictivo_snapshots, así los números se actualizan sin desplegar. Si
 * la tabla no existe (p. ej. en una base donde aún no se creó) o está vacía,
 * se entrega el JSON versionado en el repo (solo existe el de Farmalógica; para
 * las demás empresas se devuelve data = null).
 */
export async function getPrediccion(companyId: number): Promise<{ data: unknown; origen: 'base' | 'repo' }> {
  const respaldo = companyId === PREDICCIONES_COMPANY_ID ? farmalogica : null;
  try {
    const existe = await prisma.$queryRaw<{ oid: number | null }[]>`
      SELECT OBJECT_ID(N'dbo.predictivo_snapshots', N'U') AS oid`;
    if (!existe[0]?.oid) return { data: respaldo, origen: 'repo' };
    const rows = await prisma.$queryRaw<{ payload: string }[]>`
      SELECT TOP 1 payload FROM dbo.predictivo_snapshots
      WHERE company_id = ${companyId}
      ORDER BY generated_at DESC, id DESC`;
    if (rows && rows.length > 0 && rows[0].payload) {
      return { data: JSON.parse(rows[0].payload), origen: 'base' };
    }
  } catch (error) {
    console.warn('Predicciones: no se pudo leer predictivo_snapshots, se usa el JSON del repo:', error);
  }
  return { data: respaldo, origen: 'repo' };
}
