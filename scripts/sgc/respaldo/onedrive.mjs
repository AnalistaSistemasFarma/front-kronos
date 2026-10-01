#!/usr/bin/env node
/**
 * RESPALDO y prueba de RESTAURACIÓN de los ARCHIVOS del SGC en OneDrive
 * (SGC/<EMPRESA>/...: PDF controlados, Word fuente, adjuntos de solicitudes,
 * evidencias de firma y Excel de capacitación) — Sprint 6.
 *
 * Parte de un respaldo lógico de la base (respaldar.mjs): toma de allí cada
 * archivo que el SGC registró, lo descarga de OneDrive por su id, calcula su
 * SHA-256 y lo compara con la huella registrada en la base. Deja la copia y un
 * manifiesto (archivo, ruta, tamaño, huella esperada y obtenida).
 *
 * Con --restaurar-en <carpeta> sube la copia a esa carpeta de OneDrive (misma
 * estructura de rutas), la vuelve a descargar y verifica la huella; con
 * --borrar-despues elimina esa carpeta de prueba al terminar.
 *
 * La recuperación preferida de OneDrive/SharePoint es su papelera y su
 * historial de versiones (conservan el id del archivo). Esta copia es el
 * último recurso: un archivo restaurado aquí queda con un id NUEVO y
 * re-apuntarlo en la base es un cambio controlado (ver el procedimiento).
 *
 * Uso: node scripts/sgc/respaldo/onedrive.mjs --from <respaldo> --out <carpeta> [--restaurar-en SGC-RESTAURACION-PRUEBA/<fecha>] [--borrar-despues]
 * Lee MICROSOFTTENANTID, MICROSOFTCLIENTID, MICROSOFTCLIENTSECRET y
 * MICROSOFTGRAPHUSERROUTE del entorno o del .env (ENVFILE). No imprime secretos.
 */
import fs from 'node:fs';
import path from 'node:path';
import { sha256Hex } from './lib.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
}
const from = arg('from');
const out = arg('out');
const restoreTo = arg('restaurar-en');
const deleteAfter = process.argv.includes('--borrar-despues');
if (!from || !out) {
  console.error('Uso: node scripts/sgc/respaldo/onedrive.mjs --from <respaldo> --out <carpeta> [--restaurar-en <carpeta OneDrive>] [--borrar-despues]');
  process.exit(2);
}
if (restoreTo && !/^SGC-RESTAURACION-PRUEBA\//.test(restoreTo) && !process.argv.includes('--confirmo-restaurar-en-otra-carpeta')) {
  console.error('Por seguridad, la prueba de restauración solo escribe bajo «SGC-RESTAURACION-PRUEBA/...».');
  process.exit(2);
}

let envText = null;
function envValue(name) {
  if (process.env[name]) return process.env[name];
  // Se lee una sola vez (ENVFILE puede ser un flujo, p. ej. <(ssh ...), que no se relee).
  envText ??= fs.readFileSync(process.env.ENVFILE || '.env', 'utf8').replace(/^﻿/, '');
  const text = envText;
  const m = text.match(new RegExp(`^${name}\\s*=\\s*"?([^"\\r\\n]+)"?`, 'm'));
  return m ? m[1] : '';
}

const table = (name) => JSON.parse(fs.readFileSync(path.join(from, 'tablas', `${name}.json`), 'utf8')).filas;
const refs = [];
for (const v of table('document_version')) {
  refs.push({ origen: `document_version:${v.id_document_version}:pdf`, itemId: v.pdf_item_id, ruta: v.pdf_path, sha256: String(v.pdf_sha256).trim() });
  if (v.source_item_id) refs.push({ origen: `document_version:${v.id_document_version}:fuente`, itemId: v.source_item_id, ruta: v.source_path, sha256: null });
}
for (const a of table('attachment')) refs.push({ origen: `attachment:${a.id_attachment}`, itemId: a.item_id, ruta: a.storage_path, sha256: String(a.sha256).trim() });
for (const s of table('signature')) refs.push({ origen: `signature:${s.id_signature}`, itemId: s.evidence_item_id, ruta: s.evidence_path, sha256: String(s.evidence_sha256).trim() });
for (const t of table('training_upload')) refs.push({ origen: `training_upload:${t.id_training_upload}`, itemId: t.item_id, ruta: t.storage_path, sha256: String(t.sha256).trim() });

const tenant = envValue('MICROSOFTTENANTID');
const tokenRes = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
  method: 'POST',
  body: new URLSearchParams({ client_id: envValue('MICROSOFTCLIENTID'), client_secret: envValue('MICROSOFTCLIENTSECRET'), scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }),
});
if (!tokenRes.ok) throw new Error(`No se obtuvo el token de Microsoft Graph (${tokenRes.status})`);
const token = (await tokenRes.json()).access_token;
const base = envValue('MICROSOFTGRAPHUSERROUTE');
const auth = { Authorization: `Bearer ${token}` };

