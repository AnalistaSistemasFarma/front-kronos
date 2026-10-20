# Puente de hilos (módulo «Proyectos») — piloto

Servicio aparte que atiende las **conversaciones de proyecto** del chat de SynerLink con **una sesión de Claude Code por hilo**. Nicolás Rivera aprobó el piloto el 2026-10-17. Arranca solo con Play (`@silvia_gss_bot`) y **solo en PRUEBAS**.

No reemplaza al bot vivo ni lo toca. El bot de Play sigue en su sesión larga (`com.pedro.play`), con su `.env`, su config y su canal de siempre. La bandeja que lee el bot vivo solo trae hilos directos y menciones de grupo, así que **nunca recibe un mensaje de proyecto**. Este puente lee una bandeja distinta con una llave de alcance `projects`, y esa llave no ve nada más.

## Módulo «Proyectos» (2026-10-18): varios agentes por proyecto

Desde el módulo, un proyecto tiene **uno o varios agentes designados** (`chat_project_agent`) y cada conversación es de **uno** de ellos (`chat_conversation.id_agent`). No cambia el modelo operativo:

- **Una instancia del puente por agente**, en el Mac de ese agente, con **su** llave `scope: "projects"` y **su** token (el plan de cada agente). `scripts/provisionar-agente.sh <agente>` la deja lista.
- La bandeja de cada llave solo entrega mensajes de **sus** conversaciones en proyectos **activos donde está designado**. Si el dueño retira a un agente, su puente deja de recibir mensajes de ese proyecto y sus conversaciones quedan de solo lectura.
- Cada instancia mantiene su propia carpeta `proyectos/<id>/…` con los archivos del proyecto: dos agentes del mismo proyecto no comparten sesión, carpeta ni consumo.
- **Lo vinculado** (correos y solicitudes) llega en el contexto (`project.links`) y el puente lo escribe en `./contexto/vinculados.md` de la carpeta del hilo en cada turno. Es de solo lectura para el modelo (solo escribe en `./trabajo`) y trae **lo mismo que ven los miembros**: de un correo, asunto, remitente, fecha, número de mensajes y el resumen de quien lo vinculó — **nunca el cuerpo** —; de una solicitud, número, asunto, proceso, empresa y estado actual. No hay un conector MCP nuevo: así la llave del puente nunca entra al proceso del modelo.
- **El cronograma** (2026-10-18) llega en `project.schedule` (tareas con fechas, estado, avance y responsable; solicitudes con sus fechas reales y actividades) y el puente lo escribe en `./contexto/cronograma.md`, de solo lectura. El modelo **no cambia el cronograma**: si quiere crear una tarea o cambiar su estado, avance o fechas, escribe `./trabajo/propuestas-cronograma.json` (máx. 10 por turno, solo `tarea_crear` y `tarea_editar`). Al terminar el turno, el puente lo lee, lo **borra** y lo entrega con SU llave a `POST /api/chat/agent/projects/proposals`; SynerLink valida cada propuesta y la deja **pendiente** hasta que un dueño o editor la confirma con un clic en el Cronograma. La respuesta del hilo dice cuántas quedaron registradas.
- **Decisión (2026-10-18): las conversaciones de proyecto NO montan las herramientas `proyecto_*` de kronos-mcp.** Ese MCP necesita una llave de agente en el proceso del modelo, y aquí el modelo corre con un entorno limpio a propósito. El archivo de propuestas cumple lo mismo con menos superficie: el modelo solo escribe un JSON en `./trabajo`, nunca ve una llave, y todo pasa por la confirmación de una persona. Las herramientas `proyecto_*` del MCP quedan para el **chat directo** con un agente, con la concesión de 24 h que la persona da desde Proyectos («Gestionar con un asistente»). Si más adelante se quisiera el MCP aquí, la opción segura es un MCP **local de solo propuestas** que escriba ese mismo archivo, sin llave.

## Equipo de subagentes (F2, orquestador, 2026-10-18)

Pedido de Nicolás Rivera: «para el tema de proyectos quiero que puedas, de primeras, sugerir subagentes especializados para hacer las actividades que ellos requieran». Es el patrón orquestador-trabajadores de Anthropic, aterrizado a cada proyecto y con el equipo **aprobado por una persona**.

