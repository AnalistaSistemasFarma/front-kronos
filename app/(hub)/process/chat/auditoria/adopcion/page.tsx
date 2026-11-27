"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Alert,
  Button,
  Card,
  Center,
  Group,
  Loader,
  Select,
  SimpleGrid,
  Table,
  ScrollArea,
  Text,
  Title,
  useComputedColorScheme,
} from "@mantine/core";
import { IconAlertCircle, IconArrowLeft, IconChartLine, IconRefresh } from "@tabler/icons-react";
import { Bar, Line } from "react-chartjs-2";
import type { ChartOptions } from "chart.js";
import "../../../../../../lib/charts/register";
import { getChartUiColors, mergeChartOptionsForTheme } from "../../../../../../lib/charts/chartColorScheme";
import type { AdoptionDto } from "../../../../../../lib/agent-audit/adoption-db";
import type { FitStatus, ModelName } from "../../../../../../lib/agent-audit/adoption-model";

/**
 * AUDITORÍA DE AGENTES → ADOPCIÓN DE IA VS PLANTILLA (Nicolás Rivera, 2026-11-26, conv 1 msgs 40043/40045).
 * Weekly AI adoption against headcount (SynerLink active users; Microsoft 365 licensed people and the HR
 * «BASE PERSONAL» as complements), the growth gap and an S-curve fit (logistic / Gompertz / Bass, lowest AIC)
 * that estimates the ceiling and when adoption stabilizes. THE GATE IS IN THE ENDPOINT.
 */

type ApiResponse = AdoptionDto & { canRefresh: boolean };

const n = (v: number | null | undefined, dec = 0) =>
  v === null || v === undefined || !Number.isFinite(v)
    ? "—"
    : v.toLocaleString("es-CO", { maximumFractionDigits: dec, minimumFractionDigits: dec });
