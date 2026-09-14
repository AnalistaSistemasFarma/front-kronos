# Voz mediante OpenClaw Talk — piloto testing

No requiere OPENAI_API_KEY en SynerLink. El navegador entrega una oferta SDP
al chat autenticado. Un proceso del host OpenClaw recoge las ofertas mediante
la API de agente existente de SynerLink, mantiene una conexión SDK persistente
al Gateway y llama talk.client.create con gateway-control-v1 y gpt-live-1-codex.
La oferta se negocia mediante el broker local de OpenClaw; sus credenciales y
tokens efímeros nunca salen al navegador ni al servidor SynerLink.

OpenClaw conserva transcripciones y ejecuta consultas al agente. El transporte
de audio es WebRTC directo navegador–OpenAI, no audio a través de la cola.

## Alcance y autoridad

Piloto únicamente para el usuario autenticado nicolas.rivera@gsslatam.com,
en un chat directo del agente duo, con comprobación de acceso vigente.
No habilitar a otros usuarios sin resolver su delegación de permisos al Gateway.
Las sesiones usan agent:duo:synerlink-testing-<id>, separadas de producción.
El historial de texto de producción no se importa automáticamente. El puente
de texto de testing deberá usar ese mismo namespace para compartir historial.

## Operación

Ejecutar scripts/openclaw-talk-bridge.mjs en el Mac de OpenClaw, con Node y
el SDK de OpenClaw 2026.9.3 instalado. Argumentos: ruta al entorno del conector
autorizado para TESTING y URL base de testing. El proceso lee SYNERLINK_AGENT_KEY
del entorno; no pasar llaves en argumentos. El SDK utiliza el dispositivo ya
emparejado localmente. El proceso debe mantenerse activo durante las llamadas.

No reutilizar una credencial de producción que testing rechace ni publicar el
Gateway en internet. Hace falta configurar el conector de testing mediante un
mecanismo seguro de credenciales si no existe uno autorizado.

La cola es efímera por proceso y requiere una instancia Next.js (configuración
actual de testing). Tras reiniciar, las llamadas se cierran y el usuario vuelve
a conectar. Una oferta se reclama una vez; si el puente cae, no se reejecuta.
Heartbeat del navegador: 15 s; caducidad de control: 45 s; máximo de llamada:
10 min; máximo 8 llamadas y una por usuario. El puente cierra sesiones si pierde
acceso al servidor. No constituye un límite de facturación de OpenAI.

## Verificación

Probado: creación y cierre de sesión Talk real con control Gateway, sin exponer
credenciales; negociación SDP HTTP 200 y conexión WebRTC desde Chrome headless.
Pendiente: voz audible y recorrido completo desde la interfaz de testing.
Prueba manual: HTTPS, micrófono, respuesta audible, interrupción, silencio,
colgar y salir del hilo. Verificar liberación del micrófono y consulta a Duo.

## Auditoría de transcripciones (testing)

El puente escucha `talk.event` en su conexión SDK propietaria. Solo registra
`transcript.done` (usuario) y `output.text.done` (asistente) con `final: true`
y `voiceSessionId` coincidente. No importa deltas, herramientas, razonamiento,
ni el historial completo. No graba el audio.

Al crear una llamada, la ruta autenticada guarda en `chat_voice_call` el
usuario, agente, conversación, IP del proxy y navegador. Las transcripciones
solo llevan callId y el evento del Gateway: no pueden elegir otro usuario,
conversación o IP. La ventana de emisión es de 11 minutos (tolerancia explícita de 2 minutos
entre relojes de Gateway y servidor); una transcripción
emitida dentro de esa ventana admite reintento posterior a colgar/reiniciar.

`POST /api/chat/agent/voice` con `action: transcript` guarda `chat_message` y
un recibo único en `chat_voice_event` en la misma transacción. La auditoría
existente y el historial del hilo leen esos mensajes. El texto hablado del
asistente usa role=agent. `delivered_at` ya viene marcado para que el puente de
texto NO vuelva a ejecutar una solicitud que OpenClaw ya atendió por voz.

El spool `~/.openclaw/synerlink-voice-audit-testing` del host OpenClaw conserva
pendientes en archivos privados (directorio 0700, archivos 0600), sin llaves,
para reintentar si SynerLink cae o el puente reinicia. Solo se borran tras
confirmación de la API. La clave de recibo es SHA-256(callId:eventId); dos
reintentos concurrentes no producen dos mensajes. No se fusionan frases
iguales que sean eventos diferentes: pueden ser repeticiones reales.

Aplicar la migración aditiva `20260910180000_chat_voice_audit` y generar Prisma
antes del build. Reiniciar únicamente el front/MCP de testing para liberar el
motor Prisma, y el puente Talk de testing para cargar el listener. No requiere
reiniciar el Gateway ni tocar producción. No recupera llamadas históricas ni
mide por sí solo tokens/costo de audio; tampoco corrige las desconexiones.

### Verificación ejecutada — 2026-09-10

- 20 pruebas Vitest y 3 pruebas Node: identidad, IP del navegador, fallo cerrado
  si no se crea la auditoría, permisos, finales, deduplicación, reintentos,
  recuperación de spool, orden cronológico y tolerancia entre relojes.
- Build Next.js de testing correcto; HTTP 200; puente Talk testing activo.
- Prueba real SDK + WebRTC con audio sintético marcado como prueba técnica:
  dos fragmentos finales del usuario y dos respuestas habladas, persistidos
  en `chat_message` 137–140, conversación técnica 14 (archivada al terminar).
  Cada fila tiene autor correcto, recibo de voz y `delivered_at`; bandeja del
  agente sin solicitudes pendientes. La prueba inicial dejó también la fila
  136 y comprobó la recuperación del evento después del fallo HTTP.
- Cuatro reintentos del mismo evento devolvieron el mismo mensaje 137. Un
  evento técnico nuevo enviado cuatro veces en paralelo produjo una sola
  fila (141); tres respuestas confirmaron `duplicate: true`. Llamada inexistente
  rechazada con 404. Los spools finalizaron vacíos.
- El smoke creó la identidad de llamada como fixture en una conversación
  técnica; la captura de identidad/origen de la ruta autenticada se cubrió en
  tests de ruta, no mediante una sesión humana autenticada en navegador.
  Pendiente únicamente comprobar una nueva llamada del operador en la UI.
- No se modificó producción, no se reinició Gateway y no se atribuye a este
  cambio la solución de las desconexiones de transporte.
