# Kronos MCP — Servidor MCP de front-kronos (SynerLink)

Servidor único [Model Context Protocol](https://modelcontextprotocol.io) que expone la información de la aplicación front-kronos (código interno "SynerLink") para que la consulten varios agentes de IA: solicitudes (workflows), tickets/casos de mesa de ayuda, procesos, subprocesos, actividades, categorías, departamentos, notas y usuarios.

> **El servidor YA NO es 100% de solo lectura.** De sus **13 tools**, **11 son de lectura** y **2 son de escritura**, ambas acotadas exclusivamente a **categorización** (`kronos_categorize_case` y `kronos_categorize_request`): por una **ruta de escritura separada**, transaccional, parametrizada y **auditada**. El candado de solo lectura del resto del servidor **sigue intacto** (ver §2.1 y §6).

Imita el patrón del MCP de SAP de la organización: transporte **Streamable HTTP** en la ruta `/mcp`, y tools tipo `query` / `get` / `metadata` (aquí con prefijo `kronos_`).

---

## 1. Arquitectura

```
Agente IA ──HTTP Bearer──▶ /mcp (Streamable HTTP)
                              │
                       ┌──────┴───────┐
                       │ auth (Bearer)│  valida API key (timing-safe)
                       └──────┬───────┘
                              │ resuelve alcance: { agent, role, companyIds }
                       ┌──────┴───────┐
                       │  tools (RO)  │  filtro de empresa OBLIGATORIO
                       └──────┬───────┘
                              │ Prisma (mismo schema del repo)
                       ┌──────┴───────┐
                       │  SQL Server  │  ← se reutiliza el usuario de la app Kronos
                       └──────────────┘
```

Decisiones clave:

- **Servidor único.** Autenticación por **API key por agente** (Bearer token en `Authorization`). No hay login de usuario humano.
- **Alcance por empresa.** Cada API key se mapea a un alcance de empresas (`companyIds`) y un rol. El alcance puede ser una **lista cerrada** de empresas o el **comodín `"*"`** (admin = TODAS las empresas y procesos).
  - Para keys con **lista**: **toda** consulta se filtra siempre por esas empresas. Un agente con alcance a la empresa A **nunca** ve datos de la empresa B, ni siquiera pasando `companyId: B` como parámetro de una tool — el filtro del servidor manda sobre cualquier parámetro del cliente (ver `src/scope.ts`).
  - Para keys **`"*"` (admin)**: NO se aplica filtro de empresa (ve todo). Si el cliente envía un `companyId`, se respeta como filtro **de conveniencia** (acotar lo que ya puede ver); no hay nada que ampliar.
- **Acceso propio.** El servidor se conecta a los datos con **su propio** acceso (el cliente Prisma del repo), nunca con la identidad del agente. **Por defecto se reutiliza el `DATABASE_URL` del usuario de la app Kronos** (`adminSAPSEND`, con permisos de escritura); la separación lectura/escritura se garantiza **por código** (ver §6).
- **Lectura y escritura por caminos separados (garantizado por código).**
  1. **Lectura (11 tools).** Las de catálogo/usuarios usan `prisma.model.findMany` (lectura por construcción). TODA consulta cruda de lectura pasa por `queryReadOnly` (`src/db.ts`) → **`assertReadOnlySql` (`src/readonly.ts`)**, que valida que la plantilla SQL empiece por `SELECT`/`WITH...SELECT` y **rechaza** `INSERT`/`UPDATE`/`DELETE`/`MERGE`/`DROP`/`ALTER`/`TRUNCATE`/`CREATE`/`GRANT`/`EXEC`, comentarios que oculten escrituras y sentencias encadenadas. Los valores viajan **parametrizados**.
  2. **Escritura (2 tools, categorización).** Por una **ruta separada y estrecha** (`executeWrite` en `src/write.ts`): una transacción parametrizada que **no toca ni debilita** `assertReadOnlySql`/`queryReadOnly`. Es el único punto que permite `$executeRaw`, y solo lo usan `kronos_categorize_case` y `kronos_categorize_request` (ver §6 y §2.2).

### Reutilización del esquema Prisma

El servidor **no duplica** el schema: importa el cliente generado en `../app/generated/prisma` (el mismo `prisma/schema.prisma` del repo). El modelo Prisma del repo es **parcial** frente a la base real (la tabla `requests_general` no está modelada, y columnas como `case.company` o `notes.created_by` existen en la DB pero no en el schema). Por eso las consultas con alcance de empresa usan `$queryRaw` con `Prisma.sql` **parametrizado** (mismo cliente, parametrización segura) — siempre a través de `queryReadOnly` —, y los catálogos bien modelados (procesos, categorías, departamentos, actividades, usuarios) usan la API de modelos de Prisma.

### Columna de empresa por entidad (verificado en el código del repo)

| Entidad | Tabla | Columna de empresa |
|---|---|---|
| Solicitudes | `requests_general` | `id_company` (FK a `company`) |
| Tickets/casos | `case` | `company` (entero, FK a `company.id_company`) |
| Usuarios | `user` ↔ `company_user` | vía relación `companyUsers.id_company` |
| Procesos, subprocesos, actividades, categorías, departamentos | catálogos | **sin** columna de empresa → globales |

Los catálogos son globales (compartidos por todas las empresas), así que se exponen sin filtro de empresa. Las entidades con datos de negocio (solicitudes, tickets, usuarios) **siempre** se filtran.

---

## 2. Tools disponibles (13: 11 lectura + 2 escritura)

### 2.1 Lectura (11)

| Tool | Descripción |
|---|---|
| `kronos_metadata` | Entidades/campos disponibles, el alcance (empresas) de la key actual y las capacidades del servidor (lectura/escritura). |
| `kronos_list_requests` | Lista solicitudes (workflows). Filtros: `companyId`, `status`, `limit`, `offset`. |
| `kronos_get_request` | Obtiene una solicitud por `id` (solo si está en el alcance). |
| `kronos_list_tickets` | Lista tickets/casos. Filtros: `companyId`, `status`, `priority`, `limit`, `offset`. |
| `kronos_get_ticket` | Obtiene un ticket por `id` con sus notas (solo si está en el alcance). |
| `kronos_list_processes` | Procesos y subprocesos (catálogo global), paginado. |
| `kronos_list_activities` | Actividades (catálogo global), paginado. |
| `kronos_list_departments` | Departamentos (catálogo global). |
| `kronos_list_categories` | Categorías y subcategorías (catálogo global). |
| `kronos_list_users` | Usuarios de las empresas del alcance. **Excluye** `password` y tokens. |
| `kronos_search` | Búsqueda paginada sobre solicitudes y/o tickets (`text`, `dateFrom`, `dateTo`, `status`, `companyId`). |

**Paginación:** todas usan `limit`/`offset` con tope máximo (`MCP_MAX_PAGE_SIZE`, default 200) y default (`MCP_DEFAULT_PAGE_SIZE`, default 50).

### 2.2 Escritura (2) — categorización

Las dos únicas tools que mutan datos. Acotadas a **categorizar**, transaccionales, parametrizadas, con validación de alcance/coherencia y **auditadas**. NO pasan por el candado de solo lectura: usan una ruta de escritura dedicada (`src/write.ts` → `executeWrite`), exclusiva de estas dos tools (ver §6).

| Tool | Parámetros | Qué hace |
|---|---|---|
| `kronos_categorize_case` | `id_case`, `id_category`, `id_subcategory`, `id_activity`, `companyId?` | Asigna/recategoriza la **terna** (categoría → subcategoría → actividad) de un caso de mesa de ayuda en la tabla puente `category_case` (1:1 con el caso). |
| `kronos_categorize_request` | `id_request`, `id_process_category`, `companyId?` | Asigna/recategoriza el **proceso** (`process_category`) de una solicitud general en la tabla puente `process_category_request_general` (1:1 con la solicitud), y sincroniza la columna legacy `requests_general.id_process_category`. |

**Validaciones (todas dentro de UNA transacción; si una falla, no se escribe nada):**

- **Alcance de empresa.** El caso (`case.company`) o la solicitud (`requests_general.id_company`) debe pertenecer a las empresas del alcance de la key. Si no, error genérico (`"... inexistente o fuera de alcance"`) que **no confirma** existencia fuera de alcance (regla de oro de `src/scope.ts`).
- **`kronos_categorize_case` — coherencia de la terna.** La actividad debe colgar de la subcategoría y esta de la categoría (`activity` → `subcategory` → `category`); si no, `"terna categoría/subcategoría/actividad inconsistente"`.
- **`kronos_categorize_request` — proceso válido.** El `process_category` debe estar **activo** (`active = 1`) y su `category_request` **habilitada para la empresa** de la solicitud (vía `company_category_request`); si no, `"proceso inexistente, inactivo o no habilitado para la empresa"`.

Ambas hacen **UPSERT** sobre su tabla puente (UPDATE; si afecta 0 filas, INSERT) y devuelven la acción (`updated`/`inserted`), las filas afectadas y los nombres resueltos de la nueva categorización.

**Sanitización:** `kronos_list_users` solo devuelve `id, name, email, isActive, role, phone, identification, createdAt`. Nunca `password`, `emailVerified`, cuentas/tokens ni sesiones.

---

## 3. Configuración de keys y alcance

Las API keys y su alcance se definen **fuera del código** (no se versionan), por variable de entorno JSON `MCP_API_KEYS` o por archivo apuntado con `MCP_API_KEYS_FILE`.

Formato JSON:

```json
[
  { "key": "<token-aleatorio-largo>", "agent": "horus-admin",   "companyIds": "*",    "role": "admin"  },
  { "key": "<otro-token>",            "agent": "bot-tesoreria", "companyIds": [3],    "role": "reader" }
]
```

`companyIds` admite dos formas:

- **`"*"`** (comodín, admin): la key ve **todas las empresas y procesos**; no se aplica filtro de empresa.
- **arreglo no vacío de enteros positivos** (p.ej. `[1, 2]`): lista cerrada de empresas; el filtro es obligatorio y no se puede ampliar.

Reglas validadas al arrancar (`src/config.ts`):

- Cada `key` debe tener al menos 16 caracteres. Genere tokens fuertes: `openssl rand -hex 32`.
- `companyIds` debe ser `"*"` **o** un arreglo **no vacío** de enteros positivos (se rechazan arreglos vacíos, `0`, negativos y decimales).
- `role` es informativo (`"admin"` o `"reader"`).
- No se permiten keys duplicadas.

La comparación de keys es **timing-safe** (`src/auth.ts`, SHA-256 + `timingSafeEqual`), y se recorren todas las keys sin cortocircuito para no filtrar por tiempo cuál existe.

---

## 4. Variables de entorno

| Variable | Default | Descripción |
|---|---|---|
| `MCP_PORT` | `3020` | Puerto HTTP (ruta `/mcp`). |
| `DATABASE_URL` | — | Conexión SQL Server. **Por defecto se reutiliza el usuario de la app Kronos** (`adminSAPSEND`); la separación lectura/escritura la garantiza el código (ver §6). Pendiente: usuario de mínimo privilegio para defensa en profundidad. |
| `MCP_API_KEYS` | — | JSON con las keys y su alcance (inline). |
| `MCP_API_KEYS_FILE` | — | Alternativa: ruta a un `.json` con el mismo formato. |
| `MCP_DEFAULT_PAGE_SIZE` | `50` | Tamaño de página por defecto. |
| `MCP_MAX_PAGE_SIZE` | `200` | Tope máximo de filas por consulta. |
| `MCP_AUDIT_LOG_FILE` | `kronos-mcp-audit.log` | Archivo de auditoría (una línea JSON por llamada). |

Copie `.env.example` a `.env` y complete los valores. `.env` está en `.gitignore`.

---

## 5. Cómo correr

### Requisito previo: generar el cliente Prisma

El cliente se genera a `../app/generated/prisma` desde el schema del repo:

```bash
cd mcp
npm install
npx prisma generate --schema ../prisma/schema.prisma
```

### Desarrollo

```bash
cd mcp
cp .env.example .env   # y edite las keys + DATABASE_URL
npm run dev            # tsx watch (recarga en caliente)
```

### Producción (build + PM2)

```bash
cd mcp
npm ci
npm run build
pm2 start ecosystem.config.js   # app "kronos-mcp" en el puerto 3020
```

`mcp/ecosystem.config.js` sigue el mismo patrón del `ecosystem.config.js` del front (reinicio diario por cron, etc.). Las variables sensibles deben venir del entorno o de un `.env` cargado por PM2.

### Probar manualmente

```bash
# Sin Authorization -> 401
curl -i -X POST http://localhost:3020/mcp -H 'Content-Type: application/json' -d '{}'

# Con key válida (initialize MCP)
curl -s -X POST http://localhost:3020/mcp \
  -H "Authorization: Bearer $MI_KEY" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"c","version":"1"}}}'
```

---

## 6. Lectura vs. escritura: dos caminos separados (garantizado por código)

**Por defecto, el MCP reutiliza el `DATABASE_URL` del usuario de la app Kronos** (`adminSAPSEND`), que tiene permisos de escritura. La separación entre lectura y escritura **no** depende de los permisos de la base: está **garantizada por código**.

### Camino de LECTURA (11 tools) — candado intacto

1. **Tools de lectura por construcción.** Las de catálogo/usuarios usan `prisma.model.findMany`.
2. **`assertReadOnlySql` (`src/readonly.ts`).** Toda consulta cruda de lectura se ejecuta a través de `queryReadOnly` (`src/db.ts`), que antes de tocar la base valida que la plantilla SQL empiece por `SELECT`/`WITH...SELECT` y **rechaza** cualquier `INSERT`/`UPDATE`/`DELETE`/`MERGE`/`DROP`/`ALTER`/`TRUNCATE`/`CREATE`/`GRANT`/`REVOKE`/`EXEC`/`EXECUTE`/`BACKUP`/`RESTORE` (también si vienen ocultas tras comentarios o como sentencias encadenadas). Los valores siguen viajando **parametrizados**.

> Las 2 tools de escritura **no debilitan** este candado: `assertReadOnlySql` y `queryReadOnly` **no se tocaron**. Una prueba (`test/write.test.ts`) confirma que `queryReadOnly` sigue rechazando `UPDATE`/`INSERT`.

### Camino de ESCRITURA (2 tools) — ruta dedicada y estrecha

Las tools de categorización **no** pasan por `queryReadOnly`. Usan `executeWrite` (`src/write.ts`), una función **separada** que:

- corre toda la unidad de trabajo (validaciones + escritura) dentro de **una transacción** (`prisma.$transaction`) sobre el **mismo** `PrismaClient` (no abre otra conexión ni cambia de usuario);
- ejecuta los `SELECT` de validación con `tx.$queryRaw` y los `UPDATE`/`INSERT` con `tx.$executeRaw`, **siempre parametrizados** con `Prisma.sql` (nunca concatenando valores);
- si una validación lanza, hace **rollback** automático y no persiste nada.

Es el **único** punto del servidor donde se permite `$executeRaw`, y solo lo invocan estas dos tools.

### Nota de seguridad (pendiente)

> Hoy el MCP usa el usuario `adminSAPSEND` (el mismo de la app), que tiene permisos de escritura amplios. La barrera real contra escrituras indebidas es la **lógica del MCP** (camino de escritura acotado a categorización + candado de lectura). **Pendiente:** crear un usuario de base de datos de **mínimo privilegio** (solo `SELECT` global + `UPDATE`/`INSERT` restringido a las tablas puente `category_case` y `process_category_request_general` y a la columna `requests_general.id_process_category`) y apuntar el MCP a ese usuario, como defensa en profundidad a nivel de base.

### Recomendación OPCIONAL (defensa en profundidad)

Para una capa adicional a nivel de base de datos, puede crear un usuario SQL de solo lectura y apuntar el MCP a ese usuario en vez del de la app:

```sql
-- En la base Kronos_db
CREATE LOGIN mcp_readonly WITH PASSWORD = '<fuerte>';
CREATE USER  mcp_readonly FOR LOGIN mcp_readonly;
ALTER ROLE   db_datareader ADD MEMBER mcp_readonly;   -- solo SELECT
-- NO otorgar db_datawriter, db_owner, ni EXECUTE sobre procedimientos de escritura.
```

```
DATABASE_URL="sqlserver://SERVIDOR:1433;database=Kronos_db;user=mcp_readonly;password=<fuerte>;encrypt=true;trustServerCertificate=true"
```

Esto es **opcional**: la garantía principal es el código. El usuario de solo lectura sería una tercera capa de defensa.

---

## 7. Auditoría

Cada llamada se registra (agente, rol, empresas del alcance, tool, parámetros, timestamp, resultado/filas) en el archivo `MCP_AUDIT_LOG_FILE`, una línea JSON por evento (`src/audit.ts`). Las API keys **nunca** se registran en claro; los parámetros con pinta de secreto se redactan.

> El modelo `UserAuditLog` del repo exige `user_id` (FK a `user`), por lo que no encaja para agentes de IA que no son usuarios humanos. Por eso la auditoría del MCP va a archivo.

---

## 8. Pruebas

```bash
cd mcp
npm test
```

Cubre (vitest, Prisma mockeado — no requiere DB real):

- **Auth:** petición sin `Authorization` → 401; key inválida → 401; header malformado → 401; key válida no da 401; una key `"*"` resuelve a alcance admin (`allCompanies=true`).
- **Alcance (lista):** `effectiveCompanyIds` nunca amplía el alcance; una key `[1]` que pide `companyId: 2` produce filtro `1 = 0` (ninguna fila) y nunca emite la empresa 2; el filtro de empresa va siempre en el SQL.
- **Alcance admin (`"*"`):** `effectiveCompanyFilter` no aplica filtro (ve todas las empresas); una key `"*"` ve registros de múltiples empresas; con un `companyId` del cliente acota por conveniencia sin fallar.
- **Candado de lectura:** la superficie expone exactamente 13 tools (las únicas de escritura son las 2 de categorización); todo el SQL crudo de lectura empieza por `SELECT`; `assertReadOnlySql` acepta `SELECT`/`WITH...SELECT` y rechaza `INSERT`/`UPDATE`/`DELETE`/`DROP`/`EXEC` y variantes con comentarios, espacios y mayúsculas/minúsculas; `queryReadOnly` sigue lanzando ante una mutación **pese a** las nuevas tools de escritura.
- **Escritura/categorización (`test/write.test.ts`):** camino feliz (UPDATE y UPSERT/INSERT) de `kronos_categorize_case` y `kronos_categorize_request`; rechazo de caso/solicitud fuera de alcance, terna incoherente y proceso inactivo/no habilitado; el filtro de empresa va en el SELECT de validación; la escritura NO pasa por la vía de lectura; admin `"*"` puede categorizar sin filtro de empresa.
- **Sanitización:** `kronos_list_users` nunca devuelve `password`/tokens.
- **Inyección:** un texto malicioso viaja como **valor parametrizado** (no como SQL crudo) y el filtro de empresa permanece intacto; `companyId` no numérico es rechazado por el esquema.
- **Config:** validación de keys (longitud, duplicados, `companyIds` lista/`"*"`, rechazo de arreglos vacíos y valores inválidos, presencia).
