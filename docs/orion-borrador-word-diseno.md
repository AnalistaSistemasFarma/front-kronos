# Diseño — Preparación en Word antes de la firma (SynerLink / Kronos)

Estado: **propuesta para revisión** (2026-09-30). No hay código todavía.
Contrato con Orion: `docs/orion-contrato-v3-borrador.md`.

---

## 1. Qué problema resuelve

Antes de firmar un documento (por ejemplo un contrato), el equipo lo **elabora en Word**,
los **validadores internos** lo corrigen con comentarios/subrayados, y el **cliente** revisa
un borrador y lo acepta o lo rechaza con una descripción. Solo cuando el cliente acepta,
el Word se convierte en PDF y entra al flujo de firma que ya existe.

Hoy nada de esto pasa por SynerLink: se hace por correo y sin control de versiones.

## 2. Decisiones tomadas

| Tema | Decisión |
|---|---|
| Dónde vive | Dentro de la **solicitud general**, igual que la firma (acciones en la fila del adjunto). |
| Edición | **Word real**, fuera del navegador. Nadie abre el archivo en Word Online. |
| Tenants distintos | Las empresas no comparten tenant Microsoft. Por eso **solo Kronos toca OneDrive** (app única, `client_credentials`). Las personas **descargan y suben** el Word desde Kronos. |
| Bloqueo | Sí. En cada estado solo una persona (o nadie) puede subir versión. |
| Validación | **Dos**: validadores internos (sobre el Word) y cliente (sobre el borrador). La validación de la etapa PDF no se repite. |
| Cliente | **Solo ve** el documento (sin editar ni comentar) y tiene dos botones: **Aceptar** / **Rechazar**. Al rechazar escribe la descripción obligatoria. |
| Página del cliente | La hace **Orion** (URL pública con token), igual que `/sign/{token}`. |
| Envío al cliente | El elaborador usa el botón de correo que ya existe (**"Enviar URL al correo"**, `OrionFirmantesInviteModal` → `/api/integrations/orion/signer-invites`). |
| Aprobadores del cliente | Se buscan como los firmantes externos: socios de negocio SAP (`external-partners`). Pueden ser varios. |
| Orden de aprobadores | **Secuencial o paralelo**, se elige por documento (como los firmantes). |
| Vigencia del enlace | **1 día** (24 h), renovable con el mismo botón. |

## 3. Flujo

```
ETAPA 1 · PREPARACIÓN WORD                                  v0.1, v0.2, …
────────────────────────────────────────────────────────────────────────
 EN_ELABORACION ── preparadoras editan y suben versión (a la vez, sin bloqueo)
      │  "Enviar a validación"
      ▼
 EN_VALIDACION_INTERNA ── todos los validadores revisan a la vez en el tablero.
      │   Cada uno tiene su estado: Revisando · Aprobó · Pidió corrección.
      │   "Pedir corrección" NO detiene a los demás. La preparadora corrige y, al
      │   subir la subversión, marca qué pedidos quedaron "Corregido": esos vuelven
      │   a revisar y quien ya aprobó debe aprobar la nueva (se repite el flujo).
      ▼ (todos aprobaron la subversión vigente)
 VALIDADO_INTERNO
      │  "Enviar al cliente" (elige aprobadores SAP + secuencial/paralelo)
      ▼
 EN_REVISION_CLIENTE ── Orion muestra el borrador con marca "BORRADOR"
      │
      ├── cualquiera rechaza ──► RECHAZADO_CLIENTE ──► (elaborador corrige) ──► EN_ELABORACION
      ▼ (todos aceptan)
 APROBADO_CLIENTE
      │  "Convertir a PDF y preparar firma"
      ▼
 CONVERTIDO_PDF ── se crea el adjunto PDF v1.0 ──► flujo de firma actual
────────────────────────────────────────────────────────────────────────
ETAPA 2 · PREPARACIÓN PDF (ya existe)                        v1.0, v1.1, …
 preparar firma → firmantes → cajas → enviar a firmar
```

Cada vuelta después de un rechazo (interno o del cliente) sube la versión:
v0.1 → v0.2 → v0.3. El PDF final arranca en **v1.0** (`ORION_INITIAL_VERSION_LABEL`).

