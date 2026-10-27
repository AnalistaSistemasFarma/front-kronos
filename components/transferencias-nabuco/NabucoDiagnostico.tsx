'use client';

import { Accordion, Alert, Badge, Button, Code, CopyButton, Group, ScrollArea, Stack, Text } from '@mantine/core';
import { IconCheck, IconCopy } from '@tabler/icons-react';
import { leerDiagnostico, type DiagnosticoNabuco, type EtapaDiagnostico } from '../../lib/transferencias-nabuco/diagnostico';

const ETAPA_LABEL: Record<EtapaDiagnostico, string> = {
  validacion: 'Validación',
  red: 'Red',
  autenticacion: 'Autenticación',
  envio: 'Envío',
  respuesta: 'Respuesta',
  sap: 'SAP',
  interno: 'Interno',
};

function color(d: DiagnosticoNabuco): string {
  if (d.ok) return 'green';
  if (d.etapa === 'validacion') return 'yellow';
  if (d.etapa === 'red' || d.etapa === 'sap') return 'orange';
  return 'red';
}

function bloque(t: string | undefined | null): string {
  if (!t) return '—';
  try {
    return JSON.stringify(JSON.parse(t), null, 2);
  } catch {
    return t;
  }
}

function cabeceras(h: Record<string, string> | undefined): string {
  const e = Object.entries(h ?? {});
  return e.length ? e.map(([k, v]) => `${k}: ${v}`).join('\n') : '(ninguna)';
}

/** Diagnóstico técnico de Nabuco/SAP/SynerLink: mensaje, sugerencia, badges y detalle (petición/respuesta) copiable. */
export default function NabucoDiagnostico({ diagnostico: d, titulo }: { diagnostico: DiagnosticoNabuco; titulo?: string }) {
  return (
    <Stack gap='xs'>
      <Alert color={color(d)} title={titulo ?? (d.ok ? 'OK' : `Falló en: ${ETAPA_LABEL[d.etapa] ?? d.etapa}`)}>
        <Text size='sm' style={{ whiteSpace: 'pre-wrap' }}>
          {d.mensaje}
        </Text>
        {d.detalle && (
          <Text size='sm' mt={4} c='dimmed' style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {d.detalle}
          </Text>
        )}
        {d.sugerencia && (
          <Text size='sm' mt={6} fw={600}>
            {`Sugerencia: ${d.sugerencia}`}
          </Text>
        )}
      </Alert>
      <Group gap='xs' wrap='wrap'>
        <Badge variant='light' color={color(d)}>{`Etapa: ${ETAPA_LABEL[d.etapa] ?? d.etapa}`}</Badge>
        {d.respuesta && <Badge variant='light' color={d.respuesta.http_status < 300 ? 'green' : 'red'}>{`HTTP Nabuco/SAP ${d.respuesta.http_status}${d.respuesta.status_text ? ` ${d.respuesta.status_text}` : ''}`}</Badge>}
        {d.http_synerlink && <Badge variant='light' color='grape'>{`HTTP SynerLink ${d.http_synerlink}`}</Badge>}
        {d.red && <Badge variant='light' color='orange'>{`Red: ${d.red.codigo}`}</Badge>}
        <Badge variant='light' color='gray'>{`${d.duracion_ms} ms`}</Badge>
        {d.cuando && <Badge variant='outline' color='gray'>{d.cuando}</Badge>}
        <CopyButton value={JSON.stringify(d, null, 2)}>
          {({ copied, copy }) => (
            <Button size='compact-xs' variant='subtle' leftSection={copied ? <IconCheck size={14} /> : <IconCopy size={14} />} onClick={copy}>
              {copied ? 'Copiado' : 'Copiar diagnóstico'}
            </Button>
          )}
        </CopyButton>
      </Group>
      {(d.peticion || d.respuesta || d.red) && (
        <Accordion variant='contained'>
          <Accordion.Item value='detalle'>
            <Accordion.Control>Detalle técnico</Accordion.Control>
            <Accordion.Panel>
              <Stack gap='xs'>
                {d.peticion && (
                  <>
                    <Text fw={600} size='sm'>
                      Petición
                    </Text>
                    <Code block>{`${d.peticion.metodo} ${d.peticion.url}\n${cabeceras(d.peticion.cabeceras)}`}</Code>
                    {d.peticion.cuerpo && (
                      <ScrollArea.Autosize mah={240}>
                        <Code block>{bloque(d.peticion.cuerpo)}</Code>
                      </ScrollArea.Autosize>
                    )}
                  </>
                )}
                {d.respuesta && (
                  <>
                    <Text fw={600} size='sm'>
                      Respuesta
                    </Text>
                    <Code block>{`HTTP ${d.respuesta.http_status} ${d.respuesta.status_text}\n${cabeceras(d.respuesta.cabeceras)}`}</Code>
                    <ScrollArea.Autosize mah={320}>
                      <Code block>{d.respuesta.cuerpo_json !== undefined ? JSON.stringify(d.respuesta.cuerpo_json, null, 2) : d.respuesta.cuerpo_crudo || '(cuerpo vacío)'}</Code>
                    </ScrollArea.Autosize>
                  </>
                )}
                {d.red && (
                  <>
                    <Text fw={600} size='sm'>
                      Error de red
                    </Text>
                    <Code block>{`${d.red.codigo}\n${d.red.mensaje}`}</Code>
                  </>
                )}
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      )}
    </Stack>
  );
}

/**
 * Resultado guardado en BD (nabuco_envio / nabuco_prueba_manual): si `respuesta` es un diagnóstico
 * serializado lo muestra completo; si no (registros anteriores o envío OK), el error y la respuesta cruda.
 */
export function RespuestaGuardada({ error, respuesta, titulo = 'Respuesta de Nabuco' }: { error: string | null; respuesta: string | null; titulo?: string }) {
  const d = leerDiagnostico(respuesta);
  if (d) return <NabucoDiagnostico diagnostico={d} />;
  return (
    <>
      {error && <Alert color='red'>{error}</Alert>}
      <Text fw={600}>{titulo}</Text>
      <ScrollArea.Autosize mah={260}>
        <Code block>{bloque(respuesta)}</Code>
      </ScrollArea.Autosize>
    </>
  );
}
