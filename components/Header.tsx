'use client';

import { useSession, signOut } from 'next-auth/react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Menu, Avatar, Loader, ActionIcon, UnstyledButton } from '@mantine/core';
import {
  IconMoon,
  IconSun,
  IconMenu2,
  IconX,
  IconChevronDown,
  IconChartBar,
  IconClipboardList,
  IconUserCheck,
} from '@tabler/icons-react';
import { useState, useEffect, useContext, useMemo } from 'react';
import { useTheme } from './providers';
import NotificationBell from './NotificationBell';
import {
  AppSectionContext,
  type AppSection,
  type AppSectionContextValue,
} from '../lib/navigation/AppSectionContext';
import { DASHBOARD_TAB_URL } from '../lib/dashboard/DashboardTabContext';
import {
  PROCESS_HUB_URL,
  isHubInstantSwapRoute,
} from '../lib/navigation/AppSectionContext';
import { useDashboardAdminOptional } from '../lib/dashboard/DashboardAdminContext';
import { useRequestRoleNavOptional } from '../lib/request-general/SolicitadoNavContext';
import { buildLogoutCallbackUrl } from '../lib/auth/logout';

function useAppSectionOptional(): AppSectionContextValue | null {
  return useContext(AppSectionContext);
}

export default function Header() {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const sectionCtx = useAppSectionOptional();
  const dashboardAdmin = useDashboardAdminOptional();
  const roleNav = useRequestRoleNavOptional();
  const isDashboardAdmin = dashboardAdmin?.isDashboardAdmin ?? false;
  const loadingDashboardAdmin = dashboardAdmin?.loadingDashboardAdmin ?? false;
  const hasSolicitanteAccess = roleNav?.hasSolicitanteAccess ?? false;
  const hasSolicitadoAccess = roleNav?.hasSolicitadoAccess ?? false;
  const loadingRoleNav = roleNav?.loadingRoleNav ?? false;
  const solicitanteUrl =
    roleNav?.solicitanteUrl ?? '/process/request-general/dashboard-solicitante';
  const solicitadoUrl =
    roleNav?.solicitadoUrl ?? '/process/request-general/dashboard-solicitado';
  const { theme, toggleTheme } = useTheme();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const showDashboardNav = !loadingDashboardAdmin && isDashboardAdmin;
  const showSolicitanteNav = !loadingRoleNav && hasSolicitanteAccess;
  const showSolicitadoNav = !loadingRoleNav && hasSolicitadoAccess;
  const [dashMenuOpen, setDashMenuOpen] = useState(false);
  const isSolicitanteActive = pathname.startsWith(solicitanteUrl);
  const isSolicitadoActive = pathname.startsWith(solicitadoUrl);
  const isRoleDashActive = isSolicitanteActive || isSolicitadoActive;

  const homeUrl = showSolicitadoNav
    ? solicitadoUrl
    : showSolicitanteNav
      ? solicitanteUrl
      : isDashboardAdmin
        ? DASHBOARD_TAB_URL.solicitudes
        : PROCESS_HUB_URL;

  const handleSignOut = () => {
    const search = typeof window !== 'undefined' ? window.location.search : '';
    void signOut({
      callbackUrl: buildLogoutCallbackUrl(pathname, search),
    });
  };

  const activeSection: AppSection | null = sectionCtx
    ? sectionCtx.activeSection
    : pathname.startsWith('/dashboard')
      ? 'dashboard'
      : pathname.startsWith('/process')
        ? 'process'
        : null;

  useEffect(() => {
    setIsMobileMenuOpen(false);
    setDashMenuOpen(false);
  }, [pathname]);

  const dashboardItems = useMemo(() => {
    const items: Array<{
      key: 'admin' | 'solicitante' | 'solicitado';
      label: string;
      href: string;
      active: boolean;
      icon: typeof IconChartBar;
    }> = [];

    if (showDashboardNav) {
      items.push({
        key: 'admin',
        label: 'Admin del equipo',
        href: DASHBOARD_TAB_URL.solicitudes,
        active: !isRoleDashActive && activeSection === 'dashboard',
        icon: IconChartBar,
      });
    }
    if (showSolicitanteNav) {
      items.push({
        key: 'solicitante',
        label: 'Solicitudes',
        href: solicitanteUrl,
        active: isSolicitanteActive,
        icon: IconClipboardList,
      });
    }
    if (showSolicitadoNav) {
      items.push({
        key: 'solicitado',
        label: 'Personal',
        href: solicitadoUrl,
        active: isSolicitadoActive,
        icon: IconUserCheck,
      });
    }
    return items;
  }, [
    showDashboardNav,
    showSolicitanteNav,
    showSolicitadoNav,
    solicitanteUrl,
    solicitadoUrl,
    isSolicitanteActive,
    isSolicitadoActive,
    isRoleDashActive,
    activeSection,
  ]);

  const isDashboardGroupActive = dashboardItems.some((item) => item.active);
  const hasManyDashboards = dashboardItems.length > 1;
  const singleDashboard = dashboardItems.length === 1 ? dashboardItems[0] : null;

  const goToSection = (section: AppSection) => {
    if (section === 'dashboard' && !isDashboardAdmin) return;
    const url = section === 'dashboard' ? DASHBOARD_TAB_URL.solicitudes : PROCESS_HUB_URL;
    if (sectionCtx && isHubInstantSwapRoute(pathname)) {
      sectionCtx.setActiveSection(section);
    } else {
      router.replace(url);
    }
    setIsMobileMenuOpen(false);
  };

  const navLinkClass = (section: AppSection) =>
    `app-nav-link px-3 py-2 rounded-md text-sm font-medium transition-colors ${
      !isRoleDashActive && activeSection === section ? 'app-nav-link--active' : ''
    }`;

  const logoSrc =
    theme === 'dark' ? '/Logo_Principal_Blanco_Ancho.svg' : '/Logo_Principal.svg';

  const dashTriggerClass = `app-nav-link app-nav-dash px-3 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer ${
    isDashboardGroupActive ? 'app-nav-link--active' : ''
  }`;

  const openDashboardItem = (item: (typeof dashboardItems)[number]) => {
    setDashMenuOpen(false);
    setIsMobileMenuOpen(false);
    if (item.key === 'admin') {
      goToSection('dashboard');
      return;
    }
    router.push(item.href);
  };

  const dashItemIcon = (item: (typeof dashboardItems)[number]) => {
    const Icon = item.icon;
    return <Icon size={18} stroke={1.8} className='app-macos-menu__icon' />;
  };

  return (
    <>
      {isMobileMenuOpen && (
        <div
          className='fixed inset-0 z-40 bg-black/50 md:hidden'
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      <header className='app-header'>
        <div className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8'>
          <div className='flex justify-between items-center h-16'>
            <div className='md:hidden'>
              <ActionIcon
                variant='subtle'
                color='gray'
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                aria-label={isMobileMenuOpen ? 'Cerrar menú' : 'Abrir menú'}
                aria-expanded={isMobileMenuOpen}
                aria-controls='mobile-menu'
              >
                {isMobileMenuOpen ? <IconX size={20} /> : <IconMenu2 size={20} />}
              </ActionIcon>
            </div>

            <div className='flex items-center'>
              {sectionCtx && !showSolicitadoNav && !showSolicitanteNav ? (
                <UnstyledButton
                  onClick={() => goToSection(isDashboardAdmin ? 'dashboard' : 'process')}
                  aria-label={isDashboardAdmin ? 'Ir al Dashboard Admin' : 'Ir a procesos'}
                >
                  <Image
                    src={logoSrc}
                    alt='Logo'
                    width={1980}
                    height={100}
                    className='h-12 w-auto'
                  />
                </UnstyledButton>
              ) : (
                <Link href={homeUrl} aria-label='Ir al inicio'>
                  <Image
                    src={logoSrc}
                    alt='Logo'
                    width={1980}
                    height={100}
                    className='h-12 w-auto'
                  />
                </Link>
              )}
            </div>

            <nav className='hidden md:flex flex-1 justify-center'>
              <div className='flex items-center gap-1'>
                {dashboardItems.length > 0 &&
                  (hasManyDashboards ? (
                    <Menu
                      opened={dashMenuOpen}
                      onChange={setDashMenuOpen}
                      position='bottom-start'
                      offset={6}
                      withinPortal
                      shadow='none'
                      radius={12}
                      width={240}
                      classNames={{ dropdown: 'app-macos-menu', item: 'app-macos-menu__item' }}
                      styles={{
                        dropdown: {
                          background: 'transparent',
                          backdropFilter: 'blur(40px) saturate(180%)',
                          WebkitBackdropFilter: 'blur(40px) saturate(180%)',
                          boxShadow: 'none',
                        },
                      }}
                    >
                      <Menu.Target>
                        <button
                          type='button'
                          className={dashTriggerClass}
                          aria-haspopup='menu'
                          aria-expanded={dashMenuOpen}
                        >
                          Dashboard
                          <IconChevronDown
                            size={13}
                            className={`app-nav-chevron ${dashMenuOpen ? 'app-nav-chevron--open' : ''}`}
                            aria-hidden
                          />
                        </button>
                      </Menu.Target>
                      <Menu.Dropdown>
                        {dashboardItems.map((item) => (
                          <Menu.Item
                            key={item.key}
                            leftSection={dashItemIcon(item)}
                            onClick={() => openDashboardItem(item)}
                            data-active={item.active || undefined}
                          >
                            {item.label}
                          </Menu.Item>
                        ))}
                      </Menu.Dropdown>
                    </Menu>
                  ) : (
                    <button
                      type='button'
                      className={dashTriggerClass}
                      onClick={() => singleDashboard && openDashboardItem(singleDashboard)}
                    >
                      Dashboard
                    </button>
                  ))}
                {sectionCtx ? (
                  <button
                    type='button'
                    className={navLinkClass('process')}
                    onClick={() => goToSection('process')}
                  >
                    Procesos
                  </button>
                ) : (
                  <Link href={PROCESS_HUB_URL} prefetch className={navLinkClass('process')}>
                    Procesos
                  </Link>
                )}
              </div>
            </nav>

            <div className='flex items-center space-x-2'>
              <NotificationBell />
              <ActionIcon
                variant='subtle'
                color='gray'
                onClick={toggleTheme}
                title={theme === 'light' ? 'Modo oscuro' : 'Modo claro'}
                aria-label={theme === 'light' ? 'Activar modo oscuro' : 'Activar modo claro'}
              >
                {theme === 'light' ? <IconMoon size={18} /> : <IconSun size={18} />}
              </ActionIcon>
              {status === 'loading' ? (
                <Loader size='sm' />
              ) : session ? (
                <Menu
                  position='bottom-end'
                  offset={6}
                  withinPortal
                  shadow='none'
                  radius={12}
                  classNames={{ dropdown: 'app-macos-menu', item: 'app-macos-menu__item' }}
                >
                  <Menu.Target>
                    <button
                      className='flex items-center space-x-2 px-3 py-2 rounded-md transition-colors hover:opacity-90'
                      style={{ color: 'var(--app-text)' }}
                      aria-label='Menú de usuario'
                    >
                      <Avatar
                        src={session.user?.image}
                        alt={session.user?.name || 'Usuario'}
                        size='md'
                        className='object-contain'
                      >
                        {!session.user?.image && (session.user?.name?.charAt(0) || 'U')}
                      </Avatar>
                      <span className='hidden sm:block text-sm font-medium' style={{ color: 'var(--app-text)' }}>
                        {session.user?.name || 'Usuario'}
                      </span>
                    </button>
                  </Menu.Target>
                  <Menu.Dropdown>
                    <Menu.Item component={Link} href='/profile'>
                      Perfil
                    </Menu.Item>
                    <Menu.Item onClick={handleSignOut}>
                      Cerrar sesión
                    </Menu.Item>
                  </Menu.Dropdown>
                </Menu>
              ) : null}
            </div>
          </div>
        </div>
      </header>

      <div
        id='mobile-menu'
        className={`app-mobile-menu fixed top-16 left-0 w-full z-50 transform transition-transform duration-300 ease-in-out md:hidden shadow-lg ${
          isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        role='navigation'
        aria-label='Navegación móvil'
      >
        <nav className='px-4 py-4 space-y-2'>
          {dashboardItems.length > 0 && (
            <div>
              {hasManyDashboards ? (
                <>
                  <button
                    type='button'
                    className={`flex w-full items-center justify-between text-left text-base font-medium ${dashTriggerClass}`}
                    aria-expanded={dashMenuOpen}
                    onClick={() => setDashMenuOpen((open) => !open)}
                  >
                    Dashboard
                    <IconChevronDown
                      size={16}
                      className={`app-nav-chevron ${dashMenuOpen ? 'app-nav-chevron--open' : ''}`}
                      aria-hidden
                    />
                  </button>
                  {dashMenuOpen && (
                    <ul className='app-macos-menu app-macos-menu--inline'>
                      {dashboardItems.map((item) => (
                        <li key={item.key}>
                          <button
                            type='button'
                            className='app-macos-menu__item'
                            data-active={item.active || undefined}
                            onClick={() => openDashboardItem(item)}
                          >
                            {dashItemIcon(item)}
                            {item.label}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <button
                  type='button'
                  className={`block w-full text-left text-base font-medium ${dashTriggerClass}`}
                  onClick={() => singleDashboard && openDashboardItem(singleDashboard)}
                >
                  Dashboard
                </button>
              )}
            </div>
          )}
          {sectionCtx ? (
            <button
              type='button'
              className={`block w-full text-left text-base font-medium ${navLinkClass('process')}`}
              onClick={() => goToSection('process')}
            >
              Procesos
            </button>
          ) : (
            <Link
              href={PROCESS_HUB_URL}
              prefetch
              className={`block px-3 py-2 rounded-md text-base font-medium ${navLinkClass('process')}`}
              onClick={() => setIsMobileMenuOpen(false)}
            >
              Procesos
            </Link>
          )}
        </nav>
      </div>
    </>
  );
}
