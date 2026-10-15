'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  Checkbox,
  Collapse,
  Group,
  Loader,
  Modal,
  Progress,
  ScrollArea,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Textarea,
  Tooltip,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconAlertTriangle, IconCheck, IconFlask, IconMailForward, IconPaperclip, IconRefresh, IconX } from '@tabler/icons-react';
import toast from 'react-hot-toast';
import SgcSelect from '../sgc/SgcSelect';
import { rutaSolicitud, textoAcuse } from '../../lib/correo/acuse';
import { ALERTA_TEXTO, type AlertaFila, type FilaSimulacion, type ResultadoAcuse, type ResultadoCreacion } from '../../lib/correo/types';
import { correoApi, tamano, urlSolicitud, type CategoriaCorreo, type ProcesoCorreo } from './correoClient';
import { categoriaDeProceso, opcionesCategorias, opcionesProcesos, opcionesProcesosAgrupadas } from './catalogoOpciones';

/**
 * Simulación de la creación masiva: una fila EDITABLE por hilo (empresa, categoría → proceso,
 * solicitante, título, descripción, adjuntos), con alertas de duplicado, remitente
 * sin usuario, externo o autosolicitud. Nada se crea hasta «Crear N solicitudes»;
 * luego se recorre el lote fila por fila con avance y un resumen con enlaces.
 */

const PRED_KEY = 'correo:proceso-predeterminado';

/**
 * idCategoria: solo del navegador, para la cascada Categoría → Proceso (como «Nueva solicitud»).
 * acuse: responder en el hilo al crear (sigue la casilla global; se puede cambiar por fila). En
 * una fila de remitente EXTERNO arranca apagado y marcarlo es la confirmación explícita.
 */
type Fila = FilaSimulacion & { adjuntosElegidos: string[]; idCategoria: number | null; acuse: boolean; verAcuse: boolean };

const esExterna = (f: Pick<FilaSimulacion, 'alertas'>) => f.alertas.includes('EXTERNO');

/** Texto de la vista previa: el mismo del servidor, con el número aún por asignar. */
function previaAcuse(titulo: string, firma: string, idCompany: number): string {
  const origen = typeof window !== 'undefined' ? window.location.origin : '';
  return textoAcuse({ id: '(número)', titulo, enlace: `${origen}${rutaSolicitud(0).replace('id=0', 'id=(número)')}`, firma, idCompany });
}

/** ¿El acuse de este resultado necesita atención (aviso + «Reintentar respuesta»)? */
function acuseConAviso(a: ResultadoAcuse | undefined): boolean {
  return Boolean(a && (a.estado === 'ERROR' || a.estado === 'OMITIDO'));
}

