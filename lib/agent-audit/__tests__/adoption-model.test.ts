import { describe, expect, it } from "vitest";
import {
  activeAtWeekEnd,
  addWeeks,
  buildWeeklySeries,
  companyKey,
  fitAdoption,
  growthGap,
  weekRange,
  weekStart,
} from "../adoption-model";

const logistic = (t: number, k: number, r: number, t0: number) => k / (1 + Math.exp(-r * (t - t0)));

describe("weeks", () => {
  it("returns the Monday of the week", () => {
    expect(weekStart("2026-11-26")).toBe("2026-11-23");
    expect(weekStart("2026-11-23")).toBe("2026-11-23");
    expect(weekStart("2026-11-29")).toBe("2026-11-23");
  });
  it("builds inclusive ranges", () => {
    expect(weekRange("2026-09-07", "2026-09-21")).toEqual(["2026-09-07", "2026-09-14", "2026-09-21"]);
    expect(addWeeks("2026-12-28", 1)).toBe("2027-01-04");
  });
});

describe("companyKey", () => {
  it("joins the spellings of the three sources", () => {
    expect(companyKey("ONELATAMPHARMA")).toBe("OLP");
    expect(companyKey("ONE LATAM PHARMA")).toBe("OLP");
    expect(companyKey("OLP")).toBe("OLP");
    expect(companyKey("FARMALOGICA S.A.")).toBe("FARMALOGICA");
    expect(companyKey("FARMALÓGICA")).toBe("FARMALOGICA");
    expect(companyKey("LABORATORIOS RYAN ")).toBe("RYAN");
    expect(companyKey("ONELATAMONCO")).toBe("OLPONCO");
    expect(companyKey("GSS")).toBe("GSS");
  });
});

describe("weekly series", () => {
  const people = [
    { id: "a", createdAt: new Date("2026-09-01T00:00:00Z"), isActive: true, deactivatedAt: null },
    { id: "b", createdAt: new Date("2026-09-15T00:00:00Z"), isActive: true, deactivatedAt: null },
    { id: "c", createdAt: new Date("2026-09-01T00:00:00Z"), isActive: false, deactivatedAt: new Date("2026-09-16T00:00:00Z") },
    { id: "d", createdAt: new Date("2026-09-01T00:00:00Z"), isActive: false, deactivatedAt: null },
  ];
  it("counts headcount at week end with deactivations", () => {
    expect(activeAtWeekEnd(people[2], "2026-09-07")).toBe(true);
    expect(activeAtWeekEnd(people[2], "2026-09-14")).toBe(false);
    expect(activeAtWeekEnd(people[3], "2026-09-07")).toBe(false);
  });
  it("aggregates usage, cumulative adopters and rates", () => {
    const s = buildWeeklySeries(["2026-09-07", "2026-09-14"], people, [
      { idUser: "a", week: "2026-09-07", chatMessages: 4, projectMessages: 0 },
      { idUser: "a", week: "2026-09-14", chatMessages: 1, projectMessages: 2 },
      { idUser: "b", week: "2026-09-14", chatMessages: 3, projectMessages: 0 },
      { idUser: "zz", week: "2026-09-14", chatMessages: 9, projectMessages: 0 },
    ]);
    expect(s[0]).toMatchObject({ headcount: 2, activeAi: 1, cumulativeAi: 1, interactions: 4, activeRate: 0.5 });
    expect(s[1]).toMatchObject({ headcount: 2, activeAi: 2, cumulativeAi: 2, chatMessages: 4, projectTurns: 2, interactionsPerActive: 3 });
  });
  it("computes the growth gap in percentage points", () => {
    expect(growthGap(10, 20, 100, 110)).toBeCloseTo(90);
    expect(growthGap(0, 20, 100, 110)).toBeNull();
  });
});

describe("fitAdoption", () => {
  it("refuses with fewer than 8 weeks", () => {
    const r = fitAdoption("2026-09-07", [1, 2, 3, 4, 5], 100);
    expect(r.status).toBe("insuficiente");
    expect(r.curve).toEqual([]);
  });

  it("recovers a logistic past its inflection", () => {
    const ys = Array.from({ length: 24 }, (_, t) => logistic(t, 80, 0.45, 9));
    const r = fitAdoption("2026-01-05", ys, 300, { replicates: 40 });
    expect(r.status).toBe("confiable");
    expect(r.k!).toBeGreaterThan(76);
    expect(r.k!).toBeLessThan(84);
    expect(r.inflectionReached).toBe(true);
    // inflection near week 9 (t0), 95 % near t0 + ln(19)/r ≈ 15.5
    expect(r.inflectionWeek).toBe(addWeeks("2026-01-05", 9));
    const w95 = r.stabilizationWeek!;
    expect(w95 >= addWeeks("2026-01-05", 14) && w95 <= addWeeks("2026-01-05", 17)).toBe(true);
    expect(r.curve.length).toBe(24 + 26);
    expect(r.curve.every((p) => p.low <= p.fit + 1e-6 || p.high >= p.fit - 1e-6)).toBe(true);
  });

  it("flags an early curve whose inflection is still ahead", () => {
    const ys = Array.from({ length: 10 }, (_, t) => logistic(t, 200, 0.3, 20));
    const r = fitAdoption("2026-01-05", ys, 250, { replicates: 20 });
    expect(r.status).not.toBe("confiable");
  });
});

describe("snapshots", () => {
  it("counts only person mailboxes in M365 and skips tenants without access", async () => {
    const { m365Counts } = await import("../adoption-model");
    const r = m365Counts([
      { empresa: "ONE LATAM PHARMA", estado: "ok", usuarios: [{ correo: "ana.r@x.com" }, { correo: "pqrcolombia@x.com" }] },
      { empresa: "ABAMIA", estado: "sin_acceso", usuarios: [] },
    ]);
    expect(r).toEqual([{ source: "m365", companyKey: "OLP", area: "", headcount: 1 }]);
  });
  it("groups the HR base by company and area and builds a filtered series", async () => {
    const { thCounts, snapshotSeries } = await import("../adoption-model");
    const rows = thCounts([
      { empresa: "OLP", area: "Calidad" },
      { empresa: "OLP", area: "calidad " },
      { empresa: "GSS", area: "TI" },
    ]).map((r) => ({ ...r, week: "2026-11-23" }));
    expect(snapshotSeries(["2026-11-16", "2026-11-23"], rows, "th", null, null)).toEqual([null, 3]);
    expect(snapshotSeries(["2026-11-23"], rows, "th", ["OLP"], "CALIDAD")).toEqual([2]);
    expect(snapshotSeries(["2026-11-23"], rows, "m365", null, "CALIDAD")).toEqual([null]);
  });
});
