'use client';

import type { ReactElement } from 'react';
import { Box, Text, Badge, Group } from '@mantine/core';

/**
 * Componente de diagrama de flujo REUTILIZABLE (sin librerías de diagramas:
 * el repo no trae reactflow/dagre/xyflow, así que se dibuja con SVG inline).
 *
 * Sirve para CUALQUIER proceso de "Solicitudes Generales": con solo `tasks`
 * (secuencia por `display_order`, tal cual las devuelve
 * /api/requests-general/workflow-tasks o /api/document-management/workflow-tasks)
 * dibuja una fila lineal con flechas sólidas — igual a como avanza
 * lib/workflow/advanceSequentialTask.js para cualquier proceso genérico.
 *
 * Cuando además se le pasa `transitions` + `mainSequenceStates` (hoy solo
 * Gestión Documental los tiene — ver lib/document-management/workflowStates.ts:
 * DOCUMENT_WORKFLOW_TRANSITIONS / MAIN_SEQUENCE_STATES), agrega debajo las
 * ramas de excepción (reasignar, reelaborar, rechazar, anular, eliminar,
 * obsoleto) con flechas punteadas coloreadas por tipo. Esos datos SIEMPRE se
 * importan desde la constante compartida — nunca se redefine aquí ninguna
 * regla de qué tarea puede pasar a cuál.
 */

export interface WorkflowDiagramTask {
  id: number;
  task: string;
  display_order: number | null;
}

export type WorkflowDiagramTransitionKind = 'forward' | 'reversible' | 'terminal' | 'system';

export interface WorkflowDiagramTransition {
  action: string;
  from: string;
  to: string;
  label: string;
  kind: WorkflowDiagramTransitionKind;
}

export interface WorkflowDiagramProps {
  tasks: WorkflowDiagramTask[];
  transitions?: WorkflowDiagramTransition[];
  mainSequenceStates?: string[];
  /** Estado actual a resaltar (p.ej. version.status de la versión vigente/en curso). */
  currentState?: string | null;
  title?: string;
}

const NODE_W = 156;
const NODE_H = 48;
const GAP_X = 36;
const MAIN_Y = 46;
const BRANCH_Y = MAIN_Y + NODE_H + 96;
const MAX_INDIVIDUAL_EDGES = 4;

const KIND_COLOR: Record<WorkflowDiagramTransitionKind, string> = {
  forward: '#228be6',
  reversible: '#f59f00',
  terminal: '#fa5252',
  system: '#868e96',
};

const KIND_FILL: Record<WorkflowDiagramTransitionKind, string> = {
  forward: '#e7f5ff',
  reversible: '#fff9db',
  terminal: '#fff0f0',
  system: '#f1f3f5',
};

interface LaidOutNode {
  task: string;
  x: number;
  y: number;
  kind: WorkflowDiagramTransitionKind | 'main';
}

function wrapLabel(label: string): string[] {
  if (label.length <= 16) return [label];
  const words = label.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const w of words) {
    if ((current + ' ' + w).trim().length > 16 && current) {
      lines.push(current.trim());
      current = w;
    } else {
      current = (current + ' ' + w).trim();
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 2);
}

