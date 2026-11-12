/**
 * CREDENCIAL DE ANTHROPIC DE UN AGENTE DE OPENCLAW, SOLO PARA MEDIR SU CUPO (2026-10-28).
 *
 * Reporte de Nicolás Rivera (2026-10-28 14:49 COT): «los agentes de openclaw no me aparece el
 * consumo». El medidor de Proyectos lee chat_agent_quota, que solo llenaba el runner de Claude
 * Code (rate_limit_event del stream + sonda con el token del .env del puente). openclaw no expone
 * los encabezados anthropic-ratelimit-unified-* y su `status --usage` usa /api/oauth/usage, que
 * responde 403 con un setup-token (pide el scope user:profile). Lo único que sirve es la misma
 * sonda mínima de cuota.mjs con el token CON EL QUE TRABAJA EL AGENTE.
 *
 * Ese token vive en el almacén de credenciales de openclaw del agente:
 *   <estado>/agents/<agente>/agent/openclaw-agent.sqlite
 *     auth_profile_store  (store_key 'primary') → { profiles: { 'anthropic:x': { type, provider, token|access|key } } }
 *     auth_profile_state  (state_key 'primary') → { order: { anthropic: [...] }, lastGood: { anthropic } }
 *   <estado> = ~/.openclaw, ~/.openclaw-<perfil> con --profile, u OPENCLAW_STATE_DIR.
 *   Almacén COMPARTIDO (auth.sharedStore = state-db, p. ej. Lunaris): <estado>/state/openclaw.sqlite,
 *     tabla config_machine_state, claves 'authProfiles.store' y 'authProfiles.state'.
 *   Versiones viejas: <agentDir>/auth-profiles.json con la misma forma.
 *
 * Reglas:
 *   - SOLO LECTURA (la base se abre readOnly): no toca models auth, perfiles, orden ni modelos.
 *   - Se elige el perfil que openclaw usaría: el primero de `order.anthropic` que exista; si no,
 *     `lastGood.anthropic`; si no, el primer perfil de Anthropic.
 *   - Se relee en cada sonda (si el agente rota el token, el medidor lo sigue).
 *   - El valor nunca se registra: `describir()` da solo tipo y perfil.
 *   - Token de suscripción (setup-token u OAuth, sk-ant-oat…) → 'oauth-token' (hay cupo que medir).
 *     Llave de API (sk-ant-api… o type api_key) → 'api-key' (no hay cupo: el gasto va por turno).
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

/** Carpeta de estado de openclaw (la misma regla de `openclaw --profile`). */
export function carpetaEstadoOpenclaw({ perfil = null, env = process.env, home = homedir() } = {}) {
  if (perfil) return path.join(home, `.openclaw-${perfil}`);
  const explicita = (env.OPENCLAW_STATE_DIR ?? '').trim();
  return explicita && path.isAbsolute(explicita) ? explicita : path.join(home, '.openclaw');
}

/** Carpeta del agente dentro del estado (<estado>/agents/<agente>/agent). */
export function carpetaAgenteOpenclaw({ perfil = null, agente, env = process.env, home = homedir() }) {
  return path.join(carpetaEstadoOpenclaw({ perfil, env, home }), 'agents', agente, 'agent');
}

/** Clasifica un perfil de openclaw. Devuelve { tipo, valor } o null si no trae un valor usable. Pura. */
export function clasificarPerfil(p) {
  if (!p || typeof p !== 'object') return null;
  const tipoOc = String(p.type ?? p.mode ?? '').toLowerCase();
  const valor = [p.token, p.access, p.key, p.apiKey].find((v) => typeof v === 'string' && v.trim())?.trim();
  if (!valor) return null;
  if (/^sk-ant-api/.test(valor) || tipoOc === 'api_key' || tipoOc === 'apikey') return { tipo: 'api-key', valor };
  return { tipo: 'oauth-token', valor };
}

/**
 * Elige el perfil de Anthropic que openclaw usaría, a partir del almacén y del estado. Pura.
 * Devuelve { perfil, tipo, valor } o null.
 */
