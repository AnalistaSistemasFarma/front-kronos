"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Alert,
  Badge,
  Button,
  Card,
  Center,
  Group,
  Loader,
  Menu,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Textarea,
  Title,
  Tooltip,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconArrowLeft,
  IconCircleCheck,
  IconDownload,
  IconShieldExclamation,
  IconShieldSearch,
} from "@tabler/icons-react";
import type { AnalisisSeguridadDto, HallazgoDto } from "../../../../../../lib/agent-audit/security-db";
import {
  CATEGORIAS,
  CUMPLIO,
  ESTADOS,
  SEVERIDADES,
  type Categoria,
  type EstadoHallazgo,
  type Severidad,
} from "../../../../../../lib/agent-audit/security-rules";

/**
 * AUDITORÍA DE AGENTES → ANÁLISIS DE SEGURIDAD DE CONVERSACIONES (Nicolás, 2026-11-05).
 * «Analizar» deja una corrida; el analizador (Mac de horus, cada 5 min) lee en solo lectura
 * los mensajes del mes entre operadores y agentes, busca inyecciones de prompt, fugas de datos
 * e instrucciones maliciosas, y publica los hallazgos. La evidencia (texto) solo se ve con el
 * permiso de conversaciones; los secretos llegan ya enmascarados.
 */

type Respuesta = AnalisisSeguridadDto & { periodos: string[]; puedeAnalizar: boolean };

const COLOR_SEVERIDAD: Record<Severidad, string> = { critica: "red", alta: "orange", media: "yellow", baja: "gray" };
const COLOR_ESTADO: Record<EstadoHallazgo, string> = { nuevo: "blue", revisado: "green", falso_positivo: "gray", escalado: "red" };

const fechaHora = (v: string | null) =>
  v ? new Date(v).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" }) : "—";
const nombreMes = (p: string) => {
  const [a, m] = p.split("-").map(Number);
  const t = new Date(Date.UTC(a, m - 1, 15)).toLocaleDateString("es-CO", { month: "long", year: "numeric", timeZone: "UTC" });
  return t.charAt(0).toUpperCase() + t.slice(1);
};

