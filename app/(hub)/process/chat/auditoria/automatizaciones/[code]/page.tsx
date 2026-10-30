"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  Alert,
  Badge,
  Card,
  Center,
  Collapse,
  Group,
  Loader,
  Progress,
  ScrollArea,
  SimpleGrid,
  Table,
  Text,
  Title,
  UnstyledButton,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconArrowLeft,
  IconChartBar,
  IconChevronDown,
  IconChevronRight,
} from "@tabler/icons-react";
import type {
  AgenteIndicadorDto,
  CasoIndicadorDto,
} from "../../../../../../../lib/agent-audit/automation-db";

/**
 * FICHA DEL INDICADOR DE AUTOMATIZACIONES DE UN AGENTE (al estilo de la Hoja de
 * vida): cifras del agente y, por caso de uso, el tiempo humano ANTES con sus
 * pasos y supuestos, el tiempo DESPUÉS, el tiempo medido del agente, las
 * ocurrencias y las horas ahorradas.
 */

interface Ficha {
  agente: AgenteIndicadorDto;
  casos: CasoIndicadorDto[];
  corte: string | null;
  periodoDesde: string | null;
}

const h = (v: number | null | undefined, dec = 0) =>
  v === null || v === undefined
    ? "—"
    : v.toLocaleString("es-CO", {
        maximumFractionDigits: dec,
        minimumFractionDigits: dec,
      });
const fechaCorta = (iso: string | null) => {
  if (!iso) return "—";
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
};
const minutos = (m: number | null | undefined) => {
  if (m === null || m === undefined) return "—";
  if (m < 60) return `${h(m, m < 10 && m % 1 ? 1 : 0)} min`;
  const hh = Math.floor(m / 60);
  const mm = Math.round(m % 60);
  return mm ? `${hh} h ${mm} min` : `${hh} h`;
};
const COLOR_CONF: Record<string, string> = {
  alta: "green",
  media: "blue",
  baja: "yellow",
};
const COLOR_CLASE: Record<string, string> = {
  Recurrente: "green",
  Ocasional: "yellow",
  Puntual: "gray",
};

function FilaCaso({ c, maxMin }: { c: CasoIndicadorDto; maxMin: number }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <>
      <Table.Tr style={{ opacity: c.valido ? 1 : 0.55 }}>
        <Table.Td>
          <UnstyledButton
            onClick={() => setAbierto((v) => !v)}
            style={{ textAlign: "left" }}
          >
            <Group gap={6} wrap="nowrap" align="flex-start">
              {abierto ? (
                <IconChevronDown size={14} style={{ marginTop: 3 }} />
              ) : (
                <IconChevronRight size={14} style={{ marginTop: 3 }} />
              )}
              <div>
                <Text size="sm" fw={600}>
                  {c.caso}
                </Text>
                <Group gap={4} mt={2}>
                  {c.clase && (
                    <Badge
                      size="xs"
                      variant="light"
                      color={COLOR_CLASE[c.clase] ?? "gray"}
                    >
                      {c.clase}
                    </Badge>
                  )}
                  {c.confianza && (
                    <Badge
                      size="xs"
                      variant="outline"
                      color={COLOR_CONF[c.confianza] ?? "gray"}
                    >
                      Confianza {c.confianza}
                    </Badge>
                  )}
                  {!c.valido && (
                    <Badge size="xs" variant="outline" color="gray">
                      Sin ahorro real
                    </Badge>
                  )}
                </Group>
              </div>
            </Group>
          </UnstyledButton>
        </Table.Td>
        <Table.Td style={{ minWidth: 170 }}>
          <Progress
            value={(c.minHumano / maxMin) * 100}
            color="gray"
            size="sm"
            mb={4}
          />
          <Progress
            value={(c.minDespues / maxMin) * 100}
            color="green"
            size="sm"
          />
        </Table.Td>
        <Table.Td ta="right" style={{ whiteSpace: "nowrap" }}>
          {minutos(c.minHumano)}
        </Table.Td>
        <Table.Td ta="right" style={{ whiteSpace: "nowrap" }}>
          {minutos(c.minDespues)}
        </Table.Td>
        <Table.Td ta="right" style={{ whiteSpace: "nowrap" }}>
          {minutos(c.minAgente)}
        </Table.Td>
        <Table.Td ta="right">{h(c.ocurrencias)}</Table.Td>
        <Table.Td
          ta="right"
          fw={700}
          c={c.horasAhorradas > 0 ? "green" : undefined}
        >
          {h(c.horasAhorradas, 1)}
        </Table.Td>
        <Table.Td ta="right">{h(c.horasMes, 1)}</Table.Td>
      </Table.Tr>
      <Table.Tr>
        <Table.Td colSpan={8} p={0} style={{ borderTop: 0 }}>
          <Collapse in={abierto}>
            <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm" p="sm">
              <div>
                <Text size="xs" fw={600} mb={4}>
                  Cómo se hacía antes (una ocurrencia)
                </Text>
                {c.pasos.length ? (
                  c.pasos.map((p, i) => (
                    <Group
                      key={i}
                      justify="space-between"
                      wrap="nowrap"
                      gap="sm"
                    >
                      <Text size="xs">{p.paso}</Text>
                      <Text
                        size="xs"
                        c="dimmed"
                        style={{ whiteSpace: "nowrap" }}
                      >
                        {minutos(p.minutos)}
                      </Text>
                    </Group>
                  ))
                ) : (
                  <Text size="xs" c="dimmed">
                    Sin desglose.
                  </Text>
                )}
                <Text size="xs" c="dimmed" mt={4}>
                  Rango: {minutos(c.minHumanoMin)} a {minutos(c.minHumanoMax)}
                </Text>
              </div>
              <div>
                {c.descripcion && (
                  <Text size="xs" mb={4}>
                    {c.descripcion}
                  </Text>
                )}
                {c.supuestos && (
                  <Text size="xs" c="dimmed" mb={4}>
                    Supuesto: {c.supuestos}
                  </Text>
                )}
                <Text size="xs" c="dimmed">
                  Después = la persona escribe el pedido y revisa o corrige lo
                  que entrega el agente. El tiempo del agente es la mediana
                  medida desde el pedido hasta su última respuesta.
                  {c.area ? ` Área: ${c.area}.` : ""}
                  {c.entregable ? ` Entregable: ${c.entregable}.` : ""}
                </Text>
              </div>
            </SimpleGrid>
          </Collapse>
        </Table.Td>
      </Table.Tr>
    </>
  );
}

