/**
 * SUPERVISIÓN DE TURNOS LARGOS (2026-10-22).
 *
 * Pedido de Nicolás Rivera (2026-10-22, 07:00 COT): «que no tenga límite de dinero
 * por ahora; el límite de tiempo sí, algo razonable, depende mucho de la tarea» y
 * «si la tarea es muy grande, que la estuviera supervisando, y si se demoró por
 * alguna razón, le avise al usuario». Vale para TODOS los usuarios y proyectos.
 *
 * Tres piezas, todas sin red ni proceso propio (las llama puente.mjs):
 *   - crearSupervisor: dos temporizadores mientras el turno corre. El AVISO publica en
 *     el hilo «sigo trabajando» cada HILOS_AVISO_PROGRESO_MS (10 min por defecto); el
 *     LATIDO refresca el indicador cada 3 min para que no se vuelva «rancio» (la app
 *     deja de pintar «trabajando» si pasan 10 min sin novedades: ESTADO_RANCIO_MS).
 *   - textoAvisoProgreso: el aviso breve, con UNA línea de qué está haciendo.
 *   - textoCorte: el mensaje cuando el turno se corta (tiempo, tope de gasto o error),
 *     con lo que alcanzó a hacer y la invitación a escribir «continúa».
 */
import { lstatSync, readdirSync } from 'node:fs';
import path from 'node:path';

/** Cada cuánto se refresca el indicador mientras el turno corre (la app lo da por rancio a los 10 min). */
export const LATIDO_INDICADOR_MS = 3 * 60 * 1000;

/** Prompt de la continuación automática (HILOS_CONTINUAR_AL_AGOTAR=si). */
export const PROMPT_CONTINUACION =
  'Se cumplió el tiempo máximo del turno anterior y el proceso se detuvo antes de que usted terminara. Continúe desde donde quedó, sin repetir lo que ya está hecho (revise ./trabajo y su propio avance en esta sesión), y termine con la respuesta final para el hilo.';

/**
 * Línea del encabezado de sistema: el tope del turno y cómo dejar el avance a salvo.
 * No menciona dinero (sin tope de gasto) ni promete continuación automática.
 */
export function textoTiempoTurno({ topeMs, avisoMs = 0 }) {
  if (!topeMs) return '';
  return [
    `- TIEMPO: cada turno tiene un máximo de ${duracionLegible(topeMs)}; si se cumple, el puente detiene el proceso.${avisoMs ? ` Mientras trabaja, el puente le avisa a la persona en el hilo cada ${duracionLegible(avisoMs)} que usted sigue en ello (no lo haga usted).` : ''}`,
    '  En tareas grandes, guarde el avance en ./trabajo a medida que avanza (no todo al final) y escriba de vez en cuando una frase corta de lo que va haciendo: si el turno se corta, eso es lo que la persona ve, y la sesión conserva su avance para cuando escriba «continúa».',
  ].join('\n');
}

