# Compartir en SynerLink (menú Compartir del celular)

Pedido de Nicolás (2026-10-22): «para que pueda compartir archivos a Orus desde
otras apps», como en Telegram. La PWA no aparecía en el menú Compartir ni en
Android ni en iOS.

## Android (implementado)

Funciona con la PWA **instalada desde Chrome o Edge** y abierta por **HTTPS**.

1. `app/manifest.ts` declara `share_target` (`lib/chat/compartir-share-target.ts`,
   `shareTargetManifest`): `POST multipart/form-data` a `/api/chat/compartir`
   con `title`, `text`, `url` y `files` (imágenes, video, audio, PDF, Office,
   texto, CSV, zip, HEIC).
2. `public/sw.js` (espejo en `worker/index.js`) intercepta ese POST **en el
   celular**, guarda los archivos en IndexedDB (`synerlink-compartir/lotes`) y
   abre `/process/chat/compartir?lote=<id>`. No sube nada todavía.
3. La pantalla «Compartir en SynerLink» exige sesión (middleware de
   `/process/*`), muestra la vista previa y el comentario, y lista los destinos:
   **agentes primero, con Orus arriba**, luego grupos, personas y proyectos
   (conversaciones donde es dueño o editor). Viene **preseleccionado el último
   destino usado** (o Orus): compartir a Orus es abrir y tocar «Enviar».
4. «Enviar» usa la ruta normal del chat
   (`POST /api/chat/conversations/<id>/messages`, multipart): al agente le llega
   un mensaje con adjuntos como cualquier otro, con los mismos permisos,
   validaciones (lista de negación, 25 MB, 5 por mensaje) y auditoría. Si con
   ese agente aún no hay hilo, se abre igual que desde el chat.
5. Después de enviar o cancelar se borra el lote del celular; los que nadie
   envía se barren a las 24 horas.

**Respaldo**: si el service worker todavía no controla la app (recién
instalada, datos del sitio borrados), el POST llega al servidor
(`app/api/chat/compartir/route.ts`). La ruta valida la sesión **antes** de leer
el cuerpo, valida tipos y tamaños con las reglas del chat y redirige a la
pantalla con el texto y el enlace. Los archivos no se guardan en el servidor:
se pide abrir SynerLink una vez y volver a compartir.

El service worker se registra solo cuando las notificaciones push están
activas (`NEXT_PUBLIC_VAPID_PUBLIC_KEY` presente y `NEXT_PUBLIC_PUSH_ENABLED`
distinto de `false`, ver `components/ServiceWorkerRegistrar.tsx`). En testing y
producción ya es así.

### Cómo probarlo

1. En Android, abrir SynerLink de testing en **Chrome** por HTTPS e iniciar
   sesión.
2. Menú ⋮ → «Instalar aplicación» (o «Agregar a la pantalla principal» →
   Instalar). Si ya estaba instalada, abrirla una vez para que tome el
   manifiesto nuevo: Android puede tardar un rato en refrescar el menú
   Compartir (desinstalar y volver a instalar lo fuerza).
3. En Galería, Archivos, WhatsApp, etc.: Compartir → **SynerLink**.
4. Debe abrir «Compartir en SynerLink» con la vista previa y Orus
   seleccionado. Tocar «Enviar a Orus» y comprobar que el mensaje con el
   adjunto aparece en el hilo y que el agente lo recibe.
5. Repetir con: 6 archivos (pide quitar uno), un `.apk` (rechazo), un video de
   más de 25 MB (rechazo), solo texto o un enlace desde Chrome, y otro destino
   (debe quedar preseleccionado la próxima vez).
6. Modo claro y oscuro, y anchos de 360 a 430 px.

## iOS (propuesta, NO implementada)

Safari no soporta `share_target` en PWA: SynerLink no puede aparecer en la hoja
de compartir de iOS solo con la web. Las opciones:

| Opción | Esfuerzo | Comentario |
|---|---|---|
| **(a) Atajo de iOS** («Compartir con Orus» / «Compartir en SynerLink») | Bajo | Aparece en la hoja de compartir. Sube el archivo con un token personal. **Recomendado como primer paso.** |
| (b) App nativa ligera (Capacitor + Share Extension) | Alto | Experiencia completa, pero exige cuenta de desarrollador, publicación y mantenimiento. |

### Diseño mínimo del token (pendiente de aprobación de Nicolás)

SynerLink **no tiene hoy** tokens personales de API para personas (solo el
enlace iCal del SGC, `sgc.ical_token`, que sirve de modelo). Cualquier
credencial nueva requiere la aprobación de Nicolás, así que **no se creó ni la
tabla ni la ruta**. Propuesta:

- Tabla `chat_share_token`: `id`, `id_user`, `token_sha256` (único; el token
  en claro **solo se muestra una vez**), `label` («iPhone de …»),
  `scope = 'chat:compartir'` (fijo), `created_at`, `expires_at` (sugerido: 180
  días), `revoked_at`, `last_used_at`, `use_count`. Máximo 3 activos por
  persona.
- **Perfil → «Compartir desde iPhone»**: generar, ver los activos (etiqueta,
  último uso) y revocar. Al desactivar el usuario o quitarle el Chat, el token
  deja de servir porque cada uso vuelve a pasar por los permisos del chat.
- `POST /api/chat/compartir/atajo` con `Authorization: Bearer <token>`,
  multipart: `files`, `body` opcional y destino `agent=<code>` (por defecto
  `orus`) o `conversation=<id>`. Resuelve el usuario a partir del hash del
  token y aplica la **misma** lógica de la ruta de mensajes (guardConversation
  o apertura del hilo directo, `collectChatAttachments`, subida a OneDrive,
  auditoría de IP y user-agent). El token **solo** sirve para esto: no abre
  sesión, no lee mensajes, no lista nada más.
- `GET /api/chat/compartir/atajo/destinos` (mismo token) para la variante
  «elegir conversación»: nombre e id, nada de contenido.
- Límite de uso (p. ej. 30 envíos cada 10 minutos por token) y registro de
  cada uso.

### Cómo se armaría el Atajo (cuando exista el token)

**«Compartir con Orus»** (directo, sin elegir conversación):

1. App Atajos → nuevo atajo → ⓘ → activar «Mostrar en la hoja de compartir»;
   tipos: Imágenes, Archivos, PDF, URL, Texto, Contenido multimedia.
2. Acción «Obtener contenido de URL»:
   - URL: `https://<synerlink>/api/chat/compartir/atajo?agent=orus`
   - Método: `POST`; Encabezado `Authorization`: `Bearer <token del perfil>`
   - Cuerpo: «Formulario»; campo `files` (Archivo) = «Entrada del atajo»;
     campo `body` (Texto) = «Preguntar cada vez» (opcional).
3. Acción «Mostrar notificación»: «Enviado a Orus».
4. Nombre: «Compartir con Orus». Icono de SynerLink.

**«Compartir en SynerLink»** (eligiendo destino): igual, pero antes del envío
«Obtener contenido de URL» a `/api/chat/compartir/atajo/destinos`, «Elegir de
la lista» por nombre y usar el id elegido en `conversation=<id>`.

Se distribuiría como enlace de iCloud del atajo ya armado; cada persona solo
pega su token la primera vez.
