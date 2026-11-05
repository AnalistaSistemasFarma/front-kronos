"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Center,
  Group,
  Loader,
  Modal,
  ScrollArea,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Tooltip,
} from "@mantine/core";
import {
  IconCircleCheck,
  IconCircleX,
  IconClockHour4,
  IconPlayerPause,
  IconPlayerPlay,
  IconRefresh,
} from "@tabler/icons-react";
import { apiGet, apiSend } from "../../proyectos/api";
import type { ProgramadaDto } from "../../../lib/agent-audit/scheduled-db";
import type { OrdenProgramadaDto } from "../../../lib/agent-audit/scheduled-admin-db";
import { NOMBRE_SALUD } from "../../../lib/agent-audit/scheduled-salud";

/**
 * VER Y ADMINISTRAR UNA AUTOMATIZACIÓN PROGRAMADA (Nicolás, 2026-11-04).
 * Últimas corridas (log resumido), historial de órdenes y, para quien tiene
 * «Auditoría de agentes · Configurar»: Pausar, Reanudar y Ejecutar ahora, con
 * confirmación en dos pasos. La orden la aplica el ejecutor del Mac de la
 * automatización; aquí se sigue su estado hasta que termina. El resultado sale
 * ARRIBA del modal, con color (feedback-ux-feedback-visible).
 */

type Accion = "pausar" | "reanudar" | "ejecutar";

interface Detalle {
  programada: ProgramadaDto;
  ordenes: OrdenProgramadaDto[];
  puedeAdministrar: boolean;
  adminDisponible: boolean;
  acciones: Record<Accion, string | null>;
}

const ACCION: Record<
  Accion,
  { label: string; confirmar: string; color: string; icono: React.ReactNode }
> = {
  pausar: {
    label: "Pausar",
    confirmar: "Sí, pausar",
    color: "orange",
    icono: <IconPlayerPause size={14} />,
  },
  reanudar: {
    label: "Reanudar",
    confirmar: "Sí, reanudar",
    color: "teal",
    icono: <IconRefresh size={14} />,
  },
  ejecutar: {
    label: "Ejecutar ahora",
    confirmar: "Sí, ejecutar ahora",
    color: "blue",
    icono: <IconPlayerPlay size={14} />,
  },
};

const PREGUNTA: Record<Accion, (n: string) => string> = {
  pausar: (n) =>
    `¿Pausar «${n}»? Deja de correr (también después de reiniciar el equipo) hasta que alguien la reanude.`,
  reanudar: (n) =>
    `¿Reanudar «${n}»? Vuelve a correr en su horario. Si su configuración corre al cargar, puede correr de inmediato.`,
  ejecutar: (n) =>
    `¿Ejecutar «${n}» ahora, fuera de su horario? Hará lo mismo que en una corrida normal (publicar, enviar o cargar lo que le corresponda).`,
};

