/**
 * Espera a que Windows libere el motor de consultas de Prisma antes de
 * regenerar el cliente.
 *
 * -------------------------------------------------------------------------
 * POR QUÉ EXISTE ESTE ARCHIVO
 * -------------------------------------------------------------------------
 * El pase a producción del 2026-09-08 se cayó a mitad de camino con esto:
 *
 *   EPERM: operation not permitted, rename
 *   'query_engine-windows.dll.node.tmp40516' -> 'query_engine-windows.dll.node'
 *
 * `pm2 stop` DEVUELVE EL CONTROL ANTES de que el sistema operativo libere las
 * bibliotecas que los procesos tenían abiertas. El workflow corría
 * `npx prisma generate` medio segundo después del stop, y ese medio segundo
 * alcanzaba para que el archivo siguiera tomado. Como el paso falló, los pasos
 * de compilar y de arrancar se saltaron: **el servicio quedó abajo sin nada
 * nuevo puesto**. Seis minutos de caída en vez de cuatro, y una recuperación a
 * mano.
 *
 * La comprobación no es "esperar N segundos y cruzar los dedos": se intenta
 * RENOMBRAR el archivo y devolverlo a su nombre. Ese es exactamente el paso que
 * le falla a Prisma, así que si aquí funciona, allá también. Un `sleep` fijo
 * sería más lento en el caso bueno y seguiría fallando en el malo.
 *
 * Uso:
 *   node scripts/esperar-motor-prisma.cjs [intentos] [msEntreIntentos]
 *
 * Sale con 0 cuando el archivo está libre (o cuando no existe todavía, que es
 * el caso de una instalación nueva). Sale con 0 TAMBIÉN al agotar los
 * intentos, dejando una advertencia: si de verdad quedó bloqueado, quien tiene
 * que fallar —y decir por qué— es `prisma generate`, no este ayudante.
 */
const fs = require('fs');
const path = require('path');

const MOTOR = path.join('app', 'generated', 'prisma', 'query_engine-windows.dll.node');

const intentos = Number.parseInt(process.argv[2] ?? '20', 10) || 20;
const espera = Number.parseInt(process.argv[3] ?? '500', 10) || 500;

/** ¿Se puede renombrar? Es la operación que hace Prisma al final de generate. */
function estaLibre(archivo) {
  const temporal = `${archivo}.sonda`;
  try {
    fs.renameSync(archivo, temporal);
    fs.renameSync(temporal, archivo);
    return true;
  } catch {
    // Si la sonda quedó a medio camino, se devuelve el nombre para no dejar el
    // cliente roto por haber intentado comprobarlo.
    try {
      if (fs.existsSync(temporal)) fs.renameSync(temporal, archivo);
    } catch {
      /* nada que hacer: lo reportará prisma generate */
    }
    return false;
  }
}

function dormir(ms) {
  // Bloqueante a propósito: este script es un paso de un workflow, no un
  // servidor, y así no hace falta async/await ni dependencias.
  const hasta = Date.now() + ms;
  while (Date.now() < hasta) {
    /* espera activa corta */
  }
}

if (!fs.existsSync(MOTOR)) {
  console.log(`[esperar-motor-prisma] no existe ${MOTOR} todavía: nada que esperar.`);
  process.exit(0);
}

for (let i = 1; i <= intentos; i++) {
  if (estaLibre(MOTOR)) {
    console.log(
      `[esperar-motor-prisma] el motor quedó libre en el intento ${i} de ${intentos}.`
    );
    process.exit(0);
  }
  console.log(`[esperar-motor-prisma] todavía bloqueado (intento ${i} de ${intentos})…`);
  dormir(espera);
}

console.warn(
  `[esperar-motor-prisma] ADVERTENCIA: sigue bloqueado después de ${intentos} intentos ` +
    `(${(intentos * espera) / 1000} s). Se continúa: si de verdad está tomado, ` +
    'prisma generate lo dirá con su propio error.'
);
process.exit(0);
