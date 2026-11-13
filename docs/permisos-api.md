# Permisos API (fase 1, 2026-11-09)

SynerLink es la **fuente única de permisos de los clientes de API**. Hay 5 tipos (`API_CLIENT_TYPES` en `lib/api-permissions/constants.ts`): **Agente de IA**, **México** (casa matriz), **Proveedor o cliente** (socio de negocio de SAP, vía API SAP), **Usuario SynerLink** (integración que actúa como un usuario de SynerLink; agregado el 2026-11-09) y **Otro** (otro sistema). Cada cliente tiene:

- **Sujeto** (a quién representa), elegido de una lista según el tipo; ver «Sujeto de cada cliente».

- **Empresas** en las que puede actuar (o «Todas las empresas»).
- **Permisos**: en la fase 1, las **53 herramientas** del servidor MCP de Kronos (catálogo en la tabla `api_permission`; ver «Catálogo» abajo). La fase 2 agregará módulos de la API SAP.
- **Llaves** `sk_syn_…`: la llave en claro se muestra **una sola vez**; la base guarda solo su SHA-256 y un prefijo visible.

Tablas y semilla: `prisma/manual/2026-11-09-permisos-api-PRUEBAS.sql` / `-PROD.sql` (reversa: `-reversa.sql`). El tipo se limita en la base con el CHECK `api_client_client_type_ck`: si el script principal se corrió antes de existir el tipo SynerLink, aplique también `2026-11-09-permisos-api-tipo-synerlink-PRUEBAS.sql` / `-PROD.sql` (idempotente; solo reemplaza el CHECK). Código: `lib/api-permissions/` (inventario: `inventory.ts` + `inventory-rules.ts`), rutas `app/api/administration/api-clients/`, pantalla `components/administration/api-permissions/`, MCP `mcp/src/dbKeys.ts` y `mcp/src/auth.ts`.

## Quién la ve

Pestaña **Administración → Usuarios → Permisos API** (también con `?vista=permisos-api`). Mismo criterio que «Inicios de sesión» (`lib/api-permissions/access.ts`): ser administrador de Usuarios **y** tener rol `admin`/`super_user`, o el subproceso-marcador `/process/administration/users/permisos-api` (no se crea con el script; se puede agregar después).

## Cómo se usa la pantalla

Diseño (2026-11-09, estilo iOS/macOS con los componentes de `components/ui/panel/`): arriba un resumen (clientes, activos, llaves activas, activos sin uso en 30 días) y un buscador por nombre o agente; debajo, una **sección plegable por tipo** (Agentes de IA · México · Proveedores o clientes · Usuarios SynerLink · Otros) con su contador y un botón **+ Nuevo** que abre el modal con ese tipo ya elegido. Las secciones abiertas se recuerdan en el navegador (`localStorage`); la primera vez se abren las que tienen clientes. Cada fila muestra agente, empresas, permisos, llaves, último uso y estado; tocarla abre el modal.

**Pantalla completa (2026-11-11):** el cliente ya no se abre en un modal sino en su propia pantalla, `/process/api-sap/[id]` (crear: `/process/api-sap/nuevo?tipo=agente`). Arriba van las migas («API SAP › Clientes de API»), el título y los botones **Volver/Cancelar** y **Guardar/Crear**; abajo, la barra fija con el estado («Cambios sin guardar», «Falta: …»). Es el mismo formulario (`ApiClientModal` con `variant='page'`, cargado por `ApiClientPage.tsx`). Si hay cambios sin guardar, «Cancelar» pide confirmación y el navegador avisa antes de cerrar o recargar la pestaña. En cada fila de la lista, el interruptor **Escritura** cambia el nivel de acceso sin abrir el cliente.

El modal es una hoja (pantalla completa en celular) con **Cancelar · título · Guardar/Crear** arriba y, en el pie, qué falta para guardar. Si hay cambios sin guardar, cerrar pide confirmación.

