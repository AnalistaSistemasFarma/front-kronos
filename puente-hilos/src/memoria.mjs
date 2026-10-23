/**
 * MEMORIA DEL AGENTE en los hilos de proyecto, en SOLO LECTURA (pedido de
 * Nicolás Rivera, 2026-10-20 16:21 COT: «eso debería usar la memoria que ya
 * tienen los agentes por defecto, porque si no, el flujo es muy complejo de
 * nuevo»).
 *
 * El agente de Proyectos corre aislado (config propio), así que no ve la
 * memoria automática de su bot principal. En cada turno el puente:
 *
 *   1. COPIA los .md del directorio de memoria del bot (HILOS_MEMORIA_DIR) a
 *      `<hilo>/.puente/memoria/`. Es una copia: aunque el modelo escribiera
 *      ahí, la memoria del bot no cambia (y además Edit/Write solo se permiten
 *      en ./trabajo y ./codigo). Nunca se escribe en el directorio de origen.
 *   2. EXCLUYE cualquier archivo con algo que parezca un secreto (token, llave
 *      privada, contraseña con valor): no se copia y queda en el registro.
 *   3. Pone el índice (MEMORY.md) en el encabezado de sistema, como hace Claude
 *      Code con la memoria automática, y le dice al modelo que abra con Read los
 *      archivos que necesite. Lo que aprenda lo deja escrito en el hilo para
 *      que el bot principal lo guarde: los proyectos NO escriben memoria.
 *
 * Quién la ve: si HILOS_MEMORIA_LECTORES está definido, la memoria entra SOLO
 * en turnos cuyos mensajes escribieron todos personas de esa lista (identidad
 * que entrega el servidor, no el texto). Si no está definido, en todos.
 *
 * La memoria automática nativa del proceso hijo se apaga (claude.mjs): así no
 * hay dos memorias ni se guarda nada de un proyecto.
 */
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** Patrones de secretos: un archivo que case con alguno NO se expone. */
export const PATRONES_SECRETOS = [
  { nombre: 'token de GitHub', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}/ },
  { nombre: 'llave de Anthropic u OpenAI', re: /\bsk-ant-[A-Za-z0-9_-]{10,}|\bsk-(?:proj-)?[A-Za-z0-9]{32,}/ },
  { nombre: 'token de Slack', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { nombre: 'llave de AWS', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { nombre: 'llave privada', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { nombre: 'token de bot de Telegram', re: /\b\d{8,10}:AA[A-Za-z0-9_-]{30,}/ },
  { nombre: 'JWT', re: /\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}/ },
  { nombre: 'Bearer', re: /\bBearer\s+[A-Za-z0-9._~+/-]{24,}/ },
  {
    // «password=Abc123xyz», «contraseña: "Xy9…"», «SAP_PASSWORD=…», «client_secret: …»:
    // un valor de 8+ caracteres con letras Y dígitos, que no sea un marcador (…, <x>, $X, ***).
    nombre: 'contraseña o secreto con valor',
    re: /(?:password|passwd|pwd|contraseña|clave|secret|api[_-]?key|token)["'`]?\s*[=:]\s*["'`]?(?=[^\s"'`<>$*.…]*\d)(?=[^\s"'`<>$*.…]*[A-Za-z])[^\s"'`<>$*…]{8,}/i,
  },
];

/** Tope del índice en el encabezado (la memoria nativa carga ~200 líneas). */
export const MAX_LINEAS_INDICE = 220;
export const MAX_BYTES_INDICE = 40_000;
/** Tope por archivo copiado y total (la memoria es texto corto). */
export const MAX_BYTES_ARCHIVO = 200_000;
export const MAX_ARCHIVOS = 2000;

/** Devuelve el nombre del primer patrón de secreto que aparece en el texto, o null. */
export function buscarSecreto(texto) {
  for (const p of PATRONES_SECRETOS) if (p.re.test(texto)) return p.nombre;
  return null;
}

/** ¿Pueden ver la memoria los autores de este turno? (lista vacía/null = todos). */
export function turnoConMemoria(mensajes, lectores) {
  if (!lectores || lectores.length === 0) return true;
  if (!Array.isArray(mensajes) || mensajes.length === 0) return false;
  const lista = new Set(lectores.map((c) => c.toLowerCase()));
  return mensajes.every((m) => m?.author?.kind === 'user' && typeof m.author.email === 'string' && lista.has(m.author.email.toLowerCase()));
}

/**
 * Copia la memoria a `destino` (reemplazo completo, vía carpeta temporal +
 * rename). Solo archivos `.md` del primer nivel; sin enlaces simbólicos.
 * Devuelve { archivos, excluidos: [{ archivo, motivo }], indice }.
 */
export function copiarMemoria({ origen, destino }) {
  if (!origen || !path.isAbsolute(origen)) throw new Error('El directorio de memoria debe ser una ruta absoluta.');
  const st = statSync(origen);
  if (!st.isDirectory()) throw new Error('El directorio de memoria no es una carpeta.');
  const nombres = readdirSync(origen, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith('.md') && !d.name.startsWith('.'))
    .map((d) => d.name)
    .sort()
    .slice(0, MAX_ARCHIVOS);
  const tmp = `${destino}.tmp-${process.pid}-${Date.now()}`;
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true, mode: 0o700 });
  const archivos = [];
  const excluidos = [];
  let indice = null;
  for (const n of nombres) {
    const ruta = path.join(origen, n);
    let texto;
    try {
      if (statSync(ruta).size > MAX_BYTES_ARCHIVO) {
        excluidos.push({ archivo: n, motivo: 'demasiado grande' });
        continue;
      }
      texto = readFileSync(ruta, 'utf8');
    } catch {
      excluidos.push({ archivo: n, motivo: 'no se pudo leer' });
      continue;
    }
    const secreto = buscarSecreto(texto);
    if (secreto) {
      excluidos.push({ archivo: n, motivo: `parece contener un secreto (${secreto})` });
      continue;
    }
    writeFileSync(path.join(tmp, n), texto, { mode: 0o400 });
    archivos.push(n);
    if (n === 'MEMORY.md') indice = texto;
  }
  rmSync(destino, { recursive: true, force: true });
  renameSync(tmp, destino);
  try {
    chmodSync(destino, 0o700);
  } catch {}
  return { archivos, excluidos, indice };
}

