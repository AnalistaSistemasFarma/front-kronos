'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Modal, Select, Switch, Button, Group, Stack, Alert, Text, Badge } from '@mantine/core';
import type { JerarquiaNode } from './types';
import { NIVEL_COLOR } from './types';

interface Props {
  /** Nodo en edicion (null = modal cerrado). */
  node: JerarquiaNode | null;
  /** Todos los nodos de la empresa (para listar posibles jefes). */
  nodes: JerarquiaNode[];
  companyId: number;
  onClose: () => void;
  onUpdated: () => void;
}

/**
 * Edicion de una relacion de jerarquia: reasignar el jefe (id_cargo_padre) y
 * alternar la marca "aproximada". Las validaciones fuertes (anti-ciclo,
 * pertenencia a la empresa) se repiten en el servidor; aqui solo se filtran
 * las opciones obvias para mejor UX.
 */
export default function EditNodeModal({ node, nodes, companyId, onClose, onUpdated }: Props) {
  const [parent, setParent] = useState<string | null>(null);
  const [aproximada, setAproximada] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (node) {
      setParent(node.idCargoPadre != null ? String(node.idCargoPadre) : null);
      setAproximada(node.aproximada);
      setError(null);
    }
  }, [node]);

  // Conjunto de descendientes del nodo actual (no pueden ser su jefe).
  const descendientes = useMemo(() => {
    const set = new Set<number>();
    if (!node) return set;
    const hijosDe = new Map<number, number[]>();
    for (const n of nodes) {
      if (n.idCargoPadre != null) {
        const arr = hijosDe.get(n.idCargoPadre) ?? [];
        arr.push(n.idCargo);
        hijosDe.set(n.idCargoPadre, arr);
      }
    }
    const pila = [node.idCargo];
    while (pila.length) {
      const actual = pila.pop()!;
      for (const hijo of hijosDe.get(actual) ?? []) {
        if (!set.has(hijo)) {
          set.add(hijo);
          pila.push(hijo);
        }
      }
    }
    return set;
  }, [node, nodes]);

  // Candidatos a jefe: cualquier cargo de la empresa salvo el propio nodo y sus
  // descendientes (evitar ciclos en el selector).
  const parentOptions = useMemo(() => {
    if (!node) return [];
    return nodes
      .filter((n) => n.idCargo !== node.idCargo && !descendientes.has(n.idCargo))
      .map((n) => ({ value: String(n.idCargo), label: n.nombre }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [node, nodes, descendientes]);

  const submit = async () => {
    if (!node) return;
    setError(null);
    setSaving(true);
    try {
      const res = await fetch('/api/organigrama/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          idCargoJerarquia: node.idCargoJerarquia,
          idCargoPadre: parent ? Number(parent) : null,
          aproximada,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'No se pudo guardar el cambio');
        return;
      }
      onUpdated();
      onClose();
    } catch {
      setError('Error de red al guardar el cambio');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal opened={!!node} onClose={onClose} title="Editar relacion de jerarquia" size="md">
      {node && (
        <Stack gap="sm">
          {error && <Alert color="red">{error}</Alert>}

          <Group gap="xs">
            <Text size="sm" fw={500}>
              Cargo:
            </Text>
            <Text size="sm">{node.nombre}</Text>
            {node.nivel && (
              <Badge variant="light" color={NIVEL_COLOR[node.nivel] ?? 'gray'}>
                {node.nivel}
              </Badge>
            )}
          </Group>

          <Select
            label="Jefe (cargo padre)"
            description="Vacio = cargo raiz (reporta a la cuspide)"
            placeholder="Sin jefe (raiz)"
            data={parentOptions}
            value={parent}
            onChange={setParent}
            searchable
            clearable
            nothingFoundMessage="Sin coincidencias"
          />

          <Switch
            label="Relacion aproximada"
            description="Marca cuando el reporte no se pudo inferir con certeza del organigrama"
            checked={aproximada}
            onChange={(e) => setAproximada(e.currentTarget.checked)}
          />

          <Group justify="flex-end" mt="sm">
            <Button variant="default" onClick={onClose} disabled={saving}>
              Cancelar
            </Button>
            <Button onClick={submit} loading={saving}>
              Guardar
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}
