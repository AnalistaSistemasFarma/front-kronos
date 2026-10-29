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
- **Archivos adjuntos en la respuesta** (2026-10-21, `src/adjuntos-salida.mjs`). En **todos** los turnos (cualquier usuario, con o sin código, con o sin sandbox) el modelo puede adjuntar archivos: los crea en `./trabajo` (donde siempre tiene Write) y en su respuesta final escribe una línea sola `MEDIA:trabajo/salida/archivo.csv` por archivo, fuera de bloques de código. El encabezado de cada turno explica la convención. El puente quita esas líneas, valida cada archivo (solo dentro de `./trabajo` de la conversación, sin `..`, sin enlaces simbólicos —ruta real exacta y apertura con `O_NOFOLLOW`—, sin ocultos ni `propuestas-cronograma.json`, extensiones `xlsx, xls, csv, pdf, docx, pptx, png, jpg, jpeg, txt, md, json`, 1 B a 25 MB, máximo 5) y lo sube con SU llave en `multipart/form-data` a `POST /api/chat/agent/messages` (la misma ruta y campos del conector del canal). Lo rechazado se dice en el hilo solo con el nombre; si la subida falla, la respuesta sale igual sin archivos y con un aviso. Un archivo que contenga el token de GitHub del turno no sale. Sin terminal, Write solo produce texto (csv/md/txt/json); un .xlsx/.docx real necesita un turno con terminal, y un PDF se pide con `PDF:trabajo/….html` (el puente convierte el HTML; ver «Skills, recursos y PDF»). Desde el 2026-10-23 los adjuntos **sí** quedan también en la pestaña «Archivos» del proyecto (ver el punto siguiente).
- **Adjuntos archivados en el proyecto** (2026-10-23, `src/archivar-proyecto.mjs`; requisito de Nicolás Rivera: «todos los documentos que genere desde el chat de un proyecto deben archivarse en los Archivos del proyecto»). Cada archivo que sale con la respuesta (`MEDIA:` o el PDF de `PDF:`) se sube **además**, antes de publicar, a `POST /api/chat/agent/projects/files` (multipart `idConversation` + `files`, llave del puente). La app lo registra como «subido por <agente> en la conversación N» y un nombre repetido queda como `nombre (2).ext`, sin pisar nada. Si falla, la respuesta sale igual con su adjunto y una línea `⚠️ … no quedó archivado en los Archivos del proyecto: <motivo>`; si sale bien, una línea `📁 Quedó archivado…`. Si la ruta todavía no existe en ese entorno (404 sin cuerpo de la API), reintenta una vez a los 3 s y luego no insiste durante 5 min (igual que la cuota). El encabezado de cada turno lo avisa. `HILOS_ARCHIVAR_EN_PROYECTO=no` lo apaga.
- **Decisión (2026-10-18): las conversaciones de proyecto NO montan las herramientas `proyecto_*` de kronos-mcp.** Ese MCP necesita una llave de agente en el proceso del modelo, y aquí el modelo corre con un entorno limpio a propósito. El archivo de propuestas cumple lo mismo con menos superficie: el modelo solo escribe un JSON en `./trabajo`, nunca ve una llave, y todo pasa por la confirmación de una persona. Las herramientas `proyecto_*` del MCP quedan para el **chat directo** con un agente, con la concesión de 24 h que la persona da desde Proyectos («Gestionar con un asistente»). Si más adelante se quisiera el MCP aquí, la opción segura es un MCP **local de solo propuestas** que escriba ese mismo archivo, sin llave.

## Varios agentes en un mismo hilo (2026-10-29)

Pedido de Nicolás Rivera (2026-10-29): «que varios agentes puedan consultar un hilo de conversación de un proyecto», además de renombrar y eliminar hilos (eso último es solo de SynerLink).

- Cada hilo sigue siendo de **un** agente principal. En el hilo, una persona puede **mencionar con @** a otro agente designado en el proyecto al que ella misma le puede escribir. SynerLink crea una fila en `chat_message_delivery` para ese agente y su bandeja `projects` la entrega (además de sus hilos propios). Si la persona mencionó **solo** a otros, el principal no lo recibe.
- El agente mencionado lo atiende **su propio puente**, con su propia sesión y carpeta para esa conversación, y responde en el mismo hilo con su nombre. Los agentes no se invocan entre ellos: solo una persona despierta a otro agente.
- El contexto trae `conversation.history` (últimos 40 mensajes, cada uno recortado a 4.000 caracteres), `conversation.mainAgent` y `conversation.invited`. El puente lo escribe en `./contexto/hilo.md` (solo lectura, bloques citados) en cada turno, para Claude Code y para openclaw (ruta absoluta en el encabezado). Al invitado el encabezado le pide leerlo antes de responder y no repetir lo del principal. Con un SynerLink sin historial, no cambia nada.
- **Conversación eliminada** (borrado lógico): la bandeja deja de entregarla y la API responde 404 a contexto, estado y respuesta. El puente registra «ya no está disponible (404): se deja de atender» y no publica el aviso de error.

## Equipo de subagentes (F2, orquestador, 2026-10-18)

