// Ecosystem PM2 - ENTORNO DE PRUEBAS Kronos/SynerLink en la .230 (pce0023).
// NOMBRES UNICOS: GSS-Front-TEST (web 3030), kronos-mcp-test (MCP 3031),
// cf-kronos-test (tunel cloudflare al web 3030).
// NO toca SAPSEND-TEST, cf-sapsend ni nada ajeno.
//
// SECRETOS: este archivo NO contiene credenciales. Los secretos viven en:
//   - front-kronos-test/.env      -> lo carga Next.js automaticamente (web).
//   - front-kronos-test/mcp/.env  -> lo carga mcp/serve.mjs al arrancar el MCP.
// Ambos .env estan en .gitignore y NUNCA se versionan.
const path = require('path');
const TEST_ROOT = __dirname;

module.exports = {
  apps: [
    {
      name: 'GSS-Front-TEST',
      cwd: TEST_ROOT,
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3030',
      exec_mode: 'fork',
      instances: 1,
      env: {
        NODE_ENV: 'production',
        PORT: 3030,
        // El resto de variables (DATABASE_URL, NEXTAUTH_*, AZURE_AD_*, etc.)
        // las lee Next.js desde front-kronos-test/.env (gitignored).
      },
    },
    {
      name: 'kronos-mcp-test',
      cwd: path.join(TEST_ROOT, 'mcp'),
      script: 'serve.mjs',
      exec_mode: 'fork',
      instances: 1,
      env: {
        NODE_ENV: 'production',
        // DATABASE_URL, MCP_API_KEYS, MCP_PORT, etc. los carga serve.mjs desde
        // mcp/.env (gitignored). NO poner secretos aqui.
      },
    },
    {
      name: 'cf-kronos-test',
      cwd: 'C:\\Users\\nicolas.rivera',
      script: 'C:\\Users\\nicolas.rivera\\cloudflared.exe',
      args: 'tunnel --no-autoupdate --url http://localhost:3030',
      exec_mode: 'fork',
      instances: 1,
      interpreter: 'none',
    },
  ],
};
