"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Alert,
  Badge,
  Button,
  Card,
  Center,
  Group,
  Loader,
  ScrollArea,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import {
  IconAlertCircle,
  IconArrowLeft,
  IconBellOff,
  IconBug,
  IconCircleCheck,
  IconRefresh,
  IconRotateClockwise,
  IconSearch,
} from "@tabler/icons-react";
import {
  NOMBRE_TIPO,
  type EstadoError,
  type TipoError,
} from "../../../../../../lib/agent-audit/errors-catalog";
import type {
  ErroresDto,
  ErrorIaDto,
  EventoIaDto,
} from "../../../../../../lib/agent-audit/errors-db";

/**
 * AUDITORÍA DE AGENTES → ERRORES DE IA (Nicolás, 2026-11-03: «como un Sentry
 * pero con los agentes»). Los errores de toda la flota agrupados por huella:
 * agente, tipo, primera y última vez, ocurrencias, mensaje o conversación
 * afectada y estado (abierto / resuelto / silenciado). Los alimenta el
 * recolector de la Mac de horus (scripts/agent-errors). «Reintentar mensaje»
 * vuelve a entregar el mensaje afectado (solo administración).
 * LA REJA ESTÁ EN EL ENDPOINT (/api/chat/auditoria/errores).
 */

type Respuesta = ErroresDto & {
  puedeReintentar: boolean;
  notificacionActiva: boolean;
  horasEntreAvisos: number;
};
type Aviso = { color: "green" | "red" | "yellow"; texto: string };

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
const cifra = (n: number) => n.toLocaleString("es-CO");

const COLOR_SEVERIDAD = { alta: "red", media: "orange", baja: "gray" } as const;
const COLOR_ESTADO = { abierto: "red", resuelto: "green", silenciado: "gray" } as const;
const NOMBRE_ESTADO: Record<EstadoError, string> = {
  abierto: "Abierto",
  resuelto: "Resuelto",
  silenciado: "Silenciado",
};

function Afectado({ e }: { e: ErrorIaDto }) {
  if (!e.idConversacion && !e.idMensaje) return <Text size="xs" c="dimmed">—</Text>;
  return (
    <Stack gap={0}>
      {e.idConversacion ? (
        <Link
          href={`/process/chat/auditoria?conversacion=${e.idConversacion}`}
          style={{ fontSize: 13 }}
        >
          Conversación {e.idConversacion}
        </Link>
      ) : null}
      {e.idMensaje ? (
        <Text size="xs" c="dimmed">
          Mensaje {e.idMensaje}
        </Text>
      ) : null}
    </Stack>
  );
}

