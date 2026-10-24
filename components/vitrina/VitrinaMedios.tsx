'use client';

import { useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Card, FileButton, Group, Loader, SegmentedControl, SimpleGrid, Stack, Switch, Text, TextInput } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconAlertTriangle, IconLink, IconLinkOff, IconPhotoUp, IconSearch, IconStar, IconTrash } from '@tabler/icons-react';
import SgcSelect from '../sgc/SgcSelect';
import {
  DOCUMENTO_TIPO_LABEL,
  IMAGEN_TIPO_LABEL,
  VITRINA_DOCUMENTO_TIPOS,
  VITRINA_IMAGEN_ACCEPT,
  VITRINA_IMAGEN_MAX_BYTES,
  VITRINA_LIMITS,
  VITRINA_MAX_DESTACADAS,
  type VitrinaDocumentoTipo,
  type VitrinaImagenTipo,
} from '../../lib/vitrina/constants';
import type { CompanyAccess, Presentacion } from './types';
import { EstadoBadge } from './VitrinaBadges';
import VitrinaImagen from './VitrinaImagen';
import { errorTexto, fmtFechaHora, nombrePresentacion, useVitrinaFetch, vitrinaSend, type Avisar } from './vitrinaClient';

/**
 * Gestión · Imágenes y documentos (V3). Por presentación:
 *   - imágenes de VIAL, ETIQUETA y PLEGADIZA en el almacenamiento de adjuntos de SynerLink
 *     (una nueva reemplaza la vigente del mismo tipo; la anterior queda en el historial);
 *   - marcar como destacada (el Inicio de los comerciales muestra hasta 3);
 *   - vínculos con documentos VIGENTES del SGC (ficha, inserto, prospecto), que se ven en
 *     el visor seguro del SGC, sin descarga.
 */
interface Medios {
  destacada: boolean;
  estado: string;
  imagenes: { tipo: VitrinaImagenTipo; vigente: { id: number; version: string | null; cargadoEn: string } | null; anteriores: number }[];
  documentos: {
    id: number;
    tipo: string;
    idioma: string | null;
    pais: string | null;
    idDocument: number;
    codigo: string | null;
    titulo: string | null;
    estadoSgc: string | null;
    mostrable: boolean;
    motivo: string | null;
  }[];
}

interface DocSgc {
  idDocument: number;
  codigo: string;
  titulo: string;
  tipoDocumental: string;
}

export default function VitrinaMedios({
  company,
  version,
  avisar,
  idPresentacion,
  onPresentacion,
}: {
  company: CompanyAccess;
  version: number;
  avisar: Avisar;
  idPresentacion: number | null;
  onPresentacion: (id: number | null) => void;
}) {
  const lista = useVitrinaFetch<{ presentaciones: Presentacion[] }>(`/api/vitrina/gestion/presentaciones?company=${company.idCompany}&v=${version}`);
  const presentaciones = useMemo(() => (lista.data?.presentaciones ?? []).filter((p) => p.estado !== 'RETIRADA'), [lista.data]);
  const destacadas = presentaciones.filter((p) => p.destacada).length;
  const actual = presentaciones.find((p) => p.id === idPresentacion) ?? null;

  return (
    <Stack gap='md'>
      {lista.error && (
        <Alert color='red' icon={<IconAlertTriangle size={18} />}>
          {lista.error}
        </Alert>
      )}
      <Card withBorder radius='md' p='md'>
        <SgcSelect
          label='Presentación'
          size='md'
          placeholder={lista.loading ? 'Cargando…' : 'Elija la presentación'}
          searchable
          data={presentaciones.map((p) => ({ value: String(p.id), label: nombrePresentacion(p) }))}
          value={idPresentacion ? String(idPresentacion) : null}
          onChange={(v) => onPresentacion(v ? Number(v) : null)}
          nothingFoundMessage='Ninguna presentación coincide'
          data-testid='vitrina-medios-presentacion'
        />
        <Text size='xs' c='dimmed' mt={6}>
          {destacadas} de {VITRINA_MAX_DESTACADAS} destacadas en el Inicio de los comerciales
          {destacadas > VITRINA_MAX_DESTACADAS ? ': solo se muestran las 3 primeras de la biblioteca' : ''}.
        </Text>
      </Card>
      {actual ? (
        <Detalle key={`${actual.id}-${version}`} company={company} presentacion={actual} avisar={avisar} />
      ) : (
        <Card withBorder radius='md' p='lg'>
          <Text c='dimmed'>Elija una presentación para cargar sus imágenes de empaque y vincular sus documentos del SGC.</Text>
        </Card>
      )}
    </Stack>
  );
}

