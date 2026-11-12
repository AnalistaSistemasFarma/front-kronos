"use client";

import { useMemo, useState } from "react";
import {
  Card,
  Group,
  ScrollArea,
  SimpleGrid,
  Text,
  Tooltip,
} from "@mantine/core";
import { Bar } from "react-chartjs-2";
import type { ChartOptions } from "chart.js";
import "../../../lib/charts/register";
import { mergeChartOptionsForTheme } from "../../../lib/charts/chartColorScheme";
import type { GraficosDto } from "../../../lib/agent-audit/automation-db";
import {
  DetalleSemanaModal,
  type CeldaSeleccionada,
} from "./DetalleSemanaModal";

/**
 * Gráficos del Indicador de automatizaciones (Nicolás, 2026-10-30):
 *   - Mapa de calor: % de mejora en tiempo por departamento y semana.
 *   - Barras agrupadas: horas de la persona sin IA vs con IA por departamento.
 * Mismos colores de la página: gris = sin IA, verde = con IA / mejora.
 */

const GRIS = "#868e96";
const VERDE = "#40c057";

const h = (v: number, dec = 0) =>
  v.toLocaleString("es-CO", {
    maximumFractionDigits: dec,
    minimumFractionDigits: dec,
  });
const fechaCorta = (iso: string) => {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
};

/**
 * Verde más intenso a más mejora. La escala se ajusta al rango real de los
 * datos (mín.–máx.): si todo está entre 58 % y 75 %, igual se ve el contraste.
 */
function fondoCelda(
  mejora: number | null,
  oscuro: boolean,
  min = 0,
  max = 80,
): string {
  if (mejora === null) return "transparent";
  const t =
    max > min ? Math.max(0, Math.min(1, (mejora - min) / (max - min))) : 1;
  const alfa = 0.12 + t * 0.78;
  return oscuro ? `rgba(64,192,87,${alfa})` : `rgba(47,158,68,${alfa})`;
}