1. Toque **Nuevo cliente** (o **+ Nuevo** en la sección del tipo).
2. En **¿Quién es?**: elija primero el **tipo** (Agente de IA · México · Proveedor o cliente · Usuario SynerLink · Otro). Luego el **sujeto** según el tipo (tercero, usuario o sistema; ver abajo). Si es agente (o marca permisos que lo exigen), elija el **agente**; luego nombre (si está vacío se llena con el del sujeto o agente), **Activo** y descripción.
3. En **Para estas empresas**: active **Todas las empresas** o toque una o **varias** empresas (cada fila marca/desmarca; con más de 8 aparece un buscador).
4. En **Tienen permiso en**: primero la **plataforma** (hoy SynerLink; fase 2 sumará Portal, SAP…), luego cada grupo con «N de M» y **Todo el grupo**. Los no disponibles salen en gris. Hay buscador de permisos.
5. Toque **Crear**. El modal sigue abierto.
6. En **Llaves**, toque **Generar llave**, luego **Copiar llave** y entréguela por un canal seguro. Al cerrar el modal no se vuelve a mostrar.
7. Para cambiarla: **Rotar llaves** (revoca las actuales y genera una nueva) o **Generar llave** + **Revocar** la vieja cuando el cliente ya use la nueva (máximo 5 activas). Rotar y revocar se confirman en una hoja de acción.

Cada cambio queda en `api_client_audit` (quién, cuándo, antes/después; nunca la llave). Un cliente **inactivo** no puede usar ninguna de sus llaves.

## Sujeto de cada cliente (2026-11-09)

Cada tipo elige a quién representa (columnas `api_client.subject_ref` y `subject_label`; reglas en `lib/api-permissions/subject-rules.ts`, confirmación en `validate.ts`, pantalla `components/administration/api-permissions/SubjectPicker.tsx`):

| Tipo | Sujeto | `subject_ref` | Qué confirma el servidor al guardar | `subject_label` |
|---|---|---|---|---|
| Agente de IA | (ninguno; sigue siendo `agent_code`) | NULL | — | NULL |
| México | (ninguno; se crean a mano) | NULL | — | NULL |
| Proveedor o cliente | **Socio de negocio de SAP** (vía API SAP) | NIT, solo dígitos (5-15), sin dígito de verificación | Consulta la API SAP con `?nit=` en las 8 empresas (coincidencia exacta). Si no responde ninguna: «No se pudo confirmar el proveedor o cliente en SAP» y **no guarda** (falla cerrado). | Nombre en SAP (o el NIT) |
| Usuario SynerLink | **Usuario** activo de SynerLink | `[user].id` | Que exista y esté activo (`isActive = 1`) | Nombre o correo |
| Otro | **Sistema** de la lista `api_external_system` | id del sistema | Que exista y esté activo | Nombre del sistema |

- El nombre visible **siempre lo pone el servidor**; el navegador solo manda `subjectRef` (el cuerpo rechaza `subjectLabel`). Un `subjectRef` en Agente o México se rechaza.
- Clientes creados antes de esto (Proveedor, SynerLink u Otro sin sujeto) siguen funcionando con su llave; en el panel salen con «Sin tercero/usuario/sistema» y al editarlos hay que elegirlo.
- Si el sujeto ya tiene otro cliente del mismo tipo, el modal lo avisa («Ya tiene cliente: …»), igual que con los agentes; no lo bloquea.
- En el panel cada fila muestra el sujeto («Tercero: ABAMIA LABS · NIT 901724736», «Usuario: …», «Sistema: n8n») y el buscador también busca por sujeto (nombre o NIT/id).
- **Sistemas** (tipo Otro): en el modal, la fila **Administrar sistemas** abre una hoja para crear, renombrar, cambiar la descripción y activar/desactivar. Nombre único (409 si se repite). Renombrar actualiza en la misma transacción el `subject_label` de los clientes que lo usan. Desactivar no corta a esos clientes, pero al editarlos hay que elegir otro sistema. Cada cambio queda en `api_client_audit` con `id_api_client` NULL y acción `sistema_crear` / `sistema_editar` (detalle: `systemId`, antes/después).

Rutas (mismo permiso que la pestaña, `requireApiClientAdmin`, sin caché, errores genéricos):

- `GET /api/administration/api-clients/subjects/synerlink-users?q=` → `{ items: [{ id, name, email }] }` (top 20 activos por nombre o correo; `q` vacío o de 2 a 60 caracteres).
- `GET /api/administration/api-clients/subjects/portal-terceros?q=` → `{ items: [{ nit, nombre, empresas, tipo }] }`. Puente del servidor a la API SAP (proveedores y clientes); 503 `{ error, code: 'not_configured' }` si falta la configuración; 502 genérico si la API SAP falla en todas las empresas.
- `GET` / `POST /api/administration/api-clients/external-systems` y `PATCH /api/administration/api-clients/external-systems/[id]` (`name`, `description`, `active`; validación estricta).

