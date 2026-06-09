# Kronos MCP — Servidor MCP de SOLO LECTURA (SynerLink / front-kronos)

Servidor único [Model Context Protocol](https://modelcontextprotocol.io) que expone, **solo en lectura**, la información de la aplicación front-kronos (código interno "SynerLink") para que la consulten varios agentes de IA: solicitudes (workflows), tickets/casos de mesa de ayuda, procesos, subprocesos, actividades, categorías, departamentos, notas y usuarios.

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
- **Acceso propio.** El servidor se conecta a los datos con **su propio** acceso (el cliente Prisma del repo), nunca con la identidad del agente. **Por defecto se reutiliza el `DATABASE_URL` del usuario de la app Kronos** (que tiene permisos de escritura), por lo que el solo-lectura se garantiza **por código** (ver §6).
- **Solo lectura garantizado por código.** Dos capas:
  1. **No se registra ninguna tool de escritura/mutación.** Las tools de modelo (`prisma.model.findMany`, etc.) son de lectura **por construcción**.
  2. **`assertReadOnlySql` (`src/readonly.ts`).** TODA consulta cruda pasa por `queryReadOnly` (`src/db.ts`), que valida que la plantilla SQL empiece por `SELECT` o `WITH...SELECT` y **rechaza** `INSERT`/`UPDATE`/`DELETE`/`MERGE`/`DROP`/`ALTER`/`TRUNCATE`/`CREATE`/`GRANT`/`EXEC`, comentarios que oculten escrituras y sentencias encadenadas. Los valores siguen viajando **parametrizados** (no se concatenan).

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

## 2. Tools disponibles (todas de solo lectura)

| Tool | Descripción |
|---|---|
| `kronos_metadata` | Entidades/campos disponibles y el alcance (empresas) de la key actual. |
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
| `DATABASE_URL` | — | Conexión SQL Server. **Por defecto se reutiliza el usuario de la app Kronos**; el solo-lectura lo garantiza el código (ver §6). Opcional: usuario de solo lectura para defensa en profundidad. |
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

## 6. Solo lectura: garantizado por código (y opcional usuario SQL de solo lectura)

**Por defecto, el MCP reutiliza el `DATABASE_URL` del usuario de la app Kronos**, que tiene permisos de escritura. El solo-lectura **no** depende de los permisos de la base: está **garantizado por código** con dos capas:

1. **Sin tools de escritura.** El servidor no registra ninguna tool de mutación. Las tools de catálogo/usuarios usan `prisma.model.findMany` (lectura por construcción).
2. **`assertReadOnlySql` (`src/readonly.ts`).** Toda consulta cruda se ejecuta a través de `queryReadOnly` (`src/db.ts`), que antes de tocar la base valida que la plantilla SQL empiece por `SELECT`/`WITH...SELECT` y **rechaza** cualquier `INSERT`/`UPDATE`/`DELETE`/`MERGE`/`DROP`/`ALTER`/`TRUNCATE`/`CREATE`/`GRANT`/`REVOKE`/`EXEC`/`EXECUTE`/`BACKUP`/`RESTORE` (también si vienen ocultas tras comentarios o como sentencias encadenadas). Los valores siguen viajando **parametrizados**.

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
- **Solo lectura:** la lista de tools no contiene verbos de mutación; todas empiezan por `kronos_`; todo el SQL crudo emitido empieza por `SELECT`; `assertReadOnlySql` acepta `SELECT`/`WITH...SELECT` y rechaza `INSERT`/`UPDATE`/`DELETE`/`DROP`/`EXEC` y variantes con comentarios, espacios y mayúsculas/minúsculas; `queryReadOnly` lanza ante una mutación.
- **Sanitización:** `kronos_list_users` nunca devuelve `password`/tokens.
- **Inyección:** un texto malicioso viaja como **valor parametrizado** (no como SQL crudo) y el filtro de empresa permanece intacto; `companyId` no numérico es rechazado por el esquema.
- **Config:** validación de keys (longitud, duplicados, `companyIds` lista/`"*"`, rechazo de arreglos vacíos y valores inválidos, presencia).
