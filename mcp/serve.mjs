// Wrapper de arranque para PM2 en la .230 (entorno de PRUEBAS).
// El guard isMain de dist/server.js no dispara bajo PM2 en Windows, asi que
// arrancamos el servidor explicitamente aqui. NO modifica el codigo del repo.
//
// El servidor MCP lee su configuracion de process.env (loadConfig()). Como el
// paquete no incluye dotenv, cargamos aqui el archivo mcp/.env (gitignored, con
// los SECRETOS: DATABASE_URL, MCP_API_KEYS, etc.) antes de construir la app.
// Asi los secretos NUNCA se versionan ni viven en ecosystem-test.config.js.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Mini-parser de .env (sin dependencias). Soporta KEY=VALUE, comillas simples/
// dobles, valores multilinea entre comillas, y lineas de comentario (#).
function loadDotEnv(path) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    console.warn(`[kronos-mcp-test] aviso: no se encontro ${path}; uso process.env actual`);
    return;
  }
  let i = 0;
  const n = raw.length;
  while (i < n) {
    // saltar espacios/lineas en blanco
    while (i < n && (raw[i] === '\n' || raw[i] === '\r' || raw[i] === ' ' || raw[i] === '\t')) i++;
    if (i >= n) break;
    if (raw[i] === '#') { // comentario hasta fin de linea
      while (i < n && raw[i] !== '\n') i++;
      continue;
    }
    // leer clave
    let key = '';
    while (i < n && raw[i] !== '=' && raw[i] !== '\n') key += raw[i++];
    if (raw[i] !== '=') { // linea sin '=', ignorar
      while (i < n && raw[i] !== '\n') i++;
      continue;
    }
    i++; // saltar '='
    key = key.trim();
    let value = '';
    if (raw[i] === '"' || raw[i] === "'") {
      const quote = raw[i++];
      while (i < n && raw[i] !== quote) value += raw[i++];
      i++; // saltar comilla de cierre
      // descartar resto de la linea
      while (i < n && raw[i] !== '\n') i++;
    } else {
      while (i < n && raw[i] !== '\n' && raw[i] !== '\r') value += raw[i++];
      value = value.trim();
    }
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadDotEnv(join(__dirname, '.env'));

const { createApp } = await import('./dist/server.js');
const { loadConfig } = await import('./dist/config.js');

const config = loadConfig();
const app = createApp(config);
app.listen(config.port, () => {
  console.log(`[kronos-mcp-test] escuchando en http://0.0.0.0:${config.port}/mcp (${config.apiKeys.length} agente(s))`);
});
