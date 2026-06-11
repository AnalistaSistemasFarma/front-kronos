// PM2 — Servidor MCP de Kronos (SOLO LECTURA).
// Despliegue en SERFARMA05 (o el host correspondiente). Mismo patrón que el
// MCP de SAP. Arranca el build de dist/. Las variables sensibles (DATABASE_URL,
// MCP_API_KEYS) deben venir de un archivo .env NO versionado o del entorno PM2.
//
//   cd mcp && npm ci && npm run build && pm2 start ecosystem.config.js
//
module.exports = {
  apps: [
    {
      name: 'kronos-mcp',
      script: 'dist/server.js',
      exec_mode: 'fork',
      instances: 1,
      cron_restart: '5 0 * * *',
      env: {
        NODE_ENV: 'production',
        MCP_PORT: 3020,
        // DATABASE_URL, MCP_API_KEYS / MCP_API_KEYS_FILE:
        //   defínalos en el entorno o en un archivo .env cargado por PM2.
      },
    },
  ],
};
