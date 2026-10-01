# Procedimiento de control de cambios del SGC documental (sistema validado)

> Versión 1 — Sprint 6, 2026-10-01. Aplica al código del módulo (`lib/sgc/**`, `app/api/sgc/**`, `app/(hub)/process/sgc-documental/**`, `components/sgc/**`), al esquema SQL `sgc`, a los SQL de datos (`prisma/manual/*sgc*`) y a la configuración de flujos validados.

## 1. Principio

El SGC es un sistema validado: **todo cambio se clasifica, se prueba, se aprueba y queda registrado antes de llegar a producción**. Lo que sigue en desarrollo en SynerLink general (solicitudes, flujos, firma) no entra al SGC solo: se trae como cambio controlado.

## 2. Tipos de cambio

| Tipo | Ejemplos | Exige |
|---|---|---|
| Configuración (sin código) | Nueva versión de un flujo, matriz de responsables, grupos de autorización, avisos, procesos y tipos documentales | Motivo y referencia en la pantalla; queda en `sgc.config_change_log` o `sgc.audit_log` (solo inserción). Una versión de flujo nueva no afecta solicitudes en curso. |
| Menor (código) | Corrección visual, texto, ajuste de una prueba | PR a `testing` con CI en verde y matriz de trazabilidad; nota en el plan. |
| Mayor (código o esquema) | Nueva funcionalidad, migración del esquema `sgc`, cambio de firma, de permisos o de la cadena de auditoría | Lo anterior + análisis de impacto + requisitos nuevos `SGC-REQ-xxx` con sus pruebas + migración idempotente con reversa probada en PRUEBAS + aprobación de Aseguramiento de Calidad y de Nicolás Rivera para producción. |
| Emergencia | Falla que impide operar | Se corrige primero en PRUEBAS si es posible; se documenta después dentro de las 48 horas con el mismo rigor. |

## 3. Flujo

1. **Solicitud**: qué cambia y por qué (caso en SynerLink o nota del plan).
2. **Análisis**: requisitos afectados, riesgo y si requiere revalidar (IQ/OQ/PQ parcial).
3. **Desarrollo**: rama propia desde `testing`; cambios mínimos; nada de formateadores automáticos sobre archivos existentes.
4. **Pruebas**: unitarias, de rutas, de integración con SQL Server efímero y e2e; cada prueba con su `[SGC-REQ-xxx]`; la CI arma la matriz de trazabilidad y archiva la evidencia (90 días) y se copia a la carpeta de auditoría.
5. **Base de datos** (si aplica): migración idempotente y aditiva en `prisma/migrations`, aplicada en PRUEBAS **antes** del despliegue, registrada en `_prisma_migrations`, con reversa probada y evidencia en `~/.horus/rollbacks/`. En `sgc` el DDL destructivo exige declarar la sesión (`sp_set_session_context N'sgc_ddl_autorizado', 1` y el motivo) y queda en `sgc.ddl_event_log`.
6. **Despliegue a PRUEBAS** y e2e con sesión en verde.
7. **Aprobación** para producción (cambios mayores): Aseguramiento de Calidad y Nicolás Rivera.
8. **Pase a producción** con el runbook (aviso en Teams antes, respaldo, verificación previa, despliegue con reversa, verificación posterior) y registro en la bitácora de cambios de Tecnología en Kronos (categoría 93).
9. **Cierre**: actualizar el plan, la skill `sgc-activar-empresa` y el expediente de validación.

## 4. Registros que deja cada cambio

PR y commits (con la descripción y la evidencia), artefactos de CI (JUnit, cobertura, reporte de Playwright, manifiesto y matriz), `_prisma_migrations`, `sgc.ddl_event_log`, `sgc.config_change_log`, `sgc.audit_log`, respaldos y reversas en `~/.horus/rollbacks/`, carpeta de auditoría en SharePoint y bitácora de Kronos.