Pedido de Nicolás Rivera: «para el tema de proyectos quiero que puedas, de primeras, sugerir subagentes especializados para hacer las actividades que ellos requieran». Es el patrón orquestador-trabajadores de Anthropic, aterrizado a cada proyecto y con el equipo **aprobado por una persona**.

1. **Sugerir equipo.** Al crear el proyecto (casilla, encendida por defecto) o con el botón «Sugerir equipo» de la sección **Equipo**, SynerLink deja un pedido. Este puente lo reclama (`POST /api/chat/agent/projects/team/requests`, cada 15 s entre vueltas de la bandeja), corre UN `claude -p` **sin herramientas** (`--tools ""`), sin conectores, sin sesión (`--no-session-persistence`) y con salida estructurada (`--json-schema`), y entrega de 3 a 6 subagentes (`…/team/suggestions`). Pasa por la misma cola: cuenta dentro del tope de hilos.
2. **Aprobación.** Los subagentes quedan **propuestos**. El dueño (el editor, solo con `PROYECTOS_EQUIPO_EDITOR_APRUEBA=1` en la app) aprueba, edita o descarta cada uno. Todo queda en `chat_project_team_event` (inmutable).
3. **Orquestación.** El contexto del turno trae `team` con **solo lo aprobado**. El puente escribe `.puente/agentes.json` y corre el turno con `--agents` y `--forward-subagent-text`. El principal puede usar la herramienta Agent **solo** con `Agent(<slug>)` del equipo; los agentes incorporados de Claude Code se niegan uno por uno (`Agent(general-purpose)`, `Agent(claude)`, …).

| Tope | Por defecto | Cómo se aplica (verificado con `claude` 2.1.299) |
|---|---|---|
| Subagentes a la vez | 3 (el dueño lo baja a 1–2; el puente acota a `HILOS_SUBAGENTES_MAX_SIMULTANEOS`, máx. 5) | `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`: el que pasa del tope se rechaza («Concurrent subagent limit reached») |
| Profundidad | 1: un subagente no lanza otros | `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1`, Agent/Task en `disallowedTools` de cada subagente y el vigía |
| Tiempo por turno | 60 min (`HILOS_TIMEOUT_TURNO_MS`; antes 15 min) con avisos de progreso; ver «Turnos largos» | el puente mata el proceso |
| Gasto por pedido | 3 USD con equipo (`HILOS_SUBAGENTES_PRESUPUESTO_USD`; si `HILOS_MAX_BUDGET_USD` es menor, manda ese). Con `HILOS_MAX_BUDGET_USD=0`/`off`, **sin tope**, tampoco con equipo | `--max-budget-usd` (incluye a los subagentes) |
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

## Turnos largos: tiempo, gasto y avisos (2026-10-22)

Pedido de Nicolás Rivera (2026-10-22, 07:00 COT): «que no tenga límite de dinero por ahora; el límite de tiempo sí, algo razonable» y «si la tarea es muy grande, que la estuviera supervisando, y si se demoró por alguna razón, le avise al usuario». Vale para **todos** los usuarios y proyectos (con o sin código, operador o no). Código: `src/progreso.mjs`.

| Variable | Por defecto | Qué hace |
|---|---|---|
| `HILOS_MAX_BUDGET_USD` | vacío | `0` u `off`: **sin tope de gasto** en los turnos, tampoco con equipo (no se pasa `--max-budget-usd`). Un número: tope por pedido, como antes. El costo se sigue registrando en `consumo.jsonl` (`costoUsd`) y en SynerLink. «Sugerir equipo» conserva su propio tope (`HILOS_SUGERENCIA_PRESUPUESTO_USD`). |
| `HILOS_TIMEOUT_TURNO_MS` | 3600000 (60 min, también el máximo) | Tope duro: el puente detiene el `claude -p` (SIGTERM y, a los 5 s, SIGKILL). |
| `HILOS_AVISO_PROGRESO_MS` | 600000 (10 min; 1 a 30 min; `0`/`off` lo apaga) | Mientras el turno corre, publica en el hilo «⏳ Sigo trabajando en su pedido (lleva 10 min; el máximo por turno es 1 h). Le aviso al terminar.» y, si la hay, UNA línea: «_Lo último: «…»_» (último texto del hilo principal, recortado a 180 caracteres) o «_Ahora: Consultando SAP…_» (la etiqueta del indicador). |
| `HILOS_CONTINUAR_AL_AGOTAR` | `no` | Con `si`: si el turno agota el tiempo, avisa «Continúo automáticamente una vez más…» y relanza UNA continuación (`--resume`, mismo id) con «continúe desde donde quedó». Si también se agota, se rinde con el mensaje de corte. |

