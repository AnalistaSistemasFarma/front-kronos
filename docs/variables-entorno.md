# Variables de entorno por módulo (solo nombres)

Este documento lista los **nombres** de las variables de entorno que exigen algunos módulos de SynerLink (front-kronos). Los valores son secretos o dependen del entorno, así que **nunca** se suben al repositorio: viven en el `.env` de cada servidor.

Se creó el 2026-10-08, después de que la restauración de serfarma05 al respaldo del 2026-09-07 borrara estas variables del `.env` de producción sin que nadie lo notara.

## Firma Orion

- `ORION_API_BASE_URL`: URL base de la API de Orion.
- `ORION_EMBED_ORIGIN`: origen permitido para el embebido de Orion.
- `ORION_TENANT_MAP`: mapa JSON de id de empresa de SynerLink a tenant de Orion.
- `ORION_INTEGRATION_API_KEY`
- `ORION_DEFAULT_CREATED_BY_EMAIL`

Si faltan, la integración queda apagada (`enabled=false`).

## Portal TH: Formación en SharePoint

- `PORTAL_TH_SP_TENANT_ID`
- `PORTAL_TH_SP_CLIENT_ID`
- `PORTAL_TH_SP_CLIENT_SECRET`
- `PORTAL_TH_SP_SITE_ID`
- `PORTAL_TH_SP_FOLDER`

## Balances

- `BALANCES_SQL_SERVER`
- `BALANCES_SQL_DB`
- `BALANCES_SQL_USER`
- `BALANCES_SQL_PASS`

## Inventario de agentes

- `AGENT_INVENTORY_COLLECTOR_KEY`: llave del recolector, de al menos 32 caracteres.

## Chat: Proyectos (hilos de agente), F1 piloto

- `CHAT_PROJECTS_AGENTS`: JSON `{"<code del agente>": ["perfil", …]}` con los agentes que tienen proyectos y los perfiles de conectores que se pueden escoger (catálogo en `lib/chat/projects-rules.ts`). Desde el módulo «Proyectos» (2026-10-18) dice qué agentes se pueden **designar** en un proyecto y con qué perfiles; el acceso al módulo lo da el permiso `/process/proyectos` (Administración → Usuarios). Sin la variable, o con un JSON inválido, ningún agente se puede designar ni atiende proyectos (el puente recibe 404). **Desde el 2026-10-20 es el valor por defecto:** la pantalla Procesos → Proyectos → Configuración (`/process/proyectos/configuracion`, tabla `chat_project_agent_config`) decide por empresa qué agentes trabajan en proyectos y con qué perfiles. Una empresa sin configurar sigue con esta variable; al guardar su primer cambio, lo que dice la variable para los agentes de esa empresa se copia a la tabla y desde entonces manda la tabla. Los perfiles nuevos se siguen agregando primero en el catálogo y en el puente.
- `CHAT_AGENT_API_KEYS` (ya existía): ahora admite `"scope": "projects"` por llave. Esa llave es la del **puente de hilos** (`puente-hilos/`) y solo ve conversaciones de proyecto; las llaves sin `scope` (o con `"channel"`) son las de los bots vivos y **no** ven proyectos.

El puente de hilos tiene sus propias variables (`HILOS_*`), que viven en el `.env` del puente y no en el de la aplicación: ver `puente-hilos/README.md`.

## Chat: reacciones, GIF y stickers (2026-10-20)

- `CHAT_GIPHY_API_KEY`: llave de una app de GIPHY (API, no SDK) creada en https://developers.giphy.com → *Create an App* → *API*. Solo la usa el servidor (`lib/chat/gif.ts`): el navegador nunca la ve. **Sin la variable, los GIF quedan apagados** (no aparece la pestaña y `/api/chat/gifs/*` responde 404); las reacciones y los stickers funcionan igual. La llave de prueba (*beta*) tiene un cupo bajo por hora; para producción hay que pedir la llave de producción en el mismo panel (GIPHY revisa la app y pide la atribución «Powered by GIPHY», que ya está en el selector).
- `CHAT_GIF_RATING`: `g` (por defecto) o `pg`. Cualquier otro valor cae a `g`. Se aplica al buscar y otra vez al enviar.
- `NEXTAUTH_SECRET` (ya existía): de él se deriva la llave que firma las URL del proxy de GIF (`/api/chat/gifs/proxy`). Sin él, los GIF también quedan apagados.

Las reacciones y los stickers no necesitan variables, pero sí el SQL `prisma/manual/2026-10-20-chat-reacciones-stickers-{PRUEBAS,PROD}.sql`. Sin ese SQL el chat funciona igual y estas funciones responden «aún no están habilitadas».

## Otros

- `FARMADOSIS_COMPANY_ID`
- `NEXT_PUBLIC_PUSH_ENABLED`: se incrusta en el build, así que un cambio exige `npm run build`.

## Cómo comprobarlo

Antes y después de cada restauración o pase a producción, compare el `.env` del servidor contra esta lista **por nombre**, sin imprimir los valores.
