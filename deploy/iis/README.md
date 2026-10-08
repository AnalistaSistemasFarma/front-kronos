# Página "SynerLink se está actualizando" (IIS de producción)

IIS de serfarma05 publica SynerLink en `https://groupsharedservices.farmalogica.com:8445/`. El sitio se llama `groupsharedservices` y su carpeta es `C:\inetpub\wwwroot\GSS`. Con URL Rewrite y ARR hace de proxy hacia GSS-Front (PM2, `localhost:3003`). Esta carpeta guarda la configuración versionada de ese sitio.

| Archivo | Qué es |
|---|---|
| `web.config` | Configuración completa del sitio: la regla de proxy original más las capas de mantenimiento. |
| `_mantenimiento/index.html` | Página estática autocontenida. No usa recursos externos, se recarga cada 30 s y se adapta al celular. |
| `../../scripts/iis-setup-maintenance.ps1` | Instala o revierte la configuración en IIS. Es idempotente y deja respaldo. |
| `../../scripts/maintenance-on.ps1` / `maintenance-off.ps1` | Activan o quitan la página. Antes de quitarla, `off` verifica que la app responda 200. |

## Cómo funciona

1. **Mantenimiento planificado.** Mientras exista `C:\inetpub\wwwroot\GSS\mantenimiento.flag`, IIS responde a todo el público con **503** y `Retry-After: 120`, y muestra la página. La petición no llega a Node.
   - Siguen pasando a Node `/_mantenimiento/*`, `/api/health/*` y las peticiones desde el propio servidor (`127.0.0.1` y `::1`), para poder verificar la app antes de reabrir.
2. **Respaldo ante caída.** Si Node no responde, ARR genera un 502.3 e IIS muestra la **misma página**, conservando el código 502.
   - Los errores que devuelve la propia app (un 500 o un 503 con cuerpo) **pasan intactos**, gracias a `existingResponse="Auto"`.
3. Los agentes publican directo a `http://192.168.10.5:3003`, sin pasar por IIS, así que la página no los afecta.

> **Active y desactive siempre con los scripts, nunca a mano.** URL Rewrite guarda en caché, por URL, la evaluación de la condición de la bandera. Los scripts tocan el `web.config` para vaciar esa caché. Si alguien crea la bandera a mano, las URLs ya visitadas seguirán yendo a Node.

## Uso (en serfarma05, como administrador, desde el checkout de prod)

```bat
cd /d C:\Users\administrador.DFARUNIADM\projects\front-kronos
rem Instalar o actualizar la configuracion en IIS (una vez, y cada vez que cambie deploy/iis/)
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\iis-setup-maintenance.ps1 -WhatIf
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\iis-setup-maintenance.ps1
rem Ventana manual (por ejemplo, una dependencia nueva)
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\maintenance-on.ps1 -Motivo "npm install"
rem ... pm2 stop -> npm install / build -> pm2 start ...
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\maintenance-off.ps1
rem Reversa completa
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\iis-setup-maintenance.ps1 -Rollback
```

- `main.yml` activa la página **solo** en el camino de cambio de esquema, que es el que detiene las apps. Al final de **todo** deploy corre `maintenance-off.ps1` con `if: always()`: si la app responde 200 la quita, y si no, la deja.
- La reversa total también se puede hacer con `appcmd restore backup "antes-mantenimiento-<fecha>"`, más la copia del `web.config` que queda en `C:\inetpub\synerlink-mantenimiento-respaldos\<fecha>\`.

## Entorno de pruebas (.230)

`deploy-testing.yml` **no** usa esto. La URL de pruebas es un túnel trycloudflare que apunta directo a `localhost:3030`, sin pasar por IIS. El sitio IIS `rp-kronos-test` (:8450, `kronos-test.gsslatam.com`) existe en la .230 y sirve para probar la página. Su configuración es `testing/rp-kronos-test.web.config`:

```bat
cd /d C:\Users\nicolas.rivera\projects\front-kronos-test
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\iis-setup-maintenance.ps1 -SiteName rp-kronos-test -SitePath C:\inetpub\testrp\rp-kronos-test -HostName kronos-test.gsslatam.com -Port 8450 -WebConfigSource deploy\iis\testing\rp-kronos-test.web.config
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\maintenance-on.ps1  -SitePath C:\inetpub\testrp\rp-kronos-test
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\maintenance-off.ps1 -SitePath C:\inetpub\testrp\rp-kronos-test -HealthUrl http://localhost:3030/
```

El binding usa SNI, así que por IP no responde. Para probar desde otro equipo: `curl -sk --resolve kronos-test.gsslatam.com:8450:192.168.11.230 https://kronos-test.gsslatam.com:8450/`.

El diseño se validó el 2026-10-07 en un sitio IIS temporal de la .230, que se borró al terminar:

- 503 + `Retry-After` con la bandera;
- 502 con la página cuando Node está abajo;
- 500, 503 y 404 de la app intactos;
- la caché de URL Rewrite se vacía al activar y al desactivar, incluso en una conexión keep-alive;
- la reversa deja el sitio como estaba.
