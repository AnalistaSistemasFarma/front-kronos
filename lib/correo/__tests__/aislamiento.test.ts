import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Prueba de «lint» del control clave del módulo Correo: la app de Graph es de
 * APLICACIÓN (puede leer cualquier buzón del inquilino), así que SOLO
 * lib/correo/graph.ts (mailboxForSession) puede armar rutas /users/{buzón}, y
 * ninguna ruta de la API lee un buzón, usuario o UPN del navegador.
 */
const ROOT = path.resolve(__dirname, '../../..');
const CARPETAS = ['lib/correo', 'app/api/correo', 'components/correo', 'app/(hub)/process/correo'];

function archivos(dir: string): string[] {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((e) => {
    const rel = path.posix.join(dir, e.name);
    if (e.isDirectory()) return e.name === '__tests__' ? [] : archivos(rel);
    return /\.(ts|tsx|js|mjs)$/.test(e.name) && !/\.test\./.test(e.name) ? [rel] : [];
  });
}

const fuentes = CARPETAS.flatMap(archivos);
const leer = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8');

describe('Correo · aislamiento del buzón (revisión estática)', () => {
  it('hay fuentes que revisar', () => {
    expect(fuentes).toContain('lib/correo/graph.ts');
    expect(fuentes.length).toBeGreaterThan(20);
  });

  it('solo lib/correo/graph.ts arma rutas /users/ de Graph', () => {
    const conUsers = fuentes.filter((f) => /\/users\b|['"`]users\//.test(leer(f).replace(/^\s*(\*|\/\/).*$/gm, '')));
    expect(conUsers).toEqual(['lib/correo/graph.ts']);
    const g = leer('lib/correo/graph.ts');
    // Una sola construcción de URL, dentro de mailboxForSession (la otra mención es la VALIDACIÓN en urlDelBuzon).
    expect(g.match(/\/users\/\$\{encodeURIComponent/g)).toHaveLength(1);
    expect(g.match(/\/users\/\$\{/g)).toHaveLength(2);
    expect(g).toMatch(/const prefijo = `\/v1\.0\/users\/\$\{mailbox\.correo\}`;/);
    expect(g).toMatch(/export function mailboxForSession\(correoSesion: string\): Mailbox \{[\s\S]{0,400}\/users\/\$\{encodeURIComponent\(correo\)\}/);
  });

  it('solo graph.ts y constants.ts conocen graph.microsoft.com; nadie usa /me ni otra app', () => {
    const conGraph = fuentes.filter((f) => /graph\.microsoft\.com/.test(leer(f).replace(/^\s*(\*|\/\/).*$/gm, '')));
    expect(conGraph.sort()).toEqual(['lib/correo/constants.ts', 'lib/correo/graph.ts']);
    for (const f of fuentes) expect(leer(f), f).not.toMatch(/\/v1\.0\/me\b|GRAPH_ME/);
  });

  it('el proveedor de Graph solo se crea con mailboxForSession(acceso.email) — el correo de la SESIÓN', () => {
    const usos = fuentes.flatMap((f) => (leer(f).match(/new GraphMailProvider\([^)]*\)/g) ?? []).map((m) => `${f}: ${m}`));
    expect(usos).toEqual(['lib/correo/service.ts: new GraphMailProvider(mailboxForSession(acceso.email)']);
    const llamadas = fuentes.flatMap((f) => (leer(f).match(/mailboxForSession\([^)]*\)/g) ?? []).map((m) => `${f}: ${m}`));
    expect(llamadas.filter((x) => !x.includes('mailboxForSession(acceso.email)') && !x.startsWith('lib/correo/graph.ts'))).toEqual([]);
  });

  it('ninguna ruta de la API lee buzón, usuario, UPN o correo del navegador', () => {
    const rutas = fuentes.filter((f) => f.startsWith('app/api/correo/') && f.endsWith('route.ts'));
    expect(rutas.length).toBeGreaterThan(8);
    const prohibido = /(searchParams\.get|form\.get|body\??\.)\(?['"]?(mailbox|buzon|upn|usuario|userId|idUser|user|email|correo)['"]?/i;
    for (const r of rutas) expect(leer(r), r).not.toMatch(prohibido);
    // La identidad sale de la sesión en el contexto común.
    expect(leer('app/api/correo/_lib/context.ts')).toMatch(/getCorreoAccess\(prisma, email\)/);
    expect(leer('app/api/correo/_lib/context.ts')).toMatch(/const email = session\?\.user\?\.email/);
  });
});
