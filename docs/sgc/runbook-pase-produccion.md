# Runbook: pase del SGC documental de One Latam Pharma a producción

> **Estado:** listo para ejecutar, **sin ejecutar**. El pase exige la autorización explícita y puntual de Nicolás Rivera (ver «Decisiones y autorizaciones»).
> **Versión:** Sprint 6, 2026-10-01. Ensayado en PRUEBAS (KRONOSDB_PRUEBAS, SQL Server 2016) ese mismo día.
> **Qué sube:** el módulo SGC documental completo (S0 a S6), el retiro del módulo documental viejo y los datos iniciales de OLP. Las demás empresas no se activan.

## 1. Resumen

| Tema | Detalle |
|---|---|
| Interrupción de SynerLink | **5 a 8 minutos**, solo durante el paso B6 (generar el cliente de Prisma y compilar). Si algo falla, la reversa automática deja la versión anterior arriba en 1 a 2 minutos más. |
| Duración total de la ventana | **60 a 75 minutos**, incluidos respaldo, verificaciones y datos. |
| Ventana recomendada | Día hábil de **19:00 a 20:30** (después del horario de oficina) o sábado de **8:00 a 9:30**. Evitar de 5:00 a 6:30 a. m. (predictivo de las 5:15 y rutina de las 6:00) y los cierres contables. Infraestructura debe estar localizable para el respaldo. |
| Responsables | Ejecuta Tecnología (horus con un humano presente); autoriza Nicolás Rivera; infraestructura (Cristian Baldión) confirma el respaldo de KRONOSDB. |
| Rama | `promote/sgc-olp-<fecha>`, nacida de `main` con **solo** lo del SGC (patrón SGD). Nunca se promueve `testing` completo. |

