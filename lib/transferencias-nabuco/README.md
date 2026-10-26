# Transferencias Nabuco

Módulo que envía documentos de SAP (Service Layer) a Nabuco WMS como solicitudes de
alistamiento. Reemplaza la automatización de SAPSEND (`transferDeliveryNotesNabuco.js`)
y todo se parametriza desde la app (Procesos → Logística → Transferencias Nabuco).

## Piezas
- SQL: `prisma/manual/2026-10-25-transferencias-nabuco-{PRUEBAS,PROD,reversa}.sql`
  (tablas `nabuco_config`, `nabuco_envio`; subprocesos `/process/transferencias-nabuco` y
  `/process/transferencias-nabuco/admin` bajo el proceso «Logística»; job `nabuco_vigilar`).
- Programador central: `nabuco_transferir` (payload `{ id_config }`, una tarea por config,
  la crea/edita la pantalla) y `nabuco_vigilar` (cada 15 min).
- Lock por config: `nabuco_config.en_ejecucion_desde` (UPDATE condicional, caduca a los 30 min).
- Idempotencia: índice único `(id_company, entidad, doc_entry)` + el UPDATE nunca pisa un `enviado`.
- Variable nueva: `NABUCO_CONFIG_KEY` (ver `.env.example`).
- Token de Nabuco en caché (`tokenCache.ts`, memoria del proceso): el instructivo de Nabuco pide
  no llamar `/AuthBI` en cada envío. Clave = id_config + URL + usuario + hash de la contraseña
  cifrada (si cambian, la entrada vieja se descarta). Vigencia = `exp` del JWT − 60 s o 50 min si
  no hay `exp`. Ante un 401 se invalida, se pide token nuevo UNA vez y se reintenta UNA vez.
  La usan el motor automático y las pruebas manuales; «Probar conexión» SIEMPRE pide token nuevo
  y actualiza la caché (salvo si prueba datos de pantalla distintos de lo guardado). Con varias instancias del proceso cada una tiene su caché.

## Pruebas manuales (2026-10-26)
Pestaña «Pruebas manuales» (solo administradores del módulo), por configuración:
- «Probar conexión» (token nuevo; muestra el diagnóstico técnico, ver abajo).
- «Armar solicitud» desde un DocEntry (usa la vista previa) o «Cargar ejemplo» (campos del mapeo
  con valores de muestra) → editor JSON editable → «Enviar a Nabuco» (confirmación en modal).
  Se envía TAL CUAL a `{url}{ruta_solicitudes}`, ignorando el modo simulación; muestra HTTP, ms y
  la respuesta.
- Si la URL contiene `nabucoapi.azurewebsites.net` (producción de Nabuco) el modal advierte en
  rojo y exige escribir PRODUCCION; el servidor rechaza (409) sin `confirmoProduccion: true`.
- Historial (últimas 20) en `nabuco_prueba_manual` (script
  `prisma/manual/2026-10-26-nabuco-pruebas-manuales-{PRUEBAS,PROD,reversa}.sql`); «Probar
  conexión» también deja registro tipo `conexion`. Nunca se guarda token ni contraseña; la
  respuesta se recorta a 100 000 caracteres. NO toca `nabuco_envio` (no afecta la idempotencia).
  Si la tabla aún no existe, la prueba se hace igual y solo se avisa en el log del servidor.
- Endpoints: `POST configs/[id]/probar`, `GET|POST configs/[id]/pruebas`,
  `GET configs/[id]/pruebas/[idPrueba]` (todos con permiso de Administración en la empresa).

## Transferencia asistida (2026-10-26)
Arriba de la pestaña «Pruebas manuales» (solo administradores): Buscar pendientes → Simular → Crear.
- **Buscar pendientes** (`GET configs/[id]/pendientes?limite=50`, máx. 200): consulta SAP con el MISMO
  filtro del motor (`rutaCandidatos`: `desde_fecha` + `filtro_odata`), `$select` acotado
  (DocEntry, DocNum, DocDate, CardName y DocTotal si la entidad usa DocumentLines),
  `$orderby=DocDate desc,DocEntry desc`, por páginas, quitando lo que en `nabuco_envio` está
  `enviado` o `descartado`. Revisa como máximo 5 000 documentos; `hayMas` avisa si quedaron más.
  Sin columna de # líneas (exigiría traer las líneas de cada documento).
- **Simular** (`POST configs/[id]/simular { docEntries }`, máx. 200): lee cada documento, arma el
  payload con el mapeo y lo valida (`problemasArmado`: campo SAP inexistente o documento sin líneas).
  Los válidos quedan `simulado` en `nabuco_envio` (como el motor en simulación; nunca pisa un
  `enviado`); los inválidos NO se registran. Un fallo leyendo SAP se registra como `error` (igual que el motor).
- **Crear** (`POST configs/[id]/crear { docEntries, confirmoProduccion? }`, máx. 200): solo los que
  salieron bien en Simular. Envía DE VERDAD (ignora el modo simulación, solo desde este botón), uno por
  uno con el token en caché, por `procesarDocumento` del motor (mismo registro `enviado`/`error`,
  intentos, marca UDF y alertas). Vuelve a leer y validar en SAP y revisa el log justo antes de cada
  envío: si ya está `enviado` lo reporta `ya_enviado` sin reenviar (`descartado` → `omitido`).
  Producción de Nabuco: modal con PRODUCCION y el servidor exige `confirmoProduccion: true` (409).
- Simular y Crear toman el lock de la config (`en_ejecucion_desde`): si hay una corrida automática,
  «Ejecutar ahora» u otra acción manual en curso → 409. Quién y cuándo: `usuario_accion`/`fecha_accion`.
