# Proyectos — Mesas de discusión entre agentes

Pedido de Nicolás Rivera (2026-11-04, hilo «Reporte de estado de la IA en el Shared Services»):

> «La comunicación interagente la pensaba en el panel de proyectos, donde nosotros podamos decir que los
> agentes puedan discutir de un tema en específico. Todo el tiempo.» — «perfecto así es, pero que el
> operador vea lo que está pasando.»

Valores aprobados (propuesta del 2026-11-04 aceptada con «perfecto así es»):

| Regla | Valor por defecto | Rango |
|---|---|---|
| Ritmo | una ronda cada 30 min | 10–240 min |
| Horario | 07:00–19:00 COT, lunes a viernes | configurable; 24/7 opcional |
| Tope diario | 40 turnos por mesa | 1–200 |
| Quién crea | dueño y editores del proyecto | — |
| Moderador | lo elige quien crea la mesa | uno de los participantes |
| Síntesis | el moderador cada 3 rondas | 1–10 |
| Pausa automática | una ronda completa en la que nadie aporta nada nuevo | — |
| Turno sin respuesta | se salta a los 20 min y queda en el registro | — |

## Modelo

Una **mesa** es una conversación de proyecto (`chat_conversation`, `kind = 'project'`) cuyo agente
principal es el **moderador**, más una fila en `chat_project_mesa` con el tema y las reglas.

- `chat_project_mesa` — tema, estado (`activa` | `pausada` | `cerrada`), reglas, puntero de turno
  (`ronda`, `turno_idx`), `proximo_turno_at`, contadores del día y motivo de la última pausa.
- `chat_project_mesa_agente` — participantes, con su **rol** (texto corto) y su **orden**.
- `chat_project_mesa_evento` — registro **inmutable** (trigger) de todo lo que pasa: creada, turno
  entregado, turno respondido, turno vencido, síntesis, pausa (manual o automática), reanudada,
  cerrada, reglas cambiadas. Es lo que ve el operador en el panel y lo que lee la auditoría.

## Cómo corre un turno