### Conexión con la API SAP (proveedores y clientes)

Los proveedores y clientes salen de la **API SAP** (proyecto `api-sap`, rama `feat/llave-synerlink`): `GET {SAP_API_URL}/v1/suppliers?nit=` (NIT que empieza por, 5-15 dígitos) o `?nombre=` (contiene, 3-60). Cada consulta lleva un JWT **EdDSA** firmado por SynerLink con su llave **privada**; la API SAP solo tiene la pública (`SYNERLINK_JWT_PUBLIC_KEY`) y a SynerLink **solo** le deja buscar socios (`suppliers:search`), nunca leer documentos. El token es de un solo uso y por empresa, así que se consultan las 8 empresas en paralelo y se unen por NIT (sin dígito de verificación), con el tipo (Proveedor / Cliente / ambos) y las empresas donde existe. Máximo 20 por empresa (límite de la API SAP).

Variables **nuevas** en el `.env` de Kronos (las agrega Juan; reiniciar el servidor después):

| Variable | Qué es |
|---|---|
| `SAP_API_URL` | URL base de la API SAP, p. ej. `http://127.0.0.1:4100`. HTTPS obligatorio; `http://` solo para `localhost` / `127.0.0.1`. Sin usuario/clave, consulta ni fragmento. |
| `SAP_API_SYNERLINK_PRIVATE_KEY` | Llave **privada** Ed25519 de SynerLink (PEM en una línea con `\n`). Se genera en `api-sap` con `go run ./cmd/sap-keys -synerlink` (archivo `SYNERLINK_ENV.txt`). |
| `SAP_API_SYNERLINK_ISSUER` / `SAP_API_AUDIENCE` | Opcionales: emisor y audiencia del token (`synerlink` / `gss-sap-api`); deben coincidir con `SYNERLINK_JWT_ISSUER` / `JWT_AUDIENCE` de la API SAP. |

En la API SAP: `SYNERLINK_JWT_PUBLIC_KEY` (archivo `API_ENV.txt` del mismo comando) y, si usa `ALLOWED_IPS`, agregar la IP del servidor de Kronos.

Si falta alguna (o la URL no cumple), la pantalla muestra «Falta configurar la conexión con la API SAP (SAP_API_URL y SAP_API_SYNERLINK_PRIVATE_KEY)» solo en el selector y no se puede guardar un cliente tipo Proveedor; lo demás funciona igual. La llamada sale **solo del servidor** (`lib/api-permissions/portal-terceros.ts`): sin caché, sin seguir redirecciones, 10 s de tiempo máximo, la respuesta se valida campo a campo y la llave nunca llega al navegador ni a los registros. Un 401 de la API SAP en el registro del servidor = las llaves no son pareja o falta `SYNERLINK_JWT_PUBLIC_KEY`.

### Script SQL

`prisma/manual/2026-11-09-permisos-api-sujetos-PRUEBAS.sql` / `-PROD.sql` (idempotente; PRUEBAS solo corre en `KRONOSDB_PRUEBAS`/`kronos_ci`, PROD solo en `KRONOSDB`): agrega `subject_ref NVARCHAR(120) NULL` y `subject_label NVARCHAR(200) NULL` a `api_client` si faltan, crea `api_external_system` (nombre único) y siembra Power Automate, n8n, Orion, SAPSEND y Programador de tareas (solo los que falten). Los scripts principales ya traen lo mismo para instalaciones nuevas, y la reversa borra también `api_external_system`. Sin este script la pestaña avisa que falta («Falta aplicar en esta base el script de sujetos…»).

## Catálogo

La semilla (`2026-11-09-permisos-api-PRUEBAS.sql` / `-PROD.sql`) trae las 53 herramientas del MCP. Se puede volver a correr: solo inserta los códigos que falten (no pisa etiquetas ni el «activo» que se hayan editado). Las pruebas (`lib/api-permissions/rules.test.ts` y `mcp/test/db-keys.test.ts`) fallan si el MCP registra una herramienta que no está en la semilla o al revés.