export function GraficosMejora({
  graficos,
  oscuro,
}: {
  graficos: GraficosDto;
  oscuro: boolean;
}) {
  const deptos = graficos.departamentos;
  const semanas = graficos.semanas;
  const [celda, setCelda] = useState<CeldaSeleccionada | null>(null);

  const datosBarras = useMemo(
    () => ({
      labels: deptos.map((d) => d.departamento),
      datasets: [
        {
          label: "Persona sin IA (horas)",
          data: deptos.map((d) => d.horasSinIA),
          backgroundColor: GRIS,
          borderRadius: 4,
        },
        {
          label: "Persona con IA (horas)",
          data: deptos.map((d) => d.horasConIA),
          backgroundColor: VERDE,
          borderRadius: 4,
        },
      ],
    }),
    [deptos],
  );
  const opciones = useMemo(
    () =>
      mergeChartOptionsForTheme<"bar">(
        {
          indexAxis: "y",
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: "top" },
            tooltip: {
              callbacks: {
                label: (ctx) => `${ctx.dataset.label}: ${h(Number(ctx.raw))} h`,
                afterBody: (items) => {
                  const d = deptos[items[0]?.dataIndex ?? -1];
                  return d && d.mejora !== null
                    ? `Capacidad liberada: ${h(d.mejora, 1)} %`
                    : "";
                },
              },
            },
          },
          scales: {
            x: {
              title: { display: true, text: "Horas en el periodo" },
              beginAtZero: true,
            },
            y: { ticks: { autoSkip: false } },
          },
        } as ChartOptions<"bar">,
        oscuro,
      ),
    [deptos, oscuro],
  );

  const valores = deptos
    .flatMap((d) => d.celdas.map((c) => c.mejora))
    .filter((v): v is number => v !== null);
  const vMin = valores.length ? Math.floor(Math.min(...valores)) : 0;
  const vMax = valores.length ? Math.ceil(Math.max(...valores)) : 80;
  const fondo = (m: number | null) => fondoCelda(m, oscuro, vMin, vMax);
  const claro = (m: number | null) =>
    m !== null &&
    !oscuro &&
    (vMax > vMin ? (m - vMin) / (vMax - vMin) : 1) >= 0.55;

  if (!deptos.length) return null;
  const alto = Math.max(260, deptos.length * 44 + 80);

  return (
    <SimpleGrid cols={1} spacing="md" mb="md">
      <Card withBorder radius="md" padding="md" className="chat-surface">
        <Text fw={600} size="sm">
          Mapa de calor: capacidad liberada por departamento y semana
        </Text>
        <Text size="xs" c="dimmed" mb="sm">
          Cada celda: horas liberadas esa semana (arriba) y % de capacidad
          liberada = 1 − horas de la persona con IA ÷ horas sin IA (abajo). El
          color sigue el %. Vacío = esa semana no hubo tareas medidas. Toque
          una celda para ver qué se hizo esa semana y por qué.
        </Text>
        {semanas.length === 0 ? (
          <Text size="xs" c="dimmed">
            El detalle por semana aparece desde el siguiente análisis.
          </Text>
        ) : (
          <ScrollArea type="auto">
            <table
              style={{
                borderCollapse: "separate",
                borderSpacing: 3,
                fontSize: 12,
                minWidth: 120 + semanas.length * 62,
              }}
            >
              <thead>
                <tr>
                  <th
                    style={{
                      textAlign: "left",
                      fontWeight: 600,
                      padding: "2px 6px",
                    }}
                  >
                    Departamento
                  </th>
                  {semanas.map((s, i) => (
                    <th
                      key={s}
                      style={{
                        fontWeight: 600,
                        padding: "2px 4px",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Sem {i + 1}
                      <div style={{ fontWeight: 400, opacity: 0.6 }}>
                        {fechaCorta(s)}
                      </div>
                    </th>
                  ))}
                  <th style={{ fontWeight: 700, padding: "2px 6px" }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {deptos.map((d) => (
                  <tr key={d.departamento}>
                    <td
                      style={{
                        padding: "2px 6px",
                        whiteSpace: "nowrap",
                        fontWeight: 600,
                      }}
                    >
                      {d.departamento}
                      {d.agentes.length > 0 && (
                        <div
                          style={{
                            fontWeight: 400,
                            fontSize: 10,
                            opacity: 0.65,
                            maxWidth: 180,
                            whiteSpace: "normal",
                          }}
                        >
                          {d.agentes.join(", ")}
                        </div>
                      )}
                    </td>
                    {d.celdas.map((c, i) => (
                      <Tooltip
                        key={c.semana}
                        withArrow
                        disabled={c.mejora === null}
                        label={`Sin IA ${h(c.horasSinIA, 1)} h · con IA ${h(c.horasConIA, 1)} h · liberadas ${h(c.horasSinIA - c.horasConIA, 1)} h`}
                      >
                        <td
                          role={c.mejora === null ? undefined : "button"}
                          tabIndex={c.mejora === null ? undefined : 0}
                          aria-label={
                            c.mejora === null
                              ? undefined
                              : `Ver detalle de ${d.departamento}, semana ${i + 1}`
                          }
                          onClick={
                            c.mejora === null
                              ? undefined
                              : () =>
                                  setCelda({
                                    departamento: d.departamento,
                                    semana: c.semana,
                                    numero: i + 1,
                                  })
                          }
                          onKeyDown={(e) => {
                            if (c.mejora === null) return;
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setCelda({
                                departamento: d.departamento,
                                semana: c.semana,
                                numero: i + 1,
                              });
                            }
                          }}
                          style={{
                            cursor: c.mejora === null ? undefined : "pointer",
                            background: fondo(c.mejora),
                            border:
                              "1px solid var(--mantine-color-default-border)",
                            borderRadius: 4,
                            textAlign: "center",
                            padding: "6px 4px",
                            minWidth: 56,
                            fontWeight: 600,
                            color:
                              c.mejora !== null && c.mejora >= 50 && !oscuro
                                ? "#fff"
                                : undefined,
                          }}
                        >
                          {c.mejora === null ? "" : `${h(c.horasSinIA - c.horasConIA, 1)} h`}
                          {c.mejora !== null && (
                            <div
                              style={{
                                fontSize: 10,
                                fontWeight: 400,
                                opacity: 0.85,
                              }}
                            >
                              {h(c.mejora)} %
                            </div>
                          )}
                        </td>
                      </Tooltip>
                    ))}
                    <td
                      style={{
                        background: fondo(d.mejora),
                        borderRadius: 4,
                        textAlign: "center",
                        padding: "6px 6px",
                        fontWeight: 700,
                        color:
                          d.mejora !== null && d.mejora >= 50 && !oscuro
                            ? "#fff"
                            : undefined,
                      }}
                    >
                      {d.mejora === null ? "—" : `${h(d.horasSinIA - d.horasConIA, 1)} h`}
                      {d.mejora !== null && (
                        <div style={{ fontSize: 10, fontWeight: 400, opacity: 0.85 }}>{h(d.mejora)} %</div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
        )}
        <Group gap={6} mt="xs" wrap="nowrap">
          <Text size="xs" c="dimmed">
            {`${h(vMin)} %`}
          </Text>
          {[0, 0.25, 0.5, 0.75, 1]
            .map((f) => vMin + f * (vMax - vMin))
            .map((v) => (
              <div
                key={v}
                style={{
                  width: 22,
                  height: 10,
                  borderRadius: 2,
                  background: fondo(v),
                }}
              />
            ))}
          <Text size="xs" c="dimmed">
            {`${h(vMax)} %`}
          </Text>
        </Group>
      </Card>

      <DetalleSemanaModal celda={celda} onClose={() => setCelda(null)} />

      <Card withBorder radius="md" padding="md" className="chat-surface">
        <Text fw={600} size="sm">
          Horas por departamento: persona sin IA vs con IA
        </Text>
        <Text size="xs" c="dimmed" mb="sm">
          Gris: lo que habría tomado hacerlo a mano. Verde: lo que toma ahora
          pedirlo y revisarlo. La diferencia es el tiempo liberado en el
          periodo.
        </Text>
        <div style={{ height: alto, position: "relative" }}>
          <Bar data={datosBarras} options={opciones} />
        </div>
      </Card>
    </SimpleGrid>
  );
}
