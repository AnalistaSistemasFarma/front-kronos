'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Anchor, Badge, Box, Button, Card, Checkbox, Group, Loader, Select, Stack, Switch, Text, Textarea, TextInput } from '@mantine/core';
import { IconAlertTriangle, IconCheck, IconEdit, IconFileText, IconMail, IconNotes, IconSend, IconX } from '@tabler/icons-react';
import toast from 'react-hot-toast';
import { ACUSE_ETIQUETA } from '../../lib/correo/acuse';
import { ALERTA_TEXTO, type AlertaFila } from '../../lib/correo/types';
import { correoApi, urlSolicitud, type AccionAgenteCorreo, type PreparacionSolicitudAgente } from './correoClient';
import EditorMarkdown from './EditorMarkdown';
import HtmlSeguro from './HtmlSeguro';

/**
 * Tarjeta de CONFIRMACIÓN de una propuesta del agente sobre un hilo de correo compartido
 * («Consultar a un agente», 2026-10-16). Se pinta en el chat en lugar del mensaje del agente.
 *
 * El agente solo PROPONE; esta tarjeta es la única puerta para ejecutar y siempre con la sesión de la
 * persona: «Enviar» / «Crear solicitud» / «Agregar nota», «Editar» y «Descartar». Idempotente: los
 * botones se bloquean mientras se ejecuta y, una vez decidida, la tarjeta queda en solo lectura (el
 * servidor además tiene su candado de un solo envío). Vence con la concesión (24 h).
 */

const TITULO: Record<AccionAgenteCorreo['tipo'], string> = {
  RESPUESTA: 'Propuesta de respuesta',
  SOLICITUD: 'Propuesta de solicitud',
  NOTA: 'Propuesta de nota',
};

const ICONO: Record<AccionAgenteCorreo['tipo'], React.ReactNode> = {
  RESPUESTA: <IconMail size={18} />,
  SOLICITUD: <IconFileText size={18} />,
  NOTA: <IconNotes size={18} />,
};

function insignia(a: AccionAgenteCorreo): { color: string; texto: string } {
  if (a.estado === 'CONFIRMADA') return { color: 'teal', texto: a.tipo === 'RESPUESTA' ? 'Enviada' : a.tipo === 'SOLICITUD' ? 'Creada' : 'Agregada' };
  if (a.estado === 'DESCARTADA') return { color: 'gray', texto: 'Descartada' };
  if (a.estado === 'FALLIDA') return { color: 'red', texto: 'Falló' };
  if (a.estado === 'EJECUTANDO') return { color: 'blue', texto: 'En curso' };
  if (!a.vigente) return { color: 'gray', texto: a.estadoConcesion === 'REVOCADA' ? 'Acceso revocado' : 'Vencida' };
  return { color: 'yellow', texto: 'Pendiente de su confirmación' };
}