- **El indicador no se apaga.** El aviso se publica con `POST /api/chat/agent/messages` y `state`/`label` del momento (nunca `idle`); la ruta no toca la tablita de subagentes. Además, cada 3 min un **latido** reenvía el estado, porque la app deja de pintar «trabajando» si pasan 10 min sin novedades (`ESTADO_RANCIO_MS`) y una herramienta larga (un build, una consulta pesada) no genera eventos. Al terminar, el puente apaga los temporizadores y **espera** lo que esté en vuelo antes de publicar la respuesta y dejar el indicador en reposo.
- **El aviso no reemplaza la respuesta final**: es un mensaje aparte; la respuesta sale igual al terminar. Cada aviso dispara la notificación de mensaje nuevo a los miembros del proyecto (como cualquier respuesta).
- **Si se corta** (tiempo, tope de gasto si lo hay, o error con avance visible), el mensaje dice qué alcanzó a hacer —el último avance y hasta 10 archivos creados o modificados en el turno (los de `./trabajo` con fecha posterior al inicio, más lo que tocó con Write/Edit dentro del hilo)— y que **la sesión conserva el avance**: «Escriba **«continúa»** y retomo desde donde quedé». Ya no dice «intente con una pregunta más acotada».
- **La sesión se conserva**: un turno cortado por tiempo que ya arrancó (hubo `init`) queda marcado como iniciado aunque sea el primero del hilo, para que «continúa» haga `--resume` y no abra una sesión nueva.
- **Encabezado del turno** (`sistema.md`): dice el tope de tiempo y pide guardar el avance en `./trabajo` a medida que avanza y escribir de vez en cuando una frase de lo que va haciendo (es lo que ve la persona si el turno se corta).
- **Por proyecto:** no se configura por proyecto. El tope por defecto ya es el máximo admitido (60 min) y `repos-por-proyecto.json` solo cubre proyectos con código; un valor por proyecto solo serviría para bajarlo.
- **Sin tope de gasto, lo que cuida el gasto es el tiempo**: 60 min por turno, 2 hilos a la vez como mucho y, con continuación automática, hasta 2 h por pedido.

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

## Skills, recursos y PDF (2026-10-21)

**Skills.** En `--restricted`, Claude Code 2.1.299 no carga las skills del config dir ni de `.claude/skills`: solo entran por `--plugin-dir`. `HILOS_PLUGIN_DIRS` (rutas absolutas, coma) carga cada plugin en **todos** los turnos y agrega la herramienta `Skill`. Plugins actuales en `~/.puente-hilos/plugins/`: `graphify` (grafos de código, ver `src/grafos.mjs`) y `gss-design` (marca GSS).

**Recursos de solo lectura.** Si un plugin tiene carpeta `recursos/`, el puente la monta con `--add-dir` en todos los turnos (con o sin terminal, cualquier usuario). Es de solo lectura para la sesión: `Edit`/`Write` siguen permitidos solo en `./trabajo` (y `./codigo` en turnos con código), el modo es `dontAsk` y los archivos están en 0444/0555. Se escogió `--add-dir` sobre una copia dentro de cada conversación (no duplica 2 MB por hilo ni deja una copia escribible en `./`) y sobre una regla `Read(//…)` (en `--restricted` no está verificado que amplíe la lectura; `--add-dir` sí, como con los grafos). El encabezado del turno lista esas carpetas.

**Plugin `gss-design`.** Se arma con `node scripts/plugin-gss-design.mjs` (fuente `~/brain/gss-design`, destino `~/.puente-hilos/plugins/gss-design`, `--ensayo` para probar). Copia `README.md`, `assets/`, `slides/` y `preview/` a `recursos/`, cambia el `@import` de Google Fonts de `colors_and_type.css` por fuentes **locales** (`recursos/fuentes/`: DM Sans, Source Sans 3 y Oi en woff2, OFL, subconjuntos latin y latin-ext) y escribe `skills/gss-design/SKILL.md` desde `plugins/gss-design/SKILL.md` con las rutas absolutas: el HTML enlaza el CSS y los logos por ruta absoluta y pide el PDF con la convención de abajo. La versión anterior queda como `gss-design.bak-<fecha>` (fuera de `HILOS_PLUGIN_DIRS`). Se invoca como `gss-design:gss-design`.

**HTML → PDF en el puente** (`src/pdf.mjs`). Sin terminal, la sesión no puede correr Chrome; por eso convierte el puente, al final del turno. La sesión escribe el HTML con `Write` en `./trabajo` y en su respuesta final pone, en una línea sola y fuera de bloques de código, `PDF:trabajo/salida/informe.html` (también vale `MEDIA:` con un `.html`). El puente valida el HTML (dentro de `./trabajo`, sin `..`, URL, ocultos ni enlaces simbólicos, de 1 B a 10 MB), lo convierte y cambia la línea por `MEDIA:trabajo/salida/informe.pdf`, que sigue el camino normal de los adjuntos (25 MB, máximo 5). El PDF queda junto al HTML (escrito con temporal + `rename`: un enlace simbólico con ese nombre se reemplaza, no se sigue). El HTML **no** se adjunta: depende de rutas locales y abierto en otro navegador correría su JavaScript. Si algo falla, el hilo lo dice («No pude convertir a PDF: …») y la respuesta sale igual. Un HTML que contenga el token de GitHub del turno no se convierte.