- La pantalla manda Simular/Crear en tandas de 10 (barra de progreso; cada tanda toma y suelta el lock).
- Código: `asistida.ts` (servidor), `asistidaReglas.ts` (reglas puras), `procesarDocumento` y
  `rutaCandidatos` en `motor.ts` (los usa también la corrida automática),
  `components/transferencias-nabuco/NabucoAsistida.tsx`. Pruebas: `__tests__/asistida.test.ts`.
- Sin SQL nuevo.

## Diagnóstico técnico de errores (2026-10-26)
El módulo es técnico: todo error se muestra con detalle (`diagnostico.ts`, UI `NabucoDiagnostico.tsx`).
- `DiagnosticoNabuco`: `ok`, `etapa` (validacion|red|autenticacion|envio|respuesta|sap|interno), `mensaje`,
  `detalle`, `sugerencia`, `peticion` (método, URL, cabeceras con Authorization ENMASCARADA
  `Bearer eyJ…(oculto, N caracteres)`, cuerpo; en /AuthBI el `pwd` va SIEMPRE `•••`), `respuesta` (HTTP,
  status_text, cabeceras relevantes, `cuerpo_crudo` ≤ 20 000, `cuerpo_json`), `red` (código de
  `err.cause.code`: ENOTFOUND, ECONNREFUSED, ETIMEDOUT, ECONNRESET, UND_ERR_CONNECT_TIMEOUT, TimeoutError,
  CERT_*…), `duracion_ms`, `cuando`, `http_synerlink` (solo errores de nuestra API).
- Clasificadores con sugerencias (DNS, puerto cerrado, servidor dormido/timeout, 401 AuthBI → org 0 vs 1,
  401 solicitudes → token vencido ya reintentado, 400 con el mensaje de Nabuco, 404/405 ruta, 5xx Nabuco,
  respuesta no JSON, token no reconocible). `sanitizarDiagnostico` borra cualquier secreto conocido.
- `nabucoClient`: `pedirTokenDetalle` lanza `NabucoDiagnosticoError` (`.diagnostico`) y al éxito devuelve
  `{ token, status, diagnostico }`; `enviarSolicitudCruda` devuelve `{ ok, status, cuerpo, diagnostico }` y
  solo lanza por red/URL. La caché y el reintento ante 401 no cambian (el detalle lo anota).
- **Contrato de la API**: fallas de Nabuco, de red o de SAP (upstream) → **HTTP 200 `{ ok: false, error,
  diagnostico }`** (antes 502). 4xx/5xx solo para lo nuestro: 401 sesión, 403 permiso, 400 validación,
  409 conflicto, 500 interno (con diagnóstico etapa `interno`). Todos los errores llevan `diagnostico`.
  `simular`/`crear` devuelven `diagnostico` por documento; `pruebas` POST lo devuelve en `resultado`.
- Persistencia (sin SQL nuevo): en `nabuco_envio` y `nabuco_prueba_manual` la columna `respuesta` guarda el
  diagnóstico serializado (`{"diagnostico_nabuco":1,…}`; la UI lo detecta con `leerDiagnostico`) y `error`
  un resumen ≤ 2 000 car. Un envío OK sigue guardando en `nabuco_envio.respuesta` el cuerpo de Nabuco.
- **«Probar conexión» con datos de pantalla**: `POST configs/[id]/probar` acepta opcionalmente
  `{ nabuco_url, nabuco_usuario, nabuco_password, nabuco_org, ruta_token, timeout_ms }`; cada campo
  reemplaza al guardado SOLO para la prueba (contraseña vacía = la guardada). Valida protocolo y ruta
  (`conexionPrueba.ts`). Si difiere de lo guardado responde `usaCambiosSinGuardar: true` y NO toca la caché
  de token. Respuesta: `{ ok, mensaje, usaCambiosSinGuardar, http_status, duracion_ms, diagnostico }`.
  Configuración manda el formulario actual (badge «Cambios sin guardar» y aviso amarillo); Pruebas
  manuales no edita credenciales y prueba con lo guardado. Ambas validan en el cliente qué falta.
- Pruebas: `__tests__/diagnostico.test.ts`.

## Pendiente
1. Correr el script de PRUEBAS y asignar los permisos por empresa (Administración → Usuarios).
2. Probar contra el Nabuco real: confirmar la forma de la respuesta de `/AuthBI` (hoy se acepta
   cuerpo JSON string o `{token|accessToken}`) y que el cuerpo esperado sea un objeto con `items`.
3. El cliente común `lib/sap/serviceLayer.ts` desactiva la validación TLS hacia SAP (certificados
   autofirmados de los Service Layer). La conexión a Nabuco SÍ valida TLS. Decidir si se instala la CA.
4. La consulta de candidatos trae hasta 20 000 DocEntry por corrida (desde la fecha configurada);
   si el volumen crece, acotar con «Enviar solo documentos desde».
5. Falta prueba de rutas (sesión/permisos) estilo `app/api/vitrina` y E2E de la pantalla; agregar
   `app/api/transferencias-nabuco/**` al `include` de `vitest.config.mts` cuando existan.
6. No hay borrado de configuraciones (se pausan); si se necesita, agregar DELETE que también
   desactive la tarea en `scheduled_job` (y borre su historial en `nabuco_prueba_manual`).
7. Correr `2026-10-26-nabuco-pruebas-manuales-PRUEBAS.sql` y probar la pestaña «Pruebas manuales»
   contra el ambiente de pruebas de Nabuco. La reversa del 25 ya borra también `nabuco_prueba_manual`.
8. Probar la Transferencia asistida contra SAP de pruebas y el Nabuco de pruebas (verificar que
   `CardName` exista en el `$select` de StockTransfers/InventoryTransferRequests en ese Service Layer).