const pct = (v: number | null | undefined, dec = 1) => (v === null || v === undefined ? "—" : `${n(v * 100, dec)} %`);
const pp = (v: number | null) => (v === null ? "—" : `${v > 0 ? "+" : ""}${n(v, 1)} p.p.`);
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const weekLabel = (iso: string | null) => {
  if (!iso) return "—";
  const [a, m, d] = iso.split("-").map(Number);
  return `${d} ${MESES[m - 1]} ${a}`;
};
const shortWeek = (iso: string) => {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${MESES[m - 1]}`;
};

const MODELO: Record<ModelName, string> = { logistica: "Logística", gompertz: "Gompertz", bass: "Bass (difusión)" };
const ESTADO: Record<FitStatus, { color: string; titulo: string }> = {
  confiable: { color: "green", titulo: "Predicción confiable" },
  incierto: { color: "yellow", titulo: "Predicción incierta" },
  sin_inflexion: { color: "yellow", titulo: "Aún no es predecible" },
  insuficiente: { color: "gray", titulo: "Datos insuficientes" },
};

/** Series colors: AI = the module's green; headcounts = neutral grays (context, not the story). */
function paleta(oscuro: boolean) {
  return {
    ia: oscuro ? "#51cf66" : "#2f9e44",
    iaSuave: oscuro ? "rgba(81,207,102,0.18)" : "rgba(47,158,68,0.14)",
    active: oscuro ? "#8ce99a" : "#69db7c",
    fit: oscuro ? "#e9ecef" : "#343a40",
    plantilla: oscuro ? "#adb5bd" : "#495057",
    m365: oscuro ? "#74c0fc" : "#1c7ed6",
    th: oscuro ? "#ffa94d" : "#e8590c",
    hito: oscuro ? "#ffd43b" : "#f08c00",
  };
}

export default function AdopcionIaPage() {
  const [datos, setDatos] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [empresa, setEmpresa] = useState<string | null>(null);
  const [area, setArea] = useState<string | null>(null);
  const oscuro = useComputedColorScheme("light", { getInitialValueInEffect: true }) === "dark";

  const load = useCallback(
    async (refrescar = false) => {
      setCargando(true);
      try {
        const qs = new URLSearchParams();
        if (empresa) qs.set("empresa", empresa);
        if (area) qs.set("area", area);
        if (refrescar) qs.set("refrescar", "1");
        const r = await fetch(`/api/chat/auditoria/adopcion?${qs}`, { cache: "no-store" });
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error ?? "No se pudo cargar la adopción de IA.");
        setDatos(j);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setCargando(false);
      }
    },
    [empresa, area],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const c = paleta(oscuro);
  const ui = getChartUiColors(oscuro);

  const grafico = useMemo(() => {
    if (!datos) return null;
    const obs = datos.series;
    const curva = datos.fit.curve;
    const weeks = [...new Set([...obs.map((p) => p.week), ...curva.map((p) => p.week)])].sort();
    const de = <T,>(arr: { week: string }[], f: (x: never) => T) => {
      const m = new Map(arr.map((x) => [x.week, f(x as never)]));
      return weeks.map((w) => (m.has(w) ? (m.get(w) as T) : null));
    };
    const last = obs[obs.length - 1]?.week ?? "";
    const marca = (w: string | null) => weeks.map((s) => (w && s === w ? curva.find((p) => p.week === w)?.fit ?? null : null));
    const hasCurve = curva.length > 0;
    const data = {
      labels: weeks.map(shortWeek),
      datasets: [
        ...(hasCurve
          ? [
              { label: "Banda 90 % (alta)", data: de(curva, (p: { high: number }) => p.high), borderWidth: 0, pointRadius: 0, backgroundColor: c.iaSuave, fill: "+1" as const, order: 9 },
              { label: "Banda 90 % (baja)", data: de(curva, (p: { low: number }) => p.low), borderWidth: 0, pointRadius: 0, fill: false, order: 9 },
              {
                label: `Curva ajustada (${datos.fit.best ? MODELO[datos.fit.best] : "—"})`,
                data: de(curva, (p: { fit: number }) => p.fit),
                borderColor: c.fit,
                borderWidth: 1.5,
                borderDash: [6, 4],
                pointRadius: 0,
                fill: false,
                order: 3,
              },
            ]
          : []),
        { label: "Han usado IA (acumulado)", data: de(obs, (p: { cumulativeAi: number }) => p.cumulativeAi), borderColor: c.ia, backgroundColor: c.ia, borderWidth: 3, pointRadius: 3, fill: false, order: 1 },
        { label: "Activos con IA en la semana", data: de(obs, (p: { activeAi: number }) => p.activeAi), borderColor: c.active, backgroundColor: c.active, borderWidth: 2, pointRadius: 2, fill: false, order: 2 },
        { label: "Plantilla SynerLink (usuarios activos)", data: de(obs, (p: { headcount: number }) => p.headcount), borderColor: c.plantilla, backgroundColor: c.plantilla, borderWidth: 2, pointRadius: 0, fill: false, order: 4 },
        { label: "Personas con licencia Microsoft 365", data: de(obs, (p: { m365: number | null }) => p.m365), borderColor: c.m365, backgroundColor: c.m365, borderWidth: 1.5, pointRadius: 4, spanGaps: true, fill: false, order: 5 },
        { label: "Base de personal (Talento Humano)", data: de(obs, (p: { th: number | null }) => p.th), borderColor: c.th, backgroundColor: c.th, borderWidth: 1.5, pointRadius: 4, spanGaps: true, fill: false, order: 6 },
        ...(hasCurve
          ? [
              { label: "Inflexión", data: marca(datos.fit.inflectionWeek), borderColor: c.hito, backgroundColor: c.hito, pointStyle: "triangle" as const, pointRadius: 8, showLine: false, order: 0 },
              { label: "Estabilización (95 % del techo)", data: marca(datos.fit.stabilizationWeek), borderColor: c.hito, backgroundColor: c.hito, pointStyle: "rectRot" as const, pointRadius: 8, showLine: false, order: 0 },
            ]
          : []),
      ],
    };
    return { data, lastObserved: last ? shortWeek(last) : "—" };
  }, [datos, c]);

  const options = useMemo(
    () =>
      mergeChartOptionsForTheme<"line">(
        {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: "index", intersect: false },
          plugins: {
            legend: {
              position: "bottom",
              labels: { boxWidth: 12, filter: (it) => !String(it.text).startsWith("Banda 90 % (baja)") },
            },
            tooltip: {
              filter: (it) => it.parsed.y !== null && !String(it.dataset.label).startsWith("Banda"),
              callbacks: { label: (it) => `${it.dataset.label}: ${n(it.parsed.y, 0)}` },
            },
          },
          scales: {
            x: { grid: { color: ui.grid }, ticks: { color: ui.label, maxRotation: 0, autoSkipPadding: 12 } },
            y: { beginAtZero: true, grid: { color: ui.grid }, ticks: { color: ui.label }, title: { display: true, text: "Personas", color: ui.label } },
          },
        },
        oscuro,
      ),
    [oscuro, ui],
  );

  const interacciones = useMemo(() => {
    if (!datos) return null;
    return {
      labels: datos.series.map((p) => shortWeek(p.week)),
      datasets: [
        { type: "bar" as const, label: "Mensajes en el chat", data: datos.series.map((p) => p.chatMessages), backgroundColor: c.ia, stack: "i", yAxisID: "y" },
        { type: "bar" as const, label: "Turnos en proyectos", data: datos.series.map((p) => p.projectTurns), backgroundColor: c.m365, stack: "i", yAxisID: "y" },
        {
          type: "line" as const,
          label: "Interacciones por persona activa",
          data: datos.series.map((p) => p.interactionsPerActive),
          borderColor: c.fit,
          backgroundColor: c.fit,
          borderWidth: 2,
          pointRadius: 2,
          yAxisID: "y1",
        },
      ],
    };
  }, [datos, c]);

  const interOptions = useMemo(
    () =>
      mergeChartOptionsForTheme<"bar">(
        {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: "index", intersect: false },
          plugins: { legend: { position: "bottom", labels: { boxWidth: 12 } } },
          scales: {
            x: { stacked: true, grid: { display: false }, ticks: { color: ui.label, maxRotation: 0, autoSkipPadding: 12 } },
            y: { stacked: true, beginAtZero: true, grid: { color: ui.grid }, ticks: { color: ui.label }, title: { display: true, text: "Interacciones", color: ui.label } },
            y1: { position: "right", beginAtZero: true, grid: { display: false }, ticks: { color: ui.label }, title: { display: true, text: "Por persona", color: ui.label } },
          },
        },
        oscuro,
      ),
    [oscuro, ui],
  );

  const f = datos?.fit;
  const k = datos?.kpis;
  const estado = f ? ESTADO[f.status] : null;

  return (
    <div className="app-page-shell app-page-shell--fill ios-process-hub min-h-screen">
      <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        <Group gap="xs" mb={4}>
          <Link href="/process/chat/auditoria" className="chat-text-muted" style={{ fontSize: 13 }}>
            <Group gap={4} wrap="nowrap">
              <IconArrowLeft size={14} />
              <span>Volver a Auditoría de agentes</span>
            </Group>
          </Link>
          <Text size="xs" c="dimmed">
            ·
          </Text>
          <Link href="/process/chat/auditoria/automatizaciones" className="chat-text-muted" style={{ fontSize: 13 }}>
            Ver indicador de automatizaciones
          </Link>
        </Group>

        <Group gap="sm" mb={2} wrap="nowrap">
          <IconChartLine size={26} className="chat-folder__icon" />
          <Title order={1} className="ios-process-hub__title text-3xl">
            Adopción de IA vs plantilla
          </Title>
        </Group>
        <Text className="ios-process-hub__subtitle" mb="lg">
          Cuántas personas usan los agentes frente a cuántas personas hay, semana a semana, y cuándo se estima que la
          adopción se estabiliza.
          {datos ? ` Desde el ${weekLabel(datos.historyStart)} hasta la semana del ${weekLabel(datos.lastWeek)} (la semana en curso no se cuenta).` : ""}
        </Text>

        <Card withBorder radius="md" padding="md" mb="md" className="chat-surface">
          <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
            <Select
              label="Empresa"
              size="xs"
              placeholder="Todas"
              clearable
              value={empresa}
              onChange={setEmpresa}
              data={(datos?.companies ?? []).map((x) => ({ value: String(x.id), label: x.name }))}
            />
            <Select
              label="Área"
              size="xs"
              placeholder="Todas"
              clearable
              searchable
              value={area}
              onChange={setArea}
              data={(datos?.departments ?? []).map((x) => ({ value: String(x.id), label: x.name }))}
            />
            {datos?.canRefresh && (
              <Group mt={20}>
                <Button size="xs" leftSection={<IconRefresh size={14} />} loading={cargando} onClick={() => void load(true)}>
                  Recalcular ahora
                </Button>
              </Group>
            )}
          </SimpleGrid>
          <Text size="xs" c="dimmed" mt={8}>
            El modelo se recalcula cada 6 horas o con Recalcular ahora. Calculado: {datos ? new Date(datos.generatedAt).toLocaleString("es-CO") : "—"}.
          </Text>
        </Card>

        {error && (
          <Alert color="red" radius="md" icon={<IconAlertCircle size={18} />} mb="md">
            {error}
          </Alert>
        )}
        {!datos && !error && (
          <Center py="xl">
            <Loader size="sm" />
          </Center>
        )}

        {datos && f && k && estado && (
          <>
            <SimpleGrid cols={{ base: 2, sm: 3, lg: 6 }} spacing="sm" mb="md">
              {[
                { t: "Plantilla SynerLink", v: n(k.headcount), s: `M365: ${n(k.m365)} · TH: ${n(k.th)}` },
                { t: "Activos con IA (semana)", v: n(k.activeAi), s: `${pct(k.activeRate)} de la plantilla` },
                { t: "Han usado IA", v: n(k.cumulativeAi), s: k.headcount ? `${pct(k.cumulativeAi / k.headcount)} de la plantilla` : "—" },
                { t: "Interacciones por persona activa", v: n(k.interactionsPerActive, 1), s: `${n(k.interactions)} en la semana` },
                { t: "Brecha (personas)", v: pp(k.gapPeople), s: "crecimiento IA − crecimiento plantilla" },
                { t: "Brecha (interacciones)", v: pp(k.gapInteractions), s: "desde la primera semana" },
              ].map((x) => (
                <Card key={x.t} withBorder radius="md" padding="sm" className="chat-surface">
                  <Text size="xs" c="dimmed">
                    {x.t}
                  </Text>
                  <Text fw={800} size="xl">
                    {x.v}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {x.s}
                  </Text>
                </Card>
              ))}
            </SimpleGrid>

            <Alert color={estado.color} radius="md" mb="md" icon={<IconAlertCircle size={18} />} title={estado.titulo}>
              <Text size="sm">{f.reason}</Text>
              {f.k !== null && (
                <Text size="sm" mt={4}>
                  Modelo: <b>{f.best ? MODELO[f.best] : "—"}</b> · Techo estimado (K): <b>{n(f.k)} personas</b> ({n(f.kLow)}–{n(f.kHigh)}, 90 %)
                  {k.headcount ? `, ${pct(f.k / k.headcount)} de la plantilla actual` : ""} · Inflexión: <b>{weekLabel(f.inflectionWeek)}</b> ·
                  95 % del techo: <b>{weekLabel(f.stabilizationWeek)}</b> ({weekLabel(f.stabilizationLow)} a {weekLabel(f.stabilizationHigh)}).
                </Text>
              )}
            </Alert>

            <Card withBorder radius="md" padding="md" mb="md" className="chat-surface">
              <Text fw={600} size="sm">
                Adopción y plantilla por semana
              </Text>
              <Text size="xs" c="dimmed" mb="sm">
                La línea verde gruesa es lo real. La punteada es la curva en S ajustada y su proyección, con la banda de confianza
                del 90 %. Última semana observada: {grafico?.lastObserved}.
              </Text>
              <div style={{ position: "relative", height: 380 }}>{grafico && <Line data={grafico.data as never} options={options} />}</div>
            </Card>

            <Card withBorder radius="md" padding="md" mb="md" className="chat-surface">
              <Text fw={600} size="sm" mb="sm">
                Interacciones con los agentes por semana
              </Text>
              <div style={{ position: "relative", height: 280 }}>
                {interacciones && <Bar data={interacciones as never} options={interOptions} />}
              </div>
            </Card>

            <Card withBorder radius="md" padding="md" mb="md" className="chat-surface">
              <Text fw={600} size="sm" mb="xs">
                Comparación de modelos
              </Text>
              {f.scores.length === 0 ? (
                <Text size="sm" c="dimmed">
                  Sin ajuste: {f.reason}
                </Text>
              ) : (
                <ScrollArea>
                  <Table striped withTableBorder fz="sm" miw={420}>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Modelo</Table.Th>
                        <Table.Th ta="right">AIC</Table.Th>
                        <Table.Th ta="right">Error (RMSE, personas)</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {f.scores.map((s) => (
                        <Table.Tr key={s.model} fw={s.model === f.best ? 700 : undefined}>
                          <Table.Td>
                            {MODELO[s.model]}
                            {s.model === f.best ? " (elegido)" : ""}
                          </Table.Td>
                          <Table.Td ta="right">{n(s.aic, 1)}</Table.Td>
                          <Table.Td ta="right">{n(s.rmse, 2)}</Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </ScrollArea>
              )}
            </Card>

            <Alert color="gray" variant="light" p="xs" mb="md">
              <Text size="xs">
                <b>Cómo se calcula.</b> Plantilla = usuarios activos de SynerLink al cierre de cada semana (con su fecha de
                creación y las desactivaciones registradas). Persona activa con IA = escribió al menos un mensaje a un agente en
                la semana (chat directo, grupo o proyecto). La curva en S se ajusta al número acumulado de personas que han usado
                IA con tres modelos (logística, Gompertz y Bass) y se elige el de menor AIC; la banda sale de un bootstrap de los
                residuos. Brecha = crecimiento del uso de IA menos crecimiento de la plantilla, desde la primera semana, en
                puntos porcentuales.
              </Text>
              <Text size="xs" mt={4}>
                <b>Fuentes complementarias.</b> Microsoft 365: personas con licencia activa por tenant (solo buzones de persona,
                nombre.apellido@; no cuenta buzones compartidos). Talento Humano: BASE PERSONAL (activos por empresa y área). Ninguna
                de las dos guarda historia: se toma una foto por semana
                {datos.sources.snapshotsAvailable
                  ? datos.sources.firstSnapshotWeek
                    ? ` desde la semana del ${weekLabel(datos.sources.firstSnapshotWeek)}`
                    : " a partir de esta semana"
                  : " cuando se habilite la tabla de fotos en este ambiente (por ahora solo se ve el valor de hoy)"}
                .{!datos.sources.m365Live ? " Microsoft 365 no respondió en esta consulta." : ""}
                {!datos.sources.thLive ? " La base de Talento Humano no respondió en esta consulta." : ""} Con filtro de área,
                Microsoft 365 no aplica (no tiene áreas).
              </Text>
            </Alert>
          </>
        )}
      </div>
    </div>
  );
}