Chrome (`chrome-headless-shell` de Playwright; el Chrome de escritorio no arranca dentro del perfil porque necesita su socket en la carpeta temporal del usuario) corre así:
- dentro de `sandbox-exec` con un perfil que **niega toda la red** (incluido localhost: los MCP y SAP no se alcanzan), **niega leer el contenido** de `/Users`, `/private/tmp`, `/private/var/folders`, `/Volumes` y `/Library/Keychains` salvo el binario de Chrome, su carpeta temporal, `./trabajo`, `./adjuntos`, `./contexto`, los archivos del proyecto y los `recursos/` de los plugins (no `.puente/` ni `./codigo`), y **niega escribir** fuera de su carpeta temporal. Verificado: sin el perfil, un `<iframe src="file:///…/.env">` se imprime; con el perfil sale en blanco;
- con `--no-sandbox`, porque macOS no deja iniciar el sandbox propio de Chrome dentro de otro perfil (la contención la da el de afuera, que heredan todos los procesos de Chrome);
- con `--headless --disable-gpu`, proxy muerto (`--proxy-server=http://127.0.0.1:9 --proxy-bypass-list=<-loopback>`), `--host-resolver-rules=MAP * ~NOTFOUND`, `--disable-background-networking`, sin extensiones, perfil nuevo en cada conversión, entorno vacío y tiempo máximo (`HILOS_PDF_TIMEOUT_MS`, 60 s) con muerte del grupo de procesos. El PDF solo sale si empieza por `%PDF-` y pesa hasta 25 MB. JavaScript propio del HTML sí corre (las plantillas de diapositivas lo usan), pero no tiene red ni más archivos que los de arriba.

Variables: `HILOS_PDF` (`si` por defecto, `no` lo apaga), `HILOS_PDF_CHROME` (ruta absoluta; vacío = el `chrome-headless-shell` más nuevo de `~/Library/Caches/ms-playwright`), `HILOS_PDF_TIMEOUT_MS`. Si no hay Chrome, el encabezado lo dice y la sesión entrega `.md`/`.csv`.

Verificación real (2026-10-21, haiku, 0,05 USD): `scripts/simular-turno-real.mjs --contexto-falso --modelo claude-haiku-4-5 --adjuntos-en <dir>` con un usuario no operador (sin Bash): la sesión invocó la skill, escribió el HTML con el CSS y el logo por ruta absoluta, pidió `PDF:` y el puente adjuntó un PDF A4 de una página con DM Sans y Source Sans 3 incrustadas.

## Comandos «/x» en los hilos (2026-10-22)

Pedido de Nicolás Rivera (2026-10-22 11:13 COT): «comandos como /goal no funcionan desde los proyectos; quiero que se puedan ejecutar todos los comandos desde el chat también». Para todos los usuarios y proyectos. Código: `src/comandos.mjs` (pruebas en `test/comandos.test.mjs`).

