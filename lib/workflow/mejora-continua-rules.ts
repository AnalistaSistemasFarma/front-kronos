/**
 * MEJORA CONTINUA de los flujos de trabajo — reglas PURAS (sin base de datos).
 *
 * Pedido de Nicolás Rivera (2026-11-09, proyecto «Reporte de estado de la IA»): punto 8,
 * «automejora de los procesos de SynerLink». Dentro del editor de Flujos de trabajo, un
 * panel muestra cómo funciona el flujo en la realidad (últimos 6 meses), pinta cada tarea
 * como un semáforo y sugiere ajustes concretos del editor, con su evidencia. Una persona
 * decide: «Aplicar» deja el cambio listo en el editor y ella guarda como siempre.
 *
 * Todo lo que se calcula aquí es EXACTO (no hay IA en las cifras). Diseño:
 * docs/flujos-mejora-continua.md.
 */

export const DIAS_HISTORIA = 180;
/** Con menos casos resueltos una tarea no se califica (no hay evidencia suficiente). */
export const MIN_CASOS = 5;
const DIA_MS = 86_400_000;

/* ───────────────────────────── Entradas ───────────────────────────── */

export interface TareaDef {
  id: number;
  nombre: string;
  orden: number;
  secuencial: boolean;
  autorizacion: boolean;
  tipo: string | null; // 'normal' | 'authorization' | 'sap_executor'
  /** Personas en «Asignado a» de la tarea. */
  asignados: number;
}

export interface Solicitud {
  id: number;
  creada: Date;
  resuelta: Date | null;
  /** status_case: 1 Abierto, 2 Resuelto, 3 Cancelado, 4 Sin empezar, 5 Por autorizar, 6 Borrador, 7 Devuelta. */
  estado: number | null;
}

export interface TareaInstancia {
  idSolicitud: number;
  idTarea: number;
  estado: number | null; // 2 resuelta, 3 cancelada, 1/4/5 pendiente
  resuelta: Date | null;
  ejecutor: string | null;
  resolucion: string | null;
}

export interface Nota {
  idSolicitud: number;
  texto: string;
}

export interface ErroresSap {
  idTarea: number;
  total: number;
  errores: number;
}

/* ───────────────────────────── Salidas ───────────────────────────── */

export type Semaforo = 'verde' | 'ambar' | 'rojo' | 'sin_datos';

export interface DiagnosticoTarea {
  idTarea: number;
  nombre: string;
  casos: number;
  medianaDias: number | null;
  p90Dias: number | null;
  /** Parte del tiempo total del flujo que se va en esta tarea (0–1). */
  participacion: number;
  pendientes: number;
  pendientesMedianaDias: number | null;
  rechazos: number;
  canceladas: number;
  /** Quién resolvió más casos y qué parte. */
  principal: { id: string; parte: number } | null;
  semaforo: Semaforo;
}

export interface Sugerencia {
  /** Estable entre semanas: «tipo:idTarea» (o «tipo:flujo»). */
  clave: string;
  tipo: 'paralelizar' | 'suplente' | 'repartir' | 'obligatorio' | 'autorizacion' | 'sap' | 'sin_uso';
  idTarea: number | null;
  titulo: string;
  explicacion: string;
  evidencia: string;
  impacto: string | null;
  /** Qué hace «Aplicar» en el editor. */
  accion: { tipo: 'quitar_secuencial'; idTarea: number } | { tipo: 'resaltar'; idTarea: number | null; campo: string };
}

export interface Diagnostico {
  desde: string;
  solicitudes: number;
  resueltas: number;
  cicloMedianaDias: number | null;
  cicloP90Dias: number | null;
  abiertas: number;
  devueltas: number;
  /** Solicitudes con notas que hablan de devolución, corrección o faltantes. */
  conRetrabajo: number;
  tareas: DiagnosticoTarea[];
  sugerencias: Sugerencia[];
}

/* ───────────────────────────── Utilidades ───────────────────────────── */

export function percentil(valores: number[], p: number): number | null {
  if (valores.length === 0) return null;
  const v = [...valores].sort((a, b) => a - b);
  const i = (v.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return v[lo] + (v[hi] - v[lo]) * (i - lo);
}

const redondear = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);

