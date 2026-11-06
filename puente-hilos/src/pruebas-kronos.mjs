/**
 * PRUEBAS PARA TODOS LOS HILOS (orden de Nicolás Rivera, 2026-10-22 10:09 COT:
 * «sí, todo, es lo que te había dicho»). Todo hilo de proyecto, en el puente de
 * prod y en el de pruebas, con cualquier usuario y sin depender del rol ni de la
 * terminal, recibe dos conectores MCP locales (mcp-pruebas-kronos.mjs):
 *
 *   - kronos-pruebas-sql     lectura y escritura SOLO en KRONOSDB_PRUEBAS;
 *   - synerlink-testing-web  la web de testing como usuario QA (HTTP y capturas).
 *
 * Es política del PUENTE (no de conectores-por-proyecto.json): se apaga solo con
 * HILOS_PRUEBAS_KRONOS=no. Las credenciales están en HILOS_CONECTORES_SECRETOS,
 * clave «kronos-pruebas» (archivo 600, fuera del hilo y negado al sandbox de
 * los comandos). Si faltan, el turno va sin estos conectores y lo dice (falla cerrado).
 */
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HERRAMIENTAS_SQL, HERRAMIENTAS_WEB, LLAVE_SECRETOS, NOMBRE_SQL, NOMBRE_WEB } from './mcp-pruebas-kronos.mjs';

export const SCRIPT_MCP = fileURLToPath(new URL('./mcp-pruebas-kronos.mjs', import.meta.url));

/** Archivos locales del conector (sesión del QA y auditoría), en la carpeta del puente. */
export function rutasPruebas(hilosDir) {
  return {
    sesion: path.join(hilosDir, 'pruebas-kronos-sesion-qa.json'),
    auditoria: path.join(hilosDir, 'auditoria-pruebas-kronos.jsonl'),
  };
}

/** Lo que el sandbox de los comandos nunca debe leer (la sesión del QA). */
export function secretosPruebas(cfg) {
  return cfg?.pruebasKronos?.habilitado ? [rutasPruebas(cfg.hilosDir).sesion] : [];
}

/** ¿El archivo de secretos trae lo necesario? Sin devolver valores. Lanza con el motivo. */
export function verificarSecretosPruebas(ruta, { leer = (r) => readFileSync(r, 'utf8'), modo = (r) => statSync(r).mode & 0o777 } = {}) {
  if (!ruta) throw new Error('falta HILOS_CONECTORES_SECRETOS');
  let m;
  try {
    m = modo(ruta);
  } catch {
    throw new Error('no existe el archivo de secretos');
  }
  if (m !== 0o600) throw new Error('el archivo de secretos debe ser 600');
  const s = JSON.parse(leer(ruta))?.[LLAVE_SECRETOS];
  const faltan = [];
  for (const k of ['server', 'user', 'password']) if (typeof s?.sql?.[k] !== 'string' || !s.sql[k]) faltan.push(`sql.${k}`);
  if (s?.sql?.database && String(s.sql.database).toUpperCase() !== 'KRONOSDB_PRUEBAS') faltan.push('sql.database=KRONOSDB_PRUEBAS');
  for (const k of ['email', 'password']) if (typeof s?.qa?.[k] !== 'string' || !s.qa[k]) faltan.push(`qa.${k}`);
  if (faltan.length) throw new Error(`a «${LLAVE_SECRETOS}» le falta: ${faltan.join(', ')}`);
}