export default function ErroresIaPage() {
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [q, setQ] = useState("");
  const [agente, setAgente] = useState<string | null>(null);
  const [tipo, setTipo] = useState<string | null>(null);
  const [estado, setEstado] = useState<string>("abierto");
  const [ocupado, setOcupado] = useState<number | null>(null);
  const [abierto, setAbierto] = useState<number | null>(null);
  const [eventos, setEventos] = useState<Record<number, EventoIaDto[] | "cargando">>({});
  const movil = useMediaQuery("(max-width: 48em)") ?? false;

  const cargar = useCallback(async () => {
    try {
      const r = await fetch("/api/chat/auditoria/errores", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "No se pudo cargar el panel de errores.");
      setDatos(j);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    void cargar();
    // El recolector publica cada pocos minutos: se refresca solo cada 60 s.
    const t = setInterval(() => void cargar(), 60_000);
    return () => clearInterval(t);
  }, [cargar]);

  const actualizarFila = (dto: ErrorIaDto) =>
    setDatos((d) => (d ? { ...d, errores: d.errores.map((x) => (x.id === dto.id ? dto : x)) } : d));

  const cambiarEstado = async (e: ErrorIaDto, nuevo: EstadoError) => {
    setOcupado(e.id);
    try {
      const r = await fetch(`/api/chat/auditoria/errores/${e.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado: nuevo }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "No se pudo cambiar el estado.");
      actualizarFila(j.error as ErrorIaDto);
      setAviso({
        color: "green",
        texto: `«${e.titulo.slice(0, 80)}» quedó ${NOMBRE_ESTADO[nuevo].toLowerCase()}.`,
      });
    } catch (err) {
      setAviso({ color: "red", texto: err instanceof Error ? err.message : String(err) });
    } finally {
      setOcupado(null);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const reintentar = async (e: ErrorIaDto) => {
    if (!window.confirm(`¿Volver a entregarle a ${e.agenteNombre ?? e.agente} el mensaje ${e.idMensaje}?`)) return;
    setOcupado(e.id);
    try {
      const r = await fetch(`/api/chat/auditoria/errores/${e.id}/reintentar`, { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "No se pudo reintentar el mensaje.");
      setAviso({
        color: "green",
        texto: `Mensaje ${j.idMensaje} (conversación ${j.idConversacion}) marcado para entregarse de nuevo. El agente lo recibe en su siguiente consulta.`,
      });
      await cargar();
    } catch (err) {
      setAviso({ color: "yellow", texto: `No se reintentó: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setOcupado(null);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const verOcurrencias = async (e: ErrorIaDto) => {
    if (abierto === e.id) {
      setAbierto(null);
      return;
    }
    setAbierto(e.id);
    if (eventos[e.id] && eventos[e.id] !== "cargando") return;
    setEventos((m) => ({ ...m, [e.id]: "cargando" }));
    try {
      const r = await fetch(`/api/chat/auditoria/errores/${e.id}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "No se pudieron leer las ocurrencias.");
      setEventos((m) => ({ ...m, [e.id]: j.eventos as EventoIaDto[] }));
    } catch (err) {
      setEventos((m) => ({ ...m, [e.id]: [] }));
      setAviso({ color: "red", texto: err instanceof Error ? err.message : String(err) });
    }
  };

  const errores = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (datos?.errores ?? [])
      .filter((e) => estado === "todos" || e.estado === estado)
      .filter((e) => !agente || e.agente === agente)
      .filter((e) => !tipo || e.tipo === tipo)
      .filter(
        (e) =>
          !t ||
          [e.titulo, e.detalle, e.agente, e.agenteNombre, e.host].some((x) => (x ?? "").toLowerCase().includes(t)),
      )
      .sort((a, b) => {
        const s = { alta: 0, media: 1, baja: 2 } as const;
        if (a.estado === "abierto" && b.estado === "abierto" && s[a.severidad] !== s[b.severidad])
          return s[a.severidad] - s[b.severidad];
        return (b.ultimaVez ?? "").localeCompare(a.ultimaVez ?? "");
      });
  }, [datos, q, agente, tipo, estado]);

  const resumen = useMemo(() => {
    const todos = datos?.errores ?? [];
    const abiertos = todos.filter((e) => e.estado === "abierto");
    const hace24 = Date.now() - 86_400_000;
    return {
      abiertos: abiertos.length,
      altos: abiertos.filter((e) => e.severidad === "alta").length,
      agentes: new Set(abiertos.map((e) => e.agente)).size,
      ultimas24: todos.filter((e) => e.ultimaVez && Date.parse(e.ultimaVez) >= hace24).length,
    };
  }, [datos]);

  const agentes = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of datos?.errores ?? []) m.set(e.agente, e.agenteNombre ?? e.agente);
    return [...m].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [datos]);
  const tipos = useMemo(
    () =>
      [...new Set((datos?.errores ?? []).map((e) => e.tipo))].map((t) => ({
        value: t,
        label: NOMBRE_TIPO[t as TipoError] ?? t,
      })),
    [datos],
  );

  const puedeReintentar = (e: ErrorIaDto) =>
    Boolean(datos?.puedeReintentar && e.idMensaje && e.ambiente === datos?.ambienteServidor);

  const acciones = (e: ErrorIaDto) => (
    <Group gap={4} wrap="wrap">
      {e.estado !== "resuelto" && (
        <Button
          size="compact-xs"
          variant="light"
          color="green"
          leftSection={<IconCircleCheck size={12} />}
          loading={ocupado === e.id}
          onClick={() => void cambiarEstado(e, "resuelto")}
        >
          Resolver
        </Button>
      )}
      {e.estado !== "silenciado" && (
        <Button
          size="compact-xs"
          variant="light"
          color="gray"
          leftSection={<IconBellOff size={12} />}
          loading={ocupado === e.id}
          onClick={() => void cambiarEstado(e, "silenciado")}
        >
          Silenciar
        </Button>
      )}
      {e.estado !== "abierto" && (
        <Button
          size="compact-xs"
          variant="subtle"
          loading={ocupado === e.id}
          onClick={() => void cambiarEstado(e, "abierto")}
        >
          Reabrir
        </Button>
      )}
      {puedeReintentar(e) && (
        <Button
          size="compact-xs"
          variant="light"
          color="blue"
          leftSection={<IconRotateClockwise size={12} />}
          loading={ocupado === e.id}
          onClick={() => void reintentar(e)}
        >
          Reintentar mensaje
        </Button>
      )}
      <Button size="compact-xs" variant="subtle" onClick={() => void verOcurrencias(e)}>
        {abierto === e.id ? "Ocultar" : "Ocurrencias"}
      </Button>
    </Group>
  );

  const etiquetas = (e: ErrorIaDto) => (
    <Group gap={4} wrap="wrap">
      <Badge size="xs" variant="light" color={COLOR_SEVERIDAD[e.severidad]}>
        {e.severidad}
      </Badge>
      <Badge size="xs" variant="outline" color="indigo">
        {NOMBRE_TIPO[e.tipo] ?? e.tipo}
      </Badge>
      <Badge size="xs" variant="dot" color={e.ambiente === "prod" ? "teal" : "yellow"}>
        {e.ambiente === "prod" ? "producción" : "pruebas"}
      </Badge>
      <Badge size="xs" variant="filled" color={COLOR_ESTADO[e.estado]}>
        {NOMBRE_ESTADO[e.estado]}
      </Badge>
    </Group>
  );

  const ocurrencias = (e: ErrorIaDto) => {
    const lista = eventos[e.id];
    if (abierto !== e.id) return null;
    if (lista === "cargando" || !lista)
      return (
        <Center py="xs">
          <Loader size="xs" />
        </Center>
      );
    if (lista.length === 0) return <Text size="xs" c="dimmed">Sin ocurrencias guardadas (se conservan 90 días).</Text>;
    return (
      <Stack gap={4}>
        {lista.map((o, i) => (
          <Text key={i} size="xs" style={{ wordBreak: "break-word" }}>
            <Text span fw={600} size="xs">
              {fechaHora(o.ocurrioEn)}
            </Text>
            {o.idConversacion ? ` · conv. ${o.idConversacion}` : ""}
            {o.idMensaje ? ` · msj. ${o.idMensaje}` : ""} — {o.muestra ?? ""}
          </Text>
        ))}
      </Stack>
    );
  };

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
          <Link href="/process/chat/auditoria/inventario" className="chat-text-muted" style={{ fontSize: 13 }}>
            Ver inventario de agentes
          </Link>
        </Group>

        <Group gap="sm" mb={2} wrap="nowrap">
          <IconBug size={26} className="chat-folder__icon" />
          <Title order={1} className="ios-process-hub__title text-3xl">
            Errores de IA
          </Title>
        </Group>
        <Text className="ios-process-hub__subtitle" mb="lg">
          Las fallas de los agentes de toda la flota, agrupadas como en Sentry: turnos que no terminaron,
          sesiones vencidas, límites de uso, conectores caídos, bots detenidos en una confirmación y mensajes
          sin contestar. Cada error cuenta sus ocurrencias y se marca como resuelto o silenciado.
        </Text>

        {aviso && (
          <Alert
            color={aviso.color}
            radius="md"
            mb="md"
            icon={aviso.color === "green" ? <IconCircleCheck size={18} /> : <IconAlertCircle size={18} />}
            withCloseButton
            onClose={() => setAviso(null)}
          >
            {aviso.texto}
          </Alert>
        )}
        {error && (
          <Alert color="red" radius="md" icon={<IconAlertCircle size={18} />} mb="md">
            {error}
          </Alert>
        )}

        <Card withBorder radius="md" padding="md" mb="md" className="chat-surface">
          <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
            <div>
              <Text size="xs" c="dimmed">
                Abiertos
              </Text>
              <Text fw={700} c={resumen.abiertos ? "red" : undefined}>
                {cifra(resumen.abiertos)}
              </Text>
            </div>
            <div>
              <Text size="xs" c="dimmed">
                Abiertos de severidad alta
              </Text>
              <Text fw={700} c={resumen.altos ? "red" : undefined}>
                {cifra(resumen.altos)}
              </Text>
            </div>
            <div>
              <Text size="xs" c="dimmed">
                Agentes con errores abiertos
              </Text>
              <Text fw={700}>{cifra(resumen.agentes)}</Text>
            </div>
            <div>
              <Text size="xs" c="dimmed">
                Errores vistos en 24 h
              </Text>
              <Text fw={700}>{cifra(resumen.ultimas24)}</Text>
            </div>
          </SimpleGrid>
          <Text size="xs" c="dimmed" mt={8}>
            Última recepción del recolector: {fechaHora(datos?.ultimaRecepcion ?? null)} · Avisos a Nicolás por
            SynerLink: {datos?.notificacionActiva ? `activos (máximo uno por error cada ${datos.horasEntreAvisos} h)` : "apagados en este ambiente"}.
          </Text>
        </Card>

        <Card withBorder radius="md" padding="md" mb="md" className="chat-surface">
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="sm">
            <TextInput
              label="Buscar"
              size="xs"
              placeholder="Texto del error, agente o equipo"
              leftSection={<IconSearch size={14} />}
              value={q}
              onChange={(e) => setQ(e.currentTarget.value)}
            />
            <Select
              label="Agente"
              size="xs"
              placeholder="Todos"
              clearable
              searchable
              value={agente}
              onChange={setAgente}
              data={agentes}
              comboboxProps={{ withinPortal: true }}
            />
            <Select
              label="Tipo"
              size="xs"
              placeholder="Todos"
              clearable
              value={tipo}
              onChange={setTipo}
              data={tipos}
              comboboxProps={{ withinPortal: true }}
            />
            <div>
              <Text size="xs" fw={500} mb={4}>
                Estado
              </Text>
              <Group gap="xs" wrap="nowrap">
                <SegmentedControl
                  size="xs"
                  value={estado}
                  onChange={setEstado}
                  data={[
                    { value: "abierto", label: "Abiertos" },
                    { value: "resuelto", label: "Resueltos" },
                    { value: "silenciado", label: "Silenciados" },
                    { value: "todos", label: "Todos" },
                  ]}
                />
                <Tooltip label="Actualizar" withArrow>
                  <Button size="xs" variant="subtle" px={6} onClick={() => void cargar()} aria-label="Actualizar">
                    <IconRefresh size={14} />
                  </Button>
                </Tooltip>
              </Group>
            </div>
          </SimpleGrid>
        </Card>

        {!datos && !error && (
          <Center py="xl">
            <Loader size="sm" />
          </Center>
        )}

        {datos && errores.length === 0 && (
          <Alert color="green" radius="md" icon={<IconCircleCheck size={18} />}>
            No hay errores con estos filtros.
          </Alert>
        )}

        {datos && errores.length > 0 && movil && (
          <Stack gap="sm">
            {errores.map((e) => (
              <Card key={e.id} withBorder radius="md" padding="sm" className="chat-surface">
                <Group justify="space-between" gap={4} mb={4} wrap="nowrap">
                  <Text fw={600} size="sm">
                    {e.agenteNombre ?? e.agente}
                  </Text>
                  <Badge size="sm" variant="light" color="dark">
                    ×{cifra(e.ocurrencias)}
                  </Badge>
                </Group>
                {etiquetas(e)}
                <Text size="sm" mt={6} style={{ wordBreak: "break-word" }}>
                  {e.titulo}
                </Text>
                <Text size="xs" c="dimmed" mt={4}>
                  Primera vez {fechaHora(e.primeraVez)} · última {fechaHora(e.ultimaVez)}
                  {e.host ? ` · ${e.host}` : ""}
                </Text>
                <div style={{ marginTop: 6 }}>
                  <Afectado e={e} />
                </div>
                <div style={{ marginTop: 8 }}>{acciones(e)}</div>
                <div style={{ marginTop: 6 }}>{ocurrencias(e)}</div>
              </Card>
            ))}
          </Stack>
        )}

        {datos && errores.length > 0 && !movil && (
          <Card withBorder radius="md" padding="md" className="chat-surface">
            <ScrollArea type="auto">
              <Table striped highlightOnHover verticalSpacing={6} fz="sm" miw={1000}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Agente</Table.Th>
                    <Table.Th>Error</Table.Th>
                    <Table.Th>Primera vez</Table.Th>
                    <Table.Th>Última vez</Table.Th>
                    <Table.Th ta="right">Ocurrencias</Table.Th>
                    <Table.Th>Afectado</Table.Th>
                    <Table.Th>Acciones</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {errores.map((e) => (
                    <Fragment key={e.id}>
                      <Table.Tr>
                        <Table.Td>
                          <Text size="sm" fw={600}>
                            {e.agenteNombre ?? e.agente}
                          </Text>
                          <Text size="xs" c="dimmed">
                            {[e.empresa, e.host].filter(Boolean).join(" · ") || "—"}
                          </Text>
                        </Table.Td>
                        <Table.Td style={{ maxWidth: 420 }}>
                          {etiquetas(e)}
                          <Text size="sm" mt={4} style={{ wordBreak: "break-word" }}>
                            {e.titulo}
                          </Text>
                          {e.reintentoEn && (
                            <Text size="xs" c="dimmed">
                              Reintentado {fechaHora(e.reintentoEn)} por {e.reintentoPor}
                            </Text>
                          )}
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs">{fechaHora(e.primeraVez)}</Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs">{fechaHora(e.ultimaVez)}</Text>
                        </Table.Td>
                        <Table.Td ta="right" fw={700}>
                          {cifra(e.ocurrencias)}
                        </Table.Td>
                        <Table.Td>
                          <Afectado e={e} />
                        </Table.Td>
                        <Table.Td>{acciones(e)}</Table.Td>
                      </Table.Tr>
                      {abierto === e.id && (
                        <Table.Tr>
                          <Table.Td colSpan={7}>{ocurrencias(e)}</Table.Td>
                        </Table.Tr>
                      )}
                    </Fragment>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          </Card>
        )}
      </div>
    </div>
  );
}
