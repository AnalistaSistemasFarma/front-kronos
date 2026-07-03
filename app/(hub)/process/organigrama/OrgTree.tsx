'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { ActionIcon, Badge, Group, Text, Tooltip, useMantineColorScheme } from '@mantine/core';
import {
  IconAlertTriangle,
  IconEdit,
  IconFocusCentered,
  IconMinus,
  IconPlus,
} from '@tabler/icons-react';
import type { CustomNodeElementProps, RawNodeDatum, TreeProps } from 'react-d3-tree';
import type { JerarquiaNode } from './types';
import { NIVEL_COLOR } from './types';

// react-d3-tree usa APIs del DOM (window/SVG); se carga solo en cliente.
const Tree = dynamic(() => import('react-d3-tree').then((m) => m.Tree), {
  ssr: false,
});

interface Props {
  nodes: JerarquiaNode[];
  onEdit: (node: JerarquiaNode) => void;
}

/** Paleta hex por nivel para el borde/acento de la caja (independiente del tema). */
const NIVEL_HEX: Record<string, string> = {
  Estratégico: '#9c36b5',
  Estrategico: '#9c36b5',
  Táctico: '#1971c2',
  Tactico: '#1971c2',
  Operativo: '#0c8599',
};

const NODE_W = 230;
const NODE_H = 96;

/**
 * Convierte la lista plana en el formato anidado de react-d3-tree.
 * Conserva los campos del cargo en `attributes` (tipados como any porque
 * react-d3-tree solo admite string|number|boolean alli; los recuperamos
 * con un cast controlado en el render).
 */
function buildRawForest(nodes: JerarquiaNode[]): RawNodeDatum[] {
  const byCargo = new Map<number, RawNodeDatum & { __children: RawNodeDatum[] }>();

  for (const n of nodes) {
    byCargo.set(n.idCargo, {
      name: n.nombre,
      attributes: {
        idCargoJerarquia: n.idCargoJerarquia,
        idCargo: n.idCargo,
        nivel: n.nivel ?? '',
        nivelClasico: n.nivelClasico ?? '',
        idCargoPadre: n.idCargoPadre ?? -1,
        aproximada: n.aproximada,
      } as Record<string, string | number | boolean>,
      __children: [],
      children: [],
    });
  }

  const raices: RawNodeDatum[] = [];
  for (const n of nodes) {
    const item = byCargo.get(n.idCargo)!;
    if (n.idCargoPadre != null && byCargo.has(n.idCargoPadre)) {
      byCargo.get(n.idCargoPadre)!.__children.push(item);
    } else {
      raices.push(item);
    }
  }

  // Ordena hijos por nombre y vuelca __children -> children.
  const finalizar = (item: RawNodeDatum & { __children: RawNodeDatum[] }) => {
    item.__children.sort((a, b) => a.name.localeCompare(b.name));
    item.children = item.__children;
    item.__children.forEach((c) => finalizar(c as RawNodeDatum & { __children: RawNodeDatum[] }));
  };
  for (const r of raices) finalizar(r as RawNodeDatum & { __children: RawNodeDatum[] });

  raices.sort((a, b) => a.name.localeCompare(b.name));

  // Si hay varias raices, las colgamos de un nodo virtual para un solo lienzo.
  if (raices.length === 1) return raices;
  return [
    {
      name: 'Organigrama',
      attributes: { __virtual: true } as Record<string, string | number | boolean>,
      children: raices,
    },
  ];
}

