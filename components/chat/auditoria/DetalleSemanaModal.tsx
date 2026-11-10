"use client";

import { useEffect, useState } from "react";
import {
  Accordion,
  Alert,
  Badge,
  Center,
  Group,
  Loader,
  Modal,
  SimpleGrid,
  Text,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { IconAlertCircle } from "@tabler/icons-react";
import type { DetalleSemanaDto } from "../../../lib/agent-audit/automation-db";

/**
 * Detalle de una celda del mapa de calor (Nicolás, 2026-11-10): qué casos de uso
 * sumaron esa semana en ese departamento y por qué liberaron tanto tiempo.
 * Lo calcula GET /api/chat/auditoria/automatizaciones/semana con la misma
 * fórmula de la celda, así que los totales cuadran.
 */

const h = (v: number | null | undefined, dec = 0) =>
  v === null || v === undefined
    ? "—"
    : v.toLocaleString("es-CO", {
        maximumFractionDigits: dec,
        minimumFractionDigits: dec,
      });
const fecha = (iso: string) => {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
};

export interface CeldaSeleccionada {
  departamento: string;
  semana: string;
  numero: number;
}

export function DetalleSemanaModal({
  celda,
  onClose,
}: {
  celda: CeldaSeleccionada | null;
  onClose: () => void;
}) {
  const movil = useMediaQuery("(max-width: 48em)") ?? false;
  const [datos, setDatos] = useState<DetalleSemanaDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!celda) return;
    let vivo = true;
    setDatos(null);
    setError(null);
    const qs = new URLSearchParams({
      departamento: celda.departamento,
      semana: celda.semana,
    });
    fetch(`/api/chat/auditoria/automatizaciones/semana?${qs}`, {
      cache: "no-store",
    })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j?.error ?? "No se pudo cargar el detalle.");
        if (vivo) setDatos(j as DetalleSemanaDto);
      })
      .catch((e) => {
        if (vivo) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      vivo = false;
    };
  }, [celda]);

  return (
    <Modal
      opened={Boolean(celda)}
      onClose={onClose}
      fullScreen={movil}
      size="xl"
      radius="md"
      title={
        celda ? (
          <div>
            <Text fw={700}>
              {celda.departamento} · Semana {celda.numero}
            </Text>
            <Text size="xs" c="dimmed">
              {fecha(celda.semana)}
              {datos ? ` a ${fecha(datos.semanaHasta)}` : ""}
            </Text>
          </div>
        ) : null
      }
    >
      {error && (
        <Alert color="red" radius="md" icon={<IconAlertCircle size={18} />}>
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
          <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm" mb="sm">
            <div>
              <Text size="xs" c="dimmed">
                Horas liberadas
              </Text>
              <Text fw={800} size="lg" c="green">
                {h(datos.horasLiberadas, 1)} h
              </Text>
            </div>
            <div>
              <Text size="xs" c="dimmed">
                % liberado
              </Text>
              <Text fw={800} size="lg">
                {datos.mejora === null ? "—" : `${h(datos.mejora)} %`}
              </Text>
            </div>
            <div>
              <Text size="xs" c="dimmed">
                Sin IA → con IA
              </Text>
              <Text fw={700}>
                {h(datos.horasSinIA, 1)} h → {h(datos.horasConIA, 1)} h
              </Text>
            </div>
            <div>
              <Text size="xs" c="dimmed">
                Tareas medidas
              </Text>
              <Text fw={700}>{h(datos.ocurrencias)}</Text>
            </div>
          </SimpleGrid>

          {datos.agentes.length > 0 && (
            <Group gap={6} mb="sm">
              {datos.agentes.map((a) => (
                <Badge key={a.code} variant="light" color="green" size="md">
                  {a.agente}: {h(a.horasLiberadas, 1)} h · {h(a.ocurrencias)}{" "}
                  {a.ocurrencias === 1 ? "tarea" : "tareas"}
                </Badge>
              ))}
            </Group>
          )}

          <Alert color="gray" variant="light" p="xs" mb="sm">
            <Text size="xs">
              <b>Por qué tanto.</b> Cada caso de uso: veces que se pidió esa
              semana × (minutos de una persona sin IA − minutos pidiéndolo y
              revisándolo con el agente). Ordenado de mayor a menor tiempo
              liberado. Abra un caso para ver los pasos que se ahorran y los
              supuestos del cálculo.
            </Text>
          </Alert>

          {datos.items.length === 0 ? (
            <Text size="sm" c="dimmed">
              Esa semana no hubo tareas medidas en este departamento.
            </Text>
          ) : (
            <Accordion variant="separated" radius="md" chevronPosition="right">
              {datos.items.map((it) => (
                <Accordion.Item key={`${it.code}-${it.clave}`} value={`${it.code}-${it.clave}`}>
                  <Accordion.Control>
                    <Group justify="space-between" wrap="nowrap" gap="xs" align="flex-start">
                      <div style={{ minWidth: 0 }}>
                        <Text size="sm" fw={600} style={{ overflowWrap: "anywhere" }}>
                          {it.caso}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {it.agente} · {h(it.ocurrencias)}{" "}
                          {it.ocurrencias === 1 ? "vez" : "veces"} ×{" "}
                          ({h(it.minHumano)} − {h(it.minDespues)} min)
                          {it.area ? ` · ${it.area}` : ""}
                        </Text>
                      </div>
                      <Text size="sm" fw={700} c="green" style={{ whiteSpace: "nowrap" }}>
                        {h(it.horasLiberadas, 1)} h
                      </Text>
                    </Group>
                  </Accordion.Control>
                  <Accordion.Panel>
                    {it.descripcion && (
                      <Text size="sm" mb={6}>
                        {it.descripcion}
                      </Text>
                    )}
                    <Text size="xs" mb={4}>
                      <b>Sin IA:</b> {h(it.minHumano)} min por vez ·{" "}
                      <b>con IA:</b> {h(it.minDespues)} min (pedir y revisar)
                      {it.minAgente !== null
                        ? ` · el agente tarda ≈ ${h(it.minAgente, 1)} min`
                        : ""}
                      {" "}· esa semana: {h(it.horasSinIA, 1)} h →{" "}
                      {h(it.horasConIA, 1)} h
                    </Text>
                    {it.entregable && (
                      <Text size="xs" mb={4}>
                        <b>Entregable:</b> {it.entregable}
                      </Text>
                    )}
                    {it.pasos.length > 0 && (
                      <>
                        <Text size="xs" fw={600} mt={6}>
                          Pasos que haría una persona sin IA
                        </Text>
                        <ul style={{ margin: "2px 0 6px", paddingLeft: 18, fontSize: 12 }}>
                          {it.pasos.map((p, i) => (
                            <li key={i}>
                              {p.paso}
                              {p.minutos ? ` (${h(p.minutos)} min)` : ""}
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                    {it.supuestos && (
                      <Text size="xs" c="dimmed">
                        <b>Supuestos:</b> {it.supuestos}
                      </Text>
                    )}
                    {it.confianza && (
                      <Badge size="xs" variant="outline" mt={6}>
                        Confianza {it.confianza}
                      </Badge>
                    )}
                  </Accordion.Panel>
                </Accordion.Item>
              ))}
            </Accordion>
          )}
          <Text size="xs" c="dimmed" mt="sm">
            El indicador mide casos de uso por semana; no guarda el texto de
            cada conversación. La suma de los casos puede diferir en 0,1 h del
            total por redondeo.
          </Text>
        </>
      )}
    </Modal>
  );
}
