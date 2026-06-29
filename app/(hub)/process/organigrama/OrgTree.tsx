'use client';

import React, { useMemo, useState } from 'react';
import { Badge, Group, ActionIcon, Text, Tooltip } from '@mantine/core';
import { IconChevronRight, IconChevronDown, IconEdit, IconAlertTriangle } from '@tabler/icons-react';
import type { JerarquiaNode } from './types';
import { NIVEL_COLOR } from './types';

interface Props {
  nodes: JerarquiaNode[];
  onEdit: (node: JerarquiaNode) => void;
}

interface TreeItem extends JerarquiaNode {
  hijos: TreeItem[];
}

/** Arma el bosque (puede haber varias raices) a partir de la lista plana. */
function buildForest(nodes: JerarquiaNode[]): TreeItem[] {
  const byCargo = new Map<number, TreeItem>();
  for (const n of nodes) byCargo.set(n.idCargo, { ...n, hijos: [] });

  const raices: TreeItem[] = [];
  for (const item of byCargo.values()) {
    if (item.idCargoPadre != null && byCargo.has(item.idCargoPadre)) {
      byCargo.get(item.idCargoPadre)!.hijos.push(item);
    } else {
      // Raiz: padre nulo, o padre que no esta asignado en esta empresa.
      raices.push(item);
    }
  }

  const ordenar = (arr: TreeItem[]) => {
    arr.sort((a, b) => a.nombre.localeCompare(b.nombre));
    arr.forEach((i) => ordenar(i.hijos));
  };
  ordenar(raices);
  return raices;
}

function NodeRow({
  item,
  depth,
  onEdit,
}: {
  item: TreeItem;
  depth: number;
  onEdit: (node: JerarquiaNode) => void;
}) {
  const [open, setOpen] = useState(depth < 2); // expande los primeros niveles
  const hasChildren = item.hijos.length > 0;

  return (
    <div>
      <Group
        gap="xs"
        wrap="nowrap"
        style={{
          paddingLeft: depth * 22,
          paddingTop: 4,
          paddingBottom: 4,
          borderBottom: '1px solid #f1f3f5',
        }}
      >
        {hasChildren ? (
          <ActionIcon variant="subtle" size="sm" onClick={() => setOpen((o) => !o)} aria-label="Expandir">
            {open ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
          </ActionIcon>
        ) : (
          <span style={{ display: 'inline-block', width: 28 }} />
        )}

        <Text size="sm" fw={depth === 0 ? 700 : 500} style={{ color: '#1f2937' }}>
          {item.nombre}
        </Text>

        {item.nivel && (
          <Badge variant="light" color={NIVEL_COLOR[item.nivel] ?? 'gray'} size="sm">
            {item.nivel}
          </Badge>
        )}

        {item.aproximada && (
          <Tooltip label="Relacion aproximada (reporte inferido, no confirmado)">
            <Badge
              variant="outline"
              color="orange"
              size="sm"
              leftSection={<IconAlertTriangle size={12} />}
            >
              Aproximada
            </Badge>
          </Tooltip>
        )}

        {hasChildren && (
          <Text size="xs" c="dimmed">
            ({item.hijos.length})
          </Text>
        )}

        <Tooltip label="Editar jefe / marca aproximada">
          <ActionIcon
            variant="subtle"
            size="sm"
            color="blue"
            onClick={() => onEdit(item)}
            aria-label="Editar"
            style={{ marginLeft: 'auto' }}
          >
            <IconEdit size={16} />
          </ActionIcon>
        </Tooltip>
      </Group>

      {open &&
        item.hijos.map((h) => (
          <NodeRow key={h.idCargoJerarquia} item={h} depth={depth + 1} onEdit={onEdit} />
        ))}
    </div>
  );
}

export default function OrgTree({ nodes, onEdit }: Props) {
  const forest = useMemo(() => buildForest(nodes), [nodes]);

  if (forest.length === 0) {
    return (
      <Text c="dimmed" ta="center" py="lg">
        Esta empresa no tiene jerarquia de cargos cargada.
      </Text>
    );
  }

  return (
    <div
      style={{
        border: '1px solid #e9ecef',
        borderRadius: 8,
        overflow: 'hidden',
        background: '#fff',
      }}
    >
      {forest.map((root) => (
        <NodeRow key={root.idCargoJerarquia} item={root} depth={0} onEdit={onEdit} />
      ))}
    </div>
  );
}
