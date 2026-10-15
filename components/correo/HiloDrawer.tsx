'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  Checkbox,
  Divider,
  Drawer,
  FileInput,
  Group,
  Loader,
  NumberInput,
  Stack,
  Switch,
  Text,
  Textarea,
  Title,
  Tooltip,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import {
  IconAlertTriangle,
  IconCheck,
  IconDownload,
  IconEye,
  IconLink,
  IconNotes,
  IconPaperclip,
  IconPhoto,
  IconPlus,
  IconSend,
  IconX,
} from '@tabler/icons-react';
import toast from 'react-hot-toast';
import { CORREO_MAX_ADJUNTO_RESPUESTA_BYTES, CORREO_MAX_ADJUNTOS_RESPUESTA } from '../../lib/correo/constants';
import { ACUSE_A_TODOS, ACUSE_ETIQUETA, enlaceSolicitud, textoAcuse } from '../../lib/correo/acuse';
import type { ResultadoAcuse } from '../../lib/correo/types';
import { correoApi, fechaLarga, PREVISUALIZABLES, tamano, urlAdjunto, urlSolicitud, type HiloVista } from './correoClient';
import HtmlSeguro from './HtmlSeguro';

/**
 * Vista del HILO (todos los mensajes de la conversación, del más antiguo al más
 * reciente): cuerpo saneado, adjuntos para ver o descargar, el caso vinculado
 * (con los correos nuevos que aún no están en el caso) y la respuesta sobre el hilo.
 */
export interface HiloDrawerProps {
  conversationId: string | null;
  onClose: () => void;
  /** Abrir la simulación con los mensajes del hilo (crear una solicitud con este hilo). */
  onCrearSolicitud: (mensajesIds: string[]) => void;
  /** El hilo cambió (vínculo, notas, respuesta): refrescar la bandeja al cerrar. */
  onCambio: () => void;
  /** Responder desde SynerLink (Mail.Send) habilitado en el ambiente. */
  envioHabilitado?: boolean;
  /** Nombre de la persona (firma del texto «Informar en el hilo»). */
  nombreOperador?: string;
}

type Resultado = { color: 'green' | 'red' | 'yellow'; texto: string; reintentarAcuse?: { confirmarExterno: boolean } } | null;

