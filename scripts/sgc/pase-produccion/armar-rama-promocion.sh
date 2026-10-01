#!/usr/bin/env bash
# =============================================================================
# Arma la rama de PROMOCIÓN del SGC documental a `main` (patrón SGD: rama
# nacida de main + solo lo del SGC; nunca se promueve testing completo).
#
# Uso (en un clon limpio de front-kronos, con origin actualizado):
#   bash scripts/sgc/pase-produccion/armar-rama-promocion.sh <ref-testing> [rama]
#   p. ej.: bash scripts/sgc/pase-produccion/armar-rama-promocion.sh origin/testing promote/sgc-olp
#
# Qué hace (y deja un informe en reports/promocion-sgc.txt):
#   1. Crea la rama desde origin/main.
#   2. Retira el módulo documental viejo (#226/#228) que sigue en main y quita
#      el JOIN a document_version de view-activities (si no, el DROP de esas
#      tablas en producción rompe «Ver actividades»).
#   3. Trae de <ref-testing> TODO lo que es exclusivo del SGC (rutas, páginas,
#      componentes, librería, migraciones, SQL manuales, pruebas y scripts).
#   4. Aplica en los archivos COMPARTIDOS solo los cambios de los commits del
#      SGC (3 vías); los que no aplican limpio se listan para revisión manual.
#   5. Ajusta schema.prisma (esquemas dbo+sgc, @@schema en cada modelo, sin
#      los modelos Document*, con los modelos Sgc* y sus relaciones inversas),
#      package.json (dependencias del SGC con la versión de testing) y la
#      configuración de pruebas.
# No hace push ni toca servidores. Revisar el informe antes de abrir el PR.
# =============================================================================
set -euo pipefail
REF="${1:?Indique la ref de testing (p. ej. origin/testing)}"
BRANCH="${2:-promote/sgc-olp-$(date +%Y%m%d)}"
REPORT="reports/promocion-sgc.txt"

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then echo "El árbol tiene cambios: use un clon limpio."; exit 2; fi
git fetch -q origin main
git checkout -q -B "$BRANCH" origin/main
mkdir -p reports
: > "$REPORT"
log() { echo "$*" | tee -a "$REPORT"; }
log "Rama $BRANCH desde $(git rev-parse --short origin/main) con el SGC de $REF ($(git rev-parse --short "$REF"))"

# Commits del SGC en testing (por mensaje; todos llevan el prefijo (sgc)).
SGC_COMMITS=$(git log --reverse --no-merges --format=%H origin/main.."$REF" --grep='(sgc)')
log "Commits del SGC: $(echo "$SGC_COMMITS" | wc -l | tr -d ' ')"

# 2. Retiro del módulo viejo que sigue en main.
log "== Retiro del módulo documental viejo =="
git rm -q -r --ignore-unmatch 'app/(hub)/process/document-management' app/api/document-management lib/document-management \
  prisma/seeds/document-management-permisos.sql prisma/seeds/document-management-workflow.sql
git ls-files | grep -E 'document-management' | tee -a "$REPORT" || true

# 3. Rutas exclusivas del SGC: se toman tal cual de testing.
log "== Archivos exclusivos del SGC =="
SGC_PATHS=(lib/sgc app/api/sgc 'app/(hub)/process/sgc-documental' components/sgc e2e/sgc tests/integration/sgc scripts/sgc scripts/evidencia
  .github/workflows/sgc-e2e-pruebas.yml vitest.integration.config.mts playwright.config.ts)
for p in "${SGC_PATHS[@]}"; do git checkout "$REF" -- "$p"; done
for m in $(git ls-tree -d --name-only "$REF" prisma/migrations/ | grep -E '_sgc_'); do git checkout "$REF" -- "$m"; done
for f in $(git ls-tree --name-only "$REF" prisma/manual/ | grep -E 'sgc'); do git checkout "$REF" -- "$f"; done
log "$(git diff --cached --name-only | wc -l | tr -d ' ') archivos preparados hasta aquí"

# 4. Archivos compartidos: solo los cambios de los commits del SGC.
log "== Archivos compartidos (3 vías) =="
SHARED=(lib/chat/access.ts app/api/chat/access/route.ts lib/chat/attachmentStorage.ts lib/chat/attachments.ts
  lib/onedrive/graphFolderUpload.ts components/ui/FileUpload.tsx app/api/requests-general/view-activities/route.js
  lib/scheduler/handlers.js lib/request-general/dashboardRoutes.ts 'app/(hub)/process/administration/users/page.tsx'
  next.config.ts .gitignore eslint.config.mjs)
