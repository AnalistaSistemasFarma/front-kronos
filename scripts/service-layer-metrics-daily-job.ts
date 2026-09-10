/**
 * Job diario del módulo "Métricas Service Layer" (OLP).
 *
 * Corre en pce0023 vía Tarea Programada de Windows (ver
 * scripts/register-service-layer-metrics-task.ps1 -- tarea
 * "SynerLink-ServiceLayerMetrics-Daily", 01:00 am todos los días).
 *
 * A las 01:00 am el log del día ANTERIOR ya cerró (SAP Service Layer no le
 * sigue escribiendo pasada la medianoche), así que collectDailyMetric()
 * cuenta el día de ayer -- no el día en curso a medias, para no sembrar un
 * dato parcial que luego "cae" cuando se compara con el resto de la serie
 * (ver lib/service-layer-metrics/collectDailyMetric.ts).
 *
 * Ejecutar manualmente para probar:
 *   npx tsx scripts/service-layer-metrics-daily-job.ts
 */
import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { collectDailyMetric } from '../lib/service-layer-metrics/collectDailyMetric';

async function main() {
  const result = await collectDailyMetric(prisma);

  if (result.skipped) {
    console.warn(
      `[service-layer-metrics] El log de ${result.date} todavía no existe en serfarma07 -- se omite este ciclo (probablemente corrió antes de que rotara el log).`
    );
    return;
  }

  console.log(
    `[service-layer-metrics] ${result.date}: ${result.transactionCount} transacciones (upsert OK, company=OLP).`
  );
}

main()
  .catch((err) => {
    console.error('[service-layer-metrics] Error en el job diario:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
