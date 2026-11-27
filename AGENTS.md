# AGENTS.md

Rules for people and AI agents that change this repository (front-kronos, `mcp/`, `puente-hilos/`).

## Language of code (mandatory, 2026-11-27)

Rule from Nicolás Rivera (SynerLink conversation 1, message 41712): nothing in the database or in the code is in Spanish. Only user-facing UI text is in Spanish.

| Item | Language |
|---|---|
| Identifiers: variables, functions, types, components, constants, object keys, JSON fields between our own modules | English |
| File and folder names (including new routes under `app/`) | English |
| Comments and JSDoc | English |
| Commit messages, PR titles and PR descriptions | English |
| SQL scripts: file names, comments, and every new DB object (table, column, index, constraint, view, procedure, synonym) | English |
| Prisma: new models and fields, `@map` / `@@map` names | English |
| UI text the user reads (labels, toasts, errors shown on screen, emails, PDF text, agent prompts written for people) | Spanish |

Notes:

- **Legacy names stay until they are migrated.** You may use an existing Spanish name (a DB column, a Prisma field, an exported function), but do not declare new ones. Do not copy a Spanish name into a new variable or key: map it at the boundary (`const dueDate = row.fecha_vencimiento`).
- **No mixed renames of contracts in a feature PR.** Renaming a DB column, an env var, an API route, an MCP tool field or a JSON field that an agent reads is a migration: it goes in its own PR with a compatibility path. See `~/brain/migrar-agente-synerlink/traspasos/ingles-codigo-bd-20261127/PLAN.md`.
- **SQL script names for new changes**: `YYYY-MM-DD-<topic-in-english>-TEST.sql`, `-PROD.sql`, `-rollback.sql` in `prisma/manual/`. Older scripts keep their names (`-PRUEBAS`, `-reversa`).
- Quoted examples of Spanish user input in a comment are fine: `// parses «la línea 2 es X»`.

### CI guard

The `english-only` job in `.github/workflows/ci.yml` runs on every PR:

```bash
node scripts/ci/check-english-identifiers.mjs --base origin/testing   # lines added by your branch
node scripts/ci/check-english-identifiers.mjs --text "<PR title>" --label "PR title"
node scripts/ci/check-english-identifiers.mjs --inventory              # count of legacy Spanish names
```

- It reads only the lines your branch adds. String literals and JSX text are ignored (UI copy).
- It detects Spanish with a curated word list (`scripts/ci/spanish-words.txt`) and accents in identifiers.
- Legacy names are in `scripts/ci/english-identifiers-baseline.txt` (`db:` = database name, `path:` = file or folder). Do not add names to it by hand; when a module is migrated, regenerate it with `--write-baseline` so the old names are no longer allowed.
- A false positive (an English word in the list): add `!word` to `spanish-words.txt`.
- Last resort for a legacy contract you must touch (an env var, a JSON field of an external consumer): put `english-check-ignore: <reason>` in a comment on that line.
