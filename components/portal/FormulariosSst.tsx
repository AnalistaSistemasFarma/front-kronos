'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Group, Loader, Paper, Stack, Text } from '@mantine/core';
import { IconAlertCircle, IconCircleCheck, IconClipboardList, IconFileSpreadsheet, IconListDetails, IconPencil, IconPlus, IconShieldLock, IconTrash } from '@tabler/icons-react';
import { COLOR_ESTADO } from '@/lib/theme/estados';
import type { DefinicionFormulario } from '../../lib/portal/formulario';
import EditorFormularioSst, { type InicioEditor } from './EditorFormularioSst';
import { VisorFormulario } from './FormularioPropio';
import PanelRespuestasSst from './PanelRespuestasSst';

/**
 * FORMULARIOS SST (Cristian Baldión, 2026-10-20): los formularios propios de Seguridad y Salud en el Trabajo —«Reporte de actos y
 * condiciones inseguras», «Condiciones de salud y sintomatología osteomuscular» y los que el administrador cree—. Cualquier persona con
 * sesión los puede abrir y enviar (varias veces: cada reporte es nuevo); el administrador y los lectores SST, además, ven las respuestas
 * y las exportan a Excel. SOLO el administrador crea, edita y retira formularios, con el mismo constructor visual de Formación. Cada
 * envío se guarda en SharePoint (`FORMULARIOS SST`). Mismo estilo y componentes de Mantine que Formación; los avisos van ARRIBA y con color.
 */

interface Item {
  codigo: string;
  titulo: string;
  descripcion: string | null;
  datosSensibles: boolean;
  origen: 'base' | 'personalizado';
}

