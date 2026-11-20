"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  Center,
  Checkbox,
  Collapse,
  Group,
  Loader,
  Modal,
  Pagination,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconChevronDown,
  IconChevronRight,
  IconCircleCheck,
  IconDownload,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconTrash,
} from "@tabler/icons-react";
import type {
  SyncDto,
  StoredItem,
} from "../../../../../../lib/agent-audit/threats-db";
import {
  MATCH_LABELS,
  nvdLink,
  SEVERITY_LABELS,
  type MatchStatus,
  type Severity,
  type ThreatRowDto,
} from "../../../../../../lib/agent-audit/threats-rules";

/**
 * Tab «Lo más reciente y crítico» (request from Nicolás Rivera, 2026-11-20): the most recent and most critical
 * vulnerabilities worldwide (CISA KEV + NVD) crossed with our third-party software inventory.
 * Administration only (the API enforces it).
 */

interface ThreatsResponse {
  active: SyncDto | null;
  last: SyncDto | null;
  lastOk: SyncDto | null;
  rows: ThreatRowDto[];
  inventory: StoredItem[];
  totalCached: number;
}

const COLOR_SEV: Record<Severity, string> = {
  critica: "red",
  alta: "orange",
  media: "yellow",
  baja: "gray",
  desconocida: "gray",
};
const COLOR_MATCH: Record<MatchStatus, string> = {
  afecta: "red",
  revisar: "yellow",
  no_aplica: "gray",
};
const PER_PAGE = 50;
const fmtDate = (v: string | null) =>
  v
    ? new Date(v).toLocaleDateString("es-CO", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";
const fmtDateTime = (v: string | null) =>
  v
    ? new Date(v).toLocaleString("es-CO", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);

type ItemForm = {
  product: string;
  vendor: string;
  version: string;
  role: string;
  cpe: string;
  keywords: string;
  notes: string;
  active: boolean;
};
const EMPTY_FORM: ItemForm = {
  product: "",
  vendor: "",
  version: "",
  role: "",
  cpe: "",
  keywords: "",
  notes: "",
  active: true,
};

export default function AmenazasGlobales() {
  const [data, setData] = useState<ThreatsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [q, setQ] = useState("");
  const [fSev, setFSev] = useState<string | null>(null);
  const [fMatch, setFMatch] = useState<string | null>(null);
  const [from, setFrom] = useState(() => isoDay(Date.now() - 30 * 86_400_000));
  const [to, setTo] = useState("");
  const [onlyKev, setOnlyKev] = useState(false);
  const [onlyOurs, setOnlyOurs] = useState(false);
  const [page, setPage] = useState(1);
  const [showInventory, setShowInventory] = useState(false);
  const [editing, setEditing] = useState<{
    id: number | null;
    form: ItemForm;
  } | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/chat/auditoria/vulnerabilidades/criticas", {
        cache: "no-store",
      });
      const j = await r.json();
      if (r.status === 503) return setUnavailable(true);
      if (!r.ok)
        throw new Error(
          j?.error ?? "No se pudo cargar el catálogo de vulnerabilidades.",
        );
      setData(j);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!data?.active) return;
    const t = setInterval(() => void load(), 10_000);
    return () => clearInterval(t);
  }, [data?.active, load]);
  useEffect(() => setPage(1), [q, fSev, fMatch, from, to, onlyKev, onlyOurs]);

  const refresh = async () => {
    setRequesting(true);
    try {
      const r = await fetch(
        "/api/chat/auditoria/vulnerabilidades/criticas/actualizar",
        { method: "POST" },
      );
      const j = await r.json();
      if (!r.ok)
        throw new Error(j?.error ?? "No se pudo pedir la actualización.");
      setNotice(
        "Actualización en curso. Sin llave de NVD puede tardar varios minutos; esta página se actualiza sola.",
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRequesting(false);
    }
  };

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    const fromT = from ? Date.parse(`${from}T00:00:00`) : null;
    const toT = to ? Date.parse(`${to}T23:59:59`) : null;
    return rows
      .filter((r) => !fSev || r.severity === fSev)
      .filter((r) => !fMatch || r.evaluation.status === fMatch)
      .filter((r) => !onlyKev || r.kev)
      .filter((r) => !onlyOurs || r.evaluation.status === "afecta")
      .filter((r) => {
        if (!fromT && !toT) return true;
        const d = r.refDate ? Date.parse(r.refDate) : NaN;
        if (!Number.isFinite(d)) return false;
        return (!fromT || d >= fromT) && (!toT || d <= toT);
      })
      .filter(
        (r) =>
          !t ||
          [
            r.cveId,
            r.title,
            r.product,
            r.titleEn,
            r.description,
            ...r.evaluation.matches.map((m) => m.product),
          ].some((x) => (x ?? "").toLowerCase().includes(t)),
      );
  }, [rows, q, fSev, fMatch, from, to, onlyKev, onlyOurs]);

  const affecting = useMemo(
    () => rows.filter((r) => r.evaluation.status === "afecta"),
    [rows],
  );
  const toReview = useMemo(
    () => rows.filter((r) => r.evaluation.status === "revisar"),
    [rows],
  );
  const recent30 = Date.now() - 30 * 86_400_000;
  const kevRecent = useMemo(
    () =>
      rows.filter(
        (r) => r.kev && r.kevAdded && Date.parse(r.kevAdded) >= recent30,
      ).length,
    [rows, recent30],
  );
  const critRecent = useMemo(
    () =>
      rows.filter(
        (r) =>
          r.severity === "critica" &&
          r.published &&
          Date.parse(r.published) >= recent30,
      ).length,
    [rows, recent30],
  );

  const exportCsv = () => {
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const head = [
      "CVE",
      "Resumen",
      "Producto",
      "CVSS",
      "Severidad",
      "Publicada",
      "Explotada (KEV)",
      "Agregada a KEV",
      "Ransomware",
      "EPSS",
      "Coincidencia",
      "Equipos",
      "Enlace",
    ];
    const lines = filtered.map((r) =>
      [
        r.cveId,
        r.title,
        r.product ?? "",
        r.cvss?.toFixed(1) ?? "",
        SEVERITY_LABELS[r.severity],
        fmtDate(r.published),
        r.kev ? "Sí" : "No",
        fmtDate(r.kevAdded),
        r.kevRansomware ? "Sí" : "No",
        r.epss === null ? "" : `${(r.epss * 100).toFixed(1)} %`,
        MATCH_LABELS[r.evaluation.status],
        r.evaluation.matches
          .map((m) => `${m.product} ${m.version ?? ""} (${m.role})`)
          .join(" | "),
        nvdLink(r.cveId),
      ]
        .map(esc)
        .join(";"),
    );
    const url = URL.createObjectURL(
      new Blob([`﻿${[head.map(esc).join(";"), ...lines].join("\r\n")}`], {
        type: "text/csv;charset=utf-8;",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `vulnerabilidades-criticas-${isoDay(Date.now())}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const saveItem = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const url = editing.id
        ? `/api/chat/auditoria/vulnerabilidades/criticas/inventario/${editing.id}`
        : "/api/chat/auditoria/vulnerabilidades/criticas/inventario";
      const r = await fetch(url, {
        method: editing.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing.form),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "No se pudo guardar.");
      setNotice(
        `«${editing.form.product}» guardado. Use «Actualizar ahora» para consultar NVD con la versión nueva.`,
      );
      setEditing(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const removeItem = async (it: StoredItem) => {
    if (!window.confirm(`¿Quitar «${it.product}» (${it.role}) del inventario?`))
      return;
    try {
      const r = await fetch(
        `/api/chat/auditoria/vulnerabilidades/criticas/inventario/${it.id}`,
        { method: "DELETE" },
      );
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "No se pudo quitar.");
      setNotice(`«${it.product}» se quitó del inventario.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const matchBadge = (r: ThreatRowDto) => {
    const ev = r.evaluation;
    const label = (
      <Badge
        color={COLOR_MATCH[ev.status]}
        variant={ev.status === "afecta" ? "filled" : "light"}
      >
        {MATCH_LABELS[ev.status]}
      </Badge>
    );
    if (!ev.matches.length) return label;
    return (
      <Tooltip
        multiline
        w={320}
        label={
          <Stack gap={4}>
            {ev.matches.slice(0, 6).map((m) => (
              <Text key={m.itemId} size="xs">
                <b>{m.product}</b> {m.version ?? "(sin versión)"} · {m.role}:{" "}
                {m.reason}
              </Text>
            ))}
          </Stack>
        }
      >
        <div style={{ cursor: "help" }}>
          {label}
          <Text size="xs" c="dimmed" mt={2} lineClamp={2}>
            {[
              ...new Set(
                ev.matches.map((m) => `${m.product} ${m.version ?? ""}`.trim()),
              ),
            ]
              .slice(0, 2)
              .join(", ")}
          </Text>
        </div>
      </Tooltip>
    );
  };

  const row = (r: ThreatRowDto) => (
    <Table.Tr key={r.cveId} style={{ verticalAlign: "top" }}>
      <Table.Td>
        <Anchor
          href={nvdLink(r.cveId)}
          target="_blank"
          rel="noopener noreferrer"
          size="sm"
          fw={600}
          style={{ whiteSpace: "nowrap" }}
        >
          {r.cveId}
        </Anchor>
      </Table.Td>
      <Table.Td style={{ maxWidth: 440 }}>
        <Text size="sm" fw={600}>
          {r.title}
        </Text>
        {r.description && (
          <Tooltip multiline w={420} label={r.description}>
            <Text size="xs" c="dimmed" lineClamp={2}>
              {r.description}
            </Text>
          </Tooltip>
        )}
      </Table.Td>
      <Table.Td>
        <Text size="sm" fw={700} style={{ whiteSpace: "nowrap" }}>
          {r.cvss !== null ? r.cvss.toFixed(1) : "—"}
        </Text>
        <Badge color={COLOR_SEV[r.severity]} variant="light" size="sm">
          {SEVERITY_LABELS[r.severity]}
        </Badge>
      </Table.Td>
      <Table.Td>
        {r.kev ? (
          <Stack gap={2}>
            <Badge color="red" variant="filled" size="sm">
              Explotada
            </Badge>
            {r.kevRansomware && (
              <Badge color="grape" variant="light" size="xs">
                Ransomware
              </Badge>
            )}
          </Stack>
        ) : (
          <Text size="xs" c="dimmed">
            No reportada
          </Text>
        )}
        {r.epss !== null && (
          <Tooltip label="EPSS: probabilidad de que se explote en los próximos 30 días (FIRST)">
            <Text size="xs" c="dimmed" mt={2}>
              EPSS {(r.epss * 100).toFixed(1)} %
            </Text>
          </Tooltip>
        )}
      </Table.Td>
      <Table.Td>
        <Text size="xs" style={{ whiteSpace: "nowrap" }}>
          Publicada {fmtDate(r.published)}
        </Text>
        {r.kevAdded && (
          <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
            En KEV {fmtDate(r.kevAdded)}
          </Text>
        )}
      </Table.Td>
      <Table.Td style={{ maxWidth: 220 }}>{matchBadge(r)}</Table.Td>
    </Table.Tr>
  );

  const head = (
    <Table.Thead>
      <Table.Tr>
        <Table.Th>CVE</Table.Th>
        <Table.Th>Resumen</Table.Th>
        <Table.Th>CVSS</Table.Th>
        <Table.Th>Explotación</Table.Th>
        <Table.Th>Fechas</Table.Th>
        <Table.Th>¿Nos afecta?</Table.Th>
      </Table.Tr>
    </Table.Thead>
  );

  const active = data?.active;
  const last = data?.last;
  const lastOk = data?.lastOk;
  const inventory = data?.inventory ?? [];
  const setField = (k: keyof ItemForm, v: string | boolean) =>
    setEditing((e) => (e ? { ...e, form: { ...e.form, [k]: v } } : e));

  return (
    <>
      <Text className="ios-process-hub__subtitle" mb="lg">
        Lo más reciente y crítico del mundo: el catálogo de vulnerabilidades
        explotadas de CISA (KEV) y las críticas y altas recientes de NVD,
        cruzadas con el software de terceros que usamos (SAP Business One,
        Tomcat, SQL Server, Windows Server, IIS, Node.js…). Se actualiza una vez
        al día o con «Actualizar ahora».
      </Text>

      {notice && (
        <Alert
          color="green"
          radius="md"
          mb="md"
          icon={<IconCircleCheck size={18} />}
          withCloseButton
          onClose={() => setNotice(null)}
        >
          {notice}
        </Alert>
      )}
      {error && (
        <Alert
          color="red"
          radius="md"
          mb="md"
          icon={<IconAlertCircle size={18} />}
          withCloseButton
          onClose={() => setError(null)}
        >
          {error}
        </Alert>
      )}
      {unavailable && (
        <Alert
          color="yellow"
          radius="md"
          mb="md"
          icon={<IconAlertCircle size={18} />}
        >
          La pestaña «Lo más reciente y crítico» aún no está habilitada en este
          ambiente.
        </Alert>
      )}
      {active && (
        <Alert color="blue" radius="md" mb="md" icon={<Loader size={16} />}>
          Actualización #{active.id}{" "}
          {active.status === "en_curso" ? "en curso" : "pendiente"}
          {active.requestedBy
            ? `, pedida por ${active.requestedBy}`
            : " (diaria)"}
          . {active.progress ?? ""}
        </Alert>
      )}
      {last?.status === "fallido" && (
        <Alert
          color="yellow"
          radius="md"
          mb="md"
          icon={<IconAlertCircle size={18} />}
        >
          La última actualización falló: {last.error ?? "sin detalle"}. Se
          muestra la información anterior.
        </Alert>
      )}
      {!data && !error && !unavailable && (
        <Center py="xl">
          <Loader size="sm" />
        </Center>
      )}

      {data && (
        <>
          <Card
            withBorder
            radius="md"
            padding="md"
            mb="md"
            className="chat-surface"
          >
            <Group justify="space-between" wrap="wrap">
              <Text size="sm">
                {lastOk
                  ? `Última actualización: ${fmtDateTime(lastOk.finishedAt)} · ${data.totalCached} vulnerabilidades en caché.`
                  : "Todavía no hay una actualización terminada."}
              </Text>
              <Group gap="xs">
                <Button
                  size="xs"
                  leftSection={<IconRefresh size={14} />}
                  loading={requesting}
                  disabled={Boolean(active)}
                  onClick={() => void refresh()}
                >
                  Actualizar ahora
                </Button>
                <Button
                  size="xs"
                  variant="default"
                  leftSection={<IconDownload size={14} />}
                  disabled={!filtered.length}
                  onClick={exportCsv}
                >
                  Exportar
                </Button>
              </Group>
            </Group>
          </Card>

          <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm" mb="md">
            <Card
              withBorder
              radius="md"
              padding="sm"
              className="chat-surface"
              style={{ cursor: "pointer" }}
              onClick={() => {
                setFMatch(fMatch === "afecta" ? null : "afecta");
                setFrom("");
              }}
            >
              <Text size="xs" c="dimmed">
                Nos afecta
              </Text>
              <Text fw={700} size="xl" c={affecting.length ? "red" : undefined}>
                {affecting.length}
              </Text>
            </Card>
            <Card
              withBorder
              radius="md"
              padding="sm"
              className="chat-surface"
              style={{ cursor: "pointer" }}
              onClick={() => {
                setFMatch(fMatch === "revisar" ? null : "revisar");
                setFrom("");
              }}
            >
              <Text size="xs" c="dimmed">
                Para revisar
              </Text>
              <Text
                fw={700}
                size="xl"
                c={toReview.length ? "yellow" : undefined}
              >
                {toReview.length}
              </Text>
            </Card>
            <Card
              withBorder
              radius="md"
              padding="sm"
              className="chat-surface"
              style={{ cursor: "pointer" }}
              onClick={() => setOnlyKev(!onlyKev)}
            >
              <Text size="xs" c="dimmed">
                Explotadas nuevas (30 días)
              </Text>
              <Text fw={700} size="xl" c={kevRecent ? "red" : undefined}>
                {kevRecent}
              </Text>
            </Card>
            <Card
              withBorder
              radius="md"
              padding="sm"
              className="chat-surface"
              style={{ cursor: "pointer" }}
              onClick={() => setFSev(fSev === "critica" ? null : "critica")}
            >
              <Text size="xs" c="dimmed">
                Críticas publicadas (30 días)
              </Text>
              <Text fw={700} size="xl">
                {critRecent}
              </Text>
            </Card>
          </SimpleGrid>

          {affecting.length > 0 && (
            <Card
              withBorder
              radius="md"
              padding="md"
              mb="md"
              className="chat-surface"
              style={{ borderColor: "var(--mantine-color-red-4)" }}
            >
              <Text fw={700} mb="xs" c="red">
                Atender primero: {affecting.length}{" "}
                {affecting.length === 1
                  ? "vulnerabilidad afecta"
                  : "vulnerabilidades afectan"}{" "}
                versiones que tenemos instaladas
              </Text>
              <Table.ScrollContainer minWidth={900}>
                <Table verticalSpacing="xs">
                  {head}
                  <Table.Tbody>{affecting.slice(0, 15).map(row)}</Table.Tbody>
                </Table>
              </Table.ScrollContainer>
              {affecting.length > 15 && (
                <Text size="xs" c="dimmed" mt="xs">
                  Y {affecting.length - 15} más: use el filtro «Solo lo que nos
                  afecta».
                </Text>
              )}
            </Card>
          )}

          <Card
            withBorder
            radius="md"
            padding="md"
            mb="md"
            className="chat-surface"
          >
            <Group gap="xs" mb="sm" wrap="wrap" align="flex-end">
              <TextInput
                size="xs"
                placeholder="CVE o producto"
                leftSection={<IconSearch size={14} />}
                value={q}
                onChange={(e) => setQ(e.currentTarget.value)}
              />
              <Select
                size="xs"
                placeholder="Severidad"
                clearable
                value={fSev}
                onChange={setFSev}
                data={Object.entries(SEVERITY_LABELS).map(([value, label]) => ({
                  value,
                  label,
                }))}
                w={140}
              />
              <Select
                size="xs"
                placeholder="¿Nos afecta?"
                clearable
                value={fMatch}
                onChange={setFMatch}
                data={Object.entries(MATCH_LABELS).map(([value, label]) => ({
                  value,
                  label,
                }))}
                w={140}
              />
              <TextInput
                size="xs"
                type="date"
                label="Desde"
                value={from}
                onChange={(e) => setFrom(e.currentTarget.value)}
                w={140}
              />
              <TextInput
                size="xs"
                type="date"
                label="Hasta"
                value={to}
                onChange={(e) => setTo(e.currentTarget.value)}
                w={140}
              />
              <Checkbox
                size="xs"
                label="Solo explotadas"
                checked={onlyKev}
                onChange={(e) => setOnlyKev(e.currentTarget.checked)}
              />
              <Checkbox
                size="xs"
                label="Solo lo que nos afecta"
                checked={onlyOurs}
                onChange={(e) => setOnlyOurs(e.currentTarget.checked)}
              />
              <Text size="xs" c="dimmed">
                {filtered.length} de {rows.length}
              </Text>
            </Group>
            {filtered.length === 0 ? (
              <Center py="lg">
                <Text size="sm">
                  {rows.length
                    ? "Ninguna vulnerabilidad con esos filtros."
                    : "Todavía no hay datos: use «Actualizar ahora»."}
                </Text>
              </Center>
            ) : (
              <>
                <Table.ScrollContainer minWidth={900}>
                  <Table verticalSpacing="xs" highlightOnHover>
                    {head}
                    <Table.Tbody>
                      {filtered
                        .slice((page - 1) * PER_PAGE, page * PER_PAGE)
                        .map(row)}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
                {filtered.length > PER_PAGE && (
                  <Group justify="center" mt="sm">
                    <Pagination
                      size="sm"
                      total={Math.ceil(filtered.length / PER_PAGE)}
                      value={page}
                      onChange={setPage}
                    />
                  </Group>
                )}
              </>
            )}
            <Text size="xs" c="dimmed" mt="sm">
              Orden: primero las explotadas, luego por CVSS y luego las más
              nuevas. «Nos afecta»: nuestra versión está en el rango que publica
              NVD. «Revisar»: el producto coincide, pero la versión no se
              conoce, no hay rangos o nuestra rama ya no la evalúa el
              fabricante. Se muestran las del último año y, sin importar la
              fecha, todas las que nos afectan o hay que revisar.
            </Text>
          </Card>

          <Card withBorder radius="md" padding="md" className="chat-surface">
            <Group justify="space-between" wrap="wrap">
              <Group
                gap={6}
                style={{ cursor: "pointer" }}
                onClick={() => setShowInventory(!showInventory)}
              >
                {showInventory ? (
                  <IconChevronDown size={16} />
                ) : (
                  <IconChevronRight size={16} />
                )}
                <Text fw={700}>
                  Inventario de software de terceros ({inventory.length})
                </Text>
              </Group>
              <Button
                size="xs"
                variant="light"
                leftSection={<IconPlus size={14} />}
                onClick={() =>
                  setEditing({ id: null, form: { ...EMPTY_FORM } })
                }
              >
                Agregar
              </Button>
            </Group>
            <Collapse in={showInventory}>
              <Text size="xs" c="dimmed" mt="xs" mb="sm">
                Solo productos de terceros (no nuestro código) con el rol del
                equipo, sin direcciones IP ni nombres de servidor. La clave CPE
                («fabricante:producto», como la usa NVD) es la que permite
                comparar versiones.
              </Text>
              <Table.ScrollContainer minWidth={760}>
                <Table verticalSpacing="xs" highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Rol del equipo</Table.Th>
                      <Table.Th>Producto</Table.Th>
                      <Table.Th>Versión</Table.Th>
                      <Table.Th>Clave CPE</Table.Th>
                      <Table.Th>Coincidencias</Table.Th>
                      <Table.Th />
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {inventory.map((it) => {
                      const hits = rows.filter((r) =>
                        r.evaluation.matches.some((m) => m.itemId === it.id),
                      );
                      const aff = hits.filter((r) =>
                        r.evaluation.matches.some(
                          (m) => m.itemId === it.id && m.status === "afecta",
                        ),
                      ).length;
                      return (
                        <Table.Tr
                          key={it.id}
                          style={{
                            opacity: it.active ? 1 : 0.5,
                            verticalAlign: "top",
                          }}
                        >
                          <Table.Td>
                            <Text size="sm">{it.role}</Text>
                          </Table.Td>
                          <Table.Td>
                            <Text size="sm" fw={600}>
                              {it.product}
                            </Text>
                            <Text size="xs" c="dimmed">
                              {it.vendor}
                              {it.notes ? ` · ${it.notes}` : ""}
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            <Text size="sm">{it.version ?? "—"}</Text>
                          </Table.Td>
                          <Table.Td>
                            <Text size="xs" ff="monospace">
                              {it.cpe}
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            {aff > 0 && (
                              <Badge color="red" size="sm" mr={4}>
                                {aff} nos afectan
                              </Badge>
                            )}
                            {hits.length - aff > 0 && (
                              <Badge color="yellow" variant="light" size="sm">
                                {hits.length - aff} por revisar
                              </Badge>
                            )}
                            {!hits.length && (
                              <Text size="xs" c="dimmed">
                                Ninguna
                              </Text>
                            )}
                          </Table.Td>
                          <Table.Td>
                            <Group gap={4} wrap="nowrap">
                              <ActionIcon
                                variant="subtle"
                                size="sm"
                                aria-label="Editar"
                                onClick={() =>
                                  setEditing({
                                    id: it.id,
                                    form: {
                                      product: it.product,
                                      vendor: it.vendor,
                                      version: it.version ?? "",
                                      role: it.role,
                                      cpe: it.cpe,
                                      keywords: it.keywords ?? "",
                                      notes: it.notes ?? "",
                                      active: it.active,
                                    },
                                  })
                                }
                              >
                                <IconPencil size={14} />
                              </ActionIcon>
                              <ActionIcon
                                variant="subtle"
                                color="red"
                                size="sm"
                                aria-label="Quitar"
                                onClick={() => void removeItem(it)}
                              >
                                <IconTrash size={14} />
                              </ActionIcon>
                            </Group>
                          </Table.Td>
                        </Table.Tr>
                      );
                    })}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </Collapse>
          </Card>
          {lastOk?.summary && (
            <Text size="xs" c="dimmed" mt="md">
              {lastOk.summary}
            </Text>
          )}
        </>
      )}

      <Modal
        opened={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing?.id ? "Editar producto" : "Agregar producto"}
        centered
      >
        {editing && (
          <Stack gap="sm">
            <TextInput
              label="Producto"
              required
              value={editing.form.product}
              onChange={(e) => setField("product", e.currentTarget.value)}
              placeholder="Apache Tomcat"
            />
            <TextInput
              label="Fabricante"
              required
              value={editing.form.vendor}
              onChange={(e) => setField("vendor", e.currentTarget.value)}
              placeholder="Apache"
            />
            <TextInput
              label="Versión instalada"
              value={editing.form.version}
              onChange={(e) => setField("version", e.currentTarget.value)}
              placeholder="8.5.81"
            />
            <TextInput
              label="Rol del equipo"
              required
              value={editing.form.role}
              onChange={(e) => setField("role", e.currentTarget.value)}
              placeholder="Servidor SAP"
              description="Sin IP ni nombre del servidor."
            />
            <TextInput
              label="Clave CPE"
              required
              value={editing.form.cpe}
              onChange={(e) => setField("cpe", e.currentTarget.value)}
              placeholder="apache:tomcat"
              description="fabricante:producto como en NVD; varias separadas por coma."
            />
            <TextInput
              label="Palabras para CISA KEV"
              value={editing.form.keywords}
              onChange={(e) => setField("keywords", e.currentTarget.value)}
              placeholder="tomcat"
              description="Nombres con que CISA reporta el producto, separados por coma."
            />
            <TextInput
              label="Notas"
              value={editing.form.notes}
              onChange={(e) => setField("notes", e.currentTarget.value)}
            />
            <Switch
              label="Activo (se cruza con las vulnerabilidades)"
              checked={editing.form.active}
              onChange={(e) => setField("active", e.currentTarget.checked)}
            />
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setEditing(null)}>
                Cancelar
              </Button>
              <Button loading={saving} onClick={() => void saveItem()}>
                Guardar
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </>
  );
}
