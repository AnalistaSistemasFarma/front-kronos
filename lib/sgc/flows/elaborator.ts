/**
 * QUIÉN ELABORA una solicitud documental — función PURA.
 *
 * Pedido de Nicolás (2026-10-05, demo PiSA): el solicitante ya no elige al
 * elaborador; sale de la configuración del proceso. Orden de prioridad:
 *  1. La definición del paso de Elaboración del flujo validado: hoy solo dice
 *     «el elaborador de la solicitud» (asignación «elaborador»), no nombra
 *     persona, grupo ni rol, así que no decide quién es.
 *  2. La MATRIZ DE RESPONSABLES (Administración de flujos validados → pestaña
 *     «Matriz de responsables»), rol «elaborador», la fila más específica
 *     para proceso × tipo documental (proceso y tipo > proceso > tipo >
 *     general). Fila por persona (correo) o por cargo (las personas que
 *     Calidad registró en ese cargo). Las filas «de ejemplo» no asignan.
 *  3. Respaldo: Aseguramiento de Calidad (permiso de Calidad del SGC).
 * Entre varios candidatos del mismo nivel gana quien tiene MENOS solicitudes
 * abiertas como elaborador (empate: el orden de la matriz o el alfabético).
 *
 * Nunca queda el solicitante. Si la política exige que quien crea el
 * documento sea de Calidad (tarea_y_calidad), solo cuentan los de Calidad.
 * Calidad puede redirigir después con «Reasignar» (mecanismo existente).
 */

export type SgcElaboratorSource = 'matriz' | 'calidad';

export interface SgcElaboratorInput {
  requesterEmail: string;
  /** Personas de la matriz (rol elaborador, filas reales), en su orden: primero por correo, luego por cargo. */
  matrixPeople: readonly string[];
  /** Personas habilitadas en el SGC de la empresa (gestión o Calidad). */
  eligible: ReadonlySet<string>;
  /** Personas con el permiso de Aseguramiento de Calidad del SGC. */
  quality: ReadonlySet<string>;
  /** true si quien crea el documento debe tener el permiso de Calidad. */
  requireQuality: boolean;
  /** Solicitudes abiertas que hoy tiene cada persona como elaborador. */
  openLoad: ReadonlyMap<string, number>;
}

export interface SgcElaboratorChoice {
  email: string;
  source: SgcElaboratorSource;
  /** Candidatos válidos del nivel que decidió (para el historial). */
  candidates: string[];
  /** Personas de la matriz que no se pudieron usar y por qué. */
  discarded: { email: string; reason: string }[];
}

const low = (e: string) => e.trim().toLowerCase();

function pickLeastLoaded(candidates: readonly string[], load: ReadonlyMap<string, number>): string {
  let best = candidates[0];
  for (const c of candidates) if ((load.get(c) ?? 0) < (load.get(best) ?? 0)) best = c;
  return best;
}

/** Elige al elaborador según la configuración; null si nadie cumple (la solicitud no puede nacer). */
export function resolveElaborator(input: SgcElaboratorInput): SgcElaboratorChoice | null {
  const requester = low(input.requesterEmail);
  const discarded: { email: string; reason: string }[] = [];
  const matrix: string[] = [];
  for (const raw of input.matrixPeople) {
    const e = low(raw);
    if (!e || matrix.includes(e) || discarded.some((d) => d.email === e)) continue;
    if (e === requester) discarded.push({ email: e, reason: 'es quien hace la solicitud' });
    else if (!input.eligible.has(e)) discarded.push({ email: e, reason: 'no tiene permiso de gestión documental en el SGC de la empresa' });
    else if (input.requireQuality && !input.quality.has(e)) discarded.push({ email: e, reason: 'no tiene el permiso de Aseguramiento de Calidad' });
    else matrix.push(e);
  }
  if (matrix.length) return { email: pickLeastLoaded(matrix, input.openLoad), source: 'matriz', candidates: matrix, discarded };
  const quality = [...input.quality].map(low).filter((e) => e && e !== requester).sort();
  if (quality.length) return { email: pickLeastLoaded(quality, input.openLoad), source: 'calidad', candidates: quality, discarded };
  return null;
}

/** Texto del historial: de dónde salió el elaborador. */
export function describeElaboratorChoice(choice: SgcElaboratorChoice, matrixLabel: string | null): string {
  const others = choice.candidates.length > 1 ? ` Candidatos: ${choice.candidates.join(', ')} (se asigna a quien tiene menos solicitudes abiertas como elaborador).` : '';
  const skipped = choice.discarded.length ? ` No se tomó de la matriz a: ${choice.discarded.map((d) => `${d.email} (${d.reason})`).join('; ')}.` : '';
  const from =
    choice.source === 'matriz'
      ? `según la matriz de responsables${matrixLabel ? ` (${matrixLabel})` : ''}`
      : 'por respaldo: Aseguramiento de Calidad (la matriz de responsables no define un elaborador para este proceso y tipo documental)';
  return `Elaborador asignado por configuración ${from}: ${choice.email}.${others}${skipped} Aseguramiento de Calidad puede reasignar la elaboración.`;
}
