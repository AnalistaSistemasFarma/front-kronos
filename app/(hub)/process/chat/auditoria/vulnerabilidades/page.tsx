"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  Center,
  Checkbox,
  Group,
  Loader,
  Menu,
  Pagination,
  Select,
  SimpleGrid,
  Table,
  Tabs,
  Text,
  TextInput,
  Title,
  Tooltip,
} from "@mantine/core";
import { IconAlertCircle, IconArrowLeft, IconBug, IconCircleCheck, IconCode, IconDownload, IconFlame, IconRefresh, IconSearch } from "@tabler/icons-react";
import AmenazasGlobales from "./amenazas-globales";
import type { HallazgoVulnDto, VulnsDto } from "../../../../../../lib/agent-audit/vulns-db";
import {
  enlaceOsv,
  esReciente,
  ESTADOS_VULN,
  SEVERIDADES_VULN,
  type EstadoVuln,
  type SeveridadVuln,
} from "../../../../../../lib/agent-audit/vulns-rules";

/**
 * AUDITORÍA DE AGENTES → VULNERABILIDADES (OSV), pedido de Nicolás Rivera 2026-11-19.
 * Las dependencias reales de cada repositorio (npm, Go, Python) consultadas en OSV cada 6 horas o con
 * «Escanear ahora». Arriba lo reciente (publicado o aparecido en los últimos 7 días) para actuar rápido.
 * Solo administración.
 */