function leerPred(empresa: number): number | null {
  try {
    const v = Number(window.localStorage.getItem(`${PRED_KEY}:${empresa}`));
    return Number.isInteger(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

function filaValida(f: Fila): boolean {
  return f.incluir && !f.duplicadoDe && Boolean(f.idProcess) && Boolean(f.idSolicitante) && f.titulo.trim().length >= 3 && f.descripcion.trim().length >= 3;
}

const COLOR_ALERTA: Record<AlertaFila, string> = {
  DUPLICADO: 'red',
  SIN_USUARIO: 'orange',
  EXTERNO: 'yellow',
  AUTOSOLICITUD: 'yellow',
  SIN_PROCESO: 'orange',
  SOLICITANTE_OTRA_EMPRESA: 'orange',
};

function SolicitanteSelect({ fila, empresa, onChange }: { fila: Fila; empresa: number; onChange: (id: string | null, nombre: string | null) => void }) {
  const [opciones, setOpciones] = useState<Array<{ value: string; label: string }>>(
    fila.idSolicitante ? [{ value: fila.idSolicitante, label: fila.solicitanteNombre ?? fila.remitente.correo }] : []
  );
  const [busqueda, setBusqueda] = useState('');
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (t.current) clearTimeout(t.current);
    if (busqueda.trim().length < 2) return;
    t.current = setTimeout(() => {
      correoApi
        .usuarios(empresa, busqueda)
        .then((r) => {
          setOpciones((prev) => {
            const m = new Map(prev.map((o) => [o.value, o]));
            for (const u of r.usuarios) m.set(u.id, { value: u.id, label: `${u.nombre} (${u.correo})` });
            return [...m.values()];
          });
        })
        .catch(() => undefined);
    }, 300);
  }, [busqueda, empresa]);
  return (
    <Select
      aria-label='Solicitante'
      placeholder='Buscar usuario…'
      searchable
      clearable
      data={opciones}
      value={fila.idSolicitante}
      onSearchChange={setBusqueda}
      onChange={(v) => onChange(v, opciones.find((o) => o.value === v)?.label ?? null)}
      nothingFoundMessage={busqueda.length < 2 ? 'Escriba al menos 2 letras' : 'Sin resultados'}
      comboboxProps={{ withinPortal: true }}
      size='sm'
      data-testid='correo-sim-solicitante'
    />
  );
}

export interface SimulacionModalProps {
  opened: boolean;
  mensajesIds: string[];
  empresas: Array<{ idCompany: number; companyName: string }>;
  empresaInicial: number;
  idOperador?: string;
  /** Marcar en Outlook con «SynerLink #N» (Mail.ReadWrite) habilitado en el ambiente. */
  etiquetarHabilitado?: boolean;
  /** Responder desde SynerLink (CORREO_ENVIO_HABILITADO): sin él no hay acuse en el hilo. */
  envioHabilitado?: boolean;
  /** Nombre de quien crea (firma del acuse en la vista previa). */
  nombreOperador?: string;
  onClose: (huboCreadas: boolean) => void;
}

export default function SimulacionModal({
  opened,
  mensajesIds,
  empresas,
  empresaInicial,
  idOperador,
  etiquetarHabilitado = true,
  envioHabilitado = true,
  nombreOperador = '',
  onClose,
}: SimulacionModalProps) {
  const desktop = useMediaQuery('(min-width: 62em)') ?? false;
  const [empresa, setEmpresa] = useState(empresaInicial);
  const [pred, setPred] = useState<number | null>(null);
  const [filas, setFilas] = useState<Fila[]>([]);
  const [procesos, setProcesos] = useState<ProcesoCorreo[]>([]);
  const [categorias, setCategorias] = useState<CategoriaCorreo[]>([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [etiquetar, setEtiquetar] = useState(true);
  const [acuseGlobal, setAcuseGlobal] = useState(true);
  const acuseGlobalRef = useRef(true);
  const [acuseTodos, setAcuseTodos] = useState(false);
  const [reintentando, setReintentando] = useState<string | null>(null);
  const [creando, setCreando] = useState<{ hechas: number; total: number } | null>(null);
  const [resultados, setResultados] = useState<ResultadoCreacion[] | null>(null);

  const simular = useCallback(
    async (emp: number, procPred: number | null) => {
      setCargando(true);
      setError(null);
      try {
        const r = await correoApi.simular(mensajesIds, emp, procPred);
        setProcesos(r.procesos);
        setCategorias(r.categorias ?? []);
        setFilas(
          r.filas.map((f) => ({
            ...f,
            adjuntosElegidos: f.adjuntos.map((a) => a.id),
            idCategoria: categoriaDeProceso(r.procesos, f.idProcess),
            acuse: acuseGlobalRef.current && !esExterna(f),
            verAcuse: false,
          }))
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setFilas([]);
      } finally {
        setCargando(false);
      }
    },
    [mensajesIds]
  );

  useEffect(() => {
    if (!opened) return;
    setEmpresa(empresaInicial);
    const p = leerPred(empresaInicial);
    setPred(p);
    setResultados(null);
    setCreando(null);
    void simular(empresaInicial, p);
  }, [opened, empresaInicial, simular]);

  const categoriaData = useMemo(() => opcionesCategorias(categorias), [categorias]);
  const procesoAgrupado = useMemo(() => opcionesProcesosAgrupadas(categorias, procesos), [categorias, procesos]);
  const responsables = useMemo(() => new Map(procesos.map((p) => [p.id, p.responsables ?? []])), [procesos]);

  const actualizar = (i: number, cambio: Partial<Fila>) =>
    setFilas((prev) =>
      prev.map((f, j) => {
        if (j !== i) return f;
        const n = { ...f, ...cambio };
        // Recalcula las alertas que dependen de lo editable. Las del solicitante solo siguen
        // valiendo si no se cambió; la búsqueda solo ofrece usuarios de la empresa.
        const cambioSolicitante = n.idSolicitante !== f.idSolicitante;
        const alertas: AlertaFila[] = n.alertas.filter(
          (a) => a === 'DUPLICADO' || a === 'EXTERNO' || (!cambioSolicitante && (a === 'AUTOSOLICITUD' || a === 'SOLICITANTE_OTRA_EMPRESA'))
        );
        if (cambioSolicitante && n.idSolicitante && idOperador && n.idSolicitante === idOperador) alertas.push('AUTOSOLICITUD');
        if (!n.idSolicitante) alertas.push('SIN_USUARIO');
        if (!n.idProcess) alertas.push('SIN_PROCESO');
        return { ...n, alertas };
      })
    );

  const validas = filas.filter(filaValida);

  const crear = async () => {
    const lote = filas.filter(filaValida);
    if (lote.length === 0) return;
    setCreando({ hechas: 0, total: lote.length });
    const out: ResultadoCreacion[] = [];
    for (const f of lote) {
      try {
        const r = await correoApi.crear({
          conversationId: f.conversationId,
          mensajeId: f.mensajeId,
          mensajesIds: f.mensajesIds,
          idCompany: empresa,
          idProcess: f.idProcess,
          idSolicitante: f.idSolicitante,
          titulo: f.titulo,
          descripcion: f.descripcion,
          adjuntosIds: f.adjuntosElegidos,
          etiquetar: etiquetar && etiquetarHabilitado,
          // Fila externa: marcar «Responder» en ella ES la confirmación explícita.
          acuse: { enviar: envioHabilitado && f.acuse, todos: acuseTodos, confirmarExterno: f.acuse && esExterna(f) },
        });
        out.push(r);
      } catch (e) {
        out.push({ conversationId: f.conversationId, ok: false, error: e instanceof Error ? e.message : String(e), duplicado: (e as { code?: string }).code === 'DUPLICADO' });
      }
      setCreando({ hechas: out.length, total: lote.length });
    }
    setResultados(out);
    setCreando(null);
    const ok = out.filter((r) => r.ok).length;
    if (ok === out.length) toast.success(`Se crearon ${ok} solicitudes.`);
    else toast.error(`Se crearon ${ok} de ${out.length} solicitudes. Revise el detalle.`);
  };

  /** Casilla global: la aplica a todas las filas (las externas siguen apagadas hasta confirmarlas una a una). */
  const cambiarAcuseGlobal = (v: boolean) => {
    setAcuseGlobal(v);
    acuseGlobalRef.current = v;
    setFilas((prev) => prev.map((f) => ({ ...f, acuse: v && !esExterna(f) })));
  };

  const reintentarAcuse = async (r: ResultadoCreacion) => {
    const confirmar = r.acuse?.codigo === 'EXTERNO_SIN_CONFIRMAR';
    setReintentando(r.conversationId);
    try {
      const { acuse } = await correoApi.reintentarAcuse(r.conversationId, acuseTodos, confirmar);
      setResultados((prev) => prev?.map((x) => (x.conversationId === r.conversationId ? { ...x, acuse } : x)) ?? prev);
      if (acuse.estado === 'ENVIADO' || acuse.estado === 'YA_ENVIADO') toast.success(`Respuesta enviada en el hilo de la solicitud #${r.idRequest}.`);
      else toast.error(acuse.mensaje ?? 'No se pudo enviar la respuesta.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setReintentando(null);
    }
  };

  const estadoAcuse = (r: ResultadoCreacion) => {
    const a = r.acuse;
    if (!a || a.estado === 'DESHABILITADO') return null;
    if (a.estado === 'ENVIADO' || a.estado === 'YA_ENVIADO') return <Text span size='sm' c='teal.8'>{' · respuesta enviada en el hilo'}</Text>;
    return (
      <Group gap={6} mt={2} wrap='wrap' data-testid='correo-sim-acuse-aviso'>
        <Text span size='sm' c='orange.8'>
          <IconAlertTriangle size={14} style={{ verticalAlign: 'middle' }} /> La solicitud quedó creada, pero no se respondió en el hilo: {a.mensaje ?? 'error'}
        </Text>
        {(a.estado === 'ERROR' || a.codigo === 'EXTERNO_SIN_CONFIRMAR') && (
          <Button
            size='compact-xs'
            variant='light'
            color='orange'
            leftSection={<IconMailForward size={14} />}
            loading={reintentando === r.conversationId}
            onClick={() => reintentarAcuse(r)}
            data-testid='correo-sim-reintentar-acuse'
          >
            {a.codigo === 'EXTERNO_SIN_CONFIRMAR' ? 'Confirmar y responder' : 'Reintentar respuesta'}
          </Button>
        )}
      </Group>
    );
  };

  const resumen = resultados && (() => {
    const ok = resultados.filter((r) => r.ok);
    const fallidas = resultados.filter((r) => !r.ok);
    const conAvisos = ok.filter((r) => (r.adjuntosFallidos?.length ?? 0) > 0 || r.etiquetado === false || acuseConAviso(r.acuse));
    const color = fallidas.length ? 'red' : conAvisos.length ? 'yellow' : 'green';
    const asunto = (conv: string) => filas.find((f) => f.conversationId === conv)?.titulo ?? conv;
    return (
      <Alert color={color} icon={fallidas.length ? <IconAlertTriangle size={18} /> : <IconCheck size={18} />} title={`Se crearon ${ok.length} de ${resultados.length} solicitudes`} data-testid='correo-sim-resultado'>
        <Stack gap={4}>
          {ok.map((r) => (
            <Text size='sm' key={r.conversationId}>
              <Anchor href={urlSolicitud(r.idRequest!)} target='_blank'>
                Solicitud #{r.idRequest}
              </Anchor>{' '}
              — {asunto(r.conversationId)}
              {r.adjuntosSubidos ? ` · ${r.adjuntosSubidos} adjunto(s)` : ''}
              {r.adjuntosFallidos?.length ? ` · adjuntos con error: ${r.adjuntosFallidos.join('; ')}` : ''}
              {r.etiquetado === false && etiquetar ? ' · no se pudo etiquetar en Outlook' : ''}
              {estadoAcuse(r)}
            </Text>
          ))}
          {fallidas.map((r) => (
            <Text size='sm' c='red.8' key={r.conversationId}>
              {asunto(r.conversationId)}: {r.error}
            </Text>
          ))}
        </Stack>
      </Alert>
    );
  })();

  const alertasDe = (f: Fila) => (
    <Group gap={4}>
      {f.alertas.map((a) => (
        <Tooltip key={a} label={ALERTA_TEXTO[a]} withArrow multiline w={240}>
          <Badge color={COLOR_ALERTA[a]} variant='light' size='sm'>
            {a === 'DUPLICADO' && f.duplicadoDe ? `Ya es la #${f.duplicadoDe}` : ALERTA_TEXTO[a].split(':')[0]}
          </Badge>
        </Tooltip>
      ))}
    </Group>
  );

  const adjuntosDe = (f: Fila, i: number) =>
    f.adjuntos.length === 0 ? (
      <Text size='xs' c='dimmed'>
        Sin adjuntos
      </Text>
    ) : (
      <Stack gap={2}>
        {f.adjuntos.map((a) => (
          <Checkbox
            key={a.id}
            size='xs'
            label={`${a.nombre} (${tamano(a.tamano)})`}
            checked={f.adjuntosElegidos.includes(a.id)}
            onChange={(e) =>
              actualizar(i, { adjuntosElegidos: e.currentTarget.checked ? [...f.adjuntosElegidos, a.id] : f.adjuntosElegidos.filter((x) => x !== a.id) })
            }
          />
        ))}
      </Stack>
    );

  const campos = (f: Fila, i: number) => ({
    incluir: (
      <Checkbox
        aria-label='Incluir'
        checked={f.incluir && !f.duplicadoDe}
        disabled={Boolean(f.duplicadoDe) || Boolean(creando)}
        onChange={(e) => actualizar(i, { incluir: e.currentTarget.checked })}
        data-testid='correo-sim-incluir'
      />
    ),
    proceso: (
      <Stack gap={4}>
        <Select
          aria-label='Categoría'
          placeholder='Elija la categoría'
          searchable
          data={categoriaData}
          value={f.idCategoria ? String(f.idCategoria) : null}
          onChange={(v) => {
            const c = v ? Number(v) : null;
            if (c === f.idCategoria) return;
            actualizar(i, { idCategoria: c, idProcess: null, procesoSugeridoPor: null });
          }}
          nothingFoundMessage='Sin categorías'
          comboboxProps={{ withinPortal: true }}
          size='sm'
          data-testid='correo-sim-categoria'
        />
        <Select
          aria-label='Proceso'
          placeholder={f.idCategoria ? 'Elija el proceso' : 'Primero elija la categoría'}
          searchable
          disabled={!f.idCategoria}
          data={opcionesProcesos(procesos, f.idCategoria)}
          nothingFoundMessage='Esta categoría no tiene procesos activos'
          value={f.idProcess ? String(f.idProcess) : null}
          onChange={(v) => actualizar(i, { idProcess: v ? Number(v) : null, procesoSugeridoPor: null })}
          comboboxProps={{ withinPortal: true }}
          size='sm'
          data-testid='correo-sim-proceso'
        />
        {f.idProcess && (responsables.get(f.idProcess)?.length ?? 0) > 0 && (
          <Text size='xs' c='dimmed'>
            Se asigna a: {responsables.get(f.idProcess)!.join(', ')}
          </Text>
        )}
        {f.procesoSugeridoPor === 'palabra-clave' && (
          <Text size='xs' c='teal.7'>
            Sugerido por el asunto
          </Text>
        )}
      </Stack>
    ),
    solicitante: (
      <Stack gap={2}>
        <SolicitanteSelect fila={f} empresa={empresa} onChange={(id, nombre) => actualizar(i, { idSolicitante: id, solicitanteNombre: nombre })} />
        <Text size='xs' c='dimmed'>
          Remitente: {f.remitente.nombre} &lt;{f.remitente.correo}&gt;
        </Text>
      </Stack>
    ),
    titulo: <TextInput aria-label='Título' value={f.titulo} maxLength={255} onChange={(e) => actualizar(i, { titulo: e.currentTarget.value })} size='sm' data-testid='correo-sim-titulo' />,
    acuse: !envioHabilitado ? null : (
      <Stack gap={4}>
        <Checkbox
          size='sm'
          label={esExterna(f) ? 'Responder (remitente externo: lo confirmo)' : 'Responder en el hilo'}
          checked={f.acuse}
          disabled={Boolean(creando)}
          onChange={(e) => actualizar(i, { acuse: e.currentTarget.checked })}
          data-testid='correo-sim-acuse-fila'
        />
        {f.acuse && (
          <>
            <Anchor component='button' type='button' size='xs' onClick={() => actualizar(i, { verAcuse: !f.verAcuse })} data-testid='correo-sim-acuse-ver'>
              {f.verAcuse ? 'Ocultar vista previa' : 'Ver la respuesta'}
            </Anchor>
            <Collapse in={f.verAcuse}>
              <Text
                size='xs'
                p='xs'
                bg='var(--mantine-color-gray-0)'
                style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', borderRadius: 'var(--mantine-radius-sm)', border: '1px solid var(--mantine-color-gray-3)' }}
                data-testid='correo-sim-acuse-previa'
              >
                {previaAcuse(f.titulo, nombreOperador, empresa)}
              </Text>
            </Collapse>
          </>
        )}
      </Stack>
    ),
    descripcion: (
      <Textarea aria-label='Descripción' value={f.descripcion} maxLength={1000} autosize minRows={2} maxRows={6} onChange={(e) => actualizar(i, { descripcion: e.currentTarget.value })} size='sm' />
    ),
  });

  return (
    <Modal
      opened={opened}
      onClose={() => !creando && onClose(Boolean(resultados?.some((r) => r.ok)))}
      title={
        <Group gap='xs'>
          <IconFlask size={20} />
          <Text fw={700}>Simulación: crear solicitudes desde correos</Text>
        </Group>
      }
      size={desktop ? '95%' : '100%'}
      fullScreen={!desktop}
      closeOnClickOutside={!creando}
      data-testid='correo-simulacion'
    >
      <Stack gap='md'>
        {resumen}
        {error && (
          <Alert color='red' icon={<IconAlertTriangle size={18} />} title='No se pudo simular'>
            {error}
          </Alert>
        )}
        <Group align='flex-end' wrap='wrap' gap='sm'>
          {empresas.length > 1 && (
            <SgcSelect
              label='Empresa'
              data={empresas.map((e) => ({ value: String(e.idCompany), label: e.companyName }))}
              value={String(empresa)}
              onChange={(v) => {
                if (!v) return;
                const n = Number(v);
                setEmpresa(n);
                setProcesos([]);
                setCategorias([]);
                const p = leerPred(n);
                setPred(p);
                void simular(n, p);
              }}
              allowDeselect={false}
              disabled={Boolean(creando) || Boolean(resultados)}
              w={{ base: '100%', sm: 240 }}
            />
          )}
          <Select
            label='Proceso por defecto'
            description='Si el asunto no sugiere otro'
            placeholder='Ninguno'
            searchable
            clearable
            data={procesoAgrupado}
            value={pred ? String(pred) : null}
            onChange={(v) => {
              const n = v ? Number(v) : null;
              setPred(n);
              try {
                if (n) window.localStorage.setItem(`${PRED_KEY}:${empresa}`, String(n));
                else window.localStorage.removeItem(`${PRED_KEY}:${empresa}`);
              } catch {
                /* sin almacenamiento */
              }
            }}
            disabled={Boolean(creando) || Boolean(resultados)}
            w={{ base: '100%', sm: 320 }}
            comboboxProps={{ withinPortal: true }}
          />
          <Button variant='light' leftSection={<IconRefresh size={16} />} onClick={() => simular(empresa, pred)} disabled={cargando || Boolean(creando) || Boolean(resultados)}>
            Volver a simular
          </Button>
        </Group>

        {cargando ? (
          <Group justify='center' p='xl'>
            <Loader />
            <Text c='dimmed'>Leyendo los correos seleccionados…</Text>
          </Group>
        ) : filas.length > 0 && !resultados ? (
          <>
            <Alert color={validas.length === filas.length ? 'blue' : 'yellow'} icon={<IconFlask size={18} />} data-testid='correo-sim-resumen'>
              {filas.length} hilo(s) en la simulación: <b>{validas.length}</b> listo(s) para crear
              {filas.length - validas.length > 0 ? `, ${filas.length - validas.length} excluido(s) o con datos pendientes` : ''}. Revise y edite antes de crear;
              nada se ha creado todavía.
            </Alert>
            {desktop ? (
              <ScrollArea type='auto'>
                <Table verticalSpacing='sm' striped withTableBorder miw={1100} data-testid='correo-sim-tabla'>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th w={60}>Incluir</Table.Th>
                      <Table.Th w={260}>Categoría y proceso</Table.Th>
                      <Table.Th w={240}>Solicitante</Table.Th>
                      <Table.Th>Título y descripción</Table.Th>
                      <Table.Th w={200}>Adjuntos</Table.Th>
                      {envioHabilitado && <Table.Th w={220}>Respuesta en el hilo</Table.Th>}
                      <Table.Th w={170}>Alertas</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {filas.map((f, i) => {
                      const c = campos(f, i);
                      return (
                        <Table.Tr key={f.conversationId} data-testid='correo-sim-fila' style={{ opacity: f.incluir && !f.duplicadoDe ? 1 : 0.55 }}>
                          <Table.Td>{c.incluir}</Table.Td>
                          <Table.Td>{c.proceso}</Table.Td>
                          <Table.Td>{c.solicitante}</Table.Td>
                          <Table.Td>
                            <Stack gap={6}>
                              {c.titulo}
                              {c.descripcion}
                            </Stack>
                          </Table.Td>
                          <Table.Td>{adjuntosDe(f, i)}</Table.Td>
                          {envioHabilitado && <Table.Td>{c.acuse}</Table.Td>}
                          <Table.Td>{alertasDe(f)}</Table.Td>
                        </Table.Tr>
                      );
                    })}
                  </Table.Tbody>
                </Table>
              </ScrollArea>
            ) : (
              <Stack gap='sm' data-testid='correo-sim-tarjetas'>
                {filas.map((f, i) => {
                  const c = campos(f, i);
                  return (
                    <Card key={f.conversationId} withBorder radius='md' p='sm' data-testid='correo-sim-fila' style={{ opacity: f.incluir && !f.duplicadoDe ? 1 : 0.6 }}>
                      <Stack gap='xs'>
                        <Group justify='space-between' wrap='nowrap'>
                          <Group gap='xs' wrap='nowrap'>
                            {c.incluir}
                            <Text size='sm' fw={600} lineClamp={2}>
                              {f.titulo}
                            </Text>
                          </Group>
                        </Group>
                        {alertasDe(f)}
                        <Text size='xs' fw={600}>
                          Categoría y proceso
                        </Text>
                        {c.proceso}
                        <Text size='xs' fw={600}>
                          Solicitante
                        </Text>
                        {c.solicitante}
                        <Text size='xs' fw={600}>
                          Título
                        </Text>
                        {c.titulo}
                        <Text size='xs' fw={600}>
                          Descripción
                        </Text>
                        {c.descripcion}
                        <Group gap={4}>
                          <IconPaperclip size={14} />
                          <Text size='xs' fw={600}>
                            Adjuntos
                          </Text>
                        </Group>
                        {adjuntosDe(f, i)}
                        {c.acuse && (
                          <>
                            <Group gap={4}>
                              <IconMailForward size={14} />
                              <Text size='xs' fw={600}>
                                Respuesta en el hilo
                              </Text>
                            </Group>
                            {c.acuse}
                          </>
                        )}
                      </Stack>
                    </Card>
                  );
                })}
              </Stack>
            )}
            {creando && (
              <Stack gap={4} data-testid='correo-sim-avance'>
                <Text size='sm'>
                  Creando {creando.hechas} de {creando.total}…
                </Text>
                <Progress value={(creando.hechas / creando.total) * 100} animated />
              </Stack>
            )}
            {envioHabilitado ? (
              <Card withBorder radius='md' p='sm' data-testid='correo-sim-acuse'>
                <Stack gap={6}>
                  <Group justify='space-between' wrap='wrap' gap='sm'>
                    <Switch
                      checked={acuseGlobal}
                      onChange={(e) => cambiarAcuseGlobal(e.currentTarget.checked)}
                      label='Responder automáticamente en el hilo'
                      description='Al crear cada solicitud se le responde al remitente con el número del caso y el enlace.'
                      disabled={Boolean(creando)}
                      data-testid='correo-sim-acuse-global'
                    />
                    <SegmentedControl
                      size='xs'
                      value={acuseTodos ? 'todos' : 'remitente'}
                      onChange={(v) => setAcuseTodos(v === 'todos')}
                      data={[
                        { value: 'remitente', label: 'Responder' },
                        { value: 'todos', label: 'Responder a todos' },
                      ]}
                      disabled={Boolean(creando) || !acuseGlobal}
                      data-testid='correo-sim-acuse-todos'
                    />
                  </Group>
                  {filas.some(esExterna) && (
                    <Text size='xs' c='dimmed'>
                      A los remitentes externos no se les responde salvo que lo confirme en su fila.
                    </Text>
                  )}
                </Stack>
              </Card>
            ) : (
              <Text size='xs' c='dimmed' data-testid='correo-sim-acuse-deshabilitado'>
                La respuesta automática en el hilo no está habilitada en este ambiente.
              </Text>
            )}
            <Group justify='space-between' wrap='wrap' gap='sm'>
              {etiquetarHabilitado ? (
                <Switch
                  checked={etiquetar}
                  onChange={(e) => setEtiquetar(e.currentTarget.checked)}
                  label='Marcar los correos en Outlook con la categoría «SynerLink #número»'
                  disabled={Boolean(creando)}
                />
              ) : (
                <span />
              )}
              <Group gap='sm'>
                <Button variant='default' leftSection={<IconX size={16} />} onClick={() => onClose(false)} disabled={Boolean(creando)}>
                  Cancelar
                </Button>
                <Button onClick={crear} loading={Boolean(creando)} disabled={validas.length === 0} leftSection={<IconCheck size={16} />} data-testid='correo-sim-crear'>
                  Crear {validas.length} solicitud{validas.length === 1 ? '' : 'es'}
                </Button>
              </Group>
            </Group>
          </>
        ) : null}
        {resultados && (
          <Group justify='flex-end'>
            <Button onClick={() => onClose(resultados.some((r) => r.ok))} data-testid='correo-sim-cerrar'>
              Cerrar
            </Button>
          </Group>
        )}
      </Stack>
    </Modal>
  );
}
