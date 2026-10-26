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
  y actualiza la caché. Con varias instancias del proceso cada una tiene su caché.

## Pruebas manuales (2026-10-26)
Pestaña «Pruebas manuales» (solo administradores del módulo), por configuración:
- «Probar conexión» (token nuevo; muestra OK o el HTTP y el mensaje).
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
