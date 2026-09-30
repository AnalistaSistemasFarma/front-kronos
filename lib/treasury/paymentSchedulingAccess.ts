import 'server-only';
import { prisma } from '../prisma';

/**
 * Permisos del "Programador de Pagos" (tesorería) — mismo esquema que
 * Asistente de Pagos y Balances (process -> subprocess -> subprocess_user_company).
 *
 * El subproceso se identifica por su URL (en KRONOSDB es el id 84 y en
 * KRONOSDB_PRUEBAS el 87, por eso NO se usa el id). Cada fila está atada a un
 * company_user, así que además de habilitar el módulo define EN QUÉ EMPRESAS
 * puede ver las programaciones de pago. Sin filas -> sin acceso (fail-closed).
 */

export const PAYMENT_SCHEDULING_URL = '/process/working-capital/payments-scheduling';

export async function getPaymentSchedulingCompanies(userEmail: string): Promise<number[]> {
  const rows = await prisma.subprocessUserCompany.findMany({
    where: {
      companyUser: { user: { email: userEmail } },
      subprocess: { subprocess_url: PAYMENT_SCHEDULING_URL },
    },
    select: { companyUser: { select: { id_company: true } } },
  });
  return [...new Set(rows.map((r) => r.companyUser.id_company))];
}
