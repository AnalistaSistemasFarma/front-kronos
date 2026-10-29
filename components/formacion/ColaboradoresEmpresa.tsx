'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActionIcon, Alert, Box, Button, Group, Paper, Select, Stack, Table, Text, TextInput, Textarea, Tooltip } from '@mantine/core';
import { IconPlus, IconTrash, IconUpload } from '@tabler/icons-react';
import { departamentosDeEmpresa, leerJsonSeguro, type ContextoFormacion } from './tipos';

/**
 * MÓDULO FORMACIÓN — colaboradores por empresa y departamento (2026-10-26).
 * Para quien no tiene el departamento en SynerLink. Se cargan uno a uno o
 * pegando desde Excel las columnas Correo, Nombre y Departamento.
 */
interface Colaborador {
  correo: string;
  nombre: string | null;
  departamentoId: number;
}

const normalizar = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

export default function ColaboradoresEmpresa({ ctx }: { ctx: ContextoFormacion }) {
  const [empresaId, setEmpresaId] = useState<string | null>(ctx.empresas[0] ? String(ctx.empresas[0].id) : null);
  const [lista, setLista] = useState<Colaborador[]>([]);
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);
  const [correo, setCorreo] = useState('');
  const [nombre, setNombre] = useState('');
  const [dep, setDep] = useState<string | null>(null);
  const [pegado, setPegado] = useState('');
  const [trabajando, setTrabajando] = useState(false);
  const [filtro, setFiltro] = useState('');

  const deps = useMemo(() => (empresaId ? departamentosDeEmpresa(ctx, Number(empresaId)) : []), [ctx, empresaId]);
  const nombreDep = (id: number) => ctx.departamentos.find((d) => d.id === id)?.nombre ?? `#${id}`;

  const cargar = useCallback(async () => {
    if (!empresaId) return;
    const res = await fetch(`/api/formacion/colaboradores?empresaId=${empresaId}`, { cache: 'no-store' });
    const data = await leerJsonSeguro(res);
    if (!res.ok) {
      setAviso({ tipo: 'error', texto: String(data.error ?? 'No se pudieron cargar los colaboradores.') });
      return;
    }
    setLista((data.colaboradores as Colaborador[]) ?? []);
  }, [empresaId]);

  useEffect(() => {
    setAviso(null);
    void cargar();
  }, [cargar]);

  const enviar = async (colaboradores: Array<{ correo: string; nombre?: string; departamentoId: number }>) => {
    setTrabajando(true);
    setAviso(null);
    try {
      const res = await fetch('/api/formacion/colaboradores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empresaId: Number(empresaId), colaboradores }),
      });
      const data = await leerJsonSeguro(res);
      if (!res.ok) throw new Error(String(data.error ?? 'No se pudieron guardar los colaboradores.'));
      const errores = (data.errores as string[]) ?? [];
      setAviso({
        tipo: errores.length ? 'error' : 'ok',
        texto: `Guardados: ${Number(data.guardados ?? 0)}.${errores.length ? ` Con error: ${errores.slice(0, 5).join(' ')}${errores.length > 5 ? '…' : ''}` : ''}`,
      });
      await cargar();
      return errores.length === 0;
    } catch (e) {
      setAviso({ tipo: 'error', texto: (e as Error).message });
      return false;
    } finally {
      setTrabajando(false);
    }
  };

  const agregar = async () => {
    if (!correo.trim() || !dep) return;
    if (await enviar([{ correo, nombre, departamentoId: Number(dep) }])) {
      setCorreo('');
      setNombre('');
    }
  };

  const cargarPegado = async () => {
    const porNombre = new Map(ctx.departamentos.map((d) => [normalizar(d.nombre), d.id]));
    const filas: Array<{ correo: string; nombre?: string; departamentoId: number }> = [];
    const malas: number[] = [];
    pegado
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .forEach((linea, i) => {
        const [c = '', n = '', d = ''] = linea.split(/\t|;/).map((x) => x.trim());
        if (i === 0 && normalizar(c) === 'correo') return; // encabezado
        const depId = porNombre.get(normalizar(d));
        if (!c.includes('@') || !depId) malas.push(i + 1);
        else filas.push({ correo: c, nombre: n, departamentoId: depId });
      });
    if (filas.length === 0) {
      setAviso({ tipo: 'error', texto: 'No se encontró ninguna fila válida. Pegue las columnas Correo, Nombre y Departamento.' });
      return;
    }
    if (await enviar(filas)) setPegado('');
    if (malas.length) {
      setAviso({ tipo: 'error', texto: `Se cargaron ${filas.length}. Revise las líneas ${malas.slice(0, 10).join(', ')}: correo o departamento no reconocido.` });
    }
  };

  const quitar = async (c: Colaborador) => {
    if (!window.confirm(`¿Quitar a ${c.correo} de esta empresa?`)) return;
    const res = await fetch('/api/formacion/colaboradores', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ empresaId: Number(empresaId), correo: c.correo }),
    });
    if (res.ok) await cargar();
  };

  const visibles = lista.filter((c) => {
    const f = normalizar(filtro);
    return !f || normalizar(`${c.correo} ${c.nombre ?? ''} ${nombreDep(c.departamentoId)}`).includes(f);
  });

  return (
    <Stack gap='sm' data-testid='colaboradores-empresa'>
      {aviso && (
        <Alert color={aviso.tipo === 'ok' ? 'green' : 'red'} role={aviso.tipo === 'ok' ? 'status' : 'alert'}>
          {aviso.texto}
        </Alert>
      )}
      <Select
        label='Empresa'
        value={empresaId}
        onChange={setEmpresaId}
        data={ctx.empresas.map((e) => ({ value: String(e.id), label: e.nombre }))}
        allowDeselect={false}
        searchable
        maw={320}
      />
      <Text size='sm' c='dimmed'>
        Quien tiene usuario de SynerLink ya trae su empresa y su departamento. Aquí se cargan quienes entran a Formación con un
        código al correo.
      </Text>
      <Paper withBorder radius='md' p='md'>
        <Group align='flex-end' wrap='wrap' gap='sm'>
          <TextInput label='Correo' placeholder='nombre@empresa.com' value={correo} onChange={(e) => setCorreo(e.currentTarget.value)} style={{ flex: 2, minWidth: 220 }} />
          <TextInput label='Nombre' placeholder='Opcional' value={nombre} onChange={(e) => setNombre(e.currentTarget.value)} style={{ flex: 2, minWidth: 180 }} />
          <Select label='Departamento' value={dep} onChange={setDep} data={deps.map((d) => ({ value: String(d.id), label: d.nombre }))} searchable style={{ flex: 1, minWidth: 200 }} />
          <Button leftSection={<IconPlus size={16} />} onClick={() => void agregar()} loading={trabajando} disabled={!correo.trim() || !dep}>
            Agregar
          </Button>
        </Group>
      </Paper>
      <Paper withBorder radius='md' p='md'>
        <Stack gap='xs'>
          <Textarea
            label='Carga masiva desde Excel'
            description='Copie en Excel las columnas Correo, Nombre y Departamento (con o sin encabezado) y péguelas aquí. El departamento debe llamarse igual que en SynerLink.'
            value={pegado}
            onChange={(e) => setPegado(e.currentTarget.value)}
            autosize
            minRows={3}
            maxRows={10}
          />
          <Group>
            <Button variant='default' leftSection={<IconUpload size={16} />} onClick={() => void cargarPegado()} loading={trabajando} disabled={!pegado.trim()}>
              Cargar
            </Button>
          </Group>
        </Stack>
      </Paper>
      <TextInput placeholder='Buscar por correo, nombre o departamento' value={filtro} onChange={(e) => setFiltro(e.currentTarget.value)} maw={420} />
      <Box className='overflow-x-auto'>
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Correo</Table.Th>
              <Table.Th>Nombre</Table.Th>
              <Table.Th>Departamento</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {visibles.length === 0 ? (
              <Table.Tr>
                <Table.Td colSpan={4}>
                  <Text size='sm' c='dimmed' ta='center' py='md'>
                    No hay colaboradores cargados en esta empresa.
                  </Text>
                </Table.Td>
              </Table.Tr>
            ) : (
              visibles.map((c) => (
                <Table.Tr key={c.correo}>
                  <Table.Td>{c.correo}</Table.Td>
                  <Table.Td>{c.nombre ?? '—'}</Table.Td>
                  <Table.Td>{nombreDep(c.departamentoId)}</Table.Td>
                  <Table.Td>
                    <Tooltip label='Quitar' withArrow>
                      <ActionIcon variant='subtle' color='red' aria-label={`Quitar a ${c.correo}`} onClick={() => void quitar(c)}>
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Tooltip>
                  </Table.Td>
                </Table.Tr>
              ))
            )}
          </Table.Tbody>
        </Table>
      </Box>
    </Stack>
  );
}
