'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Alert, Anchor, Badge, Button, Card, Group, Loader, SegmentedControl, SimpleGrid, Stack, Tabs, Text, Title } from '@mantine/core';
import { IconAlertTriangle, IconExternalLink, IconFileText, IconLock, IconPresentation } from '@tabler/icons-react';
import SgcSecureViewer from '../sgc/SgcSecureViewer';
import { SGC_BASE_URL } from '../../lib/sgc/constants';
import { ALCANCE_LABEL, CANAL_LABEL, DOCUMENTO_TIPO_LABEL, VITRINA_DOCUMENTO_TIPOS, type VitrinaAlcance, type VitrinaCanal, type VitrinaDocumentoTipo } from '../../lib/vitrina/constants';
import { nombreEmpresaVitrina, registrosDe, tituloPresentacion } from '../../lib/vitrina/catalogo';
import { urlVisorSgc } from '../../lib/vitrina/medios';
import type { Ficha, FichaDocumento } from '../../lib/vitrina/consulta';
import type { CompanyAccess } from './types';
import { CanalBadge, RegistroBadge, VisibilidadBadge } from './VitrinaBadges';
import VitrinaImagen from './VitrinaImagen';
import VitrinaModoPresentacion from './VitrinaModoPresentacion';
import { fmtFecha, useVitrinaFetch } from './vitrinaClient';

/**
 * Ficha de una presentación (vista interna del comercial). Primero el vial y la etiqueta
 * (si no hay imagen: «Imagen pendiente»); luego los datos, la empresa, los países, el
 * canal, el registro sanitario y la exclusividad si aplica. Las pestañas Ficha, Inserto y
 * Prospecto muestran SOLO documentos vigentes del SGC vinculados, en su visor seguro (sin
 * descarga ni impresión); si no hay, «Pendiente de vinculación». Cero contenido clínico propio.
 */
