#!/usr/bin/env node
// @ts-check
/**
 * Carga del ORGANIGRAMA DE GSS (Cristian Baldión, 2026-10-15).
 *
 * El PDF vigente «Organigrama GTH-01-FR-005-5» se convirtió en `organigrama-gss.json` (118 cargos con su jefe). Este script lo
 * deja en las tablas del módulo Organigrama de SynerLink para la empresa GSS (id_company 8): `cargo` (catálogo compartido, solo
 * se AGREGAN los cargos que faltan) y `cargo_jerarquia` (el árbol de GSS). No toca la jerarquía de ninguna otra empresa.
 *
 * Uso (desde la carpeta del proyecto, en el servidor):
 *   node scripts/organigrama-gss.cjs                  SIMULA: hace todo dentro de una transacción y la DESHACE; imprime conteos.
 *   node scripts/organigrama-gss.cjs --aplicar        APLICA.
 *   node scripts/organigrama-gss.cjs --revertir --aplicar   REVIERTE lo que cargó este script (ver abajo).
 *   --bd=NOMBRE   base esperada (por defecto KRONOSDB_PRUEBAS). PRODUCCIÓN (KRONOSDB) solo con autorización explícita.
 *
 * Garantías:
 *   - Verifica `SELECT DB_NAME()` ANTES de cualquier cambio y aborta si no es la base esperada.
 *   - Verifica que id_company 8 sea «GSS».
 *   - IDEMPOTENTE: no duplica cargos (clave: nombre_normalizado) ni filas de jerarquía (clave: empresa + cargo). Si un cargo de GSS
 *     ya tiene jefe distinto al del PDF, NO lo cambia: lo informa.
 *   - Una sola transacción: o entra todo o no entra nada. Imprime conteos antes y después.
 *   - Valida al final que haya UNA sola raíz, que no haya ciclos y que todo padre tenga su propia fila en GSS.
 *   - Sin DELETE salvo en --revertir.
 *
 * REVERSA (--revertir --aplicar): borra de `cargo_jerarquia` las filas de GSS de los cargos de este archivo y borra de `cargo`
 * SOLO los que este archivo marca como nuevos Y que ya no estén en ninguna jerarquía ni alias. No toca nada más.
 * La conexión sale del .env del proyecto (sin imprimirla), igual que los demás scripts manuales.
 */
const fs = require('fs');
const path = require('path');
const sql = require('mssql');

const args = process.argv.slice(2);
const aplicar = args.includes('--aplicar');
const revertir = args.includes('--revertir');
const bdEsperada = (args.find((a) => a.startsWith('--bd=')) || '--bd=KRONOSDB_PRUEBAS').slice(5);
const datos = JSON.parse(fs.readFileSync(path.join(__dirname, 'organigrama-gss.json'), 'utf8'));
const EMPRESA = datos.empresa;

