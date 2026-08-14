# Integración Farmadosis → SynerLink

Farmadosis (Astro + Node) envía correo a `atencion.cliente@farmadosis.com.co` y después hace POST servidor a servidor aquí. Si SynerLink falla, el correo igual se envía.

## Contrato

`POST /api/integrations/farmadosis/create-request`  
`GET /api/integrations/farmadosis/schema?formKey=contacto`  
Auth: `Authorization: Bearer <INTEGRATION_API_KEYS>`

| HTTP | Significado |
|---|---|
| 201 | `id_request` — solicitud nueva |
| 200 | `alreadyExisted: true` — mismo `externalId` |
| 401 | API key inválida |
| 422 | proceso inactivo o usuario no resuelto |
| 503 | proceso / empresa no configurados |

Idempotencia: `url = farmadosis://{formKey}/{externalId}`.

## Los 3 formularios

| formKey | Proceso a crear en Workflows (nombre exacto) |
|---|---|
| `contacto` | **Contacto web** |
| `calidad` | **Calidad web** |
| `farmacovigilancia` | **Farmacovigilancia web** |

Si el proceso existe con ese nombre y está **activo**, no hace falta `FARMADOSIS_PROCESS_MAP`. Si los nombres no coinciden, mapea IDs:

```
FARMADOSIS_COMPANY_ID=<id_company>
FARMADOSIS_REQUESTER_USER_ID=<cuid usuario sistema>
FARMADOSIS_PROCESS_MAP={"contacto":12,"calidad":13,"farmacovigilancia":14}
```

Campos: crearlos en cada proceso con las **mismas etiquetas** del catálogo (`lib/farmadosis/forms.ts`). Lo que no mapee queda en descripción + nota. Los `medicamentos[n][...]` se agrupan en un campo **Medicamentos**.

Login `/sign-in` no se integra. Adjuntos: solo en el correo, no en SynerLink.

## Qué crear en la UI

1. Categoría p.ej. `Farmadosis`.
2. Tres procesos con los nombres de la tabla, campos, **una tarea con responsable**, y **activar**.
3. Empresa en `FARMADOSIS_COMPANY_ID`.
4. Usuario sistema en `FARMADOSIS_REQUESTER_USER_ID` (si el correo del visitante no existe en `[user]`).
5. Reiniciar `npm run dev`.
