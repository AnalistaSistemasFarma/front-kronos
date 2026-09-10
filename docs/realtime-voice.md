# Voz en SynerLink (testing)

El chat directo de Duo muestra «Hablar en tiempo real». Requiere HTTPS,
permiso de micrófono y una credencial de API OpenAI configurada en el servidor
como `OPENAI_API_KEY` (nunca `NEXT_PUBLIC_*`). No copiar claves a Git ni al chat.
El administrador debe cargarla mediante el mecanismo seguro de secretos del
entorno y recargar únicamente GSS-Front-TEST. Modelo opcional:
`OPENAI_REALTIME_MODEL`; por defecto `gpt-realtime`.

La API de OpenAI tiene facturación independiente de ChatGPT/Codex.
La llamada utiliza WebRTC con negociación SDP a través del servidor autenticado.
Incluye los últimos 12 mensajes autorizados, truncados a 1500 caracteres cada uno.
No enlaza las herramientas de OpenClaw/SAP ni escribe la transcripción al chat.
No debe presentarse como el runtime completo de Duo. La UI explica ese alcance.

Prueba manual: abrir el chat de Duo en testing, iniciar voz, conceder micrófono,
hablar, interrumpir una respuesta, silenciar, colgar y cambiar de conversación.
Verificar que desaparece el indicador de micrófono. El cliente cierra a los diez
minutos; no es una cuota de facturación del servidor. Hay un límite de una
negociación por usuario/minuto por proceso (no distribuido).

Sin credencial responde 503 sin contactar OpenAI. Las pruebas automáticas cubren
autorización, origen, falta de credencial, tamaño y sanitización de errores.

Contrato oficial: https://developers.openai.com/api/docs/guides/realtime-webrtc
