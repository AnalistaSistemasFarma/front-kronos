#!/usr/bin/env node
/**
 * Descarga la base GRATUITA de geolocalización de DB-IP («IP to City Lite» o
 * «IP to Country Lite», formato .mmdb, licencia CC BY 4.0, sin registro) para la
 * auditoría de inicios de sesión (lib/auth/login-audit/geo.ts).
 *
 * Esta descarga es lo ÚNICO que sale a internet: la app nunca envía IP a nadie,
 * consulta este archivo en el disco del servidor.
 *
 * Uso:
 *   node scripts/geoip/descargar-dbip.mjs                 # ciudades (≈130 MB en disco y en RAM)
 *   node scripts/geoip/descargar-dbip.mjs --tipo pais     # solo países (≈8 MB)
 *   node scripts/geoip/descargar-dbip.mjs --destino C:\synerlink-data\geoip\dbip-city-lite.mmdb
 *
 * Destino por defecto: LOGIN_GEOIP_DB_PATH o ./data/geoip/dbip-city-lite.mmdb
 * (data/geoip/ está en .gitignore). Se escribe a un temporal y se renombra al final:
 * la app nunca lee un archivo a medias. DB-IP publica una base nueva cada mes; si la
 * del mes aún no está, se usa la del mes anterior.
 *
 * Recomendado: guardar FUERA del checkout (p. ej. C:\synerlink-data\geoip\) y
 * apuntar LOGIN_GEOIP_DB_PATH ahí, para que un deploy/limpieza no la borre.
 */
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';

const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const tipo = arg('--tipo') === 'pais' ? 'country' : 'city';
const destino = path.resolve(
  arg('--destino') ||
    process.env.LOGIN_GEOIP_DB_PATH ||
    path.join(process.cwd(), 'data', 'geoip', tipo === 'city' ? 'dbip-city-lite.mmdb' : 'dbip-country-lite.mmdb')
);

function mes(offset) {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - offset);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function descargar(url, tmp) {
  const res = await fetch(url);
  if (!res.ok || !res.body) return false;
  await pipeline(Readable.fromWeb(res.body), createGunzip(), createWriteStream(tmp));
  return true;
}

await mkdir(path.dirname(destino), { recursive: true });
const tmp = `${destino}.descargando`;

let ok = false;
for (const offset of [0, 1]) {
  const url = `https://download.db-ip.com/free/dbip-${tipo}-lite-${mes(offset)}.mmdb.gz`;
  console.log(`Descargando ${url} …`);
  try {
    ok = await descargar(url, tmp);
  } catch (error) {
    console.warn(`  falló: ${error instanceof Error ? error.message : error}`);
    ok = false;
  }
  if (ok) break;
}

if (!ok) {
  await rm(tmp, { force: true });
  console.error('No se pudo descargar la base de DB-IP. La app sigue funcionando, sin país.');
  process.exit(1);
}

const { size } = await stat(tmp);
if (size < 1_000_000) {
  await rm(tmp, { force: true });
  console.error(`El archivo descargado es demasiado pequeño (${size} bytes): se descarta.`);
  process.exit(1);
}

await rename(tmp, destino);
console.log(`Listo: ${destino} (${(size / 1024 / 1024).toFixed(1)} MB). La app la recarga sola en menos de 1 hora.`);
