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
  IconRefresh,
  IconSearch,
} from "@tabler/icons-react";
import type { IndicadorDto } from "../../../../../../lib/agent-audit/automation-db";
import { GraficosMejora } from "../../../../../../components/chat/auditoria/GraficosMejora";

/**
 * AUDITORÍA DE AGENTES → INDICADOR DE AUTOMATIZACIONES (Nicolás, 2026-10-30).
 * Por agente: horas de trabajo humano ANTES (sin IA, estimación realista por
 * caso de uso) vs DESPUÉS (la persona pidiendo y revisando), con las
 * ocurrencias medidas en el chat, y la rentabilidad en tiempo (horas
 * ahorradas y su proyección al mes). Cada agente abre su ficha, al estilo de
 * la Hoja de vida. «Analizar ahora» deja una corrida para el analizador.
 * LA REJA ESTÁ EN EL ENDPOINT (/api/chat/auditoria/automatizaciones).
 */

type Respuesta = IndicadorDto & { puedeAnalizar: boolean };

const h = (v: number | null | undefined, dec = 0) =>
  v === null || v === undefined
    ? "—"
    : v.toLocaleString("es-CO", {
        maximumFractionDigits: dec,
        minimumFractionDigits: dec,
      });
/** Días hábiles de un mes promedio (para «≈ h por día hábil»). */
const DIAS_HABILES_MES = 20;
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

  const agentes = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (datos?.agentes ?? [])
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
            Indicador de automatizaciones · capacidad liberada
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
          <>
            <Card
              withBorder
              radius="md"
              padding="md"
              mb="md"
              className="chat-surface"
            >
              <Text fw={600} size="sm" mb={2}>
                Capacidad operativa liberada
              </Text>
              <Text size="xs" c="dimmed" mb="sm">
                Tiempo de trabajo que los agentes le devuelven a las personas.
                No es plata ahorrada: es capacidad que el equipo puede usar en
                otras tareas.
              </Text>
              <Group gap="xl" wrap="wrap" align="flex-start">
                <div>
                  <Text size="xs" c="dimmed">
                    Por mes (promedio)
                  </Text>
                  <Text fw={800} size="xl" c="green" data-testid="capacidad-mes">
                    {h(tot.mes)} h
                  </Text>
                  <Text size="xs" c="dimmed">
                    ≈ {h(tot.mes / DIAS_HABILES_MES, 1)} h por día hábil
                  </Text>
                </div>
                <div>
                  <Text size="xs" c="dimmed">
                    % de capacidad liberada
                  </Text>
                  <Text fw={800} size="xl">
                    {tot.reduccion === null ? "—" : `${h(tot.reduccion, 1)} %`}
                  </Text>
                  <Text size="xs" c="dimmed">
                    de las horas que tomarían sin IA
                  </Text>
                </div>
                <div>
                  <Text size="xs" c="dimmed">
                    Acumulado del periodo
                  </Text>
                  <Text fw={700}>{h(tot.ahorradas)} h</Text>
                  <Text size="xs" c="dimmed">
                    {fechaCorta(datos.periodoDesde)} a {fechaCorta(datos.corte)}
                    {datos.semanas ? ` (${h(datos.semanas, 1)} semanas)` : ""}
                  </Text>
                </div>
                <div>
                  <Text size="xs" c="dimmed">
                    Horas sin IA → con IA (periodo)
                  </Text>
                  <Text fw={700}>
                    {h(tot.antes)} h → {h(tot.despues)} h
                  </Text>
                </div>
                <div>
                  <Text size="xs" c="dimmed">
                    Tareas medidas · casos de uso
                  </Text>
                  <Text fw={700}>
                    {h(tot.ocurrencias)} · {h(tot.casos)}
                  </Text>
                </div>
              </Group>
              <Alert color="gray" variant="light" mt="sm" p="xs">
                <Text size="xs">
                  <b>Cómo se calcula.</b> Por cada caso de uso: las veces que
                  se pidió en el chat × (los minutos que le tomaría a una
                  persona sin IA − los minutos de la persona pidiendo y
                  revisando). «Acumulado del periodo» suma todo el periodo
                  analizado; «Por mes» es ese mismo total llevado a un mes
                  promedio (30,44 días). Estimación conservadora, por validar
                  con cada área.
                </Text>
                <Text size="xs" mt={4}>
                  <b>Alcance.</b> Solo incluye los agentes y procesos medidos (
                  {h(datos.agentes.length)} agentes).
                  {datos.sinMedir.length > 0
                    ? ` Faltan por medir ${datos.sinMedir.length}: ${datos.sinMedir
                        .slice(0, 12)
                        .map((a) => a.displayName)
                        .join(", ")}${datos.sinMedir.length > 12 ? "…" : ""}.`
                    : " Todos los agentes activos están medidos."}
                </Text>
              </Alert>
            </Card>

            {datos.departamentos.length > 0 && (
              <Card
                withBorder
                radius="md"
                padding="md"
                mb="md"
                className="chat-surface"
              >
                <Text fw={600} size="sm" mb={6}>
                  Por departamento
                </Text>
                <ScrollArea type="auto">
                  <Table striped verticalSpacing={6} fz="sm">
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Departamento</Table.Th>
                        <Table.Th ta="right">Agentes</Table.Th>
                        <Table.Th ta="right">Sin IA → con IA (periodo)</Table.Th>
                        <Table.Th ta="right">Liberadas por mes</Table.Th>
                        <Table.Th ta="right">% liberado</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {datos.departamentos.map((d) => (
                        <Table.Tr key={d.departamento}>
                          <Table.Td fw={600}>{d.departamento}</Table.Td>
                          <Table.Td ta="right">{d.agentes}</Table.Td>
                          <Table.Td ta="right">
                            {h(d.horasSinIA)} h → {h(d.horasConIA)} h
                          </Table.Td>
                          <Table.Td ta="right" fw={700} c="green">
                            {h(d.horasMes, 1)} h
                          </Table.Td>
                          <Table.Td ta="right">
                            {d.porcentaje === null ? "—" : `${h(d.porcentaje, 1)} %`}
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </ScrollArea>
              </Card>
            )}

            {datos.casosRelevantes.length > 0 && (
              <Card
                withBorder
                radius="md"
                padding="md"
                mb="md"
                className="chat-surface"
              >
                <Text fw={600} size="sm" mb={2}>
                  Casos de uso más relevantes
                </Text>
                <Text size="xs" c="dimmed" mb={6}>
                  Los que más capacidad liberan por mes.
                </Text>
                <ScrollArea type="auto">
                  <Table striped verticalSpacing={6} fz="sm">
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Caso de uso</Table.Th>
                        <Table.Th>Departamento · agente</Table.Th>
                        <Table.Th ta="right">Veces</Table.Th>
                        <Table.Th ta="right">Antes → con IA</Table.Th>
                        <Table.Th ta="right">Liberadas por mes</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {datos.casosRelevantes.map((c, i) => (
                        <Table.Tr key={`${c.code}-${i}`}>
                          <Table.Td>{c.caso}</Table.Td>
                          <Table.Td>
                            {c.departamento} ·{" "}
                            <Link
                              href={`/process/chat/auditoria/automatizaciones/${encodeURIComponent(c.code)}`}
                            >
                              {c.agente}
                            </Link>
                          </Table.Td>
                          <Table.Td ta="right">{h(c.ocurrencias)}</Table.Td>
                          <Table.Td ta="right">
                            {h(c.minHumano)} → {h(c.minDespues)} min
                          </Table.Td>
                          <Table.Td ta="right" fw={700} c="green">
                            {h(c.horasMes, 1)} h
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </ScrollArea>
              </Card>
            )}

            {datos.graficos && (
              <GraficosMejora
                graficos={datos.graficos}
                oscuro={esquema === "dark"}
              />
            )}

            <Card withBorder radius="md" padding="md" className="chat-surface">
              <Text fw={600} size="sm" mb={6}>
                Detalle por agente
              </Text>
              <ScrollArea type="auto">
                <Table
                  striped
                  highlightOnHover
                  verticalSpacing={6}
                  fz="sm"
                  miw={900}
                >
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Agente</Table.Th>
                      <Table.Th>Sin IA vs con IA (horas)</Table.Th>
                      <Table.Th ta="right">Sin IA</Table.Th>
                      <Table.Th ta="right">Con IA</Table.Th>
                      <Table.Th ta="right">Liberadas (periodo)</Table.Th>
                      <Table.Th ta="right">Por mes</Table.Th>
                      <Table.Th ta="right">% liberado</Table.Th>
                      <Table.Th ta="right">Tareas</Table.Th>
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
                Barra gris: horas que la persona gastaría sin IA · barra verde:
                horas que gasta con el agente (pedir y revisar), en la misma
                escala.
              </Text>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
