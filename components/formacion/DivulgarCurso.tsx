'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Box, Button, Card, Checkbox, Group, Select, Stack, Table, Text, Textarea, Title } from '@mantine/core';
import { IconSpeakerphone } from '@tabler/icons-react';
import { leerJsonSeguro } from './tipos';

/**
 * MÓDULO FORMACIÓN — divulgar un curso o un video nuevo (Nicolás Rivera,
 * 2026-10-26). Cada destinatario del alcance queda con un pendiente en el ícono
 * de Formación del header hasta que abre el curso o el material.
 */
interface Divulgacion {
  id: number;
  materialId: number | null;
  mensaje: string | null;
  divulgadoPor: string;
  divulgadoAt: string;
  destinatarios: number;
  vistos: number;
}

export default function DivulgarCurso({
  cursoId,
  activo,
  materiales,
}: {
  cursoId: number;
  activo: boolean;
  materiales: Array<{ id: number; titulo: string }>;
}) {
  const [que, setQue] = useState<string>('curso');
  const [mensaje, setMensaje] = useState('');
  const [porCorreo, setPorCorreo] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);
  const [historial, setHistorial] = useState<Divulgacion[]>([]);

  const cargar = useCallback(async () => {
    const res = await fetch(`/api/formacion/cursos/${cursoId}/divulgar`, { cache: 'no-store' });
    const data = await leerJsonSeguro(res);
    if (res.ok) setHistorial((data.divulgaciones as Divulgacion[]) ?? []);
  }, [cursoId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const nombreMaterial = (id: number | null) =>
    id === null ? 'Curso completo' : (materiales.find((m) => m.id === id)?.titulo ?? `Material #${id}`);

  const divulgar = async () => {
    setEnviando(true);
    setAviso(null);
    try {
      const res = await fetch(`/api/formacion/cursos/${cursoId}/divulgar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          materialId: que === 'curso' ? null : Number(que),
          mensaje,
          avisarPorCorreo: porCorreo,
        }),
      });
      const data = await leerJsonSeguro(res);
      if (!res.ok) throw new Error(String(data.error ?? 'No se pudo divulgar.'));
      const correo = data.correo as { enviados: number; fallidos: number } | null;
      setAviso({
        tipo: 'ok',
        texto:
          `Divulgado a ${Number(data.destinatarios ?? 0).toLocaleString('es-CO')} persona(s): lo verán en el ícono de Formación.` +
          (correo ? ` Correos enviados: ${correo.enviados}${correo.fallidos ? ` (no salieron ${correo.fallidos})` : ''}.` : ''),
      });
      setMensaje('');
      await cargar();
    } catch (e) {
      setAviso({ tipo: 'error', texto: (e as Error).message });
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Card withBorder radius='md' shadow='sm' padding='lg' data-testid='divulgar-curso'>
      <Stack gap='sm'>
        <Title order={4} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <IconSpeakerphone size={20} /> Divulgación
        </Title>
        {aviso && (
          <Alert color={aviso.tipo === 'ok' ? 'green' : 'red'} role={aviso.tipo === 'ok' ? 'status' : 'alert'} data-testid='divulgar-aviso'>
            {aviso.texto}
          </Alert>
        )}
        {!activo && <Alert color='yellow'>Publique el curso antes de divulgarlo.</Alert>}
        <Group align='flex-end' wrap='wrap' gap='sm'>
          <Select
            label='¿Qué se divulga?'
            value={que}
            onChange={(v) => setQue(v ?? 'curso')}
            data={[{ value: 'curso', label: 'Curso completo (curso nuevo)' }, ...materiales.map((m) => ({ value: String(m.id), label: m.titulo }))]}
            allowDeselect={false}
            style={{ flex: 1, minWidth: 220 }}
          />
          <Button leftSection={<IconSpeakerphone size={16} />} onClick={() => void divulgar()} loading={enviando} disabled={!activo}>
            Divulgar
          </Button>
        </Group>
        <Textarea
          label='Mensaje (opcional)'
          placeholder='Ej.: Nuevo video de inducción BPM; véalo antes del viernes.'
          value={mensaje}
          maxLength={1000}
          autosize
          minRows={2}
          onChange={(e) => setMensaje(e.currentTarget.value)}
        />
        <Checkbox
          checked={porCorreo}
          onChange={(e) => setPorCorreo(e.currentTarget.checked)}
          label='Avisar también por correo a quienes no tienen usuario de SynerLink'
        />
        <Text size='xs' c='dimmed'>
          Se divulga a las personas del alcance del curso (empresas y departamentos activos) y a los inscritos.
        </Text>
        {historial.length > 0 && (
          <Box className='overflow-x-auto'>
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Fecha</Table.Th>
                  <Table.Th>Qué</Table.Th>
                  <Table.Th>Por</Table.Th>
                  <Table.Th>Vistos</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {historial.map((h) => (
                  <Table.Tr key={h.id}>
                    <Table.Td>{new Date(h.divulgadoAt).toLocaleString('es-CO')}</Table.Td>
                    <Table.Td>{nombreMaterial(h.materialId)}</Table.Td>
                    <Table.Td>{h.divulgadoPor}</Table.Td>
                    <Table.Td>
                      <Badge variant='light' color={h.vistos >= h.destinatarios ? 'green' : 'blue'}>
                        {h.vistos}/{h.destinatarios}
                      </Badge>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Box>
        )}
      </Stack>
    </Card>
  );
}
