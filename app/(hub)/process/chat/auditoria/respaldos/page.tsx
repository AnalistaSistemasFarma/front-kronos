"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Alert,
  Badge,
  Card,
  Center,
  Group,
  Loader,
  ScrollArea,
  Select,
  SimpleGrid,
  Table,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconArrowLeft,
  IconDatabaseExport,
} from "@tabler/icons-react";
import type {
  CopiaDto,
  MaquinaDto,
  RespaldosDto,
} from "../../../../../../lib/agent-audit/backups-db";

/**
 * AUDITORÍA DE AGENTES → COPIAS DE SEGURIDAD (Nicolás, 2026-10-30): qué copias de
 * los agentes se han hecho y en qué fecha. Cada Mac copia sus agentes al NAS
 * (memorias cada hora, todo cada noche) y Acronis guarda el historial; un
 * recolector de solo lectura trae aquí los registros de cada Mac y la
 * validación de los domingos. Mismo diseño que Inventario y Memorias.
 * LA REJA ESTÁ EN EL ENDPOINT (/api/chat/auditoria/respaldos).
 */

const MAX_H_COMPLETA = 30;
const MAX_H_HORARIA = 3;

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
const fechaCorta = (dia: string) => {
  const [, m, d] = dia.split("-");
  return `${d}/${m}`;
};
const duracion = (s: number | null) => {
  if (s === null) return "—";
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};
const horasDesde = (iso: string | null) =>
  iso ? (Date.now() - Date.parse(iso)) / 3_600_000 : null;
const hace = (iso: string | null) => {
  const h = horasDesde(iso);
  if (h === null) return "";
  return h < 1
    ? `hace ${Math.round(h * 60)} min`
    : h < 48
      ? `hace ${Math.round(h)} h`
      : `hace ${Math.round(h / 24)} días`;
};

const RESULTADO: Record<string, { color: string; texto: string }> = {
  ok: { color: "green", texto: "Correcta" },
  con_avisos: { color: "yellow", texto: "Con avisos" },
  fallo: { color: "red", texto: "Falló" },
  sin_terminar: { color: "red", texto: "Sin terminar" },
  omitida: { color: "gray", texto: "Omitida (otra en curso)" },
};
const MODO: Record<string, string> = {
  completo: "Completa",
  horario: "Memorias",
  subida: "Subida al NAS",
};

type Estado = { color: string; texto: string; motivo: string };
function estadoMaquina(m: MaquinaDto, tieneHorarias: boolean): Estado {
  if (!m.alcanzable)
    return {
      color: "red",
      texto: "Sin respuesta",
      motivo: m.error ?? "La máquina no respondió al recolector.",
    };
  const hc = horasDesde(m.ultimaCompleta?.fin ?? null);
  if (hc === null || hc > MAX_H_COMPLETA)
    return {
      color: "red",
      texto: "Atrasada",
      motivo: `La última copia completa ${hc === null ? "no existe" : `es de ${hace(m.ultimaCompleta!.fin)}`} (máx. ${MAX_H_COMPLETA} h).`,
    };
  const hh = horasDesde(m.ultimaHoraria?.fin ?? null);
  if (tieneHorarias && (hh === null || hh > MAX_H_HORARIA))
    return {
      color: "yellow",
      texto: "Memorias atrasadas",
      motivo: `La última copia de memorias es de ${hace(m.ultimaHoraria?.fin ?? null)} (máx. ${MAX_H_HORARIA} h).`,
    };
  if (m.ultimaCompleta && m.ultimaCompleta.resultado !== "ok")
    return {
      color: "yellow",
      texto: "Al día, con avisos",
      motivo:
        m.ultimaCompleta.detalle ??
        "La última copia completa terminó con avisos.",
    };
  return { color: "green", texto: "Al día", motivo: "Copias vigentes." };
}

