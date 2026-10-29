import { describe, expect, it } from "vitest";
import {
  MemoryValidationError,
  normalizarTipo,
  parseMemoriesPayload,
  temaPrincipal,
} from "../memories";

const base = (memories: unknown[], links: unknown[] = []) => ({
  host: "Mac de Horus",
  collectorVersion: "1.0.0",
  agents: [{ code: "horus", source: "engram", memories, links }],
});

describe("parseMemoriesPayload", () => {
  it("oculta secretos en título y contenido y los cuenta", () => {
    const p = parseMemoriesPayload(
      base([
        {
          sourceKey: "obs:1",
          title: "Token del bot 123456789:AAAbcdefghijklmnopqrstuvwxyz0123",
          content:
            "Usar Bearer abc.def.ghi y https://user:clave@servidor/x?token=zzz",
          type: "decision",
        },
      ]),
    );
    const m = p.agents[0].memories[0];
    expect(m.title).not.toContain("AAAbcdef");
    expect(m.content).not.toContain("abc.def.ghi");
    expect(m.content).not.toContain("user:clave");
    expect(m.content).not.toContain("token=zzz");
    expect(m.secretsHidden).toBeGreaterThanOrEqual(3);
  });

  it("descarta memorias sin título o con clave repetida y enlaces a memorias que no vienen", () => {
    const p = parseMemoriesPayload(
      base(
        [
          { sourceKey: "a", title: "Uno", type: "manual" },
          { sourceKey: "a", title: "Repetida" },
          { sourceKey: "b", title: "   " },
          { sourceKey: "c", title: "Tres", type: "raro" },
        ],
        [
          { from: "a", to: "c", relation: "related" },
          { from: "a", to: "zz" },
          { from: "a", to: "a" },
        ],
      ),
    );
    expect(p.agents[0].memories.map((m) => m.sourceKey)).toEqual(["a", "c"]);
    expect(p.agents[0].memories[0].type).toBe("procedimiento");
    expect(p.agents[0].memories[1].type).toBe("otro");
    expect(p.agents[0].links).toEqual([
      { from: "a", to: "c", relation: "related" },
    ]);
  });

  it("rechaza códigos y orígenes inválidos", () => {
    expect(() =>
      parseMemoriesPayload({
        host: "x",
        agents: [{ code: "Mal Código", source: "engram" }],
      }),
    ).toThrow(MemoryValidationError);
    expect(() =>
      parseMemoriesPayload({
        host: "x",
        agents: [{ code: "horus", source: "otro" }],
      }),
    ).toThrow(MemoryValidationError);
    expect(() => parseMemoriesPayload({ agents: [] })).toThrow(
      MemoryValidationError,
    );
  });
});

describe("tipos y temas", () => {
  it("normaliza los tipos de engram", () => {
    expect(normalizarTipo("bugfix")).toBe("correccion");
    expect(normalizarTipo("feedback")).toBe("preferencia");
    expect(normalizarTipo("session_summary")).toBe("resumen");
    expect(normalizarTipo(undefined)).toBe("otro");
  });
  it("toma el prefijo del topic_key como tema del mapa personal", () => {
    expect(temaPrincipal({ topic: "sgc/encabezado", type: "regla" })).toBe(
      "sgc",
    );
    expect(temaPrincipal({ topic: null, type: "decision" })).toBe("decisión");
  });
});