for f in "${SHARED[@]}"; do
  for c in $SGC_COMMITS; do
    if git show --format= --name-only "$c" | grep -qxF "$f"; then
      cp "$f" "$f.antes-sgc"
      if git format-patch -1 --stdout "$c" -- "$f" | git apply -3 --index >/dev/null 2>&1 && ! grep -q '^<<<<<<<' "$f"; then
        log "  OK      $f  ($(git log -1 --format=%h "$c"))"
      else
        # No aplicó limpio: se deja el archivo como estaba (sin marcas de conflicto) y se corrige abajo o a mano.
        mv -f "$f.antes-sgc" "$f"; git add "$f"
        log "  REVISAR $f  ($(git log -1 --format='%h %s' "$c"))"
      fi
      rm -f "$f.antes-sgc"
    fi
  done
done

# 4b. Correcciones puntuales conocidas (lo que no aplica limpio porque main difiere de testing).
log "== Correcciones puntuales =="
node - <<'NODE'
const fs = require('node:fs');
// view-activities: quitar el JOIN al módulo viejo (las tablas document* se borran en el pase).
const va = 'app/api/requests-general/view-activities/route.js';
let s = fs.readFileSync(va, 'utf8');
const before = s;
s = s.replace(/,\s*docmgmt\.id_document/g, '');
s = s.split('\n').filter((l) => !/LEFT JOIN document_version docver|LEFT JOIN document docmgmt/.test(l)).join('\n');
fs.writeFileSync(va, s);
console.log(`  ${va}: ${before === s ? 'sin cambios' : 'JOIN a document/document_version retirado'}`);
// eslint: ignorar reports/ (evidencia de pruebas).
const es = 'eslint.config.mjs';
let e = fs.readFileSync(es, 'utf8');
if (!e.includes("'reports/**'")) {
  e = e.replace("'coverage/**',", "'coverage/**',\n      'reports/**',");
  fs.writeFileSync(es, e);
  console.log(`  ${es}: reports/** ignorado`);
}
NODE
git add app/api/requests-general/view-activities/route.js eslint.config.mjs
# Vitest de main (vitest.config.ts): incluir también las pruebas de las rutas del SGC.
node -e "const fs=require('fs');const f=fs.existsSync('vitest.config.ts')?'vitest.config.ts':'vitest.config.mts';let s=fs.readFileSync(f,'utf8');if(!s.includes('app/api/sgc/**/*.test.ts')){s=s.replace(\"include: ['lib/**/*.test.ts']\",\"include: ['lib/**/*.test.ts', 'app/api/sgc/**/*.test.ts']\");fs.writeFileSync(f,s);console.log('  '+f+': pruebas de app/api/sgc incluidas')}"
git add vitest.config.ts 2>/dev/null || git add vitest.config.mts
if git grep -n -E 'docver|docmgmt' -- app/api/requests-general/view-activities/route.js; then log "  REVISAR: quedan referencias a document_version en view-activities"; fi

# 5a. package.json: dependencias del SGC con la versión exacta que usa testing.
log "== package.json =="
node - "$REF" <<'NODE'
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const ref = process.argv[2];
const test = JSON.parse(execSync(`git show ${ref}:package.json`, { encoding: 'utf8' }));
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const deps = ['@tiptap/extension-table', '@tiptap/extension-table-cell', '@tiptap/extension-table-header', '@tiptap/extension-table-row', '@tiptap/pm', '@tiptap/react', '@tiptap/starter-kit', '@xyflow/react', 'mammoth', 'puppeteer', 'qrcode-generator'];
const dev = ['@playwright/test'];
for (const d of deps) if (!pkg.dependencies[d]) pkg.dependencies[d] = test.dependencies[d];
for (const d of dev) if (!pkg.devDependencies[d]) pkg.devDependencies[d] = test.devDependencies[d];
for (const s of ['test:integration', 'test:e2e']) if (!pkg.scripts[s]) pkg.scripts[s] = test.scripts[s];
const sort = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
pkg.dependencies = sort(pkg.dependencies);
pkg.devDependencies = sort(pkg.devDependencies);
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
console.log('  dependencias agregadas:', [...deps, ...dev].join(', '));
NODE
git add package.json
log "  (después: npm install para regenerar package-lock.json y revisar que solo agregue paquetes)"

# 5b. schema.prisma
log "== schema.prisma =="
node scripts/sgc/pase-produccion/ajustar-schema-promocion.mjs "$REF" | tee -a "$REPORT"
git add prisma/schema.prisma

log ""
log "Siguiente: npm install && npx prisma validate && npx prisma generate && npx tsc --noEmit && npx vitest run lib/sgc app/api/sgc && npm run build"
log "y revisar a mano los archivos marcados REVISAR."