export default function VitrinaFicha({ company, id }: { company: CompanyAccess; id: string }) {
  const { data, error, loading } = useVitrinaFetch<{ ficha: Ficha }>(`/api/vitrina/ficha/${encodeURIComponent(id)}?company=${company.idCompany}`);
  const [presentando, setPresentando] = useState(false);
  const p = data?.ficha ?? null;

  if (loading && !data) {
    return (
      <Group justify='center' py='xl'>
        <Loader />
      </Group>
    );
  }
  if (error || !p) {
    return (
      <Alert color='red' icon={<IconAlertTriangle size={18} />}>
        {error ?? 'No se encontró la presentación.'}
      </Alert>
    );
  }

  const registros = registrosDe(p);

  return (
    <Stack gap='md'>
      <SimpleGrid cols={{ base: 2, md: p.imagenes.PLEGADIZA ? 3 : 2 }} spacing='sm' maw={p.imagenes.PLEGADIZA ? undefined : 720} data-testid='vitrina-ficha-imagenes'>
        <Stack gap={4}>
          <VitrinaImagen id={p.imagenes.VIAL} etiqueta='Vial' />
          <Text size='xs' c='dimmed' ta='center'>
            Vial
          </Text>
        </Stack>
        <Stack gap={4}>
          <VitrinaImagen id={p.imagenes.ETIQUETA} etiqueta='Etiqueta' />
          <Text size='xs' c='dimmed' ta='center'>
            Etiqueta
          </Text>
        </Stack>
        {p.imagenes.PLEGADIZA && (
          <Stack gap={4}>
            <VitrinaImagen id={p.imagenes.PLEGADIZA} etiqueta='Plegadiza' />
            <Text size='xs' c='dimmed' ta='center'>
              Plegadiza
            </Text>
          </Stack>
        )}
      </SimpleGrid>

      <Card withBorder radius='md' p='md'>
        <Stack gap='md'>
          <Group justify='space-between' align='flex-start' wrap='wrap' gap='sm'>
            <div style={{ minWidth: 0 }}>
              {p.familia && (
                <Text size='sm' c='dimmed' tt='uppercase' fw={600}>
                  {p.familia}
                </Text>
              )}
              <Title order={2} size='h3' data-testid='vitrina-ficha-titulo'>
                {tituloPresentacion(p)}
              </Title>
              {p.nombreComercial && <Text>{p.nombreComercial}</Text>}
              <Group gap={6} mt={6}>
                <VisibilidadBadge visibilidad={p.visibilidad} />
                {p.esParaTerceros && (
                  <Badge variant='light' color='grape' size='sm'>
                    Para terceros (solo interno)
                  </Badge>
                )}
              </Group>
            </div>
            <Button size='md' variant='light' leftSection={<IconPresentation size={18} />} onClick={() => setPresentando(true)} w={{ base: '100%', xs: 'auto' }}>
              Presentar
            </Button>
          </Group>
          <SimpleGrid cols={{ base: 2, md: 3 }} spacing='sm'>
            <Dato etiqueta='Molécula' valor={p.molecula} />
            <Dato etiqueta='Concentración' valor={p.concentracion} />
            <Dato etiqueta='Forma farmacéutica' valor={p.formaFarmaceutica} />
            <Dato etiqueta='Unidades por caja' valor={p.unidadesCaja ? String(p.unidadesCaja) : null} />
            <Dato etiqueta='Empresa' valor={nombreEmpresaVitrina(company.idCompany, company.companyName)} />
            <Dato etiqueta='Línea comercial' valor={p.linea} />
            {p.tallMan && <Dato etiqueta='Nombre en Tall Man' valor={p.tallMan} />}
            <Dato etiqueta='Países' valor={p.paises.join(', ') || null} />
            <Dato etiqueta='Canal' valor={p.canales.length ? p.canales.map((c) => CANAL_LABEL[c]).join(', ') : 'Sin dato'} />
          </SimpleGrid>
          <div>
            <Text size='xs' c='dimmed' tt='uppercase' fw={600} mb={4}>
              Grupos terapéuticos
            </Text>
            <Group gap={6}>
              {p.grupos.length ? (
                p.grupos.map((g) => (
                  <Badge key={g} variant='outline' size='md'>
                    {g}
                  </Badge>
                ))
              ) : (
                <Text size='sm' c='dimmed'>
                  Sin grupo terapéutico asignado
                </Text>
              )}
            </Group>
          </div>
          <div>
            <Text size='xs' c='dimmed' tt='uppercase' fw={600} mb={4}>
              Servicios
            </Text>
            <Group gap={6}>
              {p.areas.length ? (
                p.areas.map((a) => (
                  <Badge key={a} variant='light' size='md'>
                    {a}
                  </Badge>
                ))
              ) : (
                <Text size='sm' c='dimmed'>
                  Sin áreas asignadas
                </Text>
              )}
            </Group>
          </div>
        </Stack>
      </Card>

      <Card withBorder radius='md' p='md'>
        <Text fw={600} mb='xs'>
          Registro sanitario
        </Text>
        <Stack gap='xs'>
          {registros.map((r) => (
            <Group key={`${r.numero}-${r.estado}`} justify='space-between' wrap='wrap' gap='xs'>
              <div style={{ minWidth: 0 }}>
                <Text fw={600}>{r.numero ?? 'Sin número en SAP'}</Text>
                <Text size='sm' c='dimmed'>
                  {r.venceEn ? `Vigente hasta ${fmtFecha(`${r.venceEn}T12:00:00Z`)}` : r.estado === 'SIN_FECHA' ? 'Sin vencimiento' : 'Sin fecha de vencimiento en SAP'}
                  {r.paises.length ? ` · ${r.paises.join(', ')}` : ''}
                </Text>
              </div>
              {r.estado && <RegistroBadge estado={r.estado} />}
            </Group>
          ))}
        </Stack>
      </Card>

      {p.exclusividades.length > 0 && (
        <Card withBorder radius='md' p='md' data-testid='vitrina-ficha-exclusividades'>
          <Group gap='xs' mb='xs'>
            <IconLock size={18} aria-hidden />
            <Text fw={600}>Exclusividad</Text>
          </Group>
          <Stack gap='xs'>
            {p.exclusividades.map((e, i) => (
              <div key={i}>
                <Text fw={600}>{e.clienteBeneficiario}</Text>
                <Text size='sm' c='dimmed'>
                  {[
                    ALCANCE_LABEL[e.alcance as VitrinaAlcance] ?? e.alcance,
                    e.pais,
                    e.canal ? `canal ${CANAL_LABEL[e.canal as VitrinaCanal]?.toLowerCase() ?? e.canal}` : null,
                    e.vigenteHasta ? `hasta ${fmtFecha(`${e.vigenteHasta}T12:00:00Z`)}` : 'sin fecha de fin',
                    e.estado === 'FUTURA' ? 'aún no empieza' : e.estado === 'POR_VENCER' ? 'por vencer' : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </div>
            ))}
          </Stack>
        </Card>
      )}

      <Card withBorder radius='md' p='md'>
        <Text fw={600} mb='xs'>
          Códigos SAP (uso interno)
        </Text>
        <Stack gap={6}>
          {p.codigos.map((c) => (
            <Group key={c.itemCode} gap={6} wrap='wrap'>
              <Text size='sm' fw={600}>
                {c.itemCode}
              </Text>
              {c.pais && (
                <Text size='sm' c='dimmed'>
                  {c.pais}
                </Text>
              )}
              <CanalBadge canal={c.canal} />
              <VisibilidadBadge visibilidad={c.visibilidad} />
            </Group>
          ))}
        </Stack>
      </Card>

      <Card withBorder radius='md' p='md'>
        <Documentos documentos={p.documentos} idCompany={company.idCompany} />
      </Card>

      <VitrinaModoPresentacion company={company} opened={presentando} onClose={() => setPresentando(false)} idInicial={p.id} />
    </Stack>
  );
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string | null }) {
  return (
    <div style={{ minWidth: 0 }}>
      <Text size='xs' c='dimmed' tt='uppercase' fw={600}>
        {etiqueta}
      </Text>
      <Text>{valor ?? '—'}</Text>
    </div>
  );
}

function Documentos({ documentos, idCompany }: { documentos: FichaDocumento[]; idCompany: number }) {
  const [tab, setTab] = useState<string | null>('FICHA');
  return (
    <Tabs value={tab} onChange={setTab} keepMounted={false} data-testid='vitrina-ficha-documentos'>
      <Tabs.List mb='md'>
        {VITRINA_DOCUMENTO_TIPOS.map((t) => {
          const n = documentos.filter((d) => d.tipo === t).length;
          return (
            <Tabs.Tab key={t} value={t} leftSection={<IconFileText size={16} />} rightSection={n > 1 ? <Badge size='xs' variant='light'>{n}</Badge> : null}>
              {DOCUMENTO_TIPO_LABEL[t]}
            </Tabs.Tab>
          );
        })}
      </Tabs.List>
      {VITRINA_DOCUMENTO_TIPOS.map((t) => (
        <Tabs.Panel key={t} value={t}>
          <DocumentoTipo tipo={t} docs={documentos.filter((d) => d.tipo === t)} idCompany={idCompany} />
        </Tabs.Panel>
      ))}
    </Tabs>
  );
}

function DocumentoTipo({ tipo, docs, idCompany }: { tipo: VitrinaDocumentoTipo; docs: FichaDocumento[]; idCompany: number }) {
  const [sel, setSel] = useState<string>(docs[0] ? String(docs[0].id) : '');
  const d = docs.find((x) => String(x.id) === sel) ?? docs[0] ?? null;
  if (!d) {
    return (
      <Text c='dimmed' data-testid='vitrina-documento-pendiente'>
        {DOCUMENTO_TIPO_LABEL[tipo]}: pendiente de vinculación. Se mostrará aquí cuando Regulatorios la apruebe en el SGC y un administrador la vincule.
      </Text>
    );
  }
  return (
    <Stack gap='sm'>
      {docs.length > 1 && (
        <SegmentedControl
          fullWidth
          data={docs.map((x) => ({ value: String(x.id), label: [x.pais, x.idioma?.toUpperCase()].filter(Boolean).join(' · ') || x.codigo }))}
          value={String(d.id)}
          onChange={setSel}
        />
      )}
      <Group justify='space-between' wrap='wrap' gap='xs'>
        <div style={{ minWidth: 0 }}>
          <Text fw={600}>
            {d.codigo}
            {d.version ? ` · V${d.version}` : ''}
          </Text>
          <Text size='sm' c='dimmed'>
            {d.titulo}
          </Text>
        </div>
        <Anchor component={Link} href={`${SGC_BASE_URL}/documentos/${d.idDocument}?empresa=${idCompany}`} size='sm'>
          <Group gap={4} wrap='nowrap'>
            <IconExternalLink size={14} />
            Abrir en el SGC
          </Group>
        </Anchor>
      </Group>
      <SgcSecureViewer key={d.id} fileUrl={urlVisorSgc(d.idDocument, d.idVersion)} canDownload={false} canPrint={false} hideDownloadPrint requestAccessHref={`${SGC_BASE_URL}/accesos?empresa=${idCompany}&documento=${d.idDocument}`} />
    </Stack>
  );
}