1. **Sugerir equipo.** Al crear el proyecto (casilla, encendida por defecto) o con el botón «Sugerir equipo» de la sección **Equipo**, SynerLink deja un pedido. Este puente lo reclama (`POST /api/chat/agent/projects/team/requests`, cada 15 s entre vueltas de la bandeja), corre UN `claude -p` **sin herramientas** (`--tools ""`), sin conectores, sin sesión (`--no-session-persistence`) y con salida estructurada (`--json-schema`), y entrega de 3 a 6 subagentes (`…/team/suggestions`). Pasa por la misma cola: cuenta dentro del tope de hilos.
2. **Aprobación.** Los subagentes quedan **propuestos**. El dueño (el editor, solo con `PROYECTOS_EQUIPO_EDITOR_APRUEBA=1` en la app) aprueba, edita o descarta cada uno. Todo queda en `chat_project_team_event` (inmutable).
3. **Orquestación.** El contexto del turno trae `team` con **solo lo aprobado**. El puente escribe `.puente/agentes.json` y corre el turno con `--agents` y `--forward-subagent-text`. El principal puede usar la herramienta Agent **solo** con `Agent(<slug>)` del equipo; los agentes incorporados de Claude Code se niegan uno por uno (`Agent(general-purpose)`, `Agent(claude)`, …).

| Tope | Por defecto | Cómo se aplica (verificado con `claude` 2.1.299) |
|---|---|---|
| Subagentes a la vez | 3 (el dueño lo baja a 1–2; el puente acota a `HILOS_SUBAGENTES_MAX_SIMULTANEOS`, máx. 5) | `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`: el que pasa del tope se rechaza («Concurrent subagent limit reached») |
| Profundidad | 1: un subagente no lanza otros | `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1`, Agent/Task en `disallowedTools` de cada subagente y el vigía |
| Tiempo por turno | 15 min (`HILOS_TIMEOUT_TURNO_MS`) | el puente mata el proceso |
| Gasto por pedido | 3 USD con equipo (`HILOS_SUBAGENTES_PRESUPUESTO_USD`; si `HILOS_MAX_BUDGET_USD` es menor, manda ese) | `--max-budget-usd` (incluye a los subagentes) |
| Vueltas por subagente | 30 (`HILOS_SUBAGENTES_MAX_TURNOS`) | `maxTurns` en la definición |
| Segundo plano | prohibido | `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` (el esquema de Agent pierde `run_in_background`) |
| Explore / Plan | apagados | `CLAUDE_CODE_DISABLE_EXPLORE_PLAN_AGENTS=1` |

**Herramientas de un subagente** = intersección del catálogo cerrado aprobado con el perfil del proyecto: Read/Glob/Grep siempre; Write/Edit solo en `./trabajo/**` (la regla de permisos es del proceso principal y la heredan, `permissionMode: dontAsk`); WebSearch/WebFetch solo si el perfil tiene `web`; los conectores de solo lectura del perfil por nombre exacto. **Nunca Bash ni Agent.** Un subagente con `tools` vacío heredaría todo: por eso «Leer el proyecto» va siempre.

**Vigía en vivo** (`src/equipo.mjs → crearVigia`): con `--forward-subagent-text` el puente ve cada herramienta de cada subagente (`parent_tool_use_id`). Mata el turno si el principal lanza un subagente que no es del equipo o con `model`/`cwd`/`isolation`/`run_in_background`; si un subagente usa una herramienta fuera de su lista o intenta lanzar otro; o si corrió con un modelo distinto del aprobado. El bloqueo queda en la auditoría.

**Visibilidad y consumo.** Mientras trabajan, el indicador del chat muestra la **tablita de sub-agentes** que ya existía (`tasks`: «Nombre: qué hace»). Al final del turno, `…/team/runs` registra por subagente: descripción, estado, duración, herramientas y fichas (del `tool_use_result` del Agent: `totalTokens`, `totalDurationMs`, `resolvedModel`). Ojo: `result.usage` de Claude Code es **solo del hilo principal**; el consumo del turno se toma de `modelUsage`, que sí suma a los subagentes.

**Escrituras.** Los subagentes no escriben en SynerLink ni en SAP: no tienen credenciales (entorno limpio) ni conectores de escritura. Un cambio al cronograma sale en su informe y el principal lo deja como **propuesta** en `./trabajo/propuestas-cronograma.json`, que una persona confirma (el mismo patrón del cronograma).

