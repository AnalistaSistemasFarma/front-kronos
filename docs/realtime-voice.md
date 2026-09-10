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
credenciales. Pendiente: negociación SDP completa y voz audible desde testing.
Prueba manual: HTTPS, micrófono, respuesta audible, interrupción, silencio,
colgar y salir del hilo. Verificar liberación del micrófono y consulta a Duo.
