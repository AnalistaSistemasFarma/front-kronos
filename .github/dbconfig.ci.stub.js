// STUB de dbconfig para CI (GitHub Actions) — SIN CREDENCIALES REALES.
//
// El archivo real `dbconfig.js` está en .gitignore (contiene la cadena de
// conexión a SQL Server con secretos) y NO existe en un clon limpio. Sin él,
// `tsc`/`next build` fallan con TS2307 "Cannot find module dbconfig".
//
// Este stub reproduce la FORMA de exportación que el código espera:
//   - export default: objeto usable como config de `mssql` (server, port, ...)
//     que además expone los helpers resolveConnection / buildMssqlConfig /
//     getDatabaseConfigKey (ver lib/mssqlPool.ts y app/api/health/database).
//   - named exports: resolveConnection y buildMssqlConfig (usados por scripts/*.cjs).
//
// El workflow copia este archivo a `dbconfig.js` en la raíz antes de compilar.
// Solo sirve para que la compilación de tipos y el build pasen; NUNCA se conecta
// a una base de datos real en CI.

const connection = {
  server: 'ci-stub-host',
  port: 1433,
  database: 'ci_stub_db',
  user: 'ci_stub_user',
  password: 'ci_stub_password',
  options: {
    encrypt: true,
    trustServerCertificate: true,
  },
};

function resolveConnection() {
  return {
    server: connection.server,
    port: connection.port,
    database: connection.database,
    user: connection.user,
    password: connection.password,
  };
}

function buildMssqlConfig() {
  return { ...connection };
}

function getDatabaseConfigKey() {
  return `${connection.server}/${connection.database}/${connection.user}`;
}

const sqlConfig = {
  ...connection,
  resolveConnection,
  buildMssqlConfig,
  getDatabaseConfigKey,
};

module.exports = sqlConfig;
module.exports.default = sqlConfig;
module.exports.resolveConnection = resolveConnection;
module.exports.buildMssqlConfig = buildMssqlConfig;
module.exports.getDatabaseConfigKey = getDatabaseConfigKey;
