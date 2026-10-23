'use client';

import { useCallback, useState } from 'react';
import { Alert, Badge, Button, Card, FileButton, Group, List, Stack, Tabs, Text } from '@mantine/core';
import { IconAlertTriangle, IconCheck, IconFileImport, IconHistory, IconInbox, IconLock, IconMapPin, IconPackages, IconRefresh, IconBell } from '@tabler/icons-react';
import toast from 'react-hot-toast';
import type { CompanyAccess, Alerta } from './types';
import { errorTexto, haceCuanto, useVitrinaFetch, vitrinaSend, type Aviso } from './vitrinaClient';
import VitrinaBandeja from './VitrinaBandeja';
import VitrinaPresentaciones from './VitrinaPresentaciones';
import VitrinaExclusividades from './VitrinaExclusividades';
import VitrinaAlertas from './VitrinaAlertas';
import VitrinaAreas from './VitrinaAreas';
import VitrinaHistorial from './VitrinaHistorial';

/**
 * «Vitrina Comercial · Gestión» (sprint V2). Arriba, el resultado de cada acción
 * (verde o rojo) y la lectura de SAP («Actualizar ahora» e importación de la carga
 * inicial como sugerencia). Debajo, las pestañas de trabajo. Nada se publica solo:
 * cada código se activa a mano.
 */
