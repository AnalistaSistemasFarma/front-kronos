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
import DayPicker from './DayPicker';
import { addDays, addYears } from '../../lib/rooms/dates';
import type { RecurrenceType } from '../../lib/rooms/rules';

export interface RoomOption {
  id: string;
  name: string;
  windowDays: number;
}

interface Conflict {
  date: string;
  subject: string;
  startTime: string;
  endTime: string;
}

interface Props {
  opened: boolean;
  onClose: () => void;
  rooms: RoomOption[];
  today: string;
  initialDate: string;
  initialRoom?: string | null;
  readOnly: boolean;
  readOnlyMessage: string;
  onBooked: (message: string) => void;
}

const WEEK_DAYS = [
  { v: 1, l: 'Lun' },
  { v: 2, l: 'Mar' },
  { v: 3, l: 'Mié' },
  { v: 4, l: 'Jue' },
  { v: 5, l: 'Vie' },
  { v: 6, l: 'Sáb' },
  { v: 0, l: 'Dom' },
];

const EMAIL_RE = /^[^\s@,;<>"']{1,64}@[a-z0-9.-]{1,253}\.[a-z]{2,}$/i;

/** Booking form (full screen on mobile). UI texts in Spanish. */
export default function BookingDrawer({
  opened,
  onClose,
  rooms,
  today,
  initialDate,
  initialRoom,
  readOnly,
  readOnlyMessage,
  onBooked,
}: Props) {
  const isMobile = useMediaQuery('(max-width: 48em)');
  const [roomId, setRoomId] = useState<string | null>(null);
  const [date, setDate] = useState(initialDate);
  const [startTime, setStartTime] = useState('08:00');
  const [endTime, setEndTime] = useState('09:00');
  const [subject, setSubject] = useState('');
  const [attendees, setAttendees] = useState('');
  const [type, setType] = useState<RecurrenceType>('none');
  const [weekdaysOnly, setWeekdaysOnly] = useState(true);
  const [daysOfWeek, setDaysOfWeek] = useState<string[]>([]);
  const [until, setUntil] = useState('');
  const [dates, setDates] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);

  useEffect(() => {
    if (!opened) return;
    setRoomId(initialRoom ?? rooms[0]?.id ?? null);
    setDate(initialDate < today ? today : initialDate);
    setError(null);
    setConflicts([]);
  }, [opened, initialRoom, initialDate, today, rooms]);

  const room = rooms.find((r) => r.id === roomId) ?? null;
  const maxDate = room ? addDays(today, room.windowDays) : addDays(today, 15);
  const seriesCap = date ? addDays(addYears(date, 1), -1) : maxDate;
  const maxSeries = maxDate < seriesCap ? maxDate : seriesCap;

  const localError = useMemo(() => {
    if (startTime && endTime && endTime <= startTime) return 'La hora de fin debe ser posterior a la hora de inicio.';
    const bad = attendees
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s && !EMAIL_RE.test(s));
    if (bad.length) return `Correo de invitado no válido: ${bad.slice(0, 3).join(', ')}. Separe los correos con coma.`;
    return null;
  }, [startTime, endTime, attendees]);

  const submit = async () => {
    setError(null);
    setConflicts([]);
    if (localError) {
      setError(localError);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/rooms/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId,
          date,
          startTime,
          endTime,
          subject,
          attendees,
          recurrence: {
            type,
            weekdaysOnly,
            daysOfWeek: daysOfWeek.map(Number),
            until: until || undefined,
            dates,
          },
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? 'No se pudo crear la reserva.');
        if (Array.isArray(json.conflicts)) setConflicts(json.conflicts);
        return;
      }
      const n = Number(json.created ?? 1);
      onBooked(
        json.pendingConfirmation
          ? 'Reserva creada. La sala aún no confirma; revise su calendario en unos minutos.'
          : n > 1
            ? `Reserva creada (${n} reuniones).`
            : 'Reserva creada y confirmada por la sala.'
      );
      setSubject('');
      setAttendees('');
      setType('none');
      setDates([]);
      setUntil('');
    } catch {
      setError('No se pudo conectar con el servidor.');
    } finally {
      setSubmitting(false);
    }
  };

  const ready = Boolean(roomId && date && startTime && endTime && subject.trim());

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position="right"
      size={isMobile ? '100%' : 'md'}
      title={
        <Group gap="xs">
          <IconCalendarPlus size={20} />
          <Text fw={600}>Reservar sala</Text>
        </Group>
      }
    >
      <Stack gap="sm">
        {readOnly && (
          <Alert color="yellow" icon={<IconLock size={16} />} variant="light">
            {readOnlyMessage} Puede probar las validaciones; la reserva no se creará.
          </Alert>
        )}
        {error && (
          <Alert color="red" icon={<IconAlertTriangle size={16} />} variant="light" title="No se creó la reserva">
            <Text size="sm">{error}</Text>
            {conflicts.length > 0 && (
              <Stack gap={2} mt="xs">
                {conflicts.slice(0, 20).map((c, i) => (
                  <Text key={i} size="sm">
                    {c.date} · {c.startTime}–{c.endTime} · {c.subject}
                  </Text>
                ))}
                {conflicts.length > 20 && <Text size="sm">… y {conflicts.length - 20} más.</Text>}
              </Stack>
            )}
          </Alert>
        )}

        <Select
          label="Sala"
          data={rooms.map((r) => ({ value: r.id, label: r.name }))}
          value={roomId}
          onChange={setRoomId}
          allowDeselect={false}
          required
        />
        <TextInput
          label="Fecha"
          type="date"
          value={date}
          min={today}
          max={maxDate}
          onChange={(e) => setDate(e.currentTarget.value)}
          description={room ? `${room.name} acepta reservas hasta el ${maxDate}.` : undefined}
          required
        />
        <Group grow>
          <TextInput
            label="Inicio"
            type="time"
            step={900}
            value={startTime}
            onChange={(e) => setStartTime(e.currentTarget.value)}
            required
          />
          <TextInput
            label="Fin"
            type="time"
            step={900}
            value={endTime}
            onChange={(e) => setEndTime(e.currentTarget.value)}
            required
          />
        </Group>
        <TextInput
          label="Asunto"
          value={subject}
          maxLength={255}
          onChange={(e) => setSubject(e.currentTarget.value)}
          required
        />
        <Textarea
          label="Invitados"
          description="Correos separados por coma."
          placeholder="persona@gsslatam.com, otra@gsslatam.com"
          autosize
          minRows={2}
          value={attendees}
          onChange={(e) => setAttendees(e.currentTarget.value)}
        />

        <Divider label="Repetir" labelPosition="left" />
        <Select
          label="Repetición"
          value={type}
          onChange={(v) => setType((v as RecurrenceType) ?? 'none')}
          allowDeselect={false}
          data={[
            { value: 'none', label: 'No se repite' },
            { value: 'daily', label: 'Diaria' },
            { value: 'weekly', label: 'Semanal' },
            { value: 'monthly', label: 'Mensual' },
            { value: 'yearly', label: 'Anual' },
            { value: 'specific', label: 'Días específicos' },
          ]}
        />
        {type === 'daily' && (
          <Checkbox
            label="Solo de lunes a viernes"
            checked={weekdaysOnly}
            onChange={(e) => setWeekdaysOnly(e.currentTarget.checked)}
          />
        )}
        {type === 'weekly' && (
          <Chip.Group multiple value={daysOfWeek} onChange={setDaysOfWeek}>
            <Group gap={6}>
              {WEEK_DAYS.map((d) => (
                <Chip key={d.v} value={String(d.v)} size="sm">
                  {d.l}
                </Chip>
              ))}
            </Group>
          </Chip.Group>
        )}
        {(type === 'daily' || type === 'weekly' || type === 'monthly' || type === 'yearly') && (
          <TextInput
            label="Repetir hasta"
            type="date"
            value={until}
            min={date}
            max={maxSeries}
            onChange={(e) => setUntil(e.currentTarget.value)}
            description={`Máximo 1 año. Por la ventana de la sala, hoy se puede hasta el ${maxSeries}.`}
            required
          />
        )}
        {type === 'specific' && date && (
          <>
            <Text size="sm" c="dimmed">
              Toque los días adicionales. La fecha de inicio ya está incluida.
            </Text>
            <DayPicker value={dates} onChange={setDates} min={date} max={maxSeries} />
          </>
        )}

        <Button
          mt="sm"
          size="md"
          fullWidth
          onClick={submit}
          loading={submitting}
          disabled={!ready}
          leftSection={<IconCalendarPlus size={18} />}
        >
          Reservar
        </Button>
      </Stack>
    </Drawer>
  );
}
