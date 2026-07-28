# Scripts de `front-kronos`

Utilidades de mantenimiento, verificación y control de calidad del repositorio.

## `prod-gate-check.mjs` — Compuerta GO / NO-GO para el pase a producción

Parte de la **Fase 2** del plan de control de calidad. Ejecuta y agrega la
batería de validación del "flujo de autorización" y emite un veredicto:

- **GO** — todas las compuertas bloqueantes en verde. Exit code `0`.
- **GO-CONDICIONADO** — verde salvo acciones manuales pendientes (p. ej. correr
  un DDL a mano en prod). Exit code `0`, pero con advertencias claras.
- **NO-GO** — alguna compuerta bloqueante en rojo. Exit code distinto de `0`.

### Compuertas que evalúa

| # | Compuerta | ¿Bloquea? |
|---|---|---|
| 1 | `npx tsc --noEmit` (raíz) | Sí |
| 2 | `npm run lint` — no bloquea si el único error es el preexistente de `ecosystem-test.config.js` | Solo errores NUEVOS |
| 3 | `npm test -- --coverage` (front) — incluye el umbral de cobertura (piso "ratchet" de `vitest.config.ts`) | Sí |
| 4 | `cd mcp && npm test` | Sí |
| 5 | `npm audit --json` (raíz y `mcp`) — resumen por severidad | No (informativo) |
| 6 | **Chequeo de DDL/esquema** — detecta SQL de esquema (`ALTER/CREATE TABLE`, `ADD COLUMN`, …) o cambios en `prisma/schema.prisma` en el diff. Si hay cambios de esquema en código **sin** script `.sql`/migración que los acompañe → **GO-CONDICIONADO** con la acción "correr DDL manual en prod" (recuerde: en prod **NO** se corre `prisma migrate`). | Condiciona |
| 7 | **Regresión de tools MCP** — confirma que el contrato de tools (`totalTools`, nombres) sigue intacto vía las pruebas de `mcp/test`. | Avisa |

> **Refuerzo "opción 2" (análisis de seguridad gratis).** Las compuertas 2 y 5
> quedan reforzadas por dos controles estáticos sin costo:
>
> - **Compuerta 2 (lint):** `eslint.config.mjs` registra `eslint-plugin-security`
>   con **todas sus reglas en modo `warn`** (nunca `error`). Así SURFACEA
>   patrones peligrosos (inyección de objetos, `eval`, regex vulnerables a ReDoS,
>   `child_process`, `Buffer` sin aserción, posibles ataques de temporización,
>   `require`/`fs` con ruta no literal, etc.) **sin romper** el build ni la
>   compuerta por deuda preexistente.
> - **Compuerta 5 (audit):** el CI (`.github/workflows/ci.yml`) corre `npm audit`
>   **informativo** (no bloqueante) en los jobs *front* y *MCP*, volcando el
>   conteo por severidad al resumen del job.
>
> Ambos arrancan **informativos** a propósito (criterio "ratchet"): el plan es
> depurar los hallazgos de seguridad y las vulnerabilidades y, cuando el árbol
> esté saneado, subir las reglas y el `npm audit` a **bloqueantes**.

### Cómo lo corre el Agente Orus localmente (veredicto antes de un pase a prod)

Desde la raíz del repo, con el entorno de CI reproducido:

```bash
# 1) Reproducir el entorno que usa el CI
npx prisma generate                       # genera app/generated/prisma
cp .github/dbconfig.ci.stub.js dbconfig.js   # stub sin credenciales (dbconfig.js está gitignored)
npm ci                                     # deps del front
cd mcp && npm ci && cd ..                  # deps del MCP

# 2) Correr la compuerta (base por defecto: origin/main = promoción testing -> prod)
git fetch origin main:refs/remotes/origin/main
node scripts/prod-gate-check.mjs

# Ver el exit code (0 = GO / GO-CONDICIONADO, != 0 = NO-GO):
echo $?
```

**Flags:**

- `--base <rama>` — rama base para calcular el diff (default `origin/main`).
  Útil para evaluar solo el delta de una rama concreta.
- `--skip-build` — omite el `next build` implícito (hoy el script no corre build;
  la bandera se acepta por compatibilidad y para uso futuro).

Ejemplos:

```bash
node scripts/prod-gate-check.mjs --base origin/testing
node scripts/prod-gate-check.mjs --base origin/main --skip-build
```

El script imprime un resumen legible con ✅/⚠️/❌ por compuerta, el veredicto
final y las acciones pendientes. En CI (`.github/workflows/prod-gate.yml`, que
corre en los PR hacia `main` y por `workflow_dispatch`) además publica ese
resumen en `$GITHUB_STEP_SUMMARY`.

> **Nota sobre GO-CONDICIONADO por esquema:** al promover `testing -> main` es
> normal que el diff contra `origin/main` acumule cambios de `prisma/schema.prisma`
> de PR previos. El script lo marca como GO-CONDICIONADO recordando aplicar el
> DDL a mano en la ventana de promoción, con backup previo. **No es un bloqueo**,
> es un recordatorio operativo del gate de prod.
