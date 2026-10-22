'use client';

import { useEffect, useState } from 'react';
import { ActionIcon, Alert, Anchor, Button, Divider, FileInput, Group, Modal, Paper, Stack, Text, TextInput, Tooltip } from '@mantine/core';
import { IconAlertTriangle, IconChevronDown, IconChevronUp, IconPaperclip, IconSend, IconTrash, IconX } from '@tabler/icons-react';
import toast from 'react-hot-toast';
import { CORREO_MAX_ADJUNTO_RESPUESTA_BYTES, CORREO_MAX_ADJUNTOS_RESPUESTA, CORREO_MAX_ASUNTO_NUEVO, CORREO_MAX_TOTAL_RESPUESTA_BYTES } from '../../lib/correo/constants';
import { esExterno, revisarDestinatarios } from '../../lib/correo/destinatarios';
import { correoApi } from './correoClient';
import DestinatariosInput from './DestinatariosInput';
import EditorMarkdown from './EditorMarkdown';
import css from './correo.module.css';

/**
 * «Redactar» (2026-10-19, pedido de Nicolás Rivera): correo NUEVO desde el buzón propio, como Gmail. En el
 * escritorio es una ventana flotante abajo a la derecha (se puede minimizar y seguir leyendo la bandeja); en el
 * celular, pantalla completa. Para, CC y CCO con autocompletado; asunto; el mismo editor de la respuesta (con
 * tablas pegadas) y adjuntos con los mismos topes (5 archivos, 3 MB c/u). El servidor usa SIEMPRE el buzón de la
 * sesión y convierte y sanea el cuerpo. Los errores se ven arriba de la ventana, en rojo, sin perder lo escrito.
 * Fase 1 sin borradores en Outlook: al cerrar con contenido se pide confirmar.
 */
export interface RedactarCorreoProps {
  abierto: boolean;
  desktop: boolean;
  correoOperador: string;
  dominiosGrupo: string[];
  onCerrar: () => void;
  onEnviado: (r: { destinatarios: number; asunto: string }) => void;
}

