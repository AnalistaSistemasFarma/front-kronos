import "server-only";
import { sql, withMssqlPool } from "../mssqlPool";
import {
  sugerirReparto,
  totalesDelAnio,
  type FacturaResumenDto,
  type FacturasAnioDto,
  type LineaFacturaDto,
  type RepartoDto,
} from "./facturas";

/**
 * AUDITORÍA DE AGENTES → FACTURAS DE IA (Nicolás, 2026-11-17): facturas de los
 * proveedores de IA, con su PDF, la empresa que las pagó y el reparto interno por
 * empresa. Tablas: prisma/manual/2026-11-17-auditoria-facturas-ia-*.sql (sin Prisma).
 * Reglas puras en ./facturas.ts.
 */

export class FacturasNoDisponibles extends Error {
  constructor() {
    super("El módulo de facturas de IA aún no está habilitado en este ambiente.");
  }
}
export class FacturasValidacionError extends Error {}

type Fila = Record<string, unknown>;
const esAusente = (e: unknown) => [207, 208].includes((e as { number?: number } | null)?.number ?? 0);
async function conTablas<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (esAusente(e)) throw new FacturasNoDisponibles();
    const n = (e as { number?: number } | null)?.number;
    if (n === 2601 || n === 2627) throw new FacturasValidacionError("Ya existe una factura con ese número para ese proveedor.");
    throw e;
  }
}
const dia = (v: unknown) => (v instanceof Date && !Number.isNaN(v.getTime()) ? v.toISOString().slice(0, 10) : null);
const txt = (v: unknown) => (v === null || v === undefined ? null : String(v).trim() || null);
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** Facturas del año (sin el PDF), con sus líneas y su reparto, y los totales. */
export async function leerFacturas(anio: number): Promise<FacturasAnioDto> {
  return conTablas(async () => {
    const r = await withMssqlPool((pool) =>
      pool
        .request()
        .input("anio", sql.Int, anio)
        .query(`
          SELECT i.id_invoice, i.proveedor, i.numero, i.fecha, i.vence, i.periodo_desde, i.periodo_hasta,
                 i.facturado_a, i.correo_cuenta, i.organizacion, i.id_company, RTRIM(c.company) AS empresa,
                 i.moneda, i.subtotal, i.impuestos, i.total, i.estado, i.notas, i.pdf_nombre,
                 CASE WHEN i.pdf IS NULL THEN 0 ELSE 1 END AS tiene_pdf
          FROM dbo.ai_invoice i JOIN dbo.company c ON c.id_company = i.id_company
          WHERE YEAR(i.fecha) = @anio
          ORDER BY i.fecha DESC, i.numero;

          SELECT l.id_invoice, l.descripcion, l.periodo, l.cantidad, l.precio_unitario, l.monto
          FROM dbo.ai_invoice_line l JOIN dbo.ai_invoice i ON i.id_invoice = l.id_invoice
          WHERE YEAR(i.fecha) = @anio ORDER BY l.id_line;

          SELECT s.id_invoice, s.id_company, RTRIM(c.company) AS empresa, s.monto, s.fuente
          FROM dbo.ai_invoice_split s JOIN dbo.ai_invoice i ON i.id_invoice = s.id_invoice
          JOIN dbo.company c ON c.id_company = s.id_company
          WHERE YEAR(i.fecha) = @anio ORDER BY s.monto DESC;

          SELECT DISTINCT YEAR(fecha) AS anio FROM dbo.ai_invoice ORDER BY anio DESC;
          SELECT id_company, RTRIM(company) AS empresa FROM dbo.company ORDER BY company;
          SELECT DISTINCT organizacion FROM dbo.ai_license WHERE organizacion IS NOT NULL
          UNION SELECT DISTINCT organizacion FROM dbo.ai_invoice WHERE organizacion IS NOT NULL;
        `),
    );
    const [inv, lin, rep, anios, empresas, orgs] = r.recordsets as unknown as Fila[][];
    const lineas = new Map<number, LineaFacturaDto[]>();
    for (const l of lin) {
      const k = Number(l.id_invoice);
      lineas.set(k, [
        ...(lineas.get(k) ?? []),
        {
          descripcion: String(l.descripcion),
          periodo: txt(l.periodo),
          cantidad: num(l.cantidad),
          precioUnitario: num(l.precio_unitario),
          monto: Number(l.monto),
        },
      ]);
    }
    const reparto = new Map<number, (RepartoDto & { fuente: string })[]>();
    for (const s of rep) {
      const k = Number(s.id_invoice);
      reparto.set(k, [
        ...(reparto.get(k) ?? []),
        { idEmpresa: Number(s.id_company), empresa: String(s.empresa), monto: Number(s.monto), fuente: String(s.fuente) },
      ]);
    }
    const facturas: FacturaResumenDto[] = inv.map((i) => ({
      idFactura: Number(i.id_invoice),
      proveedor: String(i.proveedor),
      numero: String(i.numero),
      fecha: dia(i.fecha) ?? "",
      vence: dia(i.vence),
      periodoDesde: dia(i.periodo_desde),
      periodoHasta: dia(i.periodo_hasta),
      facturadoA: txt(i.facturado_a),
      correoCuenta: txt(i.correo_cuenta),
      organizacion: txt(i.organizacion),
      idEmpresa: Number(i.id_company),
      empresa: String(i.empresa),
      moneda: txt(i.moneda) ?? "USD",
      subtotal: num(i.subtotal),
      impuestos: num(i.impuestos),
      total: Number(i.total),
      estado: txt(i.estado) ?? "pagada",
      notas: txt(i.notas),
      tienePdf: Number(i.tiene_pdf) === 1,
      pdfNombre: txt(i.pdf_nombre),
      lineas: lineas.get(Number(i.id_invoice)) ?? [],
      reparto: reparto.get(Number(i.id_invoice)) ?? [],
    }));
    const listaAnios = anios.map((a) => Number(a.anio));
    if (!listaAnios.includes(anio)) listaAnios.unshift(anio);
    return {
      anio,
      anios: listaAnios.sort((a, b) => b - a),
      moneda: facturas[0]?.moneda ?? "USD",
      facturas,
      ...totalesDelAnio(anio, facturas),
      empresas: empresas.map((e) => ({ idEmpresa: Number(e.id_company), empresa: String(e.empresa) })),
      organizaciones: orgs.map((o) => String(o.organizacion)).sort(),
    };
  });
}

