/**
 * CONECTORES POR PROYECTO (bases de datos en SOLO LECTURA), pedido de Nicolás
 * Rivera el 2026-10-20 a las 17:24 COT para el proyecto 1 («Solicitudes de
 * compra en SynerLink»): «no tiene acceso a las bases de datos tampoco, y es
 * que necesita hacer un análisis duro».
 *
 * El perfil del proyecto (perfiles.json) define los conectores de TODOS los
 * hilos de ese perfil. Este módulo SUMA, solo a los proyectos vinculados en
 * `conectores-por-proyecto.json`, conectores MCP ya existentes y blindados
 * (mcp-sapbo-* de solo lectura, sapsend-* de solo lectura, kronos-synerlink
 * con una llave de solo lectura):
 *
 *   - NADA de credenciales SQL: solo conectores MCP por HTTP. Las bases se
 *     consultan a través del conector, que impone su propio candado.
 *   - Las llaves (Bearer) NO se escriben en el mcp.json del hilo (el modelo lo
 *     puede leer): van en un archivo 600 fuera de la carpeta del hilo
 *     (HILOS_CONECTORES_SECRETOS) y Claude Code las pide por `headersHelper`
 *     (cabeceras-conector.mjs). El sandbox de los turnos con código niega la
 *     lectura de ese archivo.
 *   - Herramientas por NOMBRE EXACTO (lista blanca por conector): nada de
 *     comodines, nada de escritura.
 *   - Solo en turnos cuyos mensajes escribieron TODOS personas de `lectores`
 *     (identidad que entrega el servidor, no el texto), igual que la memoria.
 *   - Se relee en cada turno: vincular o retirar un conector no exige reiniciar.
 *
 * Formato:
 * {
 *   "lectores": ["correo", …],
 *   "conectores": {
 *     "<nombre MCP>": { "url": "http://…/mcp", "herramientas": ["sap_query", …],
 *                       "llave": "<clave en el archivo de secretos>"?, "descripcion": "…"? }
 *   },
 *   "proyectos": { "<idProject>": { "conectores": ["<nombre>", …], "instrucciones"?: "…" } }
 * }
 */
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ErrorConfig } from './config.mjs';

const RE_NOMBRE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const RE_TOOL = /^[a-z][a-z0-9_]{0,63}$/;
const RE_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RE_LLAVE = /^[a-z0-9][a-z0-9-]{0,39}$/;

/**
 * Herramientas que NUNCA se habilitan por esta vía aunque alguien las liste:
 * escritura de SAP (mcp-sapbo con SAP_ENABLE_WRITE_TOOLS) y de Kronos.
 */
export const HERRAMIENTAS_ESCRITURA = [
  'sap_create', 'sap_update', 'sap_delete', 'sap_action', 'sap_batch',
  'kronos_categorize_case', 'kronos_categorize_request', 'kronos_create_request', 'kronos_add_note', 'kronos_resolve_task',
  'kronos_upload_attachment', 'kronos_delete_attachment', 'kronos_set_request_fields', 'kronos_request_ia_access',
  'correo_proponer_respuesta', 'correo_crear_solicitud_desde_hilo', 'correo_agregar_nota',
];
const PREFIJOS_ESCRITURA = ['proyecto_proponer_', 'sapsend_create', 'sapsend_update', 'sapsend_delete'];

function esEscritura(t) {
  return HERRAMIENTAS_ESCRITURA.includes(t) || PREFIJOS_ESCRITURA.some((p) => t.startsWith(p));
}