function Detalle({ company, presentacion, avisar }: { company: CompanyAccess; presentacion: Presentacion; avisar: Avisar }) {
  const url = `/api/vitrina/gestion/medios?company=${company.idCompany}&presentacion=${presentacion.id}`;
  const { data, error, loading, reload } = useVitrinaFetch<Medios>(url);
  const [busy, setBusy] = useState<string | null>(null);

  const accion = async (clave: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(clave);
    try {
      await fn();
      avisar(true, ok);
      await reload(true);
    } catch (e) {
      avisar(false, errorTexto(e));
    } finally {
      setBusy(null);
    }
  };

  const subir = (tipo: VitrinaImagenTipo, file: File | null) => {
    if (!file) return;
    if (file.size > VITRINA_IMAGEN_MAX_BYTES) {
      avisar(false, 'La imagen supera el tamaño máximo (10 MB).');
      return;
    }
    const fd = new FormData();
    fd.set('company', String(company.idCompany));
    fd.set('presentacion', String(presentacion.id));
    fd.set('tipo', tipo);
    fd.set('archivo', file);
    void accion(
      `img-${tipo}`,
      async () => {
        const res = await fetch('/api/vitrina/gestion/imagenes', { method: 'POST', body: fd });
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(body.error || (res.status === 413 ? 'La imagen supera el tamaño que admite el servidor.' : `Error ${res.status}`));
      },
      `Imagen de ${IMAGEN_TIPO_LABEL[tipo].toLowerCase()} cargada.`
    );
  };

  if (loading && !data) {
    return (
      <Group justify='center' py='lg'>
        <Loader />
      </Group>
    );
  }
  if (error || !data) {
    return (
      <Alert color='red' icon={<IconAlertTriangle size={18} />}>
        {error ?? 'No se pudo cargar.'}
      </Alert>
    );
  }

  return (
    <Stack gap='md' data-testid='vitrina-medios'>
      <Card withBorder radius='md' p='md'>
        <Group justify='space-between' wrap='wrap' gap='sm'>
          <div style={{ minWidth: 0 }}>
            <Text fw={600}>{nombrePresentacion(presentacion)}</Text>
            <Group gap={6} mt={4}>
              <EstadoBadge estado={presentacion.estado} />
              {data.destacada && (
                <Badge variant='light' size='sm' leftSection={<IconStar size={12} />}>
                  Destacada
                </Badge>
              )}
            </Group>
          </div>
          <Switch
            size='md'
            label='Destacada en el Inicio'
            checked={data.destacada}
            disabled={busy === 'destacada'}
            onChange={(e) => {
              const v = e.currentTarget.checked;
              void accion('destacada', () => vitrinaSend(`/api/vitrina/gestion/presentaciones/${presentacion.id}`, 'PATCH', { company: company.idCompany, destacada: v }), v ? 'Presentación marcada como destacada.' : 'Ya no es destacada.');
            }}
            data-testid='vitrina-medios-destacada'
          />
        </Group>
      </Card>

      <Card withBorder radius='md' p='md'>
        <Text fw={600}>Imágenes de empaque</Text>
        <Text size='sm' c='dimmed' mb='sm'>
          PNG, JPG o WEBP de hasta 10 MB. En la ficha se muestran primero el vial y la etiqueta.
        </Text>
        <SimpleGrid cols={{ base: 1, xs: 3 }} spacing='md'>
          {data.imagenes.map((img) => (
            <Stack key={img.tipo} gap='xs' data-testid={`vitrina-medios-${img.tipo.toLowerCase()}`}>
              <Text fw={600} size='sm'>
                {IMAGEN_TIPO_LABEL[img.tipo]}
              </Text>
              <VitrinaImagen id={img.vigente?.id ?? null} etiqueta={IMAGEN_TIPO_LABEL[img.tipo]} ratio={4 / 3} />
              <Text size='xs' c='dimmed'>
                {img.vigente ? `Versión ${img.vigente.version ?? '1'} · ${fmtFechaHora(img.vigente.cargadoEn)}` : 'Sin imagen cargada'}
                {img.anteriores ? ` · ${img.anteriores} anterior(es)` : ''}
              </Text>
              <Group gap='xs' grow>
                <FileButton accept={VITRINA_IMAGEN_ACCEPT} onChange={(f) => subir(img.tipo, f)}>
                  {(props) => (
                    <Button {...props} size='sm' variant={img.vigente ? 'default' : 'filled'} leftSection={<IconPhotoUp size={16} />} loading={busy === `img-${img.tipo}`}>
                      {img.vigente ? 'Reemplazar' : 'Cargar'}
                    </Button>
                  )}
                </FileButton>
                {img.vigente && (
                  <Button
                    size='sm'
                    variant='light'
                    color='red'
                    leftSection={<IconTrash size={16} />}
                    loading={busy === `del-${img.tipo}`}
                    onClick={() => accion(`del-${img.tipo}`, () => vitrinaSend(`/api/vitrina/gestion/imagenes/${img.vigente!.id}?company=${company.idCompany}`, 'DELETE'), `Imagen de ${IMAGEN_TIPO_LABEL[img.tipo].toLowerCase()} retirada.`)}
                  >
                    Retirar
                  </Button>
                )}
              </Group>
            </Stack>
          ))}
        </SimpleGrid>
      </Card>

      <Card withBorder radius='md' p='md'>
        <Text fw={600}>Documentos del SGC</Text>
        <Text size='sm' c='dimmed' mb='sm'>
          Se enlazan (no se copian) solo documentos vigentes del SGC de {company.companyName.trim()}; los comerciales los ven en el visor del SGC, sin descarga.
        </Text>
        <Stack gap='xs' mb='md'>
          {data.documentos.length === 0 && (
            <Text size='sm' c='dimmed'>
              Sin documentos vinculados: la ficha muestra «pendiente de vinculación».
            </Text>
          )}
          {data.documentos.map((d) => (
            <Card key={d.id} withBorder radius='md' p='sm' data-testid='vitrina-medios-documento'>
              <Group justify='space-between' wrap='nowrap' align='flex-start' gap='sm'>
                <div style={{ minWidth: 0 }}>
                  <Group gap={6} wrap='wrap'>
                    <Badge variant='light' size='sm'>
                      {DOCUMENTO_TIPO_LABEL[d.tipo as VitrinaDocumentoTipo] ?? d.tipo}
                    </Badge>
                    <Text fw={600} size='sm'>
                      {d.codigo ?? `Documento ${d.idDocument}`}
                    </Text>
                    {(d.pais || d.idioma) && (
                      <Text size='xs' c='dimmed'>
                        {[d.pais, d.idioma?.toUpperCase()].filter(Boolean).join(' · ')}
                      </Text>
                    )}
                  </Group>
                  {d.titulo && (
                    <Text size='sm' lineClamp={2}>
                      {d.titulo}
                    </Text>
                  )}
                  {!d.mostrable && (
                    <Text size='xs' c='red' mt={2}>
                      {d.motivo}
                    </Text>
                  )}
                </div>
                <Button
                  size='compact-sm'
                  variant='subtle'
                  color='red'
                  style={{ flexShrink: 0 }}
                  leftSection={<IconLinkOff size={14} />}
                  loading={busy === `doc-${d.id}`}
                  onClick={() => accion(`doc-${d.id}`, () => vitrinaSend(`/api/vitrina/gestion/documentos/${d.id}?company=${company.idCompany}`, 'DELETE'), 'Vínculo retirado. El documento sigue intacto en el SGC.')}
                >
                  Quitar
                </Button>
              </Group>
            </Card>
          ))}
        </Stack>
        <BuscarDocumento company={company} idPresentacion={presentacion.id} onVinculado={(t) => {
          avisar(true, t);
          void reload(true);
        }} onError={(t) => avisar(false, t)} />
      </Card>
    </Stack>
  );
}