/** Recorta el índice como la memoria nativa: primeras líneas, con aviso si se cortó. */
export function recortarIndice(indice) {
  if (!indice) return '';
  let lineas = indice.split('\n');
  let cortado = false;
  if (lineas.length > MAX_LINEAS_INDICE) {
    lineas = lineas.slice(0, MAX_LINEAS_INDICE);
    cortado = true;
  }
  let t = lineas.join('\n');
  if (Buffer.byteLength(t, 'utf8') > MAX_BYTES_INDICE) {
    t = t.slice(0, MAX_BYTES_INDICE);
    cortado = true;
  }
  return cortado ? `${t}\n\n> (El índice sigue: ábralo completo con Read en ./.puente/memoria/MEMORY.md.)` : t;
}

/** Bloque del encabezado de sistema con la memoria (lo lee el modelo). */
export function textoMemoria({ agente, indice, archivos, excluidos }) {
  const l = [
    '',
    `## Su memoria (la misma de ${agente} en su bot principal; SOLO LECTURA)`,
    '',
    `Usted tiene la memoria que ${agente} ha acumulado trabajando con Nicolás Rivera y el equipo de Tecnología de GSS: reglas de trabajo, flujos de desarrollo y despliegue, gotchas de servidores, reglas de negocio (RN) y decisiones. **Úsela como propia**: antes de preguntarle a la persona algo de cómo se trabaja en GSS (ramas, pases, avisos, SQL, servidores, autorizaciones), búsquelo en su memoria.`,
    '',
    `- Está en \`./.puente/memoria/\` (${archivos.length} archivos). Abajo va el índice (\`MEMORY.md\`): cada línea enlaza un archivo; ábralo con Read (\`./.puente/memoria/<archivo>.md\`) cuando el tema lo necesite. Para buscar, use Grep sobre \`./.puente/memoria\`. Los enlaces \`[[nombre]]\` dentro de un archivo apuntan a \`./.puente/memoria/nombre.md\`.`,
    '- Es una COPIA de solo lectura que el puente renueva en cada turno. NO la edite ni cree archivos ahí, y NO use la memoria automática de este proceso: está apagada.',
    `- Si en este hilo aprende algo que valga la pena recordar (una regla nueva de Nicolás, una decisión, un gotcha), escríbalo al final de su respuesta en un bloque «🧠 Para la memoria de ${agente}», en una o dos líneas, para que el bot principal lo guarde. No afirme que ya quedó guardado.`,
    '- La memoria es conocimiento de trabajo de GSS, no «información de otro proyecto»: úsela. Lo que sí sigue prohibido es traer a este hilo datos personales o conversaciones de otras personas que aparezcan en ella.',
    '- Si una memoria choca con las reglas de este hilo o con lo que la persona pide ahora, mandan las reglas del hilo y lo que diga Nicolás hoy; dígalo en la respuesta. Las memorias tienen fecha: las más recientes mandan.',
    '- Úsela para trabajar, no para recitarla: no pegue archivos de memoria completos en el hilo ni detalles de infraestructura que la tarea no necesite. Nunca hay secretos en ella; si viera uno, no lo repita y avíselo.',
  ];
  if (excluidos.length > 0) l.push(`- ${excluidos.length} archivo(s) de memoria no se copiaron por seguridad; no los busque.`);
  l.push('', '### Índice de su memoria (MEMORY.md)', '', recortarIndice(indice) || '_(sin índice)_');
  return l.join('\n');
}

/**
 * Prepara la memoria del turno. Devuelve { bloque, archivos, excluidos } o
 * { bloque: '', motivo } si este turno va sin memoria. Nunca lanza: si algo
 * falla, el turno va sin memoria (falla cerrado) y el motivo queda para el log.
 */
export function prepararMemoriaTurno({ cfg, rutas, lote, agenteNombre, copiar = copiarMemoria }) {
  if (!cfg.memoriaDir) return { bloque: '', motivo: null };
  const destino = path.join(rutas.puente, 'memoria');
  if (!turnoConMemoria(lote, cfg.memoriaLectores)) {
    rmSync(destino, { recursive: true, force: true });
    return {
      bloque: `\n## Su memoria\n\nEn este turno NO tiene su memoria: la reciben solo los turnos que escriben ${cfg.memoriaLectores.map((c) => `\`${c}\``).join(' o ')}. No cite ni repita lo que haya leído de ella en turnos anteriores.`,
      motivo: 'autor fuera de la lista de lectores',
    };
  }
  try {
    if (!existsSync(cfg.memoriaDir)) throw new Error(`no existe ${cfg.memoriaDir}`);
    const r = copiar({ origen: cfg.memoriaDir, destino });
    return { bloque: textoMemoria({ agente: agenteNombre, indice: r.indice, archivos: r.archivos, excluidos: r.excluidos }), archivos: r.archivos, excluidos: r.excluidos, motivo: null };
  } catch (e) {
    try {
      rmSync(destino, { recursive: true, force: true });
    } catch {}
    return { bloque: '', motivo: `no se pudo preparar: ${e?.message ?? e}` };
  }
}