/** «1,5 días», «3 horas». */
export function textoDias(d: number | null): string {
  if (d === null) return '—';
  if (d < 1) {
    const h = Math.max(1, Math.round(d * 24));
    return `${h} ${h === 1 ? 'hora' : 'horas'}`;
  }
  const r = Math.round(d * 10) / 10;
  return `${r.toLocaleString('es-CO')} ${r === 1 ? 'día' : 'días'}`;
}

const pct = (x: number) => `${Math.round(x * 100)} %`;

const RE_RECHAZO = /rechaz|deneg|no aprob|no autoriz/i;
const RE_RETRABAJO = /devuel|devolv|correg|corrij|correcci|ajust|falta|incomplet|error en|no adjunt|vuelva a/i;
const RE_DOCUMENTO = /document|soporte|adjunt|anexo|factura|certificad|archivo/i;

/* ───────────────────────────── Cálculo ───────────────────────────── */

/**
 * Momento en que cada tarea de una solicitud QUEDÓ DISPONIBLE: las secuenciales cuando se
 * resolvió la última tarea anterior (por orden); las demás, cuando se creó la solicitud.
 * (start_date de la base no sirve: viene en otra zona horaria y a veces vacío.)
 */
function disponibilidad(sol: Solicitud, inst: TareaInstancia[], defs: Map<number, TareaDef>): Map<TareaInstancia, Date> {
  const out = new Map<TareaInstancia, Date>();
  const orden = (t: TareaInstancia) => defs.get(t.idTarea)?.orden ?? 0;
  for (const t of inst) {
    const def = defs.get(t.idTarea);
    let desde = sol.creada;
    if (def?.secuencial) {
      for (const o of inst) {
        if (o !== t && orden(o) < orden(t) && o.resuelta && o.resuelta > desde) desde = o.resuelta;
      }
    }
    out.set(t, desde);
  }
  return out;
}

