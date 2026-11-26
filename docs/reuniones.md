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

| `REUNIONES_FIXTURE_USUARIOS` | **Solo pruebas.** Correos (p. ej. `qa.sgc@gsslatam.com`) que ven un calendario FICTICIO generado en `lib/meetings/fixture.ts` (serie semanal «Seguimiento semanal SGC», reuniones sueltas, una privada, asistencia y transcripciones) en vez de Microsoft Graph. Sirve para probar de punta a punta con usuarios QA, que no tienen buzón real. **Nunca en producción.** |

Solo lectura: el módulo no crea, cambia ni borra nada en Microsoft 365.

## Reuniones por proyecto y análisis con el agente (2026-11-24)

Aprobado por Nicolás Rivera (SynerLink conv. 1, msg 38206). Propuesta: `traspasos/reuniones-proyectos-analisis-20261124/PROPUESTA.md`. Código: `lib/meetings/projects/`.

**Asignar a un proyecto (Fase 1, sin IA)**

- En «Mis reuniones», columna **Proyecto**: «Asignar», la sugerencia «¿Proyecto? Sí / Otro» o el proyecto ya asignado. Solo aparecen los proyectos donde la persona es dueña o editora.
- En el proyecto, sección **Reuniones** → «Asignar reunión» (escoge una de SUS reuniones de los últimos 30 días).
- El evento se vuelve a leer del buzón de la sesión (`POST /api/proyectos/[id]/vinculos/reuniones`). Las reuniones **privadas o confidenciales** no se pueden asignar. **Una reunión, un proyecto** (`ical_uid` único).
- **Toda la serie:** con «Aplicar a toda la serie» queda una regla (`chat_project_meeting_rule`, por buzón y `seriesMasterId`). Las ocurrencias que ya empezaron se asignan solas al abrir «Mis reuniones» o la sección del proyecto. La regla se quita desde la sección.
- **Sugerencia sin IA** (`lib/meetings/projects/rules.ts`): (1) otra ocurrencia de la serie ya está en un proyecto; (2) el asunto trae una palabra del nombre del proyecto que ningún otro proyecto comparte; (3) más de la mitad de los otros invitados son miembros del proyecto. Un empate no sugiere nada.
- **Qué ven los miembros:** asunto, fecha, duración programada y real, cuántos invitados y cuántos se conectaron, el resumen de quien la asignó y el análisis. Nunca la lista de asistentes ni la transcripción.

**Análisis a demanda (Fase 2)**

- Botón «Analizar» en la sección. Lo puede pedir quien **asistió** (la reunión está en su propio calendario), es dueño o editor y puede escribirle al asistente del proyecto. Máximo 10 análisis por proyecto y día.
- SynerLink **no llama a ningún modelo**. Abre una conversación del proyecto «Análisis de reunión · …» con el asistente del proyecto (el que lo creó, o el primero disponible) y deja un mensaje de **sistema** con su fila de entrega, como los turnos de las mesas. La bandeja del puente (`/api/chat/agent/inbox`, alcance `projects`) le entrega al asistente el aviso + las instrucciones (la «skill» `analisis-efectividad-reunion`, en `analysis-rules.ts`) + la transcripción, leída en vivo de Teams con el buzón de quien lo pidió. **En la base solo queda el aviso corto.**
- El asistente responde con un bloque ` ```analisis-reunion ` (JSON). Al publicarlo (`/api/chat/agent/messages`), SynerLink lo valida y lo guarda en `chat_project_meeting_analysis`, convierte los compromisos en **propuestas de tarea** (`tarea_crear`, el flujo de siempre: una persona las confirma en el Cronograma) y cambia el mensaje del hilo por un texto legible. Diez minutos después la conversación se archiva (borrado lógico), para que nadie siga preguntándole al asistente por la transcripción.
- Indicadores sin IA (participación por palabras de cada hablante, puntualidad, sobretiempo, asistencia, quiénes no intervinieron) en `metrics_json`. **La participación por persona y la transcripción solo las ven quienes asistieron.** El índice de efectividad es de la reunión: no hay ranking de personas.
- Si el asistente no responde en 75 minutos, el análisis queda «fallido» y se puede volver a pedir.

**Tablas:** `chat_project_meeting`, `chat_project_meeting_rule`, `chat_project_meeting_analysis` (migración `20261124150000_chat_project_meetings`; scripts manuales `prisma/manual/2026-11-24-proyectos-reuniones-*.sql`). Si el código sale antes que las tablas, la columna y la sección dicen «no disponible» y «Mis reuniones» sigue funcionando.

**Pendiente (Fase 3):** seguimiento de compromisos entre reuniones con el estado real de las tareas, vista agregada mensual, análisis automático con tope y la herramienta MCP `proyecto_reuniones`.
