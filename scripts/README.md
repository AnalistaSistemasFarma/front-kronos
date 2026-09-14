# Scripts de `front-kronos`

Utilidades de mantenimiento, seeds y control de calidad.

## Cableados en `package.json`

| npm | Script | Uso |
|-----|--------|-----|
| `npm run dev` | `dev.mjs` | Dev server (+ resolución host SQL) |
| `npm run verify:deploy` | `verify-deployment-changes.cjs` | Checklist pre-despliegue |
| `npm run test:orion` / `check:orion` | `test-orion-integration.mjs` | Smoke Orion ↔ Kronos |
| `npm run seed:orion` | `seed-orion-workflow.mjs` | Campo/workflow `orion_signature` |
| `npm run check:login` | `check-login.mjs` | Diagnóstico login |
| `npm run test:db` | `test-db-connection.cjs` | Probar conexión SQL |
| `npm run db:route` | `windows-sql-route.ps1` | Ruta Wi‑Fi → SQL (admin) |
| `npm run db:resolve` | `resolve-db-host.mjs` | Elegir host SQL alcanzable |
| `npm run reset:password` | `reset-password.mjs` | Reset clave (solo pruebas) |
| `npm run seed:dashboard-solicitudes` | `seed-dashboard-solicitante-solicitado.cjs` | Subprocesos dashboard |

## Orion / permisos (manual)

```bash
node scripts/seed-firma-manage-subprocess.cjs
node scripts/seed-firma-manage-subprocess.cjs --email=usuario@empresa.com --also-sign
```

E2E local: `powershell -ExecutionPolicy Bypass -File scripts/run-orion-e2e.ps1`

Help desk URLs: `node scripts/sync-help-desk-subprocess-urls.cjs`

## `prod-gate-check.mjs` — GO / NO-GO a producción

```bash
npx prisma generate
cp .github/dbconfig.ci.stub.js dbconfig.js
npm ci && cd mcp && npm ci && cd ..
git fetch origin main:refs/remotes/origin/main
node scripts/prod-gate-check.mjs
```

Flags: `--base <rama>`, `--skip-build`. Veredicto en exit code `0` = GO / GO-CONDICIONADO.
