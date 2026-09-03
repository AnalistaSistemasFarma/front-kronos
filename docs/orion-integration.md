# Integración SynerLink ↔ GSS Firma (Orion)

SynerLink consume la API de Orion para embeber el ciclo de firma **por archivo adjunto** dentro de una solicitud (`requests_general`).

Documentación Orion (contrato completo): `front-orion/docs/synerlink-integration.md`

## Variables de entorno (Kronos)

```env
# Misma clave que Orion
INTEGRATION_API_KEYS=gss-orion-synerlink-dev-2026-shared-key

# URL base de Orion (sin slash final)
ORION_API_BASE_URL=http://localhost:3000

# Origen permitido para postMessage del iframe
ORION_EMBED_ORIGIN=http://localhost:3000

# Mapeo SynerLink id_company → tenant Orion
ORION_TENANT_MAP={"7":"farmaceutica-abc"}

# Opcional: URL directa al perfil de firma embebido (por defecto vía API embed/signature-url)
ORION_SIGNATURE_PROFILE_URL=
```

En Orion debe existir:

```env
SYNERLINK_INTEGRATION_API_KEY=gss-orion-synerlink-dev-2026-shared-key
SYNERLINK_WEBHOOK_URL=http://localhost:8080/api/integrations/orion/document-status
SYNERLINK_ALLOWED_ORIGINS=http://localhost:8080
SYNERLINK_TENANT_MAP={"7":"farmaceutica-abc"}
```

## Campo de formulario

Tipo: **`orion_signature`** (`lib/orion/fieldType.ts`)

Estado en `request_form_value.value_text` (mapa por PDF de OneDrive):

```json
{
  "documents": {
    "<fileId>": {
      "orionDocumentId": "uuid",
      "externalRef": "synerlink://request/456/file/<fileId>",
      "fileId": "<fileId>",
      "fileName": "contrato.pdf",
      "status": "EN_PROCESO",
      "embedUrl": "https://orion.../embed/document?...",
      "signedFileUrl": null,
      "signers": []
    }
  },
  "updatedAt": "ISO-8601"
}
```

Compatibilidad: JSON plano legacy (1 doc / solicitud) se lee como `documents._legacy`.

`externalRef`:

- Legacy: `synerlink://request/{id}`
- Por archivo: `synerlink://request/{id}/file/{fileId}`

## Flujo en SynerLink

1. **Crear solicitud** FIRMA / con campo `orion_signature`: **al menos 1 PDF obligatorio**.
2. En **Archivos adjuntos**, cada PDF muestra estado + **Preparar / Gestionar / Firmar**.
3. **Gestionar** abre el modal de orquestación (firmantes, ubicaciones, enviar) **solo para ese PDF**.
4. Se puede subir otro PDF (con permiso de adjuntos) y repetir el ciclo por archivo.
5. Al **Enviar a firma**:
   - Orion recibe el documento.
   - Se crea **1 autorización Kronos por firmante** de ese PDF (`[orionFile:…][orionAuth]`), notificada a **Autorizaciones**.
   - Se crea **1 tarea de firma por firmante×documento** (Tareas asignadas).
6. Camino del firmante: **Autoriza → ve el documento → firma** (deep-link con `orionFileId` + `orionAction=sign`).
7. Orion → webhook `document-status` → Kronos actualiza ese `fileId`; la solicitud se cierra cuando **todos** los PDFs están `FIRMADO`.
8. **Versiones** (solo admin + solicitante): original + una entrada por cada firma parcial/final (`state.versions[]`).
9. **Descarga / vista del firmante siguiente**: usa el PDF con firmas acumuladas (`signedFileUrl` o última versión), no el adjunto original de OneDrive.

No hay tarjeta hub “Firma digital / Coordinador”: el host Orion es invisible y solo registra acciones para adjuntos + modales.

### Permisos

