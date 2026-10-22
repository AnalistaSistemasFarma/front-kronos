/**
 * BASE DE PRUEBAS (KRONOSDB_PRUEBAS) PARA TODOS LOS HILOS — guardas del conector
 * «kronos-pruebas-sql» (orden de Nicolás Rivera, 2026-10-22 10:09 COT: «sí, todo»).
 *
 * Todos los hilos de proyecto (prod y pruebas, cualquier usuario, con o sin
 * terminal) leen y escriben en KRONOSDB_PRUEBAS. NUNCA en KRONOSDB (prod) ni en
 * otra base del servidor. Las guardas son de dos niveles y fallan cerradas:
 *
 *  1. TEXTO (este módulo, funciones puras con pruebas): antes de mandar nada al
 *     servidor, el SQL se recorre con un analizador léxico de T-SQL (cadenas,
 *     identificadores entre corchetes o comillas, comentarios anidados) y se
 *     rechaza si:
 *       - menciona KRONOSDB sin _PRUEBAS (en cualquier parte, también dentro de
 *         cadenas: el SQL dinámico las ejecuta);
 *       - trae USE, nombres de 3 o 4 partes hacia otra base, OPENQUERY,
 *         OPENROWSET, OPENDATASOURCE, `EXEC … AT` o procedimientos de linked servers;
 *       - trae DROP/CREATE/ALTER DATABASE, BACKUP, RESTORE, xp_*, sp_configure,
 *         RECONFIGURE, SHUTDOWN, KILL, DBCC, logins, usuarios, roles, permisos
 *         (GRANT/REVOKE/DENY), EXECUTE AS, SETUSER, REVERT, ALTER AUTHORIZATION,
 *         `ON ALL SERVER`, BULK INSERT, credenciales, certificados, llaves…
 *     En `consultar`, además, solo SELECT/WITH y ninguna palabra de escritura.
 *
 *  2. SERVIDOR (pruebas-sql-servidor): cada llamada abre su PROPIA conexión a
 *     KRONOSDB_PRUEBAS, verifica DB_NAME() y se IMPERSONA (EXECUTE AS USER … WITH
 *     NO REVERT) en un usuario SIN LOGIN de esa base: `agente_hilos_lectura`
 *     (solo db_datareader) para consultar y `agente_hilos_escritura`
 *     (datareader + datawriter + ddladmin + EXECUTE) para ejecutar. Con la base
 *     NO TRUSTWORTHY, una suplantación de usuario de base queda encerrada en esa
 *     base: SQL Server niega el acceso a cualquier otra (KRONOSDB incluida), aun
 *     con SQL dinámico armado por partes. Antes de cada lote se vuelve a
 *     verificar DB_NAME() y USER_NAME(); si no coinciden, se aborta.
 */
import { createHash } from 'node:crypto';

export const BASE_PRUEBAS = 'KRONOSDB_PRUEBAS';
export const USUARIO_LECTURA = 'agente_hilos_lectura';
export const USUARIO_ESCRITURA = 'agente_hilos_escritura';
export const MAX_SQL = 200_000;
/** Bases que había en el servidor 192.168.10.3 el 2026-10-22 (el conector refresca la lista de sys.databases). */
export const BASES_CONOCIDAS = ['master', 'tempdb', 'model', 'msdb', 'KRONOSDB', 'KRONOSDB_PRUEBAS', 'z_PRUEBAS_KRONOSDB', 'ORIONDB', 'ORIONDB_PRUEBAS', 'PISA_FARMACEUTICA', 'SAPSEND', 'SAPSEND_02', 'SAPSEND_ABAMIA', 'SAPSEND_GSS', 'SAPSEND_KELAB', 'SAPSEND_MEDITRACK', 'SAPSEND_ONELATAMONCO', 'SAPSEND_PRUEBAS', 'SAPSEND_PRUEBAS_OLP', 'SAPSEND_RYAN', 'SAPSEND_RYAN_TEST'];
export const MAX_FILAS = 2000;
export const FILAS_DEFECTO = 200;

/** Error de guarda: el texto se rechaza ANTES de llegar al servidor. */
export class ErrorGuarda extends Error {
  constructor(motivo) {
    super(motivo);
    this.name = 'ErrorGuarda';
    this.guarda = true;
  }
}

/**
 * Analizador léxico mínimo de T-SQL. Devuelve tokens
 * { tipo: 'palabra'|'ident'|'cadena'|'num'|'simbolo'|'variable', valor, crudo }.
 * Los comentarios se descartan (no se ejecutan); las cadenas se conservan.
 * Lanza ErrorGuarda si una cadena, un identificador o un comentario no cierra.
 */
