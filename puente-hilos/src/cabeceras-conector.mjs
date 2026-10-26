#!/usr/bin/env node
/**
 * `headersHelper` de los conectores por proyecto (conectores.mjs). Lo ejecuta
 * Claude Code (el proceso del turno, fuera del sandbox de comandos) al conectar
 * un servidor MCP que lleva llave: imprime {"Authorization":"Bearer …"} en
 * stdout y nada más. La llave nunca pasa por el mcp.json del hilo ni por el
 * entorno del modelo, y el sandbox de los comandos niega leer el archivo.
 *
 * Uso: node cabeceras-conector.mjs <archivo de secretos 600> <llave>
 */
import { readFileSync, statSync } from 'node:fs';

const [ruta, llave] = process.argv.slice(2);
try {
  if (!ruta || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(llave ?? '')) throw new Error('uso inválido');
  if ((statSync(ruta).mode & 0o777) !== 0o600) throw new Error('el archivo de secretos debe ser 600');
  const valor = JSON.parse(readFileSync(ruta, 'utf8'))?.[llave];
  if (typeof valor !== 'string' || valor.length < 16) throw new Error(`no hay llave «${llave}»`);
  process.stdout.write(JSON.stringify({ Authorization: `Bearer ${valor.replace(/^Bearer\s+/i, '')}` }));
} catch (e) {
  // Sin la llave, el conector simplemente no conecta (falla cerrado). Nunca se imprime el contenido.
  process.stderr.write(`cabeceras-conector: ${e.message}\n`);
  process.exit(1);
}
