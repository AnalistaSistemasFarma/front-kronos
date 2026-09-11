/**
 * Pruebas de integración Orion ↔ SynerLink (sin escribir secrets en disco).
 * Uso: node scripts/test-orion-integration.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function loadEnv() {
  const envPath = path.join(root, '.env');
  if (!fs.existsSync(envPath)) throw new Error('No se encontró .env');
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    const key = m[1].trim();
    if (process.env[key] !== undefined) continue;
    process.env[key] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}

function mask(value) {
  if (!value) return '(vacío)';
  if (value.length <= 8) return '***';
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

async function requestJson(label, url, init) {
  console.log(`\n── ${label} ──`);
  console.log(`POST ${url}`);
  try {
    const res = await fetch(url, init);
    const text = await res.text();
    let body;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    console.log(`HTTP ${res.status} ${res.ok ? 'OK' : 'FAIL'}`);
    if (body && typeof body === 'object') {
      const safe = { ...body };
      console.log(JSON.stringify(safe, null, 2));
    } else if (body) {
      console.log(String(body).slice(0, 500));
    }
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    console.log(`ERROR: ${err instanceof Error ? err.message : err}`);
    return { ok: false, status: 0, body: null };
  }
}

async function main() {
  loadEnv();

  const orionBase = process.env.ORION_API_BASE_URL?.replace(/\/$/, '');
  const kronosBase = process.env.NEXTAUTH_URL?.replace(/\/$/, '');
  const key =
    process.env.ORION_INTEGRATION_API_KEY ||
    process.env.INTEGRATION_API_KEYS?.split(',')[0]?.trim();

  console.log('Configuración detectada:');
  console.log(`  ORION_API_BASE_URL = ${orionBase || '(no definido)'}`);
  console.log(`  NEXTAUTH_URL       = ${kronosBase || '(no definido)'}`);
  console.log(`  API key            = ${mask(key)}`);

  if (!orionBase || !key) {
    console.error('\nFaltan ORION_API_BASE_URL u ORION_INTEGRATION_API_KEY en .env');
    process.exit(1);
  }

  const headers = {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };

  const testRequestId = 9999;
  const createBody = {
    externalRef: `synerlink://request/${testRequestId}`,
    synerlinkRequestId: testRequestId,
    synerlinkCompanyId: 7,
    title: 'Prueba integración Kronos',
    createdByEmail: process.env.ORION_DEFAULT_CREATED_BY_EMAIL || 'admin@abc.com',
  };

  const orionResult = await requestJson(
    '1) Orion — crear documento',
    `${orionBase}/api/integrations/synerlink/documents`,
    { method: 'POST', headers, body: JSON.stringify(createBody) }
  );

  let orionDocId = orionResult.body?.orionDocumentId;
  if (orionResult.ok && orionResult.body?.embedUrl) {
    const embedHost = new URL(orionResult.body.embedUrl).hostname;
    console.log(`  embedUrl host: ${embedHost}`);
  }

  if (orionResult.ok && orionDocId) {
    await requestJson(
      '1b) Orion — consultar por externalRef',
      `${orionBase}/api/integrations/synerlink/documents/by-ref?externalRef=${encodeURIComponent(createBody.externalRef)}`,
      { method: 'GET', headers: { Authorization: headers.Authorization } }
    );
  }

  if (!kronosBase) {
    console.log('\n── 2) Kronos webhook — OMITIDO (NEXTAUTH_URL no definido) ──');
    process.exit(orionResult.ok ? 0 : 1);
  }

  const webhookBody = {
    orionDocumentId: orionDocId || 'test-uuid',
    externalRef: createBody.externalRef,
    synerlinkRequestId: testRequestId,
    status: 'FIRMADO',
    auditSummary: 'Prueba webhook desde scripts/test-orion-integration.mjs',
  };

  const kronosResult = await requestJson(
    '2) Kronos — webhook document-status',
    `${kronosBase}/api/integrations/orion/document-status`,
    { method: 'POST', headers, body: JSON.stringify(webhookBody) }
  );

  console.log('\n── Resumen ──');
  console.log(`Orion API:      ${orionResult.ok ? 'PASS' : 'FAIL'} (${orionResult.status})`);
  console.log(`Kronos webhook: ${kronosResult.ok ? 'PASS' : 'FAIL'} (${kronosResult.status})`);
  if (kronosResult.status === 404) {
    console.log('  Nota: 404 webhook = solicitud #9999 no existe. Ejecuta npm run seed:orion y crea una solicitud real.');
  }
  if (!orionResult.ok) {
    console.log('  Revisa: Orion corriendo, API key, ORION_DEFAULT_CREATED_BY_EMAIL en Orion.');
  }
  console.log('\nHealth Kronos: GET /api/integrations/orion/health');
  console.log('Seed proceso:  npm run seed:orion -- --email=tu@correo.com');

  process.exit(orionResult.ok && (kronosResult.ok || kronosResult.status === 404) ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
