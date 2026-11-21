# Pase a producción de Ventas en SynerLink: checklist de scripts

Lo pidió Nicolás Rivera el 2026-11-09: cuando diga «vamos a pasar a prod», no se nos puede pasar ningún script.

El estado de producción se verificó el **2026-11-09** con una consulta de solo lectura a KRONOSDB. Antes del pase se vuelve a verificar con el mismo SELECT (sección 5).

Reglas del pase:
- Aviso 🚀 PROD en el grupo de Teams de desarrollo, antes y después.
- Respaldo `COPY_ONLY` de KRONOSDB antes del primer script.
- Ventana controlada.
- Todo el SQL va **antes** del código, en el orden de abajo.
- Todos los scripts son idempotentes y solo agregan. Cada uno tiene su reversa.

## 1. Dependencias: Compras y Workflow SAP (Ventas usa su motor)

| # | Script (`prisma/manual/`) | Estado en PROD (2026-11-09) | Qué hace |
|---|---|---|---|
| 1 | `2026-10-20-compras-mapeo-sapsend-PROD.sql` | ✅ ya corrido | Mapeo de usuarios y departamentos de SAPSEND |
| 2 | `2026-10-21-compras-autorizacion-PROD.sql` | ✅ ya corrido | purchase_authorization y purchase_company_config |
| 3 | `2026-10-22-workflow-sap-PROD.sql` | ⛔ **pendiente** | Tareas SAP: task_kind, task_sap_action y lo demás del motor |
| 4 | `2026-11-06-compras-borrador-PROD.sql` | ⛔ **pendiente** (verificar) | Estado «draft» en purchase_authorization |