/** Nodo custom: tarjeta HTML embebida via foreignObject. */
function renderNode(
  { nodeDatum, toggleNode }: CustomNodeElementProps,
  onEdit: (node: JerarquiaNode) => void,
  dark: boolean
) {
  const attrs = (nodeDatum.attributes ?? {}) as Record<string, string | number | boolean>;

  // Nodo virtual raiz (cuando hay multiples raices): punto discreto.
  if (attrs.__virtual) {
    return (
      <g>
        <circle r={6} fill={dark ? '#4a5672' : '#adb5bd'} />
      </g>
    );
  }

  const nivel = String(attrs.nivel || '');
  const aproximada = attrs.aproximada === true;
  const idCargoPadre = Number(attrs.idCargoPadre);
  const node: JerarquiaNode = {
    idCargoJerarquia: Number(attrs.idCargoJerarquia),
    idCargo: Number(attrs.idCargo),
    nombre: nodeDatum.name,
    nivel: nivel || null,
    nivelClasico: String(attrs.nivelClasico || '') || null,
    idCargoPadre: idCargoPadre === -1 ? null : idCargoPadre,
    aproximada,
  };

  const acento = NIVEL_HEX[nivel] ?? (dark ? '#4a5672' : '#adb5bd');
  const hijos = nodeDatum.children?.length ?? 0;
  const colapsado = nodeDatum.__rd3t?.collapsed ?? false;
  const tieneHijos = hijos > 0 || colapsado;

  const cardBg = dark ? '#1f2840' : '#ffffff';
  const cardBorder = dark ? '#354060' : '#e9ecef';
  const textColor = dark ? '#e2e8f8' : '#1f2937';

  return (
    <g>
      <foreignObject
        x={-NODE_W / 2}
        y={-NODE_H / 2}
        width={NODE_W}
        height={NODE_H}
        style={{ overflow: 'visible' }}
      >
        <div
          style={{
            boxSizing: 'border-box',
            width: NODE_W,
            minHeight: NODE_H,
            background: cardBg,
            border: `1px solid ${cardBorder}`,
            borderLeft: `5px solid ${acento}`,
            borderRadius: 10,
            padding: '8px 10px',
            boxShadow: dark ? '0 2px 6px rgba(0,0,0,0.35)' : '0 1px 4px rgba(0,0,0,0.10)',
            fontFamily:
              'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            position: 'relative',
            cursor: 'default',
          }}
        >
          <Text
            size="sm"
            fw={600}
            lineClamp={2}
            style={{ color: textColor, lineHeight: 1.2, paddingRight: 22 }}
          >
            {node.nombre}
          </Text>

          <Group gap={4} mt={6} wrap="wrap">
            {nivel && (
              <Badge variant="light" color={NIVEL_COLOR[nivel] ?? 'gray'} size="xs">
                {nivel}
              </Badge>
            )}
            {aproximada && (
              <Tooltip label="Relacion aproximada (reporte inferido, no confirmado)" withinPortal>
                <Badge
                  variant="outline"
                  color="orange"
                  size="xs"
                  leftSection={<IconAlertTriangle size={10} />}
                >
                  Aproximada
                </Badge>
              </Tooltip>
            )}
            {tieneHijos && (
              <Badge variant="default" size="xs" color="gray">
                {colapsado ? `+${hijos}` : hijos}
              </Badge>
            )}
          </Group>

          {/* Boton editar */}
          <ActionIcon
            variant="subtle"
            size="sm"
            color="blue"
            aria-label="Editar"
            onClick={(e) => {
              e.stopPropagation();
              onEdit(node);
            }}
            style={{ position: 'absolute', top: 4, right: 4 }}
          >
            <IconEdit size={14} />
          </ActionIcon>

          {/* Boton colapsar/expandir rama */}
          {tieneHijos && (
            <ActionIcon
              variant="filled"
              color="gray"
              size="xs"
              radius="xl"
              aria-label={colapsado ? 'Expandir rama' : 'Colapsar rama'}
              onClick={(e) => {
                e.stopPropagation();
                toggleNode();
              }}
              style={{
                position: 'absolute',
                bottom: -10,
                left: '50%',
                transform: 'translateX(-50%)',
              }}
            >
              {colapsado ? <IconPlus size={12} /> : <IconMinus size={12} />}
            </ActionIcon>
          )}
        </div>
      </foreignObject>
    </g>
  );
}

