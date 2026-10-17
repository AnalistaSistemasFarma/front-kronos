# Puente de hilos (proyectos del chat) — F1 piloto

Servicio aparte que atiende las **conversaciones de proyecto** del chat de SynerLink con **una sesión de Claude Code por hilo**. Nicolás Rivera aprobó el piloto el 2026-10-17. Arranca solo con Play (`@silvia_gss_bot`) y **solo en PRUEBAS**.

No reemplaza al bot vivo ni lo toca. El bot de Play sigue en su sesión larga (`com.pedro.play`), con su `.env`, su config y su canal de siempre. La bandeja que lee el bot vivo solo trae hilos directos y menciones de grupo, así que **nunca recibe un mensaje de proyecto**. Este puente lee una bandeja distinta con una llave de alcance `projects`, y esa llave no ve nada más.

## Cómo funciona

1. Hace long-poll a `GET /api/chat/agent/inbox` con la llave de scope `projects` y `ack=false`.
2. Cada mensaje entra a la cola de **su** conversación. Dentro de un hilo los turnos van en serie, y entre hilos corren en paralelo con un **tope de 2 a la vez** (`src/cola.mjs`). Los mensajes que llegan mientras un hilo trabaja salen juntos en el turno siguiente.
3. En cada turno:
   - pide el contexto del proyecto (`/api/chat/agent/projects/context`): instrucciones, perfil, archivos y versión;
   - baja los archivos del proyecto a `proyectos/<id>/archivos/` si cambió la versión, y los adjuntos del chat a `adjuntos/`;
   - escribe `CLAUDE.md`, `.puente/sistema.md` y `.puente/mcp.json`;
   - corre `claude -p --resume <session_id del hilo>` en la carpeta del hilo (`src/claude.mjs`).
4. Publica la respuesta en el hilo, deja el indicador en reposo, reporta el consumo (`/api/chat/agent/usage`, por conversación y también en `consumo.jsonl`) y confirma los mensajes. La confirmación va al final, así que si el puente se cae, el mensaje vuelve a llegar.

## Seguridad del proceso del modelo

| Control | Cómo |
|---|---|
| Config dir **aislado** | `CLAUDE_CONFIG_DIR=<HILOS_DIR>/claude-config`. El puente no arranca si `HILOS_DIR` está dentro de `~/.<bot>/`, de `~/.claude` o de un `claude-config`. |
| Sin sesión ni llavero de ningún bot | La credencial entra **solo** por variable de entorno al hijo. **Nunca** corra `claude /login` con ese config dir. |
| Plugin de Telegram apagado | `--settings {"enabledPlugins":{"telegram@claude-plugins-official":false},"disableAllHooks":true}`. Así se evita el gotcha de los jobs `claude -p` que tumban el poller. |
| Sin modo de permisos abierto | `--restricted` + `--permission-mode dontAsk`. Nunca `bypassPermissions` ni `--dangerously-skip-permissions`; el código lo verifica y el evento `init` se revisa en cada turno. |
| Herramientas mínimas | `Read, Glob, Grep, Edit, Write, TodoWrite` (+ `WebSearch` si el perfil lo pide). Se escribe **solo** en `./trabajo/**`. Bash, WebFetch, Agent/Task y NotebookEdit quedan prohibidos. |
| Conectores MCP por hilo | `--strict-mcp-config --mcp-config` con **solo** los servidores del perfil del proyecto (`config/perfiles.json`) y las herramientas por nombre exacto, sin comodines. |
| Entorno limpio | El hijo no hereda nada del puente: recibe solo PATH, HOME, el config aislado y una credencial. La llave de SynerLink nunca le llega. |
| Llave correcta | Si la bandeja no responde `scope: "projects"` (por ejemplo, porque le pusieron la llave del bot vivo), el puente **no arranca**. |
| Sin `CLAUDE.md` ajenos | No arranca si hay un `CLAUDE.md` por encima de `HILOS_DIR`, porque Claude Code lo cargaría en cada hilo. |

## Autenticación (decisión de Nicolás)

El puente lee **una** credencial de su propio `.env`:

- `HILOS_ANTHROPIC_API_KEY` (**recomendada**): es una llave de API con facturación por consumo y un presupuesto medible por hilo (`HILOS_MAX_BUDGET_USD`).
- `HILOS_CLAUDE_CODE_OAUTH_TOKEN` (solo para el piloto): un token **propio** del puente, generado aparte. **Nunca** el de Play ni el de otro bot.

> ⚠️ Para escalar a producción: la documentación del Agent SDK de Anthropic dice que, sin aprobación previa, los productos de terceros que atienden a varias personas **no deben** ofrecer el inicio de sesión ni los límites de claude.ai, y recomienda la **llave de API**. Un hilo compartido por varias personas de SynerLink entra en ese caso. La decisión (llave de API con presupuesto, o validarlo con Anthropic) **la toma Nicolás**.

## Activación del piloto en PRUEBAS (paso a paso)

Antes de empezar: el PR debe estar fusionado en `testing` y desplegado, y Nicolás debe haber dado el visto bueno. Avísele antes de desplegar, porque el despliegue apaga el SynerLink de pruebas unos 10 minutos.

1. **Base de PRUEBAS.** Saque un respaldo COPY_ONLY y corra `prisma/manual/2026-10-17-chat-proyectos-PRUEBAS.sql`, con `@OwnerEmail` y `@MiembrosCsv` ajustados. El script se detiene en cualquier otra base. Debe correr **antes** del código, porque Prisma lee la columna `id_project`.
2. **`.env` de la aplicación de PRUEBAS** (en el servidor de pruebas, sin imprimir el archivo):
   - `CHAT_PROJECTS_AGENTS={"play":["farmalogica","olp","comex-latam"]}`
   - agregue a `CHAT_AGENT_API_KEYS` una llave **nueva** (de 32 caracteres o más) con `{"key":"…","agent":"play","label":"play-hilos-pruebas","scope":"projects"}`. La llave del bot vivo no se toca.
   - reinicie la app de pruebas.
3. **Carpeta del puente** en el equipo donde va a correr (fuera de `~/.play`):
   ```bash
   mkdir -p ~/.puente-hilos/play-pruebas/logs && chmod 700 ~/.puente-hilos ~/.puente-hilos/play-pruebas
   cp puente-hilos/config/perfiles.example.json ~/.puente-hilos/play-pruebas/perfiles.json
   cp puente-hilos/config/env.example ~/.puente-hilos/play-pruebas/.env && chmod 600 ~/.puente-hilos/play-pruebas/.env
   ```
   Llene el `.env`: la URL de PRUEBAS, la llave de scope `projects`, `HILOS_DIR`, `HILOS_PERFILES` y **una** credencial.
4. **Prueba en primer plano** (Ctrl+C para apagar):
   ```bash
   bash puente-hilos/launchd/run.sh ~/.puente-hilos/play-pruebas/.env
   ```
   Debe imprimir `listo: agente play (Play), entorno pruebas, tope 2 hilos…`.
5. **Como servicio** (opcional; no se carga solo): copie `launchd/com.gss.puente-hilos.play-pruebas.plist.example` a `~/Library/LaunchAgents/`, reemplace `__HOME__` y `__REPO__`, y use `bootstrap` / `kickstart` / `kill SIGTERM` / `bootout`, como dice el encabezado del plist.
6. **Prueba de punta a punta:** abra el chat de pruebas → Play → botón **Proyectos** → entre a «Comex Latam» y escriba. Revise:
   - el indicador «trabajando»;
   - la respuesta en el hilo;
   - una fila en `chat_agent_turn_usage` para esa conversación;
   - que el chat directo de Play **no** recibió nada.

**Apagar:** `launchctl kill SIGTERM …`, o Ctrl+C. Termina los turnos en curso y sale. Para apagar los proyectos en la aplicación, quite `CHAT_PROJECTS_AGENTS` y reinicie la app.

## Pruebas

```bash
cd puente-hilos && node --test test/
```

No tiene dependencias: usa Node 20 o superior y el `claude` instalado, que debe soportar `--restricted`. El puente lo verifica al arrancar.