| Rol | Qué puede hacer |
|-----|-----------------|
| Responsable de tarea / admin | **Preparar / Gestionar** por PDF en adjuntos |
| Firmante (email en lista de ese PDF) | Primero **Autorizar** (módulo Autorizaciones); luego **Firmar** en el adjunto |
| Cualquier usuario | Dibujar/guardar firma personal (rúbrica) |

## Endpoints en Kronos

| Método | Ruta | Auth | Uso |
|--------|------|------|-----|
| POST | `/api/integrations/orion/ensure-document` | Sesión | Crear/vincular doc (`requestId`, **`fileId`**, `pdfBase64`) |
| GET | `/api/integrations/orion/ensure-document?requestId=&fileId=` | Sesión | Sync; responde `documents` + `state` |
| PATCH | `/api/integrations/orion/ensure-document` | Sesión | Patch por `fileId` |
| POST | `/api/integrations/orion/signers` | Sesión | Asignar firmantes (`fileId` obligatorio) |
| POST | `/api/integrations/orion/send` | Sesión | Enviar a firma (`fileId` obligatorio) |
| POST | `/api/integrations/orion/signature-fields` | Sesión | Guardar recuadros de firma en Orion |
| POST | `/api/integrations/orion/complete-sign` | Sesión | Cerrar turno del firmante (`fileId` opcional) |
| GET | `/api/integrations/orion/signed-file?requestId=&fileId=` | Sesión | Proxy PDF firmado Orion (Bearer server-side) |
| POST | `/api/integrations/orion/document-status` | Bearer API key | Webhook Orion |

## Archivos clave

| Archivo | Rol |
|---------|-----|
| `lib/orion/formValue.ts` | Bag `documents[fileId]` + migración legacy |
| `lib/orion/service.ts` | ensure / webhook / finalize por archivo |
| `lib/orion/signerTasks.ts` | Tareas por firmante **y** `fileId` |
| `components/orion/OrionSignaturePanel.tsx` | Host oculto + modales |
| `components/orion/OrionAttachmentSignActions.tsx` | Acciones por PDF en adjuntos |
| `app/api/integrations/orion/*` | Rutas API |

## Deep-link

`/process/request-general/view-activities?id={taskId}&from=authorization&orionAction=sign&orionFileId={fileId}`

- `id` = `task_request_general.id` (tarea de firma o autorización), **no** el id de la solicitud.
- Tras autorizar tipo **Firma — …** se resuelve la tarea de firma abierta del usuario; si no hay, se usa la de autorización.
- Si no hay `orionFileId`, se usa el primer PDF.

## Plantilla workflow FIRMA (proceso 84 — FARMADOSIS)

Seeds SQL en `prisma/seeds/`:

| Archivo | Contenido |
|---------|-----------|
| `firma-proceso-84-workflow.sql` | Fase A: tarea **Preparar documento y firmantes** + tipos `Firma — *` |
| `firma-proceso-84-workflow-phase-b.sql` | Fase B: pares autorización → aceptar turno por rol |

Aplicar: `node scripts/apply-firma-workflow.cjs` y `node scripts/apply-firma-workflow-phase-b.cjs`.

## Pendiente (roadmap Orion)

### P0 — requiere equipo Orion

| Item | Motivo |
|------|--------|
| Webhook `EN_PROCESO` por cada firma parcial | Hoy el cierre de turno depende de `complete-sign` o polling |
| `signUrl` para firmantes internos | Hoy se usa `embedUrl` genérico |
| Campo `order` en `signers[]` | Kronos usa índice del array como respaldo |
| POST | `/api/integrations/synerlink/documents/{id}/accept-sign` | Orion | Firmante interno acepta con rúbrica guardada (Kronos llama al confirmar) |
| Embed `/embed/sign` (solo firmar) | Separar editor vs firma (alternativa al flujo nativo SynerLink) |
| postMessage `DOCUMENT_SIGNER_COMPLETED` | Disparar `complete-sign` sin polling |
