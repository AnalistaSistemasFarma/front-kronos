# Procedimiento de respaldo, restauración y verificación de integridad del SGC documental

> Sistema validado: SGC documental de SynerLink (esquema SQL `sgc` de KRONOSDB y carpeta `SGC/<EMPRESA>` de OneDrive).
> Versión 1 — Sprint 6, 2026-10-01. Probado en PRUEBAS ese mismo día (resultados al final).

## 1. Objetivo y alcance

Asegurar que la información del SGC (documentos controlados, versiones, firmas electrónicas, auditoría, flujos y su configuración) se puede **recuperar completa y verificar íntegra** ante un incidente. Cubre la base de datos (esquema `sgc`) y los archivos (PDF controlados, Word fuente, adjuntos, evidencias de firma y Excel de capacitación).

## 2. Capas de respaldo

| Capa | Quién | Frecuencia | Qué protege | Cómo se recupera |
|---|---|---|---|---|
| 1. Respaldo completo de KRONOSDB | Infraestructura | Diario (00:00, completo) y COPY_ONLY (00:20); uno extra antes de cada pase | Toda la base, incluido `sgc` | Restauración nativa de SQL Server por infraestructura |
| 2. Respaldo lógico del esquema `sgc` | Tecnología | Antes y después de cada cambio controlado; semanal recomendado | Las 45 tablas del SGC con su huella SHA-256 por tabla y el estado de la cadena de firmas | `scripts/sgc/respaldo/restaurar.mjs` y verificación con `verificar.mjs` |
| 3. Archivos en OneDrive/SharePoint | Microsoft 365 | Continuo (historial de versiones y papelera); el OneDrive tiene política de retención | Archivos del SGC con su id | Papelera o historial de versiones (conservan el id del archivo) |
| 4. Copia verificada de los archivos | Tecnología | Junto con la capa 2 | Cada archivo que la base registra, comparado con su SHA-256 | `scripts/sgc/respaldo/onedrive.mjs` (último recurso: el archivo restaurado queda con id nuevo) |

## 3. Respaldo lógico (capa 2)

Desde la carpeta del proyecto, con `DATABASE_URL` en el `.env`, sin uso del módulo (ventana o fuera de horario):

```
node scripts/sgc/respaldo/respaldar.mjs --out <carpeta>
node scripts/sgc/respaldo/verificar.mjs --from <carpeta> --schema sgc --informe <carpeta>/verificacion.json
```

El respaldo deja `manifiesto.json` (base, servidor, fecha UTC, commit, migraciones registradas, filas y huella por tabla, estructura completa y resultado de la cadena de firmas) y un JSON por tabla. Guardar la carpeta en un lugar con acceso restringido (contiene datos personales de los firmantes) y registrar el SHA-256 del manifiesto que imprime el script.

## 4. Copia y verificación de los archivos (capa 4)

```
node scripts/sgc/respaldo/onedrive.mjs --from <carpeta del respaldo> --out <carpeta>/onedrive
```

Descarga cada archivo por su id, calcula su SHA-256 y lo compara con la huella de la base. Los Word fuente no tienen huella registrada (se copian igual; el registro oficial es el PDF controlado). Cualquier diferencia es un hallazgo: el archivo fue modificado fuera del sistema.

## 5. Restauración

**Prueba periódica (recomendada cada 6 meses y después de cambios mayores):** restaurar en un esquema temporal de la misma base, verificar y limpiar.

```
node scripts/sgc/respaldo/restaurar.mjs --from <carpeta> --target-schema sgc_rst
node scripts/sgc/respaldo/verificar.mjs --from <carpeta> --schema sgc_rst --informe <carpeta>/verificacion-restauracion.json
node scripts/sgc/respaldo/limpiar-temporal.mjs --schema sgc_rst
```

