"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Alert,
  Badge,
  Card,
  Group,
  Progress,
  ScrollArea,
  Select,
  SimpleGrid,
  Table,
  Text,
  Tooltip,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconArrowDownRight,
  IconArrowRight,
  IconArrowUpRight,
  IconCircleCheck,
  IconCircleX,
} from "@tabler/icons-react";
import type { ProgramadaDto } from "../../../lib/agent-audit/scheduled-db";
import { resumirProgramadas } from "../../../lib/agent-audit/scheduled";

/**
 * AUTOMATIZACIONES PROGRAMADAS (Indicador de automatizaciones, Nicolás
 * 2026-11-04): lo que cada agente corre solo (launchd, cron u openclaw cron),
 * cuándo corre, cuántas veces corrió y cuántas terminaron bien, su última
 * corrida, su producción y la tendencia. Se muestra APARTE de los casos del
 * chat: no suma horas ahorradas. Lo publica el recolector de la Mac de horus.
 * La usan la pestaña del indicador (todos los agentes) y la ficha del agente.
 */

const h = (v: number | null | undefined, dec = 0) =>
  v === null || v === undefined
    ? "—"
    : v.toLocaleString("es-CO", {
        maximumFractionDigits: dec,
        minimumFractionDigits: dec,
      });
const fechaHora = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("es-CO", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

const ESTADO: Record<string, { color: string; label: string }> = {
  activa: { color: "green", label: "Activa" },
  pausada: { color: "gray", label: "Pausada" },
  fallando: { color: "red", label: "Fallando" },
  sin_datos: { color: "yellow", label: "Sin datos" },
};
const TIPO: Record<string, string> = {
  launchd: "launchd",
  cron: "cron",
  openclaw: "openclaw",
};
const EQUIPO: Record<string, string> = {
  local: "Mac de Horus",
  jorge: "Mac de Jorge",
  pedro: "Mac de Pedro",
  lisa: "Mac de Lisa",
  cosmo: "Mac de Cosmo",
};
/** Más de 2 días sin que el recolector la vea: el equipo no respondió. */
const VIEJA_MS = 2 * 86_400_000;

function colorPct(p: number | null) {
  if (p === null) return "gray";
  if (p >= 90) return "green";
  if (p >= 70) return "yellow";
  return "red";
}

function TendenciaIcono({ t }: { t: ProgramadaDto["tendencia"] }) {
  if (t === "sube")
    return (
      <Tooltip label="Mejor que las 4 semanas anteriores" withArrow>
        <IconArrowUpRight size={16} color="var(--mantine-color-green-6)" />
      </Tooltip>
    );
  if (t === "baja")
    return (
      <Tooltip label="Peor que las 4 semanas anteriores" withArrow>
        <IconArrowDownRight size={16} color="var(--mantine-color-red-6)" />
      </Tooltip>
    );
  if (t === "estable")
    return (
      <Tooltip label="Igual que las 4 semanas anteriores" withArrow>
        <IconArrowRight size={16} color="var(--mantine-color-gray-6)" />
      </Tooltip>
    );
  return (
    <Text size="xs" c="dimmed">
      —
    </Text>
  );
}

/** Barras por semana (últimas 12): verde = terminó bien, rojo = falló. */
function Semanas({ p }: { p: ProgramadaDto }) {
  const ws = p.semanas.slice(-12);
  const max = Math.max(1, ...ws.map((w) => w.corridas));
  if (!ws.length) return null;
  return (
    <Tooltip
      withArrow
      multiline
      w={220}
      label={ws
        .map(
          (w) =>
            `${w.inicio.slice(8, 10)}/${w.inicio.slice(5, 7)}: ${w.ok}/${w.corridas} bien`,
        )
        .join(" · ")}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: 2,
          height: 22,
          minWidth: 60,
        }}
        aria-label="Corridas por semana"
      >
        {ws.map((w) => (
          <div
            key={w.inicio}
            style={{
              width: 5,
              height: `${Math.max(2, (w.corridas / max) * 22)}px`,
              display: "flex",
              flexDirection: "column-reverse",
              borderRadius: 1,
              overflow: "hidden",
              background: "var(--mantine-color-red-5)",
            }}
          >
            <div
              style={{
                height: `${w.corridas ? (w.ok / w.corridas) * 100 : 0}%`,
                background: "var(--mantine-color-green-6)",
              }}
            />
          </div>
        ))}
      </div>
    </Tooltip>
  );
}