const COLOR_ORDEN: Record<string, string> = {
  pendiente: "blue",
  en_curso: "blue",
  ok: "green",
  ocupado: "yellow",
  error: "red",
  vencida: "yellow",
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

const activa = (o: OrdenProgramadaDto | undefined) =>
  o?.status === "pendiente" || o?.status === "en_curso";

export function DetalleProgramada({
  id,
  titulo,
  onClose,
  onCambio,
}: {
  id: number;
  titulo: string;
  onClose: () => void;
  /** La automatización cambió (orden terminada): la lista se refresca AL CERRAR. */
  onCambio?: () => void;
}) {
  const [datos, setDatos] = useState<Detalle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState<Accion | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<{ color: string; texto: string } | null>(
    null,
  );
  const seguida = useRef<number | null>(null);
  const cambio = useRef(false);

  const cargar = useCallback(async () => {
    const r = await apiGet<Detalle>(
      `/api/chat/auditoria/automatizaciones/programadas/${id}`,
    );
    if (!r.ok) {
      if (r.error) setError(r.error);
      return;
    }
    setError(null);
    setDatos(r.data);
    // Resultado de la orden que se está siguiendo: aviso arriba, con color.
    const o = r.data.ordenes.find((x) => x.id === seguida.current);
    if (o && !activa(o)) {
      seguida.current = null;
      cambio.current = true;
      setAviso({
        color: COLOR_ORDEN[o.status] ?? "gray",
        texto: `${o.texto}${o.result ? ` ${o.result}` : ""}`,
      });
    }
  }, [id]);

  const ordenActiva = datos?.ordenes.find((o) => activa(o));

  useEffect(() => {
    void cargar();
  }, [cargar]);
  // Mientras hay una orden activa, se relee cada 5 s para mostrar el resultado.
  useEffect(() => {
    if (!ordenActiva) return;
    const t = window.setInterval(() => void cargar(), 5_000);
    return () => window.clearInterval(t);
  }, [ordenActiva, cargar]);

  const cerrar = () => {
    if (cambio.current) onCambio?.();
    onClose();
  };

  const pedir = async (accion: Accion) => {
    setEnviando(true);
    setAviso(null);
    const r = await apiSend<{ orden?: OrdenProgramadaDto }>(
      "POST",
      `/api/chat/auditoria/automatizaciones/programadas/${id}`,
      { accion, confirmar: true },
    );
    setEnviando(false);
    setConfirmando(null);
    if (r.ok) {
      seguida.current = r.data.orden?.id ?? null;
      cambio.current = true;
      setAviso({
        color: "blue",
        texto: `Orden «${ACCION[accion].label}» registrada. El equipo de la automatización la toma en menos de un minuto; el resultado aparecerá aquí.`,
      });
    } else {
      setAviso({
        color: r.status === 409 ? "yellow" : "red",
        texto: r.error,
      });
    }
    void cargar();
  };

  const p = datos?.programada;
  const s = p ? NOMBRE_SALUD[p.salud] : null;

  return (
    <Modal
      opened
      onClose={cerrar}
      title={<Text fw={700}>{titulo}</Text>}
      size="xl"
      centered
    >
      {aviso && (
        <Alert
          color={aviso.color}
          variant="light"
          mb="sm"
          data-testid="programada-aviso"
        >
          <Text size="sm">{aviso.texto}</Text>
        </Alert>
      )}
      {error && (
        <Alert color="red" variant="light" mb="sm">
          <Text size="sm">{error}</Text>
        </Alert>
      )}
      {!datos && !error && (
        <Center py="lg">
          <Loader size="sm" />
        </Center>
      )}
      {p && s && datos && (
        <Stack gap="md">
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
            <div>
              <Text size="xs" c="dimmed">
                Estado
              </Text>
              <Badge color={s.color} variant="light">
                {s.label}
              </Badge>
              {p.saludDetalle && (
                <Text size="xs" mt={2} c={s.color === "red" ? "red" : undefined}>
                  {p.saludDetalle}
                </Text>
              )}
            </div>
            <div>
              <Text size="xs" c="dimmed">
                Cuándo corre
              </Text>
              <Text size="sm">{p.programacion ?? "—"}</Text>
            </div>
            <div>
              <Text size="xs" c="dimmed">
                Última corrida
              </Text>
              <Text size="sm">{fechaHora(p.ultimaCorrida)}</Text>
            </div>
            <div>
              <Text size="xs" c="dimmed">
                Leída por última vez
              </Text>
              <Text size="sm">{fechaHora(p.vistoAt)}</Text>
            </div>
          </SimpleGrid>
          {p.descripcion && <Text size="sm">{p.descripcion}</Text>}

          {datos.puedeAdministrar && (
            <Stack gap={6}>
              <Text fw={600} size="sm">
                Administrar
              </Text>
              {!p.administrable ? (
                <Alert color="gray" variant="light" p="xs">
                  <Text size="xs">{p.motivoNoAdministrable}</Text>
                </Alert>
              ) : confirmando ? (
                <Alert
                  color={ACCION[confirmando].color}
                  variant="light"
                  data-testid="programada-confirmacion"
                >
                  <Text size="sm">{PREGUNTA[confirmando](p.nombre)}</Text>
                  <Group gap="xs" justify="flex-end" mt="xs">
                    <Button
                      size="xs"
                      variant="default"
                      onClick={() => setConfirmando(null)}
                      disabled={enviando}
                    >
                      Cancelar
                    </Button>
                    <Button
                      size="xs"
                      color={ACCION[confirmando].color}
                      loading={enviando}
                      onClick={() => void pedir(confirmando)}
                      data-testid="programada-confirmar"
                    >
                      {ACCION[confirmando].confirmar}
                    </Button>
                  </Group>
                </Alert>
              ) : (
                <Group gap="xs">
                  {(Object.keys(ACCION) as Accion[]).map((a) => {
                    const motivo = datos.acciones[a];
                    return (
                      <Tooltip
                        key={a}
                        label={motivo ?? ""}
                        disabled={!motivo}
                        withArrow
                        multiline
                        w={240}
                      >
                        <span>
                          <Button
                            size="xs"
                            variant="light"
                            color={ACCION[a].color}
                            leftSection={ACCION[a].icono}
                            disabled={Boolean(motivo) || enviando}
                            onClick={() => {
                              setAviso(null);
                              setConfirmando(a);
                            }}
                            data-testid={`programada-${a}`}
                          >
                            {ACCION[a].label}
                          </Button>
                        </span>
                      </Tooltip>
                    );
                  })}
                </Group>
              )}
              {ordenActiva && (
                <Alert color="blue" variant="light" p="xs">
                  <Group gap={6} wrap="nowrap">
                    <Loader size={14} />
                    <Text size="xs">
                      {ordenActiva.texto} Pedida por {ordenActiva.requestedBy}.
                    </Text>
                  </Group>
                </Alert>
              )}
            </Stack>
          )}
          {!datos.adminDisponible && (
            <Text size="xs" c="dimmed">
              Administrar automatizaciones aún no está habilitado en este
              ambiente.
            </Text>
          )}

          <div>
            <Text fw={600} size="sm" mb={4}>
              Últimas corridas
            </Text>
            {p.ultimas.length === 0 ? (
              <Text size="xs" c="dimmed">
                El recolector todavía no publicó el detalle de sus corridas.
              </Text>
            ) : (
              <ScrollArea type="auto">
                <Table fz="xs" verticalSpacing={4} miw={480}>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Fecha</Table.Th>
                      <Table.Th>Resultado</Table.Th>
                      <Table.Th ta="right">Producción</Table.Th>
                      <Table.Th>Detalle</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {[...p.ultimas].reverse().map((u) => (
                      <Table.Tr key={u.ts}>
                        <Table.Td style={{ whiteSpace: "nowrap" }}>
                          {fechaHora(u.ts)}
                        </Table.Td>
                        <Table.Td>
                          {u.ok === true ? (
                            <Group gap={4} wrap="nowrap">
                              <IconCircleCheck
                                size={14}
                                color="var(--mantine-color-green-6)"
                              />
                              Bien
                            </Group>
                          ) : u.ok === false ? (
                            <Group gap={4} wrap="nowrap">
                              <IconCircleX
                                size={14}
                                color="var(--mantine-color-red-6)"
                              />
                              Falló
                            </Group>
                          ) : (
                            <Group gap={4} wrap="nowrap">
                              <IconClockHour4 size={14} />
                              En curso
                            </Group>
                          )}
                        </Table.Td>
                        <Table.Td ta="right">{u.produccion ?? "—"}</Table.Td>
                        <Table.Td>
                          <Text size="xs" c="dimmed" style={{ wordBreak: "break-word" }}>
                            {u.nota ?? ""}
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </ScrollArea>
            )}
          </div>

          {datos.ordenes.length > 0 && (
            <div>
              <Text fw={600} size="sm" mb={4}>
                Órdenes recientes
              </Text>
              <ScrollArea type="auto">
                <Table fz="xs" verticalSpacing={4} miw={520}>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Pedida</Table.Th>
                      <Table.Th>Acción</Table.Th>
                      <Table.Th>Estado</Table.Th>
                      <Table.Th>Por</Table.Th>
                      <Table.Th>Resultado</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {datos.ordenes.map((o) => (
                      <Table.Tr key={o.id}>
                        <Table.Td style={{ whiteSpace: "nowrap" }}>
                          {fechaHora(o.requestedAt)}
                        </Table.Td>
                        <Table.Td>{ACCION[o.accion]?.label ?? o.accion}</Table.Td>
                        <Table.Td>
                          <Badge size="xs" variant="light" color={COLOR_ORDEN[o.status] ?? "gray"}>
                            {o.status.replace("_", " ")}
                          </Badge>
                        </Table.Td>
                        <Table.Td>{o.requestedBy}</Table.Td>
                        <Table.Td>
                          <Text size="xs" c="dimmed">
                            {o.result ?? ""}
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </ScrollArea>
            </div>
          )}
        </Stack>
      )}
    </Modal>
  );
}
