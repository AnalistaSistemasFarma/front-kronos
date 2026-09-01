# Integración SynerLink ↔ GSS Firma (Orion)

SynerLink consume la API de Orion para embeber el ciclo de firma dentro de una solicitud (`requests_general`).

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

Se agrega en el builder de workflows. El estado se guarda en `request_form_value.value_text` como JSON:

```json
{
  "orionDocumentId": "uuid",
  "externalRef": "synerlink://request/456",
  "status": "EN_PROCESO",
  "embedUrl": "https://orion.../embed/document?...",
  "signedFileUrl": null
}
```

## Flujo en SynerLink (6 pasos)

1. **Kronos** crea la solicitud (workflow con campo `orion_signature`).
2. **Responsable de tarea** abre la solicitud → pulsa **Editar documento y firmantes** → sube PDF en el panel → editor Orion (iframe).
3. **Kronos** abre modal a pantalla completa con el iframe de Orion (mismo motor que GSS Firma: ubicar firmas, firmantes, canvas).
4. **Operador** asigna firmantes y envía a firma (en el iframe o vía `POST /api/integrations/orion/signers` + `send`).
5. **Firmantes** firman en Orion (internos: sesión / iframe; externos: `signUrl`).
6. **Orion** → webhook `document-status` → Kronos cierra tarea y solicitud.

### Permisos en Kronos

| Rol | Qué puede hacer |
|-----|-----------------|
| Responsable de tarea / admin | Botón **Editar documento y firmantes**, subir PDF, panel Orion embebido |
| Firmante (email en lista) | Botón **Abrir panel de firma** con su `signUrl` |
| Cualquier usuario | **Configurar mi firma** → modal embebido en SynerLink (iframe Orion) |

## Flujo técnico (resumen)

1. Admin crea proceso con campo **Firma digital (Orion)** y tareas de firma.
2. Usuario crea la solicitud (el campo firma se configura al abrirla).
3. Al abrir `view-request`, aparece tarjeta **Firma digital** con estado y botones de acción.
4. El botón principal abre un **modal a pantalla completa** con el iframe Orion (`embedUrl`).
5. Orion notifica `POST /api/integrations/orion/document-status` al firmar/rechazar.
6. SynerLink actualiza el campo, bitácora y cierra tareas.

## Endpoints en Kronos

| Método | Ruta | Auth | Uso |
|--------|------|------|-----|
| POST | `/api/integrations/orion/ensure-document` | Sesión | Crear/vincular documento (+ `pdfBase64`) |
| GET | `/api/integrations/orion/ensure-document?requestId=` | Sesión | Sincronizar estado desde Orion |
| PATCH | `/api/integrations/orion/ensure-document` | Sesión | Actualizar estado (postMessage) |
| POST | `/api/integrations/orion/signers` | Sesión | Asignar firmantes vía API Orion |
| POST | `/api/integrations/orion/send` | Sesión | Enviar documento a firma |
| POST | `/api/integrations/orion/document-status` | Bearer API key | Webhook desde Orion |

## Archivos clave

| Archivo | Rol |
|---------|-----|
| `lib/orion/client.ts` | Cliente HTTP hacia Orion |
| `lib/orion/service.ts` | BD + webhook + ensure document |
| `components/orion/OrionSignaturePanel.tsx` | Tarjeta compacta + modal fullscreen (iframe Orion, postMessage) |
| `app/api/integrations/orion/*` | Rutas API |

## Configurar un proceso de firma

1. Categoría ej. **Firma digital** (empresa destino).
2. Proceso con campo **Firma digital (Orion)**.
3. Tareas: preparar → firmar → cerrar (según negocio).
4. `createdByEmail` del operador debe existir en Orion.
5. Mapear `id_company` en `ORION_TENANT_MAP`.

## Prueba rápida

1. Levantar Orion (`localhost:3000`) y Kronos (`localhost:8080`).
2. Crear solicitud con proceso que tenga `orion_signature`.
3. Abrir la solicitud → tarjeta **Firma digital** → **Editar documento y firmantes**.
4. Firmar en Orion → webhook debe cerrar tarea en SynerLink.
