# Contrato SynerLink ⇄ Orion (GSS Firma) — v2

Cambios requeridos en **Orion** (repo `front-orion`) para soportar "Cambios Orion Firmas".
SynerLink ya envía/consume todo lo descrito aquí; mientras Orion no exponga una ruta,
SynerLink degrada con elegancia (404 → deja de intentar, sin bloquear la firma).

Todas las rutas viven bajo `/api/integrations/synerlink/*` y se autentican con
`Authorization: Bearer <ORION_INTEGRATION_API_KEY>`.

---

## 1. Procedencia del documento (sin default GROUP SHARED SERVICES)

`POST /documents` — campos nuevos **de primer nivel** (además de `metadata`, que se mantiene
por compatibilidad):

| Campo | Tipo | Uso en Orion |
|---|---|---|
| `synerlinkCompanyId` | number | Empresa real del flujo SynerLink |
| `tenantId` | string? | Tenant Orion resuelto por `ORION_TENANT_MAP`; si falta, Orion debe resolverlo por `synerlinkCompanyId`/`companyName`, **nunca** caer en `gss` |
| `companyName` | string | Nombre de la empresa del flujo |
| `categoryName` | string | Categoría (p. ej. Jurídica) |
| `processName` | string | Proceso |
| `departmentName` | string | Departamento |
| `fileId` | string | Id del adjunto (OneDrive) |
| `fileName` | string | Nombre original del archivo |
| `versionLabel` | string | `1.0`, `1.1`, `1.2`… |
| `previousOrionDocumentId` | string? | Documento de la versión anterior (subversión) |

- `externalRef` es versionado: `synerlink://request/{id}/file/{fileId}` para la primera versión
  y `synerlink://request/{id}/file/{fileId}/v/{versionLabel}` para subversiones.
  `GET /documents/by-ref` debe resolver ambos formatos.
- Si llega `previousOrionDocumentId`, Orion debe marcar el anterior como **SUPERSEDED**
  (no firmable) y enlazar ambos en la hoja de vida.
- **Requerido**: eliminar el fallback que asigna `GROUP SHARED SERVICES` cuando no hay tenant.
  Si no se puede resolver la empresa, responder `422` con mensaje claro.

### "Documentos empresas" en Orion

Filtros por **empresa** (`companyName`/`synerlinkCompanyId`), **departamento** (`departmentName`)
y **nombre** (`title`/`fileName`, búsqueda parcial). Persistir los campos anteriores como
columnas indexadas (no solo en `metadata` JSON).

---

## 2. Hoja de vida (eventos)

`POST /documents/{orionDocumentId}/events`

```json
{
  "type": "VALIDACION_APROBADA",
  "label": "Validación aprobada",
  "versionLabel": "1.1",
  "actorEmail": "juridica@empresa.com",
  "actorName": "Nombre Validador",
  "detail": "Comentario opcional",
  "synerlinkRequestId": 1234,
  "fileId": "01ABC...",
  "occurredAt": "2026-09-28T15:04:05.000Z"
}
```

Tipos: `DOCUMENTO_CARGADO`, `NUEVA_SUBVERSION`, `ENVIADO_VALIDACION`, `VALIDACION_APROBADA`,
`VALIDACION_DEVUELTA`, `APROBADO_PARA_FIRMA`, `FIRMANTES_ASIGNADOS`, `ENVIADO_A_FIRMA`,
`FIRMA_REGISTRADA`, `DEVUELTO_POR_FIRMANTE`, `RECHAZADO`, `FIRMADO`, `ELIMINADO`.

`ELIMINADO`: un administrador (con el permiso “Eliminar adjuntos”) eliminó el documento en
SynerLink. Solo ocurre antes de la firma; si el flujo estaba activo, SynerLink ya lo rechazó en
Orion (`/reject`) y solo elimina cuando Orion lo confirma. La hoja de vida no se borra.

- Respuesta esperada: `201 { id }`. Debe ser **idempotente** por
  `(orionDocumentId, type, occurredAt, actorEmail)`: SynerLink reenvía (replay) los eventos
  registrados antes de que existiera el documento en Orion (p. ej. toda la validación jurídica)
  en el momento de crearlo.
- Orion debe mostrar la hoja de vida combinando sus propios eventos (firma, OTP, huella) con estos.

---

## 3. Perfil del firmante

`GET /user-profile?email=`

```json
{
  "email": "persona@empresa.com",
  "fullName": "Nombre Completo",
  "idDocumentType": "CC",
  "idNumber": "1020304050",
  "jobTitle": "Analista",
  "companyName": "Empresa S.A.S.",
  "companyNit": "900123456-7",
  "hasSignature": true,
  "hasFingerprint": true,
  "fingerprintUpdatedAt": "2026-09-01T10:00:00.000Z",
  "hasSigningLegalConsent": true,
  "hasBiometricConsent": true
}
```

- `404` JSON (`{ "error": "..." }`) si el usuario no existe. SynerLink usa entonces su tabla `[user]`.
- Con este perfil SynerLink precarga (y bloquea) nombre, cédula, cargo y empresa al firmar.

---

## 4. Huella guardada ("Mi huella")

- En Orion, módulo **Mi huella** dentro de "Mis firmas": el usuario sube/captura su huella
  una vez (con consentimiento biométrico `co-ley1581-art6-huella-v1`). SynerLink ya **no**
  guarda la huella en el navegador.
- `POST /documents/{id}/accept-sign` acepta el campo nuevo:

```json
{ "useStoredFingerprint": true }
```

  Cuando es `true` y no llega `fingerprintDataUrl`, Orion estampa la huella registrada del
  firmante. Si no tiene huella registrada: `422 { "error": "El firmante no tiene huella registrada en Orion" }`.

---

## 5. Alta masiva de usuarios

`POST /users/bulk` (lotes de hasta 200; idempotente por email)

```json
{
  "users": [
    {
      "email": "persona@empresa.com",
      "fullName": "Nombre Completo",
      "idDocumentType": "CC",
      "idNumber": "1020304050",
      "phone": "3001234567",
      "active": true,
      "synerlinkUserId": "clx...",
      "companies": [
        { "synerlinkCompanyId": 3, "name": "Empresa S.A.S.", "tenantId": "empresa" }
      ],
      "role": "FIRMANTE",
      "modules": ["SIGN", "MY_SIGNATURES"]
    }
  ]
}
```

Respuesta:

```json
{ "created": 10, "updated": 5, "skipped": 0, "errors": [{ "email": "x@y.com", "error": "..." }] }
```

- Rol **FIRMANTE**: solo puede firmar y ver sus firmas (incluye "Mi firma" y "Mi huella").
- No sobrescribir roles superiores ya asignados en Orion (admin, preparador).
- `active: false` desactiva el acceso en Orion, sin borrar el historial.
- SynerLink llama a esta ruta desde **Administración de usuarios → Sincronizar con Orion** y,
  de forma individual, al crear/editar un usuario.

---

## 6. Resumen de lo que falta en Orion

1. Persistir campos de procedencia de primer nivel y quitar el fallback a GSS.
2. `externalRef` versionado y estado SUPERSEDED por `previousOrionDocumentId`.
3. `POST /documents/{id}/events` idempotente + vista de hoja de vida.
4. `GET /user-profile`.
5. `useStoredFingerprint` en `accept-sign` + módulo "Mi huella".
6. `POST /users/bulk` con rol FIRMANTE y módulos.
7. Filtros empresa / departamento / nombre en "Documentos empresas".
