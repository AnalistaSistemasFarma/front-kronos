# Módulo de Balances (Sprint 1)

Migra el botón "Ejecutar balances" de SAPSEND-GSS a SynerLink. Contexto completo
en la memoria del proyecto (bitácora de Nicolás vía SynerLink, 2026-09-21).

## Alcance de este sprint

- Botón manual por empresa (Farmalogica, OLP, GSS) — las 3 que hoy cubre el job
  compartido de SQL Agent `Balance_Empresas` / `Balance_Acumulado_Empresas` en
  serfarma07 (192.168.10.7). Ryan/Abamia/Kelab/Meditrack quedan para Sprint 3
  (ese job no tiene SQL para esas empresas todavía).
- Ejecución SÍNCRONA, sin estado en tiempo real (Sprint 2).
- El SQL de cada paso (`lib/balances/sql/*.sql`) se extrajo **verbatim** del
  job compartido (`sp_help_jobstep` en el 10.7, 2026-09-21) y se ejecuta
  directo contra `FARMA_IND_PROD`, **sin pasar por `sp_start_job`** — así se
  aísla por empresa sin tocar el job compartido (que corre las 3 empresas en
  cadena y no se puede parar a mitad limpiamente).
- **Candado GLOBAL, no por empresa** (pedido explícito de Nicolás, 2026-09-21:
  "quiero ejecutarlos independientemente a voluntad, la meta es que no
  colguemos 3 bases al mismo tiempo"): los 3 botones son independientes —
  cualquiera se puede disparar en cualquier momento — pero solo UNA corrida
  puede estar `running` a la vez en TODA la tabla `balance_run`, sin importar
  la empresa. Si se intenta una segunda mientras hay otra en curso, el
  servidor responde `409` (no la encola, la rechaza) y el front lo muestra
  como aviso. El candado es atómico en SQL (`INSERT ... WHERE NOT EXISTS`
  con `TABLOCKX`/`HOLDLOCK`), así que dos clics casi simultáneos no se cuelan
  los dos.

## Pendiente ANTES de desplegar (no lo hace este cambio de código)

1. **Tabla nueva `balance_run` en KRONOSDB** (mismo patrón que `payment_run`:
   fuera de Prisma, tabla de solo SQL — ver `lib/balances/runBalance.ts`):

   ```sql
   CREATE TABLE [dbo].[balance_run] (
     id                     INT IDENTITY(1,1) PRIMARY KEY,
     id_company             INT NOT NULL,
     triggered_by           NVARCHAR(255) NOT NULL,
     status                 NVARCHAR(20) NOT NULL, -- running | success | failed
     started_at             DATETIME NOT NULL,
     finished_at            DATETIME NULL,
     balance_duration_ms    INT NULL,
     acumulado_duration_ms  INT NULL,
     error_message          NVARCHAR(MAX) NULL
   );
   ```

2. **Variables de entorno nuevas** (front-kronos `.env`, por ambiente):

   ```
   BALANCES_SQL_SERVER=192.168.10.7
   BALANCES_SQL_DB=FARMA_IND_PROD
   BALANCES_SQL_USER=adminDesarrollo   # reutiliza el login ya creado para SAPSEND-GSS
   BALANCES_SQL_PASS=<misma clave que SQLADMIN_PASS de sapsend-gss/.env>
   ```

   Decisión pendiente de Nicolás: reutilizar `adminDesarrollo` tal cual, o
   crear un login dedicado a SynerLink (más aislado, un cambio de clave no
   afecta a SAPSEND-GSS).

3. **Alta del subproceso en KRONOSDB** para que el control de acceso
   (`lib/balances/access.ts`) deje de estar fail-closed para todos:

   ```sql
   INSERT INTO [dbo].[subprocess] (subprocess, id_process, subprocess_url)
   VALUES ('Balances', <id_process>, '/process/balances');
   -- luego, por cada (usuario, empresa) que deba ver el botón:
   INSERT INTO [dbo].[subprocess_user_company] (id_subprocess, id_company_user)
   VALUES (<id_subprocess nuevo>, <id_company_user de Nicolás x Farmalogica/OLP/GSS>);
   ```

   Sin estas filas el módulo queda invisible (no roto) para todos los
   usuarios — es intencional (fail-closed).

## Qué falta para Sprint 2

- Endpoint de estado en tiempo real (polling de `balance_run` cada pocos
  segundos, o llevar la ejecución a background + `run-status` al estilo
  `payment-assistant`).
- Deshabilitar el botón mientras hay una corrida en curso (hoy ya se
  deshabilita del lado del cliente, pero no hay bloqueo del lado servidor si
  llegan dos clics casi simultáneos — agregar un check de "ya hay una
  corrida `running` para esta empresa" antes de insertar una nueva fila).
