# Flujos de trabajo — Mejora continua

Pedido de Nicolás Rivera (2026-11-09), punto 8 del video para PiSA México: «automejora de los procesos de
SynerLink». Decisión: va **dentro del editor de Flujos de trabajo** (`/process/request-general/view-workflows`),
no en una pestaña aparte, y quien administra el flujo aplica la mejora ahí mismo.

## Qué hace

1. **Diagnóstico exacto (sin IA)** de los últimos 6 meses del flujo: solicitudes, duración normal (mediana) y de
   las más lentas (p90), abiertas, devueltas y con re-trabajo (notas de devolución o corrección).
2. **Semáforo por tarea** junto a su nombre: verde (fluye bien), amarillo (se demora), rojo (cuello de botella:
   ≥ 35 % del tiempo del flujo, o ≥ 3 días y el doble de lo normal), gris (menos de 5 casos).
3. **Sugerencias con evidencia**, en lenguaje sencillo:
   - **paralelizar** dos tareas lentas seguidas (la segunda es «Secuencial») — «Aplicar» quita «Secuencial»;
   - **suplente** donde una sola persona represa la tarea;
   - **repartir la carga** cuando, con varias personas asignadas, una resuelve ≥ 80 %;
   - **autorización que siempre aprueba** (≥ 20 casos, 0 rechazos) pero hace esperar;
   - **documentos obligatorios** cuando ≥ 10 % de las solicitudes tienen notas de devolución por documentos;
   - **tarea automática con SAP** que falla ≥ 10 % (workflow_execution_log);
   - **tarea sin uso** en 6 meses.
4. **Una persona decide.** «Aplicar» abre la edición, prepara el cambio cuando se puede y resalta la tarea; se
   guarda con «Guardar cambios» como siempre. «Descartar» pide el motivo. Todo queda en `workflow_mejora_decision`
   con la cifra de la tarea en ese momento, y el panel muestra **antes y ahora** de lo aplicado.

## Cómo se mide el tiempo de una tarea

Desde que **quedó disponible** hasta que se resolvió: las tareas secuenciales, desde la resolución de la última
tarea anterior (por orden); las demás, desde que se creó la solicitud. `start_date` de `task_request_general` no
sirve: viene en otra zona horaria que `date_resolution` y a veces está vacío.

## Permisos y alcance

- Administradores de SynerLink o quien tenga el subproceso «Flujos de Trabajo» o «Administración de Flujos de Trabajo».
- Empresas habilitadas: `MEJORA_CONTINUA_EMPRESAS` (por defecto OLP: 3 y 10). En otras empresas el panel no aparece.
- Solo lectura de solicitudes, tareas, notas y registro de ejecución; caché de 30 minutos por flujo.

## Siguientes fases

- Historial de cambios del flujo para medir automáticamente el antes y el después.
- Sugerencias grandes que primero se discuten en una mesa de agentes.
- Un agente que redacte el resumen semanal de mejoras por empresa.

## Ajustes del 2026-11-09 (revisión de Nicolás Rivera en testing)

- **Criterio explícito del flujo** (`calificarFlujo`), igual en el indicador y en la página del flujo:
  - *Necesita mejoras*: una tarea es cuello de botella, o una solicitud tarda normalmente 10 días o más, o el flujo se volvió más lento que antes.
  - *Revisar*: una tarea se demora, o una solicitud tarda normalmente 3 días o más, o hay sugerencias sin revisar.
  - *Va bien*: nada de lo anterior, con al menos 5 solicitudes resueltas.
  - *Pocos datos*: menos de 5 resueltas y nada de lo anterior. Con menos de 5 resueltas se marca «pocos casos».
  Antes un flujo de 11,8 días con 1 caso salía «Fluye bien» porque ninguna tarea tenía casos suficientes para calificarse.
- **Página propia** `/process/request-general/mejora-continua?id=N` (el editor quedaba saturado): calificación con motivos,
  tendencia, sugerencias y cada tarea con su semáforo. El editor solo muestra el botón «Mejora continua» con el estado y las
  sugerencias por revisar. «Aplicar» registra la decisión y abre el editor con `?mejora=tipo:idTarea`.
- **El editor abre el flujo por su id**: antes leía el último flujo guardado en el navegador, así que desde un enlace daba
  «No se encontraron datos del flujo» o mostraba otro flujo (y por eso las sugerencias no cuadraban con el indicador).