export default function OrgTree({ nodes, onEdit }: Props) {
  const { colorScheme } = useMantineColorScheme();
  const dark = colorScheme === 'dark';

  const containerRef = useRef<HTMLDivElement>(null);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(0.8);
  const [dims, setDims] = useState({ w: 0, h: 0 });

  const data = useMemo(() => buildRawForest(nodes), [nodes]);

  // Centra el arbol horizontalmente al montar / cambiar de empresa.
  const centrar = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setDims({ w: width, h: height });
    setTranslate({ x: width / 2, y: 90 });
    setZoom(0.8);
  }, []);

  useEffect(() => {
    centrar();
    // Recentra ante cambios de tamano del contenedor.
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      const { width, height } = el.getBoundingClientRect();
      setDims((d) => (d.w !== width || d.h !== height ? { w: width, h: height } : d));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [centrar]);

  // Recentra al cambiar el dataset (empresa).
  useEffect(() => {
    centrar();
  }, [data, centrar]);

  const renderCustom = useCallback(
    (rd3Props: CustomNodeElementProps) => renderNode(rd3Props, onEdit, dark),
    [onEdit, dark]
  );

  if (nodes.length === 0) {
    return (
      <Text c="dimmed" ta="center" py="lg">
        Esta empresa no tiene jerarquia de cargos cargada.
      </Text>
    );
  }

  const treeProps: Partial<TreeProps> = {
    data,
    orientation: 'vertical',
    pathFunc: 'step',
    collapsible: true,
    initialDepth: 2,
    translate,
    zoom,
    scaleExtent: { min: 0.15, max: 2 },
    separation: { siblings: 1.15, nonSiblings: 1.4 },
    nodeSize: { x: NODE_W + 30, y: NODE_H + 70 },
    zoomable: true,
    draggable: true,
    enableLegacyTransitions: true,
    transitionDuration: 250,
    renderCustomNodeElement: renderCustom,
    pathClassFunc: () => (dark ? 'rd3t-link-dark' : 'rd3t-link-light'),
  };

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        width: '100%',
        height: 'calc(100vh - 230px)',
        minHeight: 480,
        border: `1px solid ${dark ? '#354060' : '#e9ecef'}`,
        borderRadius: 12,
        overflow: 'hidden',
        background: dark
          ? 'radial-gradient(circle at 1px 1px, #283352 1px, transparent 0) 0 0 / 24px 24px, #151c2e'
          : 'radial-gradient(circle at 1px 1px, #e9ecef 1px, transparent 0) 0 0 / 24px 24px, #f8f9fa',
      }}
    >
      {/* Estilos de las lineas conectoras (react-d3-tree las pinta con stroke). */}
      <style>{`
        .rd3t-link-light { stroke: #adb5bd; stroke-width: 1.5px; fill: none; }
        .rd3t-link-dark { stroke: #4a5672; stroke-width: 1.5px; fill: none; }
        .rd3t-tree-container svg { cursor: grab; }
        .rd3t-tree-container svg:active { cursor: grabbing; }
      `}</style>

      {/* Controles de zoom y centrado */}
      <Group
        gap={6}
        style={{ position: 'absolute', top: 12, right: 12, zIndex: 5 }}
      >
        <Tooltip label="Acercar" withinPortal>
          <ActionIcon
            variant="default"
            size="lg"
            onClick={() => setZoom((z) => Math.min(2, +(z + 0.15).toFixed(2)))}
            aria-label="Acercar"
          >
            <IconPlus size={18} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label="Alejar" withinPortal>
          <ActionIcon
            variant="default"
            size="lg"
            onClick={() => setZoom((z) => Math.max(0.15, +(z - 0.15).toFixed(2)))}
            aria-label="Alejar"
          >
            <IconMinus size={18} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label="Ajustar a pantalla / centrar" withinPortal>
          <ActionIcon variant="default" size="lg" onClick={centrar} aria-label="Centrar">
            <IconFocusCentered size={18} />
          </ActionIcon>
        </Tooltip>
      </Group>

      {dims.w > 0 && (
        <Tree
          {...(treeProps as TreeProps)}
          dimensions={{ width: dims.w, height: dims.h }}
        />
      )}
    </div>
  );
}