export interface FacturaEntrada {
  idFactura: number | null;
  proveedor: string;
  numero: string;
  fecha: string;
  vence: string | null;
  periodoDesde: string | null;
  periodoHasta: string | null;
  facturadoA: string | null;
  correoCuenta: string | null;
  organizacion: string | null;
  idEmpresa: number;
  moneda: string;
  subtotal: number | null;
  impuestos: number | null;
  total: number;
  estado: string;
  notas: string | null;
  lineas: LineaFacturaDto[];
  pdf: Buffer | null;
  pdfNombre: string | null;
}

const MAX_PDF = 8 * 1024 * 1024;
const fechaOk = (v: unknown, campo: string, obligatoria = false): string | null => {
  if (v === undefined || v === null || v === "") {
    if (obligatoria) throw new FacturasValidacionError(`Falta la ${campo}.`);
    return null;
  }
  const s = String(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw new FacturasValidacionError(`La ${campo} debe ser AAAA-MM-DD.`);
  return s;
};
const montoOk = (v: unknown, campo: string, obligatorio = false): number | null => {
  if (v === undefined || v === null || v === "") {
    if (obligatorio) throw new FacturasValidacionError(`Falta el ${campo}.`);
    return null;
  }
  const n = Number(v);
  if (!Number.isFinite(n) || Math.abs(n) > 100_000_000) throw new FacturasValidacionError(`El ${campo} no es válido.`);
  return Math.round(n * 100) / 100;
};
const corto = (v: unknown, max: number) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};

