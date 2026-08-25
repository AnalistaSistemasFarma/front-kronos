import { NextResponse } from 'next/server';
import { sql, withMssqlPool } from '../../../../lib/mssqlPool';

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const companyId = searchParams.get('companyId');

    const queryCompanies = `
      SELECT 
        c.id_company, c.company
      FROM company c
    `;

    let queryCategories = `
      SELECT 
        c.id_company, cr.id, c.company, cr.category
      FROM company_category_request ccr
      INNER JOIN company c 
        ON c.id_company = ccr.id_company
      INNER JOIN category_request cr 
        ON cr.id = ccr.id_category_request
      WHERE cr.active = 1
    `;

    if (companyId) {
      queryCategories += ` AND c.id_company = @companyId`;
    }

    queryCategories += ` ORDER BY cr.category`;

    let queryCategoriesNew = `
      SELECT DISTINCT
        category
      FROM category_request
      WHERE active = 1
    `;

    queryCategoriesNew += ` ORDER BY category`;

    let queryProcessCategoriesNew = `
      SELECT DISTINCT
        process
      FROM process_category
      WHERE active = 1
    `;

    queryProcessCategoriesNew += ` ORDER BY process`;

    const queryProcessCategories = `
      SELECT
        pc.id as id_process,
        pc.process,
        pc.id_category_request,
        cr.category,
        u.email,
        pc.description,
		    pc.active
      FROM process_category pc
      INNER JOIN category_request cr
        ON cr.id = pc.id_category_request
      LEFT JOIN [user] u
        ON u.id = pc.assigned
      ORDER BY pc.process
    `;

    const queryAssignedUsers = `
      SELECT DISTINCT
        u.id,
        u.name
      FROM [user] u
      INNER JOIN process_category pc ON pc.assigned = u.id
      WHERE u.name IS NOT NULL AND u.name != ''
      ORDER BY u.name
    `;

    const [companiesRes, categoriesRes, processCategoriesRes, assignedUsersRes, categoriesNewRes, processCategoriesNewRes] =
      await withMssqlPool(async (pool) => {
        const categoriesRequest = pool.request();
        if (companyId) {
          categoriesRequest.input('companyId', sql.Int, Number(companyId));
        }

        return Promise.all([
          pool.request().query(queryCompanies),
          categoriesRequest.query(queryCategories),
          pool.request().query(queryProcessCategories),
          pool.request().query(queryAssignedUsers),
          pool.request().query(queryCategoriesNew),
          pool.request().query(queryProcessCategoriesNew),
        ]);
      });

    return NextResponse.json(
      {
        companies: companiesRes.recordset,
        categories: categoriesRes.recordset,
        processCategories: processCategoriesRes.recordset,
        assignedUsers: assignedUsersRes.recordset,
        categoriesNew: categoriesNewRes.recordset,
        processCategoriesNew: processCategoriesNewRes.recordset,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error('Error en el procesamiento de la solicitud:', err);
    return NextResponse.json(
      { error: 'Error procesando la solicitud', details: err.message },
      { status: 500 }
    );
  }
}
