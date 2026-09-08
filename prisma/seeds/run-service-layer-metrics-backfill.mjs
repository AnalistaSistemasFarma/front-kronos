// @ts-check
/**
 * Backfill histórico del módulo "Métricas Service Layer" (OLP).
 *
 * Carga en ServiceLayerDailyMetric los ~104 días de tráfico del SAP
 * Business One Service Layer entre 2026-05-23 y 2026-09-03, contados
 * previamente en serfarma07 (192.168.10.7) contra el log del balanceador
 * (puerto 50000, recibe todo el tráfico -- no hace falta sumar los nodos
 * 50001-50010):
 *
 *   Get-ChildItem "C:\Program Files\SAP\SAP Business One ServerTools\ServiceLayer\logs" |
 *     Where-Object { $_.Name -match '^access_50000_log_2026_\d\d_\d\d$' } |
 *     Sort-Object Name |
 *     ForEach-Object { $c = (Get-Content $_.FullName | Measure-Object -Line).Lines; "$($_.Name)|$c" }
 *
 * Los datos ya contados quedan en service-layer-metrics-backfill-data.json
 * (mismo directorio) para que este script sea puramente de CARGA (Node +
 * Prisma, corrido DESDE pce0023 con su .env/DATABASE_URL real) -- separado
 * del paso de LECTURA/conteo en serfarma07, que se hizo una sola vez y no
 * hace falta repetir salvo que se quiera resembrar desde cero.
 *
 * Reutiliza upsertDailyMetric de lib/service-layer-metrics/collectDailyMetric
 * (vía metrics.ts) -- MISMA función que usa el job diario, así que backfill
 * y job diario nunca pueden desincronizar su lógica de escritura. Como este
 * script es .mjs (no pasa por el compilador de TypeScript de Next), evita
 * importar el .ts directo y reimplementa el upsert en línea con el MISMO
 * criterio (upsert por el único compuesto company+metric_date) -- si cambia
 * la lógica de upsertDailyMetric, replicar el cambio acá.
 *
 * Idempotente: correrlo de nuevo sobre datos ya cargados actualiza
 * (no duplica) por el único compuesto (company, metric_date).
 *
 * Uso:
 *   node prisma/seeds/run-service-layer-metrics-backfill.mjs
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '../../app/generated/prisma/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataPath = path.join(__dirname, 'service-layer-metrics-backfill-data.json');

// Valores conocidos para verificar que el backfill cargó bien (ver
// vault/metricas-servicelayer-synerlink.md).
const KNOWN_CHECKS = {
  '2026-08-13': 13843,
  '2026-07-22': 30466,
  '2026-05-23': 764,
};

const prisma = new PrismaClient();

async function main() {
  const raw = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const company = raw.company ?? 'OLP';
  const rows = raw.rows ?? [];

  console.log(`Cargando ${rows.length} días de "${company}" desde ${dataPath}`);

  let created = 0;
  let updated = 0;

  for (const row of rows) {
    const metricDate = new Date(`${row.date}T00:00:00.000Z`);
    const existing = await prisma.serviceLayerDailyMetric.findUnique({
      where: { company_metric_date: { company, metric_date: metricDate } },
    });

    await prisma.serviceLayerDailyMetric.upsert({
      where: { company_metric_date: { company, metric_date: metricDate } },
      create: { company, metric_date: metricDate, transaction_count: row.transactionCount },
      update: { transaction_count: row.transactionCount },
    });

    if (existing) updated += 1;
    else created += 1;
  }

  console.log(`OK: ${created} filas nuevas, ${updated} actualizadas. Total: ${rows.length}.`);

  console.log('\n--- Verificación de valores conocidos ---');
  let allOk = true;
  for (const [date, expected] of Object.entries(KNOWN_CHECKS)) {
    const metricDate = new Date(`${date}T00:00:00.000Z`);
    const row = await prisma.serviceLayerDailyMetric.findUnique({
      where: { company_metric_date: { company, metric_date: metricDate } },
    });
    const actual = row?.transaction_count;
    const ok = actual === expected;
    allOk = allOk && ok;
    console.log(`${date}: esperado=${expected} actual=${actual} -> ${ok ? 'OK' : 'MISMATCH'}`);
  }

  const total = await prisma.serviceLayerDailyMetric.count({ where: { company } });
  console.log(`\nTotal de días en BD para ${company}: ${total}`);

  if (!allOk) {
    console.error('ADVERTENCIA: al menos un valor conocido no coincide. Revisar antes de continuar.');
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error('Error corriendo el backfill de Métricas Service Layer:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