function BuscarDocumento({ company, idPresentacion, onVinculado, onError }: { company: CompanyAccess; idPresentacion: number; onVinculado: (t: string) => void; onError: (t: string) => void }) {
  const [tipo, setTipo] = useState<VitrinaDocumentoTipo>('FICHA');
  const [q, setQ] = useState('');
  const [idioma, setIdioma] = useState<string | null>('es');
  const [pais, setPais] = useState('');
  const [busy, setBusy] = useState<number | null>(null);
  const [qd] = useDebouncedValue(q.trim(), 300);
  const { data, loading, error } = useVitrinaFetch<{ documentos: DocSgc[]; sgcActivo: boolean }>(qd.length >= 2 ? `/api/vitrina/gestion/documentos-sgc?company=${company.idCompany}&q=${encodeURIComponent(qd)}` : null);
  const [ultimo, setUltimo] = useState<{ documentos: DocSgc[]; sgcActivo: boolean } | null>(null);
  useEffect(() => {
    if (data) setUltimo(data);
  }, [data]);
  const res = qd.length >= 2 ? ultimo : null;

  const vincular = async (d: DocSgc) => {
    setBusy(d.idDocument);
    try {
      await vitrinaSend('/api/vitrina/gestion/documentos', 'POST', { company: company.idCompany, id_presentacion: idPresentacion, id_document: d.idDocument, tipo, idioma, pais });
      onVinculado(`${d.codigo} vinculado como ${DOCUMENTO_TIPO_LABEL[tipo].toLowerCase()}.`);
    } catch (e) {
      onError(errorTexto(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Stack gap='sm'>
      <Text fw={600} size='sm'>
        Vincular un documento
      </Text>
      <SegmentedControl fullWidth size='md' data={VITRINA_DOCUMENTO_TIPOS.map((t) => ({ value: t, label: DOCUMENTO_TIPO_LABEL[t] }))} value={tipo} onChange={(v) => setTipo(v as VitrinaDocumentoTipo)} data-testid='vitrina-medios-tipo-doc' />
      <SimpleGrid cols={{ base: 2 }} spacing='sm'>
        <SgcSelect
          size='md'
          label='Idioma'
          data={[
            { value: 'es', label: 'Español' },
            { value: 'en', label: 'Inglés' },
            { value: 'pt', label: 'Portugués' },
          ]}
          value={idioma}
          onChange={setIdioma}
          clearable
        />
        <TextInput size='md' label='País (opcional)' value={pais} onChange={(e) => setPais(e.currentTarget.value)} maxLength={VITRINA_LIMITS.pais} />
      </SimpleGrid>
      <TextInput
        size='md'
        placeholder='Buscar por código o título en el SGC'
        leftSection={<IconSearch size={18} />}
        rightSection={loading ? <Loader size='xs' /> : null}
        value={q}
        onChange={(e) => setQ(e.currentTarget.value)}
        data-testid='vitrina-medios-buscar-doc'
      />
      {error && (
        <Alert color='red' icon={<IconAlertTriangle size={18} />}>
          {error}
        </Alert>
      )}
      {res && !res.sgcActivo && (
        <Alert color='yellow' variant='light' icon={<IconAlertTriangle size={18} />}>
          El SGC documental no está activo para esta empresa: aún no hay documentos para vincular.
        </Alert>
      )}
      {res && res.sgcActivo && res.documentos.length === 0 && (
        <Text size='sm' c='dimmed'>
          Ningún documento vigente coincide.
        </Text>
      )}
      {res?.documentos.map((d) => (
        <Card key={d.idDocument} withBorder radius='md' p='sm' data-testid='vitrina-medios-resultado'>
          <Group justify='space-between' wrap='nowrap' gap='sm'>
            <div style={{ minWidth: 0 }}>
              <Text fw={600} size='sm'>
                {d.codigo}
              </Text>
              <Text size='sm' lineClamp={2}>
                {d.titulo}
              </Text>
              <Text size='xs' c='dimmed'>
                {d.tipoDocumental} · vigente
              </Text>
            </div>
            <Button size='sm' style={{ flexShrink: 0 }} leftSection={<IconLink size={16} />} loading={busy === d.idDocument} onClick={() => vincular(d)}>
              Vincular
            </Button>
          </Group>
        </Card>
      ))}
    </Stack>
  );
}
