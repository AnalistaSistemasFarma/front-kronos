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
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconArrowLeft,
  IconListCheck,
  IconRepeat,
  IconSearch,
} from "@tabler/icons-react";
import type {
  AgenteCasosDto,
  CasosDeUsoDto,
} from "../../../../../../lib/agent-audit/use-cases-db";

/**
 * AUDITORÍA DE AGENTES → CASOS DE USO (2026-10-29, pedido de Nicolás para
 * justificar la IA): por agente, para qué se usa, lo que ha hecho con su
 * recurrencia MEDIDA en los pedidos del chat (recurrente = 3+ días y 3+
 * semanas distintas) y lo que está haciendo ahora. Los datos son un corte del
 * análisis de conversaciones; las horas son estimaciones a validar.
 *
 * Mismo diseño que Inventario y Memorias: otra pestaña del mismo módulo.
 * LA REJA ESTÁ EN EL ENDPOINT (/api/chat/auditoria/casos-de-uso).
 */

const COLOR_CLASE: Record<string, string> = {
  Recurrente: "green",
  Ocasional: "yellow",
  Puntual: "gray",
  "Sin evidencia en el chat": "red",
};
const COLOR_NIVEL: Record<string, string> = {
  alto: "green",
  medio: "blue",
  bajo: "yellow",
  casi_sin_uso: "gray",
};
const NOMBRE_NIVEL: Record<string, string> = {
  alto: "Uso alto",
  medio: "Uso medio",
  bajo: "Uso bajo",
  casi_sin_uso: "Casi sin uso",
};
const ORDEN_CLASE: Record<string, number> = {
  Recurrente: 0,
  Ocasional: 1,
  Puntual: 2,
  "Sin evidencia en el chat": 3,
};
const ORDEN_NIVEL: Record<string, number> = {
  alto: 0,
  medio: 1,
  bajo: 2,
  casi_sin_uso: 3,
};

function fechaCorta(iso: string | null): string {
  if (!iso) return "—";
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}
const miles = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : v.toLocaleString("es-CO");

