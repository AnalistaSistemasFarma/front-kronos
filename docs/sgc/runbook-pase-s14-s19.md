# Runbook: pase del SGC S14–S19 (PR #610)

> **Estado:** preparado, **sin ejecutar**. Ningún SQL de este runbook se ha corrido en PRUEBAS ni en KRONOSDB; solo en la base efímera de la CI.
> **Incluye:** S14 (correcciones), S15 (DOC v7), S16 (encabezados y Excel), S17–S18 (evaluaciones en SynerLink), el Generador del PR #587 (fusionado en esta rama) y S19 (Generador solo sin codificación).
> **Dependencias nuevas de npm:** ninguna (`package.json` y `package-lock.json` sin cambios).
> **Herramienta:** `node scripts/sgc/pase-produccion/aplicar-sql.mjs [--confirmo-produccion] --registro pase-s14-s19.log <archivo.sql>` desde la carpeta del proyecto en el servidor (verifica `DB_NAME()`, se detiene en el primer error).

## 1. Interrupción esperada

| Ambiente | Interrupción | Por qué |
|---|---|---|
| testing (PRUEBAS) | **5 a 10 minutos** | El esquema de Prisma cambia (5 migraciones): `prisma generate` y el build con las apps detenidas. Sin dependencias nuevas. |
| producción | **5 a 8 minutos** con `desplegar-con-reversa.ps1` (ver `runbook-pase-produccion.md`) | Mismo motivo; nunca con `main.yml` tal cual. |

Las migraciones son **aditivas** y van **antes** del código: el código anterior no ve las columnas ni las tablas nuevas.

## 2. Orden del pase (igual en PRUEBAS y en producción)

