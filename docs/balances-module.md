# Módulo de Balances

Migra el botón "Ejecutar balances" de SAPSEND-GSS a SynerLink. Contexto
completo en la bitácora del proyecto del 2026-09-21.

## Alcance habilitado actualmente

- **Farmalogica únicamente** (`id_company = 1`). El botón ejecuta el balance y
  el balance acumulado de Farmalogica de forma asíncrona.
- **OLP** (`id_company = 3`) y **GSS** (`id_company = 8`) conservan su SQL
  histórico versionado, pero están bloqueadas explícitamente en
  `lib/balances/companies.ts`. Una fila anticipada de permisos en KRONOSDB no
  puede activarlas por accidente.
- Ryan, Abamia, Kelab y Meditrack siguen fuera del módulo: el job original no
  contiene SQL de balance validado para esas compañías. Elaborar y validar ese
  SQL es un sprint operativo independiente, no un cambio de configuración.

La activación de Farmalogica tiene tres capas acumulativas:

1. `enabled: true` en la configuración versionada.
2. Permiso del usuario en `subprocess_user_company` para `/process/balances` y
   `id_company = 1`.
3. Variables `BALANCES_SQL_*` presentes en el `.env` de PRUEBAS. El endpoint
   las verifica **antes** de crear una fila `running`, así evita una corrida
   huérfana que falle por configuración incompleta.

## Ejecución y seguridad

- El endpoint registra la corrida, responde `202` y ejecuta el SQL en segundo
  plano. La interfaz consulta `balance_run` cada 2 segundos mientras ve una
  corrida activa.
- El candado es **global**, no por compañía: existe como máximo una fila
  `running` en toda la tabla. El `INSERT ... WHERE NOT EXISTS` usa
  `TABLOCKX`/`HOLDLOCK`, de modo que dos clics simultáneos no pueden iniciar
  dos SQL pesados contra el 10.7.
- Los SQL (`lib/balances/sql/*.sql`) se extrajeron del job compartido
  `Balance_Empresas` / `Balance_Acumulado_Empresas` en serfarma07
  (192.168.10.7) el 2026-09-21. Se ejecutan directo contra `FARMA_IND_PROD`,
  sin `sp_start_job`; el job compartido no se modifica.
- El SQL lee las tablas SAP Business One de `FARMALOGICA_PROD`, pero no las
  modifica. Su escritura queda limitada a las tablas históricas
  `Farma_Balance_2026` y `Farma_Balance_Acumulado_2026` en `FARMA_IND_PROD`,
  y solo ocurre cuando un usuario autorizado pulsa el botón.

## Requisitos para activar Farmalogica en PRUEBAS

Los siguientes pasos son operativos y **no los ejecuta el código ni este
cambio**:

1. Aplicar una vez la migración ya versionada
   `prisma/migrations/20260921210500_add_balance_run/migration.sql` sobre
   **KRONOSDB_PRUEBAS**. No aplicar nada en producción.
2. En el `.env` no versionado del runner `.230`
   (`C:\Users\nicolas.rivera\projects\front-kronos-test\.env`), configurar:

   ```dotenv
   BALANCES_SQL_SERVER=192.168.10.7
   BALANCES_SQL_DB=FARMA_IND_PROD
   BALANCES_SQL_USER=<login autorizado de PRUEBAS>
   BALANCES_SQL_PASS=<secreto del login>
   ```

   No reutilizar ni copiar secretos a Git. El login debe recibir únicamente los
   permisos SQL que exigen las dos sentencias de Farmalogica.
3. En **KRONOSDB_PRUEBAS**, crear o reutilizar el subproceso
   `/process/balances` y asignarlo solo al usuario autorizado para
   Farmalogica (`id_company = 1`). No conceder OLP ni GSS en esta salida.
4. Fusionar el código aprobado a `testing`. El flujo `Deploy a PRUEBAS (.230)`
   hace `fetch/reset` de `origin/testing`, conserva `.env`, ejecuta
   `npm ci`, `prisma generate`, build y reinicia exclusivamente
   `GSS-Front-TEST` y `kronos-mcp-test`.
5. Iniciar sesión con el usuario autorizado, abrir `/process/balances` y
   comprobar que solo aparece Farmalogica. La primera ejecución real requiere
   autorización operativa explícita porque ejecuta las sentencias pesadas
   contra el 10.7.

## Trabajo pendiente por sprint

### Recuperación segura de corridas huérfanas

Una caída o reinicio del proceso web después de crear una fila `running` puede
mantener el candado global. No se debe resolver con un vencimiento arbitrario:
una consulta acumulada legítima podría durar más que el plazo elegido y abrir
la puerta a una segunda ejecución concurrente.

Antes de automatizar la recuperación se requiere un diseño aprobado de
lease/heartbeat, su DDL y una rutina de reconciliación. Hasta entonces, un
operador debe revisar cualquier fila `running` persistente y decidir la
recuperación de forma controlada.

### Otras compañías

OLP y GSS requieren activar su configuración, permisos y validación operativa
por separado antes de cambiar su interruptor `enabled`. Ryan, Abamia, Kelab y
Meditrack requieren primero SQL de balance validado y pruebas aisladas.
