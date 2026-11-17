'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Chip,
  Divider,
  Drawer,
  Group,
  Select,
  Stack,
  Text,
  TextInput,
  Textarea,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconAlertTriangle, IconCalendarPlus, IconLock } from '@tabler/icons-react';
import CalendarioDias from './CalendarioDias';
import { sumarAnios, sumarDias } from '../../lib/salas/fechas';
import type { TipoRepeticion } from '../../lib/salas/reglas';

export interface SalaUI {
  id: string;
  nombre: string;
  ventanaDias: number;
}

interface Choque {
  fecha: string;
  asunto: string;
  horaInicio: string;
  horaFin: string;
}

interface Props {
  opened: boolean;
  onClose: () => void;
  salas: SalaUI[];
  hoy: string;
  fechaInicial: string;
  salaInicial?: string | null;
  soloLectura: boolean;
  mensajeSoloLectura: string;
  onReservada: (mensaje: string) => void;
}

const DIAS_SEMANA = [
  { v: 1, l: 'Lun' },
  { v: 2, l: 'Mar' },
  { v: 3, l: 'Mié' },
  { v: 4, l: 'Jue' },
  { v: 5, l: 'Vie' },
  { v: 6, l: 'Sáb' },
  { v: 0, l: 'Dom' },
];

const CORREO_RE = /^[^\s@,;<>"']{1,64}@[a-z0-9.-]{1,253}\.[a-z]{2,}$/i;

export default function ReservaDrawer({
  opened,
  onClose,
  salas,
  hoy,
  fechaInicial,
  salaInicial,
  soloLectura,
  mensajeSoloLectura,
  onReservada,
}: Props) {
  const movil = useMediaQuery('(max-width: 48em)');
  const [salaId, setSalaId] = useState<string | null>(null);
  const [fecha, setFecha] = useState(fechaInicial);
  const [horaInicio, setHoraInicio] = useState('08:00');
  const [horaFin, setHoraFin] = useState('09:00');
  const [asunto, setAsunto] = useState('');
  const [invitados, setInvitados] = useState('');
  const [tipo, setTipo] = useState<TipoRepeticion>('ninguna');
  const [soloHabiles, setSoloHabiles] = useState(true);
  const [diasSemana, setDiasSemana] = useState<string[]>([]);
  const [hasta, setHasta] = useState('');
  const [fechas, setFechas] = useState<string[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [choques, setChoques] = useState<Choque[]>([]);

  useEffect(() => {
    if (!opened) return;
    setSalaId(salaInicial ?? salas[0]?.id ?? null);
    setFecha(fechaInicial < hoy ? hoy : fechaInicial);
    setError(null);
    setChoques([]);
  }, [opened, salaInicial, fechaInicial, hoy, salas]);

  const sala = salas.find((s) => s.id === salaId) ?? null;
  const fechaMaxima = sala ? sumarDias(hoy, sala.ventanaDias) : sumarDias(hoy, 15);
  const topeSerie = fecha ? sumarDias(sumarAnios(fecha, 1), -1) : fechaMaxima;
  const maxSerie = fechaMaxima < topeSerie ? fechaMaxima : topeSerie;

  const errorLocal = useMemo(() => {
    if (horaInicio && horaFin && horaFin <= horaInicio) return 'La hora de fin debe ser posterior a la hora de inicio.';
    const malos = invitados
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s && !CORREO_RE.test(s));
    if (malos.length) return `Correo de invitado no válido: ${malos.slice(0, 3).join(', ')}. Separe los correos con coma.`;
    return null;
  }, [horaInicio, horaFin, invitados]);

  const enviar = async () => {
    setError(null);
    setChoques([]);
    if (errorLocal) {
      setError(errorLocal);
      return;
    }
    setEnviando(true);
    try {
      const res = await fetch('/api/salas/reservas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salaId,
          fecha,
          horaInicio,
          horaFin,
          asunto,
          invitados,
          repeticion: {
            tipo,
            soloHabiles,
            diasSemana: diasSemana.map(Number),
            hasta: hasta || undefined,
            fechas,
          },
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? 'No se pudo crear la reserva.');
        if (Array.isArray(json.choques)) setChoques(json.choques);
        return;
      }
      const n = Number(json.creadas ?? 1);
      onReservada(
        json.pendienteConfirmacion
          ? 'Reserva creada. La sala aún no confirma; revise su calendario en unos minutos.'
          : n > 1
            ? `Reserva creada (${n} reuniones).`
            : 'Reserva creada y confirmada por la sala.'
      );
      setAsunto('');
      setInvitados('');
      setTipo('ninguna');
      setFechas([]);
      setHasta('');
    } catch {
      setError('No se pudo conectar con el servidor.');
    } finally {
      setEnviando(false);
    }
  };

  const listo = Boolean(salaId && fecha && horaInicio && horaFin && asunto.trim());

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position="right"
      size={movil ? '100%' : 'md'}
      title={
        <Group gap="xs">
          <IconCalendarPlus size={20} />
          <Text fw={600}>Reservar sala</Text>
        </Group>
      }
    >
      <Stack gap="sm">
        {soloLectura && (
          <Alert color="yellow" icon={<IconLock size={16} />} variant="light">
            {mensajeSoloLectura} Puede probar las validaciones; la reserva no se creará.
          </Alert>
        )}
        {error && (
          <Alert color="red" icon={<IconAlertTriangle size={16} />} variant="light" title="No se creó la reserva">
            <Text size="sm">{error}</Text>
            {choques.length > 0 && (
              <Stack gap={2} mt="xs">
                {choques.slice(0, 20).map((c, i) => (
                  <Text key={i} size="sm">
                    {c.fecha} · {c.horaInicio}–{c.horaFin} · {c.asunto}
                  </Text>
                ))}
                {choques.length > 20 && <Text size="sm">… y {choques.length - 20} más.</Text>}
              </Stack>
            )}
          </Alert>
        )}

        <Select
          label="Sala"
          data={salas.map((s) => ({ value: s.id, label: s.nombre }))}
          value={salaId}
          onChange={setSalaId}
          allowDeselect={false}
          required
        />
        <TextInput
          label="Fecha"
          type="date"
          value={fecha}
          min={hoy}
          max={fechaMaxima}
          onChange={(e) => setFecha(e.currentTarget.value)}
          description={sala ? `${sala.nombre} acepta reservas hasta el ${fechaMaxima}.` : undefined}
          required
        />
        <Group grow>
          <TextInput
            label="Inicio"
            type="time"
            step={900}
            value={horaInicio}
            onChange={(e) => setHoraInicio(e.currentTarget.value)}
            required
          />
          <TextInput
            label="Fin"
            type="time"
            step={900}
            value={horaFin}
            onChange={(e) => setHoraFin(e.currentTarget.value)}
            required
          />
        </Group>
        <TextInput
          label="Asunto"
          value={asunto}
          maxLength={255}
          onChange={(e) => setAsunto(e.currentTarget.value)}
          required
        />
        <Textarea
          label="Invitados"
          description="Correos separados por coma."
          placeholder="persona@gsslatam.com, otra@gsslatam.com"
          autosize
          minRows={2}
          value={invitados}
          onChange={(e) => setInvitados(e.currentTarget.value)}
        />

        <Divider label="Repetir" labelPosition="left" />
        <Select
          label="Repetición"
          value={tipo}
          onChange={(v) => setTipo((v as TipoRepeticion) ?? 'ninguna')}
          allowDeselect={false}
          data={[
            { value: 'ninguna', label: 'No se repite' },
            { value: 'diaria', label: 'Diaria' },
            { value: 'semanal', label: 'Semanal' },
            { value: 'mensual', label: 'Mensual' },
            { value: 'anual', label: 'Anual' },
            { value: 'especificos', label: 'Días específicos' },
          ]}
        />
        {tipo === 'diaria' && (
          <Checkbox
            label="Solo de lunes a viernes"
            checked={soloHabiles}
            onChange={(e) => setSoloHabiles(e.currentTarget.checked)}
          />
        )}
        {tipo === 'semanal' && (
          <Chip.Group multiple value={diasSemana} onChange={setDiasSemana}>
            <Group gap={6}>
              {DIAS_SEMANA.map((d) => (
                <Chip key={d.v} value={String(d.v)} size="sm">
                  {d.l}
                </Chip>
              ))}
            </Group>
          </Chip.Group>
        )}
        {(tipo === 'diaria' || tipo === 'semanal' || tipo === 'mensual' || tipo === 'anual') && (
          <TextInput
            label="Repetir hasta"
            type="date"
            value={hasta}
            min={fecha}
            max={maxSerie}
            onChange={(e) => setHasta(e.currentTarget.value)}
            description={`Máximo 1 año. Por la ventana de la sala, hoy se puede hasta el ${maxSerie}.`}
            required
          />
        )}
        {tipo === 'especificos' && fecha && (
          <>
            <Text size="sm" c="dimmed">
              Toque los días adicionales. La fecha de inicio ya está incluida.
            </Text>
            <CalendarioDias value={fechas} onChange={setFechas} min={fecha} max={maxSerie} />
          </>
        )}

        <Button
          mt="sm"
          size="md"
          fullWidth
          onClick={enviar}
          loading={enviando}
          disabled={!listo}
          leftSection={<IconCalendarPlus size={18} />}
        >
          Reservar
        </Button>
      </Stack>
    </Drawer>
  );
}