export default function TarjetaAccionCorreo({ accion, onCambio }: { accion: AccionAgenteCorreo; onCambio: (a: AccionAgenteCorreo) => void }) {
  const [a, setA] = useState(accion);
  useEffect(() => setA(accion), [accion]);
  const [editando, setEditando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Edición
  const [cuerpo, setCuerpo] = useState(a.respuesta?.cuerpo ?? '');
  const [todos, setTodos] = useState(Boolean(a.respuesta?.todos));
  const [nota, setNota] = useState(a.nota?.texto ?? '');
  const [prep, setPrep] = useState<PreparacionSolicitudAgente | null>(null);
  const [cargandoPrep, setCargandoPrep] = useState(false);
  const [sol, setSol] = useState({ idCompany: 0, idProcess: 0, titulo: a.solicitud?.titulo ?? '', descripcion: a.solicitud?.descripcion ?? '', informar: true, copiarAdjuntos: true });
  const [solicitante, setSolicitante] = useState<{ id: string; nombre: string } | null>(null);
  const [busqueda, setBusqueda] = useState('');
  const [opcionesUsuarios, setOpcionesUsuarios] = useState<Array<{ value: string; label: string }>>([]);
  /** Candado del navegador: un solo clic aunque la petición tarde. */
  const enCurso = useRef(false);

  const pendiente = a.estado === 'PENDIENTE';
  const accionable = pendiente && a.vigente;
  const ins = insignia(a);

  const preparar = useCallback(
    async (empresa?: number) => {
      setCargandoPrep(true);
      setError(null);
      try {
        const p = await correoApi.prepararSolicitudAgente(a.id, empresa ?? null);
        setPrep(p);
        setSol((s) => ({ ...s, idCompany: p.idCompany, idProcess: p.idProcess ?? 0, titulo: s.titulo || p.titulo, descripcion: s.descripcion || p.descripcion }));
        setSolicitante(p.idSolicitante ? { id: p.idSolicitante, nombre: p.solicitanteNombre ?? p.idSolicitante } : null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setCargandoPrep(false);
      }
    },
    [a.id]
  );

  useEffect(() => {
    if (!editando || a.tipo !== 'SOLICITUD' || !sol.idCompany || busqueda.trim().length < 2) return;
    const t = setTimeout(() => {
      correoApi
        .usuarios(sol.idCompany, busqueda.trim())
        .then((r) => setOpcionesUsuarios(r.usuarios.map((u) => ({ value: u.id, label: `${u.nombre} · ${u.correo}` }))))
        .catch(() => setOpcionesUsuarios([]));
    }, 250);
    return () => clearTimeout(t);
  }, [busqueda, sol.idCompany, editando, a.tipo]);

  const terminar = (estado: AccionAgenteCorreo['estado'], resultado: string, idRequest: number | null) => {
    const n = { ...a, estado, resultado, idRequest, decididaEn: new Date().toISOString() };
    setA(n);
    setEditando(false);
    onCambio(n);
  };

  const confirmar = async () => {
    if (enCurso.current || !accionable) return;
    let edicion: Record<string, unknown> = {};
    if (a.tipo === 'RESPUESTA') {
      if (!cuerpo.trim()) return setError('Escriba la respuesta.');
      edicion = { cuerpo, todos };
    } else if (a.tipo === 'NOTA') {
      if (!nota.trim()) return setError('Escriba la nota.');
      edicion = { texto: nota };
    } else {
      if (!prep) return void preparar();
      if (!sol.idProcess) return setError('Elija el proceso.');
      if (!solicitante) return setError('Elija el solicitante.');
      edicion = { idCompany: sol.idCompany, idProcess: sol.idProcess, idSolicitante: solicitante.id, titulo: sol.titulo, descripcion: sol.descripcion, informar: sol.informar, copiarAdjuntos: sol.copiarAdjuntos };
    }
    enCurso.current = true;
    setOcupado(true);
    setError(null);
    try {
      const r = await correoApi.confirmarAccion(a.id, edicion);
      toast.success(a.tipo === 'RESPUESTA' ? 'Respuesta enviada desde su buzón' : a.tipo === 'SOLICITUD' ? `Solicitud #${r.idRequest} creada` : 'Nota agregada al caso');
      terminar('CONFIRMADA', r.resultado, r.idRequest);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      // Ya atendida en otra pestaña o vencida: se refresca el estado real.
      onCambio({ ...a });
    } finally {
      enCurso.current = false;
      setOcupado(false);
    }
  };

  const descartar = async () => {
    if (enCurso.current || !pendiente) return;
    enCurso.current = true;
    setOcupado(true);
    setError(null);
    try {
      const r = await correoApi.descartarAccion(a.id);
      terminar('DESCARTADA', r.resultado, null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      enCurso.current = false;
      setOcupado(false);
    }
  };

  const abrirEdicion = () => {
    setEditando(true);
    if (a.tipo === 'SOLICITUD' && !prep) void preparar();
  };

  const textoConfirmar = a.tipo === 'RESPUESTA' ? 'Enviar' : a.tipo === 'SOLICITUD' ? 'Crear solicitud' : 'Agregar nota';

  return (
    <Card withBorder radius='md' p='sm' shadow='xs' className='correo-agente-tarjeta' data-testid='correo-agente-tarjeta' data-tipo={a.tipo} data-estado={a.estado} style={{ maxWidth: 620, width: '100%' }}>
      <Stack gap='xs'>
        <Group justify='space-between' wrap='wrap' gap='xs' align='flex-start'>
          <Group gap={6} wrap='nowrap' style={{ minWidth: 0, flex: '1 1 200px' }}>
            <Box c='blue' style={{ display: 'flex', flexShrink: 0 }}>
              {ICONO[a.tipo]}
            </Box>
            <Stack gap={0} style={{ minWidth: 0 }}>
              <Text size='sm' fw={700}>
                {TITULO[a.tipo]}
              </Text>
              <Text size='xs' c='dimmed' truncate>
                {a.agente} · hilo «{a.asunto || '(Sin asunto)'}»
              </Text>
            </Stack>
          </Group>
          <Badge color={ins.color} variant='light' radius='sm' style={{ textTransform: 'none', flexShrink: 0 }} data-testid='correo-agente-tarjeta-estado'>
            {ins.texto}
          </Badge>
        </Group>

        {a.tipo === 'RESPUESTA' && a.respuesta && (
          <>
            <Text size='xs'>
              <b>Para:</b> {a.respuesta.para.join(', ') || '(el remitente del último mensaje)'}
              {(editando ? todos : a.respuesta.todos) ? ' · responder a todos' : ''}
            </Text>
            {editando ? (
              <Stack gap={6}>
                <EditorMarkdown value={cuerpo} onChange={setCuerpo} disabled={ocupado} testId='correo-agente-editor' ariaLabel='Respuesta propuesta' />
                <Switch size='xs' label='Responder a todos' checked={todos} onChange={(e) => setTodos(e.currentTarget.checked)} />
              </Stack>
            ) : (
              <Box style={{ border: '1px solid var(--mantine-color-default-border)', borderRadius: 8, overflow: 'hidden' }}>
                <HtmlSeguro html={a.respuesta.html} remotas={false} titulo='Vista previa de la respuesta propuesta' />
              </Box>
            )}
          </>
        )}

        {a.tipo === 'NOTA' && a.nota && (
          <>
            <Text size='xs'>
              Para la{' '}
              {a.nota.idRequest ? (
                <Anchor href={urlSolicitud(a.nota.idRequest)} fw={600}>
                  solicitud #{a.nota.idRequest}
                </Anchor>
              ) : (
                'solicitud vinculada'
              )}
            </Text>
            {editando ? (
              <Textarea autosize minRows={3} maxRows={12} value={nota} onChange={(e) => setNota(e.currentTarget.value)} disabled={ocupado} aria-label='Nota propuesta' data-testid='correo-agente-nota' />
            ) : (
              <Text size='sm' style={{ whiteSpace: 'pre-wrap' }}>
                {a.nota.texto}
              </Text>
            )}
          </>
        )}

        {a.tipo === 'SOLICITUD' && a.solicitud && !editando && (
          <Stack gap={2}>
            <Text size='xs'>
              <b>Proceso propuesto:</b> {a.solicitud.proceso ?? '—'}
              {a.solicitud.categoria ? ` (${a.solicitud.categoria})` : ''}
            </Text>
            <Text size='sm' fw={600}>
              {a.solicitud.titulo}
            </Text>
            <Text size='sm' style={{ whiteSpace: 'pre-wrap' }} lineClamp={6}>
              {a.solicitud.descripcion}
            </Text>
          </Stack>
        )}

        {a.tipo === 'SOLICITUD' && editando && (
          <Stack gap={6} data-testid='correo-agente-solicitud-form'>
            {cargandoPrep && !prep ? (
              <Group gap={6}>
                <Loader size='xs' />
                <Text size='xs'>Preparando la simulación…</Text>
              </Group>
            ) : prep ? (
              <>
                <Select
                  size='xs'
                  label='Empresa'
                  data={prep.empresas.map((e) => ({ value: String(e.idCompany), label: e.companyName }))}
                  value={String(sol.idCompany)}
                  onChange={(v) => v && void preparar(Number(v))}
                  allowDeselect={false}
                  comboboxProps={{ withinPortal: true }}
                />
                <Select
                  size='xs'
                  label='Proceso'
                  searchable
                  data={prep.procesos.map((p) => ({ value: String(p.id), label: p.categoria ? `${p.categoria} · ${p.nombre}` : p.nombre }))}
                  value={sol.idProcess ? String(sol.idProcess) : null}
                  onChange={(v) => setSol((s) => ({ ...s, idProcess: Number(v) || 0 }))}
                  placeholder='Elija el proceso'
                  comboboxProps={{ withinPortal: true }}
                  data-testid='correo-agente-proceso'
                />
                <Select
                  size='xs'
                  label='Solicitante'
                  searchable
                  data={[...(solicitante ? [{ value: solicitante.id, label: solicitante.nombre }] : []), ...opcionesUsuarios.filter((o) => o.value !== solicitante?.id)]}
                  value={solicitante?.id ?? null}
                  onChange={(v, o) => setSolicitante(v ? { id: v, nombre: o?.label ?? v } : null)}
                  searchValue={busqueda}
                  onSearchChange={setBusqueda}
                  placeholder='Busque por nombre o correo'
                  nothingFoundMessage={busqueda.trim().length < 2 ? 'Escriba al menos 2 letras' : 'Sin resultados'}
                  comboboxProps={{ withinPortal: true }}
                />
                <TextInput size='xs' label='Título' value={sol.titulo} maxLength={255} onChange={(e) => setSol((s) => ({ ...s, titulo: e.currentTarget.value }))} />
                <Textarea size='xs' label='Descripción' autosize minRows={3} maxRows={8} maxLength={1000} value={sol.descripcion} onChange={(e) => setSol((s) => ({ ...s, descripcion: e.currentTarget.value }))} />
                {prep.adjuntos > 0 && (
                  <Checkbox size='xs' label={`Copiar los ${prep.adjuntos} adjunto(s) del hilo a la solicitud`} checked={sol.copiarAdjuntos} onChange={(e) => setSol((s) => ({ ...s, copiarAdjuntos: e.currentTarget.checked }))} />
                )}
                <Checkbox size='xs' label={ACUSE_ETIQUETA} checked={sol.informar} onChange={(e) => setSol((s) => ({ ...s, informar: e.currentTarget.checked }))} data-testid='correo-agente-informar' />
                {prep.alertas.length > 0 && (
                  <Alert color='yellow' p={6} icon={<IconAlertTriangle size={16} />}>
                    <Text size='xs'>{prep.alertas.map((x) => ALERTA_TEXTO[x as AlertaFila] ?? x).join(' · ')}</Text>
                  </Alert>
                )}
              </>
            ) : null}
          </Stack>
        )}

        {error && (
          <Alert color='red' p={8} icon={<IconAlertTriangle size={16} />} data-testid='correo-agente-tarjeta-error'>
            <Text size='xs'>{error}</Text>
          </Alert>
        )}

        {a.resultado && !pendiente && (
          <Text size='xs' c={a.estado === 'CONFIRMADA' ? 'teal' : a.estado === 'FALLIDA' ? 'red' : 'dimmed'} data-testid='correo-agente-tarjeta-resultado'>
            {a.estado === 'CONFIRMADA' ? '✓ ' : ''}
            {a.resultado}
            {a.idRequest && a.estado === 'CONFIRMADA' ? (
              <>
                {' '}
                <Anchor href={urlSolicitud(a.idRequest)} size='xs'>
                  Ver solicitud #{a.idRequest}
                </Anchor>
              </>
            ) : null}
          </Text>
        )}
        {pendiente && a.resultado && <Text size='xs' c='orange'>Intento anterior: {a.resultado}</Text>}

        {accionable ? (
          <Group gap='xs' justify='flex-start' wrap='wrap'>
            <Button
              size='xs'
              radius='xl'
              leftSection={a.tipo === 'RESPUESTA' ? <IconSend size={14} /> : <IconCheck size={14} />}
              onClick={a.tipo === 'SOLICITUD' && !editando ? abrirEdicion : confirmar}
              loading={ocupado}
              disabled={ocupado || (a.tipo === 'SOLICITUD' && editando && !prep)}
              data-testid='correo-agente-confirmar'
            >
              {a.tipo === 'SOLICITUD' && !editando ? 'Revisar y crear' : textoConfirmar}
            </Button>
            {!editando && a.tipo !== 'SOLICITUD' && (
              <Button size='xs' radius='xl' variant='default' leftSection={<IconEdit size={14} />} onClick={abrirEdicion} disabled={ocupado} data-testid='correo-agente-editar'>
                Editar
              </Button>
            )}
            {editando && (
              <Button size='xs' radius='xl' variant='subtle' color='gray' onClick={() => setEditando(false)} disabled={ocupado}>
                Cancelar edición
              </Button>
            )}
            <Button size='xs' radius='xl' variant='subtle' color='red' leftSection={<IconX size={14} />} onClick={descartar} disabled={ocupado} data-testid='correo-agente-descartar'>
              Descartar
            </Button>
          </Group>
        ) : pendiente ? (
          <Group gap='xs'>
            <Text size='xs' c='dimmed'>
              {a.estadoConcesion === 'REVOCADA' ? 'Usted revocó el acceso del agente a este hilo.' : 'Venció con el acceso del agente (24 h).'}
            </Text>
            <Button size='compact-xs' variant='subtle' color='gray' onClick={descartar} disabled={ocupado}>
              Descartar
            </Button>
          </Group>
        ) : null}
        {accionable && (
          <Text size='xs' c='dimmed'>
            {a.tipo === 'RESPUESTA' ? 'Sale desde su buzón, como respuesta al último mensaje del hilo. ' : ''}Nada se ejecuta sin su clic.
          </Text>
        )}
      </Stack>
    </Card>
  );
}
