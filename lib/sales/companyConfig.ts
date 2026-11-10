import sql from 'mssql';
import sqlConfig from '../../dbconfig.js';

/**
 * Parámetros de ventas por empresa (dbo.sales_company_config). Cada flujo se parametriza por empresa
 * (reunión del 2026-11-06): descripción editable, lista de precios por defecto, pedido directo y OC obligatoria.
 */
export interface SalesCompanyConfig {
  idCompany: number;
  activo: boolean;
  validaPrecio: boolean;
  /** Flujo «Oferta de venta» (o el de pedido directo, en empresas que solo venden directo). */
  processOferta: number | null;
  /** Flujo «Pedido directo» opcional: si está, el formulario ofrece crear el pedido sin autorizaciones. */
  processDirecta: number | null;
  descripcionEditable: boolean;
  priceListDefault: number | null;
  exigeOc: boolean;
  /** Bodega por defecto de la empresa (si el artículo no trae la suya). */
  defaultWarehouse: string | null;
}

export async function salesCompanyConfig(idCompany: number): Promise<SalesCompanyConfig | null> {
  const pool = await sql.connect(sqlConfig);
  const r = await pool.request().input('c', sql.Int, idCompany).query(`
    SELECT id_company, activo, valida_precio, id_process_category_oferta, id_process_category_directa,
           descripcion_editable, id_price_list_default, exige_oc, default_warehouse
    FROM dbo.sales_company_config WHERE id_company = @c;`);
  const x = r.recordset[0];
  if (!x) return null;
  return {
    idCompany,
    activo: Boolean(x.activo),
    validaPrecio: Boolean(x.valida_precio),
    processOferta: x.id_process_category_oferta ?? null,
    processDirecta: x.id_process_category_directa ?? null,
    descripcionEditable: Boolean(x.descripcion_editable),
    priceListDefault: x.id_price_list_default ?? null,
    exigeOc: x.exige_oc == null ? true : Boolean(x.exige_oc),
    defaultWarehouse: x.default_warehouse ? String(x.default_warehouse) : null,
  };
}