/** Valida lo que llega del formulario. Lanza FacturasValidacionError. */
export function parseFactura(body: Record<string, unknown>): FacturaEntrada {
  const proveedor = corto(body.proveedor, 80);
  const numero = corto(body.numero, 60);
  if (!proveedor) throw new FacturasValidacionError("Falta el proveedor.");
  if (!numero) throw new FacturasValidacionError("Falta el número de la factura.");
  const idEmpresa = Number(body.idEmpresa);
  if (!Number.isInteger(idEmpresa) || idEmpresa <= 0) throw new FacturasValidacionError("Elija la empresa que pagó la factura.");
  const moneda = (corto(body.moneda, 3) ?? "USD").toUpperCase();
  if (!/^[A-Z]{3}$/.test(moneda)) throw new FacturasValidacionError("Moneda inválida (por ejemplo USD o COP).");
  const estado = body.estado === "pendiente" ? "pendiente" : "pagada";
  const lineasCrudas = Array.isArray(body.lineas) ? body.lineas : [];
  if (lineasCrudas.length > 200) throw new FacturasValidacionError("Demasiadas líneas.");
  const lineas: LineaFacturaDto[] = lineasCrudas.map((l: unknown, i: number) => {
    const o = (l ?? {}) as Record<string, unknown>;
    const descripcion = corto(o.descripcion, 300);
    if (!descripcion) throw new FacturasValidacionError(`La línea ${i + 1} no tiene descripción.`);
    return {
      descripcion,
      periodo: corto(o.periodo, 60),
      cantidad: montoOk(o.cantidad, "cantidad"),
      precioUnitario: montoOk(o.precioUnitario, "precio unitario"),
      monto: montoOk(o.monto, `monto de la línea ${i + 1}`, true) as number,
    };
  });
  let pdf: Buffer | null = null;
  if (typeof body.pdfBase64 === "string" && body.pdfBase64) {
    pdf = Buffer.from(body.pdfBase64, "base64");
    if (pdf.length > MAX_PDF) throw new FacturasValidacionError("El PDF supera 8 MB.");
    if (pdf.subarray(0, 5).toString("latin1") !== "%PDF-") throw new FacturasValidacionError("El archivo no es un PDF.");
  }
  const idFactura = body.idFactura === null || body.idFactura === undefined ? null : Number(body.idFactura);
  if (idFactura !== null && (!Number.isInteger(idFactura) || idFactura <= 0)) throw new FacturasValidacionError("Factura inválida.");
  return {
    idFactura,
    proveedor,
    numero,
    fecha: fechaOk(body.fecha, "fecha de la factura", true) as string,
    vence: fechaOk(body.vence, "fecha de vencimiento"),
    periodoDesde: fechaOk(body.periodoDesde, "fecha de inicio del período"),
    periodoHasta: fechaOk(body.periodoHasta, "fecha de fin del período"),
    facturadoA: corto(body.facturadoA, 200),
    correoCuenta: corto(body.correoCuenta, 200),
    organizacion: corto(body.organizacion, 40),
    idEmpresa,
    moneda,
    subtotal: montoOk(body.subtotal, "subtotal"),
    impuestos: montoOk(body.impuestos, "valor de impuestos"),
    total: montoOk(body.total, "total", true) as number,
    estado,
    notas: corto(body.notas, 500),
    lineas,
    pdf,
    pdfNombre: corto(body.pdfNombre, 200),
  };
}

const fechaSql = (s: string | null) => (s ? new Date(`${s}T00:00:00Z`) : null);

/**
 * Crea o actualiza una factura con sus líneas (las reemplaza). Si es nueva, deja
 * el reparto sugerido por licencias. Devuelve el id.
 */