**Apagar:** `HILOS_SUBAGENTES=no` en el `.env` del puente (todos los proyectos) o el interruptor «Encendido» de la sección Equipo (un proyecto).

## Cómo funciona

1. Hace long-poll a `GET /api/chat/agent/inbox` con la llave de scope `projects` y `ack=false`.
2. Cada mensaje entra a la cola de **su** conversación. Dentro de un hilo los turnos van en serie, y entre hilos corren en paralelo con un **tope de 2 a la vez** (`src/cola.mjs`). Los mensajes que llegan mientras un hilo trabaja salen juntos en el turno siguiente.
3. En cada turno:
   - pide el contexto del proyecto (`/api/chat/agent/projects/context`): instrucciones, descripción, perfil, archivos, vinculados y versión;
   - baja los archivos del proyecto a `proyectos/<id>/archivos/` si cambió la versión, y los adjuntos del chat a `adjuntos/`;
   - escribe `CLAUDE.md`, `.puente/sistema.md`, `.puente/mcp.json`, `contexto/vinculados.md` y `contexto/cronograma.md`;
   - corre `claude -p --resume <session_id del hilo>` en la carpeta del hilo (`src/claude.mjs`).
4. Publica la respuesta en el hilo, deja el indicador en reposo, reporta el consumo (`/api/chat/agent/usage`, por conversación y también en `consumo.jsonl`) y confirma los mensajes. La confirmación va al final, así que si el puente se cae, el mensaje vuelve a llegar.

## Seguridad del proceso del modelo

| Control | Cómo |
|---|---|
| Config dir **aislado** | `CLAUDE_CONFIG_DIR=<HILOS_DIR>/claude-config`. El puente no arranca si `HILOS_DIR` está dentro de `~/.<bot>/`, de `~/.claude` o de un `claude-config`. |
| Sin sesión ni llavero de ningún bot | La credencial entra **solo** por variable de entorno al hijo. **Nunca** corra `claude /login` con ese config dir. |
| Plugin de Telegram apagado | `--settings {"enabledPlugins":{"telegram@claude-plugins-official":false},"disableAllHooks":true}`. Así se evita el gotcha de los jobs `claude -p` que tumban el poller. |
| Sin modo de permisos abierto | `--restricted` + `--permission-mode dontAsk`. Nunca `bypassPermissions` ni `--dangerously-skip-permissions`; el código lo verifica y el evento `init` se revisa en cada turno. |
| Herramientas mínimas | `Read, Glob, Grep, Edit, Write, TodoWrite`, más `WebSearch` y `WebFetch` si el perfil tiene `web` (decisión de Nicolás, 2026-10-17). Se escribe **solo** en `./trabajo/**`. Bash y NotebookEdit quedan prohibidos; Agent/Task también, salvo `Agent(<slug>)` del equipo aprobado (ver «Equipo de subagentes»). |
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
6. **Prueba de punta a punta:** abra SynerLink de pruebas → **Procesos → Proyectos** (permiso «Proyectos») → entre a «Comex Latam», abra una conversación con Play y escriba. Revise:
   - el indicador «trabajando»;
   - la respuesta en el hilo;
   - una fila en `chat_agent_turn_usage` para esa conversación;
   - que el chat directo de Play **no** recibió nada.

## Otro agente (`scripts/provisionar-agente.sh`)

Cada agente lleva **su propia instancia** del puente, en el Mac donde corre el bot y con su propio token. Para no repetir los pasos 3 a 5 a mano:

```bash
# 1) Ensayo: solo dice lo que haría.
puente-hilos/scripts/provisionar-agente.sh horus
# 2) Con la llave nueva de scope "projects" en un archivo de una línea (se copia sin mostrarla y se borra):
puente-hilos/scripts/provisionar-agente.sh horus --llave-archivo /ruta/llave.tmp --aplicar
# 3) Opcional: --cargar registra y prende el servicio com.gss.puente-hilos.<agente>-pruebas.
```

El script verifica Node ≥ 20, que `claude` soporte `--restricted`, que el `.env` del bot tenga `CLAUDE_CODE_OAUTH_TOKEN` (solo cuenta la línea, no la lee) y que no haya un `CLAUDE.md` por encima de `~/.puente-hilos`. No sobrescribe una instancia que ya exista y no toca el bot vivo.