export default function WorkflowDiagram({
  tasks,
  transitions,
  mainSequenceStates,
  currentState,
  title,
}: WorkflowDiagramProps) {
  const sortedTasks = [...tasks].sort(
    (a, b) => (a.display_order ?? 0) - (b.display_order ?? 0)
  );

  if (sortedTasks.length === 0) {
    return (
      <Text size="sm" c="dimmed">
        Este proceso todavía no tiene tareas sembradas para dibujar el diagrama.
      </Text>
    );
  }

  const hasBranchData = !!transitions && !!mainSequenceStates && mainSequenceStates.length > 0;

  const taskNames = new Set(sortedTasks.map((t) => t.task));

  const mainRowNames = hasBranchData
    ? sortedTasks.filter((t) => mainSequenceStates!.includes(t.task)).map((t) => t.task)
    : sortedTasks.map((t) => t.task);

  const branchRowNames = hasBranchData
    ? sortedTasks.filter((t) => !mainSequenceStates!.includes(t.task)).map((t) => t.task)
    : [];

  // Posiciones de la fila principal.
  const nodes: LaidOutNode[] = mainRowNames.map((task, i) => ({
    task,
    x: i * (NODE_W + GAP_X),
    y: MAIN_Y,
    kind: 'main',
  }));
  const mainX = new Map(nodes.map((n) => [n.task, n.x]));

  // Bordes relevantes (ambos extremos presentes en este diagrama).
  const relevantEdges = (transitions ?? []).filter(
    (e) => taskNames.has(e.from) && taskNames.has(e.to)
  );

  // Fila principal: flechas sólidas entre pares consecutivos cuando exista un
  // borde 'forward' real (o siempre, en modo genérico sin datos de transición).
  const mainEdgesSvg: ReactElement[] = [];
  for (let i = 0; i < mainRowNames.length - 1; i++) {
    const from = mainRowNames[i];
    const to = mainRowNames[i + 1];
    const hasRealEdge = !hasBranchData
      ? true
      : relevantEdges.some((e) => e.from === from && e.to === to && e.kind === 'forward');
    if (!hasRealEdge) continue;
    const x1 = mainX.get(from)! + NODE_W;
    const x2 = mainX.get(to)!;
    mainEdgesSvg.push(
      <g key={`main-${from}-${to}`}>
        <line
          x1={x1}
          y1={MAIN_Y + NODE_H / 2}
          x2={x2}
          y2={MAIN_Y + NODE_H / 2}
          stroke={KIND_COLOR.forward}
          strokeWidth={2}
          markerEnd="url(#arrow-forward)"
        />
      </g>
    );
  }

  // Fila de ramas: posición x = orden por primer origen conocido en la fila
  // principal, repartidas uniformemente en su propio slot.
  const branchOrderKey = (name: string): number => {
    const firstSource = relevantEdges.find((e) => e.to === name && mainX.has(e.from));
    if (firstSource) return mainX.get(firstSource.from)!;
    const t = sortedTasks.find((t) => t.task === name);
    return (t?.display_order ?? 999) * (NODE_W + GAP_X);
  };
  const orderedBranch = [...branchRowNames].sort((a, b) => branchOrderKey(a) - branchOrderKey(b));
  const totalMainWidth = Math.max(nodes.length, 1) * (NODE_W + GAP_X) - GAP_X;
  const branchSlotW = orderedBranch.length > 0 ? totalMainWidth / orderedBranch.length : 0;

  const branchNodes: LaidOutNode[] = orderedBranch.map((task, i) => {
    // Color del nodo según el tipo de borde entrante/saliente predominante.
    const touching = relevantEdges.filter((e) => e.from === task || e.to === task);
    const kind: WorkflowDiagramTransitionKind =
      touching.find((e) => e.kind === 'terminal')?.kind ??
      touching.find((e) => e.kind === 'system')?.kind ??
      touching[0]?.kind ??
      'reversible';
    return {
      task,
      x: i * branchSlotW + Math.max((branchSlotW - NODE_W) / 2, 0),
      y: BRANCH_Y,
      kind,
    };
  });
  const branchX = new Map(branchNodes.map((n) => [n.task, n]));

  const branchEdgesSvg: ReactElement[] = [];
  const branchCaptions: { task: string; text: string }[] = [];

  for (const bn of branchNodes) {
    const incoming = relevantEdges.filter((e) => e.to === bn.task && mainX.has(e.from));
    const outgoing = relevantEdges.filter((e) => e.from === bn.task && mainX.has(e.to));

    if (incoming.length > MAX_INDIVIDUAL_EDGES) {
      // Demasiadas fuentes (p.ej. "Anular" aplica casi desde cualquier estado):
      // una sola línea representativa + una leyenda en vez de saturar el dibujo.
      const midMainX = totalMainWidth / 2;
      const color = KIND_COLOR[incoming[0].kind];
      branchEdgesSvg.push(
        <line
          key={`fanin-${bn.task}`}
          x1={midMainX + NODE_W / 2}
          y1={MAIN_Y + NODE_H}
          x2={bn.x + NODE_W / 2}
          y2={bn.y}
          stroke={color}
          strokeWidth={1.5}
          strokeDasharray="5,4"
          markerEnd={`url(#arrow-${incoming[0].kind})`}
        />
      );
      const first = sortedTasks.find((t) => t.task === incoming[0].from)?.task ?? incoming[0].from;
      const last =
        sortedTasks.find((t) => t.task === incoming[incoming.length - 1].from)?.task ??
        incoming[incoming.length - 1].from;
      branchCaptions.push({
        task: bn.task,
        text: `Aplica desde cualquier estado abierto (${first} → ${last})`,
      });
    } else {
      for (const e of incoming) {
        const sourceX = mainX.get(e.from)!;
        branchEdgesSvg.push(
          <line
            key={`in-${e.action}-${e.from}-${e.to}`}
            x1={sourceX + NODE_W / 2}
            y1={MAIN_Y + NODE_H}
            x2={bn.x + NODE_W / 2}
            y2={bn.y}
            stroke={KIND_COLOR[e.kind]}
            strokeWidth={1.5}
            strokeDasharray={e.kind === 'forward' ? undefined : '5,4'}
            markerEnd={`url(#arrow-${e.kind})`}
          />
        );
      }
    }

    for (const e of outgoing) {
      const targetX = mainX.get(e.to)!;
      branchEdgesSvg.push(
        <line
          key={`out-${e.action}-${e.from}-${e.to}`}
          x1={bn.x + NODE_W / 2}
          y1={bn.y}
          x2={targetX + NODE_W / 2}
          y2={MAIN_Y + NODE_H}
          stroke={KIND_COLOR[e.kind]}
          strokeWidth={1.5}
          strokeDasharray={e.kind === 'forward' ? undefined : '5,4'}
          markerEnd={`url(#arrow-${e.kind})`}
        />
      );
    }
  }

  const svgWidth = Math.max(
    totalMainWidth + NODE_W,
    orderedBranch.length * branchSlotW || 0
  ) + 24;
  const svgHeight = branchNodes.length > 0 ? BRANCH_Y + NODE_H + 60 : MAIN_Y + NODE_H + 24;

  const renderNode = (n: LaidOutNode) => {
    const isCurrent = !!currentState && n.task === currentState;
    const fill = n.kind === 'main' ? '#eef2ff' : KIND_FILL[n.kind];
    const stroke = n.kind === 'main' ? '#4263eb' : KIND_COLOR[n.kind];
    const lines = wrapLabel(n.task);
    return (
      <g key={`node-${n.task}`}>
        {isCurrent && (
          <rect
            x={n.x - 5}
            y={n.y - 5}
            width={NODE_W + 10}
            height={NODE_H + 10}
            rx={12}
            fill="none"
            stroke="#12b886"
            strokeWidth={3}
          />
        )}
        <rect
          x={n.x}
          y={n.y}
          width={NODE_W}
          height={NODE_H}
          rx={8}
          fill={isCurrent ? '#d3f9d8' : fill}
          stroke={isCurrent ? '#12b886' : stroke}
          strokeWidth={isCurrent ? 2 : 1.5}
        />
        {lines.map((line, i) => (
          <text
            key={i}
            x={n.x + NODE_W / 2}
            y={n.y + NODE_H / 2 + (i - (lines.length - 1) / 2) * 14 + 5}
            textAnchor="middle"
            fontSize={12.5}
            fontWeight={isCurrent ? 700 : 500}
            fill="#1a1b1e"
          >
            {line}
          </text>
        ))}
        {isCurrent && (
          <text
            x={n.x + NODE_W / 2}
            y={n.y - 11}
            textAnchor="middle"
            fontSize={10.5}
            fontWeight={700}
            fill="#12b886"
          >
            ESTADO ACTUAL
          </text>
        )}
      </g>
    );
  };

  return (
    <Box>
      {title && (
        <Text fw={600} size="sm" mb="xs" c="dimmed">
          {title}
        </Text>
      )}
      <Box style={{ overflowX: 'auto', paddingBottom: 8 }}>
        <svg
          width={svgWidth}
          height={svgHeight}
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          style={{ minWidth: svgWidth }}
        >
          <defs>
            {(['forward', 'reversible', 'terminal', 'system'] as WorkflowDiagramTransitionKind[]).map(
              (k) => (
                <marker
                  key={k}
                  id={`arrow-${k}`}
                  markerWidth={8}
                  markerHeight={8}
                  refX={7}
                  refY={4}
                  orient="auto"
                >
                  <path d="M0,0 L8,4 L0,8 Z" fill={KIND_COLOR[k]} />
                </marker>
              )
            )}
          </defs>
          {branchEdgesSvg}
          {mainEdgesSvg}
          {nodes.map(renderNode)}
          {branchNodes.map(renderNode)}
          {branchCaptions.map((c) => {
            const bn = branchX.get(c.task)!;
            return (
              <text
                key={`caption-${c.task}`}
                x={bn.x + NODE_W / 2}
                y={bn.y + NODE_H + 16}
                textAnchor="middle"
                fontSize={10}
                fill="#868e96"
              >
                {c.text.length > 46 ? c.text.slice(0, 44) + '…' : c.text}
              </text>
            );
          })}
        </svg>
      </Box>
      {hasBranchData && (
        <Group gap="md" mt="xs">
          <Group gap={6}>
            <Box style={{ width: 14, height: 3, background: KIND_COLOR.forward }} />
            <Text size="xs" c="dimmed">Camino sano</Text>
          </Group>
          <Group gap={6}>
            <Box
              style={{
                width: 14,
                height: 0,
                borderTop: `2px dashed ${KIND_COLOR.reversible}`,
              }}
            />
            <Text size="xs" c="dimmed">Reversible (reasignar / reelaborar)</Text>
          </Group>
          <Group gap={6}>
            <Box
              style={{ width: 14, height: 0, borderTop: `2px dashed ${KIND_COLOR.terminal}` }}
            />
            <Text size="xs" c="dimmed">Terminal (rechazar / anular / eliminar)</Text>
          </Group>
          <Group gap={6}>
            <Box style={{ width: 14, height: 0, borderTop: `2px dashed ${KIND_COLOR.system}` }} />
            <Text size="xs" c="dimmed">Automático (obsoleto)</Text>
          </Group>
        </Group>
      )}
      {currentState && !mainRowNames.includes(currentState) && !branchRowNames.includes(currentState) && (
        <Badge color="gray" variant="light" mt="xs">
          Estado actual: {currentState}
        </Badge>
      )}
    </Box>
  );
}