export async function guardarFactura(f: FacturaEntrada, usuario: string): Promise<number> {
  return conTablas(() =>
    withMssqlPool(async (pool) => {
      const tx = new sql.Transaction(pool);
      await tx.begin();
      try {
        const req = new sql.Request(tx)
          .input("id", sql.Int, f.idFactura)
          .input("prov", sql.NVarChar(80), f.proveedor)
          .input("num", sql.NVarChar(60), f.numero)
          .input("fecha", sql.Date, fechaSql(f.fecha))
          .input("vence", sql.Date, fechaSql(f.vence))
          .input("pd", sql.Date, fechaSql(f.periodoDesde))
          .input("ph", sql.Date, fechaSql(f.periodoHasta))
          .input("fa", sql.NVarChar(200), f.facturadoA)
          .input("cc", sql.NVarChar(200), f.correoCuenta)
          .input("org", sql.NVarChar(40), f.organizacion)
          .input("emp", sql.Int, f.idEmpresa)
          .input("mon", sql.NVarChar(3), f.moneda)
          .input("sub", sql.Decimal(14, 2), f.subtotal)
          .input("imp", sql.Decimal(14, 2), f.impuestos)
          .input("tot", sql.Decimal(14, 2), f.total)
          .input("est", sql.NVarChar(20), f.estado)
          .input("notas", sql.NVarChar(500), f.notas)
          .input("pdf", sql.VarBinary(sql.MAX), f.pdf)
          .input("pdfn", sql.NVarChar(200), f.pdfNombre)
          .input("usr", sql.NVarChar(200), usuario);
        const r = await req.query(`
          IF @id IS NULL
          BEGIN
            INSERT dbo.ai_invoice (proveedor, numero, fecha, vence, periodo_desde, periodo_hasta, facturado_a, correo_cuenta,
                                   organizacion, id_company, moneda, subtotal, impuestos, total, estado, notas, pdf, pdf_nombre, created_by)
            VALUES (@prov, @num, @fecha, @vence, @pd, @ph, @fa, @cc, @org, @emp, @mon, @sub, @imp, @tot, @est, @notas, @pdf, @pdfn, @usr);
            SELECT CAST(SCOPE_IDENTITY() AS INT) AS id, 1 AS nueva;
          END
          ELSE
          BEGIN
            UPDATE dbo.ai_invoice SET proveedor = @prov, numero = @num, fecha = @fecha, vence = @vence, periodo_desde = @pd,
              periodo_hasta = @ph, facturado_a = @fa, correo_cuenta = @cc, organizacion = @org, id_company = @emp, moneda = @mon,
              subtotal = @sub, impuestos = @imp, total = @tot, estado = @est, notas = @notas,
              pdf = ISNULL(@pdf, pdf), pdf_nombre = CASE WHEN @pdf IS NULL THEN pdf_nombre ELSE @pdfn END,
              updated_at = SYSUTCDATETIME()
            WHERE id_invoice = @id;
            IF @@ROWCOUNT = 0 THROW 51724, N'La factura no existe.', 1;
            SELECT @id AS id, 0 AS nueva;
          END`);
        const id = Number(r.recordset[0].id);
        const nueva = Number(r.recordset[0].nueva) === 1;
        await new sql.Request(tx).input("id", sql.Int, id).query(`DELETE FROM dbo.ai_invoice_line WHERE id_invoice = @id`);
        for (const l of f.lineas) {
          await new sql.Request(tx)
            .input("id", sql.Int, id)
            .input("d", sql.NVarChar(300), l.descripcion)
            .input("p", sql.NVarChar(60), l.periodo)
            .input("c", sql.Decimal(10, 2), l.cantidad)
            .input("u", sql.Decimal(14, 2), l.precioUnitario)
            .input("m", sql.Decimal(14, 2), l.monto)
            .query(`INSERT dbo.ai_invoice_line (id_invoice, descripcion, periodo, cantidad, precio_unitario, monto) VALUES (@id, @d, @p, @c, @u, @m)`);
        }
        await tx.commit();
        if (nueva) await repartirPorLicencias(id);
        return id;
      } catch (e) {
        await tx.rollback().catch(() => undefined);
        if ((e as { number?: number } | null)?.number === 51724) throw new FacturasValidacionError("La factura no existe.");
        throw e;
      }
    }),
  );
}

export async function eliminarFactura(id: number): Promise<void> {
  await conTablas(() =>
    withMssqlPool((pool) =>
      pool
        .request()
        .input("id", sql.Int, id)
        .query(`
          SET XACT_ABORT ON; BEGIN TRAN;
          DELETE FROM dbo.ai_invoice_split WHERE id_invoice = @id;
          DELETE FROM dbo.ai_invoice_line WHERE id_invoice = @id;
          DELETE FROM dbo.ai_invoice WHERE id_invoice = @id;
          COMMIT;`),
    ),
  );
}

