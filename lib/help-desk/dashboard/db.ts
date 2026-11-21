import { prisma } from '../../prisma';
import type { HelpdeskCaseRow } from './aggregate';

/**
 * Loads ONE compact row per help desk case (no subject, description or
 * resolution text). Category, subcategory and activity come from the latest
 * category_case row of each case, as in /api/help-desk/dashboard-cases.
 */
export async function loadHelpdeskCaseRows(): Promise<HelpdeskCaseRow[]> {
  return prisma.$queryRaw<HelpdeskCaseRow[]>`
    SELECT
      c.id_case          AS id,
      c.creation_date    AS createdAt,
      c.end_date         AS endDate,
      c.id_status_case   AS statusId,
      sc.status          AS status,
      c.case_type        AS caseType,
      c.company          AS companyId,
      co.company         AS company,
      d.department       AS department,
      u.name             AS technician,
      cat.category       AS category,
      cat.subcategory    AS subcategory,
      cat.activity       AS activity
    FROM [case] c
    LEFT JOIN status_case sc ON sc.id_status_case = c.id_status_case
    LEFT JOIN department d ON d.id_department = c.id_department
    LEFT JOIN subprocess_user_company suc ON suc.id_subprocess_user_company = c.id_technical
    LEFT JOIN company_user cu ON cu.id_company_user = suc.id_company_user
    LEFT JOIN [user] u ON u.id = cu.id_user
    LEFT JOIN company co ON co.id_company = c.company
    OUTER APPLY (
      SELECT TOP 1 cg.category, sg.subcategory, a.activity
      FROM category_case cc
      LEFT JOIN category cg ON cg.id_category = cc.id_category
      LEFT JOIN subcategory sg ON sg.id_subcategory = cc.id_subcategory
      LEFT JOIN activity a ON a.id_activity = cc.id_activity
      WHERE cc.id_case = c.id_case
      ORDER BY cc.id_category_case DESC
    ) cat
  `;
}