export default function FormulariosSst({ onSinSesion }: { onSinSesion?: () => void }) {
  const [lista, setLista] = useState<Item[] | null>(null);
  const [puedeVer, setPuedeVer] = useState(false);
  const [puedeAdministrar, setPuedeAdministrar] = useState(false);
  const [definiciones, setDefiniciones] = useState<Record<string, DefinicionFormulario> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [abierto, setAbierto] = useState<Item | null>(null);
  const [respuestas, setRespuestas] = useState<Item | null>(null);
  const [editor, setEditor] = useState<InicioEditor | null>(null);
  const [retirando, setRetirando] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/portal/formularios-sst', { cache: 'no-store' });
      if (res.status === 401) return onSinSesion?.();
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(String(data.error ?? 'No se pudieron cargar los formularios.'));
      setLista(Array.isArray(data.formularios) ? (data.formularios as Item[]) : []);
      setPuedeVer(data.puedeVerRespuestas === true);
      const admin = data.puedeAdministrar === true;
      setPuedeAdministrar(admin);
      if (admin) {
        // Las definiciones completas (para editar) solo las entrega el servidor al administrador.
        const r = await fetch('/api/portal/formularios-sst/definiciones', { cache: 'no-store' });
        const d = (await r.json().catch(() => ({}))) as { error?: unknown; formularios?: { codigo: string; definicion: DefinicionFormulario }[] };
        if (!r.ok) throw new Error(String(d.error ?? 'No se pudieron cargar los formularios para editar.'));
        setDefiniciones(Object.fromEntries((d.formularios ?? []).map((f) => [f.codigo, f.definicion])));
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }, [onSinSesion]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const cerrarFormulario = useCallback(() => setAbierto(null), []);
  const cerrarRespuestas = useCallback(() => setRespuestas(null), []);

  const retirar = async (f: Item) => {
    setTrabajando(true);
    setError(null);
    setAviso(null);
    try {
      const res = await fetch(`/api/portal/formularios-sst/definiciones?codigo=${encodeURIComponent(f.codigo)}`, { method: 'DELETE' });
      const data = (await res.json().catch(() => ({}))) as { error?: unknown };
      if (!res.ok) throw new Error(String(data.error ?? 'No se pudo retirar el formulario.'));
      setRetirando(null);
      setAviso(`Formulario retirado: ${f.titulo}. Sus respuestas y versiones se conservan en SharePoint.`);
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTrabajando(false);
    }
  };

  return (
    <Stack gap='md' data-testid='formularios-sst'>
      {/* Avisos ARRIBA y con color. */}
      {aviso && (
        <Alert color={COLOR_ESTADO.exito} icon={<IconCircleCheck size={18} />} role='status' withCloseButton onClose={() => setAviso(null)} data-testid='formularios-sst-aviso'>
          {aviso}
        </Alert>
      )}
      {error && (
        <Alert color={COLOR_ESTADO.error} icon={<IconAlertCircle size={18} />} role='alert' data-testid='formularios-sst-error'>
          <Group justify='space-between' gap='sm' wrap='nowrap'>
            <Text inherit>{error}</Text>
            <Button size='xs' variant='light' onClick={() => void cargar()}>
              Reintentar
            </Button>
          </Group>
        </Alert>
      )}
      {!lista && !error && (
        <Group gap='xs'>
          <Loader size='sm' />
          <Text size='sm' c='dimmed'>
            Cargando formularios…
          </Text>
        </Group>
      )}

      {puedeAdministrar && !editor && (
        <Paper withBorder radius='md' p='md' data-testid='administrar-formularios-sst'>
          <Group justify='space-between' gap='md' wrap='wrap'>
            <div>
              <Text fw={600}>Administrar formularios</Text>
              <Text size='sm' c='dimmed'>
                Cree formularios nuevos o edite los existentes. Cada cambio guarda una versión nueva; nada se borra.
              </Text>
            </div>
            <Button leftSection={<IconPlus size={16} />} onClick={() => { setAviso(null); setEditor({ nuevo: true }); }} data-testid='crear-formulario-sst'>
              Crear formulario
            </Button>
          </Group>
        </Paper>
      )}

      {editor && (
        <EditorFormularioSst
          inicio={editor}
          onCerrar={(guardado) => {
            setEditor(null);
            if (guardado) {
              setAviso(guardado.nuevo ? `Formulario creado: ${guardado.titulo}.` : `Versión nueva guardada: ${guardado.titulo}.`);
              void cargar();
            }
          }}
        />
      )}

      {!editor &&
        lista?.map((f) => (
          <Paper key={f.codigo} withBorder radius='md' p='md' data-testid={`formulario-sst-${f.codigo}`}>
            <Stack gap='xs'>
              <Text fw={700} fz='lg' role='heading' aria-level={3}>
                {f.titulo}
              </Text>
              {f.descripcion && (
                <Text size='sm' c='dimmed' lineClamp={4}>
                  {f.descripcion}
                </Text>
              )}
              {f.datosSensibles && (
                <Alert color={COLOR_ESTADO.advertencia} icon={<IconShieldLock size={18} />} p='xs'>
                  Pide datos de salud: le pedirá su autorización para tratarlos.
                </Alert>
              )}
              <Group gap='sm' wrap='wrap'>
                <Button leftSection={<IconClipboardList size={16} />} onClick={() => setAbierto(f)} data-testid={`abrir-sst-${f.codigo}`}>
                  Abrir formulario
                </Button>
                {puedeVer && (
                  <>
                    <Button variant='light' leftSection={<IconListDetails size={16} />} onClick={() => setRespuestas(f)} data-testid={`ver-respuestas-sst-${f.codigo}`}>
                      Ver respuestas
                    </Button>
                    <Button
                      variant='light'
                      component='a'
                      href={`/api/portal/formularios-sst/${encodeURIComponent(f.codigo)}/respuestas/excel`}
                      leftSection={<IconFileSpreadsheet size={16} />}
                      data-testid={`excel-sst-${f.codigo}`}
                    >
                      Exportar a Excel
                    </Button>
                  </>
                )}
                {puedeAdministrar && (
                  <Button
                    variant='default'
                    leftSection={<IconPencil size={16} />}
                    disabled={!definiciones?.[f.codigo]}
                    onClick={() => {
                      const d = definiciones?.[f.codigo];
                      if (d) {
                        setAviso(null);
                        setEditor({ nuevo: false, definicion: d });
                      }
                    }}
                    data-testid={`editar-sst-${f.codigo}`}
                  >
                    Editar
                  </Button>
                )}
                {puedeAdministrar &&
                  f.origen === 'personalizado' &&
                  (retirando === f.codigo ? (
                    <Group gap='xs' wrap='nowrap'>
                      <Button color='red' leftSection={<IconTrash size={16} />} loading={trabajando} onClick={() => void retirar(f)} data-testid={`confirmar-retirar-sst-${f.codigo}`}>
                        Retirar este formulario
                      </Button>
                      <Button variant='default' disabled={trabajando} onClick={() => setRetirando(null)}>
                        No
                      </Button>
                    </Group>
                  ) : (
                    <Button variant='default' color='red' leftSection={<IconTrash size={16} />} onClick={() => setRetirando(f.codigo)} data-testid={`retirar-sst-${f.codigo}`}>
                      Retirar
                    </Button>
                  ))}
              </Group>
            </Stack>
          </Paper>
        ))}

      {abierto && <VisorFormulario rutaApi={`/api/portal/formularios-sst/${encodeURIComponent(abierto.codigo)}`} titulo={abierto.titulo} onCerrar={cerrarFormulario} />}
      {respuestas && <PanelRespuestasSst codigo={respuestas.codigo} titulo={respuestas.titulo} onCerrar={cerrarRespuestas} />}
    </Stack>
  );
}
