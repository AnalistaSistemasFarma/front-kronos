# Contrato SynerLink ⇄ Orion (GSS Firma) — v3: revisión de borrador por el cliente

Cambios requeridos en **Orion** (repo `front-orion`) para que el **cliente externo** revise un
**borrador** antes de que el documento pase a firma. Diseño completo en Kronos:
`docs/orion-borrador-word-diseno.md`.

Todas las rutas viven bajo `/api/integrations/synerlink/*` y se autentican con
`Authorization: Bearer <ORION_INTEGRATION_API_KEY>`, igual que v2.

---

## 0. Resumen del caso

1. SynerLink tiene un contrato en Word ya validado por el equipo interno.
2. SynerLink lo convierte a PDF, le estampa **"BORRADOR – NO VÁLIDO PARA FIRMA"** y lo envía a Orion.
3. Orion crea una **URL pública con token** por cada aprobador del cliente (1 día de vigencia).
4. El cliente abre la URL, **solo ve** el documento y pulsa **Aceptar** o **Rechazar**
   (con descripción obligatoria).
5. Orion avisa a SynerLink por el webhook. SynerLink decide qué sigue (siguiente aprobador,
   cierre de ronda, etc.).

**Orion no orquesta el orden ni las rondas**: solo muestra, registra la decisión y avisa.
SynerLink pide las URLs en el momento correcto (paralelo: todas; secuencial: una a una).

---

## 1. Crear documento de revisión

`POST /documents` — mismo endpoint de hoy, con un campo nuevo:

| Campo | Tipo | Uso en Orion |
|---|---|---|
| `purpose` | `'SIGNATURE' \| 'DRAFT_REVIEW'` | Ausente = `SIGNATURE` (comportamiento actual). `DRAFT_REVIEW` = documento **no firmable**. |
| `versionLabel` | string | `v0.1`, `v0.2`… (borradores) |
| `previousOrionDocumentId` | string? | Borrador de la ronda anterior (queda SUPERSEDED, como en v2) |

`externalRef`: `synerlink://request/{id}/file/{fileId}/draft/{versionLabel}`.
`GET /documents/by-ref` debe resolver este formato.

Reglas para `purpose = DRAFT_REVIEW`:

- **No** acepta `/signers`, `/signature-fields`, `/send`, `/accept-sign` → `409`
  `{ "error": "Documento de revisión de borrador: no se puede firmar" }`.
- No aparece en "Mis firmas" ni en bandejas de firma.
- Sí aparece en "Documentos empresas" con etiqueta **Borrador** y en la hoja de vida.
- El PDF se guarda tal cual lo envía SynerLink (ya trae la marca de agua).

---

## 2. URL de revisión por aprobador

`POST /embed/review-url` (hermano de `/embed/sign-url`)

```json
{
  "docId": "uuid",
  "email": "cliente@empresa-cliente.com",
  "name": "Nombre Cliente",
  "cardCode": "C000123",
  "reviewOrder": 1,
  "expiresInHours": 24,
  "sendEmail": false,
  "forceRefresh": false
}
```

Respuesta `200`:

```json
{ "reviewUrl": "https://orion.../review/<token>", "expiresAt": "2026-10-01T15:00:00.000Z" }
```

- Idempotente por `(docId, email, reviewOrder)`: si hay una invitación vigente sin usar, la
  devuelve; con `forceRefresh: true` anula la anterior y crea una nueva (renovar).
- `sendEmail: true` = Orion también envía el correo (igual que `sign-url`). SynerLink por
  defecto envía su propio correo con el botón existente, así que normalmente irá en `false`.
- Si el documento no es `DRAFT_REVIEW` → `409`.

`POST /embed/review-url/revoke` — anula invitaciones pendientes cuando SynerLink cierra la ronda.

```json
{ "docId": "uuid", "emails": ["otro@empresa-cliente.com"], "reason": "Otro aprobador rechazó" }
```

---

## 3. Página pública `/review/{token}`

- Muestra el PDF en **solo lectura**, sin botón de descarga ni impresión (en lo posible).
- Encabezado: empresa, título, versión (`v0.x`), "Borrador para su revisión", fecha límite.
- Dos botones:
  - **Aceptar** → modal de confirmación ("¿Confirma que aprueba este borrador?").
  - **Rechazar** → modal con **descripción obligatoria** (mínimo 10 caracteres).
- Una decisión por token; después muestra "Su respuesta fue registrada" y no permite cambiarla.
- Token vencido: "Este enlace ya no está disponible. Solicite uno nuevo a quien se lo envió."
  (sin mostrar el documento).
- Token **anulado** (`revoke`): alerta destacada "Este borrador fue anulado: otro aprobador
  solicitó cambios. Recibirá un correo con la versión nueva." (sin mostrar el documento).
- Tras un rechazo, SynerLink crea un documento nuevo (`previousOrionDocumentId`) y pide URLs
  nuevas: cada aprobador recibe **otro correo** con la versión corregida.
- Registrar IP, user-agent y fecha de la decisión (hoja de vida / auditoría).
- Todo el texto en español.

---

## 4. Webhook a SynerLink

Mismo destino (`SYNERLINK_WEBHOOK_URL` → `/api/integrations/orion/document-status`), con
campos nuevos:

```json
{
  "purpose": "DRAFT_REVIEW",
  "event": "DRAFT_REVIEWER_DECIDED",
  "orionDocumentId": "uuid",
  "externalRef": "synerlink://request/456/file/01ABC/draft/v0.2",
  "synerlinkRequestId": 456,
  "versionLabel": "v0.2",
  "reviewer": {
    "email": "cliente@empresa-cliente.com",
    "name": "Nombre Cliente",
    "reviewOrder": 1,
    "decision": "ACEPTADO",
    "comment": null,
    "decidedAt": "2026-09-30T16:20:00.000Z"
  }
}
```

- `decision`: `ACEPTADO` | `RECHAZADO`. En `RECHAZADO`, `comment` trae la descripción.
- Un webhook **por cada decisión**. Reintentos con el mismo `(orionDocumentId, reviewer.email,
  reviewOrder, decidedAt)`; SynerLink los trata como idempotentes.
- Opcional: `event: "DRAFT_REVIEW_LINK_EXPIRED"` cuando vence un enlace sin decisión.

---

## 5. Hoja de vida (eventos)

Nuevos tipos para `POST /documents/{id}/events` (y para los que Orion genera):

`BORRADOR_ENVIADO_CLIENTE`, `BORRADOR_ENLACE_RENOVADO`, `BORRADOR_ACEPTADO`,
`BORRADOR_RECHAZADO`, `BORRADOR_ENLACE_ANULADO`, `BORRADOR_APROBADO_CLIENTE`.

SynerLink además hará *replay* de los eventos de la etapa Word (elaboración y validación
interna) al crear el documento, como ya hace con la validación en v2.

---

## 6. Resumen de lo que falta en Orion

1. `purpose: DRAFT_REVIEW` en `POST /documents` y bloqueo de toda operación de firma.
2. `externalRef` con `/draft/{versionLabel}` en `by-ref`.
3. `POST /embed/review-url` (+ `revoke`) con vigencia configurable (24 h).
4. Página pública `/review/{token}` (ver, Aceptar, Rechazar con descripción).
5. Webhook `DRAFT_REVIEWER_DECIDED` (y opcional `DRAFT_REVIEW_LINK_EXPIRED`).
6. Tipos de evento de borrador en la hoja de vida y etiqueta "Borrador" en "Documentos empresas".
