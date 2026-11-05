# Proyectos — Matrices integradas y dashboards generados por agentes

Pedido de Comex (Angye Mancipe y Silvia Quintana) en la reunión con Nicolás Rivera del 2026-11-04,
analizado en el hilo «Reporte de estado de la IA en el Shared Services» (2026-11-05):

> «Ellos están realizando muchas matrices de Excel… desde el proyecto puedan subir matrices para que
> después puedan ser tomadas por los mismos agentes y hacer análisis… es como un Excel integrado.
> También generan muchos dashboards: el agente debería poder generar dashboards con todos los
> componentes gráficos e interactivos que tiene SynerLink… y que puedan anclarlo a la pestaña
> Dashboard del header.»

## Decisiones de Nicolás Rivera (2026-11-05)

| # | Decisión |
|---|---|
| D1 | **Los permisos son del proyecto.** No hay permisos por matriz ni por dashboard: lo ve quien es miembro del proyecto; suben y publican dueño y editores (`capabilitiesFor`). Los agentes designados en el proyecto leen todas sus matrices. |
| D2 | **Los dashboards toman datos de SAP y de SynerLink**, además de las matrices. |
| D3 | Los dashboards se ven en **una pestaña del proyecto («Dashboards»)**; **anclar es personal**: solo para quien lo ancla. |
| D4 | **Todos los usuarios tienen su dashboard personal** en la pestaña «Dashboard» del encabezado (hoy el panel es solo de administradores); ahí aparecen los que cada quien ancló. |
| D5 | (Recomendación sin objeción) Las matrices **no se editan celda a celda** en la fase 1: se sube una versión nueva del Excel y queda el historial. |

## Hallazgos (estado actual del código, 2026-11-05)

- Archivos de proyecto: OneDrive, 20 por proyecto, 25 MB, solo descarga (sin visor), permiso del proyecto.
- **Los agentes de Proyectos no pueden leer `.xlsx`**: la herramienta Read no abre ese formato y los agentes de
  negocio no tienen terminal. Solo leen bien CSV/texto.
- El chat ya convierte `.xlsx` en el servidor con exceljs (`lib/chat/visor-servidor.ts`, `lib/chat/xlsx-reparar.ts`).
- Dashboards: páginas fijas en código (`app/(hub)/dashboard/*`), solo administradores (`DashboardAdminGate`), sin
  persistencia. Gráficos reutilizables: `components/charts/ChartBox.tsx` + `lib/charts/*` (chart.js).
- Encabezado: el menú «Dashboard» es una lista fija en `components/Header.tsx`; no existe «anclar». Patrón a
  reutilizar: `chat_pin` (preferencia por usuario).
- Vistas personalizadas (`lib/custom-views`): SQL de solo lectura con usuario `kronos_views_ro`, catálogo de tablas
  permitidas, filtro por empresa, límite de tiempo. Solo tablas, sin gráficos.
- SAP: cliente de Service Layer en el servidor (`lib/sap/serviceLayer.ts`), endpoint por empresa (`sap_endpoints`),
  y patrón de «fuentes SAP curadas» (`lib/requests-general/sapSources.ts`).

## Diseño

### A. Matrices («Excel integrado»)

- Pestaña **Matrices** del proyecto. Subir `.xlsx`/`.csv` → el servidor lo lee con exceljs y guarda:
  `chat_project_matrix` (nombre, descripción) → `…_version` (archivo original en OneDrive, quién, cuándo, cambios) →
  `…_sheet` (hoja, columnas con tipo: texto/número/fecha/booleano, filas) → filas en bloques JSON.
  Fórmulas = valor calculado. Fila de encabezados elegible. Topes iniciales: 25 MB, 50 000 filas por hoja, 200 columnas.
- **Grilla** dentro de SynerLink: buscar, ordenar, filtrar, paginar; descarga del original; historial de versiones.
- **Agentes**: en cada turno el puente recibe cada hoja como **CSV** + una **ficha** (columnas, tipos, número de filas,
  mínimos/máximos/sumas). Así analizan sin abrir el `.xlsx`. Pueden crear matrices o versiones nuevas escribiendo
  CSV en `./trabajo/matrices/` (quedan marcadas «hecha por el agente»).
- Fase 3: herramienta de **consulta de matrices grandes** (filtrar/agrupar/sumar en el servidor) para el agente,
  sin llave en el modelo (mismo patrón de las propuestas del cronograma).

### B. Dashboards declarativos

- El agente **no programa** el dashboard: escribe una **especificación JSON** (esquema versionado) en
  `./trabajo/dashboards/<nombre>.json`; SynerLink la valida y la dibuja con sus componentes. Nunca HTML ni scripts
  (sin XSS ni código ajeno).
- Piezas: indicador (cifra + variación), barras, líneas, áreas, torta/dona, apiladas, tabla, filtros interactivos
  (rango de fechas, empresa, lista) que afectan a todo el tablero, y detalle al hacer clic.
- **Fuentes de datos** (D2), todas de **solo lectura** y ejecutadas en el servidor:
  1. **Matriz del proyecto** (hoja + columnas + agregación).
  2. **SynerLink**: consulta sobre el **catálogo de tablas permitidas** de Vistas personalizadas, con el usuario de
     solo lectura `kronos_views_ro`, filtro obligatorio por la empresa del proyecto, límite de tiempo y de filas.
     También vistas personalizadas ya publicadas.
  3. **SAP**: Service Layer, **solo GET**, de la **empresa del proyecto**, sobre una **lista curada** de entidades y
     vistas del semantic layer (`*B1SLQuery`) — nunca SQL contra la base de SAP. Agregación en SynerLink.
- **Rendimiento y cuidado de SAP**: cada fuente se guarda en caché (por defecto 15 min; botón «actualizar» con
  freno) y con topes de filas; un dashboard nunca dispara consultas por cada persona que lo abre. Sin consultas en
  bucle contra el Service Layer (lección de serfarma07).
- **Ciclo**: el agente lo deja en **borrador**; dueño o editor lo **publica** (D1). Quien lo abre es miembro del
  proyecto, así que ve lo mismo que el proyecto (D1).
- **Dónde se ve** (D3, D4):
  - pestaña **Dashboards** del proyecto (lista + vista);
  - **«Anclar»** (personal, tabla tipo `chat_pin`): aparece en **«Mi dashboard»** del encabezado de quien lo ancló;
  - **«Mi dashboard»** para **todos los usuarios** en el menú «Dashboard» del encabezado (los anclados, en pestañas);
    los tableros de administración siguen solo para administradores. Si alguien deja de ser miembro del proyecto,
    su ancla deja de mostrarse.

## Fases

| Fase | Entrega |
|---|---|
| 1. Matrices | Subir, grilla, versiones, CSV + ficha para los agentes (front-kronos + puente-hilos). |
| 2. Dashboards | Esquema declarativo, render con ChartBox, fuentes Matriz/SynerLink/SAP con caché, pestaña del proyecto, «Mi dashboard» para todos y anclar. |
| 3. Ampliación | Consulta de matrices grandes para agentes, filtros cruzados, más piezas. |
