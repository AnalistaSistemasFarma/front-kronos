import type { ComponentType } from 'react';
import {
  IconAddressBook,
  IconBox,
  IconBuildingFactory,
  IconBuildingStore,
  IconChartBar,
  IconChartLine,
  IconClipboardList,
  IconCloud,
  IconCreditCard,
  IconDatabase,
  IconEye,
  IconFilePlus,
  IconFileText,
  IconFolders,
  IconGitBranch,
  IconHeadset,
  IconHeartbeat,
  IconHierarchy2,
  IconInbox,
  IconLayoutDashboard,
  IconListCheck,
  IconPackages,
  IconReceipt,
  IconRosetteDiscount,
  IconServer,
  IconSettings,
  IconShieldCheck,
  IconShoppingCart,
  IconTicket,
  IconUserCheck,
  IconUsers,
  IconWorld,
  IconCash,
  IconNotes,
  IconCalendarEvent,
  IconMail,
  IconKey,
  IconTruck,
  IconBuildingBank,
} from '@tabler/icons-react';

export type ProcessAccent =
  | 'violet'
  | 'pink'
  | 'teal'
  | 'blue'
  | 'orange'
  | 'cyan'
  | 'lime'
  | 'indigo'
  | 'rose'
  | 'amber';

export const PROCESS_ACCENTS: ProcessAccent[] = [
  'violet',
  'pink',
  'teal',
  'blue',
  'orange',
  'cyan',
  'lime',
  'indigo',
  'rose',
  'amber',
];

export type TablerIcon = ComponentType<{ size?: number; stroke?: number }>;

const HEADER_ICONS: Array<{ test: RegExp; icon: TablerIcon }> = [
  { test: /help|soporte|mesa/, icon: IconHeadset },
  { test: /venta|purchase|compra/, icon: IconBuildingStore },
  { test: /admin|administr/, icon: IconSettings },
  { test: /solicitud/, icon: IconClipboardList },
  { test: /gesti[oó]n|proceso/, icon: IconFolders },
];

const SUB_RULES: Array<{ test: RegExp; icon: TablerIcon }> = [
  { test: /mis\s*ticket/, icon: IconInbox },
  { test: /^tickets?$|panel.*caso/, icon: IconTicket },
  { test: /ticket|help|soporte/, icon: IconTicket },
  { test: /usuario|user/, icon: IconUsers },
  { test: /flujo|workflow/, icon: IconGitBranch },
  { test: /mis\s*solicitud/, icon: IconClipboardList },
  { test: /crear|nueva\s*solicitud|create/, icon: IconFilePlus },
  { test: /asignad/, icon: IconUserCheck },
  { test: /ver\s*solicitud|viewer|consulta/, icon: IconEye },
  { test: /actividad|tarea/, icon: IconListCheck },
  { test: /dashboard|tablero/, icon: IconLayoutDashboard },
  { test: /autoriz/, icon: IconShieldCheck },
  { test: /orden/, icon: IconReceipt },
  { test: /oferta/, icon: IconRosetteDiscount },
  { test: /inventario|stock/, icon: IconPackages },
  { test: /reporte.*venta|venta.*reporte/, icon: IconChartLine },
  { test: /reporte|estad[ií]stic/, icon: IconChartBar },
  { test: /compra|purchase|pedido/, icon: IconShoppingCart },
  { test: /art[ií]culo|producto/, icon: IconBox },
  { test: /socio|partner|cliente|business/, icon: IconAddressBook },
  { test: /organigrama/, icon: IconHierarchy2 },
  { test: /salud|health/, icon: IconHeartbeat },
  { test: /pago|tesorer/, icon: IconCash },
  { test: /tarjeta|legaliz/, icon: IconCreditCard },
  { test: /correo|email|mail/, icon: IconMail },
  { test: /acceso|permiso|key/, icon: IconKey },
  { test: /entrega|env[ií]o|log[ií]st/, icon: IconTruck },
  { test: /banco|bank/, icon: IconBuildingBank },
  { test: /calendario|agenda/, icon: IconCalendarEvent },
  { test: /nota|comentario/, icon: IconNotes },
  { test: /farmalog|f[aá]rmac/, icon: IconHeartbeat },
  { test: /pharma|latam/, icon: IconWorld },
  { test: /ryan/, icon: IconBuildingFactory },
  { test: /sap|cloud/, icon: IconCloud },
  { test: /config|setting|ajuste/, icon: IconSettings },
];

const ICON_POOL: TablerIcon[] = [
  IconFileText,
  IconClipboardList,
  IconGitBranch,
  IconListCheck,
  IconEye,
  IconFilePlus,
  IconUserCheck,
  IconLayoutDashboard,
  IconShieldCheck,
  IconReceipt,
  IconRosetteDiscount,
  IconPackages,
  IconChartBar,
  IconChartLine,
  IconShoppingCart,
  IconBox,
  IconAddressBook,
  IconCloud,
  IconDatabase,
  IconServer,
  IconWorld,
  IconBuildingFactory,
  IconCreditCard,
  IconCash,
  IconMail,
  IconKey,
  IconTruck,
  IconNotes,
  IconCalendarEvent,
  IconInbox,
  IconTicket,
  IconUsers,
];

function hashString(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) {
    h = (h * 31 + value.charCodeAt(i)) >>> 0;
  }
  return h;
}

export function accentForProcess(index: number): ProcessAccent {
  return PROCESS_ACCENTS[index % PROCESS_ACCENTS.length];
}

export function headerIconForProcess(name: string): TablerIcon {
  const n = name.toLowerCase();
  const hit = HEADER_ICONS.find((r) => r.test.test(n));
  return hit?.icon ?? IconFolders;
}

function iconForSubprocessName(name: string): TablerIcon {
  const n = name.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  const hit = SUB_RULES.find((r) => r.test.test(n));
  return hit?.icon ?? ICON_POOL[hashString(n) % ICON_POOL.length];
}

/** Iconos distintos dentro de la misma tarjeta (aunque los nombres se parezcan). */
export function uniqueSubprocessIcons(names: string[]): TablerIcon[] {
  const used = new Set<TablerIcon>();
  return names.map((name, index) => {
    let icon = iconForSubprocessName(name);
    if (used.has(icon)) {
      const start = (hashString(name) + index) % ICON_POOL.length;
      for (let step = 0; step < ICON_POOL.length; step++) {
        const candidate = ICON_POOL[(start + step) % ICON_POOL.length];
        if (!used.has(candidate)) {
          icon = candidate;
          break;
        }
      }
    }
    used.add(icon);
    return icon;
  });
}