export default function RedactarCorreo({ abierto, desktop, correoOperador, dominiosGrupo, onCerrar, onEnviado }: RedactarCorreoProps) {
  const [para, setPara] = useState<string[]>([]);
  const [cc, setCc] = useState<string[]>([]);
  const [cco, setCco] = useState<string[]>([]);
  const [verCc, setVerCc] = useState(false);
  const [verCco, setVerCco] = useState(false);
  const [asunto, setAsunto] = useState('');
  const [texto, setTexto] = useState('');
  const [archivos, setArchivos] = useState<File[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [minimizado, setMinimizado] = useState(false);
  const [confirmarDescarte, setConfirmarDescarte] = useState(false);
  const [confirmarSinAsunto, setConfirmarSinAsunto] = useState(false);

  const conContenido = Boolean(para.length || cc.length || cco.length || asunto.trim() || texto.trim() || archivos.length);

  // Lo escrito no se pierde por accidente al cerrar la pestaña (fase 1: sin borradores en Outlook).
  useEffect(() => {
    if (!abierto || !conContenido) return;
    const aviso = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', aviso);
    return () => window.removeEventListener('beforeunload', aviso);
  }, [abierto, conContenido]);

  useEffect(() => {
    if (abierto) setMinimizado(false);
  }, [abierto]);

  const limpiar = () => {
    setPara([]);
    setCc([]);
    setCco([]);
    setVerCc(false);
    setVerCco(false);
    setAsunto('');
    setTexto('');
    setArchivos([]);
    setError(null);
    setConfirmarDescarte(false);
    setConfirmarSinAsunto(false);
  };

  const cerrar = () => {
    if (enviando) return;
    if (conContenido) {
      setMinimizado(false);
      setConfirmarDescarte(true);
      return;
    }
    limpiar();
    onCerrar();
  };

  const descartar = () => {
    limpiar();
    onCerrar();
  };

  const enviar = async (sinAsuntoConfirmado = false) => {
    setError(null);
    const r = revisarDestinatarios({ para, cc, cco });
    if (r.error) return setError(r.error);
    if (!texto.trim() && !asunto.trim() && !archivos.length) return setError('Escriba el asunto o el mensaje.');
    const grande = archivos.find((f) => f.size > CORREO_MAX_ADJUNTO_RESPUESTA_BYTES);
    if (grande) return setError(`«${grande.name}» pesa más de 3 MB. Compártalo como enlace de OneDrive o SharePoint.`);
    if (archivos.some((f) => f.size === 0)) return setError('Hay un adjunto vacío.');
    if (archivos.reduce((s, f) => s + f.size, 0) > CORREO_MAX_TOTAL_RESPUESTA_BYTES) return setError('Los adjuntos suman más de 10 MB.');
    if (!asunto.trim() && !sinAsuntoConfirmado) return setConfirmarSinAsunto(true);
    setConfirmarSinAsunto(false);
    setEnviando(true);
    try {
      const res = await correoApi.redactar({ para: r.para, cc: r.cc, cco: r.cco, asunto, texto, archivos });
      toast.success('Correo enviado');
      onEnviado({ destinatarios: res.destinatarios, asunto: asunto.trim() });
      limpiar();
      onCerrar();
    } catch (e) {
      setError(`No se envió el correo: ${e instanceof Error ? e.message : String(e)}`);
      toast.error('No se envió el correo');
    } finally {
      setEnviando(false);
    }
  };

  if (!abierto) return null;

  const externos = [...para, ...cc, ...cco].filter((c) => esExterno(c, dominiosGrupo));
  const enlacesCopia = (
    <Group gap={8} wrap='nowrap' pt={7} style={{ flexShrink: 0 }}>
      {!verCc && (
        <Anchor component='button' type='button' size='sm' c='dimmed' onClick={() => setVerCc(true)} data-testid='correo-redactar-ver-cc'>
          CC
        </Anchor>
      )}
      {!verCco && (
        <Anchor component='button' type='button' size='sm' c='dimmed' onClick={() => setVerCco(true)} data-testid='correo-redactar-ver-cco'>
          CCO
        </Anchor>
      )}
    </Group>
  );

  const avisos = (
    <>
      {error && (
        <Alert color='red' icon={<IconAlertTriangle size={18} />} withCloseButton onClose={() => setError(null)} p='xs' data-testid='correo-redactar-error'>
          <Text size='sm'>{error}</Text>
        </Alert>
      )}
      {confirmarSinAsunto && (
        <Alert color='yellow' icon={<IconAlertTriangle size={18} />} p='xs' data-testid='correo-redactar-sin-asunto'>
          <Stack gap={6}>
            <Text size='sm'>El correo no tiene asunto. ¿Desea enviarlo así?</Text>
            <Group gap='xs'>
              <Button size='compact-sm' color='yellow' onClick={() => void enviar(true)} data-testid='correo-redactar-enviar-sin-asunto'>
                Enviar sin asunto
              </Button>
              <Button size='compact-sm' variant='default' onClick={() => setConfirmarSinAsunto(false)}>
                Agregar asunto
              </Button>
            </Group>
          </Stack>
        </Alert>
      )}
      {confirmarDescarte && (
        <Alert color='yellow' icon={<IconAlertTriangle size={18} />} p='xs' data-testid='correo-redactar-confirmar-descarte'>
          <Stack gap={6}>
            <Text size='sm'>¿Descartar este correo? Lo escrito no se guarda en Borradores.</Text>
            <Group gap='xs'>
              <Button size='compact-sm' color='red' onClick={descartar} data-testid='correo-redactar-descartar-si'>
                Descartar
              </Button>
              <Button size='compact-sm' variant='default' onClick={() => setConfirmarDescarte(false)}>
                Seguir escribiendo
              </Button>
            </Group>
          </Stack>
        </Alert>
      )}
    </>
  );

  const formulario = (
    <Stack gap={0} className={css.redactarCuerpo}>
      {(error || confirmarSinAsunto || confirmarDescarte) && (
        <Stack gap={6} px='sm' pt='xs'>
          {avisos}
        </Stack>
      )}
      <Stack gap={0} px='sm'>
        <Text size='xs' c='dimmed' pt={6} data-testid='correo-redactar-de'>
          De: {correoOperador}
        </Text>
        <DestinatariosInput etiqueta='Para' value={para} onChange={setPara} dominiosGrupo={dominiosGrupo} disabled={enviando} autoFocus testId='correo-redactar-para' derecha={enlacesCopia} />
        <Divider />
        {verCc && (
          <>
            <DestinatariosInput etiqueta='CC' value={cc} onChange={setCc} dominiosGrupo={dominiosGrupo} disabled={enviando} testId='correo-redactar-cc' />
            <Divider />
          </>
        )}
        {verCco && (
          <>
            <DestinatariosInput etiqueta='CCO' value={cco} onChange={setCco} dominiosGrupo={dominiosGrupo} disabled={enviando} testId='correo-redactar-cco' />
            <Divider />
          </>
        )}
        <TextInput
          variant='unstyled'
          placeholder='Asunto'
          aria-label='Asunto'
          value={asunto}
          onChange={(e) => setAsunto(e.currentTarget.value.slice(0, CORREO_MAX_ASUNTO_NUEVO))}
          disabled={enviando}
          styles={{ input: { fontSize: 14, minHeight: 36 } }}
          data-testid='correo-redactar-asunto'
        />
        <Divider mb='xs' />
        {externos.length > 0 && (
          <Text size='xs' c='yellow.8' mb={4} data-testid='correo-redactar-aviso-externos'>
            {externos.length === 1 ? 'Un destinatario está' : `${externos.length} destinatarios están`} fuera del grupo. Revise antes de enviar.
          </Text>
        )}
      </Stack>
      <div className={css.redactarEditor}>
        <EditorMarkdown value={texto} onChange={setTexto} placeholder='Escriba su mensaje…' disabled={enviando} testId='correo-redactar-texto' ariaLabel='Mensaje' minRows={desktop ? 9 : 10} maxRows={desktop ? 14 : 40} pegarTablas />
        <FileInput
          mt='xs'
          multiple
          clearable
          size='xs'
          placeholder={`Adjuntar archivos (máx. ${CORREO_MAX_ADJUNTOS_RESPUESTA}, 3 MB c/u)`}
          leftSection={<IconPaperclip size={14} />}
          value={archivos}
          onChange={(f) => setArchivos((f ?? []).slice(0, CORREO_MAX_ADJUNTOS_RESPUESTA))}
          disabled={enviando}
          aria-label='Adjuntos del correo'
          data-testid='correo-redactar-adjuntos'
        />
      </div>
      <Group justify='space-between' wrap='nowrap' gap='xs' px='sm' py='xs' className={css.redactarPie}>
        <Button radius='xl' leftSection={<IconSend size={16} />} onClick={() => void enviar()} loading={enviando} data-testid='correo-redactar-enviar'>
          Enviar
        </Button>
        <Tooltip label='Descartar'>
          <ActionIcon variant='subtle' color='gray' size='lg' onClick={cerrar} disabled={enviando} aria-label='Descartar' data-testid='correo-redactar-descartar'>
            <IconTrash size={18} />
          </ActionIcon>
        </Tooltip>
      </Group>
    </Stack>
  );

  const titulo = asunto.trim() || 'Mensaje nuevo';

  if (!desktop) {
    return (
      <Modal
        opened
        onClose={cerrar}
        fullScreen
        radius={0}
        transitionProps={{ transition: 'slide-up', duration: 180 }}
        title={
          <Text fw={600} truncate maw='70vw'>
            {titulo}
          </Text>
        }
        closeButtonProps={{ 'aria-label': 'Cerrar' }}
        styles={{ body: { padding: 0 }, content: { display: 'flex', flexDirection: 'column' } }}
        data-testid='correo-redactar'
      >
        {formulario}
      </Modal>
    );
  }

  return (
    <Paper shadow='xl' radius='md' withBorder className={css.redactarFlotante} data-minimizado={minimizado ? '1' : '0'} role='dialog' aria-label='Mensaje nuevo' data-testid='correo-redactar'>
      <Group justify='space-between' wrap='nowrap' gap='xs' className={css.redactarCabecera} onClick={() => minimizado && setMinimizado(false)}>
        <Text size='sm' fw={600} truncate data-testid='correo-redactar-titulo'>
          {titulo}
        </Text>
        <Group gap={2} wrap='nowrap' onClick={(e) => e.stopPropagation()}>
          <Tooltip label={minimizado ? 'Restaurar' : 'Minimizar'}>
            <ActionIcon variant='subtle' color='gray' size='sm' onClick={() => setMinimizado((v) => !v)} aria-label={minimizado ? 'Restaurar' : 'Minimizar'} data-testid='correo-redactar-minimizar'>
              {minimizado ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />}
            </ActionIcon>
          </Tooltip>
          <Tooltip label='Cerrar'>
            <ActionIcon variant='subtle' color='gray' size='sm' onClick={cerrar} aria-label='Cerrar' data-testid='correo-redactar-cerrar'>
              <IconX size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>
      {!minimizado && formulario}
    </Paper>
  );
}