/**
 * Reparto sugerido: proporcional al costo de las licencias de la MISMA organización
 * por la empresa que paga cada licencia. Si la factura no tiene organización o no
 * hay licencias con costo, todo a la empresa que pagó.
 */
export async function repartirPorLicencias(id: number): Promise<RepartoDto[]> {
  return conTablas(() =>
    withMssqlPool(async (pool) => {
      const r = await pool
        .request()
        .input("id", sql.Int, id)
        .query(`
          SELECT i.total, i.organizacion, i.id_company, RTRIM(c.company) AS empresa
          FROM dbo.ai_invoice i JOIN dbo.company c ON c.id_company = i.id_company WHERE i.id_invoice = @id;
          SELECT l.id_company, RTRIM(c.company) AS empresa, l.costo_mensual
          FROM dbo.ai_license l JOIN dbo.company c ON c.id_company = l.id_company
          WHERE l.activa = 1 AND l.organizacion = (SELECT organizacion FROM dbo.ai_invoice WHERE id_invoice = @id);`);
      const [inv, lic] = r.recordsets as unknown as Fila[][];
      if (!inv[0]) throw new FacturasValidacionError("La factura no existe.");
      const reparto = sugerirReparto(
        Number(inv[0].total),
        { idEmpresa: Number(inv[0].id_company), empresa: String(inv[0].empresa) },
        lic.map((l) => ({ idEmpresa: Number(l.id_company), empresa: String(l.empresa), costoMensual: num(l.costo_mensual) })),
      );
      await guardarReparto(id, reparto, "licencias");
      return reparto;
    }),
  );
}

/** Reemplaza el reparto de una factura. La suma debe ser igual al total. */
export async function guardarReparto(id: number, reparto: RepartoDto[], fuente: "licencias" | "manual"): Promise<void> {
  await conTablas(() =>
    withMssqlPool(async (pool) => {
      const t = await pool.request().input("id", sql.Int, id).query(`SELECT total FROM dbo.ai_invoice WHERE id_invoice = @id`);
      if (!t.recordset[0]) throw new FacturasValidacionError("La factura no existe.");
      const total = Number(t.recordset[0].total);
      const suma = Math.round(reparto.reduce((s, r) => s + r.monto, 0) * 100) / 100;
      if (Math.abs(suma - total) > 0.01) throw new FacturasValidacionError(`El reparto suma ${suma} y la factura es de ${total}.`);
      const ids = new Set<number>();
      for (const r of reparto) {
        if (!Number.isInteger(r.idEmpresa) || r.idEmpresa <= 0 || ids.has(r.idEmpresa)) throw new FacturasValidacionError("Empresa repetida o inválida en el reparto.");
        ids.add(r.idEmpresa);
      }
      const tx = new sql.Transaction(pool);
      await tx.begin();
      try {
        await new sql.Request(tx).input("id", sql.Int, id).query(`DELETE FROM dbo.ai_invoice_split WHERE id_invoice = @id`);
        for (const r of reparto.filter((x) => x.monto !== 0)) {
          await new sql.Request(tx)
            .input("id", sql.Int, id)
            .input("emp", sql.Int, r.idEmpresa)
            .input("m", sql.Decimal(14, 2), r.monto)
            .input("f", sql.NVarChar(20), fuente)
            .query(`INSERT dbo.ai_invoice_split (id_invoice, id_company, monto, fuente) VALUES (@id, @emp, @m, @f)`);
        }
        await tx.commit();
      } catch (e) {
        await tx.rollback().catch(() => undefined);
        throw e;
      }
    }),
  );
}

/** PDF de una factura (para verlo en el navegador). */
export async function leerPdfFactura(id: number): Promise<{ pdf: Buffer; nombre: string } | null> {
  return conTablas(async () => {
    const r = await withMssqlPool((pool) =>
      pool.request().input("id", sql.Int, id).query(`SELECT pdf, pdf_nombre, numero FROM dbo.ai_invoice WHERE id_invoice = @id`),
    );
    const f = r.recordset[0];
    if (!f?.pdf) return null;
    return { pdf: f.pdf as Buffer, nombre: txt(f.pdf_nombre) ?? `factura-${String(f.numero)}.pdf` };
  });
}