function TarjetaAgente({
  a,
  clase,
}: {
  a: AgenteCasosDto;
  clase: string | null;
}) {
  const hechos = useMemo(
    () =>
      a.hechos
        .filter((h) => !clase || h.clase === clase)
        .sort(
          (x, y) =>
            (ORDEN_CLASE[x.clase ?? ""] ?? 9) -
              (ORDEN_CLASE[y.clase ?? ""] ?? 9) ||
            (y.semanas ?? 0) - (x.semanas ?? 0),
        ),
    [a.hechos, clase],
  );
  const recurrentes = a.hechos.filter((h) => h.clase === "Recurrente").length;
  return (
    <Card withBorder radius="md" padding="md" className="chat-surface">
      <Group justify="space-between" wrap="nowrap" align="flex-start" mb={6}>
        <div style={{ minWidth: 0 }}>
          <Text fw={700} size="sm">
            {a.displayName}
          </Text>
          <Text
            size="xs"
            c="dimmed"
            style={{ fontFamily: "var(--mantine-font-family-monospace)" }}
          >
            {a.code}
          </Text>
        </div>
        <Group gap={4} wrap="wrap" justify="flex-end">
          {a.empresa && (
            <Badge size="xs" variant="light" color="indigo">
              {a.empresa}
            </Badge>
          )}
          {a.departamento && (
            <Badge size="xs" variant="outline" color="gray">
              {a.departamento}
            </Badge>
          )}
          <Badge
            size="xs"
            variant="light"
            color={COLOR_NIVEL[a.nivel] ?? "gray"}
          >
            {NOMBRE_NIVEL[a.nivel] ?? a.nivel}
          </Badge>
        </Group>
      </Group>
      {a.rol && (
        <Text size="sm" mb="xs">
          {a.rol}
        </Text>
      )}
      <Group gap="xl" wrap="wrap" mb="xs">
        <div>
          <Text size="xs" c="dimmed">
            Tareas atendidas
          </Text>
          <Text fw={700}>{miles(a.tareas)}</Text>
        </div>
        <div>
          <Text size="xs" c="dimmed">
            Recientes (últimas 2 semanas)
          </Text>
          <Text fw={700}>{miles(a.tareasRecientes)}</Text>
        </div>
        <div>
          <Text size="xs" c="dimmed">
            Personas
          </Text>
          <Text fw={700}>{miles(a.personas)}</Text>
        </div>
        <div>
          <Text size="xs" c="dimmed">
            Procesos recurrentes
          </Text>
          <Text fw={700} c={recurrentes > 0 ? "green" : undefined}>
            {recurrentes}
          </Text>
        </div>
        <Tooltip
          label="Estimación por muestra (minutos sin IA − revisión). Validar con el dueño del proceso."
          withArrow
          multiline
          w={260}
        >
          <div>
            <Text size="xs" c="dimmed">
              Horas netas estimadas
            </Text>
            <Text fw={700}>
              {miles(a.horasBase)}{" "}
              <Text span size="xs" c="dimmed" fw={400}>
                ({miles(a.horasBajo)}–{miles(a.horasAlto)})
              </Text>
            </Text>
          </div>
        </Tooltip>
      </Group>

      {hechos.length > 0 && (
        <ScrollArea type="auto" mb="xs">
          <Table
            striped
            highlightOnHover
            withTableBorder
            verticalSpacing={4}
            fz="xs"
            miw={760}
          >
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Lo que ha hecho</Table.Th>
                <Table.Th>Recurrencia</Table.Th>
                <Table.Th ta="right">Veces/mes</Table.Th>
                <Table.Th ta="right">Semanas</Table.Th>
                <Table.Th>Área</Table.Th>
                <Table.Th>Entregable</Table.Th>
                <Table.Th>Última vez</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {hechos.map((h, i) => (
                <Table.Tr key={`${h.caso}-${i}`}>
                  <Table.Td>
                    <Text size="xs" fw={600}>
                      {h.caso}
                    </Text>
                    {h.descripcion && (
                      <Text size="xs" c="dimmed">
                        {h.descripcion}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Stack gap={2} align="flex-start">
                      <Badge
                        size="xs"
                        variant="light"
                        color={COLOR_CLASE[h.clase ?? ""] ?? "gray"}
                      >
                        {h.clase ?? "—"}
                      </Badge>
                      {h.ritmo && (
                        <Text
                          size="xs"
                          c="dimmed"
                          style={{ whiteSpace: "nowrap" }}
                        >
                          {h.ritmo}
                        </Text>
                      )}
                    </Stack>
                  </Table.Td>
                  <Table.Td ta="right">{h.vecesMes ?? "—"}</Table.Td>
                  <Table.Td ta="right">{h.semanas ?? "—"}</Table.Td>
                  <Table.Td>{h.area ?? "—"}</Table.Td>
                  <Table.Td>{h.entregable ?? "—"}</Table.Td>
                  <Table.Td style={{ whiteSpace: "nowrap" }}>
                    {fechaCorta(h.ultima)}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      )}

      {a.enCurso.length > 0 && (
        <>
          <Text size="xs" fw={600} mb={4}>
            Lo que está haciendo
          </Text>
          <Group gap={4} wrap="wrap" mb="xs">
            {a.enCurso.map((t, i) => (
              <Badge
                key={`${t.tema}-${i}`}
                size="sm"
                variant="outline"
                color={t.estado === "en_espera" ? "gray" : "blue"}
                style={{
                  textTransform: "none",
                  fontWeight: 500,
                  height: "auto",
                  whiteSpace: "normal",
                  padding: "2px 8px",
                }}
              >
                {t.tema}
              </Badge>
            ))}
          </Group>
        </>
      )}
      {a.observaciones && (
        <Text size="xs" c="dimmed">
          {a.observaciones}
        </Text>
      )}
    </Card>
  );
}

export default function CasosDeUsoPage() {
  const [datos, setDatos] = useState<CasosDeUsoDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [empresa, setEmpresa] = useState<string | null>(null);
  const [clase, setClase] = useState<string | null>(null);
  const [nivel, setNivel] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    fetch("/api/chat/auditoria/casos-de-uso", { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok)
          throw new Error(
            j?.error ?? "No se pudieron cargar los casos de uso.",
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

  const agentes = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (datos?.agentes ?? [])
      .filter((a) => !empresa || a.empresa === empresa)
      .filter((a) => !nivel || a.nivel === nivel)
      .filter((a) => !clase || a.hechos.some((h) => h.clase === clase))
      .filter(
        (a) =>
          !t ||
          [a.displayName, a.code, a.empresa, a.departamento, a.rol]
            .concat(a.hechos.map((h) => h.caso))
            .concat(a.enCurso.map((e) => e.tema))
            .some((x) => (x ?? "").toLowerCase().includes(t)),
      )
      .sort(
        (x, y) =>
          (ORDEN_NIVEL[x.nivel] ?? 9) - (ORDEN_NIVEL[y.nivel] ?? 9) ||
          y.tareas - x.tareas,
      );
  }, [datos, q, empresa, clase, nivel]);

  const resumen = useMemo(() => {
    const hs = agentes.flatMap((a) => a.hechos);
    const c = (k: string) => hs.filter((h) => h.clase === k).length;
    return {
      agentes: agentes.length,
      casos: hs.length,
      recurrentes: c("Recurrente"),
      ocasionales: c("Ocasional"),
      puntuales: c("Puntual"),
      enCurso: agentes.reduce((s, a) => s + a.enCurso.length, 0),
      tareas: agentes.reduce((s, a) => s + a.tareas, 0),
      horas: agentes.reduce((s, a) => s + (a.horasBase ?? 0), 0),
      sinRecurrentes: agentes.filter(
        (a) => !a.hechos.some((h) => h.clase === "Recurrente"),
      ).length,
    };
  }, [agentes]);

  const empresas = [
    ...new Set((datos?.agentes ?? []).map((a) => a.empresa).filter(Boolean)),
  ] as string[];

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
          <Text size="xs" c="dimmed">
            ·
          </Text>
          <Link
            href="/process/chat/auditoria/automatizaciones"
            className="chat-text-muted"
            style={{ fontSize: 13 }}
          >
            Ver indicador de automatizaciones
          </Link>
        </Group>

        <Group gap="sm" mb={2} wrap="nowrap">
          <IconListCheck size={26} className="chat-folder__icon" />
          <Title order={1} className="ios-process-hub__title text-3xl">
            Casos de uso de los agentes
          </Title>
        </Group>
        <Text className="ios-process-hub__subtitle" mb="lg">
          Qué ha hecho y qué está haciendo cada agente, y cuáles de esos usos
          son recurrentes. Sale del análisis de los pedidos reales en el chat
          {datos?.periodoDesde
            ? ` entre el ${fechaCorta(datos.periodoDesde)}`
            : ""}
          {datos?.corte ? ` y el ${fechaCorta(datos.corte)}` : ""}: recurrente
          es lo que se pidió en al menos tres días y tres semanas distintas. Las
          horas son estimaciones por muestra y deben validarse con cada dueño de
          proceso.
        </Text>

        <Card
          withBorder
          radius="md"
          padding="md"
          mb="md"
          className="chat-surface"
        >
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="sm">
            <TextInput
              label="Buscar"
              size="xs"
              placeholder="Agente, caso de uso o tema"
              leftSection={<IconSearch size={14} />}
              value={q}
              onChange={(e) => setQ(e.currentTarget.value)}
            />
            <Select
              label="Empresa"
              size="xs"
              placeholder="Todas"
              clearable
              value={empresa}
              onChange={setEmpresa}
              data={empresas}
            />
            <Select
              label="Recurrencia"
              size="xs"
              placeholder="Todas"
              clearable
              value={clase}
              onChange={setClase}
              data={[
                "Recurrente",
                "Ocasional",
                "Puntual",
                "Sin evidencia en el chat",
              ]}
            />
            <Select
              label="Nivel de uso"
              size="xs"
              placeholder="Todos"
              clearable
              value={nivel}
              onChange={setNivel}
              data={Object.entries(NOMBRE_NIVEL).map(([value, label]) => ({
                value,
                label,
              }))}
            />
          </SimpleGrid>
        </Card>

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
                  ["Agentes", resumen.agentes],
                  ["Tareas atendidas", resumen.tareas],
                  ["Casos de uso", resumen.casos],
                  ["Recurrentes", resumen.recurrentes],
                  ["Ocasionales", resumen.ocasionales],
                  ["Puntuales", resumen.puntuales],
                  ["Temas en curso", resumen.enCurso],
                  ["Agentes sin procesos recurrentes", resumen.sinRecurrentes],
                  ["Horas netas estimadas (base)", resumen.horas],
                ].map(([l, v]) => (
                  <div key={String(l)}>
                    <Text size="xs" c="dimmed">
                      {l}
                    </Text>
                    <Text
                      fw={700}
                      c={l === "Recurrentes" ? "green" : undefined}
                    >
                      {miles(Number(v))}
                    </Text>
                  </div>
                ))}
              </Group>
              <Group gap={6} mt={8} wrap="nowrap">
                <IconRepeat size={14} color="var(--mantine-color-dimmed)" />
                <Text size="xs" c="dimmed">
                  Los procesos recurrentes son el valor que se puede proyectar
                  al año y medir antes y después; varios son candidatos a
                  programarse sin que alguien los pida.
                </Text>
              </Group>
            </Card>

            {agentes.length === 0 ? (
              <Alert
                color="blue"
                radius="md"
                icon={<IconAlertCircle size={18} />}
              >
                No hay agentes con esos filtros.
              </Alert>
            ) : (
              <Stack gap="md">
                {agentes.map((a) => (
                  <TarjetaAgente key={a.idAgent} a={a} clase={clase} />
                ))}
              </Stack>
            )}
          </>
        )}
      </div>
    </div>
  );
}
