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
| Herramientas mínimas | `Read, Glob, Grep, Edit, Write, TodoWrite`, más `WebSearch` y `WebFetch` si el perfil tiene `web` (decisión de Nicolás, 2026-10-17). Se escribe **solo** en `./trabajo/**`. Bash, Agent/Task y NotebookEdit quedan prohibidos. |
| Prompt injection y fuga de datos | El encabezado de sistema de cada turno ordena tratar páginas web, búsquedas, archivos y adjuntos como **datos**, nunca como instrucciones, y **prohíbe** enviar datos de SAP o de la empresa a sitios externos (URL, parámetros, búsquedas, formularios). |
| Conectores MCP por hilo | `--strict-mcp-config --mcp-config` con **solo** los servidores del perfil del proyecto (`config/perfiles.json`) y las herramientas por nombre exacto, sin comodines. |
| Entorno limpio | El hijo no hereda nada del puente: recibe solo PATH, HOME, el config aislado y una credencial. La llave de SynerLink nunca le llega. |
| Llave correcta | Si la bandeja no responde `scope: "projects"` (por ejemplo, porque le pusieron la llave del bot vivo), el puente **no arranca**. |
| Sin `CLAUDE.md` ajenos | No arranca si hay un `CLAUDE.md` por encima de `HILOS_DIR`, porque Claude Code lo cargaría en cada hilo. |

## Autenticación (decisión de Nicolás, 2026-10-17)

«El plan de cada agente, el token de cada agente.» El puente usa el `CLAUDE_CODE_OAUTH_TOKEN` **del propio agente** (en el piloto, el de Play) y lo toma de UNA de estas fuentes:

- `HILOS_TOKEN_ENV_AGENTE` (la del piloto): es la ruta al `.env` del bot, por ejemplo `~/.play/.env`. El puente lee **solo** esa variable, dentro del proceso y sin imprimirla, e ignora el resto del archivo. El bot vivo no se toca.
- `HILOS_CLAUDE_CODE_OAUTH_TOKEN`: el mismo token, copiado sin mostrarlo al `.env` del puente (con permisos 600).
- `HILOS_ANTHROPIC_API_KEY`: llave de API. Queda como alternativa para cuando se escale.

Lo que **no** cambia:

- No se reutiliza el llavero ni la sesión viva del bot.
- El config dir sigue **aislado**, así que la credencial entra solo por variable de entorno.

> ⚠️ **El puente comparte el límite de uso con el bot vivo.** El token es el mismo plan, así que lo que consumen los hilos sale del mismo límite semanal de Play. Si se agota, se frenan los dos. Los topes (2 hilos, 15 min por turno) y `consumo.jsonl` sirven para medirlo.
>
> Nota para cuando se escale: la documentación del Agent SDK de Anthropic recomienda la llave de API para productos que atienden a varias personas.

## Activación del piloto en PRUEBAS (paso a paso)

Antes de empezar: el PR debe estar fusionado en `testing` y desplegado, y Nicolás debe haber dado el visto bueno. Avísele antes de desplegar, porque el despliegue apaga el SynerLink de pruebas unos 10 minutos.

1. **Base de PRUEBAS.** Saque un respaldo COPY_ONLY y corra `prisma/manual/2026-10-17-chat-proyectos-PRUEBAS.sql`, con `@OwnerEmail` y `@MiembrosCsv` ajustados. El script se detiene en cualquier otra base. Debe correr **antes** del código, porque Prisma lee la columna `id_project`.
2. **`.env` de la aplicación de PRUEBAS** (en el servidor de pruebas, sin imprimir el archivo):
   - `CHAT_PROJECTS_AGENTS={"play":["farmalogica","olp","comex-latam"]}`
   - agregue a `CHAT_AGENT_API_KEYS` una llave **nueva** (de 32 caracteres o más) con `{"key":"…","agent":"play","label":"play-hilos-pruebas","scope":"projects"}`. La llave del bot vivo no se toca.
   - reinicie la app de pruebas.
3. **Carpeta del puente** en el **Mac de Pedro** (192.168.10.100, donde corre Play), fuera de `~/.play`:
   ```bash
   mkdir -p ~/.puente-hilos/play-pruebas/logs && chmod 700 ~/.puente-hilos ~/.puente-hilos/play-pruebas
   cp puente-hilos/config/perfiles.example.json ~/.puente-hilos/play-pruebas/perfiles.json
   cp puente-hilos/config/env.example ~/.puente-hilos/play-pruebas/.env && chmod 600 ~/.puente-hilos/play-pruebas/.env
   ```
   Llene el `.env`: la URL de PRUEBAS, la llave de scope `projects`, `HILOS_DIR`, `HILOS_PERFILES` y **una** credencial (en el piloto, `HILOS_TOKEN_ENV_AGENTE=~/.play/.env`, ruta absoluta).
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
cd puente-hilos && node --test test/*.test.mjs
```

No tiene dependencias: usa Node 20 o superior y el `claude` instalado, que debe soportar `--restricted`. El puente lo verifica al arrancar.
