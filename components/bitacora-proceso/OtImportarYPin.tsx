'use client';

import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Group, Loader, Modal, Stack, Table, Text, Textarea, TextInput } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconAlertTriangle, IconCheck, IconFileImport, IconKeyOff, IconSearch } from '@tabler/icons-react';
import toast from 'react-hot-toast';
import type { OtCompanyAccess } from '../../lib/bitacora-proceso/rules';
import { fmtFechaHora, otSend, useOtFetch } from './otClient';

/**
 * B8 y B3 (2026-10-15), solo Gestión:
 *   - OtImportarOperadores: «Catálogo → Operarios → Importar». Se pega la lista que
 *     envía Farmalógica (una persona por línea: «Nombre completo; documento»), se ve la
 *     VISTA PREVIA (qué se crea, qué ya existe, qué líneas tienen error) y se confirma.
 *     Solo crea nombres nuevos: no edita ni desactiva a nadie.
 *   - OtPinsEmpresa: estado del PIN de bitácora de los usuarios de la empresa y botón
 *     «Restablecer» (borra y desbloquea; la persona lo vuelve a configurar).
 */
interface ResultadoImportacion {
  simulado: boolean;
  crear: Array<{ linea: number; nombre: string; documento: string | null }>;
  existentes: Array<{ linea: number; nombre: string; activo: boolean }>;
  errores: Array<{ linea: number; motivo: string }>;
  creados: number;
}

