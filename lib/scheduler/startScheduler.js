import cron from 'node-cron';
import { runDueJobs } from './runner.js';

export function startScheduler() {
  if (globalThis.__kronosSchedulerStarted) return;
  if (process.env.SCHEDULER_DISABLED === 'true') {
    console.log('[scheduler] Deshabilitado por SCHEDULER_DISABLED');
    return;
  }
  const instance = process.env.NODE_APP_INSTANCE;
  if (instance !== undefined && instance !== '0') return;

  globalThis.__kronosSchedulerStarted = true;

  let running = false;
  cron.schedule('* * * * *', async () => {
    if (running) return;
    running = true;
    try {
      const summary = await runDueJobs();
      if (summary.due > 0 || summary.errors > 0) {
        console.log('[scheduler] Ejecución:', JSON.stringify(summary));
      }
    } catch (err) {
      console.error('[scheduler] Error en el tick:', err);
    } finally {
      running = false;
    }
  });

  console.log(`[scheduler] Iniciado (instancia ${instance ?? 'única'}), tick cada minuto`);
}
