'use client';

import { IconChecklist, IconUsersGroup } from '@tabler/icons-react';
import {
  useSolicitadoTab,
  type SolicitadoTab,
} from '../../lib/request-general/SolicitadoTabContext';
import { useSolicitadoData } from './SolicitadoShell';
import { panelStyles } from '../ui/panel/Panel';

const navItems: {
  tab: SolicitadoTab;
  label: string;
  description: string;
  icon: typeof IconChecklist;
}[] = [
  {
    tab: 'procesos',
    label: 'Mi trabajo',
    description: 'Tus actividades y las solicitudes de tus procesos',
    icon: IconChecklist,
  },
  {
    tab: 'equipo',
    label: 'Mi equipo',
    description: 'Carga de tus colaboradores',
    icon: IconUsersGroup,
  },
];

/** Pestañas tipo píldora (mismo estilo del Monitor del sistema). */
export default function SolicitadoNav() {
  const { activeTab, setActiveTab } = useSolicitadoTab();
  const { access } = useSolicitadoData();
  const items = navItems.filter((item) => (item.tab === 'equipo' ? access.equipo : access.personal));

  if (items.length < 2) return null;

  return (
    <nav className={panelStyles.tabList} aria-label='Secciones del Dashboard personal'>
      {items.map((item) => {
        const isActive = activeTab === item.tab;
        const Icon = item.icon;
        return (
          <button
            key={item.tab}
            type='button'
            title={item.description}
            aria-current={isActive ? 'page' : undefined}
            className={`${panelStyles.tab} ${isActive ? panelStyles.tabActive : ''}`}
            onClick={() => setActiveTab(item.tab)}
          >
            <Icon size={16} stroke={2} />
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}