**Por qué no funcionaban.** El puente le pasaba al `claude -p` el lote con encabezado («**Fulano** escribió:\n/goal …»): el texto ya no empezaba por «/» y Claude Code no lo trataba como comando. Además, `/goal` (integrado de Claude Code 2.1.299: «keep working until the condition is met», evaluado por un hook de parada de la sesión) se niega a correr con `disableAllHooks` («/goal can't run while hooks are restricted»). Y de las skills del Orus principal solo estaban montadas `gss-design` y `graphify`.

**Cómo funciona ahora.** Un mensaje que es SOLO un comando (lote de un mensaje) se resuelve por lista blanca:

| Tipo | Comandos | Qué hace el puente |
|---|---|---|
| Del puente | `/ayuda` (`/comandos`, `/help`), `/goal` (ver), `/clear` (`/nueva`) | Responde sin correr el modelo; `/clear` abre sesión nueva (la anterior queda en `estado.json` como `sesionAnterior`). |
| Nativos | `/goal <condición>`, `/goal clear`, `/compact`, `/context`, `/recap`, `/usage` y `/cost` (solo operadores) | El turno se manda TAL CUAL («/x args») al `claude -p`. |
| Skills | las de los plugins montados (`/gss-design`, `/graphify`, `/grafos-proyectos` y las del plugin `orus`) y las incluidas `/dataviz`, `/debug`, `/deep-research`, `/claude-api`; `/code-review`, `/simplify`, `/security-review`, `/verify` solo con código montado (corren `git` de lectura al cargarse) | Igual, como `/<plugin>:<skill> args`; los adjuntos del mensaje van en los argumentos. |
| No disponibles | interfaz (`/config`, `/login`, `/resume`…), configuración (`/model`, `/permissions`, `/mcp`, `/hooks`, `/init`…), segundo plano (`/schedule`, `/loop`, `/batch`, `/run`…) y las skills excluidas del Orus | «/x no está disponible en los hilos de proyecto porque …», sin correr el modelo. |

Un comando junto con otros mensajes en el mismo lote no se ejecuta: el turno va normal con una nota. Un comando NUNCA cambia lo que el turno puede hacer: herramientas, conectores, terminal, producción y permisos los fija el puente igual que para un mensaje normal.

**`/goal`.** El objetivo se guarda POR CONVERSACIÓN en `estado.json` y va en el encabezado de sistema y del prompt de cada turno. Mientras esté vigente, el turno corre con `disableAllHooks: false` y `hooks: {}` (ningún hook propio; `--restricted` ya ignora los settings de usuario/proyecto/local), que es lo que necesita el `/goal` nativo; Claude Code lo restaura solo al hacer `--resume`. Al terminar el turno el puente lee el último `goal_status` de la transcripción: `met` → «✅ Objetivo cumplido» y se quita; `failed` (imposible) → se quita con aviso. Para que un objetivo que depende de una persona («que Nicolás confirme…») no haga girar el turno sin fin, el turno se para tras **3** devoluciones «no cumplido» del evaluador (`MAX_REVISIONES_OBJETIVO`): se publica el avance y el objetivo sigue activo para el próximo mensaje.

**Plugin `orus` (skills del Orus principal).** Se arma con `node scripts/plugin-skills-orus.mjs` (fuente `~/.horus/claude-config/skills`, destino `~/.puente-hilos/plugins/orus`, `--ensayo` para probar) y se suma a `HILOS_PLUGIN_DIRS`. Es una COPIA saneada, 0444/0555: del frontmatter de cada `SKILL.md` solo quedan `name`, `description`, `argument-hint`, `when_to_use`, `version`, `license` y `user-invocable` (fuera `allowed-tools`, `hooks`, `model`, `context`, `agent`), la sintaxis «!`comando`» se neutraliza, y de los demás archivos solo entra texto e imágenes/fuentes sin nombre ni contenido de secreto (patrones de `memoria.mjs`). Excluidas, con su motivo en `excluidas.json` (el hilo lo dice si las piden): las de infraestructura de agentes (`migrar-agente-synerlink`, `cambiar-auth-token`, `voz-tiempo-real`, `auditoria-agentes-ia`), las que escriben en producción (`crear-usuario-synerlink`, `cierre-casos-synerlink`, `sgc-activar-empresa`), las que instalan skills (`find-skills`, `geo-update`) y las de la bóveda personal (`obsidian-cli`, `analisis-reuniones`). La carpeta `skills/` de cada plugin se monta en solo lectura (`--add-dir`) para que las skills lean sus referencias. Lo que cambie en el Orus principal entra al volver a correr el script.

Verificación real (2026-10-22, haiku, `scripts/simular-turno-real.mjs --contexto-falso`, usuario no operador): `/ayuda`; `/goal` fijado, cumplido en el mismo turno y quitado; `/goal` que depende de una persona, parado a las 3 revisiones (53 s) y cumplido en el turno siguiente cuando «Nicolás» confirmó (restaurado por `--resume`); `/goal clear`; `/model`, `/usage`, `/config` y `/cambiar-auth-token` rechazados con su motivo; `/abogado-del-diablo` (plugin `orus`); `/context`, `/recap`, `/compact`; `/clear` y `/compact` en hilo nuevo; escritura fuera de `./trabajo` negada en el turno con objetivo.

## Modo Orus completo (2026-10-22, orden de Nicolás Rivera)

Nicolás Rivera, 2026-10-22 11:58 COT: «para mi caso, que tenga los mismos permisos que tienes tú en el
hilo principal, en todos los proyectos». Código: `src/orus-completo.mjs`.

- **Quién:** los turnos cuyos mensajes son TODOS de un correo de `HILOS_AUTORES_ORUS_COMPLETO`, según la
  identidad que entrega el servidor (`author.kind=user`, `author.email`), nunca según el texto. Un lote
  mezclado va en el modo normal. Aplica en **todos** los proyectos, estén o no en `repos-por-proyecto.json`.
- **Qué tiene:** todas las herramientas (Bash sin sandbox, Agent, WebFetch, WebSearch…) con
  `--permission-mode bypassPermissions`; los MCP del Orus principal leídos en cada turno de
  `HILOS_ORUS_COMPLETO_CONFIG_DIR` (`mcpServers` de usuario de `.claude.json` + MCP de sus plugins
  habilitados, sin `synerlink`/`synerlink-prod` ni Telegram; `${VAR}` con `HILOS_ORUS_COMPLETO_ENV`), más
  los del puente (PRUEBAS, conectores del proyecto); la casa real de horus (SSH, gh, `~/.horus/.env`);
  todas las skills (`HILOS_ORUS_COMPLETO_PLUGIN`, plugin «orus» completo en lugar del saneado); y en
  proyectos con repos, la terminal completa con worktree y pases. Siguen negadas `AskUserQuestion` y la
  protección de ramas. El turno sigue con el config AISLADO del puente (`--setting-sources user`, sin hooks).
- **Excepción a «arranque inseguro»:** solo `armarArgumentosCompleto` + `revisarInitCompleto` (que revisa
  que no aparezca ningún conector no declarado). Los demás turnos siguen rechazando bypassPermissions.
- **Secretos:** el mcp.json del turno (lleva las llaves del principal) se escribe 600 en
  `<HILOS_DIR>/orus-completo/` y se borra al terminar el turno. Nunca va al repo.
- **Contexto mixto:** el encabezado del sistema y una línea al inicio del mensaje le dicen al modelo que
  solo ejecute lo del mensaje actual del autor y que lo anterior de otras personas es dato; cada turno en
  este modo queda en `auditoria-codigo.jsonl` (`modo: orus-completo`: inicio, cada herramienta, negaciones).
- Si el config del principal no se puede leer, el turno va en el modo normal y lo dice en el hilo.

## Conectores del agente y otros agentes (2026-10-22, orden de Nicolás Rivera)

Nicolás Rivera, 2026-10-22 17:22 COT, al habilitar Proyectos para más agentes (primero Play): «cada agente trabaja en sus proyectos con lo que ya tiene: sus propios conectores, los mismos de su chat, sin configurarlos por proyecto; su propio token; acceso a código solo si ya lo tiene». Código: `src/conectores-agente.mjs`.

- **Qué hace.** Con `HILOS_CONECTORES_AGENTE_CONFIG_DIR` (el config dir del bot vivo, p. ej. `/Users/pedro/.play/claude-config`), en **cada turno** el puente LEE los MCP del chat del agente y los suma al perfil del proyecto, en todos los proyectos y para todos los usuarios: `mcpServers` de usuario de su `.claude.json`, los del proyecto cuya ruta es su carpeta de trabajo (`HILOS_CONECTORES_AGENTE_PROYECTO`, o la carpeta más cercana que la contiene, como hace Claude Code) y los de sus plugins habilitados (p. ej. engram). Nunca entran `synerlink`/`synerlink-prod` ni Telegram. `${VAR}` se resuelve con el `env` de su settings.json y `HILOS_CONECTORES_AGENTE_ENV` (su `.env`). Un nombre que choque con un conector del perfil no lo pisa.
- **Qué NO cambia.** El turno sigue `--restricted` + `dontAsk`, sin Bash (salvo código vinculado), escritura solo en `./trabajo`, config aislado y entorno limpio. Las herramientas de esos conectores se permiten por servidor (`mcp__<nombre>`): son «todas sus herramientas, como en su chat».
- **Secretos.** La configuración del agente puede traer llaves: el mcp.json COMPLETO del turno (perfil + agente) va en `<HILOS_DIR>/conectores-agente/` (600, fuera de la carpeta del hilo, negado al sandbox) y se borra al terminar el turno. `.puente/mcp.json` del hilo sigue solo con el perfil.
- **Si falla** (config ilegible), el turno va sin ellos y el hilo lo dice. La línea «listo:» lista los NOMBRES (`conectores del agente: …`).
- **Skills del agente:** `node scripts/plugin-skills-orus.mjs --fuente ~/.<bot>/claude-config/skills --destino ~/.puente-hilos/plugins/<bot> --nombre <bot> --agente "<Nombre> (@handle)"` arma SUS skills como plugin saneado; se suma a `HILOS_PLUGIN_DIRS` junto con `gss-design` (PDF).
- **Modo Orus completo:** solo en las instancias de horus. En los puentes de otro agente, `HILOS_AUTORES_ORUS_COMPLETO` va vacío: los turnos de Nicolás en proyectos de ese agente tienen las capacidades del agente (su token, sus conectores), no las del Orus principal, cuyos secretos y llaves SSH no deben salir del Mac de horus.

## Perfil del agente: desarrollo o negocio (2026-10-26, pedido de Nicolás Rivera)

Play (comercio exterior) recibía en su proyecto opciones y textos de desarrollo. Regla general para todos los agentes que no son de desarrollo (`src/perfil-agente.mjs`):

- `HILOS_PERFIL=desarrollo` (por defecto; Orus y Pedro): como siempre, el código solo entra en proyectos con repos vinculados.
- `HILOS_PERFIL=negocio` (Play): el contexto de código no se activa **nunca**, aunque el proyecto tenga repos vinculados en la pantalla de Permisos. No hay carpeta `codigo/`, worktrees, token de GitHub, terminal, índice de repos, guía de desarrollo, grafos de Graphify ni las skills `/code-review`, `/simplify`, `/security-review`, `/verify` y `/claude-api`. El bloque de memoria no habla de ramas, pases ni servidores. El encabezado lleva el enfoque del agente (`HILOS_ENFOQUE`, una línea).
- Con `negocio`, el puente no arranca si el `.env` trae `HILOS_REPOS_POR_PROYECTO`, `HILOS_GITHUB_TOKEN_ARCHIVO` o `HILOS_GRAFOS_DIR`. La línea «listo:» dice el perfil.

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

**Pruebas, tipos y lint en el worktree (2026-10-20):** el hilo principal corre `npm ci`/`npm install`, `npx vitest`, `npx tsc`, `npx eslint`, `npm test` y `npm run lint` dentro del sandbox. El worktree nace sin `node_modules` (y sin `.env`): el encabezado del turno dice si faltan las dependencias y le pide al modelo `cd <ruta completa> && npm ci`. La **caché de npm es compartida** por todas las conversaciones (`<HILOS_DIR>/cache-npm`, `NPM_CONFIG_CACHE` + `prefer-offline`): el primer `npm ci` de un repo la llena y los siguientes casi no usan red. `NPM_CONFIG_YES=false` impide que `npx` baje un paquete que no esté en `node_modules` (sin esto, `npx tsc` bajó el paquete falso `tsc@2.0.4`). El sandbox admite además `binaries.prisma.sh`, de donde el postinstall de Prisma baja sus motores. Ojo: la carpeta actual de Bash se conserva entre comandos, por eso se pide la ruta completa del worktree en cada `cd`.

**Modelo del hilo principal:** `HILOS_MODELO` en el `.env` de cada puente (p. ej. `claude-opus-5-5`); se pasa como `--model` y el log de arranque lo muestra. Sin ella, el predeterminado de la cuenta. Los subagentes usan el modelo que fijó su equipo (`null` = heredan el principal).

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

## Bases de datos por proyecto (solo lectura, 2026-10-20)

Pedido de Nicolás Rivera (17:24 COT) para el proyecto 1: «necesita hacer un análisis duro». Con `HILOS_CONECTORES_POR_PROYECTO` (ver `src/conectores.mjs` y `config/conectores-por-proyecto.example.json`):

- A los proyectos vinculados se les **suman** conectores MCP ya existentes y blindados (`mcp-sapbo-*`, `sapsend-*`, `kronos-synerlink` con llave de lectura). Nunca credenciales SQL: la base se consulta a través del conector, que impone su candado.
- Herramientas por nombre exacto; el validador rechaza comodines y cualquier herramienta de escritura conocida (`sap_create/update/delete/action/batch`, las de escritura de Kronos, `proyecto_proponer_*`).
- Solo en turnos escritos por `lectores` (identidad del servidor), como la memoria. Los demás turnos van con el perfil tal cual.
- **Llaves Bearer fuera del hilo:** el `mcp.json` del hilo (que el modelo puede leer) lleva un `headersHelper` (`src/cabeceras-conector.mjs`) que lee `HILOS_CONECTORES_SECRETOS` (600). Ese archivo está en el `denyRead` del sandbox de los turnos con código y fuera de la carpeta del hilo.
- **Red:** las conexiones MCP las abre el propio Claude Code, no los comandos de Bash, así que el sandbox **no** se abre hacia 192.168.10.5: `node`/`npm` siguen sin llegar a los conectores, a SSH ni al 1433.
- El encabezado del turno lleva las reglas: filtro de fecha siempre, `top` pequeño, nunca `groupby`/`aggregate` ni `maxPageSize: 0` sin rango de fechas, sin reintentos en bucle, sin escritura (las bases `z_PRUEBAS_*` por Service Layer NO están habilitadas: cada escritura exige autorización previa de Nicolás).
- Se relee en cada turno; si el archivo o las llaves fallan, el turno corre sin estos conectores y lo dice.

## Base de PRUEBAS y testing para TODOS los hilos (2026-10-22)

Orden de Nicolás Rivera (2026-10-22 10:09 COT). Todos los hilos de proyecto, en el puente de prod y en el de pruebas, con cualquier usuario y sin depender del rol ni de la terminal, reciben dos conectores MCP locales por stdio (`src/mcp-pruebas-kronos.mjs`, armados en `src/pruebas-kronos.mjs`):

| Conector | Herramientas |
|---|---|
| `kronos-pruebas-sql` | `pruebas_sql_consultar` (solo SELECT, tope de filas), `pruebas_sql_ejecutar` (DML/DDL con `motivo` auditado), `pruebas_sql_correr_script` (`codigo/<repo>/prisma/manual/*-PRUEBAS.sql` o `trabajo/*.sql`, partido por GO) |
| `synerlink-testing-web` | `testing_http` (GET/POST como usuario QA en 192.168.11.230:3030), `testing_captura` (PNG en `./trabajo/capturas`, Chrome sin ventana en sandbox con salida solo a un proxy local hacia testing) |

- **Guardas de texto** (`src/pruebas-sql.mjs`): analizador léxico de T-SQL; rechaza KRONOSDB sin `_PRUEBAS` (también dentro de cadenas), `USE`, nombres de 3/4 partes hacia otras bases, OPENQUERY/OPENROWSET/`EXEC … AT`, DROP/CREATE/ALTER DATABASE, BACKUP, RESTORE, `xp_*`, `sp_configure`, logins, usuarios, roles, GRANT/REVOKE/DENY, EXECUTE AS, REVERT, `ON ALL SERVER`, BULK INSERT…
- **Guardas del servidor** (`src/pruebas-sql-servidor.mjs`): una conexión por llamada a `KRONOSDB_PRUEBAS`, verificación de `DB_NAME()` al conectar y antes de cada lote, y suplantación `EXECUTE AS USER … WITH NO REVERT` a usuarios SIN LOGIN de esa base (`agente_hilos_lectura`, `agente_hilos_escritura`; `scripts/pruebas-kronos-usuarios.sql`). Con la base no TRUSTWORTHY, la sesión no puede salir de ella aunque el login sí tenga acceso a otras. Tiempo máximo: 60 s por consulta, 120 s por lote.
- **Credenciales**: clave `kronos-pruebas` de `HILOS_CONECTORES_SECRETOS` (`{ sql: {server, port, database, user, password, encrypt}, qa: {email, password} }`, archivo 600). La sesión del QA se guarda en `<HILOS_DIR>/pruebas-kronos-sesion-qa.json` (600, negada al sandbox). Auditoría: `<HILOS_DIR>/auditoria-pruebas-kronos.jsonl`.
- `HILOS_PRUEBAS_KRONOS=no` lo apaga; `HILOS_PRUEBAS_KRONOS_WEB` cambia la web (solo hosts de pruebas).
- Requiere `npm ci` en `puente-hilos/` (dependencia `mssql`). Verificación real: `node scripts/verificar-pruebas-kronos.mjs --secretos <archivo>`.

## Agentes de openclaw (`HILOS_RUNNER=openclaw`, 2026-10-27)

Autorizado por Nicolás Rivera el 2026-10-27 (15:36 COT). Diseño completo: `migrar-agente-synerlink/traspasos/puente-proyectos-openclaw-20261027/DISENO.md`.

Con `HILOS_RUNNER=openclaw` la instancia atiende los proyectos de un agente de **openclaw** (Duo, Lunaris, Senhatsumi, los de OLP y UNIDOSSIS). En vez de `claude -p`, cada turno corre `openclaw agent --agent <id> --session-key proyecto-<entorno>-c<conv>-<gen> --json --timeout <s> --message-file <f>` (`src/openclaw.mjs`, `src/atender-openclaw.mjs`). El camino de Claude Code no cambia.

- **Sesión:** una por conversación, en un espacio de nombres distinto del chat del agente (`synerlink-…`). `/clear` abre otra (cambia `<gen>`).
- **Contexto:** viaja en el mensaje de cada turno, con rutas absolutas (ficha, miembros, Archivos, vinculados, cronograma, instrucciones). El texto de las personas va entre marcas aleatorias.
- **Se reutiliza:** bandeja `projects`, cola por hilo, Archivos, adjuntos de entrada, `MEDIA:` (incluidos los `payloads[].mediaUrl` de openclaw y lo que el agente deje en su outbox, `HILOS_OPENCLAW_OUTBOX`), archivado en la pestaña Archivos, propuestas del cronograma, avisos de progreso y latido, mensaje de corte, consumo (`meta.agentMeta.usage`) y ack al final.
- **Indicador fino** por el Gateway (`src/openclaw/actividad.mjs`, copia del skill). Si el agente cede el turno (`sessions_yield`), el puente espera el anuncio dentro del mismo turno (`src/openclaw/seguimiento.mjs`).
- **Tope:** al vencer, mata el CLI y llama `chat.abort` de la sesión en el Gateway.
- **Sin ampliar permisos:** el puente no pasa `--model`/`--thinking`/herramientas ni toca la configuración de openclaw. La configuración **no arranca** si se define una credencial de Anthropic, `HILOS_PERFIL` distinto de `negocio`, conectores, plugins, memoria, PRUEBAS, `HILOS_CUOTA=si`, equipo, modelo o tope de gasto, o un perfil de `perfiles.json` con conectores o web.
- **Medidor de consumo** (2026-10-28, reporte de Nicolás Rivera: «los agentes de openclaw no me aparece el consumo»): openclaw no emite `rate_limit_event` ni expone los encabezados `anthropic-ratelimit-unified-*`, y su `status --usage` usa `/api/oauth/usage`, que responde 403 con un setup-token. El puente lee **en solo lectura** la credencial de Anthropic que el agente usa en openclaw (`<estado>/agents/<agente>/agent/openclaw-agent.sqlite`, perfil según `order`/`lastGood`; `src/openclaw/credencial.mjs`) y hace la misma sonda mínima de `cuota.mjs` al cerrar cada turno y cada `HILOS_CUOTA_INTERVALO_MS` sin turnos; publica en `/api/chat/agent/quota`. Con llave de API no hay cupo: no se sondea y el gasto queda por turno en `/api/chat/agent/usage` y `consumo.jsonl` (`costoUsd`). `HILOS_OPENCLAW_CUOTA=no` lo apaga; `HILOS_CUOTA` sigue en `no` (es el medidor de Claude Code). El valor del token nunca va al log.
- **PDF** (decisión de Nicolás Rivera, 2026-10-27: «sí, claro, con todos»): igual que con Claude Code, el agente escribe HTML en `trabajo/` y termina con `PDF:<ruta>`; el puente lo convierte con Chrome en sandbox (sin red). `HILOS_OPENCLAW_RECURSOS` da las carpetas de marca de solo lectura (gss-design u olp-design).
- **Comandos:** `/ayuda` y `/clear`; los demás responden «no disponible» sin correr el modelo. «Sugerir equipo» devuelve un error claro.

Variables: `HILOS_RUNNER`, `HILOS_OPENCLAW_BIN`, `HILOS_OPENCLAW_AGENTE`, `HILOS_OPENCLAW_PERFIL`, `HILOS_OPENCLAW_LOCAL`, `HILOS_OPENCLAW_SESION_PREFIJO`, `HILOS_OPENCLAW_OUTBOX`, `HILOS_OPENCLAW_AREA`, `HILOS_OPENCLAW_ACTIVIDAD` (ver `src/config.mjs → configOpenclaw`).
