import { CORREO_MAX_DESTINATARIOS } from './constants';

/**
 * Destinatarios de «Redactar» (2026-10-19) — funciones PURAS, las mismas en el servidor (que decide) y en el
 * navegador (que solo avisa antes de enviar).
 *
 * - Una dirección válida: parte local de hasta 64 caracteres y un dominio con al menos un punto. Se guarda en
 *   minúsculas. «Nombre <correo>» (lo que se pega desde Outlook) se reduce al correo.
 * - Sin repetidos: si una dirección está en Para, no se repite en CC ni en CCO; si está en CC, no se repite en CCO.
 * - Tope: CORREO_MAX_DESTINATARIOS entre los tres campos.
 */

const FORMA_RE = /^[a-z0-9._%+'-]{1,64}@[a-z0-9.-]{4,253}$/;
const TLD_RE = /\.[a-z]{2,24}$/;

/** Dirección válida (ya en minúsculas): forma general, dominio con punto, sin «..» ni etiquetas que empiecen o terminen en guion. */
export function esDestinatarioValido(v: string): boolean {
  if (!FORMA_RE.test(v) || !TLD_RE.test(v)) return false;
  const [local, dominio] = v.split('@');
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;
  return dominio.split('.').every((e) => e.length >= 1 && e.length <= 63 && !e.startsWith('-') && !e.endsWith('-'));
}

/** «Nombre <correo@x.com>», «<correo@x.com>» o «correo@x.com» → «correo@x.com» (o null si no es válido). */
export function normalizarDestinatario(valor: string): string | null {
  let v = String(valor ?? '').trim();
  const angulos = /<([^<>]+)>\s*$/.exec(v);
  if (angulos) v = angulos[1];
  v = v.replace(/^mailto:/i, '').trim().toLowerCase();
  return v.length <= 254 && esDestinatarioValido(v) ? v : null;
}

/** Texto pegado o escrito («a@x.com; b@x.com, Nombre <c@x.com>») → piezas, sin vacíos. */
export function separarDestinatarios(texto: string): string[] {
  const t = String(texto ?? '');
  const piezas: string[] = [];
  // Primero las direcciones entre ángulos; el nombre entre comillas puede llevar comas («"Pérez, Ana" <ana@x.com>»).
  const resto = t.replace(/(?:"[^"\n]*"|[^<>,;"\n]*)\s*<[^<>\n]+>/g, (m) => {
    piezas.push(m.trim());
    return ' ';
  });
  for (const p of resto.split(/[,;\s]+/)) if (p.trim()) piezas.push(p.trim());
  return piezas;
}

export interface RevisionDestinatarios {
  para: string[];
  cc: string[];
  cco: string[];
  /** Lo que no es un correo válido, tal como se escribió. */
  invalidos: string[];
  total: number;
  /** Mensaje para la persona si no se puede enviar, o null. */
  error: string | null;
}

export function revisarDestinatarios(entrada: { para: string[]; cc: string[]; cco: string[] }): RevisionDestinatarios {
  const vistos = new Set<string>();
  const invalidos: string[] = [];
  const limpiar = (lista: string[]) => {
    const out: string[] = [];
    for (const crudo of Array.isArray(lista) ? lista : []) {
      if (!String(crudo ?? '').trim()) continue;
      const c = normalizarDestinatario(String(crudo));
      if (!c) {
        invalidos.push(String(crudo).trim().slice(0, 120));
        continue;
      }
      if (vistos.has(c)) continue;
      vistos.add(c);
      out.push(c);
    }
    return out;
  };
  const para = limpiar(entrada.para);
  const cc = limpiar(entrada.cc);
  const cco = limpiar(entrada.cco);
  const total = para.length + cc.length + cco.length;
  let error: string | null = null;
  if (invalidos.length) error = `${invalidos.length === 1 ? 'Esta dirección no es válida' : 'Estas direcciones no son válidas'}: ${invalidos.slice(0, 5).join(', ')}.`;
  else if (total === 0) error = 'Agregue al menos un destinatario.';
  else if (total > CORREO_MAX_DESTINATARIOS) error = `Máximo ${CORREO_MAX_DESTINATARIOS} destinatarios por correo (entre Para, CC y CCO); hay ${total}.`;
  return { para, cc, cco, invalidos, total, error };
}

/** ¿El correo es de fuera del grupo? (aviso en la ventana de redacción). Sin la lista de dominios no se avisa. */
export function esExterno(correo: string, dominiosGrupo: string[]): boolean {
  if (!dominiosGrupo.length) return false;
  const d = String(correo ?? '').toLowerCase().split('@')[1] ?? '';
  return !dominiosGrupo.some((x) => x.toLowerCase() === d);
}