export function elegirPerfilAnthropic(almacen, estado = {}) {
  const perfiles = almacen?.profiles && typeof almacen.profiles === 'object' ? almacen.profiles : {};
  const deAnthropic = (id) => {
    const p = perfiles[id];
    if (!p || String(p.provider ?? id.split(':')[0]).toLowerCase() !== 'anthropic') return null;
    const c = clasificarPerfil(p);
    return c ? { perfil: id, ...c } : null;
  };
  const orden = Array.isArray(estado?.order?.anthropic) ? estado.order.anthropic : [];
  for (const id of orden) {
    const c = deAnthropic(String(id));
    if (c) return c;
  }
  const ultimo = estado?.lastGood?.anthropic;
  if (ultimo) {
    const c = deAnthropic(String(ultimo));
    if (c) return c;
  }
  for (const id of Object.keys(perfiles)) {
    const c = deAnthropic(id);
    if (c) return c;
  }
  return null;
}

/** Lee almacén y estado de la base del agente (solo lectura). */
async function leerDeSqlite(archivo) {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(archivo, { readOnly: true });
  try {
    const fila = (sql, clave) => {
      try {
        const r = db.prepare(sql).get(clave);
        return r ? JSON.parse(Object.values(r)[0]) : null;
      } catch {
        return null;
      }
    };
    return {
      almacen: fila('SELECT store_json FROM auth_profile_store WHERE store_key = ?', 'primary'),
      estado: fila('SELECT state_json FROM auth_profile_state WHERE state_key = ?', 'primary'),
    };
  } finally {
    db.close();
  }
}

/** Lee el almacén compartido de la base de estado (solo lectura). */
async function leerCompartidoDeSqlite(archivo) {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(archivo, { readOnly: true });
  try {
    const valor = (clave) => {
      try {
        const r = db.prepare('SELECT value_json FROM config_machine_state WHERE state_key = ?').get(clave);
        return r ? JSON.parse(r.value_json) : null;
      } catch {
        return null;
      }
    };
    return { almacen: valor('authProfiles.store'), estado: valor('authProfiles.state') };
  } finally {
    db.close();
  }
}

/**
 * Crea el lector de la credencial del agente. `leer()` devuelve { tipo, valor, perfil } o null
 * (sin perfil de Anthropic). Si la lectura falla (base ocupada, por ejemplo) devuelve la última
 * que leyó bien. `describir()` es lo único que va al log: tipo y perfil, nunca el valor.
 */
export function crearLectorCredencialOpenclaw({
  carpetaAgente,
  carpetaEstado = path.resolve(carpetaAgente, '..', '..', '..'),
  leerSqlite = leerDeSqlite,
  leerCompartido = leerCompartidoDeSqlite,
  log = () => {},
}) {
  let ultima = null;
  let avisoFallo = false;
  async function leer() {
    try {
      const sqlite = path.join(carpetaAgente, 'openclaw-agent.sqlite');
      const json = path.join(carpetaAgente, 'auth-profiles.json');
      let elegido = null;
      if (existsSync(sqlite)) {
        const { almacen, estado } = await leerSqlite(sqlite);
        elegido = elegirPerfilAnthropic(almacen, estado ?? {});
      }
      const compartido = path.join(carpetaEstado, 'state', 'openclaw.sqlite');
      if (!elegido && existsSync(compartido)) {
        const { almacen, estado } = await leerCompartido(compartido);
        elegido = elegirPerfilAnthropic(almacen, estado ?? {});
      }
      if (!elegido && existsSync(json)) {
        const d = JSON.parse(readFileSync(json, 'utf8'));
        elegido = elegirPerfilAnthropic(d, d);
      }
      ultima = elegido;
      avisoFallo = false;
      return elegido;
    } catch (err) {
      if (!avisoFallo) log('cuota: no se pudo leer la credencial del agente en openclaw:', err?.code ?? err?.message ?? err);
      avisoFallo = true;
      return ultima;
    }
  }
  function describir(c = ultima) {
    if (!c) return 'sin credencial de Anthropic en openclaw';
    return `${c.tipo === 'api-key' ? 'llave de API' : 'token de suscripción'} (perfil ${c.perfil})`;
  }
  return { leer, describir };
}