| Grupo | Herramientas | ¿Se otorga desde la base? | Qué exige |
|---|---|---|---|
| Consultar / Crear / Gestionar solicitudes, Catálogos, Help desk, Otros | las 27 `kronos_*` originales | Sí | Empresas del cliente. `kronos_request_ia_access` exige código de agente. `kronos_delete_attachment` exige rol `admin` (las llaves de la base son `reader`): hoy solo por archivo. |
| Bitácora de Proceso | `kronos_list_bitacoras`, `kronos_get_bitacora`, `kronos_bitacora_actividad_reciente`, `kronos_list_bitacora_actividades` | Sí | Filtra por las empresas del cliente. |
| Proyectos | `proyectos_listar`, `proyecto_detalle`, `proyecto_cronograma`, `proyecto_calendario`, `proyecto_historial`, `proyecto_prs` y los 6 `proyecto_proponer_*` | Sí, **con código de agente** | El acceso lo da la persona (concesión de 24 h o el turno del chat) y el agente debe estar designado en el proyecto. Las propuestas no ejecutan nada: la persona confirma en SynerLink. |
| Correo | `correo_hilo_compartido`, `correo_adjunto_compartido`, `correo_proponer_respuesta`, `correo_crear_solicitud_desde_hilo`, `correo_agregar_nota` | Sí, **con código de agente** | Hilo compartido por la persona (24 h). Además el servidor debe tener `CORREO_AGENTE_HABILITADO=true`; si no, no se registran para nadie. |
| Teams | `teams_list_meetings`, `teams_list_transcripts`, `teams_get_transcript` | Sí | Lee la cuenta de Microsoft configurada en el servidor (Graph). **No se filtra por empresa**: otórguelo con cuidado. |
| Usuarios | `kronos_usuarios_consultar`, `kronos_usuarios_crear` | **No** (`active = 0`, se ven deshabilitados) | Exigen el bloque `usuarios` de la llave del archivo (solicitantes, empresas, departamentos, subprocesos, dominios y topes, `mcp/src/config.ts`), que `api_client` aún no guarda. Hoy solo por archivo. |

**Lo que ve cada proveedor en el portal.** Los permisos reales de un proveedor o cliente (qué usuarios tiene y qué módulos ve en cada empresa: órdenes de compra, facturas, pagos…) viven en la base de la landing (`SupplierLink` + `SupplierLinkResource`), no en Kronos ni en la API SAP. Kronos los lee, **solo lectura**, de la API de la landing: `GET {PORTAL_TERCEROS_URL}/api/integraciones/terceros/accesos?nits=…` con `Authorization: Bearer PORTAL_TERCEROS_KEY` (la misma llave que la landing guarda como `INTEGRACION_SYNERLINK_KEY`, mínimo 32 caracteres). Puente en Kronos: `app/api/administration/api-clients/subjects/portal-terceros/accesos` → `fetchPortalAccess` (`lib/api-permissions/portal-terceros.ts`). En la lista, la fila del proveedor dice «Portal: 9 módulos · 2 usuarios» (o «Sin acceso al portal» / «Portal sin conexión»); en el modal, «Lo que ve en el portal de proveedores» muestra empresa → usuario → módulos. La búsqueda del proveedor sigue saliendo de la API SAP.

**SynerLink administra el portal (2026-11-09).** El botón «Administrar portal» de esa sección abre `PortalAdminModal`: crear usuarios del proveedor (máximo 3 activos por NIT; el número de documento es su usuario de ingreso; contraseña temporal que se muestra una sola vez y debe cambiarse al entrar), activarlos o desactivarlos, cambiar nombre, correo y rol, restablecer la contraseña, vincular o quitar empresas (el socio se confirma en SAP) y marcar sus módulos. Cada cambio se guarda al momento. Puente: `app/api/administration/api-clients/subjects/portal-terceros/admin` (GET `?nit=`, POST `{ action, nit, … }` filtrado por `lib/api-permissions/portal-admin-rules.ts`) → landing `app/api/integraciones/terceros/portal` (`lib/portal/synerlink-admin.ts`), que reutiliza sus reglas y solo toca usuarios TERCERO del NIT pedido. La auditoría de la landing queda con `origen: SynerLink` y el correo del administrador (cabecera `X-SynerLink-Actor`). En la landing, el modal «Portal de proveedor» quedó **solo para ver** con usuarios TERCERO, y sus rutas de edición de vínculos responden 403 para ellos.