El código de Compras y Workflow SAP se sube **junto y en orden de merge** (ver PR #792), antes que el de Ventas.

## 2. Ventas: tablas y columnas

| # | Script (`prisma/manual/`) | Estado en PROD | Qué hace | PR |
|---|---|---|---|---|
| 5 | `2026-10-30-ventas-autorizacion-PROD.sql` | ⛔ pendiente | sales_company_config, sales_stage_department, sales_authorization y los 3 subprocesos-permiso (`/process/sales`, `/manage`, `/automatizacion`) | #822 |
| 6 | `2026-11-03-ventas-automatizacion-PROD.sql` | ⛔ pendiente | sales_automation_config, _doc y _run (panel de Salesforce) | #827 |
| 7 | `2026-11-04-ventas-automatizacion-varios-usuarios-PROD.sql` | ⛔ pendiente | user_sign pasa de INT a NVARCHAR(100), para lista de usuarios SAP. **Va después del 6** | #861 |
| 8 | `2026-11-04-ventas-oferta-borrador-PROD.sql` | ⛔ pendiente | sales_offer_draft (oferta en borrador) | #850 |
| 9 | `2026-11-09-ventas-config-empresa-PROD.sql` | ⛔ pendiente | 4 columnas de parámetros por empresa: descripción editable, lista por defecto, pedido directo y OC obligatoria | #905 |

Las reversas están en `*-reversa.sql`, con el mismo prefijo.

## 3. Ventas: datos que se crean en PROD (⚠️ estos scripts TODAVÍA NO EXISTEN)

En PRUEBAS los flujos se crearon con scripts **solo de PRUEBAS** y con Nicolás como autorizador de prueba:
- `2026-10-30-ventas-flujo-OLP-PRUEBAS.sql`
- `2026-11-05-ventas-flujo-empresas-PRUEBAS.sql`
- `2026-11-09-ventas-pedido-directo-PRUEBAS.sql`

**No se corren en PROD.** Para el pase hay que escribir y revisar con Nicolás:

| # | Script por escribir | Contenido |
|---|---|---|
| 10 | `ventas-flujos-PROD.sql` | Por cada empresa que entra al pase: categoría «Ventas», proceso «Oferta de venta», campo «Resultado de la evaluación de venta» (opciones «Excede cupo» y «Requiere autorización de precio»), tareas y Tareas SAP, y los tipos de autorización. **OLP:** solo cupo (6 tareas). **Farmalógica, Ryan, Abamia y GSS:** precio y cupo (9 tareas). **Meditrack y Kelab:** según la decisión pendiente, «Pedido directo de venta» (1 tarea) o el flujo completo. |
| 11 | Autorizadores reales (en el mismo script) | Por departamento, como Compras. **Precios:** Ricardo Méndez, Viviana Gaitán, Leidy Jiménez, Patricia Martínez. **Dirección comercial:** Ricardo Méndez, Viviana Gaitán. **Dirección administrativa:** Jorge Alba, Catalina Sánchez, José Luis Gutiérrez. Además, OLP: Mauricio Duque; Abamia: Stefany Rodríguez y Diana Osorio. Se asignan en `user_task_request_general` y `user_types_authorization`, con los correos verificados en PROD. |
| 12 | `sales_company_config` por empresa | `valida_precio` (OLP = 0), `id_process_category_oferta`, `id_process_category_directa` (si aplica), `descripcion_editable`, `id_price_list_default` (OLP: lista por decidir; en PRUEBAS se probó la 32 Tipo A), `exige_oc` y `ventas_emails`. |
| 13 | Permisos | Subprocesos «Ventas · Ofertas», «Ventas · Gestionar ofertas» y «Ventas · Automatización» para los usuarios que diga Nicolás, por empresa (Administración → Usuarios o script). |

## 4. Después del código (configuración en pantalla y en SAP)

- [ ] **Automatización de OLP** (panel «Ventas · Automatización → Configuración»):
  - usuario SAP de la integración de Ceiba: verificar su UserSign en la base productiva de OLP (en pruebas era el 30, ServiceLayer_01);
  - fecha «desde» vacía o la del arranque;
  - solicitante;
  - empezar en simulación.

  La tarea `ventas_automatizar` del programador la crea el panel al guardar.
- [ ] **SAP de cada empresa:**
  - UDF `U_SEND_*` y `U_HBT_Cantidad` en las líneas (verificado en OLP, Farmalógica y Meditrack);
  - TRM del día cargada;
  - periodo contable abierto.
- [ ] **Usuario Service Layer** de cada empresa activo en `sap_endpoints` de KRONOSDB.
- [ ] **Smoke test por empresa:** crear una oferta, guardarla en borrador, enviarla a pedido, ver la autorización en Autorizaciones, ver el pedido creado y el mapa de relaciones.

## 5. SELECT de verificación (solo lectura, antes y después)

```sql
SELECT DB_NAME() AS base,
  CASE WHEN COL_LENGTH('dbo.task_process_category','task_kind') IS NULL THEN 0 ELSE 1 END AS workflow_sap,
  (SELECT COUNT(*) FROM sys.check_constraints WHERE name='CK_purchase_authorization_status' AND definition LIKE '%draft%') AS compras_borrador,
  CASE WHEN OBJECT_ID('dbo.sales_company_config','U') IS NULL THEN 0 ELSE 1 END AS ventas_autorizacion,
  CASE WHEN OBJECT_ID('dbo.sales_automation_config','U') IS NULL THEN 0 ELSE 1 END AS ventas_automatizacion,
  (SELECT DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='sales_automation_config' AND COLUMN_NAME='user_sign') AS user_sign_tipo,
  CASE WHEN OBJECT_ID('dbo.sales_offer_draft','U') IS NULL THEN 0 ELSE 1 END AS ventas_oferta_borrador,
  CASE WHEN COL_LENGTH('dbo.sales_company_config','exige_oc') IS NULL THEN 0 ELSE 1 END AS ventas_config_empresa,
  (SELECT COUNT(*) FROM dbo.subprocess WHERE subprocess_url LIKE '/process/sales%') AS subprocesos_ventas;
-- Esperado después del pase: todo en 1, user_sign_tipo = nvarchar y subprocesos_ventas = 3.
```

## 6. Relacionado, pero NO es de este proyecto

- `2026-11-06-dashboard-venta-diaria-PROD.sql`: permiso del «Dashboard de venta diaria», de otro desarrollo. Está pendiente en PROD; va con su propio PR.

## 7. Decisiones de Nicolás que faltan para escribir los scripts 10 a 12

1. Meditrack y Kelab: ¿solo pedido directo, o flujo con control de cupo y precio?
2. OLP: ¿qué lista de precios por defecto (32 Tipo A, 33 Tipo B, 31 Mínimos)?
3. Descripción editable: ¿todas las empresas, solo Meditrack o con permiso?
4. Qué empresas entran en el primer pase.
5. A quién se le dan los permisos de Ventas en cada empresa.