/** «12 min», «1 h 5 min». */
export function duracionLegible(ms) {
  const min = Math.max(0, Math.round(ms / 60000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

/** Una línea corta y sin Markdown peligroso a partir de un texto del modelo. */
export function lineaCorta(texto, max = 180) {
  if (typeof texto !== 'string') return '';
  // El último párrafo con contenido: suele ser lo que el modelo estaba haciendo.
  const parrafos = texto
    .split(/\n\s*\n/)
    .map((p) => p.replace(/```[\s\S]*?(```|$)/g, ' ').replace(/[`*_>#|]/g, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const t = parrafos.at(-1) ?? '';
  if (!t) return '';
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/**
 * Aviso de progreso. `actividad` = etiqueta del indicador («Consultando SAP…»);
 * `ultimoTexto` = lo último que escribió el modelo en el hilo principal.
 */
export function textoAvisoProgreso({ transcurridoMs, topeMs, actividad = null, ultimoTexto = null }) {
  const lineas = [`⏳ Sigo trabajando en su pedido (lleva ${duracionLegible(transcurridoMs)}${topeMs ? `; el máximo por turno es ${duracionLegible(topeMs)}` : ''}). Le aviso al terminar.`];
  const avance = lineaCorta(ultimoTexto ?? '');
  const ahora = typeof actividad === 'string' ? actividad.trim() : '';
  if (avance) lineas.push(`_Lo último: «${avance}»_`);
  else if (ahora && ahora !== 'Pensando…' && ahora !== 'Trabajando…') lineas.push(`_Ahora: ${ahora}_`);
  return lineas.join('\n\n');
}

/**
 * Archivos de ./trabajo modificados desde `desdeMs` (rutas relativas a `base`).
 * Sin seguir enlaces, sin ocultos, acotado en profundidad y cantidad.
 */
export function archivosModificadosDesde(dir, desdeMs, { base = path.dirname(dir), excluir = [], maxProfundidad = 4, max = 200 } = {}) {
  const out = [];
  const recorrer = (d, nivel) => {
    if (nivel > maxProfundidad || out.length >= max) return;
    let entradas;
    try {
      entradas = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entradas) {
      if (out.length >= max) return;
      if (e.name.startsWith('.') || excluir.includes(e.name)) continue;
      const ruta = path.join(d, e.name);
      if (e.isDirectory()) recorrer(ruta, nivel + 1);
      else if (e.isFile()) {
        try {
          if (lstatSync(ruta).mtimeMs >= desdeMs) out.push(path.relative(base, ruta));
        } catch {}
      }
    }
  };
  recorrer(dir, 0);
  return out.sort();
}

/** Une lo escaneado con lo que el modelo tocó por Write/Edit (solo lo que queda dentro de `cwd`). */
export function archivosDelTurno({ cwd, escaneados = [], tocados = [] }) {
  const set = new Set(escaneados);
  for (const f of tocados) {
    const abs = path.resolve(cwd, f);
    const rel = path.relative(cwd, abs);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || rel.split(path.sep).some((s) => s.startsWith('.'))) continue;
    set.add(rel);
  }
  return [...set].sort();
}

/**
 * Mensaje cuando el turno se corta. `motivo`: 'tiempo' | 'gasto' | 'error'.
 * `continuacion` = true si ya se intentó la continuación automática.
 */
export function textoCorte({ motivo, transcurridoMs, topeMs = null, presupuestoUsd = null, ultimoTexto = null, archivos = [], continuacion = false }) {
  const cabecera =
    motivo === 'tiempo'
      ? `⏱️ Se cumplió el tiempo máximo de este turno (${duracionLegible(topeMs ?? transcurridoMs)})${continuacion ? ', también en la continuación automática,' : ''} y detuve el trabajo antes de terminar.`
      : motivo === 'gasto'
        ? `💰 Llegué al tope de gasto de este pedido${presupuestoUsd ? ` (${presupuestoUsd} USD)` : ''} y detuve el trabajo antes de terminar (llevaba ${duracionLegible(transcurridoMs)}).`
        : `⚠️ El trabajo se interrumpió por un error del asistente antes de terminar (llevaba ${duracionLegible(transcurridoMs)}).`;
  const lineas = [cabecera, '', '**Lo que alcancé a hacer:**'];
  const avance = lineaCorta(ultimoTexto ?? '', 400);
  if (avance) lineas.push(`- Último avance: «${avance}»`);
  if (archivos.length > 0) {
    const muestra = archivos.slice(0, 10).map((a) => `\`${a}\``).join(', ');
    lineas.push(`- Archivos que creé o modifiqué: ${muestra}${archivos.length > 10 ? ` y ${archivos.length - 10} más` : ''}.`);
  }
  if (!avance && archivos.length === 0) lineas.push('- No alcancé a dejar texto ni archivos visibles; el trabajo estaba en curso (consultas y lecturas).');
  lineas.push(
    '',
    'El avance no se pierde: la sesión de esta conversación lo conserva, igual que los archivos de `./trabajo`. Escriba **«continúa»** y retomo desde donde quedé.'
  );
  return lineas.join('\n');
}

/**
 * Temporizadores del turno. `alAviso(transcurridoMs)` y `alLatido()` pueden ser
 * async: el supervisor guarda la promesa en curso para que el puente la espere
 * antes de publicar la respuesta final (así un latido tardío no vuelve a
 * encender el indicador después de dejarlo en reposo).
 */
export function crearSupervisor({ intervaloAvisoMs, latidoMs = LATIDO_INDICADOR_MS, alAviso, alLatido, ahora = () => Date.now(), programar = setInterval, cancelar = clearInterval }) {
  const inicio = ahora();
  const pendientes = new Set();
  const timers = [];
  let detenido = false;
  const lanzar = (fn) => {
    if (detenido) return;
    let p;
    try {
      p = Promise.resolve(fn()).catch(() => null);
    } catch {
      return;
    }
    pendientes.add(p);
    p.finally(() => pendientes.delete(p));
  };
  if (intervaloAvisoMs > 0 && alAviso) timers.push(programar(() => lanzar(() => alAviso(ahora() - inicio)), intervaloAvisoMs));
  if (latidoMs > 0 && alLatido) timers.push(programar(() => lanzar(() => alLatido()), latidoMs));
  return {
    inicio,
    transcurrido: () => ahora() - inicio,
    /** Apaga los temporizadores y espera lo que haya quedado en vuelo. */
    async detener() {
      detenido = true;
      for (const t of timers) cancelar(t);
      await Promise.allSettled([...pendientes]);
    },
  };
}
