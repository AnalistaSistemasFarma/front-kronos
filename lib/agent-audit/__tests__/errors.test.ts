import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  calcularHuella,
  debeNotificar,
  ErroresValidacionError,
  horasEntreAvisos,
  normalizarTitulo,
  notificacionActiva,
  parseAcuse,
  parsePublicacion,
  type EstadoParaNotificar,
} from "../errors";

const ahora = new Date("2026-11-03T20:00:00Z");
const evento = (extra: Record<string, unknown> = {}) => ({
  agente: "Duo",
  tipo: "turno_fallido",
  severidad: "alta",
  ambiente: "prod",
  titulo: "falló el turno del mensaje 26723: el turno excedió 900s y se canceló",
  clave: "duo.err.log|2026-11-03T19:00:00Z|abc",
  ocurrioEn: "2026-11-03T19:00:00Z",
  idMensaje: 26723,
  idConversacion: "117",
  ...extra,
});

describe("normalizarTitulo y huella", () => {
  it("agrupa el mismo error aunque cambien números, fechas e ids", () => {
    const a = normalizarTitulo("falló el turno del mensaje 26723: el turno excedió 900s");
    const b = normalizarTitulo("Falló el turno del mensaje 26801: el turno excedió 900s\nsegunda línea");
    expect(a).toBe(b);
    expect(normalizarTitulo("sesión 3f2a9c1e-1111-2222-3333-444455556666 el 2026-11-03T10:00:00Z")).toBe(
      "sesión <id> el <fecha>",
    );
  });

  it("la huella distingue agente, tipo y ambiente", () => {
    const t = "Please run /login";
    const h = calcularHuella("rex", "sesion_vencida", "prod", t);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(calcularHuella("REX", "sesion_vencida", "prod", t)).toBe(h);
    expect(calcularHuella("lina", "sesion_vencida", "prod", t)).not.toBe(h);
    expect(calcularHuella("rex", "limite_uso", "prod", t)).not.toBe(h);
    expect(calcularHuella("rex", "sesion_vencida", "pruebas", t)).not.toBe(h);
  });
});

describe("parsePublicacion", () => {
  it("normaliza, calcula la huella en el servidor y conserva los ids", () => {
    const p = parsePublicacion({ host: "Mac de Horus", version: "1.0.0", eventos: [evento()] }, ahora);
    expect(p.eventos).toHaveLength(1);
    const e = p.eventos[0];
    expect(e.agente).toBe("duo");
    expect(e.host).toBe("Mac de Horus");
    expect(e.idMensaje).toBe(26723);
    expect(e.idConversacion).toBe(117);
    expect(e.huella).toBe(calcularHuella("duo", "turno_fallido", "prod", e.titulo));
    expect(e.eventoClave).toMatch(/^[0-9a-f]{64}$/);
  });

  it("descarta eventos inválidos o del futuro y usa valores seguros por defecto", () => {
    const p = parsePublicacion(
      {
        eventos: [
          evento({ agente: "no válido!" }),
          evento({ ambiente: "staging" }),
          evento({ clave: "" }),
          evento({ ocurrioEn: "2026-11-04T20:00:00Z" }),
          evento({ tipo: "inventado", severidad: "crítica", clave: "x" }),
          "basura",
        ],
      },
      ahora,
    );
    expect(p.eventos).toHaveLength(1);
    expect(p.eventos[0].tipo).toBe("otro");
    expect(p.eventos[0].severidad).toBe("media");
  });

  it("oculta secretos en el título y el detalle", () => {
    const p = parsePublicacion(
      { eventos: [evento({ detalle: "Authorization: Bearer sk-ant-oat01-abcdefghijklmnopqrstuvwxyz0123456789" })] },
      ahora,
    );
    expect(p.eventos[0].detalle).not.toContain("abcdefghijklmnopqrstuvwxyz0123456789");
  });

  it("rechaza cuerpos sin lista o demasiado grandes", () => {
    expect(() => parsePublicacion({}, ahora)).toThrow(ErroresValidacionError);
    expect(() => parsePublicacion({ eventos: new Array(2001).fill(evento()) }, ahora)).toThrow(
      ErroresValidacionError,
    );
  });
});

describe("parseAcuse", () => {
  it("solo acepta huellas sha256", () => {
    const h = "a".repeat(64);
    expect(parseAcuse({ accion: "acuse", huellas: [h, h, "zz", 3] })).toEqual([h]);
    expect(() => parseAcuse({})).toThrow(ErroresValidacionError);
  });
});