## 4. Quién puede subir versión (sin bloqueo)

Ya no existe "Tomar para editar" ni "Liberar": preparadoras y validadores trabajan **al mismo
tiempo** en el tablero, como el muro de San Valentín (tiempo real por SSE).

| Estado | Puede subir versión | Los demás |
|---|---|---|
| `EN_ELABORACION`, `DEVUELTO_INTERNO`, `RECHAZADO_CLIENTE` | Cualquier preparadora | Solo leer |
| `EN_VALIDACION_INTERNA` | Cualquier preparadora (la subversión nueva pide aprobar otra vez) | Validadores marcan y aprueban; no suben archivos |
| `APROBADO_CLIENTE` | Preparadora: solo la versión limpia para el PDF | Solo leer |
| `VALIDADO_INTERNO`, `EN_REVISION_CLIENTE`, `CONVERTIDO_PDF` | Nadie | Solo leer |

- Para no pisar el trabajo de otro, cada subida y cada aprobación dicen sobre qué subversión se
  hicieron (`baseVersion`). Si mientras tanto llegó otra, el servidor responde 409
  (`assertDraftBaseVersion`) y el tablero pide descargar la vigente.
- El tablero recuerda qué subversión descargó cada quien y avisa antes de subir si ya hay una
  más nueva.

## 5. Versiones

- **Cada subida es una versión nueva y congelada.** Kronos guarda cada versión como una
  copia aparte en OneDrive (subcarpeta `_versiones` del adjunto), no depende del historial
  nativo de OneDrive.
- Tipos de versión: `elaboracion` (subió el elaborador), `validacion` (copia comentada de un
  validador), `borrador_cliente` (la que vio el cliente), `pdf` (la convertida).
- La versión que ve el cliente es una **copia** de la última versión validada, nunca el
  archivo de trabajo.
- Historial visible con las mismas reglas de hoy (`canViewOrionDocumentVersions`).

## 6. Borrador para el cliente

1. Kronos convierte la última versión validada a PDF con Graph (`content?format=pdf`,
   ya usado en `app/api/document-management/.../pdf/route.ts`).
2. Estampa en **todas las páginas** una marca de agua diagonal
   **"BORRADOR – NO VÁLIDO PARA FIRMA"** con `pdf-lib`, y en el pie
   "Borrador v0.x — pendiente de aprobación del cliente".
3. Crea en Orion un documento de tipo **revisión de borrador** (no firmable; ver contrato).
4. Pide a Orion la URL de revisión de cada aprobador y el elaborador la envía con el botón
   de correo.
5. Así se evita que el PDF se confunda con un documento listo para firmar: nunca tiene
   cajas de firma, siempre lleva la marca y Orion no permite firmarlo.

### Varios aprobadores

- **Paralelo:** todos reciben el enlace a la vez.
- **Secuencial:** el siguiente recibe su enlace cuando el anterior acepta.
- **Regla:** basta **un rechazo** para cerrar la ronda. Los enlaces pendientes se anulan
  y el documento vuelve al elaborador con la descripción del rechazo.
- Se considera aprobado cuando **todos** aceptan.
- Enlace vencido (24 h): el aprobador sigue pendiente; el elaborador lo renueva con el botón.

## 7. Paso a PDF

1. **Revisión de limpieza:** Kronos abre el `.docx` (JSZip) y bloquea el paso si hay
   comentarios (`word/comments.xml` con contenido) o cambios sin aceptar (`w:ins`, `w:del`).
   Mensaje: "El documento tiene comentarios o cambios pendientes. Acéptelos o elimínelos en
   Word y suba la versión limpia."
   Excepción: si la versión que aceptó el cliente tenía comentarios, hay que subir la limpia
   y esa subida **no** reabre la validación, siempre que solo cambie la marcación
   (pendiente de confirmar con el equipo).
2. Conversión con Graph → se sube como **nuevo adjunto PDF** de la solicitud.
3. Se crea `documents[pdfFileId]` con `signatureIntent: 'sign'`, `versionLabel: 'v1.0'` y
   `review.status = 'APROBADO'`, copiando las aprobaciones internas y del cliente (la
   validación previa a firma ya se hizo en la etapa Word).