export function tokenizar(sql) {
  const s = String(sql ?? '');
  const toks = [];
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    const d = s[i + 1];
    if (/\s/.test(c)) {
      i += 1;
      continue;
    }
    if (c === '-' && d === '-') {
      const fin = s.indexOf('\n', i);
      i = fin < 0 ? n : fin + 1;
      continue;
    }
    if (c === '/' && d === '*') {
      // T-SQL anida los comentarios de bloque.
      let prof = 1;
      i += 2;
      while (i < n && prof > 0) {
        if (s[i] === '/' && s[i + 1] === '*') {
          prof += 1;
          i += 2;
        } else if (s[i] === '*' && s[i + 1] === '/') {
          prof -= 1;
          i += 2;
        } else i += 1;
      }
      if (prof > 0) throw new ErrorGuarda('comentario /* sin cerrar');
      continue;
    }
    // Cadena: 'x' o N'x' ('' escapa la comilla).
    if (c === "'" || ((c === 'N' || c === 'n') && d === "'")) {
      let j = c === "'" ? i + 1 : i + 2;
      let val = '';
      for (;;) {
        if (j >= n) throw new ErrorGuarda('cadena sin cerrar');
        if (s[j] === "'") {
          if (s[j + 1] === "'") {
            val += "'";
            j += 2;
            continue;
          }
          j += 1;
          break;
        }
        val += s[j];
        j += 1;
      }
      toks.push({ tipo: 'cadena', valor: val, crudo: s.slice(i, j) });
      i = j;
      continue;
    }
    if (c === '[') {
      let j = i + 1;
      let val = '';
      for (;;) {
        if (j >= n) throw new ErrorGuarda('identificador [ sin cerrar');
        if (s[j] === ']') {
          if (s[j + 1] === ']') {
            val += ']';
            j += 2;
            continue;
          }
          j += 1;
          break;
        }
        val += s[j];
        j += 1;
      }
      toks.push({ tipo: 'ident', valor: val, crudo: s.slice(i, j) });
      i = j;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      let val = '';
      for (;;) {
        if (j >= n) throw new ErrorGuarda('identificador " sin cerrar');
        if (s[j] === '"') {
          if (s[j + 1] === '"') {
            val += '"';
            j += 2;
            continue;
          }
          j += 1;
          break;
        }
        val += s[j];
        j += 1;
      }
      toks.push({ tipo: 'ident', valor: val, crudo: s.slice(i, j) });
      i = j;
      continue;
    }
    if (c === '@') {
      const m = /^@@?[\p{L}\p{N}_$#@]*/u.exec(s.slice(i));
      toks.push({ tipo: 'variable', valor: m[0], crudo: m[0] });
      i += m[0].length;
      continue;
    }
    if (/[\p{L}_#]/u.test(c)) {
      const m = /^[\p{L}_#][\p{L}\p{N}_$#@]*/u.exec(s.slice(i));
      toks.push({ tipo: 'palabra', valor: m[0], crudo: m[0] });
      i += m[0].length;
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(d ?? ''))) {
      const m = /^(0x[0-9a-f]*|[0-9]*\.?[0-9]+(e[+-]?[0-9]+)?)/i.exec(s.slice(i));
      const v = m?.[0] || c;
      toks.push({ tipo: 'num', valor: v, crudo: v });
      i += v.length;
      continue;
    }
    toks.push({ tipo: 'simbolo', valor: c, crudo: c });
    i += 1;
  }
  return toks;
}

const P = (t) => (t && (t.tipo === 'palabra' || t.tipo === 'ident') ? t.valor.toUpperCase() : null);
const esPalabra = (t, ...v) => t?.tipo === 'palabra' && v.includes(t.valor.toUpperCase());

/** Palabras/frases prohibidas en cualquier parte (también dentro de cadenas: el SQL dinámico las ejecuta). */
const PROHIBIDAS_TEXTO = [
  [/\b(CREATE|ALTER|DROP)\s+DATABASE\b/i, 'CREATE/ALTER/DROP DATABASE'],
  [/\bBACKUP\s+(DATABASE|LOG|CERTIFICATE|MASTER\s+KEY|SERVICE\s+MASTER\s+KEY|SYMMETRIC\s+KEY)\b/i, 'BACKUP'],
  [/\bRESTORE\s+(DATABASE|LOG|FILELISTONLY|HEADERONLY|VERIFYONLY|LABELONLY|MASTER\s+KEY|SERVICE\s+MASTER\s+KEY)\b/i, 'RESTORE'],
  [/\bxp_\w+/i, 'procedimientos extendidos xp_* (xp_cmdshell y similares)'],
  [/\bsp_configure\b/i, 'sp_configure'],
  [/\bRECONFIGURE\b/i, 'RECONFIGURE'],
  [/\bSHUTDOWN\b/i, 'SHUTDOWN'],
  [/\bDBCC\b/i, 'DBCC'],
  [/\b(CREATE|ALTER|DROP)\s+(LOGIN|USER|ROLE|APPLICATION\s+ROLE|SERVER\s+ROLE|SERVER\s+AUDIT|DATABASE\s+AUDIT|CREDENTIAL|DATABASE\s+SCOPED\s+CREDENTIAL|CERTIFICATE|ASYMMETRIC\s+KEY|SYMMETRIC\s+KEY|MASTER\s+KEY|ENDPOINT|ASSEMBLY|EVENT\s+SESSION|EXTERNAL\s+DATA\s+SOURCE|EXTERNAL\s+TABLE|AVAILABILITY\s+GROUP|RESOURCE\s+POOL|WORKLOAD\s+GROUP)\b/i, 'logins, usuarios, roles, credenciales o llaves'],
  [/\bsp_(add|drop|change|grant|deny|revoke|set)\w*(login|user|role|member|password|srvrole|linkedserver|server|remotelogin)\w*\b/i, 'procedimientos de logins, usuarios, roles o servidores vinculados'],
  [/\bsp_(password|change_users_login|addumpdevice|attach_db|detach_db|OA\w+|send_dbmail|start_job|add_job\w*|addlinkedsrvlogin|serveroption|setnetname|droplinkedsrvlogin|linkedservers|xp_\w+|procoption|trace_\w+|MSforeach\w+)\b/i, 'procedimientos de sistema no permitidos'],
  [/\b(GRANT|REVOKE|DENY)\b/i, 'GRANT/REVOKE/DENY (permisos)'],
  [/\bEXEC(UTE)?\s+AS\b/i, 'EXECUTE AS'],
  [/\bWITH\s+EXECUTE\s+AS\b/i, 'EXECUTE AS'],
  [/\bSETUSER\b/i, 'SETUSER'],
  [/\bREVERT\b/i, 'REVERT'],
  [/\bALTER\s+AUTHORIZATION\b/i, 'ALTER AUTHORIZATION'],
  [/\bON\s+ALL\s+SERVER\b/i, 'disparadores de servidor (ON ALL SERVER)'],
  [/\bBULK\s+INSERT\b/i, 'BULK INSERT'],
  [/\bOPEN(QUERY|ROWSET|DATASOURCE)\b/i, 'OPENQUERY/OPENROWSET/OPENDATASOURCE (otras bases o servidores)'],
  [/\bsp_(addlinkedserver|dropserver|addserver|catalogs|tables_ex|columns_ex)\b/i, 'servidores vinculados'],
  [/\bKILL\s+[0-9@]/i, 'KILL'],
  [/\bsys\s*\.\s*(server_principals|sql_logins|syslogins|credentials|servers)\b/i, 'catálogos de logins o servidores'],
];

/** KRONOSDB sin _PRUEBAS, en cualquier parte del texto (cadenas incluidas). */
export function mencionaProduccion(sql) {
  return /KRONOSDB(?!_PRUEBAS)/i.test(String(sql ?? '').replace(/KRONOSDB_PRUEBAS/gi, ''));
}

/** Nombres de varias partes fuera de cadenas: [base].[esquema].[objeto] o base..objeto, y servidor.base.esquema.objeto. */
export function basesReferidas(toks) {
  const bases = [];
  for (let i = 0; i < toks.length; i += 1) {
    const t = toks[i];
    if (t.tipo !== 'palabra' && t.tipo !== 'ident') continue;
    // Cadena de identificadores separados por puntos (los huecos «..» cuentan como parte vacía).
    const partes = [t.valor];
    let j = i + 1;
    while (j < toks.length && toks[j].tipo === 'simbolo' && toks[j].valor === '.') {
      const sig = toks[j + 1];
      if (sig && (sig.tipo === 'palabra' || sig.tipo === 'ident')) {
        partes.push(sig.valor);
        j += 2;
      } else if (sig && sig.tipo === 'simbolo' && sig.valor === '.') {
        partes.push('');
        j += 1;
      } else break;
    }
    if (partes.length >= 3) {
      // 3 partes: base.esquema.objeto; 4: servidor.base.esquema.objeto (servidor vinculado).
      // 4 partes con hueco (srv.base..obj) también es servidor vinculado.
      if (partes.length >= 4) bases.push({ base: partes[partes.length - 3], servidor: partes[partes.length - 4], vacio: false });
      else bases.push({ base: partes[0], servidor: null, vacio: partes[1] === '' });
    }
    i = j - 1;
  }
  return bases;
}

/** Palabras que escriben o cambian algo (para `consultar`, que solo lee). */
const ESCRITURA = new Set([
  'INSERT', 'UPDATE', 'DELETE', 'MERGE', 'INTO', 'CREATE', 'ALTER', 'DROP', 'TRUNCATE', 'EXEC', 'EXECUTE',
  'GRANT', 'REVOKE', 'DENY', 'BEGIN', 'COMMIT', 'ROLLBACK', 'SAVE', 'DECLARE', 'SET', 'WAITFOR', 'RAISERROR',
  'THROW', 'OPENQUERY', 'OPENROWSET', 'OPENDATASOURCE', 'BACKUP', 'RESTORE', 'DBCC', 'USE', 'GO', 'PRINT', 'UPDATETEXT', 'WRITETEXT',
]);

/**
 * Valida un lote. modo 'consultar' (solo lectura) o 'ejecutar' (DML/DDL).
 * Devuelve { ok: true } o lanza ErrorGuarda con el motivo, en español.
 */
export function validarSql(sql, modo = 'ejecutar', { bases = null } = {}) {
  // Bases del servidor (las lee el conector de sys.databases); sin la lista, la de siempre.
  const otras = new Set([...(bases ?? BASES_CONOCIDAS)].map((b) => String(b).toUpperCase()).filter((b) => b !== BASE_PRUEBAS && b !== 'TEMPDB'));
  const esOtraBase = (r) => {
    const b = r.base.toUpperCase();
    if (b === BASE_PRUEBAS || b === 'TEMPDB') return false;
    // «base..objeto» (esquema vacío) solo puede ser una base; «x.y.z» puede ser esquema.tabla.columna.
    return r.vacio || otras.has(b) || /^(KRONOSDB|SAPSEND|ORIONDB|MASTER$|MSDB$|MODEL$|PISA|Z_PRUEBAS)/.test(b);
  };
  const texto = String(sql ?? '');
  if (!texto.trim()) throw new ErrorGuarda('el SQL está vacío');
  if (texto.length > MAX_SQL) throw new ErrorGuarda(`el SQL supera ${MAX_SQL} caracteres`);
  if (texto.includes('\u0000')) throw new ErrorGuarda('el SQL trae caracteres nulos');
  if (mencionaProduccion(texto)) throw new ErrorGuarda('menciona KRONOSDB (producción). Este conector SOLO trabaja en KRONOSDB_PRUEBAS');
  for (const [re, nombre] of PROHIBIDAS_TEXTO) {
    if (re.test(texto)) throw new ErrorGuarda(`no se permite ${nombre}`);
  }
  const toks = tokenizar(texto);
  for (let i = 0; i < toks.length; i += 1) {
    const t = toks[i];
    if (esPalabra(t, 'USE')) throw new ErrorGuarda('no se permite USE: la conexión ya está en KRONOSDB_PRUEBAS y no puede cambiar de base');
    // EXEC … AT servidor (ejecución en un servidor vinculado).
    if (esPalabra(t, 'AT') && toks.slice(Math.max(0, i - 40), i).some((x) => esPalabra(x, 'EXEC', 'EXECUTE')) && (toks[i + 1]?.tipo === 'palabra' || toks[i + 1]?.tipo === 'ident')) {
      const previo = toks[i - 1];
      if (previo && (previo.tipo === 'cadena' || (previo.tipo === 'simbolo' && previo.valor === ')'))) throw new ErrorGuarda('no se permite EXEC … AT (servidores vinculados)');
    }
  }
  for (const r of basesReferidas(toks)) {
    if (r.servidor !== null) throw new ErrorGuarda(`no se permiten nombres de 4 partes (servidor vinculado «${r.servidor}»)`);
    if (esOtraBase(r)) throw new ErrorGuarda(`no se permite referirse a otra base («${r.base}»): solo KRONOSDB_PRUEBAS`);
  }
  // Nombres de varias partes dentro de cadenas (SQL dinámico): misma regla.
  for (const t of toks) {
    if (t.tipo !== 'cadena' || !/[.]/.test(t.valor)) continue;
    let sub;
    try {
      sub = tokenizar(t.valor);
    } catch {
      continue; // una cadena de datos que no es SQL; la base sigue encerrada por la suplantación
    }
    // Solo si la cadena parece SQL (un correo o una URL en un dato no es una base).
    const pareceSql = sub.some((x) => esPalabra(x, 'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'FROM', 'JOIN', 'INTO', 'EXEC', 'EXECUTE', 'TABLE', 'VIEW', 'PROCEDURE', 'REFERENCES', 'ALTER', 'CREATE', 'DROP'));
    if (!pareceSql) continue;
    for (const r of basesReferidas(sub)) {
      if (r.servidor !== null) throw new ErrorGuarda(`no se permiten nombres de 4 partes en SQL dinámico («${r.servidor}»)`);
      if (esOtraBase(r)) throw new ErrorGuarda(`no se permite referirse a otra base en SQL dinámico («${r.base}»)`);
    }
  }
  if (modo === 'consultar') {
    const primera = toks.find((t) => !(t.tipo === 'simbolo' && (t.valor === ';' || t.valor === '(')));
    if (!esPalabra(primera, 'SELECT', 'WITH')) throw new ErrorGuarda('pruebas_sql_consultar solo admite SELECT (o WITH … SELECT). Para escribir use pruebas_sql_ejecutar con un motivo');
    for (const t of toks) {
      if (t.tipo === 'palabra' && ESCRITURA.has(t.valor.toUpperCase())) {
        throw new ErrorGuarda(`pruebas_sql_consultar es de solo lectura y el SQL trae «${t.valor}». Para escribir use pruebas_sql_ejecutar con un motivo`);
      }
    }
  }
  return { ok: true };
}

/**
 * Parte un script por líneas `GO` (solas en la línea, con `GO n` opcional, que
 * repite el lote n veces, hasta 100). Respeta cadenas y comentarios de bloque
 * que crucen líneas.
 */
export function partirPorGo(script) {
  const lineas = String(script ?? '').replace(/\r\n?/g, '\n').split('\n');
  const lotes = [];
  let actual = [];
  let enCadena = false;
  let enComentario = 0;
  const avanzar = (linea) => {
    for (let i = 0; i < linea.length; i += 1) {
      const c = linea[i];
      const d = linea[i + 1];
      if (enComentario > 0) {
        if (c === '/' && d === '*') {
          enComentario += 1;
          i += 1;
        } else if (c === '*' && d === '/') {
          enComentario -= 1;
          i += 1;
        }
        continue;
      }
      if (enCadena) {
        if (c === "'") {
          if (d === "'") i += 1;
          else enCadena = false;
        }
        continue;
      }
      if (c === '-' && d === '-') break;
      if (c === '/' && d === '*') {
        enComentario = 1;
        i += 1;
      } else if (c === "'") enCadena = true;
    }
  };
  for (const linea of lineas) {
    const m = !enCadena && enComentario === 0 ? /^\s*GO(?:\s+(\d+))?\s*(?:--.*)?$/i.exec(linea) : null;
    if (m) {
      const veces = Math.min(Math.max(Number(m[1] ?? 1), 1), 100);
      const lote = actual.join('\n');
      if (lote.trim()) for (let k = 0; k < veces; k += 1) lotes.push(lote);
      actual = [];
      continue;
    }
    actual.push(linea);
    avanzar(linea);
  }
  const resto = actual.join('\n');
  if (resto.trim()) lotes.push(resto);
  return lotes;
}

/** Huella corta del SQL para la auditoría. */
export function huella(sql) {
  return createHash('sha256').update(String(sql ?? '')).digest('hex').slice(0, 16);
}

/** Valida el motivo obligatorio de una escritura. */
export function validarMotivo(motivo) {
  const m = typeof motivo === 'string' ? motivo.replace(/\s+/g, ' ').trim() : '';
  if (m.length < 10) throw new ErrorGuarda('falta el motivo (mínimo 10 caracteres): diga para qué es esta escritura en PRUEBAS');
  return m.slice(0, 500);
}

/** Ruta permitida para pruebas_sql_correr_script (relativa a la carpeta del hilo). */
export function validarRutaScript(ruta) {
  const r = String(ruta ?? '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!r || r.includes('\0') || r.startsWith('/') || r.startsWith('~') || r.split('/').some((s) => s === '..' || s === '' || s.startsWith('.'))) {
    throw new ErrorGuarda('ruta no permitida: use una ruta relativa como codigo/<repo>/prisma/manual/<archivo>-PRUEBAS.sql o trabajo/<archivo>.sql');
  }
  if (/^codigo\/[^/]+\/prisma\/manual\/[^/]+-pruebas\.sql$/i.test(r)) return r;
  if (/^trabajo\/(?:[^/]+\/)*[^/]+\.sql$/i.test(r)) return r;
  throw new ErrorGuarda('solo se corren scripts de codigo/<repo>/prisma/manual/*-PRUEBAS.sql o de trabajo/*.sql');
}
