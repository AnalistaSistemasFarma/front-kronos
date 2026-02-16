import sql from 'mssql';
import sqlConfig from '../../../../dbconfig';
import { NextResponse } from 'next/server';

export async function GET(req) {
  let pool;

  try {
    const { searchParams } = new URL(req.url);
    const companyId = searchParams.get('companyId');

    pool = await sql.connect(sqlConfig);

    let queryCategories = `
      SELECT 
        c.id_company as id,
        cr.id AS id_category,
        c.company,
        cr.category,
        u.id AS id_assigned_category,
        u.name AS assigned_category
      FROM company_category_request ccr
      INNER JOIN company c 
        ON c.id_company = ccr.id_company
      INNER JOIN category_request cr 
        ON cr.id = ccr.id_category_request
      INNER JOIN user_category_request_general ucrg
        ON ucrg.id_category = cr.id
      INNER JOIN [user] u
        ON u.id = ucrg.id_user
    `;

    const categoriesRequest = pool.request();

    if (companyId && !isNaN(companyId)) {
      queryCategories += ` WHERE c.id_company = @companyId`;
      categoriesRequest.input('companyId', sql.Int, Number(companyId));
    }

    queryCategories += ` ORDER BY cr.category`;

    const queryProcessCategories = `
      SELECT 
        upcrg.id_process_category as id_process,
        pc.process,
        u.id AS id_assigned,
        u.name AS assigned_process
      FROM user_process_category_request_general upcrg
      INNER JOIN process_category pc
        ON pc.id = upcrg.id_process_category
      INNER JOIN [user] u 
        ON u.id = upcrg.id_user
      ORDER BY pc.process
    `;

    const queryAssignedUsers = `
      SELECT DISTINCT
        u.id,
        u.name
      FROM [user] u
      WHERE u.name IS NOT NULL 
        AND u.name <> ''
      ORDER BY u.name
    `;

    const queryCompany = `
      SELECT 
		c.id_company, c.company
	  FROM company c
    `;

    const [categoriesRes, processCategoriesRes, assignedUsersRes, companies] =
      await Promise.all([
        categoriesRequest.query(queryCategories),
        pool.request().query(queryProcessCategories),
        pool.request().query(queryAssignedUsers),
        pool.request().query(queryCompany),
      ]);


    return NextResponse.json(
      {
        categories: categoriesRes.recordset,
        processCategories: processCategoriesRes.recordset,
        assignedUsers: assignedUsersRes.recordset,
        companies: companies.recordset,
      },
      { status: 200 }
    );

  } catch (err) {

    console.error('Error en endpoint:', err);

    return NextResponse.json(
      {
        error: 'Error procesando la solicitud',
        details: err.message,
      },
      { status: 500 }
    );

  } finally {
    if (pool) {
      await pool.close();
    }
  }
}