describe("debeNotificar", () => {
  const base: EstadoParaNotificar = {
    severidad: "media",
    estado: "abierto",
    nueva: false,
    reabierta: false,
    eventosNuevos: 1,
    notificadoEn: null,
  };
  it("avisa una huella nueva o reabierta de severidad media o alta", () => {
    expect(debeNotificar({ ...base, nueva: true }, ahora, 6)).toBe(true);
    expect(debeNotificar({ ...base, reabierta: true, notificadoEn: ahora }, ahora, 6)).toBe(true);
    expect(debeNotificar({ ...base, nueva: true, severidad: "baja" }, ahora, 6)).toBe(false);
  });
  it("no repite el mismo error de severidad alta antes de X horas", () => {
    const alta = { ...base, severidad: "alta" as const };
    expect(debeNotificar(alta, ahora, 6)).toBe(true);
    expect(debeNotificar({ ...alta, notificadoEn: new Date(ahora.getTime() - 2 * 3_600_000) }, ahora, 6)).toBe(false);
    expect(debeNotificar({ ...alta, notificadoEn: new Date(ahora.getTime() - 7 * 3_600_000) }, ahora, 6)).toBe(true);
    expect(debeNotificar(base, ahora, 6)).toBe(false);
  });
  it("nunca avisa lo silenciado ni lo que no tuvo ocurrencias nuevas", () => {
    expect(debeNotificar({ ...base, nueva: true, estado: "silenciado" }, ahora, 6)).toBe(false);
    expect(debeNotificar({ ...base, nueva: true, eventosNuevos: 0 }, ahora, 6)).toBe(false);
  });
});

describe("bandera de notificación", () => {
  it("queda apagada salvo AGENT_ERRORS_NOTIFY=1", () => {
    expect(notificacionActiva({} as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(notificacionActiva({ AGENT_ERRORS_NOTIFY: "true" } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(notificacionActiva({ AGENT_ERRORS_NOTIFY: "1" } as unknown as NodeJS.ProcessEnv)).toBe(true);
  });
  it("horas entre avisos con tope y valor por defecto", () => {
    expect(horasEntreAvisos({} as unknown as NodeJS.ProcessEnv)).toBe(6);
    expect(horasEntreAvisos({ AGENT_ERRORS_NOTIFY_HOURS: "12" } as unknown as NodeJS.ProcessEnv)).toBe(12);
    expect(horasEntreAvisos({ AGENT_ERRORS_NOTIFY_HOURS: "0" } as unknown as NodeJS.ProcessEnv)).toBe(6);
  });
});

describe("SQL de errores de IA", () => {
  const raiz = path.resolve(__dirname, "../../..");
  const leer = (p: string) => readFileSync(path.join(raiz, p), "utf8");
  const pruebas = leer("prisma/manual/2026-11-03-errores-ia-PRUEBAS.sql");
  const prod = leer("prisma/manual/2026-11-03-errores-ia-PROD.sql");
  const reversa = leer("prisma/manual/2026-11-03-errores-ia-reversa.sql");
  const ddl = (s: string) => s.slice(s.indexOf("SET XACT_ABORT ON;"));

  it("PRUEBAS y PROD llevan el mismo DDL y cada uno su guarda de base", () => {
    expect(ddl(pruebas)).toBe(ddl(prod));
    expect(pruebas).toContain("IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'kronos_ci')");
    expect(prod).toContain("IF DB_NAME() <> N'KRONOSDB'");
  });
  it("es aditivo: solo crea lo que falta y no borra ni altera nada", () => {
    for (const s of [pruebas, prod]) {
      expect(s).toMatch(/IF OBJECT_ID\(N'\[dbo\]\.\[agent_error_issue\]', N'U'\) IS NULL/);
      const sentencias = s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\bON DELETE (CASCADE|SET NULL)\b/g, "");
      expect(sentencias).not.toMatch(/\bDROP\b|\bALTER TABLE\b|\bDELETE\b|\bUPDATE\b/i);
    }
  });
  it("la reversa solo quita las dos tablas nuevas", () => {
    const drops = reversa.match(/DROP TABLE \[dbo\]\.\[\w+\]/g) ?? [];
    expect(drops).toEqual(["DROP TABLE [dbo].[agent_error_event]", "DROP TABLE [dbo].[agent_error_issue]"]);
  });
});