4. El Word queda en `CONVERTIDO_PDF`, enlazado al PDF (`pdfFileId`), y el PDF enlazado al
   Word (`sourceDraftFileId`).
5. De aquí en adelante todo es el flujo actual.

## 8. Modelo de datos (Kronos)

Se guarda en el **mismo campo** `orion_signature` de la solicitud, en una llave **nueva**
`drafts`, para no mezclarlo con `documents` (mucha lógica actual asume que `documents` son
PDFs).

```ts
// lib/orion/types.ts (nuevo)
export type OrionDraftStatus =
  | 'EN_ELABORACION'
  | 'EN_VALIDACION_INTERNA'
  | 'DEVUELTO_INTERNO'
  | 'VALIDADO_INTERNO'
  | 'EN_REVISION_CLIENTE'
  | 'RECHAZADO_CLIENTE'
  | 'APROBADO_CLIENTE'
  | 'CONVERTIDO_PDF';

export type OrionDraftVersion = {
  id: string;
  label: string;                 // v0.1, v0.2…
  kind: 'elaboracion' | 'validacion' | 'borrador_cliente' | 'pdf';
  oneDriveItemId: string;
  fileName: string;
  uploadedByEmail: string;
  uploadedByName?: string | null;
  createdAt: string;
  note?: string | null;
};

export type OrionDraftClientReviewer = {
  email: string;
  name?: string | null;
  cardCode?: string | null;
  order: number;
  decision: 'PENDIENTE' | 'ACEPTADO' | 'RECHAZADO' | 'ANULADO';
  decidedAt?: string | null;
  comment?: string | null;       // descripción del rechazo
  reviewUrl?: string | null;
  sentAt?: string | null;
  expiresAt?: string | null;
};

export type OrionDraftClientReview = {
  mode: 'sequential' | 'parallel';
  round: number;
  versionLabel: string;
  orionDocumentId?: string | null;   // documento Orion de revisión (no firmable)
  reviewers: OrionDraftClientReviewer[];
  submittedAt?: string | null;
  submittedBy?: string | null;
  closedAt?: string | null;
};

export type OrionDraftState = {
  fileId: string;                     // .docx de trabajo en OneDrive
  fileName: string;
  status: OrionDraftStatus;
  versionLabel: string;
  lock?: { userId: string; email: string; name?: string | null; lockedAt: string } | null;
  versions: OrionDraftVersion[];
  internalReview?: OrionReviewState | null;       // reutiliza el tipo actual
  clientReview?: OrionDraftClientReview | null;
  clientReviewHistory?: OrionDraftClientReview[]; // rondas anteriores
  pdfFileId?: string | null;
  createdByEmail: string;
  updatedAt: string;
};

// OrionSignatureBagBag: se agrega
//   drafts?: Record<string, OrionDraftState>;
// OrionSignatureState: se agrega
//   sourceDraftFileId?: string | null;
```

Tablas nuevas: **ninguna**. Se reutilizan `validators_process_category` (validadores
internos), `task_request_general` (tareas/autorizaciones), `request_form_value` (bag).

## 9. Qué se reutiliza

| Pieza | Dónde |
|---|---|
| Validadores en orden, aprobar/devolver, rondas | `lib/orion/review.ts`, `reviewState.ts` |
| Tareas y autorizaciones por persona | `signerAuthorizations.ts`, `signerTasks.ts` |
| Buscar socios SAP + usuarios Kronos | `app/api/integrations/orion/external-partners` |
| Botón y envío de correo con URL de Orion | `OrionFirmantesInviteModal.tsx`, `signer-invites/route.ts` |
| Vencimiento 24 h y renovación | `signerDeadline.ts`, `request-sign-extension` |
| Word → PDF | Graph `content?format=pdf` (`document-management/.../pdf/route.ts`) |
| Subida a OneDrive | `lib/onedrive/graphFolderUpload.ts` |
| Etiquetas de versión | `versionLabel.ts` |
| Hoja de vida | `documentEvents.ts` + `POST /documents/{id}/events` en Orion |
| Webhook | `app/api/integrations/orion/document-status` |

## 10. Endpoints nuevos (Kronos)

Todos con sesión, bajo `app/api/integrations/orion/draft/`:

| Método | Ruta | Uso |
|---|---|---|
| POST | `draft` | Marcar un `.docx` adjunto como documento en preparación (`requestId`, `fileId`) |
| GET | `draft?requestId=&fileId=` | Estado + versiones |
| POST | `draft/lock` · `draft/unlock` | Tomar / liberar para editar |
| GET | `draft/download?versionId=` | Descargar una versión (proxy Graph) |
| POST | `draft/upload` | Subir versión nueva (valida bloqueo y estado) |
| POST | `draft/submit-internal` | Enviar a validación interna (validadores + orden) |
| POST | `draft/decide-internal` | Validador aprueba / devuelve (con comentario) |
| POST | `draft/send-client` | Crear borrador en Orion + aprobadores + modo |
| POST | `draft/client-invites` | Obtener / renovar / enviar por correo la URL de un aprobador |
| POST | `draft/convert-pdf` | Revisión de limpieza + conversión + crear adjunto PDF v1.0 |

El webhook `document-status` distingue la revisión de borrador por `purpose: 'DRAFT_REVIEW'`.

## 11. UI

- **Fila del adjunto `.docx`** (`OrionDraftTableRow`): estado, etapa, una línea con lo que
  sigue y pocas acciones a la vista (sin menú): Preparar en Word (entra directo al tablero) ·
  Abrir / Revisar / Corregir en el tablero (solo quien puede verlo) · Descargar Word.
- **Tablero del documento** (`draftBoard/DraftBoard.tsx`): ahí se hace todo. Panel
  "Siguiente paso" (enviar a validación, enviar al cliente, convertir a PDF), corrección del
  Word (descargar con comentarios y subir), validadores con Aprobar / Devolver y aprobadores
  del cliente con sus enlaces.
- **Modal "Enviar al cliente"**: buscador de socios SAP (mismo de firmantes), orden
  arrastrable, selector Secuencial/Paralelo, y por aprobador: copiar URL · **Enviar URL al
  correo** · renovar.
- **Rechazo del cliente**: aviso destacado en la fila y nota en el historial con la
  descripción, quién y cuándo.
- Notificaciones (campana/push) al elaborador en cada decisión.

## 12. Permisos

Propuesta (pendiente de confirmar):

- **Elaborar documento**: se reutiliza el subproceso **Preparar firma** (`/process/firma/prepare`).
- **Validar**: los validadores configurados en el flujo (`validators_process_category`), igual que hoy.
- **Tablero**: solo preparadoras, validadores del documento y administradores (`canViewBoard`);
  los demás ven el estado en la fila y pueden descargar el Word.

## 13. Plan por fases

| Fase | Contenido | Estimado |
|---|---|---|
| 1 | Tipos, bag `drafts`, marcar `.docx`, tomar/liberar, subir/descargar, versiones | 1 – 1,5 semanas |
| 2 | Validación interna (reutilizando `review.ts`), tareas y notificaciones | 1 semana |
| 3 | Borrador con marca, contrato con Orion, modal de envío al cliente, webhook | 1 – 1,5 semanas (+ lo que tarde Orion) |
| 4 | Revisión de limpieza, conversión a PDF v1.0 y enlace con el flujo actual | 0,5 – 1 semana |
| 5 | Pruebas (vitest), ajustes de UI, documentación | 0,5 semana |

Total Kronos: **4 – 6 semanas** una persona. La fase 3 depende de que Orion entregue lo del
contrato v3; las fases 1, 2 y 4 no dependen de Orion.

## 14. Decisiones confirmadas (2026-09-30)

1. Elaborar = mismo permiso **Preparar firma** + estar en "Preparadores documento" del flujo.
2. Si el cliente rechaza, tras corregir y revalidar se le envía **otro correo con el documento
   nuevo** (nueva URL de revisión para la nueva versión).
3. El rechazo de **un** aprobador anula los enlaces de los demás pendientes.
4. Quien tenía el enlace anulado ve en la página de Orion una **alerta** de que ese borrador
   fue anulado (hay una versión nueva en camino).

## 15. Estado de implementación

