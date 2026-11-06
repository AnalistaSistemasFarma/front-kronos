/**
 * GUÍA DEL FLUJO DE DESARROLLO DE GSS (pedido de Nicolás Rivera, 2026-10-20
 * 16:16 COT: «explícales cómo es todo el flujo de desarrollo que ya tenemos;
 * me está preguntando cosas que ya son obvias para ti»).
 *
 * Lo principal es la MEMORIA del agente (memoria.mjs, 16:21 COT: «eso debería
 * usar la memoria que ya tienen los agentes»). Esto es solo un complemento
 * corto: el resumen del flujo de pases (contexto/flujo-desarrollo-gss.md,
 * versionado en este repo), que entra en el encabezado de sistema de todo
 * turno de un proyecto con acceso al código (nivel 2), con o sin repos montados.
 *
 * No es un control de seguridad (esos están en codigo.mjs): si la guía no se
 * puede leer, el turno sigue sin ella y el puente lo registra.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const RUTA_GUIA_DESARROLLO = fileURLToPath(new URL('../contexto/flujo-desarrollo-gss.md', import.meta.url));

/** Tope de tamaño: es un resumen corto (lo principal es la memoria del agente). */
export const MAX_BYTES_GUIA = 12_000;

/**
 * Bloque del encabezado de sistema con la guía. Quita el título H1 del archivo
 * (el bloque pone el suyo) y falla si el archivo está vacío o se pasa del tope.
 */
export function textoGuiaDesarrollo({ ruta = RUTA_GUIA_DESARROLLO, leer = (r) => readFileSync(r, 'utf8') } = {}) {
  const crudo = leer(ruta);
  if (typeof crudo !== 'string' || crudo.trim() === '') throw new Error('La guía del flujo de desarrollo está vacía.');
  if (Buffer.byteLength(crudo, 'utf8') > MAX_BYTES_GUIA) throw new Error(`La guía del flujo de desarrollo pasa de ${MAX_BYTES_GUIA} bytes.`);
  const cuerpo = crudo.replace(/^﻿?#\s+[^\n]*\n+/, '').trim();
  return [
    '',
    '## Resumen del flujo de pases de GSS',
    '',
    'Es el flujo que GSS ya tiene acordado: aplíquelo sin preguntarlo. El detalle está en su memoria.',
    '',
    cuerpo,
  ].join('\n');
}

/** Igual que textoGuiaDesarrollo, pero nunca lanza: devuelve { bloque, error }. */
export function guiaDesarrolloSegura(cargar = textoGuiaDesarrollo) {
  try {
    return { bloque: cargar(), error: null };
  } catch (e) {
    return { bloque: '', error: e?.message ?? String(e) };
  }
}
