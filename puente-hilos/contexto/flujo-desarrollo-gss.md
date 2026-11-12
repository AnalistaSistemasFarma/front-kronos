# Resumen del flujo de pases de GSS

Versión 2026-10-20. Complemento corto de su memoria: el detalle (servidores, gotchas, recetas, decisiones) está en ella; búsquelo ahí (`tema-front-kronos-ramas-ci`, `front-kronos-deploy-prod`, `tema-sapsend-entornos-deploy`, `feedback-*`, `gotcha-*`). Si esto choca con las reglas de «Acceso al código» de este turno, mandan las del puente.

**A testing (front-kronos, SAPSEND):**
1. Rama `proyecto/<id>-…` desde `origin/testing`, con el cambio mínimo y sus pruebas (`tsc`, `lint`, `vitest` / `node --test`).
2. `gh pr create --base testing` y CI en verde. Si trae SQL: scripts `-PRUEBAS`, `-PROD` y `-reversa` en `prisma/manual/` (solo aditivo, guarda `DB_NAME()`); usted no los ejecuta.
3. Agrupe las correcciones en una sola tanda.
4. Escriba el aviso «📣 Aviso para el grupo de Teams» con la bandera **🧪 TESTING**, y espere el visto bueno de Nicolás (o Cristian) escrito en el hilo.
5. `gh pr merge <n> --merge --admin`, **nunca** `--delete-branch`. En front-kronos corre `deploy-testing.yml` (unos 5 min, con el SynerLink de pruebas apagado).
6. Al terminar: duración frente a las anteriores, URL directa y aviso 🧪 posterior.

**A producción:**
- front-kronos: no se promueve `testing` → `main`. El PR de `testing` se agrega por `cherry-pick -x -m 1` a `release/pendiente-prod` (PR borrador permanente a `main`; hoy se fusionó el #682). Eso lo arma y lo pasa el Orus principal con un operador: deje el pedido escrito en el hilo (PR, merge commit, si trae SQL, `schema.prisma`, `package.json` o variables).
- Hotfix: rama `proyecto/<id>-hotfix-…` desde `origin/main`, cherry-pick y PR a `main`; fusionar a `main` despliega a producción (aviso **🚀 PROD**). Luego el mismo arreglo va a `testing`.
- Orden del pase: aviso 🚀 → respaldo `COPY_ONLY` → SQL con guarda → fusión y despliegue → `migrate resolve` → verificación → aviso posterior. Ventana controlada si cambian `schema.prisma` o `package.json`. Si se cae: stop → build → start. Nunca cerrar la sesión RDP 3 de nicolas.rivera en serfarma05 (ahí vive PM2).
- SAPSEND: fusionar a `production` no despliega; `gh workflow run deploy-<empresa>.yml --ref production`, solo para las empresas que diga el operador.
- `front-orion`: fusionar a `testing` ya es producción real (🚀 PROD).

**Siempre:** solo Nicolás Rivera y Cristian Baldión autorizan producción. Nunca SQL directo a SAP (solo Service Layer, con autorización previa para escribir). Lo que esté fuera de su alcance (SSH, SQL, `.env`, PM2, Teams, el release) lo deja en un bloque «🔧 Para el Orus principal» en el hilo.