export function AutomatizacionesProgramadas({
  programadas,
  mostrarAgente = true,
  filtro,
}: {
  /** null = la tabla aún no está habilitada en este ambiente. */
  programadas: ProgramadaDto[] | null | undefined;
  mostrarAgente?: boolean;
  /** Filtro externo (búsqueda y empresa de la página del indicador). */
  filtro?: (p: ProgramadaDto) => boolean;
}) {
  const [estado, setEstado] = useState<string | null>(null);
  const lista = useMemo(
    () =>
      (programadas ?? [])
        .filter((p) => !filtro || filtro(p))
        .filter((p) => !estado || p.estado === estado),
    [programadas, filtro, estado],
  );
  const res = useMemo(() => resumirProgramadas(lista), [lista]);

  if (programadas === null || programadas === undefined)
    return (
      <Alert color="gray" radius="md" icon={<IconAlertCircle size={18} />}>
        Las automatizaciones programadas aún no están habilitadas en este
        ambiente.
      </Alert>
    );

  const ahora = Date.now();
  return (
    <>
      <Card
        withBorder
        radius="md"
        padding="md"
        mb="md"
        className="chat-surface"
      >
        <Text fw={600} size="sm" mb={6}>
          Automatizaciones programadas
        </Text>
        <Text size="xs" c="dimmed" mb="sm">
          Tareas que los agentes corren solos, a una hora fija, sin que nadie
          las pida en el chat. Se cuentan aparte: no suman horas ahorradas.
        </Text>
        <SimpleGrid cols={{ base: 2, sm: 3, lg: 6 }} spacing="sm">
          {(
            [
              ["Automatizaciones", h(res.total), undefined],
              ["Activas", h(res.activas), "green"],
              ["Pausadas", h(res.pausadas), undefined],
              ["Fallando", h(res.fallando), res.fallando ? "red" : undefined],
              ["Corridas en 30 días", h(res.corridas30), undefined],
              [
                "Terminadas bien (30 días)",
                res.pctOk30 === null ? "—" : `${h(res.pctOk30, 1)} %`,
                res.pctOk30 === null ? undefined : colorPct(res.pctOk30),
              ],
            ] as [string, string, string | undefined][]
          ).map(([l, v, c]) => (
            <div key={l}>
              <Text size="xs" c="dimmed">
                {l}
              </Text>
              <Text fw={700} c={c}>
                {v}
              </Text>
            </div>
          ))}
        </SimpleGrid>
      </Card>

      <Card withBorder radius="md" padding="md" className="chat-surface">
        <Group justify="space-between" mb={6} wrap="wrap" gap="xs">
          <Text fw={600} size="sm">
            {mostrarAgente ? "Por agente" : "Detalle"} ({lista.length})
          </Text>
          <Select
            size="xs"
            placeholder="Todos los estados"
            clearable
            value={estado}
            onChange={setEstado}
            data={Object.entries(ESTADO).map(([value, e]) => ({
              value,
              label: e.label,
            }))}
            w={180}
          />
        </Group>
        {lista.length === 0 ? (
          <Text size="sm" c="dimmed">
            {programadas.length
              ? "Ninguna automatización coincide con el filtro."
              : "Este agente no tiene automatizaciones programadas."}
          </Text>
        ) : (
          <ScrollArea type="auto">
            <Table
              striped
              highlightOnHover
              verticalSpacing={6}
              fz="sm"
              miw={mostrarAgente ? 1150 : 1000}
            >
              <Table.Thead>
                <Table.Tr>
                  {mostrarAgente && <Table.Th>Agente</Table.Th>}
                  <Table.Th>Automatización</Table.Th>
                  <Table.Th>Cuándo corre</Table.Th>
                  <Table.Th>Estado</Table.Th>
                  <Table.Th>Última corrida</Table.Th>
                  <Table.Th ta="right">Corridas 30 d</Table.Th>
                  <Table.Th ta="right">Corridas 90 d</Table.Th>
                  <Table.Th>% bien (30 d)</Table.Th>
                  <Table.Th>Producción</Table.Th>
                  <Table.Th>Tendencia</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {lista.map((p) => {
                  const e = ESTADO[p.estado] ?? ESTADO.sin_datos;
                  const vieja =
                    p.vistoAt && ahora - Date.parse(p.vistoAt) > VIEJA_MS;
                  return (
                    <Table.Tr key={p.clave}>
                      {mostrarAgente && (
                        <Table.Td>
                          <Link
                            href={`/process/chat/auditoria/automatizaciones/${encodeURIComponent(p.code)}`}
                            style={{ fontWeight: 600, fontSize: 14 }}
                          >
                            {p.displayName}
                          </Link>
                          <br />
                          {p.empresa && (
                            <Badge size="xs" variant="light" color="indigo">
                              {p.empresa}
                            </Badge>
                          )}
                        </Table.Td>
                      )}
                      <Table.Td style={{ maxWidth: 340 }}>
                        <Text size="sm" fw={600}>
                          {p.nombre}
                        </Text>
                        {p.descripcion && (
                          <Text size="xs" c="dimmed">
                            {p.descripcion}
                          </Text>
                        )}
                        <Group gap={4} mt={2}>
                          <Badge size="xs" variant="outline" color="gray">
                            {TIPO[p.tipo] ?? p.tipo}
                          </Badge>
                          <Text size="xs" c="dimmed">
                            {EQUIPO[p.host] ?? p.host}
                          </Text>
                        </Group>
                      </Table.Td>
                      <Table.Td style={{ minWidth: 140 }}>
                        <Text size="xs">{p.programacion ?? "—"}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Tooltip
                          label={p.estadoDetalle ?? e.label}
                          withArrow
                          multiline
                          w={260}
                          disabled={!p.estadoDetalle}
                        >
                          <Badge size="sm" variant="light" color={e.color}>
                            {e.label}
                          </Badge>
                        </Tooltip>
                        {vieja && (
                          <Text size="xs" c="orange" mt={2}>
                            Sin datos nuevos desde {fechaHora(p.vistoAt)}
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td style={{ whiteSpace: "nowrap" }}>
                        <Group gap={4} wrap="nowrap">
                          {p.ultimaOk === true && (
                            <IconCircleCheck
                              size={14}
                              color="var(--mantine-color-green-6)"
                              aria-label="Terminó bien"
                            />
                          )}
                          {p.ultimaOk === false && (
                            <IconCircleX
                              size={14}
                              color="var(--mantine-color-red-6)"
                              aria-label="Falló"
                            />
                          )}
                          <Text size="xs">{fechaHora(p.ultimaCorrida)}</Text>
                        </Group>
                      </Table.Td>
                      <Table.Td ta="right">{h(p.corridas30)}</Table.Td>
                      <Table.Td ta="right">{h(p.corridas90)}</Table.Td>
                      <Table.Td style={{ minWidth: 120 }}>
                        <Text size="xs" fw={600} c={colorPct(p.pctOk30)}>
                          {p.pctOk30 === null ? "—" : `${h(p.pctOk30, 1)} %`}
                        </Text>
                        {p.pctOk30 !== null && (
                          <Progress
                            value={p.pctOk30}
                            color={colorPct(p.pctOk30)}
                            size="xs"
                            mt={2}
                          />
                        )}
                        <Text size="xs" c="dimmed">
                          90 d:{" "}
                          {p.pctOk90 === null ? "—" : `${h(p.pctOk90, 1)} %`}
                        </Text>
                      </Table.Td>
                      <Table.Td style={{ minWidth: 140 }}>
                        {p.produccionEtiqueta ? (
                          <>
                            <Text size="sm" fw={600}>
                              {h(p.produccion30)}{" "}
                              <Text span size="xs" c="dimmed" fw={400}>
                                en 30 d · {h(p.produccion90)} en 90 d
                              </Text>
                            </Text>
                            <Text size="xs" c="dimmed">
                              {p.produccionEtiqueta}
                            </Text>
                          </>
                        ) : (
                          <Text size="xs" c="dimmed">
                            —
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td>
                        <Group gap={6} wrap="nowrap">
                          <TendenciaIcono t={p.tendencia} />
                          <Semanas p={p} />
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        )}
        <Text size="xs" c="dimmed" mt={6}>
          Barras: corridas por semana (verde = terminó bien, rojo = falló).
          Tendencia: últimas 4 semanas frente a las 4 anteriores. El recolector
          lee los equipos de los agentes en solo lectura.
        </Text>
        {mostrarAgente && (
          <Text size="xs" c="dimmed" mt={2}>
            Pulse el nombre del agente para abrir su ficha, con sus
            automatizaciones junto a sus casos del chat.
          </Text>
        )}
      </Card>
    </>
  );
}