export default function VitrinaGestion({ company }: { company: CompanyAccess }) {
  const [aviso, setAviso] = useState<Aviso>(null);
  const [detalle, setDetalle] = useState<string[]>([]);
  const [version, setVersion] = useState(0);
  const [tab, setTab] = useState<string | null>('bandeja');
  const [leyendo, setLeyendo] = useState(false);
  const [importando, setImportando] = useState(false);
  const alertas = useVitrinaFetch<{ alertas: Alerta[]; ultimaLectura: string | null }>(`/api/vitrina/gestion/alertas?company=${company.idCompany}&v=${version}`);

  const avisar = useCallback((ok: boolean, text: string, lista: string[] = []) => {
    setAviso({ ok, text });
    setDetalle(lista);
    if (ok) toast.success(text);
    else toast.error(text);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);
  const refrescar = useCallback(() => setVersion((v) => v + 1), []);
  const avisarYRefrescar = useCallback(
    (ok: boolean, text: string) => {
      avisar(ok, text);
      if (ok) refrescar();
    },
    [avisar, refrescar]
  );

  const actualizarAhora = async () => {
    setLeyendo(true);
    try {
      const r = await vitrinaSend<{ texto: string }>('/api/vitrina/gestion/sincronizar', 'POST', { company: company.idCompany });
      avisar(true, `Lectura de SAP terminada. ${r.texto}`);
      refrescar();
    } catch (e) {
      avisar(false, errorTexto(e));
    } finally {
      setLeyendo(false);
    }
  };

  const importar = async (file: File | null) => {
    if (!file) return;
    setImportando(true);
    try {
      const csv = await file.text();
      const r = await vitrinaSend<{ filas: number; creados: number; actualizados: number; errores: string[] }>('/api/vitrina/gestion/semilla', 'POST', { company: company.idCompany, csv });
      avisar(
        true,
        `Carga inicial importada como sugerencia: ${r.filas} filas, ${r.creados} códigos nuevos en la bandeja y ${r.actualizados} con sugerencia actualizada. No se activó nada.`,
        r.errores.slice(0, 20)
      );
      refrescar();
    } catch (e) {
      avisar(false, errorTexto(e));
    } finally {
      setImportando(false);
    }
  };

  const numAlertas = alertas.data?.alertas.filter((a) => a.nivel === 'alerta').length ?? 0;
  const ultima = alertas.data?.ultimaLectura ?? null;

  return (
    <Stack gap='md'>
      {aviso && (
        <Alert
          color={aviso.ok ? 'green' : 'red'}
          icon={aviso.ok ? <IconCheck size={18} /> : <IconAlertTriangle size={18} />}
          withCloseButton
          onClose={() => setAviso(null)}
          data-testid='vitrina-aviso'
        >
          <Text size='sm'>{aviso.text}</Text>
          {detalle.length > 0 && (
            <List size='sm' mt='xs' spacing={2}>
              {detalle.map((d) => (
                <List.Item key={d}>{d}</List.Item>
              ))}
            </List>
          )}
        </Alert>
      )}

      <Card withBorder radius='md' p='md'>
        <Group justify='space-between' align='center' wrap='wrap' gap='sm'>
          <div style={{ minWidth: 0 }}>
            <Text fw={600}>Lectura de SAP (solo lectura)</Text>
            <Text size='sm' c='dimmed'>
              {ultima ? `Última lectura ${haceCuanto(ultima)}. Se actualiza sola cada noche.` : 'Aún no se ha leído SAP para esta empresa. Se actualiza sola cada noche.'}
            </Text>
          </div>
          <Group gap='sm' grow w={{ base: '100%', sm: 'auto' }}>
            <FileButton onChange={importar} accept='.csv,text/csv'>
              {(props) => (
                <Button {...props} variant='default' size='md' leftSection={<IconFileImport size={18} />} loading={importando} data-testid='vitrina-importar'>
                  Importar carga inicial
                </Button>
              )}
            </FileButton>
            <Button size='md' leftSection={<IconRefresh size={18} />} onClick={actualizarAhora} loading={leyendo} data-testid='vitrina-actualizar'>
              Actualizar ahora
            </Button>
          </Group>
        </Group>
      </Card>

      <Tabs value={tab} onChange={setTab} keepMounted={false} variant='outline' radius='md'>
        <Tabs.List mb='md'>
          <Tabs.Tab value='bandeja' leftSection={<IconInbox size={18} />} data-testid='vitrina-tab-bandeja'>
            Bandeja
          </Tabs.Tab>
          <Tabs.Tab value='presentaciones' leftSection={<IconPackages size={18} />} data-testid='vitrina-tab-presentaciones'>
            Presentaciones
          </Tabs.Tab>
          <Tabs.Tab value='exclusividades' leftSection={<IconLock size={18} />} data-testid='vitrina-tab-exclusividades'>
            Exclusividades
          </Tabs.Tab>
          <Tabs.Tab
            value='alertas'
            leftSection={<IconBell size={18} />}
            rightSection={numAlertas > 0 ? <Badge color='red' variant='light' size='sm'>{numAlertas}</Badge> : null}
            data-testid='vitrina-tab-alertas'
          >
            Alertas
          </Tabs.Tab>
          <Tabs.Tab value='areas' leftSection={<IconMapPin size={18} />} data-testid='vitrina-tab-areas'>
            Áreas
          </Tabs.Tab>
          <Tabs.Tab value='historial' leftSection={<IconHistory size={18} />} data-testid='vitrina-tab-historial'>
            Historial
          </Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value='bandeja'>
          <VitrinaBandeja company={company} version={version} avisar={avisarYRefrescar} />
        </Tabs.Panel>
        <Tabs.Panel value='presentaciones'>
          <VitrinaPresentaciones company={company} version={version} avisar={avisarYRefrescar} />
        </Tabs.Panel>
        <Tabs.Panel value='exclusividades'>
          <VitrinaExclusividades company={company} version={version} avisar={avisarYRefrescar} />
        </Tabs.Panel>
        <Tabs.Panel value='alertas'>
          <VitrinaAlertas alertas={alertas.data?.alertas ?? null} error={alertas.error} loading={alertas.loading} />
        </Tabs.Panel>
        <Tabs.Panel value='areas'>
          <VitrinaAreas company={company} version={version} avisar={avisarYRefrescar} />
        </Tabs.Panel>
        <Tabs.Panel value='historial'>
          <VitrinaHistorial company={company} version={version} />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
