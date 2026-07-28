<!--
Plantilla de Pull Request — front-kronos
Parte del plan de control de calidad para el pase a producción (Fase 0).
Complete TODAS las secciones. Los PR sin el checklist diligenciado no se aprueban.
-->

## Descripción del cambio

<!-- ¿Qué hace este PR y por qué? Sea concreto. -->

## Tipo de cambio

- [ ] Corrección de error (bugfix)
- [ ] Nueva funcionalidad (feature)
- [ ] Regla de negocio (RN) nueva o modificada
- [ ] Refactor / deuda técnica (sin cambio de comportamiento)
- [ ] Configuración / infraestructura / CI
- [ ] Documentación

---

## Checklist obligatorio

### a) Descripción y alcance
- [ ] La descripción explica el cambio y su tipo está marcado arriba.

### b) ¿Incluye cambios de esquema de base de datos?
- [ ] **No** incluye cambios de esquema.
- [ ] **Sí** incluye cambios de esquema y **adjunto el script DDL manual** abajo.

> ⚠️ **En producción NO se corre `prisma migrate`.** El deploy de prod (main.yml)
> omite `prisma generate` y `migrate deploy` a propósito. Todo cambio de esquema
> se aplica **a mano** en la ventana de promoción, con backup previo. Si marcó
> "Sí", pegue aquí el DDL exacto (CREATE/ALTER/DROP) que se ejecutará:

```sql
-- DDL manual aquí (o "N/A" si no aplica)
```

### c) Pruebas unitarias
- [ ] Agregué o actualicé pruebas unitarias (front `vitest` y/o `mcp` `vitest`).
- [ ] `npm test` (front) pasa localmente.
- [ ] `cd mcp && npm test` pasa localmente.

### d) Evidencia de QA / smoke test en `testing`
- [ ] Probé el cambio en el entorno de pruebas (.230) o describo cómo se validará.

<!-- Adjunte capturas, pasos reproducibles o el resultado del smoke test. -->

### e) Regresión de las tools MCP de la flota
- [ ] Confirmo que **no rompo** la superficie de tools del MCP (`kronos_*`).
- [ ] Si agregué/quité una tool, **actualicé las aserciones de conteo**
      (`totalTools`, `names.length`) en `mcp/test/` acorde.

### f) Plan de rollback
<!-- ¿Cómo se revierte si sale mal? (revert del commit, restaurar build anterior,
     revertir DDL, etc.) -->

---

## Compuertas de CI (deben quedar en verde)

El workflow `CI — Compuerta de calidad` (`.github/workflows/ci.yml`) valida:

- **Front:** `tsc --noEmit`, `lint`, `next build`, `vitest`.
- **MCP:** `tsc` (build) y `vitest`.

> El lint puede reportar deuda **preexistente** sin romper la compuerta; el
> criterio es **no introducir errores NUEVOS**.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
