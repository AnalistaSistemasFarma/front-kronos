import { describe, expect, it } from "vitest";
import {
  ProgramadasValidacionError,
  parseProgramadas,
  pctOk,
  resumirProgramadas,
  tendencia,
} from "../scheduled";

const base = {
  clave: "jorge:launchd:com.jorge.carter.certificaciones",
  code: "Carter",
  host: "jorge",
  tipo: "launchd",
  nombre: "com.jorge.carter.certificaciones",
  estado: "activa",
  corridas30: 30,
  ok30: 28,
  corridas90: 88,
  ok90: 80,
};

describe("parseProgramadas", () => {
  it("valida corte y lista", () => {
    expect(() => parseProgramadas({})).toThrow(ProgramadasValidacionError);
    expect(() => parseProgramadas({ corte: "2026-11-04" })).toThrow(
      ProgramadasValidacionError,
    );
  });

  it("normaliza, descarta lo inválido y no deja ok > corridas", () => {
    const p = parseProgramadas({
      corte: "2026-11-04",
      hostsLeidos: ["Jorge", "mal host!", "jorge"],
      automatizaciones: [
        {
          ...base,
          ok30: 99,
          semanas: [
            { inicio: "2026-10-27", corridas: 3, ok: 9 },
            { inicio: "x" },
          ],
        },
        { ...base }, // clave repetida
        { ...base, clave: "otra", tipo: "systemd" },
        { ...base, clave: "otra2", code: "con espacio" },
        { ...base, clave: "otra3", estado: "rara", ultimaCorrida: "no-fecha" },
      ],
    });
    expect(p.hostsLeidos).toEqual(["jorge"]);
    expect(p.automatizaciones).toHaveLength(2);
    const [a, b] = p.automatizaciones;
    expect(a.code).toBe("carter");
    expect(a.ok30).toBe(30);
    expect(a.semanas).toEqual([
      { inicio: "2026-10-27", corridas: 3, ok: 3, produccion: null },
    ]);
    expect(b.estado).toBe("sin_datos");
    expect(b.ultimaCorrida).toBeNull();
  });

  it("oculta secretos en los textos", () => {
    const p = parseProgramadas({
      corte: "2026-11-04",
      automatizaciones: [
        {
          ...base,
          descripcion: "usa sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        },
      ],
    });
    expect(p.automatizaciones[0].descripcion).not.toContain(
      "sk-ant-api03-AAAA",
    );
  });
});

describe("tendencia y resumen", () => {
  const w = (inicio: string, corridas: number, ok: number) => ({
    inicio,
    corridas,
    ok,
    produccion: null,
  });

  it("compara las 4 semanas recientes con las 4 anteriores", () => {
    expect(tendencia([], "2026-11-04")).toBeNull();
    expect(tendencia([w("2026-10-27", 7, 7)], "2026-11-04")).toBeNull();
    expect(tendencia([w("2026-09-22", 7, 7)], "2026-11-04")).toBe("baja");
    expect(
      tendencia([w("2026-10-27", 7, 7), w("2026-09-29", 7, 7)], "2026-11-04"),
    ).toBe("estable");
    expect(
      tendencia([w("2026-10-27", 7, 3), w("2026-09-29", 7, 7)], "2026-11-04"),
    ).toBe("baja");
    expect(
      tendencia([w("2026-10-27", 14, 14), w("2026-09-29", 7, 7)], "2026-11-04"),
    ).toBe("sube");
  });

  it("resume por estado y % bien", () => {
    expect(pctOk(0, 0)).toBeNull();
    expect(pctOk(2, 3)).toBe(66.7);
    const r = resumirProgramadas([
      { estado: "activa", corridas30: 10, ok30: 9 },
      { estado: "fallando", corridas30: 10, ok30: 1 },
      { estado: "pausada", corridas30: 0, ok30: 0 },
    ]);
    expect(r).toEqual({
      total: 3,
      activas: 1,
      pausadas: 1,
      fallando: 1,
      muertas: 0,
      corridas30: 20,
      ok30: 10,
      pctOk30: 50,
    });
  });

  it("con salud (servidor) manda la salud: muertas cuentan como problema", () => {
    const r = resumirProgramadas([
      { estado: "activa", salud: "muerta", corridas30: 5, ok30: 5 },
      { estado: "activa", salud: "ok", corridas30: 5, ok30: 5 },
      { estado: "fallando", salud: "fallando", corridas30: 5, ok30: 0 },
    ]);
    expect(r).toMatchObject({ activas: 1, fallando: 2, muertas: 1 });
  });

  it("parsea ref, horario y últimas corridas (nota solo en las fallidas, sin secretos)", () => {
    const p = parseProgramadas({
      corte: "2026-11-04",
      automatizaciones: [
        {
          ...base,
          ref: "com.jorge.carter.certificaciones",
          horario: { cal: [{ h: 16, m: 0 }] },
          ultimas: [
            { ts: "2026-11-03T21:00:00Z", ok: true, nota: "no va" },
            { ts: "2026-11-04T21:00:00Z", ok: false, nota: "Error token=sk-ant-abcdefghijklmnopqrstuvwxyz0123456789" },
            { ts: "no es fecha", ok: false },
          ],
        },
        { ...base, clave: "otra", ref: "rm -rf /", horario: "x" },
      ],
    });
    const [a, b] = p.automatizaciones;
    expect(a.ref).toBe("com.jorge.carter.certificaciones");
    expect(a.horario).toEqual({ cal: [{ h: 16, m: 0 }] });
    expect(a.ultimas).toHaveLength(2);
    expect(a.ultimas[0].nota).toBeNull();
    expect(a.ultimas[1].nota).not.toContain("sk-ant-abcdefghijklmnop");
    expect(b.ref).toBeNull();
    expect(b.horario).toBeNull();
    expect(b.ultimas).toEqual([]);
  });
});