function Resultado({ c }: { c: CopiaDto | null }) {
  if (!c)
    return (
      <Text size="xs" c="dimmed">
        Sin copias
      </Text>
    );
  const r = RESULTADO[c.resultado] ?? { color: "gray", texto: c.resultado };
  return (
    <div>
      <Text size="sm">{fechaHora(c.fin ?? c.inicio)}</Text>
      <Group gap={4}>
        <Tooltip
          label={c.detalle ?? r.texto}
          withArrow
          multiline
          w={320}
          disabled={!c.detalle}
        >
          <Badge size="xs" variant="light" color={r.color}>
            {r.texto}
          </Badge>
        </Tooltip>
        <Text size="xs" c="dimmed">
          {duracion(c.segundos)} · {hace(c.fin ?? c.inicio)}
        </Text>
      </Group>
    </div>
  );
}

export default function RespaldosPage() {
  const [datos, setDatos] = useState<RespaldosDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fMaquina, setFMaquina] = useState<string | null>(null);
  const [fModo, setFModo] = useState<string | null>(null);
  const [fRes, setFRes] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    fetch("/api/chat/auditoria/respaldos", { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok)
          throw new Error(
            j?.error ?? "No se pudieron cargar las copias de seguridad.",
          );
        if (vivo) setDatos(j);
      })
      .catch(
        (e) => vivo && setError(e instanceof Error ? e.message : String(e)),
      );
    return () => {
      vivo = false;
    };
  }, []);

  const conHorarias = useMemo(
    () =>
      new Set(
        (datos?.copias ?? [])
          .filter((c) => c.modo === "horario")
          .map((c) => c.maquina),
      ),
    [datos],
  );
  const estados = useMemo(
    () =>
      new Map(
        (datos?.maquinas ?? []).map((m) => [
          m.maquina,
          estadoMaquina(m, conHorarias.has(m.maquina)),
        ]),
      ),
    [datos, conHorarias],
  );
  const dias = useMemo(() => {
    const out: string[] = [];
    const hoy = new Date(Date.now() - 5 * 3_600_000);
    for (let i = 13; i >= 0; i--)
      out.push(
        new Date(hoy.getTime() - i * 86_400_000).toISOString().slice(0, 10),
      );
    return out;
  }, []);
  const celda = useMemo(() => {
    const m = new Map<string, RespaldosDto["dias"][number]>();
    for (const d of datos?.dias ?? []) m.set(`${d.maquina}|${d.dia}`, d);
    return m;
  }, [datos]);
  const copias = useMemo(
    () =>
      (datos?.copias ?? []).filter(
        (c) =>
          (!fMaquina || c.maquina === fMaquina) &&
          (!fModo || c.modo === fModo) &&
          (!fRes || c.resultado === fRes),
      ),
    [datos, fMaquina, fModo, fRes],
  );
  const resumen = useMemo(() => {
    const ms = datos?.maquinas ?? [];
    const est = ms.map((m) => estados.get(m.maquina)!);
    const hace14 = Date.now() - 14 * 86_400_000;
    return {
      maquinas: ms.length,
      alDia: est.filter((e) => e.color === "green").length,
      alertas: est.filter((e) => e.color === "yellow").length,
      malas: est.filter((e) => e.color === "red").length,
      agentes: ms.reduce((s, m) => s + (m.agentes ?? 0), 0),
      copias14: (datos?.copias ?? []).filter(
        (c) => Date.parse(c.inicio ?? "") >= hace14,
      ).length,
      fallidas14: (datos?.copias ?? []).filter(
        (c) =>
          Date.parse(c.inicio ?? "") >= hace14 &&
          (c.resultado === "fallo" || c.resultado === "sin_terminar"),
      ).length,
    };
  }, [datos, estados]);

  return (
    <div className="app-page-shell app-page-shell--fill ios-process-hub min-h-screen">
      <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        <Group gap="xs" mb={4}>
          <Link
            href="/process/chat/auditoria"
            className="chat-text-muted"
            style={{ fontSize: 13 }}
          >
            <Group gap={4} wrap="nowrap">
              <IconArrowLeft size={14} />
              <span>Volver a Auditoría de agentes</span>
            </Group>
          </Link>
          <Text size="xs" c="dimmed">
            ·
          </Text>
          <Link
            href="/process/chat/auditoria/inventario"
            className="chat-text-muted"
            style={{ fontSize: 13 }}
          >
            Ver inventario de agentes
          </Link>
          <Text size="xs" c="dimmed">
            ·
          </Text>
          <Link
            href="/process/chat/auditoria/memorias"
            className="chat-text-muted"
            style={{ fontSize: 13 }}
          >
            Ver memorias de los agentes
          </Link>
        </Group>

        <Group gap="sm" mb={2} wrap="nowrap">
          <IconDatabaseExport size={26} className="chat-folder__icon" />
          <Title order={1} className="ios-process-hub__title text-3xl">
            Copias de seguridad de los agentes
          </Title>
        </Group>
        <Text className="ios-process-hub__subtitle" mb="lg">
          Qué copias de los agentes se han hecho y en qué fecha. Cada Mac copia
          sus agentes al NAS (las memorias cada hora y todo lo demás cada noche)
          y Acronis guarda el historial. Última lectura:{" "}
          {fechaHora(datos?.ultimaRecoleccion ?? null)} · última validación
          semanal:{" "}
          {datos?.ultimaValidacion ? fechaCorta(datos.ultimaValidacion) : "—"}.
        </Text>

        {error && (
          <Alert
            color="red"
            radius="md"
            icon={<IconAlertCircle size={18} />}
            mb="md"
          >
            {error}
          </Alert>
        )}
        {!datos && !error && (
          <Center py="xl">
            <Loader size="sm" />
          </Center>
        )}

        {datos && (
          <>
            <Card
              withBorder
              radius="md"
              padding="md"
              mb="md"
              className="chat-surface"
            >
              <Text fw={600} size="sm" mb={6}>
                Resumen
              </Text>
              <Group gap="xl" wrap="wrap">
                {[
                  ["Máquinas", resumen.maquinas, undefined],
                  ["Al día", resumen.alDia, "green"],
                  [
                    "Con alertas",
                    resumen.alertas,
                    resumen.alertas ? "yellow" : undefined,
                  ],
                  [
                    "Atrasadas o sin respuesta",
                    resumen.malas,
                    resumen.malas ? "red" : undefined,
                  ],
                  ["Agentes respaldados", resumen.agentes, undefined],
                  ["Copias en 14 días", resumen.copias14, undefined],
                  [
                    "Copias fallidas en 14 días",
                    resumen.fallidas14,
                    resumen.fallidas14 ? "red" : undefined,
                  ],
                ].map(([l, v, c]) => (
                  <div key={String(l)}>
                    <Text size="xs" c="dimmed">
                      {l}
                    </Text>
                    <Text fw={700} c={c as string | undefined}>
                      {Number(v).toLocaleString("es-CO")}
                    </Text>
                  </div>
                ))}
              </Group>
              <Text size="xs" c="dimmed" mt={8}>
                Al día = copia completa de menos de {MAX_H_COMPLETA} h y, donde
                aplica, copia de memorias de menos de {MAX_H_HORARIA} h. El
                historial de versiones lo guarda Acronis y no se ve aquí.
              </Text>
            </Card>

            <Card
              withBorder
              radius="md"
              padding="md"
              mb="md"
              className="chat-surface"
            >
              <Text fw={600} size="sm" mb={6}>
                Estado por máquina
              </Text>
              <ScrollArea type="auto">
                <Table striped verticalSpacing={6} fz="sm" miw={980}>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Máquina</Table.Th>
                      <Table.Th>Estado</Table.Th>
                      <Table.Th>Última copia completa</Table.Th>
                      <Table.Th>Última copia de memorias</Table.Th>
                      <Table.Th ta="right">Agentes</Table.Th>
                      <Table.Th ta="right">Archivos</Table.Th>
                      <Table.Th>Validación semanal</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {datos.maquinas.map((m) => {
                      const e = estados.get(m.maquina)!;
                      const v = m.validacion;
                      return (
                        <Table.Tr key={m.maquina}>
                          <Table.Td>
                            <Text size="sm" fw={600}>
                              {m.etiqueta ?? m.maquina}
                            </Text>
                            <Text
                              size="xs"
                              c="dimmed"
                              style={{
                                fontFamily:
                                  "var(--mantine-font-family-monospace)",
                              }}
                            >
                              {m.maquina}
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            <Tooltip
                              label={e.motivo}
                              withArrow
                              multiline
                              w={300}
                            >
                              <Badge size="sm" variant="light" color={e.color}>
                                {e.texto}
                              </Badge>
                            </Tooltip>
                          </Table.Td>
                          <Table.Td>
                            <Resultado c={m.ultimaCompleta} />
                          </Table.Td>
                          <Table.Td>
                            {conHorarias.has(m.maquina) ? (
                              <Resultado c={m.ultimaHoraria} />
                            ) : (
                              <Text size="xs" c="dimmed">
                                Va dentro de la completa
                              </Text>
                            )}
                          </Table.Td>
                          <Table.Td ta="right">{m.agentes ?? "—"}</Table.Td>
                          <Table.Td ta="right">
                            {m.archivos?.toLocaleString("es-CO") ?? "—"}
                          </Table.Td>
                          <Table.Td>
                            {v ? (
                              <Tooltip
                                label={
                                  [v.problemas, v.avisos]
                                    .filter(Boolean)
                                    .join(" · ") || "Sin observaciones"
                                }
                                withArrow
                                multiline
                                w={340}
                              >
                                <Badge
                                  size="sm"
                                  variant="light"
                                  color={
                                    v.estado === "ok"
                                      ? "green"
                                      : v.estado === "avisos"
                                        ? "yellow"
                                        : "red"
                                  }
                                >
                                  {v.estado === "ok"
                                    ? "Correcta"
                                    : v.estado === "avisos"
                                      ? "Con avisos"
                                      : "Con problemas"}{" "}
                                  · {fechaCorta(v.fecha)}
                                </Badge>
                              </Tooltip>
                            ) : (
                              <Text size="xs" c="dimmed">
                                Sin validar
                              </Text>
                            )}
                          </Table.Td>
                        </Table.Tr>
                      );
                    })}
                  </Table.Tbody>
                </Table>
              </ScrollArea>
            </Card>

            <Card
              withBorder
              radius="md"
              padding="md"
              mb="md"
              className="chat-surface"
            >
              <Text fw={600} size="sm">
                Calendario de copias (últimos 14 días)
              </Text>
              <Text size="xs" c="dimmed" mb="sm">
                Verde: hubo copia completa ese día. Rojo: no hubo, o falló. El
                número es la cantidad de copias de memorias o subidas del día.
              </Text>
              <ScrollArea type="auto">
                <table
                  style={{
                    borderCollapse: "separate",
                    borderSpacing: 3,
                    fontSize: 12,
                  }}
                >
                  <thead>
                    <tr>
                      <th
                        style={{
                          textAlign: "left",
                          padding: "2px 8px",
                          fontWeight: 600,
                        }}
                      >
                        Máquina
                      </th>
                      {dias.map((d) => (
                        <th
                          key={d}
                          style={{
                            padding: "2px 4px",
                            fontWeight: 600,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {fechaCorta(d)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {datos.maquinas.map((m) => (
                      <tr key={m.maquina}>
                        <td
                          style={{
                            padding: "2px 8px",
                            fontWeight: 600,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {m.maquina}
                        </td>
                        {dias.map((d) => {
                          const c = celda.get(`${m.maquina}|${d}`);
                          const ok = c && c.completasOk > 0;
                          const algo = c && (c.completas > 0 || c.horarias > 0);
                          const fondo = ok
                            ? "rgba(64,192,87,.75)"
                            : algo
                              ? "rgba(250,176,5,.55)"
                              : "rgba(250,82,82,.35)";
                          return (
                            <Tooltip
                              key={d}
                              withArrow
                              label={
                                c
                                  ? `${fechaCorta(d)}: ${c.completasOk}/${c.completas} completas correctas · ${c.horariasOk}/${c.horarias} de memorias o subidas`
                                  : `${fechaCorta(d)}: sin copias registradas`
                              }
                            >
                              <td
                                style={{
                                  background: fondo,
                                  borderRadius: 4,
                                  minWidth: 40,
                                  height: 30,
                                  textAlign: "center",
                                  fontWeight: 600,
                                }}
                              >
                                {c?.horarias ? c.horarias : ""}
                              </td>
                            </Tooltip>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollArea>
              <Text size="xs" c="dimmed" mt={6}>
                Las fechas anteriores al 29/10/2026 aparecen en rojo porque el
                respaldo arrancó ese día.
              </Text>
            </Card>

            <Card withBorder radius="md" padding="md" className="chat-surface">
              <Group
                justify="space-between"
                align="flex-end"
                mb="sm"
                wrap="wrap"
              >
                <Text fw={600} size="sm">
                  Historial de copias ({copias.length})
                </Text>
                <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
                  <Select
                    size="xs"
                    placeholder="Todas las máquinas"
                    clearable
                    value={fMaquina}
                    onChange={setFMaquina}
                    data={datos.maquinas.map((m) => m.maquina)}
                  />
                  <Select
                    size="xs"
                    placeholder="Todos los tipos"
                    clearable
                    value={fModo}
                    onChange={setFModo}
                    data={Object.entries(MODO).map(([value, label]) => ({
                      value,
                      label,
                    }))}
                  />
                  <Select
                    size="xs"
                    placeholder="Todos los resultados"
                    clearable
                    value={fRes}
                    onChange={setFRes}
                    data={Object.entries(RESULTADO).map(([value, r]) => ({
                      value,
                      label: r.texto,
                    }))}
                  />
                </SimpleGrid>
              </Group>
              <ScrollArea type="auto" mah={560}>
                <Table
                  striped
                  highlightOnHover
                  verticalSpacing={4}
                  fz="sm"
                  miw={900}
                  stickyHeader
                >
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Inicio</Table.Th>
                      <Table.Th>Fin</Table.Th>
                      <Table.Th>Máquina</Table.Th>
                      <Table.Th>Tipo</Table.Th>
                      <Table.Th ta="right">Duración</Table.Th>
                      <Table.Th>Resultado</Table.Th>
                      <Table.Th ta="right">Bases SQLite</Table.Th>
                      <Table.Th>Detalle</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {copias.map((c, i) => {
                      const r = RESULTADO[c.resultado] ?? {
                        color: "gray",
                        texto: c.resultado,
                      };
                      return (
                        <Table.Tr
                          key={`${c.maquina}-${c.modo}-${c.inicio}-${i}`}
                        >
                          <Table.Td style={{ whiteSpace: "nowrap" }}>
                            {fechaHora(c.inicio)}
                          </Table.Td>
                          <Table.Td style={{ whiteSpace: "nowrap" }}>
                            {fechaHora(c.fin)}
                          </Table.Td>
                          <Table.Td>{c.maquina}</Table.Td>
                          <Table.Td style={{ whiteSpace: "nowrap" }}>
                            {MODO[c.modo] ?? c.modo}
                          </Table.Td>
                          <Table.Td ta="right">{duracion(c.segundos)}</Table.Td>
                          <Table.Td>
                            <Badge
                              size="xs"
                              variant="light"
                              color={r.color}
                              style={{ overflow: "visible" }}
                            >
                              {r.texto}
                              {c.avisos ? ` (${c.avisos})` : ""}
                            </Badge>
                          </Table.Td>
                          <Table.Td ta="right">{c.sqlite ?? "—"}</Table.Td>
                          <Table.Td>
                            <Text size="xs" c="dimmed" lineClamp={2}>
                              {c.detalle ?? ""}
                            </Text>
                          </Table.Td>
                        </Table.Tr>
                      );
                    })}
                  </Table.Tbody>
                </Table>
              </ScrollArea>
              <Text size="xs" c="dimmed" mt={6}>
                Se muestran las últimas 500 copias. Los registros de cada Mac
                guardan 14 días; desde ahora el historial queda en SynerLink.
              </Text>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
