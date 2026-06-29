'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { Loader, Alert, Select, Group, Text, Badge } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import OrgTree from './OrgTree';
import EditNodeModal from './EditNodeModal';
import type { CompanyAccess, JerarquiaNode } from './types';
import { NIVEL_COLOR } from './types';

/**
 * Organigrama (multiempresa).
 *
 * Visualiza y edita la jerarquia de cargos por empresa a partir de los modelos
 * locales Cargo / CargoJerarquia (no consume SAP). El cliente solo consume
 * endpoints propios (/api/organigrama/*) que resuelven acceso y escrituras en
 * el servidor.
 */
export default function OrganigramaPage() {
  const { data: session } = useSession();

  const [companies, setCompanies] = useState<CompanyAccess[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState<string>('');
  const [nodes, setNodes] = useState<JerarquiaNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingTree, setLoadingTree] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<JerarquiaNode | null>(null);

  // 1) Cargar empresas accesibles.
  useEffect(() => {
    if (!session) return;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch('/api/organigrama/access');
        if (!res.ok) throw new Error('No se pudo verificar el acceso al modulo');
        const data = await res.json();
        const list: CompanyAccess[] = data.companies ?? [];
        setCompanies(list);
        if (list.length === 0) {
          setError('No tiene acceso al organigrama en ninguna empresa.');
        } else {
          setSelectedCompany(String(list[0].idCompany));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error inesperado');
      } finally {
        setLoading(false);
      }
    })();
  }, [session]);

  // 2) Cargar el arbol de la empresa seleccionada.
  const loadTree = async (companyId: string) => {
    try {
      setLoadingTree(true);
      setError(null);
      const res = await fetch(`/api/organigrama/tree?companyId=${companyId}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'No se pudo cargar el organigrama');
        setNodes([]);
        return;
      }
      setCompanyName(data.companyName ?? '');
      setNodes(data.nodes ?? []);
    } catch {
      setError('Error de red al cargar el organigrama');
      setNodes([]);
    } finally {
      setLoadingTree(false);
    }
  };

  useEffect(() => {
    if (selectedCompany) loadTree(selectedCompany);
  }, [selectedCompany]);

  const companyOptions = useMemo(
    () => companies.map((c) => ({ value: String(c.idCompany), label: c.companyName })),
    [companies]
  );

  const stats = useMemo(() => {
    const total = nodes.length;
    const aproximadas = nodes.filter((n) => n.aproximada).length;
    const porNivel = nodes.reduce<Record<string, number>>((acc, n) => {
      const k = n.nivel ?? 'Sin nivel';
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {});
    return { total, aproximadas, porNivel };
  }, [nodes]);

  if (loading) {
    return (
      <Group justify="center" mt="xl">
        <Loader />
      </Group>
    );
  }

  if (error && companies.length === 0) {
    return (
      <Alert color="red" title="Organigrama" mt="md">
        {error}
      </Alert>
    );
  }

  return (
    <div style={{ padding: '1rem', maxWidth: 1000, margin: '0 auto' }}>
      <Group justify="space-between" align="center" mb="md">
        <h2 style={{ margin: 0 }}>Organigrama</h2>
        <Select
          data={companyOptions}
          value={selectedCompany}
          onChange={(v) => setSelectedCompany(v)}
          allowDeselect={false}
          style={{ minWidth: 220 }}
          aria-label="Empresa"
        />
      </Group>

      {error && companies.length > 0 && (
        <Alert color="red" icon={<IconAlertTriangle size={16} />} mb="sm">
          {error}
        </Alert>
      )}

      <Group gap="xs" mb="sm" wrap="wrap">
        <Text size="sm" c="dimmed">
          {companyName || 'Empresa'} — {stats.total} cargo(s)
        </Text>
        {Object.entries(stats.porNivel).map(([nivel, count]) => (
          <Badge key={nivel} variant="light" color={NIVEL_COLOR[nivel] ?? 'gray'} size="sm">
            {nivel}: {count}
          </Badge>
        ))}
        {stats.aproximadas > 0 && (
          <Badge variant="outline" color="orange" size="sm" leftSection={<IconAlertTriangle size={12} />}>
            {stats.aproximadas} aproximada(s)
          </Badge>
        )}
      </Group>

      {loadingTree ? (
        <Group justify="center" mt="xl">
          <Loader />
        </Group>
      ) : (
        <OrgTree nodes={nodes} onEdit={(n) => setEditing(n)} />
      )}

      <EditNodeModal
        node={editing}
        nodes={nodes}
        companyId={selectedCompany ? Number(selectedCompany) : 0}
        onClose={() => setEditing(null)}
        onUpdated={() => selectedCompany && loadTree(selectedCompany)}
      />
    </div>
  );
}