const COLOR_SEV: Record<SeveridadVuln, string> = { critica: "red", alta: "orange", media: "yellow", baja: "gray", desconocida: "gray" };
const COLOR_EST: Record<EstadoVuln, string> = { nuevo: "blue", en_revision: "violet", corregido: "green", aceptado: "gray", falso_positivo: "gray" };
const POR_PAGINA = 50;
const fecha = (v: string | null) => (v ? new Date(v).toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const fechaHora = (v: string | null) => (v ? new Date(v).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" }) : "—");
const repoCorto = (r: string) => r.split("/")[1] ?? r;

export default function VulnerabilidadesPage() {
  const [datos, setDatos] = useState<VulnsDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noDisponible, setNoDisponible] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [pidiendo, setPidiendo] = useState(false);
  const [fRepo, setFRepo] = useState<string | null>(null);
  const [fSev, setFSev] = useState<string | null>(null);
  const [fEst, setFEst] = useState<string | null>(null);
  const [soloRecientes, setSoloRecientes] = useState(false);
  const [soloDirectas, setSoloDirectas] = useState(false);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [guardando, setGuardando] = useState<number | null>(null);
  // Tab «Lo más reciente y crítico» (2026-11-20); remembered in the URL (?tab=criticas).
  const [tab, setTab] = useState<string>("codigo");
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("tab") === "criticas") setTab("criticas");
  }, []);
  const cambiarTab = (v: string | null) => {
    const t = v ?? "codigo";
    setTab(t);
    const u = new URL(window.location.href);
    if (t === "criticas") u.searchParams.set("tab", "criticas");
    else u.searchParams.delete("tab");
    window.history.replaceState(null, "", u.toString());
  };

  const cargar = useCallback(async () => {
    try {
      const r = await fetch("/api/chat/auditoria/vulnerabilidades", { cache: "no-store" });
      const j = await r.json();
      if (r.status === 503) return setNoDisponible(true);
      if (!r.ok) throw new Error(j?.error ?? "No se pudieron cargar las vulnerabilidades.");
      setDatos(j);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    void cargar();
  }, [cargar]);
  useEffect(() => {
    if (!datos?.activa) return;
    const t = setInterval(() => void cargar(), 15_000);
    return () => clearInterval(t);
  }, [datos?.activa, cargar]);
  useEffect(() => setPage(1), [fRepo, fSev, fEst, soloRecientes, soloDirectas, q]);

  const escanear = async () => {
    setPidiendo(true);
    try {
      const r = await fetch("/api/chat/auditoria/vulnerabilidades/escanear", { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "No se pudo pedir el escaneo.");
      setAviso("Escaneo pedido. El escáner lo toma en unos minutos y esta página se actualiza sola.");
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPidiendo(false);
    }
  };

  const revisar = async (h: HallazgoVulnDto, estado: EstadoVuln) => {
    setGuardando(h.id);
    try {
      const r = await fetch(`/api/chat/auditoria/vulnerabilidades/hallazgos/${h.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado, nota: h.nota }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "No se pudo guardar.");
      setAviso(`${h.vulnId} en ${h.paquete}: «${ESTADOS_VULN[estado]}».`);
      window.scrollTo({ top: 0, behavior: "smooth" });
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGuardando(null);
    }
  };

  const reciente = (h: HallazgoVulnDto) => esReciente(h.publicada) || esReciente(h.primeraVez);
  const todos = datos?.hallazgos ?? [];
  const filtrados = useMemo(() => {
    const t = q.trim().toLowerCase();
    return todos
      .filter((h) => !fRepo || h.repo === fRepo)
      .filter((h) => !fSev || h.severidad === fSev)
      .filter((h) => !fEst || h.estado === fEst)
      .filter((h) => !soloDirectas || h.directa)
      .filter((h) => !soloRecientes || reciente(h))
      .filter((h) => !t || [h.paquete, h.vulnId, h.alias, h.resumen].some((x) => (x ?? "").toLowerCase().includes(t)));
  }, [todos, fRepo, fSev, fEst, soloDirectas, soloRecientes, q]);  

  const conteo = useMemo(() => {
    const c: Record<string, number> = {};
    for (const h of todos) c[h.severidad] = (c[h.severidad] ?? 0) + 1;
    return c;
  }, [todos]);
  const recientes = useMemo(
    () => todos.filter((h) => reciente(h) && (h.severidad === "critica" || h.severidad === "alta") && h.estado !== "corregido"),
    [todos],  
  );
  const repos = useMemo(() => [...new Set(todos.map((h) => h.repo))].sort(), [todos]);

  const exportar = () => {
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const enc = ["Severidad", "Repositorio", "Rama", "Archivo", "Ecosistema", "Paquete", "Versión", "Directa", "Vulnerabilidad", "CVE/alias", "Resumen", "Corregida en", "Publicada", "Primera vez", "Estado", "Enlace"];
    const filas = filtrados.map((h) =>
      [SEVERIDADES_VULN[h.severidad], h.repo, h.rama, h.archivo, h.ecosistema, h.paquete, h.version, h.directa ? "Sí" : "No", h.vulnId, h.alias ?? "", h.resumen ?? "",
        h.versionCorregida ?? "", fecha(h.publicada), fecha(h.primeraVez), ESTADOS_VULN[h.estado], h.referencia ?? enlaceOsv(h.vulnId)].map(esc).join(";"),
    );
    const url = URL.createObjectURL(new Blob([`﻿${[enc.map(esc).join(";"), ...filas].join("\r\n")}`], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `vulnerabilidades-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const fila = (h: HallazgoVulnDto) => (
    <Table.Tr key={h.id} style={{ verticalAlign: "top" }}>
      <Table.Td>
        <Badge color={COLOR_SEV[h.severidad]} variant="light">
          {SEVERIDADES_VULN[h.severidad]}
        </Badge>
        {reciente(h) && (
          <Badge color="red" variant="outline" size="xs" mt={4} display="block">
            Reciente
          </Badge>
        )}
      </Table.Td>
      <Table.Td>
        <Text size="sm" fw={600}>
          {h.paquete}@{h.version}
        </Text>
        <Text size="xs" c="dimmed">
          {h.ecosistema} · {h.directa ? "dependencia directa" : "transitiva"}
        </Text>
      </Table.Td>
      <Table.Td>
        <Text size="sm">{repoCorto(h.repo)}</Text>
        <Tooltip label={h.archivo}>
          <Text size="xs" c="dimmed">
            rama {h.rama}
          </Text>
        </Tooltip>
      </Table.Td>
      <Table.Td style={{ maxWidth: 420 }}>
        <Anchor href={h.referencia ?? enlaceOsv(h.vulnId)} target="_blank" rel="noopener noreferrer" size="sm" fw={600}>
          {h.vulnId}
        </Anchor>
        {h.alias && (
          <Text size="xs" c="dimmed" span>
            {" "}
            · {h.alias}
          </Text>
        )}
        <Text size="xs" lineClamp={2}>
          {h.resumen ?? "—"}
        </Text>
      </Table.Td>
      <Table.Td>
        <Text size="sm">{h.versionCorregida ?? "Sin corrección aún"}</Text>
      </Table.Td>
      <Table.Td>
        <Text size="xs">Publicada {fecha(h.publicada)}</Text>
        <Text size="xs" c="dimmed">
          Vista {fecha(h.primeraVez)}
        </Text>
      </Table.Td>
      <Table.Td>
        <Menu shadow="md" width={180}>
          <Menu.Target>
            <Tooltip label={h.revisadoPor ? `${h.revisadoPor} · ${fechaHora(h.revisadoEn)}` : "Cambiar estado"}>
              <Badge color={COLOR_EST[h.estado]} variant="light" style={{ cursor: "pointer" }}>
                {guardando === h.id ? "Guardando…" : ESTADOS_VULN[h.estado]}
              </Badge>
            </Tooltip>
          </Menu.Target>
          <Menu.Dropdown>
            {(Object.keys(ESTADOS_VULN) as EstadoVuln[]).map((e) => (
              <Menu.Item key={e} disabled={e === h.estado} onClick={() => void revisar(h, e)}>
                {ESTADOS_VULN[e]}
              </Menu.Item>
            ))}
          </Menu.Dropdown>
        </Menu>
      </Table.Td>
    </Table.Tr>
  );

  const encabezado = (
    <Table.Thead>
      <Table.Tr>
        <Table.Th>Severidad</Table.Th>
        <Table.Th>Paquete</Table.Th>
        <Table.Th>Repositorio</Table.Th>
        <Table.Th>Vulnerabilidad</Table.Th>
        <Table.Th>Corregida en</Table.Th>
        <Table.Th>Fechas</Table.Th>
        <Table.Th>Estado</Table.Th>
      </Table.Tr>
    </Table.Thead>
  );

  const ultimo = datos?.ultimo;
  const activa = datos?.activa;

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
          <IconBug size={26} className="chat-folder__icon" />
          <Title order={1} className="ios-process-hub__title text-3xl">
            Vulnerabilidades
          </Title>
        </Group>
        <Tabs value={tab} onChange={cambiarTab} mb="md">
          <Tabs.List>
            <Tabs.Tab value="codigo" leftSection={<IconCode size={14} />}>
              Nuestro código
            </Tabs.Tab>
            <Tabs.Tab value="criticas" leftSection={<IconFlame size={14} />}>
              Lo más reciente y crítico
            </Tabs.Tab>
          </Tabs.List>
        </Tabs>
        {tab === "criticas" ? (
          <AmenazasGlobales />
        ) : (
          <>
        <Text className="ios-process-hub__subtitle" mb="lg">
          Las dependencias reales de cada desarrollo (npm, Go y Python), en sus ramas de producción y pruebas, consultadas en OSV
          (base abierta de vulnerabilidades de Google) cada 6 horas. Arriba, lo crítico y alto que salió en los últimos 7 días.
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
            El escaneo de vulnerabilidades aún no está habilitado en este ambiente.
          </Alert>
        )}
        {activa && (
          <Alert color="blue" radius="md" mb="md" icon={<Loader size={16} />}>
            Escaneo #{activa.id} {activa.status === "en_curso" ? "en curso" : "pendiente"}
            {activa.solicitadoPor ? `, pedido por ${activa.solicitadoPor}` : " (programado)"}. {activa.progreso ?? ""}
          </Alert>
        )}
        {ultimo?.status === "fallido" && (
          <Alert color="yellow" radius="md" mb="md" icon={<IconAlertCircle size={18} />}>
            El último escaneo falló: {ultimo.error ?? "sin detalle"}. Se muestra el anterior.
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
              <Group justify="space-between" wrap="wrap">
                <Text size="sm">
                  {ultimo?.status === "terminado"
                    ? `Último escaneo: ${fechaHora(ultimo.terminadoEn)} · ${ultimo.repos ?? 0} repositorios · ${ultimo.paquetes ?? 0} paquetes revisados · ${ultimo.nuevas ?? 0} hallazgos nuevos.`
                    : "Todavía no hay un escaneo terminado."}
                </Text>
                <Group gap="xs">
                  <Button size="xs" leftSection={<IconRefresh size={14} />} loading={pidiendo} disabled={Boolean(activa)} onClick={() => void escanear()}>
                    Escanear ahora
                  </Button>
                  <Button size="xs" variant="default" leftSection={<IconDownload size={14} />} disabled={!filtrados.length} onClick={exportar}>
                    Exportar
                  </Button>
                </Group>
              </Group>
            </Card>

            <SimpleGrid cols={{ base: 2, sm: 5 }} spacing="sm" mb="md">
              {(["critica", "alta", "media", "baja"] as SeveridadVuln[]).map((s) => (
                <Card key={s} withBorder radius="md" padding="sm" className="chat-surface" style={{ cursor: "pointer" }} onClick={() => setFSev(fSev === s ? null : s)}>
                  <Text size="xs" c="dimmed">
                    {SEVERIDADES_VULN[s]}
                  </Text>
                  <Text fw={700} size="xl" c={conteo[s] ? COLOR_SEV[s] : undefined}>
                    {conteo[s] ?? 0}
                  </Text>
                </Card>
              ))}
              <Card withBorder radius="md" padding="sm" className="chat-surface" style={{ cursor: "pointer" }} onClick={() => setSoloRecientes(!soloRecientes)}>
                <Text size="xs" c="dimmed">
                  Recientes (7 días)
                </Text>
                <Text fw={700} size="xl" c={todos.some(reciente) ? "red" : undefined}>
                  {todos.filter(reciente).length}
                </Text>
              </Card>
            </SimpleGrid>

            {recientes.length > 0 && (
              <Card withBorder radius="md" padding="md" mb="md" className="chat-surface" style={{ borderColor: "var(--mantine-color-red-4)" }}>
                <Text fw={700} mb="xs" c="red">
                  Atender primero: {recientes.length} críticas o altas de los últimos 7 días
                </Text>
                <Table.ScrollContainer minWidth={900}>
                  <Table verticalSpacing="xs">
                    {encabezado}
                    <Table.Tbody>{recientes.slice(0, 20).map(fila)}</Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
              </Card>
            )}

            <Card withBorder radius="md" padding="md" className="chat-surface">
              <Group gap="xs" mb="sm" wrap="wrap">
                <TextInput size="xs" placeholder="Paquete, GHSA o CVE" leftSection={<IconSearch size={14} />} value={q} onChange={(e) => setQ(e.currentTarget.value)} />
                <Select size="xs" placeholder="Repositorio" clearable value={fRepo} onChange={setFRepo} data={repos.map((r) => ({ value: r, label: repoCorto(r) }))} />
                <Select size="xs" placeholder="Severidad" clearable value={fSev} onChange={setFSev} data={Object.entries(SEVERIDADES_VULN).map(([value, label]) => ({ value, label }))} />
                <Select size="xs" placeholder="Estado" clearable value={fEst} onChange={setFEst} data={Object.entries(ESTADOS_VULN).map(([value, label]) => ({ value, label }))} />
                <Checkbox size="xs" label="Solo recientes" checked={soloRecientes} onChange={(e) => setSoloRecientes(e.currentTarget.checked)} />
                <Checkbox size="xs" label="Solo directas" checked={soloDirectas} onChange={(e) => setSoloDirectas(e.currentTarget.checked)} />
                <Text size="xs" c="dimmed">
                  {filtrados.length} de {todos.length}
                </Text>
              </Group>
              {filtrados.length === 0 ? (
                <Center py="lg">
                  <Text size="sm">{todos.length ? "Ningún hallazgo con esos filtros." : "Sin vulnerabilidades conocidas en el último escaneo."}</Text>
                </Center>
              ) : (
                <>
                  <Table.ScrollContainer minWidth={900}>
                    <Table verticalSpacing="xs" highlightOnHover>
                      {encabezado}
                      <Table.Tbody>{filtrados.slice((page - 1) * POR_PAGINA, page * POR_PAGINA).map(fila)}</Table.Tbody>
                    </Table>
                  </Table.ScrollContainer>
                  {filtrados.length > POR_PAGINA && (
                    <Group justify="center" mt="sm">
                      <Pagination size="sm" total={Math.ceil(filtrados.length / POR_PAGINA)} value={page} onChange={setPage} />
                    </Group>
                  )}
                </>
              )}
            </Card>
            {ultimo?.resumen && (
              <Text size="xs" c="dimmed" mt="md">
                {ultimo.resumen}
              </Text>
            )}
          </>
        )}
          </>
        )}
      </div>
    </div>
  );
}