export function OtImportarOperadores({ company, onImportado }: { company: OtCompanyAccess; onImportado: () => void }) {
  const mobile = useMediaQuery('(max-width: 48em)') ?? false;
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState('');
  const [previa, setPrevia] = useState<ResultadoImportacion | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!abierto) return;
    setTexto('');
    setPrevia(null);
    setError(null);
  }, [abierto]);

  const enviar = async (simular: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const r = await otSend<ResultadoImportacion>('/api/bitacora-proceso/operadores/importar', 'POST', { company: company.idCompany, texto, simular });
      if (simular) {
        setPrevia(r);
      } else {
        toast.success(r.creados === 1 ? 'Se importó 1 operario.' : `Se importaron ${r.creados} operarios.`);
        setAbierto(false);
        onImportado();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant='light' size='md' leftSection={<IconFileImport size={18} />} onClick={() => setAbierto(true)} data-testid='ot-operadores-importar'>
        Importar lista
      </Button>
      <Modal opened={abierto} onClose={() => !busy && setAbierto(false)} title={<Text fw={700} size='lg'>Importar operarios</Text>} fullScreen={mobile} size='xl' radius={mobile ? 0 : 'md'}>
        <Stack gap='md'>
          <Text size='sm'>
            Pegue la lista: <b>una persona por línea</b>, «Nombre completo; documento» (el documento es opcional; también sirve coma o tabulador, por ejemplo copiando dos columnas de Excel).
            Primero verá la vista previa; los nombres que ya existen no se tocan.
          </Text>
          {error && <Alert color='red' icon={<IconAlertTriangle size={16} />} data-testid='ot-importar-error'>{error}</Alert>}
          <Textarea
            size='md'
            autosize
            minRows={6}
            maxRows={14}
            placeholder={'Nombre completo; documento\nAna María Gómez; 1020304050\nPedro Pérez'}
            value={texto}
            onChange={(e) => {
              setTexto(e.currentTarget.value);
              setPrevia(null);
            }}
            data-testid='ot-importar-texto'
          />
          {previa && (
            <Card withBorder radius='md' p='sm' data-testid='ot-importar-previa'>
              <Group gap='xs' mb='xs'>
                <Badge color='green' variant='light' size='lg'>{previa.crear.length} nuevos</Badge>
                <Badge color='gray' variant='light' size='lg'>{previa.existentes.length} ya existen</Badge>
                {previa.errores.length > 0 && <Badge color='red' variant='light' size='lg'>{previa.errores.length} con error</Badge>}
              </Group>
              <Table.ScrollContainer minWidth={320} maxHeight={280}>
                <Table verticalSpacing={4} striped>
                  <Table.Tbody>
                    {previa.crear.map((f) => (
                      <Table.Tr key={`c${f.linea}`}><Table.Td w={60}>{f.linea}</Table.Td><Table.Td>{f.nombre}</Table.Td><Table.Td>{f.documento ?? ''}</Table.Td><Table.Td><Badge color='green' variant='light'>Nuevo</Badge></Table.Td></Table.Tr>
                    ))}
                    {previa.existentes.map((f) => (
                      <Table.Tr key={`e${f.linea}`}><Table.Td>{f.linea}</Table.Td><Table.Td>{f.nombre}</Table.Td><Table.Td /><Table.Td><Badge color='gray' variant='light'>{f.activo ? 'Ya existe' : 'Existe inactivo'}</Badge></Table.Td></Table.Tr>
                    ))}
                    {previa.errores.map((f) => (
                      <Table.Tr key={`x${f.linea}`}><Table.Td>{f.linea}</Table.Td><Table.Td colSpan={2}>{f.motivo}</Table.Td><Table.Td><Badge color='red' variant='light'>Error</Badge></Table.Td></Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </Card>
          )}
          <Group grow={mobile} justify='flex-end'>
            <Button variant='default' size='lg' h={56} onClick={() => setAbierto(false)} disabled={busy}>Cancelar</Button>
            {previa ? (
              <Button size='lg' h={56} leftSection={<IconCheck size={20} />} onClick={() => enviar(false)} loading={busy} disabled={previa.crear.length === 0} data-testid='ot-importar-confirmar'>
                Importar {previa.crear.length}
              </Button>
            ) : (
              <Button size='lg' h={56} onClick={() => enviar(true)} loading={busy} disabled={!texto.trim()} data-testid='ot-importar-previa-btn'>
                Vista previa
              </Button>
            )}
          </Group>
        </Stack>
      </Modal>
    </>
  );
}

interface UsuarioPin {
  id: string;
  name: string;
  email: string;
  configurado: boolean;
  bloqueado: boolean;
  intentosFallidos: number;
  configuradoEn: string | null;
}

export function OtPinsEmpresa({ company }: { company: OtCompanyAccess }) {
  const { data, error, loading, reload } = useOtFetch<{ usuarios: UsuarioPin[] }>(`/api/bitacora-proceso/pin/usuarios?company=${company.idCompany}`);
  const [filtro, setFiltro] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ ok: boolean; text: string } | null>(null);
  const f = filtro.trim().toLowerCase();
  const lista = (data?.usuarios ?? []).filter((u) => !f || u.name.toLowerCase().includes(f) || u.email.toLowerCase().includes(f));

  const restablecer = async (u: UsuarioPin) => {
    setBusy(u.id);
    setAviso(null);
    try {
      await otSend('/api/bitacora-proceso/pin/restablecer', 'POST', { company: company.idCompany, idUser: u.id });
      const text = `PIN de ${u.name} restablecido. Debe configurarlo de nuevo desde su sesión.`;
      setAviso({ ok: true, text });
      toast.success(text);
      await reload(true);
    } catch (e) {
      setAviso({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Stack gap='md'>
      {aviso && (
        <Alert color={aviso.ok ? 'green' : 'red'} icon={aviso.ok ? <IconCheck size={18} /> : <IconAlertTriangle size={18} />} withCloseButton onClose={() => setAviso(null)} data-testid='ot-pins-aviso'>
          {aviso.text}
        </Alert>
      )}
      <Text size='sm' c='dimmed'>
        Cada supervisor, inspector y jefe de producción configura su propio PIN («Configurar PIN de bitácora», en la pantalla principal del módulo). Aquí solo se ve el estado y se restablece: nadie conoce ni fija el PIN de otra persona.
      </Text>
      <TextInput size='md' placeholder='Buscar persona' leftSection={<IconSearch size={18} />} value={filtro} onChange={(e) => setFiltro(e.currentTarget.value)} />
      {error && <Alert color='red'>{error}</Alert>}
      {loading && !data ? (
        <Loader size='sm' />
      ) : (
        <Stack gap='xs' data-testid='ot-pins'>
          {lista.map((u) => (
            <Card key={u.id} withBorder radius='md' p='sm'>
              <Group justify='space-between' wrap='wrap' gap='xs'>
                <div style={{ minWidth: 0 }}>
                  <Text fw={600} truncate>{u.name}</Text>
                  <Text size='xs' c='dimmed' truncate>{u.email}</Text>
                  {u.configuradoEn && <Text size='xs' c='dimmed'>Configurado el {fmtFechaHora(u.configuradoEn)}</Text>}
                </div>
                <Group gap='xs'>
                  {u.bloqueado ? <Badge color='red' variant='light'>Bloqueado</Badge> : u.configurado ? <Badge color='green' variant='light'>Activo</Badge> : <Badge color='gray' variant='light'>Sin PIN</Badge>}
                  {(u.configurado || u.bloqueado) && (
                    <Button size='md' variant='light' color='red' leftSection={<IconKeyOff size={16} />} loading={busy === u.id} onClick={() => restablecer(u)} data-testid='ot-pin-restablecer'>
                      Restablecer
                    </Button>
                  )}
                </Group>
              </Group>
            </Card>
          ))}
          {lista.length === 0 && <Text c='dimmed'>Sin personas.</Text>}
        </Stack>
      )}
    </Stack>
  );
}
