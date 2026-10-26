'use client';

import { useEffect, useState } from 'react';
import { Alert, Button, Group, Select, SimpleGrid, Stack, Switch, Text } from '@mantine/core';
import { IconDeviceFloppy } from '@tabler/icons-react';
import { leerJsonSeguro, type ContextoFormacion } from './tipos';

/**
 * MÓDULO FORMACIÓN — qué departamentos de SynerLink aplican en cada empresa
 * (Nicolás Rivera, 2026-10-26). Sin configurar, aplican todos.
 */
export default function DepartamentosEmpresa({ ctx, onGuardado }: { ctx: ContextoFormacion; onGuardado: () => Promise<void> }) {
  const [empresaId, setEmpresaId] = useState<string | null>(ctx.empresas[0] ? String(ctx.empresas[0].id) : null);
  const [activos, setActivos] = useState<Record<number, boolean>>({});
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);

  useEffect(() => {
    if (!empresaId) return;
    const id = Number(empresaId);
    const filas = ctx.empresaDepartamentos.filter((d) => d.empresaId === id);
    const mapa: Record<number, boolean> = {};
    for (const d of ctx.departamentos) {
      const f = filas.find((x) => x.departamentoId === d.id);
      mapa[d.id] = filas.length === 0 ? true : f?.activo === true;
    }
    setActivos(mapa);
    setAviso(null);
  }, [empresaId, ctx]);

  const guardar = async () => {
    if (!empresaId) return;
    setGuardando(true);
    setAviso(null);
    try {
      const res = await fetch('/api/formacion/departamentos', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          empresaId: Number(empresaId),
          departamentos: ctx.departamentos.map((d) => ({ id: d.id, activo: activos[d.id] === true })),
        }),
      });
      const data = await leerJsonSeguro(res);
      if (!res.ok) throw new Error(String(data.error ?? 'No se pudieron guardar los departamentos.'));
      setAviso({ tipo: 'ok', texto: 'Departamentos de la empresa guardados.' });
      await onGuardado();
    } catch (e) {
      setAviso({ tipo: 'error', texto: (e as Error).message });
    } finally {
      setGuardando(false);
    }
  };

  const total = Object.values(activos).filter(Boolean).length;

  return (
    <Stack gap='sm' data-testid='departamentos-empresa'>
      {aviso && (
        <Alert color={aviso.tipo === 'ok' ? 'green' : 'red'} role={aviso.tipo === 'ok' ? 'status' : 'alert'}>
          {aviso.texto}
        </Alert>
      )}
      <Group align='flex-end' wrap='wrap' gap='sm'>
        <Select
          label='Empresa'
          value={empresaId}
          onChange={setEmpresaId}
          data={ctx.empresas.map((e) => ({ value: String(e.id), label: e.nombre }))}
          allowDeselect={false}
          searchable
          style={{ minWidth: 260 }}
        />
        <Button leftSection={<IconDeviceFloppy size={16} />} onClick={() => void guardar()} loading={guardando} disabled={!empresaId}>
          Guardar
        </Button>
      </Group>
      <Text size='sm' c='dimmed'>
        {total} de {ctx.departamentos.length} departamentos aplican en esta empresa. Son los que se ofrecen al definir el alcance
        de un curso y al cargar colaboradores.
      </Text>
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing='xs'>
        {ctx.departamentos.map((d) => (
          <Switch
            key={d.id}
            checked={activos[d.id] === true}
            onChange={(e) => setActivos((a) => ({ ...a, [d.id]: e.currentTarget.checked }))}
            label={d.nombre}
          />
        ))}
      </SimpleGrid>
    </Stack>
  );
}