**Código de agente.** Proyectos, Correo y «Solicitar conectores de IA» actúan «en nombre de» un agente (`PERMISSIONS_REQUIRING_AGENT_CODE` en `lib/api-permissions/constants.ts`): sin código, el MCP tomaría el nombre del cliente como código. Por eso la pantalla y el servidor exigen el agente, y además el MCP descarta esas herramientas en una llave de la base sin código (`toolRequiresAgentCode` en `mcp/src/auth.ts`).

## «Lo que tiene hoy» (inventario real frente a lo autorizado)

En el modal, cuando hay un agente elegido, la sección plegable **Lo que tiene hoy** (solo lectura) carga `GET /api/administration/api-clients/agents/[code]/inventory` (mismo permiso que la pestaña, sin caché). Muestra el **último escaneo** del recolector (fecha, equipo, tipo, modelo, servicio, modo de ejecución, cantidad de reglas permitidas/negadas y de skills), las **empresas** del agente, el **perfil del puente** de Proyectos por empresa, el **gobierno** (director, plantilla de privilegios) y los **conectores**. Del destino de un conector solo se muestra esquema + host de un HTTP (nunca rutas, parámetros ni credenciales; nada para stdio) y no se lee `agent_inventory_runtime`.

Los conectores se agrupan en 3 clasificaciones (`lib/api-permissions/inventory-rules.ts`):

1. **Controlado por SynerLink**: `kronos-synerlink` y `synerlink-solicitud-*` (el MCP de Kronos). Lo que puede hacer lo deciden los permisos de esta pantalla.
2. **Servidor GSS, aún no controlado desde aquí**: `sapbo-*`, `sap-*`, `sapsend-*`, `sharepoint-*` (llegarán con la fase 2).
3. **Local en el equipo del agente, solo visible**: stdio y todo lo demás (outlook, lectorexcel-*, playwright, n8n-mcp, teams…).

Alertas (se recalculan con lo que se está editando, sin guardar): sin escaneo; escaneo con error o de más de 7 días; tiene el conector de SynerLink pero no tiene cliente guardado o el cliente no tiene permisos; tiene permisos marcados pero no el conector de SynerLink (no los usará); ejecuta comandos sin aprobación; conectores con escritura; empresas del agente (o de sus conectores GSS) fuera de las autorizadas, y empresas autorizadas donde el agente no está asignado. Con «Todas las empresas» no hay alertas de empresas.

## Cómo pasa un agente del archivo a la base

Hoy el MCP también lee las llaves del archivo/variable `MCP_API_KEYS` / `MCP_API_KEYS_FILE`, que **siguen funcionando**. Para migrar un agente:

1. Cree su cliente en la pantalla con las mismas empresas (`companyIds`, o «Todas» si tenía `"*"`), los mismos permisos (`allowedTools`) y el mismo `agentCode`.
2. Genere la llave y cámbiela en la configuración del agente.
3. Espere hasta 1 minuto (el MCP guarda la lista de la base 60 s) y pruebe el agente.
4. Quite su entrada del archivo y reinicie el MCP.

Diferencias de la llave de la base frente al archivo:

- Siempre es **lista blanca**: sin permisos marcados no ve ninguna herramienta.
- Rol **`reader`**: `kronos_delete_attachment` exige rol `admin`, así que hoy solo funciona con llaves del archivo.
- No soporta el bloque `usuarios` (herramientas `kronos_usuarios_*`, inactivas en el catálogo): esas siguen en el archivo. Proyectos, Correo, Teams y Bitácora sí se otorgan desde la base (ver «Catálogo»).
- Si la misma llave estuviera en ambos lados, **gana la de la base**.
- Si la base falla o faltan las tablas, el MCP **falla cerrado** para las llaves de la base (las del archivo siguen). `MCP_DB_KEYS=false` apaga la lectura de la base.
- El archivo todavía debe tener al menos una llave (validación de `mcp/src/config.ts`).

## Cómo una ruta REST nueva usa `requireApiPermission`

