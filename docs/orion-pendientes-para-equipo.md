# Pendientes Orion (GSS Firma) — Briefing para el equipo

Documento para compartir con **front-orion / GSS Firma**. Describe lo que **SynerLink (Kronos)** ya implementó y lo que **Orion debe entregar** para cerrar el flujo de firma por adjunto.

Contrato detallado (referencia): `front-orion/docs/synerlink-integration.md`  
Integración en Kronos: `docs/orion-integration.md`

---

## Contexto

SynerLink integra firma **por PDF adjunto** dentro de una solicitud (`requests_general`).

- **externalRef por archivo:** `synerlink://request/{requestId}/file/{fileId}`
- **Un documento Orion por PDF** (OneDrive file id).
- **Varios firmantes** por documento (secuencial o paralelo).
- El firmante **no usa** el embed de gestión de Orion: en SynerLink ve el PDF, dibuja/confirma su rúbrica y pulsa **Confirmar firma**. SynerLink llama a Orion por API.

Orion debe completar el backend para que las firmas queden **embebidas en el PDF** y el siguiente firmante vea/descargue el documento **con las firmas anteriores**.

---

## Configuración mutua

### SynerLink (Kronos)

```env
INTEGRATION_API_KEYS=gss-orion-synerlink-dev-2026-shared-key
ORION_API_BASE_URL=http://localhost:3000
ORION_EMBED_ORIGIN=http://localhost:3000
ORION_TENANT_MAP={"7":"farmaceutica-abc"}
```

### Orion

```env
SYNERLINK_INTEGRATION_API_KEY=gss-orion-synerlink-dev-2026-shared-key
SYNERLINK_WEBHOOK_URL=http://localhost:8080/api/integrations/orion/document-status
SYNERLINK_ALLOWED_ORIGINS=http://localhost:8080
SYNERLINK_TENANT_MAP={"7":"farmaceutica-abc"}
```

**Usuarios:** el email del firmante en SynerLink debe existir en Orion (misma cuenta para rúbrica y firma).

---

## Flujo esperado (secuencial, ejemplo 2 firmantes)

1. **Coordinador** (SynerLink): Gestionar → asignar firmantes → Enviar a firma → Orion pasa a `EN_PROCESO`.
2. **Firmante 1:** Autoriza en SynerLink → ve PDF → confirma → SynerLink llama **`accept-sign`** → Orion devuelve `signedFileUrl` (PDF con firma 1) + webhook.
3. **Firmante 2:** Ve/descarga **PDF con firma 1** → confirma → **`accept-sign`** → `signedFileUrl` (PDF con firmas 1 y 2) + webhook.
4. **Cierre:** `status: FIRMADO`, `signedFileUrl` final + webhook. SynerLink cierra la solicitud cuando todos los PDFs están firmados.

---

## P0 — Bloqueantes (sin esto el flujo queda incompleto)

### 1. `POST /api/integrations/synerlink/documents/{id}/accept-sign`

SynerLink **ya invoca** este endpoint al pulsar **Confirmar firma** (`lib/orion/client.ts` → `finalizeSignerTurn`).

**Request:**

```json
{
  "email": "juan.fonseca@gsslatam.com"
}
```

**Orion debe:**

1. Validar que el email es firmante del documento y que le corresponde el turno (si es secuencial).
2. Cargar la rúbrica guardada del usuario (`user-signature`).
3. Aplicar la firma en el campo/ubicación configurada en el PDF.
4. Generar y almacenar el PDF intermedio con la firma visible.
5. Actualizar el estado del firmante a `FIRMADO` y avanzar al siguiente en secuencia.
6. Responder con el mismo contrato que `GET /documents/{id}`:

```json
{
  "orionDocumentId": "uuid",
  "externalRef": "synerlink://request/2106/file/01A7LY3D...",
  "status": "EN_PROCESO",
  "signedFileUrl": "https://.../documento-con-firma-parcial.pdf",
  "signedAt": null,
  "signers": [
    {
      "email": "juan.fonseca@gsslatam.com",
      "name": "Juan Fonseca",
      "order": 1,
      "status": "FIRMADO",
      "signedAt": "2026-09-02T20:00:00.000Z"
    },
    {
      "email": "nicolas.rojas@gsslatam.com",
      "name": "Nicolas Rojas",
      "order": 2,
      "status": "PENDIENTE"
    }
  ],
  "auditSummary": "Juan Fonseca completó su firma."
}
```

**Estado actual:** el endpoint no existe (404). SynerLink tiene fallback local (marca firmado en BD) pero **no hay PDF firmado real**.

---

### 2. `signedFileUrl` en cada firma parcial (no solo al final)

Tras **cada** firmante, Orion debe exponer URL del PDF **con todas las firmas acumuladas hasta ese momento**.

SynerLink usa `signedFileUrl` para:

| Uso | Dónde |
|-----|--------|
| Descarga individual y “Descargar todos” | Archivos adjuntos |
| PDF que ve el siguiente firmante | Modal “Aceptar y firmar” |
| Historial de versiones | Botón **Versiones** (solo admin + solicitante) |

**Sin `signedFileUrl` parcial:** la descarga sigue siendo el PDF original de OneDrive, sin firmas visibles.

---

### 3. Webhook a SynerLink tras cada firma parcial

**URL:** `POST {SYNERLINK_WEBHOOK_URL}` → en dev:  
`http://localhost:8080/api/integrations/orion/document-status`