export default function FichaIndicadorPage() {
  const params = useParams<{ code: string }>();
  const code = decodeURIComponent(String(params?.code ?? ""));
  const [datos, setDatos] = useState<Ficha | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!code) return;
    let vivo = true;
    fetch(`/api/chat/auditoria/automatizaciones/${encodeURIComponent(code)}`, {
      cache: "no-store",
    })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error ?? "No se pudo cargar la ficha.");
        if (vivo) setDatos(j);
      })
      .catch(
        (e) => vivo && setError(e instanceof Error ? e.message : String(e)),
      );
    return () => {
      vivo = false;
    };
  }, [code]);

  const maxMin = useMemo(
    () => Math.max(1, ...(datos?.casos ?? []).map((c) => c.minHumano)),
    [datos],
  );
  const a = datos?.agente;

  return (
    <div className="app-page-shell app-page-shell--fill ios-process-hub min-h-screen">
      <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        <Group gap="xs" mb={4}>
          <Link
            href="/process/chat/auditoria/automatizaciones"
            className="chat-text-muted"
            style={{ fontSize: 13 }}
          >
            <Group gap={4} wrap="nowrap">
              <IconArrowLeft size={14} />
              <span>Volver al indicador de automatizaciones</span>
            </Group>
          </Link>
          <Text size="xs" c="dimmed">
            ·
          </Text>
          <Link
            href={`/process/chat/auditoria/inventario/${encodeURIComponent(code)}`}
            className="chat-text-muted"
            style={{ fontSize: 13 }}
          >
            Ver hoja de vida
          </Link>
        </Group>
        <Group gap="sm" mb={2} wrap="nowrap">
          <IconChartBar size={26} className="chat-folder__icon" />
          <Title order={1} className="ios-process-hub__title text-3xl">
            Automatizaciones de {a?.displayName ?? code}
          </Title>
        </Group>
        <Text className="ios-process-hub__subtitle" mb="lg">
          Tiempo humano antes vs después de cada tarea que hace este agente, y
          las horas que libera.
          {datos?.corte
            ? ` Periodo: ${fechaCorta(datos.periodoDesde)} a ${fechaCorta(datos.corte)}.`
            : ""}
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

        {datos && a && (
          <>
            <Card
              withBorder
              radius="md"
              padding="md"
              mb="md"
              className="chat-surface"
            >
              <Group justify="space-between" wrap="nowrap" align="flex-start">
                <div>
                  <Text fw={700}>{a.displayName}</Text>
                  <Text
                    size="xs"
                    c="dimmed"
                    style={{
                      fontFamily: "var(--mantine-font-family-monospace)",
                    }}
                  >
                    {a.code}
                  </Text>
                </div>
                <Group gap={4}>
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
                </Group>
              </Group>
              <SimpleGrid cols={{ base: 2, sm: 3, lg: 6 }} spacing="sm" mt="sm">
                {[
                  ["Horas antes (sin IA)", h(a.horasAntes)],
                  ["Horas después (con agente)", h(a.horasDespues)],
                  ["Horas ahorradas", h(a.horasAhorradas)],
                  ["Ahorro al mes", `${h(a.horasMes)} h`],
                  [
                    "Reducción",
                    a.reduccion === null ? "—" : `${h(a.reduccion, 1)} %`,
                  ],
                  ["Tareas medidas", h(a.ocurrencias)],
                ].map(([l, v]) => (
                  <div key={l}>
                    <Text size="xs" c="dimmed">
                      {l}
                    </Text>
                    <Text
                      fw={700}
                      c={
                        l.startsWith("Horas ahorradas") ||
                        l.startsWith("Ahorro")
                          ? "green"
                          : undefined
                      }
                    >
                      {v}
                    </Text>
                  </div>
                ))}
              </SimpleGrid>
            </Card>

            <Card withBorder radius="md" padding="md" className="chat-surface">
              <Text fw={600} size="sm" mb={2}>
                Casos de uso ({datos.casos.length})
              </Text>
              <Text size="xs" c="dimmed" mb="sm">
                Abra cada caso para ver cómo se hacía antes, paso a paso, y el
                supuesto de la estimación. Los marcados «sin ahorro real»
                (pruebas, configuración del propio agente) no suman.
              </Text>
              <ScrollArea type="auto">
                <Table verticalSpacing={6} fz="sm" miw={900}>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Caso de uso</Table.Th>
                      <Table.Th>Antes vs después</Table.Th>
                      <Table.Th ta="right">Antes</Table.Th>
                      <Table.Th ta="right">Después</Table.Th>
                      <Table.Th ta="right">Agente</Table.Th>
                      <Table.Th ta="right">Veces</Table.Th>
                      <Table.Th ta="right">Horas ahorradas</Table.Th>
                      <Table.Th ta="right">Al mes</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {datos.casos.map((c) => (
                      <FilaCaso key={c.clave} c={c} maxMin={maxMin} />
                    ))}
                  </Table.Tbody>
                </Table>
              </ScrollArea>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