```ts
import { requireApiPermission } from '@/lib/api-permissions/authenticate';

export async function GET(request: Request) {
  const companyId = Number(new URL(request.url).searchParams.get('company'));
  const auth = await requireApiPermission(request, 'kronos_list_requests', { companyId });
  if (!auth.ok) return auth.response; // 401 sin llave válida, 403 sin permiso o fuera de la empresa
  // auth.client: { clientId, name, clientType, agentCode, allCompanies, companyIds, permissions }
  // Filtrar SIEMPRE por las empresas de auth.client, nunca por lo que mande el cliente.
}
```

- La llave va en `Authorization: Bearer sk_syn_…`.
- Falla cerrado: llave rara, revocada, cliente inactivo, permiso inactivo o error de base = sin acceso.
- `last_used_at` se escribe como máximo una vez por minuto por llave.
- `middleware.ts` no exige sesión en `/api/*` salvo `/api/requests-general`; si la ruta nueva cae bajo un prefijo con sesión obligatoria, hay que exceptuarla allí como `INTEGRATION_KEY_API_PATHS`.
- Si la ruta necesita un permiso nuevo, se agrega como fila en `api_permission` (con un script manual).

## Cada tipo de cliente en el modal (2026-11-10)

- **Agente de IA:** al elegir el agente se despliega «Lo que tiene hoy», sus empresas, permisos y llaves.
- **México:** cada persona es un cliente con su propia llave. Se agrega con la hoja «Agregar persona» (nombre y correo). El correo va en `subject_ref` en minúsculas y no se repite; el nombre del cliente es el de la persona.
- **Proveedor o cliente:** solo se elige el proveedor y se administra lo que ve en el portal («Administrar portal»). No se conecta por API: no se le piden empresas, permisos ni llaves (`clientTypeUsesApiAccess`).
- **Usuario SynerLink:** ya no se ofrece al crear (`API_CLIENT_SELECTABLE_TYPES`). Su sección solo aparece si quedan clientes de ese tipo.

### Vencimiento de llaves

- Al generar una llave se elige su vigencia: no vence, o 1, 2, 3 o 5 años (México sugiere 2). Se guarda en `api_client_key.expires_at`.
- Una llave vencida deja de funcionar en Kronos (`findActiveKeyByHash`) y en el MCP (`loadDbApiKeys`; el caché de 60 s revisa la fecha en cada petición). En el modal aparece «Vencida» y hay que generar otra.
- Script: `prisma/manual/2026-11-10-permisos-api-vencimiento-llaves-{PRUEBAS,PROD,reversa}.sql`. **Es obligatorio antes de desplegar**: las llaves se leen con columnas explícitas y, si falta `expires_at`, se niegan todas las llaves de la base (falla cerrado).

### Nivel de acceso: solo lectura o lectura y escritura (2026-11-11)

- Cada cliente de API (agente, México, proveedor o cliente, otro) tiene **«Permitir escritura»** en el bloque «Nivel de acceso» del modal (`api_client.access_mode`; `NULL` = solo lectura). Encenderlo pide confirmación; apagarlo quita al instante los permisos de escritura marcados.
- Cada permiso del catálogo dice si es **consulta** o **escritura** (`api_permission.access_kind`). Son de escritura las herramientas de `TOOL_CAPABILITIES.write` del MCP (crear solicitudes, notas, actividades, formulario, categorizar, adjuntos, conectores IA, propuestas de Correo y Proyectos) y «Crear usuarios». En el modal llevan la etiqueta «Escritura» y en solo lectura salen bloqueadas.
- **El servidor lo exige**: `validate.ts` rechaza guardar permisos de escritura en un cliente de solo lectura, y el MCP (`loadDbApiKeys`) no carga esos permisos aunque estén en la base (`p.access_kind = 'consulta' OR c.access_mode = 'escritura'`).
- En la lista, cada fila muestra «Solo lectura» o «Lectura y escritura».
- Script **obligatorio antes de desplegar** Kronos y el MCP: `prisma/manual/2026-11-11-permisos-api-nivel-acceso-{PRUEBAS,PROD,reversa}.sql`. Los clientes que ya tenían permisos de escritura quedan en «escritura» para no cortarlos; los demás, en solo lectura. También quita la columna `portal_mode` de una prueba descartada (solo pudo existir en PRUEBAS).
- Pendiente: el mismo nivel en la API SAP en Go (y en la landing para proveedores que carguen documentos).

### Catálogo «SAP» y copiar permisos (2026-11-11)