- **Hecho en Kronos (fases 1 – 4):**
  - Bag `drafts`, iniciar preparación de un `.docx`, tomar/liberar, subir versión (copia
    congelada en `Request-{id}/_versiones-word/{fileId}`), descargar vigente o por versión,
    historial. Cada subida es una versión (v0.1, v0.2…).
  - Validación interna en orden con **tareas "Validar documento"** (las mismas del PDF:
    salen en Autorizaciones y abren la solicitud con el modal de validación).
  - Envío al cliente: PDF de vista previa con marca "BORRADOR – NO VÁLIDO PARA FIRMA",
    documento Orion `purpose: DRAFT_REVIEW`, aprobadores SAP en orden o a la vez, URL por
    aprobador (copiar / renovar / "Enviar URL al correo"). En orden, Kronos envía solo el
    correo al siguiente cuando el anterior acepta.
  - Webhook `DRAFT_REVIEWER_DECIDED`: aceptar / rechazar, anulación de enlaces pendientes,
    notas y notificaciones. Tras un rechazo se corrige, se revalida y "Reenviar al cliente"
    crea otra ronda (correo nuevo con el documento nuevo).
  - Paso a PDF v1.0: revisión de limpieza (comentarios / cambios sin aceptar), conversión
    con Graph, adjunto PDF nuevo con la validación ya aprobada. "Subir versión limpia"
    disponible en `APROBADO_CLIENTE` (queda registrada en versiones y notas).
  - Filas del Word en `view-request` y `view-activities`.
- **Tablero del documento** (`/process/request-general/draft-board?requestId=&fileId=`,
  prototipo aprobado el 2026-09-30):
  - Subversiones con control de cambios palabra por palabra (`lib/orion/draftDiff.ts`); el Word
    se lee con mammoth (`draftBlocks.ts`) y los párrafos se guardan por subversión.
  - Marcas (corrección con "Dice / Debe decir / Por qué", sugerencia, pregunta) con
    respuestas, en tiempo real por SSE leyendo `orion_draft_event` (pm2 corre en 2 procesos)
    y presencia / "está escribiendo…".
  - Validadores **al mismo tiempo**: ya no descargan ni suben; aprueban la subversión vigente
    cuando confirmaron todas sus marcas. Una subversión nueva pide aprobar otra vez.
  - Preparadora: "Descargar Word con comentarios" (las marcas como comentarios de Word,
    `docxComments.ts`) → "Subir subversión". Al subir, Kronos detecta solas las
    correcciones aplicadas en el párrafo equivalente y reubica las demás.
  - "Ver como PDF" por subversión (conversión de OneDrive).
  - Tablas nuevas (se crean solas al primer uso, como San Valentín): `orion_draft_mark`,
    `orion_draft_mark_reply`, `orion_draft_event`, `orion_draft_presence`, `orion_draft_blocks`.
  - Vista principal **"Hoja de Word"** (lienzo): la página real convertida por OneDrive
    (márgenes, tablas, logos, saltos de página), dibujada con pdf.js y con una capa de texto
    invisible para seleccionar; marcas y cambios se dibujan encima (`DraftBoardSheet.tsx`).
    La hoja de cada subversión se convierte una vez y queda en OneDrive (`orion_draft_pdf`).
    En la hoja lo quitado se ve como una marca roja con el texto al pasar el mouse; en
    "Texto con cambios" se ve tachado en línea.
- **Claridad (2026-10-01):**
  - Validadores: en Autorizaciones "Autorizar" abre directo el tablero; "Rechazar" devuelve el
    Word con el motivo. En el tablero: **Aprobar** o **Devolver con motivo**.
  - Preparadora: **Editar validadores** durante la validación (quien sigue conserva su
    aprobación, quien entra recibe tarea, quien sale la pierde) y **Reenviar a validación**
    tras una devolución o un rechazo del cliente.
  - Fila del Word: etapas (Elaboración → Validación → Cliente → Firma), una frase de "qué
    sigue" y un solo botón principal por persona; lo demás en "Más acciones".
  - PDF que sale del Word: marca "Viene del Word · validado y aprobado" y sin el selector
    "Para firmar / Solo ver" (queda para firmar).
- **Depende de Orion:** todo lo del contrato v3. Mientras no exista, "Enviar al cliente"
  responde con un mensaje claro (HTTP 501) y anula en Orion el documento recién creado.
