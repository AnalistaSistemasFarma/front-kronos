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
  Modal,
  NumberInput,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
} from "@mantine/core";
import { IconAlertCircle, IconArrowLeft, IconPencil, IconPlus, IconReceipt2 } from "@tabler/icons-react";
import type { AgenteLicenciaDto, LicenciaDto, LicenciasDto, Semaforo } from "../../../../../../lib/agent-audit/licencias";

/**
 * AUDITORÍA DE AGENTES → COSTOS Y LICENCIAS (Nicolás, 2026-11-17): qué licencias
 * de Anthropic tenemos, qué empresa paga cada una, qué agentes la comparten (uso,
 * nunca datos), cuánto cupo consumen en promedio de 4 semanas y cuánto cuesta por
 * empresa y por área. Regla de negocio: una licencia no se comparte entre empresas.
 * LA REJA ESTÁ EN EL ENDPOINT (/api/chat/auditoria/licencias): solo administración.
 */

const COLOR: Record<Semaforo, string> = { verde: "green", amarillo: "yellow", rojo: "red", gris: "gray" };
const ALERTA: Record<string, string> = { rojo: "red", amarillo: "yellow", gris: "gray" };
const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 10) / 10} %`.replace(".", ","));
const dinero = (v: number | null, moneda = "USD") =>
  v === null ? "—" : `${moneda} ${v.toLocaleString("es-CO", { maximumFractionDigits: 2 })}`;
const tokens = (n: number) =>
  n >= 1_000_000_000 ? `${(n / 1e9).toFixed(1).replace(".", ",")} mil M` : n >= 1_000_000 ? `${(n / 1e6).toFixed(1).replace(".", ",")} M` : n >= 1000 ? `${Math.round(n / 1000)} k` : String(n);
const usd = (v: number) => `USD ${v.toLocaleString("es-CO", { maximumFractionDigits: v < 10 ? 2 : 0 })}`;
const haceSeg = (iso: string | null, ahora: number) => {
  if (!iso) return "—";
  const s = Math.max(0, Math.round((ahora - Date.parse(iso)) / 1000));
  return s < 60 ? `hace ${s} s` : s < 3600 ? `hace ${Math.round(s / 60)} min` : s < 86400 ? `hace ${Math.round(s / 3600)} h` : `hace ${Math.round(s / 86400)} d`;
};
const REFRESCO_MS = 30_000;
const fechaCorta = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("es-CO", { day: "2-digit", month: "short" }) : "—";

type Edicion = Partial<LicenciaDto> & { nueva?: boolean };

export default function CostosLicenciasPage() {
  const [datos, setDatos] = useState<LicenciasDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [edicion, setEdicion] = useState<Edicion | null>(null);
  const [aviso, setAviso] = useState<{ color: string; texto: string } | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [enVivo, setEnVivo] = useState(true);
  const [ahora, setAhora] = useState(() => Date.now());

  const cargar = useCallback(async (silencioso = false) => {
    if (!silencioso) setCargando(true);
    try {
      const r = await fetch("/api/chat/auditoria/licencias", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "No se pudo cargar el tablero.");
      setDatos(j);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }, []);
  useEffect(() => {
    void cargar();
  }, [cargar]);
  // EN VIVO: el consumo llega por el hook de cada agente en cada turno; se refresca solo.
  useEffect(() => {
    if (!enVivo) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void cargar(true);
    }, REFRESCO_MS);
    return () => clearInterval(id);
  }, [enVivo, cargar]);
  useEffect(() => {
    const id = setInterval(() => setAhora(Date.now()), 5_000);
    return () => clearInterval(id);
  }, []);

  const opcionesLicencia = useMemo(
    () => (datos?.licencias ?? []).filter((l) => l.activa).map((l) => ({ value: String(l.idLicencia), label: `${l.codigo} · ${l.empresa}` })),
    [datos],
  );
  const opcionesEmpresa = useMemo(
    () => (datos?.empresas ?? []).map((e) => ({ value: String(e.idEmpresa), label: e.empresa })),
    [datos],
  );

  async function enviar(body: unknown, exito: string) {
    setGuardando(true);
    try {
      const r = await fetch("/api/chat/auditoria/licencias", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "No se pudo guardar.");
      setAviso({ color: "green", texto: exito });
      await cargar();
      return true;
    } catch (e) {
      setAviso({ color: "red", texto: (e as Error).message });
      return false;
    } finally {
      setGuardando(false);
    }
  }

  async function guardarEdicion() {
    if (!edicion) return;
    const ok = await enviar(
      {
        accion: "guardar",
        licencia: {
          idLicencia: edicion.nueva ? null : edicion.idLicencia,
          codigo: edicion.codigo,
          nombre: edicion.nombre ?? null,
          idEmpresa: edicion.idEmpresa,
          organizacion: edicion.organizacion ?? null,
          plan: edicion.plan ?? null,
          costoMensual: edicion.costoMensual ?? null,
          moneda: edicion.moneda ?? "USD",
          renovacion: edicion.renovacion ?? null,
          responsable: edicion.responsable ?? null,
          notas: edicion.notas ?? null,
          activa: edicion.activa ?? true,
        },
      },
      edicion.nueva ? "Licencia creada." : "Licencia actualizada.",
    );
    if (ok) setEdicion(null);
  }

  const asignar = (a: AgenteLicenciaDto, idLicencia: string | null) =>
    enviar(
      { accion: "asignar", idAgent: a.idAgent, idLicencia: idLicencia ? Number(idLicencia) : null },
      `${a.nombre}: licencia ${idLicencia ? "asignada" : "quitada"}.`,
    );

  return (
    <div style={{ padding: "16px 20px", maxWidth: 1500, margin: "0 auto" }}>
      <Group mb="xs" gap="xs">
        <Link href="/process/chat/auditoria" className="chat-text-muted" style={{ fontSize: 13 }}>
          <Group gap={4}>
            <IconArrowLeft size={14} /> Auditoría de agentes
          </Group>
        </Link>
      </Group>
      <Group justify="space-between" mb="xs" wrap="wrap">
        <Group gap="sm" wrap="nowrap">
          <IconReceipt2 size={26} className="chat-folder__icon" />
          <Title order={1} className="ios-process-hub__title text-3xl">
            Costos y licencias
          </Title>
        </Group>
        <Group gap="sm">
          <Switch
            size="sm"
            checked={enVivo}
            onChange={(e) => setEnVivo(e.currentTarget.checked)}
            label={
              <Group gap={6}>
                {enVivo && <span style={{ width: 8, height: 8, borderRadius: 99, background: "var(--mantine-color-green-6)", display: "inline-block" }} />}
                <Text size="xs">{enVivo ? `En vivo · ${datos ? haceSeg(datos.generadoEn, ahora) : ""}` : "En pausa"}</Text>
              </Group>
            }
          />
        <Button
          size="xs"
          leftSection={<IconPlus size={14} />}
          variant="light"
          disabled={!datos}
          onClick={() => setEdicion({ nueva: true, moneda: "USD", activa: true })}
        >
          Nueva licencia
        </Button>
        </Group>
      </Group>
      <Text size="sm" c="dimmed" mb="md">
        Licencias de Anthropic, qué empresa paga cada una y qué agentes comparten su cupo (comparten uso, nunca datos). El
        semáforo usa el promedio de 4 semanas: verde por debajo de 60 %, amarillo de 60 a 80 %, rojo por encima.{" "}
        <b>Regla de negocio: una licencia no se comparte entre empresas.</b>
      </Text>

      {aviso && (
        <Alert color={aviso.color} mb="md" withCloseButton onClose={() => setAviso(null)} variant="light">
          {aviso.texto}
        </Alert>
      )}

      {cargando && !datos ? (
        <Center py="xl">
          <Loader />
        </Center>
      ) : error ? (
        <Alert color="red" icon={<IconAlertCircle size={16} />}>
          {error}
        </Alert>
      ) : datos ? (
        <>
          <SimpleGrid cols={{ base: 2, sm: 3, lg: 6 }} mb="md">
            <Kpi titulo="Licencias activas" valor={String(datos.resumen.licencias)} />
            <Kpi titulo="Organizaciones de Anthropic" valor={String(datos.resumen.organizaciones)} />
            <Kpi titulo="Agentes con licencia" valor={String(datos.resumen.agentes)} />
            <Kpi
              titulo="Costo mensual registrado"
              valor={dinero(datos.resumen.costoMensual)}
              nota={datos.resumen.licenciasSinCosto ? `${datos.resumen.licenciasSinCosto} licencias sin costo` : undefined}
            />
            <Kpi titulo="Licencias que mezclan empresas" valor={String(datos.resumen.mezclanEmpresas)} color={datos.resumen.mezclanEmpresas ? "red" : "green"} />
            <Kpi titulo="Con uso adicional pagado" valor={String(datos.resumen.conUsoAdicional)} color={datos.resumen.conUsoAdicional ? "yellow" : "green"} />
          </SimpleGrid>

          <SimpleGrid cols={{ base: 1, sm: 3 }} mb="md">
            <Kpi
              titulo="Consumo de hoy · valor equivalente en API"
              valor={usd(datos.resumen.consumoHoy.valorApi)}
              nota={`${datos.resumen.consumoHoy.turnos} turnos · ${tokens(datos.resumen.consumoHoy.tokens)} tokens`}
            />
            <Kpi
              titulo="Consumo del mes · valor equivalente en API"
              valor={usd(datos.resumen.consumoMes.valorApi)}
              nota={
                datos.resumen.costoMensual
                  ? `Pagamos ${dinero(datos.resumen.costoMensual)} en licencias: rinden ${(datos.resumen.consumoMes.valorApi / datos.resumen.costoMensual).toFixed(1).replace(".", ",")} veces`
                  : `${datos.resumen.consumoMes.turnos} turnos · ${tokens(datos.resumen.consumoMes.tokens)} tokens`
              }
            />
            <Kpi
              titulo="Agentes que reportan consumo"
              valor={`${datos.resumen.agentesConConsumo} de ${datos.resumen.agentesActivos}`}
              nota="Los demás no tienen aún el hook de consumo por turno"
              color={datos.resumen.agentesConConsumo < datos.resumen.agentesActivos ? "yellow" : "green"}
            />
          </SimpleGrid>

          {datos.resumen.mezclanEmpresas > 0 && (
            <Alert color="red" variant="light" mb="md" icon={<IconAlertCircle size={16} />} title="Licencias que incumplen la regla de negocio">
              {datos.licencias
                .filter((l) => l.alertas.some((a) => a.texto.startsWith("Mezcla empresas")))
                .map((l) => (
                  <Text size="sm" key={l.idLicencia}>
                    <b>{l.codigo}</b> · {l.alertas.find((a) => a.texto.startsWith("Mezcla empresas"))?.texto}
                  </Text>
                ))}
            </Alert>
          )}

          <Card withBorder radius="md" padding="md" mb="md" className="chat-surface">
            <Text fw={600} size="sm" mb="xs">
              Licencias
            </Text>
            <ScrollArea type="auto">
              <Table striped highlightOnHover verticalSpacing="xs" style={{ minWidth: 1300 }}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Licencia</Table.Th>
                    <Table.Th>Paga</Table.Th>
                    <Table.Th>Plan y costo</Table.Th>
                    <Table.Th>Agentes que la comparten</Table.Th>
                    <Table.Th ta="right">Uso actual</Table.Th>
                    <Table.Th>Promedio 4 semanas</Table.Th>
                    <Table.Th ta="right">Costo por agente</Table.Th>
                    <Table.Th ta="right">Consumo del mes</Table.Th>
                    <Table.Th>Alertas</Table.Th>
                    <Table.Th />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {datos.licencias.map((l) => (
                    <Table.Tr key={l.idLicencia} style={{ opacity: l.activa ? 1 : 0.5 }}>
                      <Table.Td>
                        <Text fw={700} size="sm">
                          {l.codigo}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {l.organizacion ?? "Organización sin registrar"}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">{l.empresa}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">{l.plan ?? "—"}</Text>
                        <Text size="xs" c="dimmed">
                          {dinero(l.costoMensual, l.moneda)}
                          {l.renovacion ? ` · renueva ${l.renovacion}` : ""}
                        </Text>
                      </Table.Td>
                      <Table.Td style={{ maxWidth: 340 }}>
                        <Group gap={4}>
                          {l.agentes.length === 0 ? (
                            <Text size="xs" c="dimmed">
                              Sin agentes
                            </Text>
                          ) : (
                            l.agentes.map((a) => {
                              const otra = a.idEmpresa !== null && a.idEmpresa !== l.idEmpresa;
                              return (
                                <Tooltip
                                  key={a.idAgent}
                                  withArrow
                                  multiline
                                  w={260}
                                  label={`${a.empresa ?? "Sin empresa"} · ${a.departamento ?? "Sin departamento"} · uso ${pct(a.uso7d)}${a.medidoEn ? ` (${fechaCorta(a.medidoEn)})` : ""}${otra ? " · OTRA EMPRESA" : ""}`}
                                >
                                  <Badge size="sm" variant={otra ? "filled" : "light"} color={otra ? "red" : "gray"}>
                                    {a.nombre}
                                  </Badge>
                                </Tooltip>
                              );
                            })
                          )}
                        </Group>
                      </Table.Td>
                      <Table.Td ta="right">
                        <Text size="sm">{pct(l.usoActual)}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Group gap={6} wrap="nowrap">
                          <Badge size="sm" variant="light" color={COLOR[l.semaforo]}>
                            {pct(l.promedio4)}
                          </Badge>
                          <Semanas l={l} />
                        </Group>
                        <Text size="xs" c="dimmed">
                          {l.semanas.length ? `pico ${pct(l.pico4)} · ${l.semanas.length} sem.` : "sin historial aún"}
                        </Text>
                      </Table.Td>
                      <Table.Td ta="right">
                        <Text size="sm">{dinero(l.costoPorAgente, l.moneda)}</Text>
                      </Table.Td>
                      <Table.Td ta="right">
                        <Tooltip
                          withArrow
                          multiline
                          w={280}
                          label={`Hoy: ${usd(l.consumoHoy.valorApi)} · ${l.consumoHoy.turnos} turnos. Mes: ${l.consumoMes.turnos} turnos · ${tokens(l.consumoMes.tokens)} tokens. Valor si se pagara por API.`}
                        >
                          <div>
                            <Text size="sm">{usd(l.consumoMes.valorApi)}</Text>
                            <Text size="xs" c="dimmed">
                              {l.rendimiento !== null ? `rinde ${String(l.rendimiento).replace(".", ",")}×` : `${tokens(l.consumoMes.tokens)} tokens`}
                            </Text>
                          </div>
                        </Tooltip>
                      </Table.Td>
                      <Table.Td style={{ maxWidth: 300 }}>
                        <Group gap={4}>
                          {l.alertas.length === 0 ? (
                            <Badge size="xs" variant="light" color="green">
                              Sin alertas
                            </Badge>
                          ) : (
                            l.alertas.map((a, i) => (
                              <Tooltip key={i} label={a.texto} withArrow multiline w={320}>
                                <Badge size="xs" variant="light" color={ALERTA[a.nivel]}>
                                  {a.texto.split(":")[0].split(".")[0]}
                                </Badge>
                              </Tooltip>
                            ))
                          )}
                        </Group>
                      </Table.Td>
                      <Table.Td>
                        <Button size="compact-xs" variant="subtle" leftSection={<IconPencil size={12} />} onClick={() => setEdicion({ ...l })}>
                          Editar
                        </Button>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          </Card>

          <SimpleGrid cols={{ base: 1, md: 2 }} mb="md">
            <Card withBorder radius="md" padding="md" className="chat-surface">
              <Text fw={600} size="sm">
                Costo mensual por empresa
              </Text>
              <Text size="xs" c="dimmed" mb="xs">
                Lo que paga cada empresa por sus licencias.
              </Text>
              <Table verticalSpacing={4}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Empresa</Table.Th>
                    <Table.Th ta="right">Licencias</Table.Th>
                    <Table.Th ta="right">Agentes</Table.Th>
                    <Table.Th ta="right">Costo mensual</Table.Th>
                    <Table.Th ta="right">Valor API del mes</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {datos.porEmpresa.map((e) => (
                    <Table.Tr key={e.idEmpresa}>
                      <Table.Td>{e.empresa}</Table.Td>
                      <Table.Td ta="right">{e.licencias}</Table.Td>
                      <Table.Td ta="right">{e.agentes}</Table.Td>
                      <Table.Td ta="right">
                        {dinero(e.costoMensual)}
                        {e.sinCosto ? (
                          <Text span size="xs" c="dimmed">
                            {" "}
                            ({e.sinCosto} sin costo)
                          </Text>
                        ) : null}
                      </Table.Td>
                      <Table.Td ta="right">{usd(e.consumoMes.valorApi)}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Card>
            <Card withBorder radius="md" padding="md" className="chat-surface">
              <Text fw={600} size="sm">
                Costo mensual por departamento
              </Text>
              <Text size="xs" c="dimmed" mb="xs">
                El costo de cada licencia se reparte por igual entre sus agentes.
              </Text>
              <ScrollArea h={260} type="auto">
                <Table verticalSpacing={4}>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Departamento</Table.Th>
                      <Table.Th ta="right">Agentes</Table.Th>
                      <Table.Th ta="right">Costo mensual</Table.Th>
                      <Table.Th ta="right">Valor API del mes</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {datos.porDepartamento.map((d) => (
                      <Table.Tr key={d.departamento}>
                        <Table.Td>{d.departamento}</Table.Td>
                        <Table.Td ta="right">{d.agentes}</Table.Td>
                        <Table.Td ta="right">{dinero(d.costoMensual)}</Table.Td>
                        <Table.Td ta="right">{usd(d.consumoMes.valorApi)}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </ScrollArea>
            </Card>
          </SimpleGrid>

          <Card withBorder radius="md" padding="md" mb="md" className="chat-surface">
            <Group justify="space-between">
              <Text fw={600} size="sm">
                Consumo en vivo · últimos turnos de la flota
              </Text>
              <Text size="xs" c="dimmed">
                Valor equivalente en API (precio de lista): referencia, no lo que se paga
              </Text>
            </Group>
            <ScrollArea h={280} type="auto" mt="xs">
              <Table verticalSpacing={3} striped>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Cuándo</Table.Th>
                    <Table.Th>Agente</Table.Th>
                    <Table.Th>Empresa</Table.Th>
                    <Table.Th>Licencia</Table.Th>
                    <Table.Th>Modelo</Table.Th>
                    <Table.Th ta="right">Tokens</Table.Th>
                    <Table.Th ta="right">Valor API</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {datos.ultimosTurnos.map((u, i) => (
                    <Table.Tr key={`${u.fin}-${i}`}>
                      <Table.Td>
                        <Text size="xs">{haceSeg(u.fin, ahora)}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">{u.agente}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs">{u.empresa ?? "—"}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs">{u.licencia ?? "—"}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs" c="dimmed">
                          {(u.modelos ?? "—").replace(/claude-|anthropic\//g, "")}
                        </Text>
                      </Table.Td>
                      <Table.Td ta="right">
                        <Text size="xs">{tokens(u.tokens)}</Text>
                      </Table.Td>
                      <Table.Td ta="right">
                        <Text size="xs">{usd(u.valorApi)}</Text>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                  {datos.ultimosTurnos.length === 0 && (
                    <Table.Tr>
                      <Table.Td colSpan={7}>
                        <Text size="xs" c="dimmed">
                          Sin turnos en los últimos 7 días.
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  )}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          </Card>

          <SimpleGrid cols={{ base: 1, md: 2 }} mb="md">
            <Card withBorder radius="md" padding="md" className="chat-surface">
              <Text fw={600} size="sm">
                Agentes sin licencia registrada ({datos.sinLicencia.length})
              </Text>
              <Text size="xs" c="dimmed" mb="xs">
                Asígnelos a una licencia de su misma empresa.
              </Text>
              <ScrollArea h={240} type="auto">
                <Stack gap={6}>
                  {datos.sinLicencia.map((a) => (
                    <Group key={a.idAgent} justify="space-between" wrap="nowrap">
                      <div>
                        <Text size="sm">{a.nombre}</Text>
                        <Text size="xs" c="dimmed">
                          {a.empresa ?? "Sin empresa"} · {a.departamento ?? "Sin departamento"}
                        </Text>
                      </div>
                      <Select
                        size="xs"
                        w={200}
                        placeholder="Asignar licencia"
                        data={opcionesLicencia}
                        disabled={guardando}
                        onChange={(v) => v && void asignar(a, v)}
                      />
                    </Group>
                  ))}
                  {datos.sinLicencia.length === 0 && (
                    <Text size="xs" c="dimmed">
                      Todos los agentes activos tienen licencia.
                    </Text>
                  )}
                </Stack>
              </ScrollArea>
            </Card>
            <Card withBorder radius="md" padding="md" className="chat-surface">
              <Text fw={600} size="sm">
                Tokens por revocar ({datos.huellasPorRevocar.length})
              </Text>
              <Text size="xs" c="dimmed" mb="xs">
                Huellas de tokens que sobran o están vencidos: revocarlos en la consola de Anthropic y borrarlos del equipo.
              </Text>
              <Stack gap={4}>
                {datos.huellasPorRevocar.map((h) => (
                  <Group key={h.huella} gap="xs" wrap="nowrap">
                    <Badge size="sm" variant="light" color="yellow" style={{ fontFamily: "var(--mantine-font-family-monospace)" }}>
                      {h.huella}
                    </Badge>
                    <Text size="xs">{h.notas ?? ""}</Text>
                  </Group>
                ))}
              </Stack>
            </Card>
          </SimpleGrid>
          <Text size="xs" c="dimmed">
            Actualizado {new Date(datos.generadoEn).toLocaleString("es-CO")}. El uso es el que declara el puente de cada agente; un token
            nunca se guarda, solo su huella.
          </Text>
        </>
      ) : null}

      <Modal
        opened={edicion !== null}
        onClose={() => setEdicion(null)}
        title={edicion?.nueva ? "Nueva licencia" : `Editar licencia ${edicion?.codigo ?? ""}`}
        size="lg"
      >
        {edicion && (
          <Stack gap="sm">
            <Group grow>
              <TextInput
                label="Código"
                placeholder="L20"
                value={edicion.codigo ?? ""}
                disabled={!edicion.nueva}
                onChange={(e) => setEdicion({ ...edicion, codigo: e.currentTarget.value })}
              />
              <Select
                label="Empresa que la paga"
                data={opcionesEmpresa}
                value={edicion.idEmpresa ? String(edicion.idEmpresa) : null}
                onChange={(v) => setEdicion({ ...edicion, idEmpresa: v ? Number(v) : undefined })}
                searchable
              />
            </Group>
            <Group grow>
              <TextInput
                label="Organización de Anthropic"
                value={edicion.organizacion ?? ""}
                onChange={(e) => setEdicion({ ...edicion, organizacion: e.currentTarget.value })}
              />
              <TextInput
                label="Plan"
                placeholder="Max, Pro, Team…"
                value={edicion.plan ?? ""}
                onChange={(e) => setEdicion({ ...edicion, plan: e.currentTarget.value })}
              />
            </Group>
            <Group grow>
              <NumberInput
                label="Costo mensual"
                min={0}
                decimalScale={2}
                value={edicion.costoMensual ?? ""}
                onChange={(v) => setEdicion({ ...edicion, costoMensual: v === "" ? null : Number(v) })}
              />
              <TextInput
                label="Moneda"
                value={edicion.moneda ?? "USD"}
                maxLength={3}
                onChange={(e) => setEdicion({ ...edicion, moneda: e.currentTarget.value.toUpperCase() })}
              />
              <TextInput
                label="Renovación"
                type="date"
                value={edicion.renovacion ?? ""}
                onChange={(e) => setEdicion({ ...edicion, renovacion: e.currentTarget.value || null })}
              />
            </Group>
            <TextInput
              label="Responsable"
              value={edicion.responsable ?? ""}
              onChange={(e) => setEdicion({ ...edicion, responsable: e.currentTarget.value })}
            />
            <TextInput label="Notas" value={edicion.notas ?? ""} onChange={(e) => setEdicion({ ...edicion, notas: e.currentTarget.value })} />
            <Switch
              label="Licencia activa"
              checked={edicion.activa ?? true}
              onChange={(e) => setEdicion({ ...edicion, activa: e.currentTarget.checked })}
            />
            {!edicion.nueva && (edicion.agentes ?? []).length > 0 && (
              <div>
                <Text size="sm" fw={600} mb={4}>
                  Agentes de esta licencia
                </Text>
                <Stack gap={6}>
                  {(edicion.agentes ?? []).map((a) => (
                    <Group key={a.idAgent} justify="space-between" wrap="nowrap">
                      <Text size="sm">
                        {a.nombre}{" "}
                        <Text span size="xs" c="dimmed">
                          · {a.empresa ?? "Sin empresa"}
                        </Text>
                      </Text>
                      <Select
                        size="xs"
                        w={220}
                        data={opcionesLicencia}
                        value={String(a.idLicencia ?? edicion.idLicencia)}
                        disabled={guardando}
                        onChange={(v) => v && v !== String(edicion.idLicencia) && void asignar(a, v).then((ok) => ok && setEdicion(null))}
                      />
                    </Group>
                  ))}
                </Stack>
              </div>
            )}
            <Group justify="flex-end" mt="sm">
              <Button variant="default" onClick={() => setEdicion(null)}>
                Cancelar
              </Button>
              <Button loading={guardando} onClick={() => void guardarEdicion()} disabled={!edicion.idEmpresa || (edicion.nueva && !edicion.codigo)}>
                Guardar
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </div>
  );
}

function Kpi({ titulo, valor, nota, color }: { titulo: string; valor: string; nota?: string; color?: string }) {
  return (
    <Card withBorder radius="md" padding="sm" className="chat-surface">
      <Text size="xs" c="dimmed">
        {titulo}
      </Text>
      <Text fw={700} size="xl" c={color}>
        {valor}
      </Text>
      {nota && (
        <Text size="xs" c="dimmed">
          {nota}
        </Text>
      )}
    </Card>
  );
}

/** Barritas con el pico de cada una de las últimas 4 semanas. */
function Semanas({ l }: { l: LicenciaDto }) {
  const ult = [...l.semanas].sort((a, b) => a.reinicio.localeCompare(b.reinicio)).slice(-4);
  if (!ult.length) return null;
  return (
    <Group gap={2} wrap="nowrap" align="flex-end" style={{ height: 22 }}>
      {ult.map((s) => (
        <Tooltip key={s.reinicio} label={`Semana que reinicia ${fechaCorta(s.reinicio)}: pico ${pct(s.pico)}`} withArrow>
          <div
            style={{
              width: 7,
              height: Math.max(2, Math.min(22, (s.pico / 100) * 22)),
              borderRadius: 2,
              background: `var(--mantine-color-${s.pico > 80 ? "red" : s.pico >= 60 ? "yellow" : "blue"}-5)`,
            }}
          />
        </Tooltip>
      ))}
    </Group>
  );
}