- **Plataforma «SAP»** en «Tienen permiso en», antes de SynerLink: un permiso de consulta por cada consulta de la API SAP (20: Compras 7, Ventas 7, Pagos y cupo 3, Logística 2, Socios de negocio 1; códigos `sap_*`, `system = 'sap'`). Script: `prisma/manual/2026-11-11-permisos-api-catalogo-sap-{PRUEBAS,PROD,reversa}.sql` (después del de nivel de acceso). **Pendiente**: la API SAP en Go todavía no lee estos permisos; el MCP los ignora (solo carga `system = 'synerlink'`).
- **Proveedores o clientes**: no llevan estos permisos en Kronos; lo que ven de SAP se maneja en su portal («Lo que ve en el portal» / «Administrar portal»), para no tener dos listas que se contradigan.
- **Copiar estos permisos a otros clientes** (botón debajo de la lista de permisos, en la pantalla del cliente): se eligen agentes, personas de México u otros y quedan con los mismos permisos guardados (reemplaza los suyos; no cambia empresas, llaves ni nivel). Cada destino conserva sus reglas (`permissionsForCopy` en `constants.ts`, la misma en pantalla y servidor): en solo lectura no recibe los de escritura y sin agente no recibe los que exigen agente. Ruta `POST /api/administration/api-clients/[id]/copy-permissions`, auditoría `copiar_permisos` por destino.
- **Permisos por empresa** (decisión de Juan: agentes, México y terceros no tienen los mismos permisos en cada empresa): debajo de cada permiso de SAP marcado aparece **«Empresas: Todas sus empresas»**; ahí se eligen solo algunas de las empresas del cliente. Sin elegir = todas (como antes). Tabla `api_client_permission_company` (sin filas = todas; se borra sola con el permiso), script `prisma/manual/2026-11-11-permisos-api-permiso-empresa-{PRUEBAS,PROD,reversa}.sql`. El servidor rechaza empresas que el cliente no tiene y limitar permisos que no son de SAP (el MCP de SynerLink filtra por las empresas del cliente, no por permiso). Al quitar una empresa del cliente, los permisos que solo valían ahí se desmarcan. Al copiar permisos se conservan las empresas que el destino también tiene; si no le queda ninguna, ese permiso no se copia. Los proveedores ya funcionan por empresa en su portal.
- **Quitar el agente**: en México u Otro el agente se quita con la ✕ y al cambiar de tipo; se desmarcan solos los permisos que exigen agente.

### Reglas que exige el servidor (revisión de Zoe, 2026-11-10)

- **Quién sirve como llave**: Kronos y el MCP filtran en SQL y en UTC: no revocada, no vencida (`expires_at > SYSUTCDATETIME()`), cliente activo y tipo distinto de `portal_terceros`. Aunque una llave quede mal creada en un proveedor, no autentica.
- **Proveedor o cliente**: no se le pueden generar llaves (409) y sus permisos de API no se guardan aunque lleguen en el cuerpo.
- **Tipos retirados** (`synerlink`): no se pueden crear ni elegir al editar (409). Los clientes viejos de ese tipo se pueden seguir editando.
- **Correo de México**: uno por cliente. Se revisa con bloqueo dentro de la transacción y, como última barrera, el índice único filtrado `UX_api_client_mexico_subject` (`prisma/manual/2026-11-10-permisos-api-correo-mexico-{PRUEBAS,PROD,reversa}.sql`). Responde 409 «Ya existe un cliente de México con ese correo».
- **Pendiente**: la API SAP en Go debe aplicar la misma regla de llaves.

### Quién administra la API SAP (2026-11-10)

- Permiso por procesos y subprocesos: proceso **«API SAP»** → subproceso **«Gestión de la API SAP»** (`/process/api-sap`, página real que abre el panel). Script: `prisma/manual/2026-11-10-permisos-api-gestion-api-sap-{PRUEBAS,PROD,reversa}.sql`.
- **Entra** quien lo tenga asignado en cualquier empresa (`lib/api-permissions/access.ts`). El rol por sí solo (admin, super_user) no da entrada.
- **Se asigna como cualquier subproceso** (igual que Firmas): Administración → Usuarios → Asignar subprocesos, por quien administra Usuarios.
- La pestaña «Permisos API» de Administración → Usuarios sigue apareciendo para quien tenga el permiso y además sea admin de Usuarios.
