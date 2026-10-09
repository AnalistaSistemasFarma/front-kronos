#!/usr/bin/env python3
"""
Genera el bloque de SIEMBRA del formulario SST-01-FR-001 dentro de la
migración 20261008160000_portal_formacion_formulario_propio a partir de
lib/portal/formularios/sst-01-fr-001.json (fuente única de la definición).

  python3 scripts/portal-th/generar-sql-formulario-sst.py

Reemplaza lo que hay entre las marcas `-- <SIEMBRA-SST>` y `-- </SIEMBRA-SST>`.
La prueba lib/portal/__tests__/formulario-siembra.test.ts falla si la
migración y el JSON no coinciden.
"""
import json, pathlib, re

RAIZ = pathlib.Path(__file__).resolve().parents[2]
JSON = RAIZ / 'lib/portal/formularios/sst-01-fr-001.json'
SQL = RAIZ / 'prisma/migrations/20261008160000_portal_formacion_formulario_propio/migration.sql'

d = json.loads(JSON.read_text(encoding='utf-8'))
compacto = json.dumps(d, ensure_ascii=False, separators=(',', ':')).replace("'", "''")
# Trozos de 3.000 caracteres concatenados como NVARCHAR(MAX): una sola cadena
# literal muy larga es incómoda de revisar y algunos clientes la cortan.
trozos = [compacto[i:i + 3000] for i in range(0, len(compacto), 3000)]
expr = '\n    + '.join(f"CAST(N'{t}' AS NVARCHAR(MAX))" for t in trozos)
titulo = d['titulo'].replace("'", "''")
codigo = d['codigo'].replace("'", "''")

bloque = f"""-- <SIEMBRA-SST>
-- Generado por scripts/portal-th/generar-sql-formulario-sst.py desde
-- lib/portal/formularios/sst-01-fr-001.json. No editar a mano.
IF NOT EXISTS (SELECT 1 FROM [dbo].[portal_formulario] WHERE [codigo] = N'{codigo}')
BEGIN
  DECLARE @definicion NVARCHAR(MAX) =
    {expr};
  DECLARE @formulario TABLE ([id] INT);
  INSERT INTO [dbo].[portal_formulario] ([codigo], [titulo], [version_actual], [created_by])
    OUTPUT INSERTED.[id] INTO @formulario
    VALUES (N'{codigo}', N'{titulo}', 1, N'migracion-20261008160000');
  INSERT INTO [dbo].[portal_formulario_version] ([formulario_id], [version], [definicion], [created_by])
    SELECT [id], 1, @definicion, N'migracion-20261008160000' FROM @formulario;
END
-- </SIEMBRA-SST>"""

texto = SQL.read_text(encoding='utf-8')
nuevo, n = re.subn(r'-- <SIEMBRA-SST>.*?-- </SIEMBRA-SST>', lambda _: bloque, texto, flags=re.S)
if n != 1:
    raise SystemExit('No se encontraron las marcas <SIEMBRA-SST> en la migración.')
SQL.write_text(nuevo, encoding='utf-8')
print(f'Siembra actualizada ({len(compacto)} caracteres, {len(trozos)} trozos).')
