# Mis reuniones (Teams)

Módulo del proyecto «Mejoras Reuniones - Teams» (2026-11-23). Muestra a la persona que inició sesión en SynerLink sus propias reuniones de Teams y del calendario, para ver cómo evolucionan.

## Qué ve la persona

- **Ícono de video en la cabecera** («Reuniones recientes»): las últimas 8 reuniones de los últimos 7 días y el enlace «Ver todas mis reuniones».
- **/process/reuniones** («Mis reuniones»):
  - indicadores del periodo (7, 30 o 90 días, o 6 meses) comparados con el periodo anterior de la misma duración: reuniones, tiempo en reuniones, duración promedio y organizadas por la persona;
  - puntualidad, reuniones que se pasaron de tiempo y duración real, según el informe de asistencia de Teams;
  - horas por semana;
  - historial con búsqueda;
  - transcripción de cada reunión, con nombre de quien habla, búsqueda y botón «Copiar».

## Reglas

- El buzón **siempre sale de la sesión**: las rutas `app/api/meetings/**` no reciben correo ni enlace de reunión desde el navegador. La transcripción se pide por id de evento y el servidor vuelve a leer ese evento del buzón de la sesión: un id de otro calendario responde 404.
- **No cuentan como reunión:** eventos cancelados, de todo el día, marcados como «libre», rechazados, bloques personales sin invitados ni Teams, y bloques de más de 5 horas (salas abiertas todo el día).
- **Puntual:** la llamada arrancó a más tardar 5 minutos después de la hora programada.
- **Se pasó de tiempo:** duró 5 minutos o más de lo programado.
- Las reuniones periódicas se emparejan con su ocurrencia: informes de asistencia y transcripciones dentro de ±3 h del horario programado.
- La asistencia y las transcripciones se consultan solo en las 60 reuniones de Teams más recientes del periodo. Hay caché por persona: 5 minutos para la lista y 15 para el análisis.
- Si Teams no deja consultar una reunión (403 «User does not have access to lookup meeting»), queda sin datos y no se muestra como error.

## Configuración

| Variable | Uso |
|---|---|
| `REUNIONES_USUARIOS` | Correos habilitados, separados por coma, o `*` para todos. Si está vacía, el módulo queda apagado y el ícono no aparece. |
| `CORREO_INQUILINOS`, `CORREO_<K>_*` | Credenciales de Graph. Se reutiliza la app del módulo Correo, que ya tiene `Calendars.Read`, `OnlineMeetings.Read.All`, `OnlineMeetingTranscript.Read.All` y `OnlineMeetingArtifact.Read.All`. |

Para leer las reuniones en línea, las transcripciones y la asistencia de una persona, la política de acceso de aplicación de Teams (`Grant-CsApplicationAccessPolicy`) debe incluirla. Está confirmada para Nicolás Rivera. Si a otra persona no la cubre, el calendario sí se ve, pero la puntualidad y las transcripciones quedan «—» hasta que Tecnología se la asigne.

Solo lectura: el módulo no crea, cambia ni borra nada en Microsoft 365.