Del lado de SynerLink, el agente debe estar en `CHAT_PROJECTS_AGENTS` con perfiles del catálogo (`lib/chat/projects-rules.ts`). Un perfil desconocido deja **todo** el módulo apagado (falla cerrado), así que un perfil nuevo, como `gss`, se agrega al `.env` solo después de desplegar el código que lo trae.

**Apagar:** `launchctl kill SIGTERM …`, o Ctrl+C. Termina los turnos en curso y sale. Para apagar los proyectos en la aplicación, quite `CHAT_PROJECTS_AGENTS` y reinicie la app.

## Producción (instancia aparte, 2026-10-20)

Decisión de Nicolás Rivera (2026-10-20): «lo de prod en prod, lo de testing en testing». El puente de producción es **otra instancia**, nunca el de pruebas con otra URL:

| | Pruebas | Producción |
|---|---|---|
| `HILOS_ENTORNO` | `pruebas` | `produccion` |
| Carpeta (`HILOS_DIR`) | `~/.puente-hilos/<agente>-pruebas` | `~/.puente-hilos/<agente>-prod` |
| Servicio launchd | `com.gss.puente-hilos.<agente>-pruebas` | `com.gss.puente-hilos.<agente>-prod` |
| Llave (`scope: projects`) | `<agente>-hilos-pruebas` | `<agente>-hilos-prod` |

Protecciones de `produccion` (todas fallan cerrado, ver `src/config.mjs`):

- la URL no puede ser de un servidor de PRUEBAS conocido (`HOSTS_PRUEBAS`: la .230 y localhost);
- `HILOS_CONFIRMAR_URL_PRODUCCION` debe repetir la URL exacta;
- `HILOS_DIR` no puede contener «pruebas» ni «testing», ni ser una carpeta que ya usó otro puente (estado, hilos, sesiones o config) sin sello de producción;
- al arrancar, la carpeta queda **sellada** (`.entorno.json`, 600) con el entorno y la URL. Un puente de pruebas no arranca sobre una carpeta sellada como producción, y producción no la reutiliza con otra URL. Así, pruebas y producción nunca comparten estado ni sesiones (el config aislado `claude-config` y las sesiones viven dentro de cada carpeta).

Cada línea del log lleva el entorno: `[puente-hilos] [produccion] listo: agente …, entorno produccion, …`.

## Pruebas

```bash
cd puente-hilos && node --test test/*.test.mjs
```

No tiene dependencias: usa Node 20 o superior y el `claude` instalado, que debe soportar `--restricted`. El puente lo verifica al arrancar.

## Acceso al código (nivel 2, 2026-10-20)

Aprobado por Nicolás Rivera el 2026-10-20 (13:14 COT, «sí, dale»; 13:15 COT, «sí puede subir a testing y prod, para eso es»). Código: `src/codigo.mjs`. Es **aditivo y opcional**: sin `HILOS_REPOS_POR_PROYECTO`, nada cambia.

**Vincular repos a un proyecto:** `repos-por-proyecto.json` (ejemplo en `config/`), en la carpeta del puente. Se relee en **cada turno**: vincular o desvincular no exige reiniciar. Más adelante lo puede administrar SynerLink (por ejemplo, `project.repos` en el contexto) con el mismo validador (`validarReposPorProyecto`).

**Muchos repos: montaje bajo demanda** (`"bajoDemanda": true` en el proyecto). Cada turno monta solo:
- los repos que ya tienen worktree en la conversación;
- los que nombra algún mensaje del turno (por nombre o «dueño/repo», con borde de palabra);
- los que Orus nombró en su respuesta anterior (`.puente/repos-solicitados.json`).

El resto aparece en un **índice** en el encabezado del turno (`textoIndiceRepos`), con su estado. Si no hay ninguno montado, el turno va **sin código** (sin Bash ni token), solo con el índice. Así no se hace `fetch` ni `--add-dir` de decenas de repos por turno. Cada repo puede llevar `descripcion` para el índice. Sin `bajoDemanda`, se montan todos, como antes.

**Por turno, si el proyecto tiene repos:**