1. **Aviso de turno.** El motor publica en el hilo un mensaje de sistema (`role = 'system'`,
   `event_type = 'mesa_turno'`) — «Ronda 3 · turno de @Mechita (crítico)» — con una fila en
   `chat_message_delivery` para ese agente. Es el **mismo mecanismo de las menciones**: el agente lo
   recoge por SU puente (llave `projects`), con SUS permisos y SUS conectores, y la fila de entrega
   le abre el contexto y la publicación en el hilo (ya existe desde el multiagente, PR #806).
2. **El agente responde** en el hilo. Al publicar, el motor registra la respuesta y entrega el turno
   siguiente de inmediato; al cerrar la ronda programa la siguiente en `ahora + ritmo` (respetando
   el horario).
3. **Motor perezoso, sin cron nuevo.** Las rondas programadas se disparan cuando cualquier puente
   consulta su bandeja (cada pocos segundos): una consulta barata por índice a las mesas activas con
   `proximo_turno_at <= ahora`, con bloqueo optimista (`UPDATE … WHERE turno_idx = @esperado`) para
   que dos puentes no dupliquen un turno.
4. **Sin aporte.** Si un agente no tiene nada nuevo, responde que no tiene aporte (marca
   `[SIN APORTE]`). Una ronda completa sin aportes pausa la mesa sola.
5. **Tope.** Al llegar al tope diario la mesa queda en espera y retoma con una ronda nueva al día siguiente, dentro del horario.

## Agentes de negocio en proyectos con código (2026-11-11)

Nicolás Rivera (2026-11-11, 15:22 COT): «la mesa de discusión no debe depender de proyectos de
desarrollo». Un agente que **no** es de desarrollo (`agent.es_desarrollo = 0`) **sí** se puede
agregar a un proyecto con política de código (`lectura`, `desarrollo` o `desarrollo_pases`) y a
sus mesas. Participa en conversaciones y mesas **sin acceso al código**.

- **La reja es el servidor, no la pantalla.** `politicaParaPuente(idProject, { esDesarrollo: false })`
  devuelve siempre `codeLevel: 'ninguno'`, `level: 0`, sin repos ni autorizadores de pases, con
  `source: 'bd'` (manda también sobre el archivo manual del puente). `GET /api/chat/agent/projects/policy`
  calcula `esDesarrollo` desde la llave del agente, en la consulta de un hilo y en la lista de todos
  sus proyectos. Si la columna `es_desarrollo` no existe todavía, nadie es de desarrollo (falla cerrado).
- **Ya no se bloquea** (antes: 400 «El acceso a código y los repositorios solo se asignan a agentes de
  desarrollo…»): ni al agregar asistentes (`POST /api/proyectos/[id]/agentes`), ni al crear una mesa
  (`crearMesa`), ni al crear un proyecto con agentes mixtos (`POST /api/proyectos`), ni al guardar la
  política con código (`PATCH /api/proyectos/[id]/permisos`). No se exige que **todos** sean de desarrollo.
- **Aviso informativo, no bloqueante**: «<Nombre> no es agente de desarrollo: participa sin acceso al
  código.» (`avisoSinCodigo` en `lib/proyectos/agentes-desarrollo-rules.ts`). Lo muestran «Agregar
  asistentes», «Nueva mesa de discusión», «Nuevo proyecto» y «Permisos de los agentes» cuando el
  proyecto tiene código; las respuestas de esas rutas traen `avisos: string[]`, y
  `GET …/agentes` y `GET …/mesas?candidatos=1` traen `conCodigo`.
- `codeAllowed` en `GET /api/proyectos/[id]/permisos` queda siempre en `true` (compatibilidad).

## Lo que el agente NO puede hacer en una mesa

- Nada con efecto: ni correos, ni cambios en SAP o en SynerLink, ni pases. El turno de mesa **nunca**
  corre en «modo Orus completo» (el aviso no tiene autor persona).
- No invoca a otros agentes: solo el motor reparte turnos (sin cadenas ni bucles).
- Si de la mesa sale algo concreto, queda como **propuesta** (`propuestas-cronograma.json`), que una
  persona confirma.

## Lenguaje para el operador (Nicolás Rivera, 2026-11-04)

> «Quiero que sea entendible para el operador, porque hablan muy técnico entre los dos y no se entiende
> lo que hacen los agentes.»

- **Dos textos por turno.** En el hilo se publica solo un aviso corto: «🗣️ Ronda 2 · turno 2 de 3 ·
  le toca a Mechita — su papel: criticar las propuestas». Las instrucciones para el modelo se las agrega
  la bandeja al entregar el turno y **no quedan en el hilo**.
- **Cada intervención empieza con «En pocas palabras:»**: una frase que entienda cualquier persona de
  la empresa (qué aporta y por qué importa). Después, máximo 8 líneas de detalle.
- **Prohibido el lenguaje técnico**: nada de tablas, campos, códigos, consultas, rutas, identificadores
  internos ni siglas sin explicar. Se habla de procesos, personas, tiempos y dinero; si una cifra
  aparece, se dice de dónde sale en palabras simples.
- **La síntesis del moderador** tiene un formato fijo: en qué estamos de acuerdo, qué sigue abierto y
  qué proponemos / qué necesitamos de ustedes.
- **El panel en vivo** muestra, por cada turno, solo la línea «En pocas palabras» (o la primera frase si
  el agente no la escribió), para seguir la mesa de un vistazo sin leer todo el hilo.

## Lo que ve el operador

- El hilo de la mesa: cada aviso de turno y cada respuesta, en orden.
- El panel de la mesa: estado, ronda, de quién es el turno, qué está haciendo ese agente en este
  momento (el indicador «trabajando» con su tablita de sub-agentes), cuándo es la próxima ronda,
  turnos de hoy / tope y el registro de eventos.
- Controles: pausar, reanudar, cerrar, «ronda ahora» y editar las reglas.
- Una persona puede escribir en la mesa cuando quiera: no despierta a nadie fuera de turno (salvo
  que mencione a un agente con @), y los agentes lo leen en su siguiente turno.

## Fases

1. Base de datos, reglas puras y motor con pruebas.
2. API (crear, listar, pausar, reanudar, cerrar, ronda ahora, reglas) y engranaje con bandeja y
   publicación.
3. Panel en Proyectos (pestaña **Mesas**) con vista en vivo.
4. Testing con una mesa de ejemplo, capturas y aviso 🧪 TESTING.
