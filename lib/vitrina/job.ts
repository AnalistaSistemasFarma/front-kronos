import 'server-only';
import { prisma } from '../prisma';
import { runVitrinaScheduledJob } from './syncDb';

/**
 * job_type 'vitrina_sincronizar_sap' (lib/scheduler/handlers.js): lectura nocturna
 * del SAP de Farmalógica y de Ryan para la Vitrina Comercial, en SOLO LECTURA.
 * Lo siembra prisma/manual/2026-10-22-vitrina-subprocesos-*.sql (2:00 a. m.).
 * Payload opcional: { companies: [1, 2] }.
 */
export async function runVitrinaSyncJob(payload: { companies?: unknown } | null): Promise<{ ref: string; detail: string }> {
  return runVitrinaScheduledJob(prisma, payload);
}