La restauración comprueba primero que los archivos del respaldo no cambiaron, recrea la estructura **con las mismas migraciones del control de cambios** y carga los datos conservando los ids. La verificación exige: mismas filas y huella en las 45 tablas, misma estructura (columnas, índices, CHECK, claves foráneas y triggers), cadena de firmas íntegra y registros de solo inserción que rechazan modificaciones.

**Recuperación real:**
1. Primera opción: restauración nativa de la base por infraestructura (capa 1) en una base temporal; Tecnología verifica `sgc` con `verificar.mjs --schema sgc` contra el último respaldo lógico; infraestructura promueve la base.
2. Si solo se dañó el SGC: restaurar el respaldo lógico sobre `sgc` vacío (`--target-schema sgc --confirmo-restaurar-sobre-sgc`). Es un cambio controlado: requiere registro en el control de cambios y aprobación de Aseguramiento de Calidad y de Tecnología.
3. Archivos: papelera o historial de versiones de OneDrive (mismo id). Si no es posible, subir la copia verificada y re-apuntar el id en la base mediante cambio controlado.

## 6. Verificación periódica de integridad (sin restaurar)

`node scripts/sgc/respaldo/verificar.mjs --schema sgc` en producción, mensual y antes de cada auditoría: cadena de firmas de cada empresa, triggers del SGC habilitados (incluido el de base de datos) y solo inserción efectiva. Revisar también `sgc.ddl_event_log`: todo cambio de estructura debe corresponder a un cambio controlado.

## 7. Protección de los registros (Sprint 6)

- Los registros de auditoría, firmas, historial, revisiones, chequeos, capacitación y avisos son de **solo inserción** (triggers).
- **TRUNCATE y DROP** de esas tablas fallan siempre: una tabla de protección vacía las referencia con claves foráneas.
- Los cambios de estructura destructivos sobre `sgc` se rechazan si la sesión no declara el cambio controlado, y todo cambio de estructura queda en `sgc.ddl_event_log`.
- **Límite:** quien sea dueño de la base (`db_owner`/`sysadmin`) puede quitar o deshabilitar los triggers. Hoy la aplicación usa un usuario `db_owner`. Se recomienda a infraestructura un usuario de aplicación **sin** privilegios de DDL y auditoría de SQL Server a nivel de servidor; mientras tanto, la verificación periódica detecta triggers deshabilitados.

## 8. Resultado de la prueba en PRUEBAS (2026-10-01)

| Prueba | Resultado |
|---|---|
| Respaldo lógico antes del S6 | 43 tablas, 1.787 filas; cadena de firmas de OLP íntegra (90). Verificación contra `sgc`: CORRECTA. |
| Respaldo lógico después del S6 | 45 tablas, 1.793 filas; cadena íntegra (90). |
| Restauración en `sgc_rst` (base temporal) | 45 tablas y 1.793 filas en ~4,5 s con las 7 migraciones del SGC reescritas al esquema temporal (SQL Server 2016). |
| Verificación de la restauración | CORRECTA: filas y huella idénticas en las 45 tablas, estructura idéntica, cadena de firmas íntegra (90), solo inserción efectiva en `audit_log`, `signature`, `interaction` y `config_change_log`. |
| Prueba negativa | Se alteró el motivo de UNA firma en la copia: la verificación detectó la tabla distinta y la cadena ROTA en esa firma exacta. |
| Archivos de OneDrive | 130 archivos (871.799 bytes): 130 descargados, 117 con huella y 117 coinciden (13 Word fuente sin huella registrada); restaurados en una carpeta de prueba, vueltos a descargar y verificados 130/130; carpeta de prueba eliminada. |
| Hallazgo | La primera restauración omitió 21 CHECK porque las migraciones preguntan por el nombre del CHECK sin el esquema; se corrigió en la restauración (pregunta acotada al esquema destino). En una base vacía no ocurre. |
| Evidencia | `~/.horus/rollbacks/2026-10-01-sgc-s6-pruebas-evidencia/` (respaldos, manifiestos, informes JSON y registros). |