/** Valida conectores-por-proyecto.json. Todo falla cerrado. */
export function validarConectoresPorProyecto(json) {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    throw new ErrorConfig('conectores-por-proyecto.json debe ser un objeto.');
  }
  const lectores = json.lectores ?? [];
  if (!Array.isArray(lectores) || lectores.length === 0 || lectores.some((c) => typeof c !== 'string' || !RE_CORREO.test(c))) {
    throw new ErrorConfig('conectores-por-proyecto.json: lectores debe ser una lista NO vacía de correos.');
  }
  const conectores = new Map();
  for (const [nombre, c] of Object.entries(json.conectores ?? {})) {
    if (!RE_NOMBRE.test(nombre)) throw new ErrorConfig(`Conector con nombre inválido: ${nombre}.`);
    if (!c || typeof c !== 'object') throw new ErrorConfig(`Conector ${nombre} inválido.`);
    let url;
    try {
      url = new URL(c.url);
    } catch {
      throw new ErrorConfig(`Conector ${nombre}: url inválida.`);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new ErrorConfig(`Conector ${nombre}: url debe ser http(s).`);
    if (url.username || url.password || url.search) throw new ErrorConfig(`Conector ${nombre}: la url no puede llevar credenciales ni parámetros.`);
    if (c.headers !== undefined) throw new ErrorConfig(`Conector ${nombre}: las cabeceras no van aquí; use "llave" y el archivo de secretos.`);
    const herramientas = c.herramientas;
    if (!Array.isArray(herramientas) || herramientas.length === 0) throw new ErrorConfig(`Conector ${nombre}: herramientas debe ser una lista no vacía.`);
    for (const t of herramientas) {
      if (typeof t !== 'string' || !RE_TOOL.test(t)) throw new ErrorConfig(`Conector ${nombre}: herramienta inválida o con comodín: ${String(t)}.`);
      if (esEscritura(t)) throw new ErrorConfig(`Conector ${nombre}: ${t} es de escritura; este archivo solo admite lectura.`);
    }
    if (c.llave !== undefined && (typeof c.llave !== 'string' || !RE_LLAVE.test(c.llave))) throw new ErrorConfig(`Conector ${nombre}: llave inválida.`);
    conectores.set(nombre, {
      nombre,
      url: url.toString(),
      herramientas: [...new Set(herramientas)],
      llave: c.llave ?? null,
      descripcion: typeof c.descripcion === 'string' ? c.descripcion.replace(/\s+/g, ' ').trim().slice(0, 300) : '',
    });
  }
  const proyectos = new Map();
  for (const [id, p] of Object.entries(json.proyectos ?? {})) {
    if (!/^[1-9][0-9]{0,9}$/.test(id)) throw new ErrorConfig(`Proyecto con id inválido: ${id}.`);
    if (!p || !Array.isArray(p.conectores) || p.conectores.length === 0) throw new ErrorConfig(`Proyecto ${id}: conectores debe ser una lista no vacía.`);
    for (const n of p.conectores) if (!conectores.has(n)) throw new ErrorConfig(`Proyecto ${id}: el conector ${n} no está declarado.`);
    proyectos.set(Number(id), {
      conectores: [...new Set(p.conectores)],
      instrucciones: typeof p.instrucciones === 'string' ? p.instrucciones.slice(0, 4000) : '',
    });
  }
  return { lectores: lectores.map((c) => c.toLowerCase()), conectores, proyectos };
}

export function cargarConectoresPorProyecto(ruta, leer = (r) => readFileSync(r, 'utf8')) {
  if (!ruta) return null;
  let json;
  try {
    json = JSON.parse(leer(ruta));
  } catch (err) {
    throw new ErrorConfig(`No se pudo leer HILOS_CONECTORES_POR_PROYECTO: ${err.message}`);
  }
  return validarConectoresPorProyecto(json);
}

/**
 * Revisa el archivo de secretos SIN devolver su contenido: debe ser 600 y
 * traer las llaves que piden los conectores del proyecto.
 */
export function verificarSecretos(ruta, llaves, { leer = (r) => readFileSync(r, 'utf8'), modo = (r) => statSync(r).mode & 0o777 } = {}) {
  if (llaves.length === 0) return;
  if (!ruta) throw new ErrorConfig('Hay conectores con llave pero falta HILOS_CONECTORES_SECRETOS.');
  let m;
  try {
    m = modo(ruta);
  } catch {
    throw new ErrorConfig(`No existe HILOS_CONECTORES_SECRETOS (${ruta}).`);
  }
  if (m !== 0o600) throw new ErrorConfig(`HILOS_CONECTORES_SECRETOS debe tener permisos 600 (tiene ${m.toString(8)}).`);
  let json;
  try {
    json = JSON.parse(leer(ruta));
  } catch {
    throw new ErrorConfig('HILOS_CONECTORES_SECRETOS no es JSON válido.');
  }
  const faltan = llaves.filter((k) => typeof json?.[k] !== 'string' || json[k].length < 16);
  if (faltan.length) throw new ErrorConfig(`HILOS_CONECTORES_SECRETOS no trae las llaves: ${faltan.join(', ')}.`);
}

/** ¿Todos los mensajes del turno los escribió un lector autorizado (según el servidor)? */
export function turnoConConectores(mensajes, lectores) {
  if (!Array.isArray(mensajes) || mensajes.length === 0 || !lectores?.length) return false;
  const lista = new Set(lectores);
  return mensajes.every((m) => m?.author?.kind === 'user' && typeof m.author.email === 'string' && lista.has(m.author.email.trim().toLowerCase()));
}

/** Comando `headersHelper` del conector: el puente entrega la cabecera, el modelo nunca la ve. */
export function comandoCabeceras({ nodeBin = process.execPath, rutaSecretos, llave }) {
  const script = fileURLToPath(new URL('./cabeceras-conector.mjs', import.meta.url));
  return `"${nodeBin}" "${script}" "${rutaSecretos}" ${llave}`;
}

/** Perfil del turno = perfil del proyecto + conectores del vínculo (sin pisar los del perfil). */
export function combinarPerfil(perfil, extra) {
  if (!extra || extra.servidores.length === 0) return perfil;
  const mcpServers = { ...perfil.mcpServers };
  const herramientas = [...perfil.herramientas];
  for (const s of extra.servidores) {
    if (!mcpServers[s.nombre]) mcpServers[s.nombre] = s.config;
    for (const t of s.herramientas) herramientas.push(`mcp__${s.nombre}__${t}`);
  }
  return { ...perfil, mcpServers, herramientas: [...new Set(herramientas)] };
}