export function diagnosticar(entrada: {
  ahora: Date;
  tareas: TareaDef[];
  solicitudes: Solicitud[];
  instancias: TareaInstancia[];
  notas: Nota[];
  erroresSap: ErroresSap[];
  nombres?: Map<string, string>;
}): Diagnostico {
  const { ahora, tareas, solicitudes, instancias, notas, erroresSap } = entrada;
  const nombres = entrada.nombres ?? new Map<string, string>();
  const defs = new Map(tareas.map((t) => [t.id, t]));
  const porSolicitud = new Map<number, TareaInstancia[]>();
  for (const i of instancias) {
    const l = porSolicitud.get(i.idSolicitud) ?? [];
    l.push(i);
    porSolicitud.set(i.idSolicitud, l);
  }

  // Duraciones por tarea (días) y pendientes.
  const dur = new Map<number, number[]>();
  const pend = new Map<number, number[]>();
  const ejec = new Map<number, Map<string, number>>();
  const rech = new Map<number, number>();
  const canc = new Map<number, number>();
  for (const s of solicitudes) {
    const inst = porSolicitud.get(s.id) ?? [];
    const disp = disponibilidad(s, inst, defs);
    for (const t of inst) {
      const d0 = disp.get(t)!;
      if (t.estado === 3) {
        canc.set(t.idTarea, (canc.get(t.idTarea) ?? 0) + 1);
        continue;
      }
      if (t.resuelta) {
        const dias = Math.max(0, (t.resuelta.getTime() - d0.getTime()) / DIA_MS);
        (dur.get(t.idTarea) ?? dur.set(t.idTarea, []).get(t.idTarea)!).push(dias);
        if (t.ejecutor) {
          const m = ejec.get(t.idTarea) ?? new Map<string, number>();
          m.set(t.ejecutor, (m.get(t.ejecutor) ?? 0) + 1);
          ejec.set(t.idTarea, m);
        }
        if (t.resolucion && RE_RECHAZO.test(t.resolucion)) rech.set(t.idTarea, (rech.get(t.idTarea) ?? 0) + 1);
      } else if (!s.resuelta && s.estado !== 3) {
        (pend.get(t.idTarea) ?? pend.set(t.idTarea, []).get(t.idTarea)!).push(Math.max(0, (ahora.getTime() - d0.getTime()) / DIA_MS));
      }
    }
  }

  const totalTiempo = [...dur.values()].reduce((s, l) => s + l.reduce((a, b) => a + b, 0), 0);
  const medianas = tareas.map((t) => percentil(dur.get(t.id) ?? [], 0.5)).filter((x): x is number => x !== null);
  const medianaDeMedianas = percentil(medianas, 0.5) ?? 0;

  const diagTareas: DiagnosticoTarea[] = [...tareas]
    .sort((a, b) => a.orden - b.orden)
    .map((t) => {
      const l = dur.get(t.id) ?? [];
      const mediana = percentil(l, 0.5);
      const participacion = totalTiempo > 0 ? l.reduce((a, b) => a + b, 0) / totalTiempo : 0;
      const e = ejec.get(t.id);
      let principal: DiagnosticoTarea['principal'] = null;
      if (e && l.length > 0) {
        const [id, n] = [...e.entries()].sort((a, b) => b[1] - a[1])[0];
        principal = { id, parte: n / l.length };
      }
      let semaforo: Semaforo = 'sin_datos';
      if (l.length >= MIN_CASOS && mediana !== null) {
        // Un flujo rápido no tiene cuellos de botella aunque una tarea se lleve la mayor parte
        // del poco tiempo: el rojo exige demora real (lo normal ≥ 1 día) y el amarillo, que al
        // menos los casos lentos pasen de 2 días o lo normal de medio día.
        const p90 = percentil(l, 0.9) ?? 0;
        const lenta = mediana >= 1 && mediana >= 2 * medianaDeMedianas;
        if (mediana >= 1 && (participacion >= 0.35 || (lenta && mediana >= 3))) semaforo = 'rojo';
        else if ((mediana >= 0.5 || p90 >= 2) && (participacion >= 0.2 || lenta)) semaforo = 'ambar';
        else semaforo = 'verde';
      }
      const p = pend.get(t.id) ?? [];
      return {
        idTarea: t.id,
        nombre: t.nombre,
        casos: l.length,
        medianaDias: redondear(mediana),
        p90Dias: redondear(percentil(l, 0.9)),
        participacion: Math.round(participacion * 1000) / 1000,
        pendientes: p.length,
        pendientesMedianaDias: redondear(percentil(p, 0.5)),
        rechazos: rech.get(t.id) ?? 0,
        canceladas: canc.get(t.id) ?? 0,
        principal,
        semaforo,
      };
    });

  // Flujo completo.
  const ciclos = solicitudes.filter((s) => s.resuelta && s.estado !== 3).map((s) => Math.max(0, (s.resuelta!.getTime() - s.creada.getTime()) / DIA_MS));
  const textosPorSol = new Map<number, string[]>();
  for (const n of notas) (textosPorSol.get(n.idSolicitud) ?? textosPorSol.set(n.idSolicitud, []).get(n.idSolicitud)!).push(n.texto);
  const conRetrabajo = [...textosPorSol.entries()].filter(([, ts]) => ts.some((x) => RE_RETRABAJO.test(x))).length;
  const conDocumento = [...textosPorSol.entries()].filter(([, ts]) => ts.some((x) => RE_RETRABAJO.test(x) && RE_DOCUMENTO.test(x))).length;
  const devueltas = solicitudes.filter((s) => s.estado === 7).length;

  const diag: Diagnostico = {
    desde: new Date(ahora.getTime() - DIAS_HISTORIA * DIA_MS).toISOString().slice(0, 10),
    solicitudes: solicitudes.length,
    resueltas: ciclos.length,
    cicloMedianaDias: redondear(percentil(ciclos, 0.5)),
    cicloP90Dias: redondear(percentil(ciclos, 0.9)),
    abiertas: solicitudes.filter((s) => !s.resuelta && s.estado !== 3).length,
    devueltas,
    conRetrabajo,
    tareas: diagTareas,
    sugerencias: [],
  };
  diag.sugerencias = sugerir(diag, tareas, erroresSap, conDocumento, nombres);
  return diag;
}

