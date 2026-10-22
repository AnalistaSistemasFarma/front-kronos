/**
 * COLA DE HILOS — serie dentro de cada hilo, paralelo entre hilos, con tope.
 *
 * Dos reglas, y las dos son de seguridad, no de rendimiento:
 *
 *   1. UNA SESIÓN NO CORRE DOS VECES A LA VEZ. Dos `claude -p --resume` sobre
 *      el mismo session_id escriben la misma bitácora y la corrompen (o el
 *      segundo arranca una copia). Por eso, mientras un hilo trabaja, lo que
 *      le llegue se ACUMULA y sale en el siguiente turno, todo junto.
 *   2. TOPE DE HILOS SIMULTÁNEOS POR AGENTE (2 en F1). Cada turno consume del
 *      mismo límite de la cuenta; sin tope, diez personas escribiendo a la vez
 *      serían diez procesos del modelo.
 *
 * La cola no sabe nada de SynerLink ni de Claude: recibe `ejecutar(clave,
 * lote)` y lo llama con los elementos acumulados de esa clave. Así se prueba
 * sola (test/cola.test.mjs).
 */
export class ColaHilos {
  /**
   * @param {{ maxConcurrencia: number, ejecutar: (clave: string, lote: any[]) => Promise<void>,
   *           alEsperar?: (clave: string) => void, alError?: (clave: string, err: unknown) => void }} opciones
   */
  constructor({ maxConcurrencia, ejecutar, alEsperar, alError }) {
    if (!Number.isInteger(maxConcurrencia) || maxConcurrencia < 1) {
      throw new Error('maxConcurrencia debe ser un entero >= 1.');
    }
    this.max = maxConcurrencia;
    this.ejecutar = ejecutar;
    this.alEsperar = alEsperar ?? (() => {});
    this.alError = alError ?? (() => {});
    /** clave -> elementos pendientes */
    this.pendientes = new Map();
    /** claves en ejecución */
    this.corriendo = new Set();
    /** orden de llegada de las claves que esperan turno global */
    this.turnos = [];
    /** para esperar a que se vacíe (pruebas y apagado ordenado) */
    this.esperandoVacio = [];
    /** hay un despacho programado para la siguiente vuelta */
    this.programado = false;
    /** hilos a los que ya se les avisó que esperan turno */
    this.avisados = new Set();
  }

  /** Agrega un elemento al hilo `clave` y lo despacha si se puede. */
  encolar(clave, elemento) {
    const lista = this.pendientes.get(clave) ?? [];
    lista.push(elemento);
    this.pendientes.set(clave, lista);
    if (!this.corriendo.has(clave) && !this.turnos.includes(clave)) {
      this.turnos.push(clave);
    }
    // Se despacha en la siguiente vuelta del bucle de eventos y no ya: así los
    // mensajes que llegan JUNTOS (una misma vuelta de la bandeja) salen en UN
    // solo turno del modelo en vez de uno por mensaje.
    if (!this.programado) {
      this.programado = true;
      setImmediate(() => {
        this.programado = false;
        this.#despachar();
      });
    }
  }

  /** Cuántos hilos corren y cuántos esperan (para el indicador y las pruebas). */
  estado() {
    return {
      corriendo: [...this.corriendo],
      esperando: [...this.turnos],
      pendientes: Object.fromEntries([...this.pendientes].map(([k, v]) => [k, v.length])),
    };
  }

  /** Promesa que se cumple cuando no queda nada corriendo ni pendiente. */
  vacia() {
    if (this.corriendo.size === 0 && this.turnos.length === 0 && !this.programado) return Promise.resolve();
    return new Promise((resolve) => this.esperandoVacio.push(resolve));
  }

  #despachar() {
    while (this.corriendo.size < this.max && this.turnos.length > 0) {
      const clave = this.turnos.shift();
      const lote = this.pendientes.get(clave) ?? [];
      this.pendientes.delete(clave);
      this.avisados.delete(clave);
      if (lote.length === 0) continue;
      this.corriendo.add(clave);
      Promise.resolve()
        .then(() => this.ejecutar(clave, lote))
        .catch((err) => this.alError(clave, err))
        .finally(() => {
          this.corriendo.delete(clave);
          // Lo que llegó mientras corría: vuelve a la fila (al final, para no
          // acaparar el turno global frente a otros hilos que esperan).
          if ((this.pendientes.get(clave) ?? []).length > 0 && !this.turnos.includes(clave)) {
            this.turnos.push(clave);
          }
          this.#despachar();
        });
    }
    // Los que se quedaron sin cupo: se les avisa UNA vez que esperan turno.
    for (const clave of this.turnos) {
      if (!this.avisados.has(clave)) {
        this.avisados.add(clave);
        this.alEsperar(clave);
      }
    }
    if (this.corriendo.size === 0 && this.turnos.length === 0 && !this.programado) {
      const cbs = this.esperandoVacio.splice(0);
      for (const cb of cbs) cb();
    }
  }
}
