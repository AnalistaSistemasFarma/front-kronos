"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Center,
  FileInput,
  Group,
  Loader,
  Modal,
  NumberInput,
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
import { IconAlertCircle, IconArrowLeft, IconFileInvoice, IconFileTypePdf, IconPencil, IconPlus, IconTrash, IconUpload } from "@tabler/icons-react";
import { leerFacturaAnthropic, type FacturaResumenDto, type FacturasAnioDto, type LineaFacturaDto, type RepartoDto } from "../../../../../../lib/agent-audit/facturas";

/**
 * AUDITORÍA DE AGENTES → FACTURAS DE IA (Nicolás, 2026-11-17): facturas de los
 * proveedores de IA por empresa y por año. Dos miradas: lo que cada empresa PAGÓ
 * (la factura llega a su nombre) y lo que le CORRESPONDE (reparto interno según las
 * licencias de la organización), porque cada empresa paga lo suyo.
 * Al subir el PDF, el navegador lee sus datos (número, fechas, período, líneas,
 * total) y la persona los revisa antes de guardar.
 * LA REJA ESTÁ EN EL ENDPOINT (/api/chat/auditoria/facturas): solo administración.
 */

const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const dinero = (v: number | null, moneda = "USD") =>
  v === null ? "—" : `${moneda} ${v.toLocaleString("es-CO", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const fecha = (s: string | null) => (s ? new Date(`${s}T12:00:00Z`).toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" }) : "—");

type Edicion = {
  idFactura: number | null;
  proveedor: string;
  numero: string;
  fecha: string;
  vence: string;
  periodoDesde: string;
  periodoHasta: string;
  facturadoA: string;
  correoCuenta: string;
  organizacion: string | null;
  idEmpresa: string | null;
  moneda: string;
  subtotal: number | "";
  impuestos: number | "";
  total: number | "";
  estado: string;
  notas: string;
  lineas: LineaFacturaDto[];
  pdfBase64: string | null;
  pdfNombre: string | null;
};

const vacia = (idEmpresa: string | null): Edicion => ({
  idFactura: null,
  proveedor: "Anthropic",
  numero: "",
  fecha: "",
  vence: "",
  periodoDesde: "",
  periodoHasta: "",
  facturadoA: "",
  correoCuenta: "",
  organizacion: null,
  idEmpresa,
  moneda: "USD",
  subtotal: "",
  impuestos: "",
  total: "",
  estado: "pagada",
  notas: "",
  lineas: [],
  pdfBase64: null,
  pdfNombre: null,
});

/** Texto del PDF en el navegador: celdas de una misma fila unidas con « | ». */
async function textoPdf(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const partes: string[] = [];
  for (let i = 1; i <= Math.min(pdf.numPages, 10); i++) {
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    const filas = new Map<number, { x: number; s: string }[]>();
    for (const it of tc.items as { str: string; transform: number[] }[]) {
      if (!it.str?.trim()) continue;
      const y = Math.round(it.transform[5]);
      const k = [...filas.keys()].find((r) => Math.abs(r - y) <= 2) ?? y;
      filas.set(k, [...(filas.get(k) ?? []), { x: it.transform[4], s: it.str }]);
    }
    partes.push(
      [...filas.entries()]
        .sort((a, b) => b[0] - a[0])
        .map(([, c]) => c.sort((a, b) => a.x - b.x).map((x) => x.s).join(" | "))
        .join("\n"),
    );
  }
  return partes.join("\n");
}

const base64 = (file: File) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1] ?? "");
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });

export default function FacturasIaPage() {
  const [anio, setAnio] = useState(() => new Date().getFullYear());
  const [datos, setDatos] = useState<FacturasAnioDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [aviso, setAviso] = useState<{ color: string; texto: string } | null>(null);
  const [edicion, setEdicion] = useState<Edicion | null>(null);
  const [leyendo, setLeyendo] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [reparto, setReparto] = useState<{ f: FacturaResumenDto; filas: { idEmpresa: string | null; monto: number | "" }[] } | null>(null);
  const [filtroEmpresa, setFiltroEmpresa] = useState<string | null>(null);

  const cargar = useCallback(async (a: number) => {
    setCargando(true);
    try {
      const r = await fetch(`/api/chat/auditoria/facturas?anio=${a}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "No se pudieron cargar las facturas.");
      setDatos(j);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }, []);
  useEffect(() => {
    void cargar(anio);
  }, [anio, cargar]);

  const opcionesEmpresa = useMemo(() => (datos?.empresas ?? []).map((e) => ({ value: String(e.idEmpresa), label: e.empresa })), [datos]);
  const idGss = useMemo(() => datos?.empresas.find((e) => e.empresa === "GSS")?.idEmpresa ?? null, [datos]);
  const maxMes = Math.max(1, ...(datos?.porMes ?? []).map((m) => m.total));
  const facturasVisibles = useMemo(
    () =>
      (datos?.facturas ?? []).filter(
        (f) => !filtroEmpresa || String(f.idEmpresa) === filtroEmpresa || f.reparto.some((r) => String(r.idEmpresa) === filtroEmpresa),
      ),
    [datos, filtroEmpresa],
  );

  async function enviar(body: unknown, exito: string) {
    setGuardando(true);
    try {
      const r = await fetch("/api/chat/auditoria/facturas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "No se pudo guardar.");
      setAviso({ color: "green", texto: exito });
      await cargar(anio);
      return true;
    } catch (e) {
      setAviso({ color: "red", texto: (e as Error).message });
      return false;
    } finally {
      setGuardando(false);
    }
  }

  async function alElegirPdf(file: File | null) {
    if (!file || !edicion) return;
    setLeyendo(true);
    try {
      const [texto, b64] = await Promise.all([textoPdf(file), base64(file)]);
      const f = leerFacturaAnthropic(texto);
      const cuenta = f.correoCuenta?.toLowerCase() ?? "";
      setEdicion({
        ...edicion,
        proveedor: f.proveedor ?? edicion.proveedor,
        numero: f.numero ?? edicion.numero,
        fecha: f.fecha ?? edicion.fecha,
        vence: f.vence ?? "",
        periodoDesde: f.periodoDesde ?? "",
        periodoHasta: f.periodoHasta ?? "",
        facturadoA: f.facturadoA ?? "",
        correoCuenta: f.correoCuenta ?? "",
        // La cuenta principal (automatizacion@) es la organización «GSS principal».
        organizacion: edicion.organizacion ?? (cuenta.startsWith("automatizacion@") ? "GSS principal" : null),
        moneda: f.moneda ?? "USD",
        subtotal: f.subtotal ?? "",
        impuestos: f.impuestos ?? "",
        total: f.total ?? "",
        lineas: f.lineas,
        pdfBase64: b64,
        pdfNombre: file.name,
      });
      setAviso(
        f.numero && f.total !== null
          ? { color: "blue", texto: `Leída la factura ${f.numero} por ${dinero(f.total, f.moneda ?? "USD")}. Revise los datos antes de guardar.` }
          : { color: "yellow", texto: "No se pudieron leer todos los datos del PDF: complételos a mano." },
      );
    } catch {
      setAviso({ color: "red", texto: "No se pudo leer el PDF. Complete los datos a mano." });
    } finally {
      setLeyendo(false);
    }
  }

  async function guardar() {
    if (!edicion) return;
    const ok = await enviar(
      {
        accion: "guardar",
        factura: {
          ...edicion,
          idEmpresa: edicion.idEmpresa ? Number(edicion.idEmpresa) : null,
          subtotal: edicion.subtotal === "" ? null : edicion.subtotal,
          impuestos: edicion.impuestos === "" ? null : edicion.impuestos,
          total: edicion.total === "" ? null : edicion.total,
        },
      },
      edicion.idFactura ? "Factura actualizada." : "Factura guardada y repartida según las licencias de su organización.",
    );
    if (ok) setEdicion(null);
  }

  const editar = (f: FacturaResumenDto) =>
    setEdicion({
      idFactura: f.idFactura,
      proveedor: f.proveedor,
      numero: f.numero,
      fecha: f.fecha,
      vence: f.vence ?? "",
      periodoDesde: f.periodoDesde ?? "",
      periodoHasta: f.periodoHasta ?? "",
      facturadoA: f.facturadoA ?? "",
      correoCuenta: f.correoCuenta ?? "",
      organizacion: f.organizacion,
      idEmpresa: String(f.idEmpresa),
      moneda: f.moneda,
      subtotal: f.subtotal ?? "",
      impuestos: f.impuestos ?? "",
      total: f.total,
      estado: f.estado,
      notas: f.notas ?? "",
      lineas: f.lineas,
      pdfBase64: null,
      pdfNombre: f.pdfNombre,
    });

  const sumaReparto = reparto ? Math.round(reparto.filas.reduce((s, r) => s + (r.monto === "" ? 0 : r.monto), 0) * 100) / 100 : 0;

  return (
    <div style={{ padding: "16px 20px", maxWidth: 1500, margin: "0 auto" }}>
      <Group mb="xs" gap="xs">
        <Link href="/process/chat/auditoria" className="chat-text-muted" style={{ fontSize: 13 }}>
          <Group gap={4}>
            <IconArrowLeft size={14} /> Auditoría de agentes
          </Group>
        </Link>
        <Text size="xs" c="dimmed">
          ·
        </Text>
        <Link href="/process/chat/auditoria/licencias" className="chat-text-muted" style={{ fontSize: 13 }}>
          Costos y licencias
        </Link>
      </Group>
      <Group justify="space-between" mb="xs" wrap="wrap">
        <Group gap="sm" wrap="nowrap">
          <IconFileInvoice size={26} className="chat-folder__icon" />
          <Title order={1} className="ios-process-hub__title text-3xl">
            Facturas de IA
          </Title>
        </Group>
        <Group gap="sm">
          <Select
            size="xs"
            w={110}
            data={(datos?.anios ?? [anio]).map((a) => ({ value: String(a), label: String(a) }))}
            value={String(anio)}
            onChange={(v) => v && setAnio(Number(v))}
            allowDeselect={false}
          />
          <Button size="xs" leftSection={<IconPlus size={14} />} disabled={!datos} onClick={() => setEdicion(vacia(idGss ? String(idGss) : null))}>
            Subir factura
          </Button>
        </Group>
      </Group>
      <Text size="sm" c="dimmed" mb="md">
        Lo que se paga a los proveedores de IA, por empresa y por año. <b>Pagó</b>: la factura llega a nombre de esa empresa.{" "}
        <b>Le corresponde</b>: el reparto interno según las licencias que usa cada empresa (cada empresa paga lo suyo).
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
          <SimpleGrid cols={{ base: 2, md: 4 }} mb="md">
            <Kpi titulo={`Total ${datos.anio}`} valor={dinero(datos.total, datos.moneda)} />
            <Kpi titulo="Facturas" valor={String(datos.facturas.length)} />
            <Kpi
              titulo="Promedio por mes con facturas"
              valor={dinero(
                (() => {
                  const meses = datos.porMes.filter((m) => m.total > 0).length;
                  return meses ? Math.round((datos.total / meses) * 100) / 100 : 0;
                })(),
                datos.moneda,
              )}
            />
            <Kpi titulo="Facturas sin reparto" valor={String(datos.sinReparto)} color={datos.sinReparto ? "yellow" : "green"} />
          </SimpleGrid>

          <SimpleGrid cols={{ base: 1, md: 2 }} mb="md">
            <Card withBorder radius="md" padding="md" className="chat-surface">
              <Text fw={600} size="sm" mb="xs">
                Por empresa · {datos.anio}
              </Text>
              <Table verticalSpacing={4}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Empresa</Table.Th>
                    <Table.Th ta="right">Pagó</Table.Th>
                    <Table.Th ta="right">Le corresponde</Table.Th>
                    <Table.Th ta="right">Diferencia</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {datos.porEmpresa.map((e) => {
                    const dif = Math.round((e.pagado - e.corresponde) * 100) / 100;
                    return (
                      <Table.Tr
                        key={e.idEmpresa}
                        onClick={() => setFiltroEmpresa(filtroEmpresa === String(e.idEmpresa) ? null : String(e.idEmpresa))}
                        style={{ cursor: "pointer", background: filtroEmpresa === String(e.idEmpresa) ? "var(--mantine-color-blue-light)" : undefined }}
                      >
                        <Table.Td>{e.empresa}</Table.Td>
                        <Table.Td ta="right">{dinero(e.pagado, datos.moneda)}</Table.Td>
                        <Table.Td ta="right">
                          <b>{dinero(e.corresponde, datos.moneda)}</b>
                        </Table.Td>
                        <Table.Td ta="right">
                          <Tooltip label={dif > 0 ? "Pagó de más: le deben las otras empresas" : dif < 0 ? "Pagó otra empresa por ella: debe reembolsar" : "Cuadrado"} withArrow>
                            <Text size="sm" c={dif > 0 ? "green" : dif < 0 ? "red" : "dimmed"}>
                              {dif === 0 ? "—" : dinero(dif, datos.moneda)}
                            </Text>
                          </Tooltip>
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                  {datos.porEmpresa.length === 0 && (
                    <Table.Tr>
                      <Table.Td colSpan={4}>
                        <Text size="xs" c="dimmed">
                          Sin facturas en {datos.anio}.
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  )}
                </Table.Tbody>
              </Table>
              <Text size="xs" c="dimmed" mt={4}>
                Toque una empresa para filtrar sus facturas.
              </Text>
            </Card>
            <Card withBorder radius="md" padding="md" className="chat-surface">
              <Text fw={600} size="sm" mb="xs">
                Por mes · {datos.anio}
              </Text>
              <Group gap={6} align="flex-end" wrap="nowrap" style={{ height: 160 }}>
                {datos.porMes.map((m) => (
                  <Tooltip key={m.mes} label={`${MESES[m.mes - 1]}: ${dinero(m.total, datos.moneda)}`} withArrow>
                    <Stack gap={2} align="center" style={{ flex: 1 }}>
                      <div
                        style={{
                          width: "100%",
                          maxWidth: 34,
                          height: Math.max(m.total ? 4 : 1, (m.total / maxMes) * 130),
                          borderRadius: 4,
                          background: m.total ? "var(--mantine-color-blue-6)" : "var(--mantine-color-gray-3)",
                        }}
                      />
                      <Text size="10px" c="dimmed">
                        {MESES[m.mes - 1]}
                      </Text>
                    </Stack>
                  </Tooltip>
                ))}
              </Group>
              <Group gap="xs" mt="sm">
                {datos.porProveedor.map((p) => (
                  <Badge key={p.proveedor} variant="light">
                    {p.proveedor}: {dinero(p.total, datos.moneda)} · {p.facturas} fact.
                  </Badge>
                ))}
              </Group>
            </Card>
          </SimpleGrid>

          <Card withBorder radius="md" padding="md" mb="md" className="chat-surface">
            <Group justify="space-between" mb="xs">
              <Text fw={600} size="sm">
                Facturas {filtroEmpresa ? `· ${datos.empresas.find((e) => String(e.idEmpresa) === filtroEmpresa)?.empresa}` : ""}
              </Text>
              {filtroEmpresa && (
                <Button size="compact-xs" variant="subtle" onClick={() => setFiltroEmpresa(null)}>
                  Ver todas
                </Button>
              )}
            </Group>
            <ScrollArea type="auto">
              <Table striped highlightOnHover verticalSpacing="xs" style={{ minWidth: 1150 }}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Fecha</Table.Th>
                    <Table.Th>Proveedor y número</Table.Th>
                    <Table.Th>Período</Table.Th>
                    <Table.Th>Cuenta</Table.Th>
                    <Table.Th>Pagó</Table.Th>
                    <Table.Th>Detalle</Table.Th>
                    <Table.Th ta="right">Total</Table.Th>
                    <Table.Th>Le corresponde</Table.Th>
                    <Table.Th />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {facturasVisibles.map((f) => (
                    <Table.Tr key={f.idFactura}>
                      <Table.Td>
                        <Text size="sm">{fecha(f.fecha)}</Text>
                        {f.estado === "pendiente" && (
                          <Badge size="xs" color="yellow" variant="light">
                            Pendiente
                          </Badge>
                        )}
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm" fw={600}>
                          {f.proveedor}
                        </Text>
                        <Text size="xs" c="dimmed" style={{ fontFamily: "var(--mantine-font-family-monospace)" }}>
                          {f.numero}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs">{f.periodoDesde ? `${fecha(f.periodoDesde)} – ${fecha(f.periodoHasta)}` : "—"}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs">{f.correoCuenta ?? f.facturadoA ?? "—"}</Text>
                        <Text size="xs" c="dimmed">
                          {f.organizacion ?? "Sin organización"}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">{f.empresa}</Text>
                      </Table.Td>
                      <Table.Td style={{ maxWidth: 260 }}>
                        {f.lineas.map((l, i) => (
                          <Text size="xs" key={i}>
                            {l.cantidad !== null ? `${l.cantidad} × ` : ""}
                            {l.descripcion} · {dinero(l.monto, f.moneda)}
                          </Text>
                        ))}
                      </Table.Td>
                      <Table.Td ta="right">
                        <Text size="sm" fw={700}>
                          {dinero(f.total, f.moneda)}
                        </Text>
                      </Table.Td>
                      <Table.Td style={{ maxWidth: 260 }}>
                        <Group gap={4}>
                          {f.reparto.length === 0 ? (
                            <Badge size="xs" color="yellow" variant="light">
                              Sin reparto
                            </Badge>
                          ) : (
                            f.reparto.map((r) => (
                              <Tooltip key={r.idEmpresa} label={r.fuente === "licencias" ? "Según las licencias de la organización" : "Reparto manual"} withArrow>
                                <Badge size="xs" variant="light" color={r.idEmpresa === f.idEmpresa ? "gray" : "blue"}>
                                  {r.empresa}: {dinero(r.monto, f.moneda)}
                                </Badge>
                              </Tooltip>
                            ))
                          )}
                        </Group>
                      </Table.Td>
                      <Table.Td>
                        <Group gap={2} wrap="nowrap">
                          {f.tienePdf && (
                            <Tooltip label="Ver PDF" withArrow>
                              <ActionIcon variant="subtle" component="a" href={`/api/chat/auditoria/facturas/${f.idFactura}/pdf`} target="_blank" rel="noopener">
                                <IconFileTypePdf size={16} />
                              </ActionIcon>
                            </Tooltip>
                          )}
                          <Tooltip label="Editar" withArrow>
                            <ActionIcon variant="subtle" onClick={() => editar(f)}>
                              <IconPencil size={16} />
                            </ActionIcon>
                          </Tooltip>
                          <Button
                            size="compact-xs"
                            variant="subtle"
                            onClick={() =>
                              setReparto({
                                f,
                                filas: (f.reparto.length ? f.reparto : [{ idEmpresa: f.idEmpresa, empresa: f.empresa, monto: f.total }]).map((r) => ({
                                  idEmpresa: String(r.idEmpresa),
                                  monto: r.monto,
                                })),
                              })
                            }
                          >
                            Reparto
                          </Button>
                          <Tooltip label="Eliminar" withArrow>
                            <ActionIcon
                              variant="subtle"
                              color="red"
                              onClick={() => {
                                if (window.confirm(`¿Eliminar la factura ${f.numero}?`)) void enviar({ accion: "eliminar", idFactura: f.idFactura }, "Factura eliminada.");
                              }}
                            >
                              <IconTrash size={16} />
                            </ActionIcon>
                          </Tooltip>
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                  {facturasVisibles.length === 0 && (
                    <Table.Tr>
                      <Table.Td colSpan={9}>
                        <Text size="xs" c="dimmed">
                          No hay facturas. Use Subir factura.
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  )}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          </Card>
        </>
      ) : null}

      <Modal opened={edicion !== null} onClose={() => setEdicion(null)} title={edicion?.idFactura ? `Editar factura ${edicion.numero}` : "Subir factura"} size="xl">
        {edicion && (
          <Stack gap="sm">
            <FileInput
              label="PDF de la factura"
              placeholder={edicion.pdfNombre ?? "Elegir PDF…"}
              accept="application/pdf"
              leftSection={leyendo ? <Loader size={14} /> : <IconUpload size={14} />}
              onChange={(f) => void alElegirPdf(f)}
              description="Si es de Anthropic, los datos se llenan solos; revíselos antes de guardar."
            />
            <Group grow>
              <TextInput label="Proveedor" value={edicion.proveedor} onChange={(e) => setEdicion({ ...edicion, proveedor: e.currentTarget.value })} />
              <TextInput label="Número" value={edicion.numero} onChange={(e) => setEdicion({ ...edicion, numero: e.currentTarget.value })} />
              <Select
                label="Estado"
                data={[
                  { value: "pagada", label: "Pagada" },
                  { value: "pendiente", label: "Pendiente" },
                ]}
                value={edicion.estado}
                onChange={(v) => setEdicion({ ...edicion, estado: v ?? "pagada" })}
              />
            </Group>
            <Group grow>
              <TextInput label="Fecha" type="date" value={edicion.fecha} onChange={(e) => setEdicion({ ...edicion, fecha: e.currentTarget.value })} />
              <TextInput label="Vence" type="date" value={edicion.vence} onChange={(e) => setEdicion({ ...edicion, vence: e.currentTarget.value })} />
              <TextInput label="Período desde" type="date" value={edicion.periodoDesde} onChange={(e) => setEdicion({ ...edicion, periodoDesde: e.currentTarget.value })} />
              <TextInput label="Período hasta" type="date" value={edicion.periodoHasta} onChange={(e) => setEdicion({ ...edicion, periodoHasta: e.currentTarget.value })} />
            </Group>
            <Group grow>
              <TextInput label="Facturado a" value={edicion.facturadoA} onChange={(e) => setEdicion({ ...edicion, facturadoA: e.currentTarget.value })} />
              <TextInput label="Cuenta del proveedor" value={edicion.correoCuenta} onChange={(e) => setEdicion({ ...edicion, correoCuenta: e.currentTarget.value })} />
            </Group>
            <Group grow>
              <Select
                label="Empresa que la pagó"
                data={opcionesEmpresa}
                value={edicion.idEmpresa}
                onChange={(v) => setEdicion({ ...edicion, idEmpresa: v })}
                searchable
              />
              <Select
                label="Organización (para repartir por licencias)"
                data={datos?.organizaciones ?? []}
                value={edicion.organizacion}
                onChange={(v) => setEdicion({ ...edicion, organizacion: v })}
                clearable
                searchable
              />
            </Group>
            <Text size="sm" fw={600}>
              Líneas
            </Text>
            <Stack gap={6}>
              {edicion.lineas.map((l, i) => (
                <Group key={i} gap="xs" wrap="nowrap" align="flex-end">
                  <TextInput
                    style={{ flex: 3 }}
                    size="xs"
                    placeholder="Descripción"
                    value={l.descripcion}
                    onChange={(e) => {
                      const lineas = [...edicion.lineas];
                      lineas[i] = { ...l, descripcion: e.currentTarget.value };
                      setEdicion({ ...edicion, lineas });
                    }}
                  />
                  <NumberInput
                    style={{ flex: 1 }}
                    size="xs"
                    placeholder="Cant."
                    value={l.cantidad ?? ""}
                    onChange={(v) => {
                      const lineas = [...edicion.lineas];
                      lineas[i] = { ...l, cantidad: v === "" ? null : Number(v) };
                      setEdicion({ ...edicion, lineas });
                    }}
                  />
                  <NumberInput
                    style={{ flex: 1 }}
                    size="xs"
                    placeholder="Precio"
                    decimalScale={2}
                    value={l.precioUnitario ?? ""}
                    onChange={(v) => {
                      const lineas = [...edicion.lineas];
                      lineas[i] = { ...l, precioUnitario: v === "" ? null : Number(v) };
                      setEdicion({ ...edicion, lineas });
                    }}
                  />
                  <NumberInput
                    style={{ flex: 1 }}
                    size="xs"
                    placeholder="Monto"
                    decimalScale={2}
                    value={l.monto}
                    onChange={(v) => {
                      const lineas = [...edicion.lineas];
                      lineas[i] = { ...l, monto: Number(v) || 0 };
                      setEdicion({ ...edicion, lineas });
                    }}
                  />
                  <ActionIcon variant="subtle" color="red" onClick={() => setEdicion({ ...edicion, lineas: edicion.lineas.filter((_, j) => j !== i) })}>
                    <IconTrash size={14} />
                  </ActionIcon>
                </Group>
              ))}
              <Button
                size="compact-xs"
                variant="subtle"
                leftSection={<IconPlus size={12} />}
                style={{ alignSelf: "flex-start" }}
                onClick={() => setEdicion({ ...edicion, lineas: [...edicion.lineas, { descripcion: "", periodo: null, cantidad: null, precioUnitario: null, monto: 0 }] })}
              >
                Agregar línea
              </Button>
            </Stack>
            <Group grow>
              <TextInput label="Moneda" maxLength={3} value={edicion.moneda} onChange={(e) => setEdicion({ ...edicion, moneda: e.currentTarget.value.toUpperCase() })} />
              <NumberInput label="Subtotal" decimalScale={2} value={edicion.subtotal} onChange={(v) => setEdicion({ ...edicion, subtotal: v === "" ? "" : Number(v) })} />
              <NumberInput label="Impuestos" decimalScale={2} value={edicion.impuestos} onChange={(v) => setEdicion({ ...edicion, impuestos: v === "" ? "" : Number(v) })} />
              <NumberInput label="Total" decimalScale={2} value={edicion.total} onChange={(v) => setEdicion({ ...edicion, total: v === "" ? "" : Number(v) })} />
            </Group>
            <TextInput label="Notas" value={edicion.notas} onChange={(e) => setEdicion({ ...edicion, notas: e.currentTarget.value })} />
            <Group justify="flex-end" mt="sm">
              <Button variant="default" onClick={() => setEdicion(null)}>
                Cancelar
              </Button>
              <Button loading={guardando} disabled={!edicion.numero || !edicion.fecha || edicion.total === "" || !edicion.idEmpresa} onClick={() => void guardar()}>
                Guardar
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>

      <Modal opened={reparto !== null} onClose={() => setReparto(null)} title={`Reparto de la factura ${reparto?.f.numero ?? ""}`} size="lg">
        {reparto && (
          <Stack gap="sm">
            <Text size="sm" c="dimmed">
              Cuánto le corresponde a cada empresa de esta factura de {dinero(reparto.f.total, reparto.f.moneda)}. La suma debe dar el total.
            </Text>
            {reparto.filas.map((r, i) => (
              <Group key={i} gap="xs" wrap="nowrap">
                <Select
                  style={{ flex: 2 }}
                  data={opcionesEmpresa}
                  value={r.idEmpresa}
                  onChange={(v) => {
                    const filas = [...reparto.filas];
                    filas[i] = { ...r, idEmpresa: v };
                    setReparto({ ...reparto, filas });
                  }}
                  searchable
                />
                <NumberInput
                  style={{ flex: 1 }}
                  decimalScale={2}
                  value={r.monto}
                  onChange={(v) => {
                    const filas = [...reparto.filas];
                    filas[i] = { ...r, monto: v === "" ? "" : Number(v) };
                    setReparto({ ...reparto, filas });
                  }}
                />
                <ActionIcon variant="subtle" color="red" onClick={() => setReparto({ ...reparto, filas: reparto.filas.filter((_, j) => j !== i) })}>
                  <IconTrash size={14} />
                </ActionIcon>
              </Group>
            ))}
            <Group justify="space-between">
              <Button size="compact-xs" variant="subtle" leftSection={<IconPlus size={12} />} onClick={() => setReparto({ ...reparto, filas: [...reparto.filas, { idEmpresa: null, monto: "" }] })}>
                Agregar empresa
              </Button>
              <Text size="sm" c={Math.abs(sumaReparto - reparto.f.total) > 0.01 ? "red" : "green"}>
                Suma: {dinero(sumaReparto, reparto.f.moneda)}
              </Text>
            </Group>
            <Group justify="space-between" mt="sm">
              <Button
                variant="light"
                loading={guardando}
                onClick={() =>
                  void enviar({ accion: "repartir", idFactura: reparto.f.idFactura }, "Reparto recalculado según las licencias de la organización.").then(
                    (ok) => ok && setReparto(null),
                  )
                }
              >
                Repartir según licencias
              </Button>
              <Group gap="xs">
                <Button variant="default" onClick={() => setReparto(null)}>
                  Cancelar
                </Button>
                <Button
                  loading={guardando}
                  disabled={Math.abs(sumaReparto - reparto.f.total) > 0.01 || reparto.filas.some((r) => !r.idEmpresa)}
                  onClick={() =>
                    void enviar(
                      {
                        accion: "reparto",
                        idFactura: reparto.f.idFactura,
                        reparto: reparto.filas.map((r) => ({ idEmpresa: Number(r.idEmpresa), monto: r.monto === "" ? 0 : r.monto })) as Omit<RepartoDto, "empresa">[],
                      },
                      "Reparto guardado.",
                    ).then((ok) => ok && setReparto(null))
                  }
                >
                  Guardar reparto
                </Button>
              </Group>
            </Group>
          </Stack>
        )}
      </Modal>
    </div>
  );
}

function Kpi({ titulo, valor, color }: { titulo: string; valor: string; color?: string }) {
  return (
    <Card withBorder radius="md" padding="sm" className="chat-surface">
      <Text size="xs" c="dimmed">
        {titulo}
      </Text>
      <Text fw={700} size="xl" c={color}>
        {valor}
      </Text>
    </Card>
  );
}
