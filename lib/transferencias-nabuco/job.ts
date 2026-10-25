import 'server-only';
import { enviarAlerta } from './alertas';
import { listarConfigs, marcarAlertaSinCorrer } from './db';
import { correrConfig, textoResumen } from './motor';

/**
 * job_type 'nabuco_transferir' (lib/scheduler/handlers.js). Payload: { id_config }.
 * La tarea la crea/edita la pantalla del módulo al guardar cada configuración.
 * El resumen queda en scheduled_job_run (detail) como cualquier tarea del programador.
 */
export async function runNabucoTransferirJob(payload: { id_config?: unknown } | null): Promise<{ ref: string; detail: string }> {
  const id = Number(payload?.id_config);
  if (!Number.isInteger(id) || id <= 0) throw new Error('Payload inválido: se requiere { id_config }.');
  const r = await correrConfig(id);
  const detail = textoResumen(r, r.simulacion);
  if (!r.omitido && r.errores > 0 && r.enviados + r.simulados === 0) {
    // Corrida con solo errores: queda como 'error' en scheduled_job_run.
    throw new Error(detail);
  }
  return { ref: `config:${id}`, detail };
}

/**
 * job_type 'nabuco_vigilar' (cada 15 min, sembrado por el SQL): avisa a los destinatarios de
 * cada config activa con «alertar si no corre en N minutos» cuando su tarea no corre hace N
 * minutos. Repite el aviso como mucho cada N minutos.
 */
export async function runNabucoVigilarJob(): Promise<{ ref: string; detail: string }> {
  const configs = await listarConfigs();
  const ahora = Date.now();
  let alertas = 0;
  for (const c of configs) {
    const n = c.alertar_sin_correr_min;
    if (!c.activo || !n || !c.alertas_correos.length) continue;
    const ultima = c.last_run_date ? new Date(c.last_run_date).getTime() : 0;
    if (ultima && ahora - ultima < n * 60000) continue;
    const yaAviso = c.ultima_alerta_sin_correr ? new Date(c.ultima_alerta_sin_correr).getTime() : 0;
    if (yaAviso && ahora - yaAviso < n * 60000) continue;
    const enviados = await enviarAlerta(
      c.alertas_correos,
      `«${c.nombre}» no ha corrido en ${n} minutos`,
      [{ Configuración: c.nombre }, { 'Última corrida': c.last_run_date ? new Date(c.last_run_date).toLocaleString('es-CO', { timeZone: 'America/Bogota' }) : 'Nunca' }, { Programación: c.cron_expression ?? '—' }],
      'Revise que la tarea esté activa en SynerLink → Transferencias Nabuco y que el programador central esté corriendo.'
    );
    if (enviados > 0) {
      await marcarAlertaSinCorrer(c.id_config);
      alertas += 1;
    }
  }
  return { ref: 'nabuco_vigilar', detail: `Configuraciones revisadas: ${configs.length}; alertas enviadas: ${alertas}.` };
}
