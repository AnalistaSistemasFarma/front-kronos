import sql from 'mssql';
import sqlConfig from '../../../../dbconfig';
import { NextResponse } from 'next/server';

export async function GET(req) {
  try {
    const pool = await sql.connect(sqlConfig);

    const query = `
      SELECT 
        suc.id_subprocess_user_company, 
        s.subprocess, 
        suc.id_company_user, 
        u.name
      FROM subprocess_user_company suc
      LEFT JOIN subprocess s ON s.id_subprocess = suc.id_subprocess
      LEFT JOIN company_user cu ON cu.id_company_user = suc.id_company_user
      LEFT JOIN [user] u ON u.id = cu.id_user
      WHERE s.id_subprocess = 1
    `;

    const request = pool.request();
    const result = await request.query(query);

    return NextResponse.json(result.recordset, { status: 200 });
  } catch (error) {
    console.error('Error fetching subprocess users:', error);
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    );
  }
}