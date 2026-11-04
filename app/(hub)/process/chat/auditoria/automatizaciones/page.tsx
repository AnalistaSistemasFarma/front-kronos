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
  Progress,
  ScrollArea,
  Select,
  SimpleGrid,
  Table,
  Tabs,
  Text,
  TextInput,
  Title,
  Tooltip,
  useComputedColorScheme,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconArrowLeft,
  IconChartBar,
  IconCircleCheck,
  IconClockPlay,
  IconRefresh,
  IconSearch,
} from "@tabler/icons-react";
import type {
  AgenteIndicadorDto,
  IndicadorDto,
} from "../../../../../../lib/agent-audit/automation-db";
import type { ProgramadaDto } from "../../../../../../lib/agent-audit/scheduled-db";
import {
  resumirProgramadas,
  type ResumenProgramadas,
} from "../../../../../../lib/agent-audit/scheduled";
import { GraficosMejora } from "../../../../../../components/chat/auditoria/GraficosMejora";
import { AutomatizacionesProgramadas } from "../../../../../../components/chat/auditoria/AutomatizacionesProgramadas";

/**
 * AUDITORÍA DE AGENTES → INDICADOR DE AUTOMATIZACIONES (Nicolás, 2026-10-30).
 * Por agente: horas de trabajo humano ANTES (sin IA, estimación realista por
 * caso de uso) vs DESPUÉS (la persona pidiendo y revisando), con las
 * ocurrencias medidas en el chat, y la rentabilidad en tiempo (horas
 * ahorradas y su proyección al mes). Cada agente abre su ficha, al estilo de
 * la Hoja de vida. «Analizar ahora» deja una corrida para el analizador.
 * LA REJA ESTÁ EN EL ENDPOINT (/api/chat/auditoria/automatizaciones).
 */

type Respuesta = IndicadorDto & {
  puedeAnalizar: boolean;
  /** null = la tabla de automatizaciones programadas aún no existe. */
  programadas?: ProgramadaDto[] | null;
};

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

/** Columna «Programadas» de la tabla por agente: cuántas y cuántas fallan. */
function CeldaProgramadas({ r }: { r: ResumenProgramadas | undefined }) {
  if (!r?.total)
    return (
      <Text size="sm" c="dimmed">
        —
      </Text>
    );
  return (
    <Tooltip
      withArrow
      label={`${r.activas} activas · ${r.pausadas} pausadas · ${r.fallando} fallando · ${r.corridas30} corridas en 30 días${r.pctOk30 === null ? "" : `, ${h(r.pctOk30, 1)} % bien`}`}
    >
      <Group gap={4} justify="flex-end" wrap="nowrap">
        <Text size="sm">{h(r.total)}</Text>
        {r.fallando > 0 && (
          <Badge size="xs" color="red" variant="light">
            {r.fallando} fallando
          </Badge>
        )}
      </Group>
    </Tooltip>
  );
}