**Por qué no se usa `main.yml` tal cual.** El pase cambia el esquema de Prisma. Con cambio de esquema, `main.yml` detiene las apps y, si `prisma generate` o el build fallan, las deja **abajo**. Eso tumbó SynerLink 21 minutos el 2026-09-30 (PR #472). Por eso este pase usa `scripts/sgc/pase-produccion/desplegar-con-reversa.ps1`, que respalda `.next` y el cliente antes de detener nada, cierra solo los procesos huérfanos que retienen el motor de Prisma y, ante cualquier fallo, vuelve a la versión anterior y levanta las apps. Durante el pase, `main.yml` se deshabilita para que no corra en paralelo.

## 2. Hallazgos que condicionan el pase (verificados en solo lectura el 2026-10-01)

1. En KRONOSDB, `document`, `document_type` y `document_version` tienen **0 filas**. Los subprocesos 40 (`/process/document-management`, sin asignaciones) y 41 (`.../manage`, 1 asignación) siguen existiendo. **`document_signatures` (395 filas, de Orión) no es del módulo y no se toca.**
2. El código de `main` (producción) hace JOIN a `document_version` en «Ver actividades». Por eso el DROP va **después** del código nuevo.
3. **PRUEBAS y PRODUCCIÓN comparten el mismo OneDrive** (`MICROSOFTGRAPHUSERROUTE`). Desde el S6, pruebas usa `SGC-PRUEBAS/OLP` y la carpeta `SGC/` queda **limpia para producción**. Si se revierte esto, pruebas volvería a escribir sobre los archivos de producción.
4. En producción **no existen** `dbo.scheduled_job` ni `dbo.scheduled_job_run`: el programador central solo está activo en pruebas. Sin ellas, los avisos automáticos de vencimiento y los recordatorios de lectura no corren (todo lo demás sí). Ver el paso opcional B9b.
5. `main` no tiene las dependencias `@tiptap/*`, `mammoth`, `puppeteer`, `@xyflow/react` ni `qrcode-generator`. El `npm install` del pase las agrega y solo cambia `semver` de 7.7.3 a 7.8.5 entre las existentes. **`puppeteer` necesita Chrome headless para el usuario que corre pm2 (`nicolas.rivera`)**; hoy no hay caché de puppeteer en serfarma05 (sí hay salida a internet).
6. `NEXTAUTH_URL` de producción es `https://groupsharedservices.farmalogica.com:8445/`. Queda impresa en el QR de cada PDF controlado y en los enlaces iCal: hay que confirmar que es la URL pública definitiva.
7. KRONOSDB tiene respaldo completo diario (00:00) y uno COPY_ONLY (00:20). El usuario de la aplicación (`AdminSAPSEND`) es `db_owner`.

## 3. Fase A — Preparación (días antes, sin interrupción)

| # | Paso | Cómo | Evidencia |
|---|---|---|---|
| A1 | Armar la rama de promoción | `bash scripts/sgc/pase-produccion/armar-rama-promocion.sh origin/testing promote/sgc-olp-<fecha>` en un clon limpio. Luego `npm install`, `npx prisma generate`, `npx tsc --noEmit`, `npx vitest run` y `npm run build`. Revisar los archivos marcados «REVISAR» en `reports/promocion-sgc.txt`. | Ensayo del 2026-10-01: tsc, 915 pruebas y build en verde. |
| A2 | PR a `main` | PR con la descripción del pase. `main` está protegida: 1 aprobación y la compuerta `prod-gate`. **No fusionar todavía.** | CI y compuerta en verde. |
| A3 | Chrome headless para pm2 | En serfarma05, como `nicolas.rivera`, en la carpeta del proyecto después de `npm install`: `npx puppeteer browsers install chrome-headless-shell`. Otra opción: `PUPPETEER_CACHE_DIR` común en el `.env` y en el entorno del instalador. Probar: `node -e "require('puppeteer').launch({headless:true}).then(b=>b.close())"`. | Sin esto, el PDF controlado queda «pendiente» (la firma sí funciona). |
| A4 | Variables de entorno | Confirmar `NEXTAUTH_URL` definitiva (hallazgo 6). No hay variables nuevas obligatorias. Si se activa la tarea programada del programador: `INTEGRATION_API_KEYS`. | — |
| A5 | Aviso previo | Aviso en el grupo de Teams de desarrollo (24 horas antes): qué sube, impacto de 5 a 8 minutos y ventana. | Mensaje en Teams. |
| A6 | Respaldo de infraestructura | Pedir a infraestructura un `BACKUP DATABASE KRONOSDB ... WITH COPY_ONLY` justo antes de la ventana (o confirmar el diario de menos de 24 horas) y que sepa restaurarlo en una base temporal si hiciera falta. | Nombre y hora del respaldo. |

## 4. Fase B — Ventana del pase (orden exacto)

Herramientas: `node scripts/sgc/pase-produccion/aplicar-sql.mjs --confirmo-produccion --registro pase-sgc.log <archivo.sql>` ejecutado **desde la carpeta del proyecto en serfarma05** (lee `DATABASE_URL` del `.env`, se detiene en el primer error y deja registro). Cada paso tiene su reversa en la sección 5.

| # | Paso (duración aprox.) | Comando o acción | Criterio para seguir |
|---|---|---|---|
| B0 | Aviso de inicio (1 min) | Mensaje en Teams: «Iniciamos el pase del SGC documental; SynerLink tendrá una interrupción de 5 a 8 minutos hacia las HH:MM». | — |
| B1 | Respaldo (5 min) | Confirmar el respaldo de A6. Copiar a `~/.horus/rollbacks/<fecha>-sgc-pase-prod/` la evidencia de B2. | Respaldo de menos de 24 horas. |
| B2 | Verificación previa, solo lectura (1 min) | `aplicar-sql.mjs ... scripts/sgc/pase-produccion/sql/00-verificacion-previa.sql` | «Verificación previa CORRECTA». Si hace THROW, **se suspende el pase**. |
| B3 | Deshabilitar el auto-despliegue (1 min) | `gh workflow disable main.yml -R AnalistaSistemasFarma/front-kronos` | Workflow deshabilitado. |
| B4 | Estructura del SGC, antes del código (2 min) | Aplicar en este orden: `prisma/migrations/20260930110000_sgc_esquema_base`, `20260930150000_sgc_s1_repositorio`, `20260930200000_sgc_s2_flujos_tareas_autorizaciones`, `20260930230000_sgc_s3_firma_pdf_calidad`, `20261001000000_sgc_s4_divulgacion_capacitacion_vigencia`, `20261001100000_sgc_s5_relaciones_vencimientos_accesos`, `20261001200000_sgc_s6_endurecimiento`, `20261003120000_sgc_correcciones_calidad` (correcciones de Calidad OLP del 2026-10-02: ubicación de firmas, umbral de lectura, revisión menor, logo y dominios; declara el cambio controlado) `20261008100000_sgc_s8_encabezado_listado_maestro` (S8: encabezado obligatorio, carga inicial, herencia del número del padre y listado maestro) y `20261008110000_sgc_s9_archivos_relaciones_correo` (S9: carga masiva de PDF, relaciones propuestas y política de correo; **deja el correo en «nunca»**) (cada `migration.sql`). Son aditivas, solo en `sgc`; la app vieja no las ve. | 51 tablas en `sgc`, trigger `sgc_proteger_esquema` habilitado. |
| B5 | Fusionar la promoción (1 min) | `gh pr merge <n> --merge` (con la aprobación requerida; `--admin` solo si Nicolás lo autoriza). **Sin** `--delete-branch`. | `origin/main` en el commit del pase. |
| B6 | Código, con reversa automática (8 a 12 min; **interrupción de 5 a 8**) | En serfarma05, PowerShell como administrador: `.\scripts\sgc\pase-produccion\desplegar-con-reversa.ps1 -ProjectDir 'C:\Users\administrador.DFARUNIADM\projects\front-kronos' -Ref origin/main -Apps GSS-Front,kronos-mcp -Port 3003 -Pm2Cmd 'C:\Users\nicolas.rivera\AppData\Roaming\npm\pm2.cmd' -Pm2Home 'C:\Users\nicolas.rivera\.pm2'` | «PASE DE CÓDIGO CORRECTO». Si dice «REVERTIDO», la app vieja quedó arriba: **suspender** y revisar el registro. |
| B7 | Retiro del módulo viejo (1 min) | `aplicar-sql.mjs ... scripts/sgc/pase-produccion/sql/01-retiro-modulo-viejo.sql` | 0 tablas viejas, 0 subprocesos viejos, `document_signatures` intacta. |
| B8 | Registro de migraciones (1 min) | `node scripts/sgc/pase-produccion/registrar-migraciones.mjs > reg.sql` y aplicar `reg.sql`. | 10 filas `%sgc%` en `_prisma_migrations`. |
| B9 | Datos de OLP, después del código (3 min) | En orden: `prisma/manual/2026-09-30-sgc-s0-cimientos.sql` (menú, 4 subprocesos, OLP activa en `SGC/OLP`, permisos solo para Nicolás), `2026-09-30-sgc-s1-maestros-olp.sql`, `2026-09-30-sgc-s2-flujo-documental-olp.sql`, `2026-09-30-sgc-s3-firma-calidad-olp.sql`, `2026-10-01-sgc-s4-divulgacion-capacitacion-olp.sql`, (B9b), `2026-10-01-sgc-s5-vencimientos-olp.sql` y `2026-10-03-sgc-correcciones-calidad-olp.sql` (dominios @onelatampharma.com de la divulgación y logo del encabezado institucional); `2026-10-03-sgc-tipo-plantilla-olp.sql` solo si Calidad confirma el tipo «Plantilla» (código PLT); por último `scripts/sgc/pase-produccion/sql/05-correo-avisos-apagado.sql`. | Cada script imprime su «después» sin errores. |
| B9b | **Opcional:** programador central | `scripts/sgc/pase-produccion/sql/04-programador-central.sql` **antes** del SQL del S5 (solo con la decisión 5). | Tablas creadas; el S5 crea el job `sgc_review_alerts`. |
| B10 | Verificación posterior (10 min) | Ver la sección 6. | Todo en verde. |
| B11 | Cierre (2 min) | `gh workflow enable main.yml`; primer respaldo lógico (`node scripts/sgc/respaldo/respaldar.mjs --out <carpeta>`); aviso de cierre en Teams con la URL `https://groupsharedservices.farmalogica.com:8445/` y la duración. | — |

## 5. Reversa paso a paso

| Si falla en… | Qué hacer | Resultado |
|---|---|---|
| B2 | Nada que revertir: se suspende el pase. | Producción intacta. |
| B4 | Primero las reversas de los sprints posteriores, de la más nueva a la más antigua (S9: `prisma/manual/2026-10-08-sgc-s9-archivos-relaciones-correo-reversa.sql`; S8: `prisma/manual/2026-10-08-sgc-s8-encabezado-listado-maestro-reversa.sql`; correcciones: `2026-10-03-sgc-correcciones-calidad-reversa.sql`); después `prisma/manual/2026-10-01-sgc-s6-endurecimiento-reversa.sql` y luego, en orden inverso, las reversas de S5 a S1 (`prisma/manual/*-reversa.sql`) y la de S0 cimientos. La app vieja no usa `sgc`. | Esquema `sgc` vacío o inexistente. |
| B6 | El script ya revirtió solo: commit anterior, `.next` y cliente restaurados, apps arriba. Revisar el registro (`%TEMP%\pase-sgc-*.log`). Volver a habilitar `main.yml` **solo después** de dejar `main` en el commit anterior (`git revert` del merge en un PR), o el siguiente push redesplegaría el SGC. | SynerLink en la versión anterior. |
| Después de B6 (error funcional) | Correr de nuevo `desplegar-con-reversa.ps1` con `-Ref <commit anterior>`, o revertir el merge en `main` y desplegar. Si ya se hizo B7, primero recrear las tablas viejas (paso siguiente). | Versión anterior. |
| B7 | Aplicar `prisma/migrations/20260821000000_add_document_management/migration.sql` y `20260821120000_document_management_workflow/migration.sql`, luego `scripts/sgc/pase-produccion/sql/01-retiro-modulo-viejo-reversa.sql` (restaura los subprocesos 40 y 41 con sus ids y la asignación). Solo tiene sentido si también se revierte el código. | Estado previo del módulo viejo (tablas vacías). |
| B9 | Cada SQL de datos es idempotente: corregir y volver a correr. Para deshacer, la reversa del sprint correspondiente en `prisma/manual/` (S5 → S1, luego S0 cimientos). | — |
| Desastre de base de datos | Restaurar el respaldo de A6 (infraestructura). Para el SGC se puede además restaurar el respaldo lógico con `scripts/sgc/respaldo/restaurar.mjs` (ver el procedimiento de respaldo). | — |

**Ensayo de la reversa (PRUEBAS, 2026-10-01):** se recrearon en KRONOSDB_PRUEBAS las 3 tablas viejas y 2 subprocesos con las mismas URL. Se corrió el retiro; una segunda corrida idempotente; la reversa, que restauró los mismos ids; y el retiro final. Todo dio el resultado esperado y se limpiaron los respaldos del ensayo. La primera versión del script fallaba en la segunda corrida (`Invalid object name 'dbo.document'`) y se corrigió con SQL dinámico.

**Ensayo del despliegue con reversa (PRUEBAS, .230, 2026-10-01):**
- Con fallo simulado en `prisma generate`: la reversa restauró `.next` y el cliente y levantó la app; **interrupción de 48 s**; `/login` 200.
- Sin fallo (mismo commit, compilación completa): respaldo con las apps arriba 83 s; **interrupción de 4 min 32 s** (generar 16 s y compilar 4 min 11 s); humo correcto; 7 min 3 s en total.
- El ensayo encontró dos errores del script, ya corregidos: el archivo debía guardarse con BOM (PowerShell 5.1 leía mal las tildes) y la función `Pm2` se llamaba a sí misma.

## 6. Verificación posterior

1. `http://localhost:3003/login` 200; `/process/sgc-documental` 307 al login sin sesión; `/api/sgc/access` 401 sin sesión; `/api/chat/agent/inbox` 401.
2. Con la sesión de Nicolás: «Sistema de Gestión de Calidad» en el menú; el tablero muestra ONELATAMPHARMA; configuración del SGC con los 15 procesos propuestos y los 8 tipos; Administración de flujos con DOC vigente (con divulgación y capacitación); Autorizaciones SGC con los tipos y el grupo de Calidad.
3. «Ver actividades» de una solicitud general abre bien (ya sin JOIN a `document_version`); crear y resolver una tarea de una solicitud general de prueba.
4. `node scripts/sgc/respaldo/verificar.mjs --schema sgc`: cadena de firmas vacía y correcta, triggers habilitados, solo inserción rechaza modificaciones.
5. `git grep -n document-management` en `main` solo encuentra las carpetas de migración ya aplicadas.
6. `sgc.company_config` de producción en `SGC/OLP`; el de pruebas en `SGC-PRUEBAS/OLP`.
7. Cargar un documento de verificación **no oficial** solo si Calidad lo pide (en producción no se crean usuarios QA).

## 7. Decisiones y autorizaciones que debe dar Nicolás

Ver la lista numerada en el expediente de validación y en la nota del plan. Resumen: (1) autorizar el pase y la ventana; (2) confirmar la URL pública definitiva; (3) quién recibe permisos del SGC en producción además de él; (4) correo de avisos (apagado por defecto); (5) activar o no el programador central; (6) Chrome headless en serfarma05; (7) `--admin` o aprobación normal para fusionar en `main`; (8) solicitud a infraestructura de un usuario de base de datos sin privilegios de DDL para la aplicación; (9) validar los supuestos de S2 a S5 y el texto del consentimiento.

## 8. Archivos

- Rama y esquema: `scripts/sgc/pase-produccion/armar-rama-promocion.sh`, `ajustar-schema-promocion.mjs`.
- SQL del pase: `scripts/sgc/pase-produccion/sql/` (00 verificación, 01 retiro y su reversa, 04 programador opcional y su reversa, 05 correo apagado), `prisma/migrations/*sgc*`, `prisma/manual/*sgc*`.
- Ejecución: `scripts/sgc/pase-produccion/aplicar-sql.mjs`, `registrar-migraciones.mjs`, `desplegar-con-reversa.ps1`.
- Respaldo: `scripts/sgc/respaldo/` (procedimiento en `docs/sgc/procedimiento-respaldo-restauracion.md`).