/** Bloque del encabezado del turno (textoSistema). */
export function textoPruebas({ disponible, motivo = null }) {
  if (!disponible) {
    return [
      '',
      '## Base de PRUEBAS y web de testing',
      '',
      `En ESTE turno no están disponibles los conectores de PRUEBAS (${motivo ?? 'no se pudieron preparar'}). Dígalo así y avísele a Tecnología; no pida credenciales.`,
    ].join('\n');
  }
  return [
    '',
    '## Base de PRUEBAS y web de testing (todos los proyectos; aprobado por Nicolás Rivera el 2026-10-22)',
    '',
    '**Usted tiene acceso de lectura y escritura a la base de PRUEBAS (KRONOSDB_PRUEBAS) y puede revisar testing como usuario QA; nunca a prod.** Esto vale en todos los proyectos y para todos los usuarios, con o sin terminal.',
    '',
    '| Conector | Herramientas | Para qué |',
    '|---|---|---|',
    `| \`${NOMBRE_SQL}\` | \`pruebas_sql_consultar\`, \`pruebas_sql_ejecutar\`, \`pruebas_sql_correr_script\` | Leer (SELECT con tope de filas) y escribir (DML/DDL con motivo, o un script \`codigo/<repo>/prisma/manual/*-PRUEBAS.sql\` o \`trabajo/*.sql\` partido por GO) en KRONOSDB_PRUEBAS. |`,
    `| \`${NOMBRE_WEB}\` | \`testing_http\`, \`testing_captura\` | Pedir páginas o APIs de testing (192.168.11.230:3030) con la sesión del usuario QA de pruebas, y tomar capturas de pantalla que quedan en ./trabajo/capturas. |`,
    '',
    'Reglas:',
    '- **VERIFIQUE USTED MISMO antes de pedirle algo a la persona.** Si necesita saber si una tabla, columna, registro, script o pantalla ya está en PRUEBAS o en testing, consúltelo con estos conectores (un SELECT, una petición o una captura) en lugar de preguntarle o devolverle el trabajo. Nunca diga «desde este hilo no tengo cómo entrar» a PRUEBAS o a testing: sí tiene cómo.',
    '- SOLO PRUEBAS: nada de USE, de KRONOSDB (producción) ni de otras bases; el conector lo rechaza y la sesión SQL está encerrada en KRONOSDB_PRUEBAS. Producción NO está habilitada por esta vía y no se promete.',
    '- Toda escritura lleva un `motivo` claro (queda en la auditoría). Prefiera scripts idempotentes; antes de cambiar datos, consulte cómo están, y al terminar, verifique el resultado.',
    '- Consultas acotadas: filtros, TOP y solo las columnas necesarias. No traiga tablas enteras.',
    '- Usuario QA: `qa.sgc@gsslatam.com` (solo existe en PRUEBAS; rol user, empresa OLP). La clave la maneja el conector: no la pida ni la busque. Si una pantalla exige un permiso que el QA no tiene, dígalo.',
    '- Capturas: después de `testing_captura`, mírela con Read; para entregarla, escriba en su respuesta final la línea `MEDIA:trabajo/capturas/<nombre>.png`.',
    '- No copie al hilo datos personales que la tarea no necesite.',
  ].join('\n');
}

/**
 * Conectores de PRUEBAS del turno. Devuelve { servidores, bloque, motivo }.
 * Nunca lanza: si algo falta, `servidores` queda vacío y `motivo` dice por qué.
 */
export function prepararPruebasTurno({ cfg, rutas, idConversation, lote = [], chrome = null, verificar = verificarSecretosPruebas, nodeBin = process.execPath }) {
  const p = cfg?.pruebasKronos;
  if (!p?.habilitado) return { servidores: [], bloque: '', motivo: 'apagado (HILOS_PRUEBAS_KRONOS=no)' };
  try {
    verificar(cfg.conectoresSecretos);
  } catch (e) {
    return { servidores: [], bloque: textoPruebas({ disponible: false, motivo: 'faltan sus credenciales en el puente' }), motivo: e.message };
  }
  const { sesion, auditoria } = rutasPruebas(cfg.hilosDir);
  const autores = [...new Set(lote.map((m) => String(m?.author?.email ?? '').trim().toLowerCase()).filter((c) => /^[^\s@,]+@[^\s@,]+$/.test(c)))].join(',');
  const comunes = ['--secretos', cfg.conectoresSecretos, '--hilo', rutas.cwd, '--auditoria', auditoria, '--conversacion', String(idConversation), ...(autores ? ['--autores', autores] : [])];
  const env = { PATH: '/usr/bin:/bin', HOME: cfg.home, LANG: 'es_CO.UTF-8' };
  const servidores = [
    { nombre: NOMBRE_SQL, herramientas: HERRAMIENTAS_SQL.map((t) => t.name), config: { type: 'stdio', command: nodeBin, args: [SCRIPT_MCP, '--modo', 'sql', ...comunes], env } },
    {
      nombre: NOMBRE_WEB,
      herramientas: HERRAMIENTAS_WEB.map((t) => t.name),
      config: { type: 'stdio', command: nodeBin, args: [SCRIPT_MCP, '--modo', 'web', ...comunes, '--sesion', sesion, '--base', p.base, ...(chrome ? ['--chrome', chrome] : [])], env },
    },
  ];
  return { servidores, bloque: textoPruebas({ disponible: true }), motivo: null };
}