/** Bloque del encabezado de sistema (lo lee el modelo). */
export function textoConectores({ servidores, instrucciones }) {
  const l = [
    '',
    '## Bases de datos en SOLO LECTURA (conectores de este proyecto; aprobado por Nicolás Rivera el 2026-10-20)',
    '',
    'Además de los conectores del perfil, en este proyecto usted tiene estos conectores MCP. Son la ÚNICA vía a las bases: NO tiene ni debe pedir credenciales SQL, SSH ni acceso directo a servidores.',
    '',
    '| Conector | Herramientas | Qué es |',
    '|---|---|---|',
  ];
  for (const s of servidores) l.push(`| \`${s.nombre}\` | ${s.herramientas.map((t) => `\`${t}\``).join(', ')} | ${s.descripcion || '—'} |`);
  l.push(
    '',
    'Reglas OBLIGATORIAS (vienen de un incidente real: el 2026-10-19 un agente tumbó SAP Farmalógica con un `groupby` sin filtro de fecha):',
    '- Tiene SAP en SOLO LECTURA por los conectores `sapbo-*` (Service Layer de cada empresa). **Use SIEMPRE filtro de fecha** (`CreationDate`, `DocDate`, `UpdateDate`…) y `top` pequeño (5 a 50) mientras explora. Pida solo los campos que necesita con `select`.',
    '- **NUNCA agrupe ni agregue (`apply` con `groupby`/`aggregate`) ni use `maxPageSize: 0` sin un `filter` con rango de fechas acotado** (un mes o menos al empezar). El conector rechaza esas consultas, pero la regla es suya: no la tantee.',
    '- Si una consulta falla o tarda, NO la repita en bucle: el conector la bloquea 10 minutos. Acótela más (menos días, menos campos) o pregúntele a la persona.',
    '- Las consultas son ACOTADAS y SECUENCIALES: no lance decenas de consultas en paralelo, ni desde subagentes, contra la misma empresa.',
    '- Lo de SAPSEND en SAP: las solicitudes y órdenes que crea SAPSEND son borradores (`Drafts`, `DocObjectCode` `oPurchaseRequest`/`oPurchaseOrders`) y documentos con campos `U_SEND_*`. Lo que SAPSEND guarda en SU propia base (usuarios, departamentos, logs) solo lo ve por los conectores `sapsend-*` si estos traen herramientas de Compras; si no las traen, dígalo y no lo invente.',
    '- ESCRITURA: no tiene ninguna. Para validar escrituras de la Fase 2 se usarán las bases de PRUEBAS de SAP (`z_PRUEBAS_*`) por Service Layer, y eso NO está habilitado: cada escritura exige la autorización previa de Nicolás Rivera, caso por caso. No lo intente ni lo prometa.',
    '- Datos: lo que lea de las bases es información interna de la empresa. Úsela para el análisis del proyecto; no copie a este hilo datos personales que la tarea no necesite (cédulas, salarios, correos personales) y nunca los envíe fuera.',
  );
  if (instrucciones) l.push('', instrucciones);
  return l.join('\n');
}

/**
 * Conectores del turno. Devuelve null si el proyecto no tiene conectores o el
 * turno no es de un lector; { servidores, bloque } si los tiene. Lanza si la
 * configuración es inválida (el llamador corre el turno SIN ellos: falla cerrado).
 */
export function prepararConectoresTurno({ cfg, idProject, lote, cargar = cargarConectoresPorProyecto, verificar = verificarSecretos }) {
  if (!cfg.rutaConectoresPorProyecto) return null;
  const v = cargar(cfg.rutaConectoresPorProyecto);
  const proyecto = v?.proyectos.get(idProject);
  if (!proyecto) return null;
  if (!turnoConConectores(lote, v.lectores)) {
    return {
      servidores: [],
      motivo: 'autor fuera de la lista de lectores',
      bloque: `\n## Bases de datos\n\nEn este turno NO tiene los conectores de bases de datos del proyecto: solo los reciben los turnos que escriben ${v.lectores.map((c) => `\`${c}\``).join(' o ')}. No cite datos que haya leído de ellos en turnos anteriores.`,
    };
  }
  const elegidos = proyecto.conectores.map((n) => v.conectores.get(n));
  verificar(cfg.conectoresSecretos, [...new Set(elegidos.map((c) => c.llave).filter(Boolean))]);
  const servidores = elegidos.map((c) => ({
    nombre: c.nombre,
    herramientas: c.herramientas,
    descripcion: c.descripcion,
    config: c.llave
      ? { type: 'http', url: c.url, headersHelper: comandoCabeceras({ rutaSecretos: cfg.conectoresSecretos, llave: c.llave }) }
      : { type: 'http', url: c.url },
  }));
  return { servidores, motivo: null, bloque: textoConectores({ servidores, instrucciones: proyecto.instrucciones }) };
}

/** Rutas que el sandbox de los comandos nunca debe leer (se suman a `secretos`). */
export function secretosConectores(cfg) {
  return cfg.conectoresSecretos ? [cfg.conectoresSecretos] : [];
}
