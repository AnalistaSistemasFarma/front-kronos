/**
 * Orden entre la decisión del autorizador y las Tareas SAP siguientes.
 *
 * update-activities lanza en segundo plano (1) el registro de la decisión en SAP
 * (Compras / Ventas) y (2) el motor de Tareas SAP. Las dos escriben en el mismo
 * borrador, así que el motor debe arrancar cuando la decisión ya terminó (bien o mal):
 * si arrancan a la vez, SAP rechaza una de las dos con −2039 (regresión 2026-11-04).
 */
export function runAfterSettled<T>(
  before: ReadonlyArray<PromiseLike<unknown> | unknown>,
  run: () => Promise<T> | T
): Promise<T> {
  return Promise.allSettled(before.map((p) => Promise.resolve(p))).then(() => run());
}
