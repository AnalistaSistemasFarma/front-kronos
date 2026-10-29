"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Center,
  Group,
  Loader,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Tabs,
  Text,
  TextInput,
  Title,
  Tooltip,
  useComputedColorScheme,
} from "@mantine/core";
import {
  IconAffiliate,
  IconAlertCircle,
  IconArrowLeft,
  IconBrain,
  IconEye,
  IconFocusCentered,
  IconLock,
  IconMaximize,
  IconMinimize,
  IconMinus,
  IconPlus,
  IconSearch,
} from "@tabler/icons-react";
import {
  MapaMemorias,
  type EnlaceMapa,
  type GrupoMapa,
  type MapaMemoriasHandle,
  type NodoMapa,
} from "../../../../../../components/chat/auditoria/MapaMemorias";
import {
  MEMORY_TYPE_LABEL,
  MEMORY_TYPES,
  temaPrincipal,
  type MemoryDetailDto,
  type MemoryMapDto,
  type MemoryType,
} from "../../../../../../lib/agent-audit/memories";

/**
 * AUDITORÍA DE AGENTES → MEMORIAS — lo que cada agente ha aprendido, en un mapa
 * tipo vista gráfica de Obsidian (Nicolás, 2026-10-29):
 *   - Mapa general: empresa → departamento → agente → memorias, coloreado por
 *     empresa. Con el alcance de la auditoría y sin los agentes personales.
 *   - Mapa personal: solo para el dueño de los agentes personales, coloreado
 *     por tema.
 * Mismo diseño que Inventario y Skills: es otra pestaña del mismo módulo.
 * LA REJA ESTÁ EN EL ENDPOINT (/api/chat/auditoria/memorias).
 */

type Mapa = "general" | "personal";
type Respuesta = MemoryMapDto & { soloPersonal?: boolean };

/** Colores de Mantine por empresa (mismos tonos que las insignias). */
const COLOR_EMPRESA: [RegExp, string][] = [
  [/gss|group shared/i, "#4c6ef5"],
  [/one ?latam|olp/i, "#fd7e14"],
  [/unidos/i, "#15aabf"],
  [/farmal/i, "#12b886"],
  [/ryan/i, "#be4bdb"],
  [/kelab/i, "#e64980"],
  [/abamia/i, "#7950f2"],
  [/meditrack/i, "#fab005"],
];
const PALETA = [
  "#228be6",
  "#40c057",
  "#fa5252",
  "#7950f2",
  "#fd7e14",
  "#15aabf",
  "#e64980",
  "#f59f00",
  "#12b886",
  "#be4bdb",
  "#4c6ef5",
  "#82c91e",
];
const SIN_EMPRESA = "#868e96";

function colorEmpresa(nombre: string | null, i: number): string {
  if (!nombre) return SIN_EMPRESA;
  return (
    COLOR_EMPRESA.find(([re]) => re.test(nombre))?.[1] ??
    PALETA[i % PALETA.length]
  );
}

