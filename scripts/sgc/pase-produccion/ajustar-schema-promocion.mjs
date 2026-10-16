#!/usr/bin/env node
/**
 * Ajusta prisma/schema.prisma de la rama de PROMOCIÓN (nacida de main) para el
 * SGC documental, sin traer nada más de testing:
 *   - datasource con schemas = ["dbo", "sgc"] (multiSchema, GA en Prisma 6);
 *   - @@schema("dbo") en cada modelo/enum/vista de main que no lo tenga;
 *   - fuera los modelos del módulo documental viejo (Document*) y los campos
 *     que los referencian;
 *   - los modelos Sgc* de testing tal cual y las relaciones inversas que los
 *     modelos de dbo necesitan (Company, Department…).
 *
 * Uso: node scripts/sgc/pase-produccion/ajustar-schema-promocion.mjs <ref-testing>
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const ref = process.argv[2];
if (!ref) {
  console.error('Uso: node scripts/sgc/pase-produccion/ajustar-schema-promocion.mjs <ref-testing>');
  process.exit(2);
}
const FILE = 'prisma/schema.prisma';
const OLD = new Set(['DocumentType', 'Document', 'DocumentVersion', 'DocumentProcessCategory', 'DocumentProcessSubprocess']);
const main = fs.readFileSync(FILE, 'utf8');
const test = execSync(`git show ${ref}:${FILE}`, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const BLOCK = /^(model|enum|view) (\w+) \{[\s\S]*?^\}\n?/gm;
const blocksOf = (text) => [...text.matchAll(BLOCK)].map((m) => ({ kind: m[1], name: m[2], text: m[0], index: m.index }));

const testBlocks = blocksOf(test);
const sgcBlocks = testBlocks.filter((b) => /@@schema\("sgc"\)/.test(b.text));
const sgcNames = new Set(sgcBlocks.map((b) => b.name));

// Relaciones inversas hacia Sgc* que testing declara en modelos de dbo.
const inverse = new Map();
for (const b of testBlocks) {
  if (!/@@schema\("dbo"\)/.test(b.text)) continue;
  const lines = b.text.split('\n').filter((l) => /^\s+\w+\s+Sgc\w+/.test(l) && sgcNames.has(l.trim().split(/\s+/)[1].replace(/[?[\]]/g, '')));
  if (lines.length) inverse.set(b.name, lines);
}

let out = main;
// Datasource.
if (!/schemas\s*=/.test(out)) {
  out = out.replace(/(datasource db \{[\s\S]*?)(\n\})/, `$1\n  // Varios esquemas SQL: dbo (todo lo existente) y sgc (SGC documental aislado).\n  schemas           = ["dbo", "sgc"]$2`);
}
// Modelos viejos fuera y campos que los referencian.
let removed = [];
out = out.replace(BLOCK, (block, kind, name) => {
  if (OLD.has(name)) {
    removed.push(name);
    return '';
  }
  return block;
});
const fieldRefsOld = new RegExp(`^\\s+\\w+\\s+(${[...OLD].join('|')})(\\[\\]|\\?)?(\\s.*)?$\\n`, 'gm');
const refFields = out.match(fieldRefsOld) ?? [];
out = out.replace(fieldRefsOld, '');
// @@schema("dbo") donde falte; relaciones inversas hacia Sgc*.
let tagged = 0;
out = out.replace(BLOCK, (block, kind, name) => {
  let b = block;
  if (inverse.has(name)) {
    const add = inverse.get(name).filter((l) => !b.includes(l.trim()));
    if (add.length) b = b.replace(/\n\}\n?$/, `\n${add.join('\n')}\n}\n`);
  }
  if (!/@@schema\(/.test(b)) {
    b = b.replace(/\n\}\n?$/, `\n\n  @@schema("dbo")\n}\n`);
    tagged += 1;
  }
  return b;
});
// Modelos del SGC al final.
const already = new Set(blocksOf(out).map((b) => b.name));
const toAdd = sgcBlocks.filter((b) => !already.has(b.name));
out = `${out.trimEnd()}\n\n// ===========================================================================\n// SGC documental (esquema sgc) — traído de testing para la promoción.\n// ===========================================================================\n\n${toAdd.map((b) => b.text.trimEnd()).join('\n\n')}\n`;
fs.writeFileSync(FILE, out);
console.log(`  modelos viejos retirados: ${removed.join(', ') || 'ninguno'}`);
console.log(`  campos que los referenciaban: ${refFields.length}`);
console.log(`  @@schema("dbo") agregado a ${tagged} bloques`);
console.log(`  relaciones inversas agregadas en: ${[...inverse.keys()].join(', ') || 'ninguno'}`);
console.log(`  modelos Sgc* agregados: ${toAdd.length}`);
