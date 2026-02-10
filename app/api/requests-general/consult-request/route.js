import sql from 'mssql';
import sqlConfig from '../../../../dbconfig';
import { NextResponse } from 'next/server';

export async function GET(_req) {
  try {
    const pool = await sql.connect(sqlConfig);

    // --- Consultas ---
    const queryCompanies = `
      SELECT 
        c.id_company, c.company
      FROM company c
    `;

    const queryCategories = `
      SELECT * FROM category_request
    `;

    const queryProcessCategories = `
      SELECT
        pc.id as id_process,
        pc.process,
        pc.id_category_request,
        cr.category,
        u.email,
        pc.description
      FROM process_category pc
      INNER JOIN category_request cr
        ON cr.id = pc.id_category_request
      LEFT JOIN [user] u
        ON u.id = pc.assigned
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

    // Ejecutar en paralelo para mejorar rendimiento
    const [companiesRes, categoriesRes, processCategoriesRes, assignedUsersRes] = await Promise.all(
      [
        pool.request().query(queryCompanies),
        pool.request().query(queryCategories),
        pool.request().query(queryProcessCategories),
        pool.request().query(queryAssignedUsers),
      ]
    );

    return NextResponse.json(
      {
        companies: companiesRes.recordset,
        categories: categoriesRes.recordset,
        processCategories: processCategoriesRes.recordset,
        assignedUsers: assignedUsersRes.recordset,
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