| # | Momento | Archivo | Qué hace |
|---|---|---|---|
| 1 | Antes del código | `prisma/migrations/20261010100000_sgc_generador_plantillas/migration.sql` | Generador (PR #587): plantillas, versiones y registros generados; `generator_enabled` = 0. |
| 2 | Antes del código | `prisma/migrations/20261014100000_sgc_s15_modelo_roles/migration.sql` | `flow_version.role_model`, líderes por departamento y la acción «rechazar». |
| 3 | Antes del código | `prisma/migrations/20261014110000_sgc_s16_encabezados_excel/migration.sql` | Plantillas de encabezado, Excel en el borrador, huella del original. |
| 4 | Antes del código | `prisma/migrations/20261014120000_sgc_s17_evaluaciones/migration.sql` | Banco de preguntas e intentos (solo inserción). |
| 5 | Antes del código | `prisma/migrations/20261014130000_sgc_s19_generador_sin_codificacion/migration.sql` | `document_type.generator_guide` = 0 en todos los tipos. |
| 6 | **Código** | Despliegue de la rama | — |
| 7 | Después del código | `node scripts/sgc/pase-produccion/registrar-migraciones.mjs > reg.sql` y aplicar `reg.sql` | Registra en `_prisma_migrations` las migraciones `_sgc_` que falten (las 5 nuevas). |
| 8 | Después del código | `prisma/manual/2026-10-14-sgc-s15-flujo-doc-v7-olp.sql` | Publica el DOC v7 de OLP. Las solicitudes en curso **conservan su versión** (v6). |
| 9 | Después del código | `prisma/manual/2026-10-14-sgc-s16-encabezados-excel-olp.sql` | Encabezado por defecto «INSTITUCIONAL» (D20) y Formato (FO) en Word y Excel (D17). |
| 10 | Opcional | `prisma/manual/2026-10-14-sgc-s19-generador-guia-olp.sql` | Marca «Plantilla» (PLT) como plantilla guía, **solo si Calidad lo confirma**. |
| 11 | **Solo PRUEBAS** | `prisma/manual/2026-10-10-sgc-generador-plantillas-pruebas.sql` | Enciende el Generador en PRUEBAS. En producción el Generador sigue apagado. |
| 12 | **Solo PRUEBAS** | `scripts/sgc/pase-s14-s19/pruebas/01-qa-departamento-pruebas.sql` | Asigna los usuarios `qa.sgc*` al departamento «GARANTIA DE CALIDAD» (requisito del e2e del DOC v7). |

Requisito operativo previo al paso 8 en producción (R40): las personas de OLP deben tener usuario y **departamento** en SynerLink. Sin departamento, el elaborador no puede elegir revisores ni aprobadores y la pantalla le pide acudir a TI.

## 3. Reversa (orden inverso; cada una es idempotente)

| # | Archivo | Bandera que exige si hay datos |
|---|---|---|
| R12 | `scripts/sgc/pase-s14-s19/pruebas/01-qa-departamento-pruebas-reversa.sql` (solo PRUEBAS) | — |
| R10 | `prisma/manual/2026-10-14-sgc-s19-generador-guia-olp-reversa.sql` | — |
| R9 | `prisma/manual/2026-10-14-sgc-s16-encabezados-excel-olp-reversa.sql` | — |
| R8 | `prisma/manual/2026-10-14-sgc-s15-flujo-doc-v7-reversa.sql` | — (publica una versión nueva con el modelo anterior) |
| R6 | Volver al código anterior | — |
| R5 | `prisma/manual/2026-10-14-sgc-s19-generador-sin-codificacion-reversa.sql` | `sgc_reversa_generador_guia` |
| R4 | `prisma/manual/2026-10-14-sgc-s17-evaluaciones-reversa.sql` | `sgc_reversa_evaluaciones` |
| R3 | `prisma/manual/2026-10-14-sgc-s16-encabezados-excel-reversa.sql` | `sgc_reversa_encabezados` |
| R2 | `prisma/manual/2026-10-14-sgc-s15-modelo-roles-reversa.sql` | `sgc_reversa_modelo_roles`, `sgc_reversa_lideres_departamento` |
| R1 | `prisma/manual/2026-10-10-sgc-generador-plantillas-reversa.sql` | `sgc_reversa_generador` |

Sin la bandera, cada reversa con datos **se niega** (THROW). La bandera se declara con `EXEC sp_set_session_context N'<bandera>', 1;` y solo con la autorización de Nicolás Rivera o Cristian Baldión. La CI prueba cada reversa dos veces y vuelve a migrar.

## 4. Verificación después del pase

1. `SELECT name FROM sys.tables WHERE schema_id = SCHEMA_ID('sgc')` incluye `header_template`, `training_question`, `training_option`, `training_attempt`, `training_answer`, `generator_template`, `generator_template_version` y `generated_document`.
2. OLP: Flujos → DOC muestra la v7 publicada; una solicitud abierta antes del pase sigue en su versión.
3. Configuración del SGC: pestaña «Encabezados» con «INSTITUCIONAL» por defecto; FO admite Word y Excel; los interruptores «Flujo DOC v7: aprueban solo los líderes autorizados…» (apagado, D16) y «Flujo DOC v7: Aseguramiento de Calidad cierra la capacitación…» (encendido, D18).
4. La firma propia con imagen sigue **apagada**.
5. e2e con sesión: `npx playwright test e2e/sgc` contra PRUEBAS.

## 5. Decisiones que quedaron con el valor por defecto más seguro (configurables)

- **D14:** «Calidad revisa lo que elaboró» sigue encendido en OLP, según su decisión.
- **D16:** la lista de líderes por departamento existe, pero queda **apagada** (sin restricción).
- **D17:** solo «Formato» (FO) admite Excel; los demás tipos siguen solo con Word. El Excel nunca se convierte a Word.
- **D18 (sin decidir):** Calidad cierra la capacitación (**encendido**). Configurable por empresa.
- **D20:** una plantilla de encabezado por defecto («INSTITUCIONAL»); las de cada tipo las carga Calidad.
- **D22:** el área de ubicar firmas se agrandó en los dos lienzos (SGC y Orión) para conservar la paridad; el avance automático a la siguiente firma es solo del SGC.
- **Rechazo de la creación:** la solicitud se cierra con estado `cancelada`, el motivo y el vigente enlazado, si lo hay.
- **Autorización de la creación:** siempre se pide, sin condiciones.
- **Opción múltiple:** se califica todo o nada.
- **Reporte de la evaluación:** se consulta en el visor. Descargarlo exige el permiso excepcional de descarga.
- **R34 (S19):** ningún tipo queda marcado como plantilla guía. El script opcional marca solo PLT, y únicamente con la confirmación de Calidad.
