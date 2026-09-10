import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { PrismaClient } from '../../app/generated/prisma';
import { SERVICE_LAYER_METRICS_DEFAULT_COMPANY, upsertDailyMetric } from './metrics';

const execFileAsync = promisify(execFile);

/**
 * Job diario del módulo "Métricas del Service Layer" (OLP).
 *
 * Corre en pce0023 (Tarea Programada de Windows, ver
 * scripts/service-layer-metrics-daily-job.mjs y
 * scripts/register-service-layer-metrics-task.ps1) -- NO en serfarma07: la
 * automatización vive acá, serfarma07 solo recibe una conexión SSH puntual
 * cada vez que este job corre, exactamente igual que una corrida manual
 * (mismo criterio que "SSH puntual sí, cron NO" para ese servidor).
 *
 * Autenticación: llave ed25519 dedicada, generada el 2026-09-03
 * específicamente para este job (NO la llave de horus), en
 * C:\Users\nicolas.rivera\.ssh\service_layer_metrics_serfarma07, agregada
 * como línea nueva (append) en
 * C:\ProgramData\ssh\administrators_authorized_keys de serfarma07 -- sin
 * tocar la entrada existente de horus. Ver nota del vault
 * metricas-servicelayer-synerlink.md para cómo rotarla/revocarla.
 *
 * Cuenta el log YA CERRADO de AYER (no el día en curso parcial): el job
 * corre a la 01:00 am, hora en la que el log del día anterior ya no recibe
 * escritura nueva, así que el conteo queda estable y comparable con el
 * resto de la serie histórica (que también son días completos). Mostrar el
 * día en curso a medias induciría a leer una caída de tráfico que en
 * realidad es solo "todavía no ha pasado el día".
 */

export const SERFARMA07_HOST = '192.168.10.7';
export const SERFARMA07_SSH_USER = 'administrador';
export const SERFARMA07_SSH_KEY_PATH =
  'C:\\Users\\nicolas.rivera\\.ssh\\service_layer_metrics_serfarma07';

const SERVICE_LAYER_LOG_DIR =
  'C:\\Program Files\\SAP\\SAP Business One ServerTools\\ServiceLayer\\logs';

/** Nombre del archivo de log del balanceador (puerto 50000) para una fecha YYYY-MM-DD. */
export function buildLogFileName(date: string): string {
  const [y, m, d] = date.split('-');
  return `access_50000_log_${y}_${m}_${d}`;
}

/**
 * Devuelve la fecha de AYER en formato YYYY-MM-DD, en hora local del
 * servidor donde corre (pce0023). Extraída aparte para poder testearla
 * inyectando un `now` fijo.
 */
export function getYesterdayDate(now: Date = new Date()): string {
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const y = yesterday.getFullYear();
  const m = String(yesterday.getMonth() + 1).padStart(2, '0');
  const d = String(yesterday.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Firma mínima de execFile que necesitamos, para poder inyectar un mock en pruebas. */
export type ExecFileFn = (
  file: string,
  args: string[]
) => Promise<{ stdout: string; stderr: string }>;

/**
 * Cuenta las líneas del log del Service Layer de una fecha puntual en
 * serfarma07, vía SSH (Get-Content ... | Measure-Object -Line), igual
 * que el script de backfill. Si el archivo no existe todavía (por ejemplo,
 * el job corrió antes de que rotara el log), devuelve null en vez de 0
 * para no sembrar un dato falso de "sin tráfico".
 */
export async function countServiceLayerLogLines(
  date: string,
  exec: ExecFileFn = execFileAsync
): Promise<number | null> {
  const fileName = buildLogFileName(date);
  const remoteCommand =
    `$p = '${SERVICE_LAYER_LOG_DIR}\\${fileName}'; ` +
    `if (-not (Test-Path $p)) { Write-Output 'MISSING'; exit 0 } ` +
    `$c = (Get-Content $p | Measure-Object -Line).Lines; Write-Output "COUNT:$c"`;

  const { stdout } = await exec('ssh', [
    '-i',
    SERFARMA07_SSH_KEY_PATH,
    '-o',
    'BatchMode=yes',
    '-o',
    'ConnectTimeout=15',
    `${SERFARMA07_SSH_USER}@${SERFARMA07_HOST}`,
    `powershell -NoProfile -Command "${remoteCommand}"`,
  ]);

  const trimmed = stdout.trim();
  if (trimmed.includes('MISSING')) return null;

  const match = trimmed.match(/COUNT:(\d+)/);
  if (!match) {
    throw new Error(`No se pudo interpretar la salida del conteo de log para ${date}: "${trimmed}"`);
  }
  return Number(match[1]);
}

export interface CollectDailyMetricResult {
  date: string;
  transactionCount: number | null;
  skipped: boolean;
}

/**
 * Orquesta un ciclo del job diario: calcula la fecha de ayer, cuenta el
 * log en serfarma07 y hace upsert en ServiceLayerDailyMetric. `exec` y
 * `now` son inyectables para pruebas (ver __tests__/collectDailyMetric.test.ts
 * -- ningún test real dispara SSH).
 */
export async function collectDailyMetric(
  prisma: Pick<PrismaClient, 'serviceLayerDailyMetric'>,
  options: { now?: Date; exec?: ExecFileFn; company?: string } = {}
): Promise<CollectDailyMetricResult> {
  const date = getYesterdayDate(options.now);
  const company = options.company ?? SERVICE_LAYER_METRICS_DEFAULT_COMPANY;
  const transactionCount = await countServiceLayerLogLines(date, options.exec);

  if (transactionCount === null) {
    return { date, transactionCount: null, skipped: true };
  }

  await upsertDailyMetric(prisma, { company, date, transactionCount });
  return { date, transactionCount, skipped: false };
}
