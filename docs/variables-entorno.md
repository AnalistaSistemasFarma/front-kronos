# Variables de entorno por módulo (solo nombres)

Este documento lista los **nombres** de las variables de entorno que exigen algunos módulos de SynerLink (front-kronos). Los valores son secretos o dependen del entorno, así que **nunca** se suben al repositorio: viven en el `.env` de cada servidor.

Se creó el 2026-10-08, después de que la restauración de serfarma05 al respaldo del 2026-09-07 borrara estas variables del `.env` de producción sin que nadie lo notara.

## Firma Orion

- `ORION_API_BASE_URL`: URL base de la API de Orion.
- `ORION_EMBED_ORIGIN`: origen permitido para el embebido de Orion.
- `ORION_TENANT_MAP`: mapa JSON de id de empresa de SynerLink a tenant de Orion.
- `ORION_INTEGRATION_API_KEY`
- `ORION_DEFAULT_CREATED_BY_EMAIL`

Si faltan, la integración queda apagada (`enabled=false`).

## Portal TH: Formación en SharePoint

- `PORTAL_TH_SP_TENANT_ID`
- `PORTAL_TH_SP_CLIENT_ID`
- `PORTAL_TH_SP_CLIENT_SECRET`
- `PORTAL_TH_SP_SITE_ID`
- `PORTAL_TH_SP_FOLDER`

## Balances

- `BALANCES_SQL_SERVER`
- `BALANCES_SQL_DB`
- `BALANCES_SQL_USER`
- `BALANCES_SQL_PASS`

## Inventario de agentes

- `AGENT_INVENTORY_COLLECTOR_KEY`: llave del recolector, de al menos 32 caracteres.

## Otros

- `FARMADOSIS_COMPANY_ID`
- `NEXT_PUBLIC_PUSH_ENABLED`: se incrusta en el build, así que un cambio exige `npm run build`.

## Cómo comprobarlo

Antes y después de cada restauración o pase a producción, compare el `.env` del servidor contra esta lista **por nombre**, sin imprimir los valores.