async function download(itemId) {
  const r = await fetch(`${base}items/${encodeURIComponent(itemId)}/content`, { headers: auth });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

const encPath = (p) => p.split('/').map(encodeURIComponent).join('/');
async function upload(relPath, bytes) {
  if (bytes.length <= 4 * 1024 * 1024) {
    const r = await fetch(`${base}root:/${encPath(relPath)}:/content`, { method: 'PUT', headers: { ...auth, 'Content-Type': 'application/octet-stream' }, body: bytes });
    if (!r.ok) throw new Error(`subida HTTP ${r.status}`);
    return (await r.json()).id;
  }
  const s = await fetch(`${base}root:/${encPath(relPath)}:/createUploadSession`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } }) });
  if (!s.ok) throw new Error(`sesión de subida HTTP ${s.status}`);
  const { uploadUrl } = await s.json();
  const chunk = 5 * 320 * 1024;
  let last = null;
  for (let i = 0; i < bytes.length; i += chunk) {
    const part = bytes.slice(i, i + chunk);
    last = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Length': String(part.length), 'Content-Range': `bytes ${i}-${i + part.length - 1}/${bytes.length}` }, body: part });
    if (!last.ok && last.status !== 202) throw new Error(`fragmento HTTP ${last.status}`);
  }
  return (await last.json()).id;
}

fs.mkdirSync(out, { recursive: true });
const results = [];
for (const ref of refs) {
  const entry = { ...ref, tamano: null, sha256_obtenido: null, coincide: null, error: null, restaurado: null };
  try {
    const bytes = await download(ref.itemId);
    entry.tamano = bytes.length;
    entry.sha256_obtenido = sha256Hex(bytes);
    entry.coincide = ref.sha256 ? entry.sha256_obtenido === ref.sha256 : null;
    const local = path.join(out, 'archivos', ...String(ref.ruta).split('/').filter((x) => x && x !== '..'));
    fs.mkdirSync(path.dirname(local), { recursive: true });
    fs.writeFileSync(local, bytes);
    if (restoreTo) {
      const newId = await upload(`${restoreTo}/${ref.ruta}`, bytes);
      const back = await download(newId);
      entry.restaurado = { itemId: newId, coincide: sha256Hex(back) === entry.sha256_obtenido };
    }
  } catch (e) {
    entry.error = e.message;
  }
  results.push(entry);
}

/**
 * Borra la carpeta de prueba DE ABAJO HACIA ARRIBA: el OneDrive tiene una
 * política de retención que impide borrar de una vez una carpeta con archivos
 * (403 «on hold»); archivo por archivo sí se puede (la retención guarda copia).
 */
async function deleteTree(itemId) {
  let n = 0;
  const r = await fetch(`${base}items/${encodeURIComponent(itemId)}/children?$top=200&$select=id,folder`, { headers: auth });
  if (r.ok) {
    for (const it of (await r.json()).value ?? []) {
      if (it.folder) n += await deleteTree(it.id);
      else if ((await fetch(`${base}items/${encodeURIComponent(it.id)}`, { method: 'DELETE', headers: auth })).status === 204) n += 1;
    }
  }
  await fetch(`${base}items/${encodeURIComponent(itemId)}`, { method: 'DELETE', headers: auth });
  return n;
}

let deleted = null;
if (restoreTo && deleteAfter) {
  const top = restoreTo.split('/').slice(0, 2).join('/');
  const head = await fetch(`${base}root:/${encPath(top)}`, { headers: auth });
  const files = head.ok ? await deleteTree((await head.json()).id) : 0;
  const after = await fetch(`${base}root:/${encPath(top)}`, { headers: auth });
  deleted = { carpeta: top, archivos_borrados: files, queda: after.status !== 404 };
}

const summary = {
  fecha_utc: new Date().toISOString(),
  respaldo_base: path.resolve(from),
  archivos: results.length,
  descargados: results.filter((r) => !r.error).length,
  con_huella: results.filter((r) => r.sha256).length,
  huella_coincide: results.filter((r) => r.coincide === true).length,
  huella_no_coincide: results.filter((r) => r.coincide === false).map((r) => r.origen),
  errores: results.filter((r) => r.error).map((r) => ({ origen: r.origen, error: r.error })),
  restaurados: restoreTo ? { carpeta: restoreTo, verificados: results.filter((r) => r.restaurado?.coincide).length, limpieza: deleted } : null,
  bytes: results.reduce((a, r) => a + (r.tamano ?? 0), 0),
};
fs.writeFileSync(path.join(out, 'manifiesto-onedrive.json'), JSON.stringify({ resumen: summary, archivos: results }, null, 2));
console.log(JSON.stringify(summary, null, 2));
if (summary.errores.length || summary.huella_no_coincide.length || (restoreTo && summary.restaurados.verificados !== results.length)) process.exitCode = 1;