export default function AnalisisSeguridadPage() {
  const [periodo, setPeriodo] = useState<string | null>(null);
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noDisponible, setNoDisponible] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [pidiendo, setPidiendo] = useState(false);
  const [fSeveridad, setFSeveridad] = useState<string | null>(null);
  const [fCategoria, setFCategoria] = useState<string | null>(null);
  const [fEstado, setFEstado] = useState<string | null>(null);
  const [abierto, setAbierto] = useState<number | null>(null);
  const [nota, setNota] = useState("");
  const [guardando, setGuardando] = useState<number | null>(null);

  const cargar = useCallback(async (p: string | null) => {
    try {
      const r = await fetch(`/api/chat/auditoria/seguridad${p ? `?periodo=${p}` : ""}`, { cache: "no-store" });
      const j = await r.json();
      if (r.status === 503) {
        setNoDisponible(true);
        return;
      }
      if (!r.ok) throw new Error(j?.error ?? "No se pudo cargar el análisis.");
      setDatos(j);
      setPeriodo((prev) => prev ?? j.periodo);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    // ?analizar=1 (desde el botón de la página principal) ya pidió el análisis: solo se avisa.
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("analizar") === "1")
      setAviso("Análisis pedido. El analizador lo toma en unos minutos y esta página se actualiza sola.");
    void cargar(null);
  }, [cargar]);

  useEffect(() => {
    if (periodo && datos && periodo !== datos.periodo) void cargar(periodo);
  }, [periodo, datos, cargar]);

  // Mientras haya un análisis pendiente o en curso, se refresca cada 15 s.
  useEffect(() => {
    if (!datos?.activa) return;
    const t = setInterval(() => void cargar(periodo), 15_000);
    return () => clearInterval(t);
  }, [datos?.activa, periodo, cargar]);

  const analizar = async () => {
    setPidiendo(true);
    try {
      const r = await fetch("/api/chat/auditoria/seguridad/analizar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periodo }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "No se pudo pedir el análisis.");
      setAviso("Análisis pedido. El analizador lo toma en unos minutos y esta página se actualiza sola.");
      await cargar(periodo);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPidiendo(false);
    }
  };

  const revisar = async (h: HallazgoDto, estado: EstadoHallazgo) => {
    setGuardando(h.id);
    try {
      const r = await fetch(`/api/chat/auditoria/seguridad/hallazgos/${h.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado, nota: abierto === h.id ? nota : h.nota }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "No se pudo guardar la revisión.");
      setAviso(`Hallazgo #${h.id} marcado como «${ESTADOS[estado]}».`);
      window.scrollTo({ top: 0, behavior: "smooth" });
      await cargar(periodo);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGuardando(null);
    }
  };

  const hallazgos = useMemo(
    () =>
      (datos?.hallazgos ?? [])
        .filter((h) => !fSeveridad || h.severidad === fSeveridad)
        .filter((h) => !fCategoria || h.categoria === fCategoria)
        .filter((h) => !fEstado || h.estado === fEstado),
    [datos, fSeveridad, fCategoria, fEstado],
  );

  const conteo = useMemo(() => {
    const s: Record<string, number> = {};
    for (const h of datos?.hallazgos ?? []) {
      s[h.severidad] = (s[h.severidad] ?? 0) + 1;
      s[h.categoria] = (s[h.categoria] ?? 0) + 1;
      if (h.estado === "nuevo") s.nuevos = (s.nuevos ?? 0) + 1;
    }
    return s;
  }, [datos]);

  const exportar = () => {
    const escapar = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const enc = ["Id", "Fecha", "Agente", "Persona", "Quién lo dijo", "Categoría", "Severidad", "¿El agente cumplió?", "Estado",
      ...(datos?.conTexto ? ["Evidencia", "Explicación", "Recomendación", "Nota"] : [])];
    const filas = hallazgos.map((h) =>
      [String(h.id), fechaHora(h.fecha), h.agente ?? "", h.persona ?? "", h.rol === "user" ? "Operador" : "Agente",
        CATEGORIAS[h.categoria], SEVERIDADES[h.severidad], h.agenteCumplio ? CUMPLIO[h.agenteCumplio] : "", ESTADOS[h.estado],
        ...(datos?.conTexto ? [h.evidencia ?? "", h.explicacion ?? "", h.recomendacion ?? "", h.nota ?? ""] : [])]
        .map(escapar).join(";"),
    );
    const csv = `﻿${[enc.map(escapar).join(";"), ...filas].join("\r\n")}`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `analisis-seguridad-${datos?.periodo ?? "mes"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const activa = datos?.activa;
  const ultima = datos?.ultima;

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
        </Group>

        <Group gap="sm" mb={2} wrap="nowrap">
          <IconShieldSearch size={26} className="chat-folder__icon" />
          <Title order={1} className="ios-process-hub__title text-3xl">
            Análisis de seguridad
          </Title>
        </Group>
        <Text className="ios-process-hub__subtitle" mb="lg">
          Revisa las conversaciones del mes entre operadores y agentes buscando inyecciones de prompt,
          instrucciones maliciosas, fugas de datos, intentos de sacar información y de saltarse controles.
          Los secretos que aparezcan se muestran ocultos.
        </Text>

        {aviso && (
          <Alert color="green" radius="md" mb="md" icon={<IconCircleCheck size={18} />} withCloseButton onClose={() => setAviso(null)}>
            {aviso}
          </Alert>
        )}
        {error && (
          <Alert color="red" radius="md" mb="md" icon={<IconAlertCircle size={18} />} withCloseButton onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
        {noDisponible && (
          <Alert color="yellow" radius="md" mb="md" icon={<IconAlertCircle size={18} />}>
            El análisis de seguridad aún no está habilitado en este ambiente.
          </Alert>
        )}
        {activa && (
          <Alert color="blue" radius="md" mb="md" icon={<Loader size={16} />}>
            Análisis #{activa.id} de {nombreMes(activa.periodo)} {activa.status === "en_curso" ? "en curso" : "pendiente"}
            {activa.solicitadoPor ? `, pedido por ${activa.solicitadoPor}` : ""} el {fechaHora(activa.solicitadoEn)}.
            {activa.progreso ? ` ${activa.progreso}` : activa.status === "pendiente" ? " El analizador lo toma en unos minutos." : ""}
          </Alert>
        )}
        {ultima?.status === "fallido" && (
          <Alert color="yellow" radius="md" mb="md" icon={<IconAlertCircle size={18} />}>
            El último análisis de {nombreMes(ultima.periodo)} falló: {ultima.error ?? "sin detalle"}.
          </Alert>
        )}

        {!datos && !error && !noDisponible && (
          <Center py="xl">
            <Loader size="sm" />
          </Center>
        )}

        {datos && (
          <>
            <Card withBorder radius="md" padding="md" mb="md" className="chat-surface">
              <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="sm">
                <Select
                  label="Mes"
                  size="xs"
                  value={periodo}
                  onChange={(v) => v && setPeriodo(v)}
                  data={datos.periodos.map((p) => ({ value: p, label: nombreMes(p) }))}
                  allowDeselect={false}
                />
                {datos.puedeAnalizar && (
                  <Group mt={20} gap="xs">
                    <Button
                      size="xs"
                      leftSection={<IconShieldSearch size={14} />}
                      loading={pidiendo}
                      disabled={Boolean(activa)}
                      onClick={() => void analizar()}
                    >
                      Analizar {periodo ? nombreMes(periodo).toLowerCase() : "el mes"}
                    </Button>
                  </Group>
                )}
              </SimpleGrid>
              <Text size="xs" c="dimmed" mt={8}>
                {ultima?.status === "terminado"
                  ? `Último análisis: ${fechaHora(ultima.terminadoEn)} · ${ultima.conversaciones ?? 0} conversaciones · ${ultima.mensajesOperador ?? 0} mensajes de operadores y ${ultima.mensajesAgente ?? 0} de agentes revisados${ultima.modelo ? ` · ${ultima.modelo}` : ""}.`
                  : "Este mes todavía no se ha analizado."}
              </Text>
              {ultima?.resumen && (
                <Text size="sm" mt={6}>
                  {ultima.resumen}
                </Text>
              )}
            </Card>

            {ultima?.status === "terminado" && (
              <SimpleGrid cols={{ base: 2, sm: 5 }} spacing="sm" mb="md">
                {(["critica", "alta", "media", "baja"] as Severidad[]).map((s) => (
                  <Card key={s} withBorder radius="md" padding="sm" className="chat-surface">
                    <Text size="xs" c="dimmed">
                      {SEVERIDADES[s]}
                    </Text>
                    <Text fw={700} size="xl" c={conteo[s] ? COLOR_SEVERIDAD[s] : undefined}>
                      {conteo[s] ?? 0}
                    </Text>
                  </Card>
                ))}
                <Card withBorder radius="md" padding="sm" className="chat-surface">
                  <Text size="xs" c="dimmed">
                    Sin revisar
                  </Text>
                  <Text fw={700} size="xl">
                    {conteo.nuevos ?? 0}
                  </Text>
                </Card>
              </SimpleGrid>
            )}

            {ultima?.status === "terminado" && (
              <Card withBorder radius="md" padding="md" className="chat-surface">
                <Group justify="space-between" mb="sm" wrap="wrap">
                  <Group gap="xs">
                    <Select size="xs" placeholder="Severidad" clearable value={fSeveridad} onChange={setFSeveridad}
                      data={Object.entries(SEVERIDADES).map(([value, label]) => ({ value, label }))} />
                    <Select size="xs" placeholder="Categoría" clearable value={fCategoria} onChange={setFCategoria}
                      data={Object.entries(CATEGORIAS).map(([value, label]) => ({ value, label: `${label} (${conteo[value] ?? 0})` }))} />
                    <Select size="xs" placeholder="Estado" clearable value={fEstado} onChange={setFEstado}
                      data={Object.entries(ESTADOS).map(([value, label]) => ({ value, label }))} />
                  </Group>
                  <Button size="xs" variant="default" leftSection={<IconDownload size={14} />} onClick={exportar} disabled={!hallazgos.length}>
                    Exportar
                  </Button>
                </Group>

                {!datos.conTexto && (
                  <Alert color="gray" radius="md" mb="sm" icon={<IconAlertCircle size={16} />}>
                    Ve los hallazgos sin el texto de las conversaciones: la evidencia exige el permiso de conversaciones de la auditoría.
                  </Alert>
                )}

                {hallazgos.length === 0 ? (
                  <Center py="lg">
                    <Group gap="xs">
                      <IconCircleCheck size={18} color="var(--mantine-color-green-6)" />
                      <Text size="sm">
                        {datos.hallazgos.length === 0 ? "No se encontró nada sospechoso en este mes." : "Ningún hallazgo con esos filtros."}
                      </Text>
                    </Group>
                  </Center>
                ) : (
                  <Table.ScrollContainer minWidth={900}>
                    <Table verticalSpacing="xs" highlightOnHover>
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>Severidad</Table.Th>
                          <Table.Th>Categoría</Table.Th>
                          <Table.Th>Fecha</Table.Th>
                          <Table.Th>Agente / persona</Table.Th>
                          <Table.Th>Qué se encontró</Table.Th>
                          <Table.Th>¿Cumplió?</Table.Th>
                          <Table.Th>Estado</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {hallazgos.map((h) => (
                          <Table.Tr key={h.id} style={{ verticalAlign: "top" }}>
                            <Table.Td>
                              <Badge color={COLOR_SEVERIDAD[h.severidad]} variant="light">
                                {SEVERIDADES[h.severidad]}
                              </Badge>
                            </Table.Td>
                            <Table.Td>
                              <Text size="sm">{CATEGORIAS[h.categoria as Categoria]}</Text>
                              <Text size="xs" c="dimmed">
                                {h.rol === "user" ? "Lo escribió el operador" : "Lo respondió el agente"}
                                {h.detector !== "ia" ? " · reglas" : ""}
                              </Text>
                            </Table.Td>
                            <Table.Td>
                              <Text size="xs">{fechaHora(h.fecha)}</Text>
                              <Text size="xs" c="dimmed">
                                Conv. #{h.idConversation}
                              </Text>
                            </Table.Td>
                            <Table.Td>
                              <Text size="sm">{h.agente ?? "—"}</Text>
                              <Text size="xs" c="dimmed">
                                {h.persona ?? ""}
                              </Text>
                            </Table.Td>
                            <Table.Td style={{ maxWidth: 420 }}>
                              {h.evidencia !== null ? (
                                <Stack gap={4}>
                                  <Text size="xs" ff="monospace" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
                                    lineClamp={abierto === h.id ? undefined : 3}>
                                    {h.evidencia}
                                  </Text>
                                  {h.explicacion && (
                                    <Text size="xs" lineClamp={abierto === h.id ? undefined : 2}>
                                      {h.explicacion}
                                    </Text>
                                  )}
                                  {abierto === h.id && h.recomendacion && (
                                    <Text size="xs" c="dimmed">
                                      Recomendación: {h.recomendacion}
                                    </Text>
                                  )}
                                  {abierto === h.id && (
                                    <Textarea size="xs" placeholder="Nota de la revisión (opcional)" autosize minRows={2} maxLength={1000}
                                      value={nota} onChange={(e) => setNota(e.currentTarget.value)} />
                                  )}
                                  <Button size="compact-xs" variant="subtle" w="fit-content"
                                    onClick={() => { setAbierto(abierto === h.id ? null : h.id); setNota(h.nota ?? ""); }}>
                                    {abierto === h.id ? "Recoger" : "Ver detalle y revisar"}
                                  </Button>
                                </Stack>
                              ) : (
                                <Text size="xs" c="dimmed">
                                  (texto reservado)
                                </Text>
                              )}
                            </Table.Td>
                            <Table.Td>
                              <Text size="sm">{h.agenteCumplio ? CUMPLIO[h.agenteCumplio] : "—"}</Text>
                            </Table.Td>
                            <Table.Td>
                              {datos.conTexto ? (
                                <Menu shadow="md" width={180}>
                                  <Menu.Target>
                                    <Tooltip label={h.revisadoPor ? `${h.revisadoPor} · ${fechaHora(h.revisadoEn)}` : "Cambiar estado"}>
                                      <Badge color={COLOR_ESTADO[h.estado]} variant="light" style={{ cursor: "pointer" }}>
                                        {guardando === h.id ? "Guardando…" : ESTADOS[h.estado]}
                                      </Badge>
                                    </Tooltip>
                                  </Menu.Target>
                                  <Menu.Dropdown>
                                    {(Object.keys(ESTADOS) as EstadoHallazgo[]).map((e) => (
                                      <Menu.Item key={e} onClick={() => void revisar(h, e)} disabled={e === h.estado}>
                                        {ESTADOS[e]}
                                      </Menu.Item>
                                    ))}
                                  </Menu.Dropdown>
                                </Menu>
                              ) : (
                                <Badge color={COLOR_ESTADO[h.estado]} variant="light">
                                  {ESTADOS[h.estado]}
                                </Badge>
                              )}
                            </Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  </Table.ScrollContainer>
                )}
              </Card>
            )}

            {datos.historial.length > 0 && (
              <Text size="xs" c="dimmed" mt="md">
                <IconShieldExclamation size={12} style={{ verticalAlign: "middle" }} /> Análisis recientes:{" "}
                {datos.historial
                  .slice(0, 6)
                  .map((c) => `#${c.id} ${nombreMes(c.periodo)} (${c.status === "terminado" ? `${c.hallazgos ?? 0} hallazgos` : c.status.replace("_", " ")})`)
                  .join(" · ")}
              </Text>
            )}
          </>
        )}
      </div>
    </div>
  );
}
