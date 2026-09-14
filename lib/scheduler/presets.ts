/**
 * Presets de programación para el servicio central de tareas automáticas (scheduler).
 * Módulo PURO y cliente-seguro: sin cron-parser ni dependencias de servidor, para poder
 * importarlo desde la UI (admin-workflow) y desde el backend por igual.
 *
 * Cada preset se traduce a una expresión cron de 5 campos (min hora díaMes mes díaSemana)
 * a partir de la fecha/hora de inicio elegida por el usuario.
 */

export const CUSTOM_CRON_KEY = 'custom';

export const SCHEDULE_PRESETS: { value: string; label: string }[] = [
  { value: 'daily', label: 'Diaria' },
  { value: 'weekly', label: 'Semanal' },
  { value: 'monthly', label: 'Mensual' },
  { value: 'bimonthly', label: 'Bimestral' },
  { value: 'quarterly', label: 'Trimestral' },
  { value: 'four_monthly', label: 'Cuatrimestral' },
  { value: 'semiannual', label: 'Semestral' },
  { value: 'annual', label: 'Anual' },
  { value: CUSTOM_CRON_KEY, label: 'Cron personalizado' },
];

export const PRESET_LABELS: Record<string, string> = Object.fromEntries(
  SCHEDULE_PRESETS.map((p) => [p.value, p.label])
);

/**
 * Los días 29-31 se programan como 28 para que el cron no salte los meses cortos
 * (febrero, meses de 30 días). Mostrar el hint correspondiente en la UI.
 */
export const DAY_CLAMP_HINT =
  'Los días 29-31 se programan como día 28 para no saltar meses cortos.';

function parseTime(time: string): { minute: number; hour: number } {
  const [h, m] = (time || '06:00').split(':');
  const hour = Math.min(23, Math.max(0, parseInt(h, 10) || 0));
  const minute = Math.min(59, Math.max(0, parseInt(m, 10) || 0));
  return { minute, hour };
}

/**
 * Construye la expresión cron del preset según la fecha de inicio (YYYY-MM-DD) y la hora
 * (HH:mm). Devuelve null si el preset es desconocido o la fecha es inválida
 * (para 'custom' también devuelve null: el cron lo escribe el usuario).
 */
export function buildCronFromPreset(
  preset: string,
  startDate: string,
  time: string
): string | null {
  const { minute, hour } = parseTime(time);
  const date = new Date(`${startDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;

  const dayOfMonth = Math.min(28, date.getDate());
  const month = date.getMonth() + 1; // 1-12
  const dayOfWeek = date.getDay(); // 0=domingo

  switch (preset) {
    case 'daily':
      return `${minute} ${hour} * * *`;
    case 'weekly':
      return `${minute} ${hour} * * ${dayOfWeek}`;
    case 'monthly':
      return `${minute} ${hour} ${dayOfMonth} * *`;
    case 'bimonthly':
      return `${minute} ${hour} ${dayOfMonth} */2 *`;
    case 'quarterly':
      return `${minute} ${hour} ${dayOfMonth} */3 *`;
    case 'four_monthly':
      return `${minute} ${hour} ${dayOfMonth} */4 *`;
    case 'semiannual':
      return `${minute} ${hour} ${dayOfMonth} */6 *`;
    case 'annual':
      return `${minute} ${hour} ${dayOfMonth} ${month} *`;
    default:
      return null;
  }
}

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/**
 * Descripción legible best-effort de una expresión cron de 5 campos (para la tabla de la
 * UI cuando no se conoce el preset). Si no reconoce el patrón devuelve el cron tal cual.
 */
export function describeCron(cron: string): string {
  const parts = (cron || '').trim().split(/\s+/);
  if (parts.length !== 5) return cron;
  const [min, hour, dom, mon, dow] = parts;

  const isNum = (s: string) => /^\d+$/.test(s);
  if (!isNum(min) || !isNum(hour)) return cron;
  const time = `${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;

  if (dom === '*' && mon === '*' && dow === '*') return `Diaria a las ${time}`;
  if (dom === '*' && mon === '*' && isNum(dow)) {
    const day = WEEKDAYS[parseInt(dow, 10) % 7];
    return `Semanal los ${day} a las ${time}`;
  }
  if (isNum(dom) && dow === '*') {
    const everyMatch = /^\*\/(\d+)$/.exec(mon);
    if (mon === '*') return `Mensual el día ${dom} a las ${time}`;
    if (everyMatch) {
      const n = parseInt(everyMatch[1], 10);
      const label =
        n === 2 ? 'Bimestral' : n === 3 ? 'Trimestral' : n === 4 ? 'Cuatrimestral' : n === 6 ? 'Semestral' : `Cada ${n} meses`;
      return `${label} el día ${dom} a las ${time}`;
    }
    if (isNum(mon)) {
      const monthName = MONTHS[(parseInt(mon, 10) - 1 + 12) % 12];
      return `Anual el ${dom} de ${monthName} a las ${time}`;
    }
  }
  return cron;
}
