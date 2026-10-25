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
   desactive la tarea en `scheduled_job`.