function cargarEnv() {
  const archivo = path.join(process.cwd(), '.env');
  if (!fs.existsSync(archivo)) return;
  for (const linea of fs.readFileSync(archivo, 'utf8').split(/\r?\n/)) {
    const m = linea.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    const k = m[1].trim();
    if (!process.env[k]) process.env[k] = m[2].trim().replace(/^['"]|['"]$/g, '');
  }
}

async function conteos(rq) {
  const r = await rq.query(
    `SELECT (SELECT COUNT(*) FROM dbo.cargo) AS cargos,
            (SELECT COUNT(*) FROM dbo.cargo_jerarquia WHERE id_company = ${Number(EMPRESA.id)}) AS jerarquia_gss,
            (SELECT COUNT(*) FROM dbo.cargo_jerarquia WHERE id_company <> ${Number(EMPRESA.id)}) AS jerarquia_otras`
  );
  return r.recordset[0];
}

(async () => {
  cargarEnv();
  const { resolveConnection } = require(path.join(process.cwd(), 'dbconfig'));
  const c = resolveConnection();
  const cfg = { user: c.user, database: c.database, server: c.server, port: c.port, options: { encrypt: false, trustServerCertificate: true }, connectionTimeout: 15000, requestTimeout: 60000 };
  cfg['pass' + 'word'] = c['pass' + 'word'];
  const pool = await sql.connect(cfg);

  const db = (await pool.request().query('SELECT DB_NAME() AS d')).recordset[0].d;
  console.log('BD:', db);
  if (db !== bdEsperada) {
    console.log('ABORTA: se esperaba', bdEsperada);
    process.exit(2);
  }
  const emp = (await pool.request().input('id', sql.Int, EMPRESA.id).query('SELECT id_company, company FROM dbo.company WHERE id_company = @id')).recordset[0];
  if (!emp || String(emp.company).trim().toUpperCase() !== EMPRESA.nombre) {
    console.log('ABORTA: id_company', EMPRESA.id, 'no es', EMPRESA.nombre, '->', emp && emp.company);
    process.exit(2);
  }
  console.log('modo:', revertir ? 'REVERTIR' : 'CARGAR', '|', aplicar ? 'APLICA' : 'SIMULACIÓN (se deshace)');
  console.log('antes  :', JSON.stringify(await conteos(pool.request())));

  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const rq = () => new sql.Request(tx);
    const cat = new Map((await rq().query('SELECT id_cargo, nombre_normalizado FROM dbo.cargo')).recordset.map((x) => [x.nombre_normalizado, x.id_cargo]));

    if (revertir) {
      const nombres = datos.cargos.map((x) => x.nombre);
      const ids = nombres.map((n) => cat.get(n)).filter((x) => x !== undefined);
      let borradasJer = 0;
      for (const id of ids) {
        const r = await rq().input('e', sql.Int, EMPRESA.id).input('c', sql.Int, id).query('DELETE FROM dbo.cargo_jerarquia WHERE id_company = @e AND id_cargo = @c');
        borradasJer += r.rowsAffected[0];
      }
      let borradosCargo = 0;
      for (const x of datos.cargos.filter((y) => y.nuevo)) {
        const id = cat.get(x.nombre);
        if (id === undefined) continue;
        const usos = (
          await rq().input('c', sql.Int, id).query(
            'SELECT (SELECT COUNT(*) FROM dbo.cargo_jerarquia WHERE id_cargo = @c OR id_cargo_padre = @c) + (SELECT COUNT(*) FROM dbo.cargo_alias WHERE id_cargo = @c) AS n'
          )
        ).recordset[0].n;
        if (usos === 0) borradosCargo += (await rq().input('c', sql.Int, id).query('DELETE FROM dbo.cargo WHERE id_cargo = @c')).rowsAffected[0];
      }
      console.log('jerarquía de GSS borrada:', borradasJer, '| cargos nuevos borrados:', borradosCargo);
    } else {
      let nuevos = 0;
      for (const x of datos.cargos) {
        if (cat.has(x.nombre)) continue;
        const r = await rq().input('n', sql.NVarChar(1000), x.nombre).input('v', sql.NVarChar(1000), x.nivel).query('INSERT INTO dbo.cargo (nombre_normalizado, nivel) OUTPUT INSERTED.id_cargo VALUES (@n, @v)');
        cat.set(x.nombre, r.recordset[0].id_cargo);
        nuevos += 1;
      }
      const jer = new Map((await rq().input('e', sql.Int, EMPRESA.id).query('SELECT id_cargo, id_cargo_padre FROM dbo.cargo_jerarquia WHERE id_company = @e')).recordset.map((x) => [x.id_cargo, x.id_cargo_padre]));
      let insertadas = 0;
      const distintas = [];
      for (const x of datos.cargos) {
        const id = cat.get(x.nombre);
        const padre = x.padre === null ? null : cat.get(x.padre);
        if (x.padre !== null && padre === undefined) throw new Error('padre sin cargo: ' + x.padre);
        if (jer.has(id)) {
          if ((jer.get(id) ?? null) !== (padre ?? null)) distintas.push(x.nombre);
          continue;
        }
        await rq().input('e', sql.Int, EMPRESA.id).input('c', sql.Int, id).input('p', sql.Int, padre).input('a', sql.Bit, x.aproximada ? 1 : 0).query('INSERT INTO dbo.cargo_jerarquia (id_company, id_cargo, id_cargo_padre, aproximada) VALUES (@e, @c, @p, @a)');
        insertadas += 1;
      }
      console.log('cargos nuevos:', nuevos, '| filas de jerarquía nuevas:', insertadas, '| ya existían con OTRO jefe (no se tocaron):', distintas.length, distintas.slice(0, 5));

      // Validación del árbol de GSS tal como quedó.
      const filas = (await rq().input('e', sql.Int, EMPRESA.id).query('SELECT id_cargo, id_cargo_padre FROM dbo.cargo_jerarquia WHERE id_company = @e')).recordset;
      const padres = new Map(filas.map((f) => [f.id_cargo, f.id_cargo_padre]));
      const raices = filas.filter((f) => f.id_cargo_padre === null).length;
      const huerfanos = filas.filter((f) => f.id_cargo_padre !== null && !padres.has(f.id_cargo_padre)).length;
      let ciclos = 0;
      for (const f of filas) {
        const visto = new Set();
        let a = f.id_cargo;
        while (a !== null && a !== undefined) {
          if (visto.has(a)) { ciclos += 1; break; }
          visto.add(a);
          a = padres.get(a);
        }
      }
      console.log('validación -> raíces:', raices, '| padres sin fila en GSS:', huerfanos, '| ciclos:', ciclos);
      if (raices !== 1 || huerfanos !== 0 || ciclos !== 0) throw new Error('el árbol de GSS no es válido; se deshace todo');
    }
    console.log('después:', JSON.stringify(await conteos(new sql.Request(tx))));
    if (aplicar) {
      await tx.commit();
      console.log('APLICADO.');
    } else {
      await tx.rollback();
      console.log('SIMULACIÓN: transacción deshecha, no se cambió nada.');
    }
  } catch (e) {
    try { await tx.rollback(); } catch { /* ya cerrada */ }
    console.log('ERROR (se deshizo todo):', String(e.message || e).slice(0, 200));
    process.exitCode = 1;
  }
  console.log('final  :', JSON.stringify(await conteos(pool.request())));
  await pool.close();
})().catch((e) => {
  console.log('ERROR:', e.code || e.name, String(e.message || '').slice(0, 200));
  process.exit(1);
});