1. El puente hace `git fetch` en el clon (`repos/<repo>`) y deja un **git worktree propio de la conversación** en `./codigo/<repo>`, rama `proyecto/<idProject>-c<idConversation>`, salida de `origin/<ramaPruebas>`. Solo trae lo versionado: los `.env` del repo no llegan.
2. Instala en el clon un **hook pre-push** que rechaza todo destino que no sea `refs/heads/proyecto/*` y todo borrado de rama remota.
3. Habilita **Bash** con reglas por prefijo (`git -C codigo/<repo> …`, `gh pr create/view/list/checks…`, `npm`/`npx`/`node`) y **niega** `ssh`, `scp`, `curl`, clientes SQL, `git push` con refspec «:», `--force`, `--no-verify`, `--delete`, `git config/remote/worktree/-c`, `gh api/auth/secret`, `gh pr merge --delete-branch`, etc.
4. Corre los comandos del modelo dentro del **sandbox de Claude Code** (`failIfUnavailable`): red solo a GitHub y al registro de npm; escritura solo en la carpeta del hilo, el `.git` del clon y `home-codigo`; sin lectura de `.env` del puente, del token, `~/.ssh` ni la casa de los bots.
5. **Pases** (`gh pr merge` y `gh workflow run <workflow de producción declarado> --ref <ramaProduccion>`): solo si el proyecto tiene `"pases": true` y **todos** los mensajes del turno los escribió un correo de `operadoresPases`, según `author.email` de la bandeja (sale de la sesión de SynerLink, no del texto). Si no, quedan negados por regla y el modelo lo rechaza.
6. El token de GitHub entra al modelo **solo** como `GH_TOKEN` en esos turnos; la respuesta y la auditoría (`auditoria-codigo.jsonl`: cada comando Bash y cada negación) se publican con el token oculto.

Gotchas de `claude` 2.1.299: `cd <dir> && git …` se niega siempre (por eso `git -C`); un patrón que **termina** en `:*` es el prefijo heredado, no «dos puntos y lo que sea»; `gh` (Go) necesita `sandbox.enableWeakerNetworkIsolation` para verificar TLS; el `credential-osxkeychain` del sistema se cuelga sin sesión gráfica (`GIT_CONFIG_NOSYSTEM=1` y ayudante propio).

**Verificar sin escribir en hilos:** `scripts/simular-turno-codigo.mjs` (conversación ficticia ≥ 990000; `--sin-reglas-texto` prueba solo los controles duros).

**Límites conocidos:** con `npm test`/`node`, el modelo puede correr código arbitrario dentro del sandbox, incluido usar `GH_TOKEN` contra GitHub. El control de pases es local (reglas y hook): GitHub no lo impone si el token tiene permisos de administrador y el repo no tiene protección de ramas.

## Memoria del agente (solo lectura, 2026-10-20)

Pedido de Nicolás Rivera (16:21 COT): «eso debería usar la memoria que ya tienen los agentes por defecto». El agente de Proyectos corre con config aislado, así que no veía la memoria automática de su bot principal. Con `HILOS_MEMORIA_DIR` (ver `src/memoria.mjs`):

- En cada turno, el puente **copia** los `.md` del directorio `memory/` del bot a `<hilo>/.puente/memoria/` (archivos 400). Nunca escribe en el origen. Los archivos que parezcan tener un secreto (tokens de GitHub, Anthropic, Slack, Telegram, AWS, llaves privadas, JWT, `Bearer`, contraseñas con valor) **no se copian** y quedan en el log.
- El índice `MEMORY.md` va en el encabezado de sistema, como en la memoria nativa (hasta ~220 líneas), con la instrucción de abrir con Read los archivos que necesite. El agente **no escribe memoria**: lo que aprenda lo deja en el hilo en un bloque «🧠 Para la memoria de <agente>» para que el bot principal lo guarde.
- La memoria automática nativa del hijo queda **apagada** (`autoMemoryEnabled: false` y `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`), así no hay dos memorias ni se guarda nada de un proyecto.
- `HILOS_MEMORIA_LECTORES`: si se define, solo los turnos escritos por esas personas (identidad del servidor) reciben la memoria; los demás van sin ella y se borra la copia del hilo.
- Engram no se expone: su servidor MCP abre la base en lectura y escritura y la comparte con el bot vivo.

En proyectos con código (nivel 2) va además un resumen corto del flujo de pases: `contexto/flujo-desarrollo-gss.md` (`src/guia.mjs`).
