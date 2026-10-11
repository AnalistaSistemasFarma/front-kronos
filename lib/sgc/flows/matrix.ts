/**
 * Matriz de responsables del SGC — funciones PURAS.
 *
 * La matriz SOLO SUGIERE (decisión de Nicolás del 2026-09-30): propone quién
 * elabora, revisa y aprueba según el proceso/área y el tipo documental; el
 * ELABORADOR decide y puede cambiarlo. Se configura por persona (correo) o por
 * cargo. Como en SynerLink no hay vínculo persona↔cargo en la base, una fila
 * por cargo se muestra como indicación («Cargo: …») para que el elaborador
 * elija a la persona (supuesto a validar con Nicolás).
 */

export const SGC_MATRIX_ROLES = ['elaborador', 'revisor', 'aprobador'] as const;
export type SgcMatrixRole = (typeof SGC_MATRIX_ROLES)[number];

export interface SgcMatrixEntry {
  id: number;
  role: SgcMatrixRole;
  idProcess: number | null;
  idDocumentType: number | null;
  userEmail: string | null;
  cargoName: string | null;
  sortOrder: number;
  isActive: boolean;
  isExample: boolean;
}

export interface SgcMatrixSuggestion {
  role: SgcMatrixRole;
  /** 3 = proceso y tipo; 2 = proceso; 1 = tipo; 0 = general de la empresa. */
  specificity: number;
  people: string[];
  cargos: string[];
  fromExample: boolean;
}

function specificityOf(e: SgcMatrixEntry, idProcess: number | null, idDocumentType: number | null): number | null {
  if (e.idProcess !== null && e.idProcess !== idProcess) return null;
  if (e.idDocumentType !== null && e.idDocumentType !== idDocumentType) return null;
  return (e.idProcess !== null ? 2 : 0) + (e.idDocumentType !== null ? 1 : 0);
}

/**
 * Para cada rol, las filas activas MÁS ESPECÍFICAS que aplican (proceso y
 * tipo > proceso > tipo > general), ordenadas por su orden.
 */
export function suggestResponsibles(
  entries: readonly SgcMatrixEntry[],
  target: { idProcess: number | null; idDocumentType: number | null }
): SgcMatrixSuggestion[] {
  const out: SgcMatrixSuggestion[] = [];
  for (const role of SGC_MATRIX_ROLES) {
    const scored = entries
      .filter((e) => e.isActive && e.role === role)
      .map((e) => ({ e, s: specificityOf(e, target.idProcess, target.idDocumentType) }))
      .filter((x): x is { e: SgcMatrixEntry; s: number } => x.s !== null);
    if (scored.length === 0) {
      out.push({ role, specificity: -1, people: [], cargos: [], fromExample: false });
      continue;
    }
    const best = Math.max(...scored.map((x) => x.s));
    const chosen = scored.filter((x) => x.s === best).sort((a, b) => a.e.sortOrder - b.e.sortOrder || a.e.id - b.e.id);
    out.push({
      role,
      specificity: best,
      people: [...new Set(chosen.map((x) => x.e.userEmail?.toLowerCase()).filter((v): v is string => !!v))],
      cargos: [...new Set(chosen.map((x) => x.e.cargoName).filter((v): v is string => !!v))],
      fromExample: chosen.some((x) => x.e.isExample),
    });
  }
  return out;
}
