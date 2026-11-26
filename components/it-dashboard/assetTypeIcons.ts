import type { ComponentType } from 'react';
import {
  IconAccessPoint,
  IconBox,
  IconDeviceCctv,
  IconDeviceDesktop,
  IconDeviceLaptop,
  IconDeviceMobile,
  IconDeviceTablet,
  IconDeviceTv,
  IconFingerprint,
  IconId,
  IconLock,
  IconNetwork,
  IconPhone,
  IconPresentation,
  IconPrinter,
  IconServer,
  IconShieldLock,
} from '@tabler/icons-react';

type IconComponent = ComponentType<{ size?: number; stroke?: number; color?: string }>;

/**
 * Icon for each value of type_asset (Activos module). Matched by keywords so
 * new or renamed types still get a sensible icon; anything else gets a box.
 * Order matters: more specific keywords first.
 */
const RULES: Array<{ test: RegExp; icon: IconComponent }> = [
  { test: /access.?point|\bap\b|wifi|inalambr/, icon: IconAccessPoint },
  { test: /switch|router|red\b|network/, icon: IconNetwork },
  { test: /fortinet|firewall|fortigate/, icon: IconShieldLock },
  { test: /servidor|server|nas\b/, icon: IconServer },
  { test: /impresora|printer|escaner|scanner/, icon: IconPrinter },
  { test: /monitor|pantalla/, icon: IconDeviceDesktop },
  { test: /televisor|\btv\b/, icon: IconDeviceTv },
  { test: /video.?beam|proyector/, icon: IconPresentation },
  { test: /dvr|nvr|camara|cctv/, icon: IconDeviceCctv },
  { test: /biometric|huella/, icon: IconFingerprint },
  { test: /tablet/, icon: IconDeviceTablet },
  { test: /celular|movil|smartphone/, icon: IconDeviceMobile },
  { test: /telefono|phone|diadema/, icon: IconPhone },
  { test: /tarjeta|acceso|carnet/, icon: IconId },
  { test: /candado|lock/, icon: IconLock },
  { test: /computador|portatil|laptop|pc\b|equipo/, icon: IconDeviceLaptop },
];

export function iconForAssetType(name: string): IconComponent {
  const key = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/_/g, ' ')
    .toLowerCase();
  return RULES.find((rule) => rule.test.test(key))?.icon ?? IconBox;
}