/* ───────────────────────────── Sugerencias ───────────────────────────── */

function sugerir(d: Diagnostico, tareas: TareaDef[], erroresSap: ErroresSap[], conDocumento: number, nombres: Map<string, string>): Sugerencia[] {
  const out: Sugerencia[] = [];
  const def = new Map(tareas.map((t) => [t.id, t]));
  const ordenadas = [...d.tareas];

  // 1. Dos tareas seguidas, ambas lentas, y la segunda espera a la primera: ¿pueden ir a la vez?
  for (let i = 1; i < ordenadas.length; i += 1) {
    const t = ordenadas[i];
    const prev = ordenadas[i - 1];
    const dt = def.get(t.idTarea);
    if (!dt?.secuencial || dt.tipo === 'sap_executor' || def.get(prev.idTarea)?.tipo === 'sap_executor') continue;
    if (t.casos < MIN_CASOS || prev.casos < MIN_CASOS || t.medianaDias === null || prev.medianaDias === null) continue;
    if (t.medianaDias < 1 || prev.medianaDias < 1) continue;
    const ahorro = Math.min(t.medianaDias, prev.medianaDias);
    out.push({
      clave: `paralelizar:${t.idTarea}`,
      tipo: 'paralelizar',
      idTarea: t.idTarea,
      titulo: `«${t.nombre}» podría hacerse al mismo tiempo que «${prev.nombre}»`,
      explicacion: `Hoy «${t.nombre}» espera a que termine «${prev.nombre}». Si no necesita lo que sale de esa tarea, las dos pueden avanzar a la vez. Revise que no dependa de ella antes de aplicarlo.`,
      evidencia: `«${prev.nombre}» tarda ${textoDias(prev.medianaDias)} y «${t.nombre}» ${textoDias(t.medianaDias)} (lo normal, en ${t.casos} solicitudes).`,
      impacto: `Hasta ${textoDias(ahorro)} menos por solicitud.`,
      accion: { tipo: 'quitar_secuencial', idTarea: t.idTarea },
    });
  }

  for (const t of d.tareas) {
    const dt = def.get(t.idTarea);
    if (!dt || t.casos < MIN_CASOS) continue;
    const pesada = t.semaforo === 'rojo' || t.semaforo === 'ambar';

    // 2. Una sola persona asignada en una tarea que represa: suplente.
    // (En una autorización quien aprueba lo define el tipo de autorización, no «Asignado a»: no aplica.)
    if (pesada && dt.asignados <= 1 && dt.tipo !== 'sap_executor' && !dt.autorizacion) {
      out.push({
        clave: `suplente:${t.idTarea}`,
        tipo: 'suplente',
        idTarea: t.idTarea,
        titulo: `Agregar un suplente en «${t.nombre}»`,
        explicacion: `Esta tarea depende de una sola persona y concentra buena parte de la espera del flujo. Con una segunda persona asignada, la tarea no se detiene por vacaciones, incapacidades o picos de trabajo.`,
        evidencia: `Se lleva el ${pct(t.participacion)} del tiempo del flujo; lo normal son ${textoDias(t.medianaDias)} y el 10 % más lento pasa de ${textoDias(t.p90Dias)}.${t.pendientes > 0 ? ` Hoy tiene ${t.pendientes} pendientes.` : ''}`,
        impacto: null,
        accion: { tipo: 'resaltar', idTarea: t.idTarea, campo: 'Asignado a' },
      });
    }

    // 3. Varias personas asignadas, pero una resuelve casi todo: repartir.
    if (pesada && dt.asignados > 1 && t.principal && t.principal.parte >= 0.8) {
      const quien = nombres.get(t.principal.id) ?? 'una sola persona';
      out.push({
        clave: `repartir:${t.idTarea}`,
        tipo: 'repartir',
        idTarea: t.idTarea,
        titulo: `Repartir la carga de «${t.nombre}»`,
        explicacion: `Hay ${dt.asignados} personas asignadas, pero casi todo lo resuelve ${quien}. Conviene acordar cómo se reparten los casos o revisar si las demás personas siguen en el proceso.`,
        evidencia: `${quien} resolvió el ${pct(t.principal.parte)} de los ${t.casos} casos.`,
        impacto: null,
        accion: { tipo: 'resaltar', idTarea: t.idTarea, campo: 'Asignado a' },
      });
    }

    // 4. Autorización que siempre aprueba pero hace esperar.
    if (dt.autorizacion && t.casos >= 20 && t.rechazos === 0 && t.medianaDias !== null && t.medianaDias >= 0.5) {
      out.push({
        clave: `autorizacion:${t.idTarea}`,
        tipo: 'autorizacion',
        idTarea: t.idTarea,
        titulo: `Revisar si «${t.nombre}» sigue siendo necesaria`,
        explicacion: `Esta autorización se aprobó en todos los casos de los últimos meses, pero cada vez hace esperar. Se puede dejar solo para los casos que de verdad lo requieren (por ejemplo, por monto o por tipo) o quitarla.`,
        evidencia: `${t.casos} autorizaciones, ninguna rechazada; tardan ${textoDias(t.medianaDias)} en lo normal.`,
        impacto: `Hasta ${textoDias(t.medianaDias)} menos por solicitud.`,
        accion: { tipo: 'resaltar', idTarea: t.idTarea, campo: 'Tarea de autorización' },
      });
    }
  }

  // 5. Re-trabajo por documentos o datos faltantes: volver obligatorios desde la radicación.
  if (d.solicitudes >= 10 && conDocumento / d.solicitudes >= 0.1) {
    out.push({
      clave: 'obligatorio:flujo',
      tipo: 'obligatorio',
      idTarea: null,
      titulo: 'Pedir completos los documentos desde que se crea la solicitud',
      explicacion: 'En varias solicitudes las notas hablan de devolver o corregir por documentos o soportes que faltaban. Si esos documentos (o los campos) se vuelven obligatorios al crear la solicitud, se evita el ir y venir.',
      evidencia: `${conDocumento} de ${d.solicitudes} solicitudes (${pct(conDocumento / d.solicitudes)}) tienen notas de devolución o corrección por documentos.`,
      impacto: null,
      accion: { tipo: 'resaltar', idTarea: null, campo: 'Documentos' },
    });
  }

  // 6. Tareas automáticas con SAP que fallan seguido.
  for (const e of erroresSap) {
    const dt = def.get(e.idTarea);
    if (!dt || e.total < 5 || e.errores / e.total < 0.1) continue;
    out.push({
      clave: `sap:${e.idTarea}`,
      tipo: 'sap',
      idTarea: e.idTarea,
      titulo: `La tarea automática «${dt.nombre}» falla seguido`,
      explicacion: 'Cuando la tarea que ejecuta SAP falla, la solicitud se detiene hasta que alguien la reintenta. Conviene revisarla con Tecnología.',
      evidencia: `${e.errores} errores en ${e.total} ejecuciones (${pct(e.errores / e.total)}).`,
      impacto: null,
      accion: { tipo: 'resaltar', idTarea: e.idTarea, campo: 'Tarea SAP' },
    });
  }

  // 7. Tareas que nunca se usan en un flujo con movimiento.
  if (d.solicitudes >= 10) {
    for (const t of d.tareas) {
      if (t.casos === 0 && t.pendientes === 0 && t.canceladas === 0) {
        out.push({
          clave: `sin_uso:${t.idTarea}`,
          tipo: 'sin_uso',
          idTarea: t.idTarea,
          titulo: `«${t.nombre}» no se usó en los últimos meses`,
          explicacion: 'Ninguna solicitud pasó por esta tarea. Puede ser una tarea condicional que casi nunca aplica, o una que ya sobra.',
          evidencia: `0 de ${d.solicitudes} solicitudes desde el ${d.desde}.`,
          impacto: null,
          accion: { tipo: 'resaltar', idTarea: t.idTarea, campo: 'Activa' },
        });
      }
    }
  }
  return out;
}