export default function HiloDrawer({ conversationId, onClose, onCrearSolicitud, onCambio, envioHabilitado = true, nombreOperador = '' }: HiloDrawerProps) {
  const desktop = useMediaQuery('(min-width: 48em)') ?? true;
  const [hilo, setHilo] = useState<HiloVista | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remotas, setRemotas] = useState(false);
  const [resultado, setResultado] = useState<Resultado>(null);
  const [texto, setTexto] = useState('');
  const [todos, setTodos] = useState(false);
  const [archivos, setArchivos] = useState<File[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);
  const [idVincular, setIdVincular] = useState<number | string>('');
  const [vinculando, setVinculando] = useState(false);
  const [acuseVincular, setAcuseVincular] = useState(true);
  const [confirmarInforme, setConfirmarInforme] = useState(false);
  const [reintentando, setReintentando] = useState(false);

  const cargar = useCallback(
    async (conRemotas: boolean) => {
      if (!conversationId) return;
      setCargando(true);
      setError(null);
      try {
        const r = await correoApi.hilo(conversationId, conRemotas);
        setHilo(r.hilo);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setCargando(false);
      }
    },
    [conversationId]
  );

  useEffect(() => {
    setHilo(null);
    setRemotas(false);
    setResultado(null);
    setTexto('');
    setArchivos([]);
    setTodos(false);
    setIdVincular('');
    setAcuseVincular(true);
    setConfirmarInforme(false);
    if (conversationId) void cargar(false);
  }, [conversationId, cargar]);

  const ultimo = hilo?.mensajes[hilo.mensajes.length - 1] ?? null;

  const enviar = async () => {
    if (!ultimo || !texto.trim()) return;
    const grande = archivos.find((f) => f.size > CORREO_MAX_ADJUNTO_RESPUESTA_BYTES);
    if (grande) {
      setResultado({ color: 'red', texto: `«${grande.name}» pesa más de 3 MB.` });
      return;
    }
    setEnviando(true);
    setResultado(null);
    try {
      const r = await correoApi.responder({ mensajeId: ultimo.id, texto, todos, archivos });
      const extra = r.notaEnSolicitud ? ` Quedó como nota en la solicitud #${r.notaEnSolicitud}.` : '';
      setResultado({ color: 'green', texto: `Respuesta enviada desde su buzón.${extra}` });
      toast.success('Respuesta enviada');
      setTexto('');
      setArchivos([]);
      onCambio();
      void cargar(remotas);
    } catch (e) {
      setResultado({ color: 'red', texto: `No se envió la respuesta: ${e instanceof Error ? e.message : String(e)}` });
      toast.error('No se envió la respuesta');
    } finally {
      setEnviando(false);
    }
  };

  const agregarNotas = async () => {
    if (!hilo) return;
    setSincronizando(true);
    try {
      const r = await correoApi.notas(hilo.conversationId);
      setResultado({ color: 'green', texto: r.agregadas ? `Se agregaron ${r.agregadas} correo(s) como notas de la solicitud #${r.idRequest}.` : 'No había correos nuevos para agregar.' });
      onCambio();
      void cargar(remotas);
    } catch (e) {
      setResultado({ color: 'red', texto: e instanceof Error ? e.message : String(e) });
    } finally {
      setSincronizando(false);
    }
  };

  /** Mensaje del vínculo + estado del acuse (con «Reintentar respuesta» si no salió). */
  const resultadoAcuse = (base: string, a: ResultadoAcuse | undefined): Resultado => {
    if (!a || a.estado === 'DESHABILITADO') return { color: 'green', texto: base };
    if (a.estado === 'ENVIADO' || a.estado === 'YA_ENVIADO') return { color: 'green', texto: `${base} Se informó en el hilo a todos los participantes.` };
    const reintentable = a.estado === 'ERROR' || a.codigo === 'EXTERNO_SIN_CONFIRMAR';
    return {
      color: 'yellow',
      texto: `${base} No se respondió en el hilo: ${a.mensaje ?? 'error'}`,
      ...(reintentable ? { reintentarAcuse: { confirmarExterno: a.codigo === 'EXTERNO_SIN_CONFIRMAR' } } : {}),
    };
  };

  const reintentarAcuse = async (confirmarExterno: boolean) => {
    if (!hilo) return;
    setReintentando(true);
    try {
      const { acuse } = await correoApi.reintentarAcuse(hilo.conversationId, ACUSE_A_TODOS.todos, confirmarExterno || ACUSE_A_TODOS.confirmarExterno);
      setResultado(resultadoAcuse('', acuse));
      setConfirmarInforme(false);
      onCambio();
      void cargar(remotas);
    } catch (e) {
      setResultado({ color: 'red', texto: e instanceof Error ? e.message : String(e) });
    } finally {
      setReintentando(false);
    }
  };

  const vincular = async () => {
    if (!hilo || !Number(idVincular)) return;
    setVinculando(true);
    try {
      const enviar = envioHabilitado && acuseVincular;
      const r = await correoApi.vincular(hilo.conversationId, Number(idVincular), enviar ? ACUSE_A_TODOS : undefined);
      setResultado(resultadoAcuse(`Hilo vinculado a la solicitud #${r.vinculo.idRequest}.`, r.acuse));
      onCambio();
      void cargar(remotas);
    } catch (e) {
      setResultado({ color: 'red', texto: e instanceof Error ? e.message : String(e) });
    } finally {
      setVinculando(false);
    }
  };

  const bloqueadas = hilo?.mensajes.reduce((s, m) => s + m.remotasBloqueadas, 0) ?? 0;

  return (
    <Drawer
      opened={Boolean(conversationId)}
      onClose={onClose}
      position='right'
      size={desktop ? '60%' : '100%'}
      title={
        <Title order={4} lineClamp={2}>
          {hilo?.asunto || 'Hilo de correo'}
        </Title>
      }
      data-testid='correo-hilo'
    >
      <Stack gap='md'>
        {resultado && (
          <Alert
            color={resultado.color}
            icon={resultado.color === 'green' ? <IconCheck size={18} /> : <IconAlertTriangle size={18} />}
            withCloseButton
            onClose={() => setResultado(null)}
            data-testid='correo-hilo-resultado'
          >
            <Stack gap={6}>
              <Text size='sm'>{resultado.texto.trim()}</Text>
              {resultado.reintentarAcuse && (
                <Group>
                  <Button
                    size='xs'
                    variant='light'
                    color='orange'
                    loading={reintentando}
                    onClick={() => reintentarAcuse(resultado.reintentarAcuse!.confirmarExterno)}
                    data-testid='correo-hilo-reintentar-acuse'
                  >
                    {resultado.reintentarAcuse.confirmarExterno ? 'Confirmar y responder' : 'Reintentar respuesta'}
                  </Button>
                </Group>
              )}
            </Stack>
          </Alert>
        )}
        {error && (
          <Alert color='red' icon={<IconAlertTriangle size={18} />} title='No se pudo abrir el hilo'>
            {error}
          </Alert>
        )}
        {cargando && !hilo && (
          <Group justify='center' p='xl'>
            <Loader />
          </Group>
        )}
        {hilo && (
          <>
            {hilo.vinculo ? (
              <Card withBorder radius='md' p='sm' bg='var(--mantine-color-teal-light)' data-testid='correo-hilo-vinculo'>
                <Group justify='space-between' wrap='wrap' gap='xs'>
                  <Group gap='xs'>
                    <IconLink size={18} />
                    <Text size='sm'>
                      Vinculado a la{' '}
                      <Anchor href={urlSolicitud(hilo.vinculo.idRequest)} fw={700}>
                        solicitud #{hilo.vinculo.idRequest}
                      </Anchor>
                      {hilo.vinculo.origen === 'CREADA' ? ' (creada desde este hilo)' : ''}
                    </Text>
                  </Group>
                  {envioHabilitado &&
                    (hilo.vinculo.acuseEnviadoEn ? (
                      <Button size='xs' variant='default' disabled leftSection={<IconCheck size={14} />} data-testid='correo-hilo-informado'>
                        Informado el {new Date(hilo.vinculo.acuseEnviadoEn).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })}
                      </Button>
                    ) : (
                      <Button size='xs' variant='light' color='teal' onClick={() => setConfirmarInforme((v) => !v)} data-testid='correo-hilo-informar'>
                        Informar en el hilo
                      </Button>
                    ))}
                  {hilo.pendientes > 0 ? (
                    <Button size='xs' leftSection={<IconNotes size={14} />} onClick={agregarNotas} loading={sincronizando} data-testid='correo-hilo-agregar-notas'>
                      Agregar {hilo.pendientes} correo(s) nuevo(s) al caso
                    </Button>
                  ) : (
                    <Badge color='teal' variant='light'>
                      Caso al día
                    </Badge>
                  )}
                </Group>
                {confirmarInforme && envioHabilitado && !hilo.vinculo.acuseEnviadoEn && (
                  <Stack gap={6} mt='xs' data-testid='correo-hilo-informar-confirmar'>
                    <Text size='xs' fw={600}>
                      Se responderá a todos los participantes del hilo con este texto:
                    </Text>
                    <Text
                      size='xs'
                      p='xs'
                      bg='var(--mantine-color-body)'
                      style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', borderRadius: 'var(--mantine-radius-sm)', border: '1px solid var(--mantine-color-default-border)' }}
                      data-testid='correo-hilo-informar-previa'
                    >
                      {textoAcuse({
                        id: hilo.vinculo.idRequest,
                        titulo: hilo.vinculo.asunto ?? hilo.asunto ?? '',
                        enlace: enlaceSolicitud(typeof window !== 'undefined' ? window.location.origin : '', hilo.vinculo.idRequest),
                        firma: nombreOperador,
                      })}
                    </Text>
                    <Group gap='xs'>
                      <Button size='xs' color='teal' loading={reintentando} onClick={() => reintentarAcuse(true)} data-testid='correo-hilo-informar-enviar'>
                        Enviar a todos
                      </Button>
                      <Button size='xs' variant='default' onClick={() => setConfirmarInforme(false)}>
                        Cancelar
                      </Button>
                    </Group>
                  </Stack>
                )}
              </Card>
            ) : (
              <Card withBorder radius='md' p='sm' data-testid='correo-hilo-sin-vinculo'>
                <Stack gap='xs'>
                  <Text size='sm' c='dimmed'>
                    Este hilo no está vinculado a ninguna solicitud.
                  </Text>
                  <Group gap='xs' wrap='wrap' align='flex-end'>
                    <Button size='sm' leftSection={<IconPlus size={16} />} onClick={() => onCrearSolicitud(hilo.mensajes.filter((m) => m.de.correo).map((m) => m.id))} data-testid='correo-hilo-crear'>
                      Crear solicitud con este hilo
                    </Button>
                    <NumberInput
                      size='sm'
                      placeholder='N.º de solicitud'
                      aria-label='Número de la solicitud existente'
                      value={idVincular}
                      onChange={setIdVincular}
                      min={1}
                      hideControls
                      w={150}
                    />
                    <Button size='sm' variant='light' leftSection={<IconLink size={16} />} onClick={vincular} loading={vinculando} disabled={!Number(idVincular)}>
                      Vincular a una existente
                    </Button>
                  </Group>
                  {envioHabilitado && (
                    <Checkbox
                      size='xs'
                      label={`Al vincular, ${ACUSE_ETIQUETA.charAt(0).toLowerCase()}${ACUSE_ETIQUETA.slice(1)}`}
                      checked={acuseVincular}
                      onChange={(e) => setAcuseVincular(e.currentTarget.checked)}
                      data-testid='correo-hilo-acuse'
                    />
                  )}
                </Stack>
              </Card>
            )}

            {bloqueadas > 0 && !remotas && (
              <Alert color='gray' icon={<IconPhoto size={18} />} data-testid='correo-imagenes-bloqueadas'>
                <Group justify='space-between' wrap='wrap' gap='xs'>
                  <Text size='sm'>Se bloquearon {bloqueadas} imagen(es) remota(s) para proteger su privacidad.</Text>
                  <Button
                    size='xs'
                    variant='default'
                    onClick={() => {
                      setRemotas(true);
                      void cargar(true);
                    }}
                  >
                    Mostrar imágenes
                  </Button>
                </Group>
              </Alert>
            )}

            {hilo.mensajes.map((m) => (
              <Card key={m.id} withBorder radius='md' p='sm' data-testid='correo-hilo-mensaje'>
                <Stack gap={6}>
                  <Group justify='space-between' wrap='wrap' gap={4}>
                    <Text size='sm' fw={700}>
                      {m.de.nombre}{' '}
                      <Text span size='xs' c='dimmed'>
                        &lt;{m.de.correo}&gt;
                      </Text>
                    </Text>
                    <Group gap={6}>
                      {m.enCaso && (
                        <Badge size='sm' color='teal' variant='light'>
                          En el caso
                        </Badge>
                      )}
                      <Text size='xs' c='dimmed'>
                        {fechaLarga(m.fecha)}
                      </Text>
                    </Group>
                  </Group>
                  {(m.para.length > 0 || m.cc.length > 0) && (
                    <Text size='xs' c='dimmed' lineClamp={2}>
                      Para: {m.para.map((p) => p.correo).join(', ')}
                      {m.cc.length ? ` · CC: ${m.cc.map((p) => p.correo).join(', ')}` : ''}
                    </Text>
                  )}
                  <HtmlSeguro html={m.html} remotas={remotas} titulo={`Correo de ${m.de.nombre}`} />
                  {m.adjuntos.length > 0 && (
                    <Stack gap={4}>
                      <Divider />
                      {m.adjuntos.map((a) => (
                        <Group key={a.id} justify='space-between' wrap='nowrap' gap='xs' data-testid='correo-adjunto'>
                          <Group gap={6} wrap='nowrap' style={{ minWidth: 0 }}>
                            <IconPaperclip size={14} style={{ flexShrink: 0 }} />
                            <Text size='sm' truncate>
                              {a.nombre}
                            </Text>
                            <Text size='xs' c='dimmed' style={{ flexShrink: 0 }}>
                              {tamano(a.tamano)}
                            </Text>
                          </Group>
                          <Group gap={4} wrap='nowrap'>
                            {PREVISUALIZABLES.has(a.tipo.toLowerCase()) && (
                              <Tooltip label='Ver'>
                                <ActionIcon component='a' href={urlAdjunto(m.id, a.id, true)} target='_blank' rel='noopener noreferrer' variant='subtle' aria-label={`Ver ${a.nombre}`}>
                                  <IconEye size={18} />
                                </ActionIcon>
                              </Tooltip>
                            )}
                            <Tooltip label='Descargar'>
                              <ActionIcon component='a' href={urlAdjunto(m.id, a.id)} variant='subtle' aria-label={`Descargar ${a.nombre}`}>
                                <IconDownload size={18} />
                              </ActionIcon>
                            </Tooltip>
                          </Group>
                        </Group>
                      ))}
                    </Stack>
                  )}
                </Stack>
              </Card>
            ))}

            {ultimo && envioHabilitado && (
              <Card withBorder radius='md' p='sm' data-testid='correo-responder'>
                <Stack gap='xs'>
                  <Text size='sm' fw={700}>
                    Responder sobre el hilo
                  </Text>
                  <Text size='xs' c='dimmed'>
                    Sale desde su propio buzón, como respuesta al último mensaje de {ultimo.de.nombre}.
                    {hilo.vinculo ? ` Quedará como nota en la solicitud #${hilo.vinculo.idRequest}.` : ''}
                  </Text>
                  <Textarea
                    placeholder='Escriba su respuesta…'
                    autosize
                    minRows={3}
                    maxRows={12}
                    value={texto}
                    onChange={(e) => setTexto(e.currentTarget.value)}
                    aria-label='Respuesta'
                    data-testid='correo-respuesta-texto'
                  />
                  <FileInput
                    multiple
                    clearable
                    placeholder={`Adjuntos (máx. ${CORREO_MAX_ADJUNTOS_RESPUESTA}, 3 MB c/u)`}
                    leftSection={<IconPaperclip size={16} />}
                    value={archivos}
                    onChange={(f) => setArchivos((f ?? []).slice(0, CORREO_MAX_ADJUNTOS_RESPUESTA))}
                    aria-label='Adjuntos de la respuesta'
                  />
                  <Group justify='space-between' wrap='wrap' gap='xs'>
                    <Switch label='Responder a todos' checked={todos} onChange={(e) => setTodos(e.currentTarget.checked)} />
                    <Group gap='xs'>
                      <Button variant='default' leftSection={<IconX size={16} />} onClick={() => setTexto('')} disabled={enviando || !texto}>
                        Limpiar
                      </Button>
                      <Button leftSection={<IconSend size={16} />} onClick={enviar} loading={enviando} disabled={!texto.trim()} data-testid='correo-respuesta-enviar'>
                        Enviar respuesta
                      </Button>
                    </Group>
                  </Group>
                </Stack>
              </Card>
            )}
          </>
        )}
      </Stack>
    </Drawer>
  );
}