function fecha(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-CO", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}
function fechaHora(iso: string | null): string {
  if (!iso) return "sin recolección todavía";
  return new Date(iso).toLocaleString("es-CO", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface Grafo {
  nodos: NodoMapa[];
  enlaces: EnlaceMapa[];
  grupos: (GrupoMapa & { full: string })[];
}

/** Arma el grafo del mapa general: empresa → departamento → agente → memoria. */
function grafoGeneral(d: MemoryMapDto): Grafo {
  const nodos: NodoMapa[] = [];
  const enlaces: EnlaceMapa[] = [];
  const grupos: Grafo["grupos"] = [];
  const empresas = [
    ...new Set(d.agentes.map((a) => a.companyName ?? "Sin empresa")),
  ];
  empresas.forEach((e, i) => {
    const color = e === "Sin empresa" ? SIN_EMPRESA : colorEmpresa(e, i);
    grupos.push({ id: e, nombre: e, full: e, color });
    nodos.push({ id: `g:${e}`, tipo: "grupo", etiqueta: e, grupo: e, color });
  });
  const colorDe = new Map(grupos.map((g) => [g.id, g.color]));
  const agenteDeMemoria = new Map<number, number>();
  for (const a of d.agentes) {
    const e = a.companyName ?? "Sin empresa";
    const color = colorDe.get(e) ?? SIN_EMPRESA;
    const dep = a.department ?? "Sin departamento";
    const idDep = `d:${e}:${dep}`;
    if (!nodos.some((n) => n.id === idDep)) {
      nodos.push({
        id: idDep,
        tipo: "depto",
        etiqueta: dep,
        grupo: e,
        color,
        depto: dep,
      });
      enlaces.push({ s: `g:${e}`, t: idDep, k: "h" });
    }
    nodos.push({
      id: `a:${a.idAgent}`,
      tipo: "agente",
      etiqueta: a.displayName,
      grupo: e,
      color,
      idAgente: a.idAgent,
      depto: dep,
    });
    enlaces.push({ s: idDep, t: `a:${a.idAgent}`, k: "h" });
  }
  const agentePorId = new Map(d.agentes.map((a) => [a.idAgent, a]));
  for (const m of d.memorias) {
    const a = agentePorId.get(m.idAgent);
    if (!a) continue;
    const e = a.companyName ?? "Sin empresa";
    agenteDeMemoria.set(m.id, m.idAgent);
    nodos.push({
      id: `m:${m.id}`,
      tipo: "memoria",
      etiqueta: m.title,
      grupo: e,
      color: colorDe.get(e) ?? SIN_EMPRESA,
      idMemoria: m.id,
      idAgente: m.idAgent,
      depto: a.department ?? "Sin departamento",
      tipoMemoria: m.type,
    });
    enlaces.push({ s: `a:${m.idAgent}`, t: `m:${m.id}`, k: "own" });
  }
  for (const l of d.enlaces) {
    const ea = agentePorId.get(agenteDeMemoria.get(l.from) ?? -1)?.companyName;
    const eb = agentePorId.get(agenteDeMemoria.get(l.to) ?? -1)?.companyName;
    enlaces.push({
      s: `m:${l.from}`,
      t: `m:${l.to}`,
      k: ea === eb ? "mm" : "x",
    });
  }
  return { nodos, enlaces, grupos };
}

/** Mapa personal: tema → memorias, con los agentes al centro. */
function grafoPersonal(d: MemoryMapDto): Grafo {
  const nodos: NodoMapa[] = [];
  const enlaces: EnlaceMapa[] = [];
  const conteo = new Map<string, number>();
  for (const m of d.memorias)
    conteo.set(temaPrincipal(m), (conteo.get(temaPrincipal(m)) ?? 0) + 1);
  // Los 12 temas más grandes; el resto va a «otros».
  const top = [...conteo.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([t]) => t);
  const temaDe = (m: { topic: string | null; type: MemoryType }) => {
    const t = temaPrincipal(m);
    return top.includes(t) ? t : "otros";
  };
  const temas = [...new Set(d.memorias.map(temaDe))];
  const grupos: Grafo["grupos"] = temas.map((t, i) => ({
    id: t,
    nombre: t,
    full: t,
    color: t === "otros" ? SIN_EMPRESA : PALETA[i % PALETA.length],
  }));
  const colorDe = new Map(grupos.map((g) => [g.id, g.color]));
  for (const g of grupos)
    nodos.push({
      id: `g:${g.id}`,
      tipo: "grupo",
      etiqueta: g.nombre,
      grupo: g.id,
      color: g.color,
    });
  for (const a of d.agentes)
    nodos.push({
      id: `a:${a.idAgent}`,
      tipo: "agente",
      etiqueta: a.displayName,
      grupo: "__agentes",
      color: "#495057",
      idAgente: a.idAgent,
    });
  for (const m of d.memorias) {
    const t = temaDe(m);
    nodos.push({
      id: `m:${m.id}`,
      tipo: "memoria",
      etiqueta: m.title,
      grupo: t,
      color: colorDe.get(t) ?? SIN_EMPRESA,
      idMemoria: m.id,
      idAgente: m.idAgent,
      tipoMemoria: m.type,
    });
    enlaces.push({ s: `g:${t}`, t: `m:${m.id}`, k: "own" });
    enlaces.push({ s: `a:${m.idAgent}`, t: `m:${m.id}`, k: "x" });
  }
  const temaDeId = new Map(d.memorias.map((m) => [m.id, temaDe(m)]));
  for (const l of d.enlaces)
    enlaces.push({
      s: `m:${l.from}`,
      t: `m:${l.to}`,
      k: temaDeId.get(l.from) === temaDeId.get(l.to) ? "mm" : "x",
    });
  return { nodos, enlaces, grupos };
}

export default function MemoriasAgentesPage() {
  const [mapa, setMapa] = useState<Mapa>("general");
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [q, setQ] = useState("");
  const [fGrupo, setFGrupo] = useState<string | null>(null);
  const [fDepto, setFDepto] = useState<string | null>(null);
  const [fTipo, setFTipo] = useState<string | null>(null);
  const [verMemorias, setVerMemorias] = useState(true);
  const [verZonas, setVerZonas] = useState(true);
  const [sel, setSel] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<MemoryDetailDto | null>(null);
  const [cargandoDetalle, setCargandoDetalle] = useState(false);
  const [completa, setCompleta] = useState(false);
  const [sinGeneral, setSinGeneral] = useState(false);
  const esquema = useComputedColorScheme("light", {
    getInitialValueInEffect: true,
  });
  const [version, setVersion] = useState(0);
  const lienzo = useRef<MapaMemoriasHandle>(null);
  const contenedor = useRef<HTMLDivElement>(null);

  const cargar = useCallback(async (m: Mapa) => {
    setCargando(true);
    setError(null);
    try {
      const r = await fetch(`/api/chat/auditoria/memorias?mapa=${m}`, {
        cache: "no-store",
      });
      const j = await r.json();
      if (!r.ok)
        throw new Error(j?.error ?? "No se pudieron cargar las memorias.");
      setDatos(j);
      if (j.soloPersonal) {
        setSinGeneral(true);
        setMapa("personal");
      }
    } catch (e) {
      setDatos(null);
      setError(
        e instanceof Error ? e.message : "No se pudieron cargar las memorias.",
      );
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    setSel(null);
    setDetalle(null);
    setFGrupo(null);
    setFDepto(null);
    setQ("");
    void cargar(mapa);
  }, [mapa, cargar]);

  const grafo = useMemo<Grafo | null>(() => {
    if (!datos) return null;
    return datos.mapa === "personal"
      ? grafoPersonal(datos)
      : grafoGeneral(datos);
  }, [datos]);

  const porId = useMemo(
    () => new Map((grafo?.nodos ?? []).map((n) => [n.id, n])),
    [grafo],
  );
  const vecinos = useMemo(() => {
    const v = new Map<string, string[]>();
    for (const e of grafo?.enlaces ?? []) {
      v.set(e.s, [...(v.get(e.s) ?? []), e.t]);
      v.set(e.t, [...(v.get(e.t) ?? []), e.s]);
    }
    return v;
  }, [grafo]);

  const visible = useCallback(
    (n: NodoMapa) => {
      if (
        fGrupo &&
        n.grupo !== fGrupo &&
        !(mapa === "personal" && n.tipo === "agente")
      )
        return false;
      if (
        fDepto &&
        mapa === "general" &&
        n.tipo !== "grupo" &&
        n.depto !== fDepto
      )
        return false;
      if (n.tipo === "memoria") {
        if (!verMemorias) return false;
        if (fTipo && n.tipoMemoria !== fTipo) return false;
      }
      return true;
    },
    [fGrupo, fDepto, fTipo, verMemorias, mapa],
  );

  const resaltados = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t || !grafo) return null;
    return new Set(
      grafo.nodos
        .filter((n) => n.etiqueta.toLowerCase().includes(t) && visible(n))
        .map((n) => n.id),
    );
  }, [q, grafo, visible]);

  useEffect(() => {
    if (resaltados && resaltados.size) lienzo.current?.enfocar([...resaltados]);
  }, [resaltados]);
  useEffect(() => {
    lienzo.current?.ajustar();
  }, [fGrupo, fDepto, fTipo]);

  // Contenido de la memoria elegida (se pide de a una).
  useEffect(() => {
    const n = sel ? porId.get(sel) : null;
    if (!n || n.tipo !== "memoria" || !n.idMemoria) {
      setDetalle(null);
      return;
    }
    let vivo = true;
    setCargandoDetalle(true);
    fetch(`/api/chat/auditoria/memorias/${n.idMemoria}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => vivo && setDetalle(j))
      .catch(() => vivo && setDetalle(null))
      .finally(() => vivo && setCargandoDetalle(false));
    return () => {
      vivo = false;
    };
  }, [sel, porId]);

  // Pantalla completa: la del navegador si se puede; si no, toda la ventana.
  const alternarCompleta = useCallback(() => {
    const on = !completa;
    setCompleta(on);
    if (on) contenedor.current?.requestFullscreen?.().catch(() => {});
    else if (document.fullscreenElement)
      void document.exitFullscreen().catch(() => {});
  }, [completa]);
  useEffect(() => {
    const alSalir = () => {
      if (!document.fullscreenElement) setCompleta(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCompleta(false);
    };
    document.addEventListener("fullscreenchange", alSalir);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("fullscreenchange", alSalir);
      document.removeEventListener("keydown", esc);
    };
  }, []);
  useEffect(() => {
    setVersion((v) => v + 1);
    const t = setTimeout(() => lienzo.current?.ajustar(), 120);
    return () => clearTimeout(t);
  }, [completa]);

  const resumen = useMemo(() => {
    if (!datos || !grafo) return null;
    const vis = grafo.nodos.filter(visible);
    const ids = new Set(vis.map((n) => n.id));
    const ls = grafo.enlaces.filter(
      (e) =>
        (e.k === "mm" || e.k === "x") &&
        e.s.startsWith("m:") &&
        ids.has(e.s) &&
        ids.has(e.t),
    );
    return {
      grupos: new Set(vis.filter((n) => n.tipo === "grupo").map((n) => n.grupo))
        .size,
      deptos: vis.filter((n) => n.tipo === "depto").length,
      agentes: vis.filter((n) => n.tipo === "agente").length,
      memorias: vis.filter((n) => n.tipo === "memoria").length,
      enlaces: ls.length,
      cruzados: ls.filter((e) => e.k === "x").length,
    };
  }, [datos, grafo, visible]);

  const opcionesGrupo = (grafo?.grupos ?? []).map((g) => ({
    value: g.id,
    label: g.nombre,
  }));
  const opcionesDepto = [
    ...new Set(
      (grafo?.nodos ?? [])
        .filter((n) => n.tipo === "depto" && (!fGrupo || n.grupo === fGrupo))
        .map((n) => n.etiqueta),
    ),
  ]
    .sort()
    .map((d) => ({ value: d, label: d }));
  const tiposPresentes = new Set(
    (grafo?.nodos ?? []).map((n) => n.tipoMemoria).filter(Boolean),
  );
  const opcionesTipo = MEMORY_TYPES.filter((t) => tiposPresentes.has(t)).map(
    (t) => ({ value: t, label: MEMORY_TYPE_LABEL[t] }),
  );

  const elegir = (id: string | null) => {
    setSel(id);
  };
  const irA = (id: string) => {
    setSel(id);
    const n = porId.get(id);
    if (!n) return;
    if (n.tipo === "grupo")
      lienzo.current?.enfocar(
        grafo!.nodos.filter((m) => m.grupo === n.grupo).map((m) => m.id),
      );
    else lienzo.current?.enfocar([id, ...(vecinos.get(id) ?? [])]);
  };

  const nodoSel = sel ? (porId.get(sel) ?? null) : null;
  const grupoDe = (id: string) => grafo?.grupos.find((g) => g.id === id);
  const fila = (id: string) => {
    const n = porId.get(id);
    if (!n) return null;
    const sub =
      n.tipo === "memoria"
        ? (datos?.agentes.find((a) => a.idAgent === n.idAgente)?.displayName ??
          "")
        : n.tipo === "agente"
          ? "agente"
          : n.tipo === "depto"
            ? "departamento"
            : "";
    return (
      <Group
        key={id}
        gap={8}
        wrap="nowrap"
        px={6}
        py={5}
        style={{ borderRadius: 4, cursor: "pointer" }}
        className="chat-row-hover"
        onClick={() => irA(id)}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: n.color,
            flex: "none",
          }}
        />
        <Text size="sm" style={{ minWidth: 0, flex: 1 }} truncate>
          {n.etiqueta}
        </Text>
        <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
          {sub}
        </Text>
      </Group>
    );
  };

  const etiquetaGrupo = mapa === "general" ? "Empresa" : "Tema";

  const panel = (() => {
    if (!grafo || !datos) return null;
    if (!nodoSel) {
      const mems = grafo.nodos.filter((n) => n.tipo === "memoria");
      return (
        <>
          <Text fw={600} size="sm">
            {mapa === "general" ? "Empresas" : "Temas"}
          </Text>
          <Text size="xs" c="dimmed" mb="xs">
            Haga clic en un nodo del mapa o en una fila para ver su detalle.
          </Text>
          {grafo.grupos.map((g) => {
            const ag = new Set(
              grafo.nodos
                .filter((n) => n.tipo === "agente" && n.grupo === g.id)
                .map((n) => n.id),
            ).size;
            const m = mems.filter((n) => n.grupo === g.id).length;
            return (
              <Group
                key={g.id}
                gap={8}
                wrap="nowrap"
                px={6}
                py={5}
                style={{ cursor: "pointer", borderRadius: 4 }}
                onClick={() => irA(`g:${g.id}`)}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: g.color,
                    flex: "none",
                  }}
                />
                <Text size="sm" fw={600} style={{ flex: 1 }}>
                  {g.nombre}
                </Text>
                <Text size="xs" c="dimmed">
                  {mapa === "general"
                    ? `${ag} ${ag === 1 ? "agente" : "agentes"} · `
                    : ""}
                  {m} memorias
                </Text>
              </Group>
            );
          })}
          {mapa === "personal" && (
            <>
              <Text
                fw={600}
                size="sm"
                mt="md"
                pt="sm"
                style={{
                  borderTop: "1px solid var(--mantine-color-default-border)",
                }}
              >
                Mis agentes
              </Text>
              {datos.agentes.map((a) => fila(`a:${a.idAgent}`))}
            </>
          )}
        </>
      );
    }
    const n = nodoSel;
    const g = grupoDe(n.grupo);
    const vec = vecinos.get(n.id) ?? [];
    let cuerpo: React.ReactNode = null;
    if (n.tipo === "memoria") {
      const rel = vec.filter((v) => v.startsWith("m:"));
      const agente = vec.find((v) => v.startsWith("a:"));
      cuerpo = (
        <>
          <Group gap={4} mb="sm" mt={6}>
            <Badge size="xs" variant="light" color="blue">
              {MEMORY_TYPE_LABEL[(n.tipoMemoria as MemoryType) ?? "otro"]}
            </Badge>
            {g && (
              <Badge
                size="xs"
                variant="light"
                style={{ background: `${g.color}1f`, color: g.color }}
              >
                {g.nombre}
              </Badge>
            )}
            {detalle?.topic && (
              <Badge size="xs" variant="outline" color="gray">
                #{detalle.topic}
              </Badge>
            )}
          </Group>
          <SimpleGrid cols={2} spacing="sm" mb="sm">
            <div>
              <Text size="xs" c="dimmed">
                Agente
              </Text>
              <Text size="sm">
                {datos.agentes.find((a) => a.idAgent === n.idAgente)
                  ?.displayName ?? "—"}
              </Text>
            </div>
            <div>
              <Text size="xs" c="dimmed">
                {mapa === "general" ? "Departamento" : "Tema"}
              </Text>
              <Text size="sm">{mapa === "general" ? n.depto : g?.nombre}</Text>
            </div>
            <div>
              <Text size="xs" c="dimmed">
                Actualizada
              </Text>
              <Text size="sm">{fecha(detalle?.updatedAt ?? null)}</Text>
            </div>
            <div>
              <Text size="xs" c="dimmed">
                Secretos ocultos
              </Text>
              <Text size="sm">{detalle?.secretsHidden ?? 0}</Text>
            </div>
          </SimpleGrid>
          <Text
            fw={600}
            size="sm"
            pt="sm"
            style={{
              borderTop: "1px solid var(--mantine-color-default-border)",
            }}
          >
            Contenido
          </Text>
          {cargandoDetalle ? (
            <Loader size="xs" mt={6} />
          ) : (
            <Text
              size="sm"
              mt={4}
              style={{
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                maxHeight: 280,
                overflow: "auto",
              }}
            >
              {detalle?.content ?? "Sin contenido."}
            </Text>
          )}
          <Text
            fw={600}
            size="sm"
            mt="sm"
            pt="sm"
            style={{
              borderTop: "1px solid var(--mantine-color-default-border)",
            }}
          >
            Enlaces ({rel.length + (agente ? 1 : 0)})
          </Text>
          {agente && fila(agente)}
          {rel.map(fila)}
        </>
      );
    } else if (n.tipo === "agente") {
      const mems = vec.filter((v) => v.startsWith("m:"));
      const enl = mems.reduce(
        (s, m) =>
          s + (vecinos.get(m) ?? []).filter((z) => z.startsWith("m:")).length,
        0,
      );
      const otros = new Set(
        mems
          .flatMap((m) =>
            (vecinos.get(m) ?? [])
              .filter((z) => z.startsWith("m:"))
              .map((z) => porId.get(z)?.grupo),
          )
          .filter((x) => x && x !== n.grupo),
      );
      cuerpo = (
        <>
          <Group gap={4} mb="sm" mt={6}>
            {mapa === "general" ? (
              <>
                {g && (
                  <Badge
                    size="xs"
                    variant="light"
                    style={{ background: `${g.color}1f`, color: g.color }}
                  >
                    {g.nombre}
                  </Badge>
                )}
                <Badge size="xs" variant="outline" color="gray">
                  {n.depto}
                </Badge>
              </>
            ) : (
              <Badge size="xs" variant="light" color="yellow">
                Personal
              </Badge>
            )}
          </Group>
          <SimpleGrid cols={2} spacing="sm" mb="sm">
            <div>
              <Text size="xs" c="dimmed">
                Memorias
              </Text>
              <Text fw={700}>{mems.length}</Text>
            </div>
            <div>
              <Text size="xs" c="dimmed">
                Enlaces
              </Text>
              <Text fw={700}>{enl}</Text>
            </div>
            <div>
              <Text size="xs" c="dimmed">
                {mapa === "general" ? "Empresas conectadas" : "Temas"}
              </Text>
              <Text fw={700}>
                {mapa === "general"
                  ? otros.size
                  : new Set(mems.map((m) => porId.get(m)?.grupo)).size}
              </Text>
            </div>
          </SimpleGrid>
          <Text
            fw={600}
            size="sm"
            pt="sm"
            style={{
              borderTop: "1px solid var(--mantine-color-default-border)",
            }}
          >
            Memorias
          </Text>
          {mems.slice(0, 40).map(fila)}
          {mems.length > 40 && (
            <Text size="xs" c="dimmed" mt={4}>
              Y {mems.length - 40} más: use el buscador.
            </Text>
          )}
        </>
      );
    } else if (n.tipo === "depto") {
      const ags = vec.filter((v) => v.startsWith("a:"));
      cuerpo = (
        <>
          {g && (
            <Badge
              size="xs"
              variant="light"
              mt={6}
              mb="sm"
              style={{ background: `${g.color}1f`, color: g.color }}
            >
              {g.nombre}
            </Badge>
          )}
          <Text
            fw={600}
            size="sm"
            pt="sm"
            style={{
              borderTop: "1px solid var(--mantine-color-default-border)",
            }}
          >
            Agentes ({ags.length})
          </Text>
          {ags.map(fila)}
        </>
      );
    } else {
      const hijos = grafo.nodos.filter((m) => m.grupo === n.grupo);
      const lista =
        mapa === "general"
          ? hijos.filter((m) => m.tipo === "depto")
          : hijos.filter((m) => m.tipo === "memoria").slice(0, 60);
      cuerpo = (
        <>
          <SimpleGrid cols={2} spacing="sm" mb="sm" mt={6}>
            {mapa === "general" && (
              <div>
                <Text size="xs" c="dimmed">
                  Agentes
                </Text>
                <Text fw={700}>
                  {hijos.filter((m) => m.tipo === "agente").length}
                </Text>
              </div>
            )}
            <div>
              <Text size="xs" c="dimmed">
                Memorias
              </Text>
              <Text fw={700}>
                {hijos.filter((m) => m.tipo === "memoria").length}
              </Text>
            </div>
          </SimpleGrid>
          <Text
            fw={600}
            size="sm"
            pt="sm"
            style={{
              borderTop: "1px solid var(--mantine-color-default-border)",
            }}
          >
            {mapa === "general" ? "Departamentos" : "Memorias"}
          </Text>
          {lista.map((m) => fila(m.id))}
        </>
      );
    }
    return (
      <>
        <Text size="xs" mb={8}>
          <Text
            component="a"
            href="#"
            c="blue"
            size="xs"
            onClick={(e) => (e.preventDefault(), setSel(null))}
          >
            ← Volver al resumen
          </Text>
        </Text>
        <Text fw={700}>{n.etiqueta}</Text>
        {cuerpo}
        <Group gap={6} mt="md" wrap="nowrap">
          <IconEye size={14} color="var(--mantine-color-dimmed)" />
          <Text size="xs" c="dimmed">
            Solo lectura · desde aquí no se edita la memoria del agente
          </Text>
        </Group>
      </>
    );
  })();

  const altoMapa = completa ? "calc(100vh - 32px)" : 680;

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
            href="/process/chat/auditoria/skills"
            className="chat-text-muted"
            style={{ fontSize: 13 }}
          >
            Ver skills de la flota
          </Link>
        </Group>

        <Group gap="sm" mb={2} wrap="nowrap">
          <IconBrain size={26} className="chat-folder__icon" />
          <Title order={1} className="ios-process-hub__title text-3xl">
            Memorias de los agentes
          </Title>
        </Group>
        <Text className="ios-process-hub__subtitle" mb="lg">
          Lo que cada agente ha aprendido, en un mapa: por empresa, departamento
          y agente, con los enlaces entre memorias. Se recoge desde los equipos
          de la flota, en solo lectura y con los secretos ocultos antes de
          publicarse. Última recolección:{" "}
          {fechaHora(datos?.ultimaRecoleccion ?? null)}.
        </Text>

        <Tabs value={mapa} onChange={(v) => v && setMapa(v as Mapa)} mb="md">
          <Tabs.List>
            {!sinGeneral && (
              <Tabs.Tab
                value="general"
                leftSection={<IconAffiliate size={16} />}
              >
                Mapa general
              </Tabs.Tab>
            )}
            {(datos?.tieneMapaPersonal || mapa === "personal") && (
              <Tabs.Tab
                value="personal"
                leftSection={<IconLock size={16} />}
                rightSection={
                  <Badge size="xs" variant="light" color="yellow">
                    Solo usted
                  </Badge>
                }
              >
                Mapa personal
              </Tabs.Tab>
            )}
          </Tabs.List>
        </Tabs>

        {mapa === "personal" && (
          <Alert
            color="yellow"
            radius="md"
            mb="md"
            icon={<IconLock size={18} />}
            title="Vista privada"
          >
            Este mapa solo lo ve usted. Sus agentes personales no aparecen en el
            mapa general y ningún otro usuario, ni la administración, puede
            abrirlo. El color aquí es por tema.
          </Alert>
        )}

        <Card
          withBorder
          radius="md"
          padding="md"
          mb="md"
          className="chat-surface"
        >
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 5 }} spacing="sm">
            <TextInput
              label="Buscar"
              size="xs"
              placeholder="Memoria, agente o tema"
              leftSection={<IconSearch size={14} />}
              value={q}
              onChange={(e) => setQ(e.currentTarget.value)}
            />
            <Select
              label={etiquetaGrupo}
              size="xs"
              placeholder="Todas"
              clearable
              value={fGrupo}
              onChange={(v) => {
                setFGrupo(v);
                setFDepto(null);
              }}
              data={opcionesGrupo}
            />
            <Select
              label="Departamento"
              size="xs"
              placeholder="Todos"
              clearable
              disabled={mapa !== "general"}
              value={fDepto}
              onChange={setFDepto}
              data={opcionesDepto}
            />
            <Select
              label="Tipo de memoria"
              size="xs"
              placeholder="Todos"
              clearable
              value={fTipo}
              onChange={setFTipo}
              data={opcionesTipo}
            />
            <Group mt={20} gap="md" wrap="nowrap">
              <Switch
                size="sm"
                label="Memorias"
                checked={verMemorias}
                onChange={(e) => setVerMemorias(e.currentTarget.checked)}
              />
              <Switch
                size="sm"
                label="Zonas"
                checked={verZonas}
                onChange={(e) => setVerZonas(e.currentTarget.checked)}
              />
            </Group>
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

        {cargando && (
          <Center py="xl">
            <Loader size="sm" />
          </Center>
        )}

        {!cargando && datos && resumen && (
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
                <div>
                  <Text size="xs" c="dimmed">
                    {mapa === "general" ? "Empresas" : "Temas"}
                  </Text>
                  <Text fw={700}>{resumen.grupos}</Text>
                </div>
                {mapa === "general" && (
                  <div>
                    <Text size="xs" c="dimmed">
                      Departamentos
                    </Text>
                    <Text fw={700}>{resumen.deptos}</Text>
                  </div>
                )}
                <div>
                  <Text size="xs" c="dimmed">
                    Agentes
                  </Text>
                  <Text fw={700}>{resumen.agentes}</Text>
                </div>
                <div>
                  <Text size="xs" c="dimmed">
                    Memorias
                  </Text>
                  <Text fw={700}>{resumen.memorias}</Text>
                </div>
                <div>
                  <Text size="xs" c="dimmed">
                    Enlaces
                  </Text>
                  <Text fw={700}>{resumen.enlaces}</Text>
                </div>
                <div>
                  <Text size="xs" c="dimmed">
                    {mapa === "general"
                      ? "Enlaces entre empresas"
                      : "Enlaces entre temas"}
                  </Text>
                  <Text fw={700}>{resumen.cruzados}</Text>
                </div>
                <div>
                  <Text size="xs" c="dimmed">
                    Secretos ocultos
                  </Text>
                  <Text>{datos.secretosOcultos}</Text>
                </div>
              </Group>
              <Text size="xs" c="dimmed" mt={8}>
                Las memorias se muestran como las guardó cada agente, con los
                secretos (claves, tokens, cadenas de conexión) reemplazados por
                &lt;oculto&gt;. Desde aquí no se edita ninguna memoria.
              </Text>
            </Card>

            {datos.memorias.length === 0 && (
              <Alert
                color="blue"
                radius="md"
                mb="md"
                icon={<IconAlertCircle size={18} />}
              >
                Todavía no hay memorias recolectadas para{" "}
                {mapa === "general" ? "estos agentes" : "sus agentes"}. Aparecen
                después de la siguiente corrida del recolector.
              </Alert>
            )}

            <div
              ref={contenedor}
              style={
                completa
                  ? {
                      position: "fixed",
                      inset: 0,
                      zIndex: 300,
                      background: "var(--app-bg, var(--background))",
                      padding: 16,
                      display: "grid",
                      gridTemplateColumns: "1fr 360px",
                      gap: 16,
                    }
                  : {
                      display: "grid",
                      gridTemplateColumns: "minmax(0,1fr) 340px",
                      gap: 16,
                    }
              }
            >
              <Card
                withBorder
                radius="md"
                padding={0}
                className="chat-surface"
                style={{
                  position: "relative",
                  overflow: "hidden",
                  height: altoMapa,
                }}
              >
                {grafo && (
                  <MapaMemorias
                    ref={lienzo}
                    nodos={grafo.nodos}
                    enlaces={grafo.enlaces}
                    grupos={grafo.grupos}
                    visible={visible}
                    resaltados={resaltados}
                    seleccionado={sel}
                    mostrarZonas={verZonas}
                    onSeleccionar={elegir}
                    version={version}
                    oscuro={esquema === "dark"}
                  />
                )}
                <Group
                  gap={10}
                  wrap="nowrap"
                  px={14}
                  py={12}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    zIndex: 2,
                    background:
                      "linear-gradient(var(--app-surface, var(--surface)) 70%, transparent)",
                  }}
                >
                  <Text size="sm" fw={600} style={{ whiteSpace: "nowrap" }}>
                    {mapa === "general" ? "Mapa general" : "Mapa personal"}
                  </Text>
                  <Group gap={6} style={{ flex: 1, minWidth: 0 }}>
                    {(grafo?.grupos ?? []).slice(0, 12).map((g) => (
                      <Badge
                        key={g.id}
                        size="xs"
                        variant="light"
                        style={{ background: `${g.color}1f`, color: g.color }}
                      >
                        {g.nombre}
                      </Badge>
                    ))}
                  </Group>
                  <Group gap={6} wrap="nowrap">
                    <Tooltip label="Acercar">
                      <ActionIcon
                        variant="default"
                        onClick={() => lienzo.current?.acercar()}
                        aria-label="Acercar"
                      >
                        <IconPlus size={14} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label="Alejar">
                      <ActionIcon
                        variant="default"
                        onClick={() => lienzo.current?.alejar()}
                        aria-label="Alejar"
                      >
                        <IconMinus size={14} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label="Ajustar a la vista">
                      <ActionIcon
                        variant="default"
                        onClick={() => lienzo.current?.ajustar()}
                        aria-label="Ajustar a la vista"
                      >
                        <IconFocusCentered size={14} />
                      </ActionIcon>
                    </Tooltip>
                    <Button
                      size="xs"
                      variant="default"
                      leftSection={
                        completa ? (
                          <IconMinimize size={14} />
                        ) : (
                          <IconMaximize size={14} />
                        )
                      }
                      onClick={alternarCompleta}
                    >
                      {completa
                        ? "Salir de pantalla completa"
                        : "Pantalla completa"}
                    </Button>
                  </Group>
                </Group>
                <Text
                  size="xs"
                  c="dimmed"
                  style={{
                    position: "absolute",
                    left: 14,
                    bottom: 12,
                    background: "var(--app-surface, var(--surface))",
                    padding: "4px 8px",
                    borderRadius: 4,
                  }}
                >
                  Arrastre para mover · rueda para acercar · clic en un nodo
                  para ver el detalle
                </Text>
              </Card>
              <Card
                withBorder
                radius="md"
                padding="md"
                className="chat-surface"
                style={{ height: altoMapa, overflow: "auto" }}
              >
                <Stack gap={0}>{panel}</Stack>
              </Card>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