**Auth:** `Authorization: Bearer {SYNERLINK_INTEGRATION_API_KEY}`

**Debe invocarse cuando:**

- Un firmante completa su turno (`status: EN_PROCESO`, firma parcial).
- El documento queda totalmente firmado (`status: FIRMADO`).
- Se rechaza el documento (`status: RECHAZADO`).

**Body mínimo:**

```json
{
  "orionDocumentId": "uuid",
  "externalRef": "synerlink://request/2106/file/01A7LY3D...",
  "synerlinkRequestId": 2106,
  "status": "EN_PROCESO",
  "signedFileUrl": "https://.../parcial.pdf",
  "signedAt": null,
  "signers": [ ... ],
  "auditSummary": "Juan Fonseca firmó el documento."
}
```

SynerLink persiste esto en `request_form_value` (campo `orion_signature`, mapa `documents[fileId]`) y sincroniza tareas de firmante.

---

## P1 — Importante (mejora UX; no sustituye P0)

| Item | Detalle |
|------|---------|
| **`order` en `signers[]`** | Campo numérico explícito (1, 2, 3…). SynerLink usa índice del array como respaldo. |
| **`signUrl` por firmante** | URL dedicada solo para firmar (alternativa futura al flujo nativo SynerLink). |
| **Embed `/embed/sign`** | Vista solo firmante, sin panel “Firmantes / Guardar / Enviar a firma”. |
| **postMessage `DOCUMENT_SIGNER_COMPLETED`** | Origen `gss-firma`; payload con `orionDocumentId`, `status`, `signers`, `signedFileUrl`. |

---

## APIs que SynerLink ya consume (deben mantenerse estables)

| Método | Ruta Orion | Uso en SynerLink |
|--------|------------|------------------|
| POST | `/api/integrations/synerlink/documents` | Crear documento desde PDF base64 |
| GET | `/api/integrations/synerlink/documents/{id}` | Sync estado / refresh |
| GET | `/api/integrations/synerlink/documents/by-ref?externalRef=` | Resolver por externalRef |
| POST | `/api/integrations/synerlink/documents/{id}/signers` | Asignar firmantes + modo |
| POST | `/api/integrations/synerlink/documents/{id}/send` | Enviar a firma |
| GET | `/api/integrations/synerlink/user-signature?email=` | ¿Tiene rúbrica? |
| POST | `/api/integrations/synerlink/user-signature?email=` | Guardar rúbrica dibujada |
| POST | `/api/integrations/synerlink/documents/{id}/accept-sign` | **Pendiente — P0** |

---

## Estado persistido en SynerLink (referencia para Orion)

```json
{
  "documents": {
    "<fileId>": {
      "orionDocumentId": "uuid",
      "externalRef": "synerlink://request/456/file/<fileId>",
      "fileId": "<fileId>",
      "fileName": "contrato.pdf",
      "originalFileUrl": "https://...",
      "status": "EN_PROCESO",
      "signedFileUrl": "https://.../ultima-version-firmada.pdf",
      "signers": [ ... ],
      "versions": [
        { "id": "original", "kind": "original", "label": "Original", "url": "...", "createdAt": "..." },
        { "id": "sign-juan@...", "kind": "partial", "label": "Firmado por Juan Fonseca", "url": "...", "createdAt": "..." }
      ]
    }
  },
  "updatedAt": "ISO-8601"
}
```

Las entradas en `versions[]` se arman cuando Orion envía `signedFileUrl` en respuestas o webhooks.

---

## Resumen para el equipo Orion

> Implementar **`accept-sign`**, devolver **`signedFileUrl` después de cada firma parcial** (no solo al final) y disparar el **webhook `document-status`** con ese URL y `signers[]` actualizado. Con eso SynerLink cierra turnos, muestra versiones al admin/solicitante, y el siguiente firmante trabaja sobre el PDF ya firmado.

---

## Autenticación hacia Orion

Todas las llamadas server-side usan `lib/orion/client.ts`:

```http
Authorization: Bearer gss-orion-synerlink-dev-2026-shared-key
```

**Importante:** las URLs en `signedFileUrl` de Orion **no** deben abrirse directo en el navegador (`<a href>`). Exigen Bearer. SynerLink usa el proxy:

`GET /api/integrations/orion/signed-file?requestId={id}&fileId={fileId}`

El proxy valida sesión del usuario y descarga el PDF con la integration key.

---

## Checklist de aceptación (QA conjunto)

- [ ] Firmante 1 confirma en SynerLink → Orion responde 200 en `accept-sign` con `signedFileUrl` distinto del original.
- [ ] Webhook llega a SynerLink con `status: EN_PROCESO` y el mismo `signedFileUrl`.
- [ ] Firmante 2 al abrir el documento ve/descarga el PDF **con la firma del firmante 1** (vía proxy `/api/integrations/orion/signed-file`, no URL Orion directa).
- [ ] Tras firmante 2, `signedFileUrl` incluye ambas firmas; webhook con `EN_PROCESO` o `FIRMADO` según corresponda.
- [ ] Admin/solicitante ven **Versiones** con original + parciales + final.
- [ ] Descarga ZIP en adjuntos incluye PDF `-firmado.pdf` con firmas visibles.

---

*Última actualización: 2026-09-02 — SynerLink / proceso FIRMA (categoría 84)*