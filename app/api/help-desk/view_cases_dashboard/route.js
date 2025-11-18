import sql from 'mssql';
import sqlConfig from '../../../../dbconfig';
import { NextResponse } from 'next/server';

export async function GET(_req) {
  try {
    const pool = await sql.connect(sqlConfig);

    // Query for time series data - daily count of new cases in last 30 days
    const timeSeriesQuery = `
      SELECT
        CAST(creation_date AS DATE) as date,
        COUNT(*) as count
      FROM [case]
      WHERE creation_date >= DATEADD(DAY, -30, GETDATE())
      GROUP BY CAST(creation_date AS DATE)
      ORDER BY CAST(creation_date AS DATE)
    `;

    // Query for existing view_cases data
    const casesQuery = `
      SELECT
        *
      FROM [view_cases]
    `;

    const request = pool.request();

    const [timeSeriesResult, casesResult] = await Promise.all([
      request.query(timeSeriesQuery),
      request.query(casesQuery),
    ]);

    // Format time series data for the chart
    const timeSeriesData = timeSeriesResult.recordset.map((row) => ({
      date: row.date.toISOString().split('T')[0], // Format as YYYY-MM-DD
      count: parseInt(row.count),
    }));

    // Fill in missing dates with zero counts for the last 30 days
    const today = new Date();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(today.getDate() - 30);

    const filledTimeSeriesData = [];
    for (let d = new Date(thirtyDaysAgo); d <= today; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0];
      const existingData = timeSeriesData.find((item) => item.date === dateStr);
      filledTimeSeriesData.push({
        date: dateStr,
        count: existingData ? existingData.count : 0,
      });
    }

    return NextResponse.json(
      {
        timeSeriesData: filledTimeSeriesData,
        casesData: casesResult.recordset,
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