export default function IndicadorAutomatizacionesPage() {
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [pidiendo, setPidiendo] = useState(false);
  const esquema = useComputedColorScheme("light", {
    getInitialValueInEffect: true,
  });
  const [q, setQ] = useState("");
  const [empresa, setEmpresa] = useState<string | null>(null);
  const [pestana, setPestana] = useState<string | null>("chat");

  const cargar = useCallback(async () => {
    try {
      const r = await fetch("/api/chat/auditoria/automatizaciones", {
        cache: "no-store",
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "No se pudo cargar el indicador.");
      setDatos(j);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    void cargar();
  }, [cargar]);
  // Mientras haya un análisis en curso, se refresca solo cada 30 s.
  useEffect(() => {
    if (!datos?.pendiente) return;
    const t = setInterval(() => void cargar(), 30_000);
    return () => clearInterval(t);
  }, [datos?.pendiente, cargar]);

  const analizar = async () => {
    setPidiendo(true);
    try {
      const r = await fetch("/api/chat/auditoria/automatizaciones/analizar", {
        method: "POST",
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "No se pudo pedir el análisis.");
      setAviso(
        "Análisis pedido. El analizador lo toma en su siguiente ronda (unos minutos) y la página se actualiza sola.",
      );
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPidiendo(false);
    }
  };

  // Resumen de las automatizaciones programadas por agente (aparte del chat).
  const progPorAgente = useMemo(() => {
    const m = new Map<string, ProgramadaDto[]>();
    for (const p of datos?.programadas ?? [])
      m.set(p.code, [...(m.get(p.code) ?? []), p]);
    return new Map<string, ResumenProgramadas>(
      [...m.entries()].map(([k, v]) => [k, resumirProgramadas(v)]),
    );
  }, [datos?.programadas]);

  const agentes = useMemo(() => {
    const t = q.trim().toLowerCase();
    // Los agentes que solo tienen automatizaciones programadas también cuentan.
    const conChat = new Set((datos?.agentes ?? []).map((a) => a.code));
    const soloProgramadas: AgenteIndicadorDto[] = [];
    for (const p of datos?.programadas ?? []) {
      if (conChat.has(p.code)) continue;
      conChat.add(p.code);
      soloProgramadas.push({
        idAgent: p.idAgent,
        code: p.code,
        displayName: p.displayName,
        empresa: p.empresa,
        departamento: null,
        casos: 0,
        casosValidos: 0,
        ocurrencias: 0,
        horasAntes: 0,
        horasDespues: 0,
        horasAhorradas: 0,
        horasMes: 0,
        reduccion: null,
      });
    }
    return [...(datos?.agentes ?? []), ...soloProgramadas]
      .filter((a) => !empresa || a.empresa === empresa)
      .filter(
        (a) =>
          !t ||
          [a.displayName, a.code, a.empresa, a.departamento].some((x) =>
            (x ?? "").toLowerCase().includes(t),
          ),
      );
  }, [datos, q, empresa]);

  const tot = useMemo(() => {
    const s = (
      k:
        | "horasAntes"
        | "horasDespues"
        | "horasAhorradas"
        | "horasMes"
        | "ocurrencias"
        | "casosValidos",
    ) => agentes.reduce((acc, a) => acc + a[k], 0);
    const antes = s("horasAntes");
    const despues = s("horasDespues");
    return {
      antes,
      despues,
      ahorradas: s("horasAhorradas"),
      mes: s("horasMes"),
      ocurrencias: s("ocurrencias"),
      casos: s("casosValidos"),
      reduccion: antes > 0 ? (1 - despues / antes) * 100 : null,
    };
  }, [agentes]);
  const maxAntes = Math.max(1, ...agentes.map((a) => a.horasAntes));
  const empresas = [
    ...new Set(
      [...(datos?.agentes ?? []), ...(datos?.programadas ?? [])]
        .map((a) => a.empresa)
        .filter(Boolean),
    ),
  ] as string[];
  const filtroProgramadas = useCallback(
    (p: ProgramadaDto) => {
      const t = q.trim().toLowerCase();
      return (
        (!empresa || p.empresa === empresa) &&
        (!t ||
          [p.displayName, p.code, p.empresa, p.nombre, p.descripcion].some(
            (x) => (x ?? "").toLowerCase().includes(t),
          ))
      );
    },
    [q, empresa],
  );

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
            href="/process/chat/auditoria/casos-de-uso"
            className="chat-text-muted"
            style={{ fontSize: 13 }}
          >
            Ver casos de uso
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
        </Group>

        <Group gap="sm" mb={2} wrap="nowrap">
          <IconChartBar size={26} className="chat-folder__icon" />
          <Title order={1} className="ios-process-hub__title text-3xl">
            Indicador de automatizaciones
          </Title>
        </Group>
        <Text className="ios-process-hub__subtitle" mb="lg">
          Horas que una persona gastaría haciendo a mano las tareas que hoy
          hacen los agentes, frente a las que gasta ahora pidiéndolas y
          revisándolas.
          {datos?.corte
            ? ` Periodo: ${fechaCorta(datos.periodoDesde)} a ${fechaCorta(datos.corte)}${datos.semanas ? ` (${h(datos.semanas, 1)} semanas)` : ""}.`
            : ""}
        </Text>

        {aviso && (
          <Alert
            color="green"
            radius="md"
            mb="md"
            icon={<IconCircleCheck size={18} />}
            withCloseButton
            onClose={() => setAviso(null)}
          >
            {aviso}
          </Alert>
        )}
        {datos?.pendiente && (
          <Alert color="blue" radius="md" mb="md" icon={<Loader size={16} />}>
            Análisis #{datos.pendiente.id}{" "}
            {datos.pendiente.status === "en_curso" ? "en curso" : "pendiente"}
            {datos.pendiente.requestedBy
              ? `, pedido por ${datos.pendiente.requestedBy}`
              : ""}{" "}
            el {fechaHora(datos.pendiente.requestedAt)}.
          </Alert>
        )}
        {datos?.ultima?.status === "fallido" && (
          <Alert
            color="yellow"
            radius="md"
            mb="md"
            icon={<IconAlertCircle size={18} />}
          >
            El último análisis falló: {datos.ultima.error ?? "sin detalle"}. Se
            muestra el corte anterior.
          </Alert>
        )}

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
              placeholder="Agente, empresa o departamento"
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
            {datos?.puedeAnalizar && (
              <Group mt={20} gap="xs">
                <Button
                  size="xs"
                  leftSection={<IconRefresh size={14} />}
                  loading={pidiendo}
                  disabled={Boolean(datos?.pendiente)}
                  onClick={() => void analizar()}
                >
                  Analizar ahora
                </Button>
              </Group>
            )}
          </SimpleGrid>
          <Text size="xs" c="dimmed" mt={8}>
            Se actualiza cada lunes o con «Analizar ahora». Último análisis:{" "}
            {fechaHora(datos?.ultima?.finishedAt ?? null)}
            {datos?.ultima?.tareas
              ? ` · ${h(datos.ultima.tareas)} tareas revisadas`
              : ""}
            {datos?.ultima?.tareasSinClasificar
              ? ` · ${h(datos.ultima.tareasSinClasificar)} sin un caso de uso conocido`
              : ""}
            .
          </Text>
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
          <Tabs value={pestana} onChange={setPestana} keepMounted={false}>
            <Tabs.List mb="md">
              <Tabs.Tab value="chat" leftSection={<IconChartBar size={14} />}>
                Casos del chat
              </Tabs.Tab>
              <Tabs.Tab
                value="programadas"
                leftSection={<IconClockPlay size={14} />}
                rightSection={
                  datos.programadas?.some((p) => p.estado === "fallando") ? (
                    <Badge size="xs" color="red" variant="filled" circle>
                      {
                        datos.programadas.filter((p) => p.estado === "fallando")
                          .length
                      }
                    </Badge>
                  ) : undefined
                }
              >
                Automatizaciones programadas
              </Tabs.Tab>
            </Tabs.List>
            <Tabs.Panel value="programadas">
              <AutomatizacionesProgramadas
                programadas={datos.programadas}
                filtro={filtroProgramadas}
              />
            </Tabs.Panel>
            <Tabs.Panel value="chat">
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
                  <div>
                    <Text size="xs" c="dimmed">
                      Horas de la persona sin IA
                    </Text>
                    <Text fw={700}>{h(tot.antes)}</Text>
                  </div>
                  <div>
                    <Text size="xs" c="dimmed">
                      Horas de la persona con IA
                    </Text>
                    <Text fw={700}>{h(tot.despues)}</Text>
                  </div>
                  <div>
                    <Text size="xs" c="dimmed">
                      Horas ahorradas en el periodo
                    </Text>
                    <Text fw={700} c="green">
                      {h(tot.ahorradas)}
                    </Text>
                  </div>
                  <div>
                    <Text size="xs" c="dimmed">
                      Ahorro proyectado al mes
                    </Text>
                    <Text fw={700} c="green">
                      {h(tot.mes)} h
                    </Text>
                  </div>
                  <div>
                    <Text size="xs" c="dimmed">
                      Reducción del tiempo humano
                    </Text>
                    <Text fw={700}>
                      {tot.reduccion === null
                        ? "—"
                        : `${h(tot.reduccion, 1)} %`}
                    </Text>
                  </div>
                  <div>
                    <Text size="xs" c="dimmed">
                      Tareas automatizadas medidas
                    </Text>
                    <Text fw={700}>{h(tot.ocurrencias)}</Text>
                  </div>
                  <div>
                    <Text size="xs" c="dimmed">
                      Casos de uso con ahorro
                    </Text>
                    <Text fw={700}>{h(tot.casos)}</Text>
                  </div>
                </Group>
                <Text size="xs" c="dimmed" mt={8}>
                  Estimación conservadora, por validar con cada área. No incluye
                  costos.
                </Text>
              </Card>

              {datos.graficos && (
                <GraficosMejora
                  graficos={datos.graficos}
                  oscuro={esquema === "dark"}
                />
              )}

              <Card
                withBorder
                radius="md"
                padding="md"
                className="chat-surface"
              >
                <Text fw={600} size="sm" mb={6}>
                  Por agente
                </Text>
                <ScrollArea type="auto">
                  <Table
                    striped
                    highlightOnHover
                    verticalSpacing={6}
                    fz="sm"
                    miw={1000}
                  >
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Agente</Table.Th>
                        <Table.Th>Sin IA vs con IA (horas)</Table.Th>
                        <Table.Th ta="right">Sin IA</Table.Th>
                        <Table.Th ta="right">Con IA</Table.Th>
                        <Table.Th ta="right">Ahorradas</Table.Th>
                        <Table.Th ta="right">Al mes</Table.Th>
                        <Table.Th ta="right">Reducción</Table.Th>
                        <Table.Th ta="right">Tareas</Table.Th>
                        <Table.Th ta="right">Programadas</Table.Th>
                        <Table.Th />
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {agentes.map((a) => (
                        <Table.Tr key={a.idAgent}>
                          <Table.Td>
                            <Text size="sm" fw={600}>
                              {a.displayName}
                            </Text>
                            <Group gap={4}>
                              {a.empresa && (
                                <Badge size="xs" variant="light" color="indigo">
                                  {a.empresa}
                                </Badge>
                              )}
                              {a.departamento && (
                                <Text size="xs" c="dimmed">
                                  {a.departamento}
                                </Text>
                              )}
                            </Group>
                          </Table.Td>
                          <Table.Td style={{ minWidth: 200 }}>
                            <Tooltip
                              label={`Antes ${h(a.horasAntes)} h · después ${h(a.horasDespues)} h`}
                              withArrow
                            >
                              <div>
                                <Progress
                                  value={(a.horasAntes / maxAntes) * 100}
                                  color="gray"
                                  size="sm"
                                  mb={4}
                                />
                                <Progress
                                  value={(a.horasDespues / maxAntes) * 100}
                                  color="green"
                                  size="sm"
                                />
                              </div>
                            </Tooltip>
                          </Table.Td>
                          <Table.Td ta="right">{h(a.horasAntes)}</Table.Td>
                          <Table.Td ta="right">{h(a.horasDespues)}</Table.Td>
                          <Table.Td ta="right" fw={700} c="green">
                            {h(a.horasAhorradas)}
                          </Table.Td>
                          <Table.Td ta="right">{h(a.horasMes)} h</Table.Td>
                          <Table.Td ta="right">
                            {a.reduccion === null
                              ? "—"
                              : `${h(a.reduccion, 1)} %`}
                          </Table.Td>
                          <Table.Td ta="right">{h(a.ocurrencias)}</Table.Td>
                          <Table.Td ta="right">
                            <CeldaProgramadas r={progPorAgente.get(a.code)} />
                          </Table.Td>
                          <Table.Td>
                            <Button
                              component={Link}
                              href={`/process/chat/auditoria/automatizaciones/${encodeURIComponent(a.code)}`}
                              size="xs"
                              variant="light"
                            >
                              Ver ficha
                            </Button>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </ScrollArea>
                <Text size="xs" c="dimmed" mt={6}>
                  Barra gris: horas que la persona gastaría sin IA · barra
                  verde: horas que gasta con el agente (pedir y revisar), en la
                  misma escala. Programadas: automatizaciones que el agente
                  corre solo (se cuentan aparte, no suman horas).
                </Text>
              </Card>
            </Tabs.Panel>
          </Tabs>
        )}
      </div>
    </div>
  );
}
