'use client';

import { useSession, signOut } from 'next-auth/react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Menu, Avatar, Loader, ActionIcon, UnstyledButton } from '@mantine/core';
import { IconMoon, IconSun, IconMenu2, IconX } from '@tabler/icons-react';
import { useState, useEffect, useContext } from 'react';
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

function useAppSectionOptional(): AppSectionContextValue | null {
  return useContext(AppSectionContext);
}

export default function Header() {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const sectionCtx = useAppSectionOptional();
  const dashboardAdmin = useDashboardAdminOptional();
  const isDashboardAdmin = dashboardAdmin?.isDashboardAdmin ?? false;
  const loadingDashboardAdmin = dashboardAdmin?.loadingDashboardAdmin ?? false;
  const { theme, toggleTheme } = useTheme();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const showDashboardNav = !loadingDashboardAdmin && isDashboardAdmin;

  const activeSection: AppSection | null = sectionCtx
    ? sectionCtx.activeSection
    : pathname.startsWith('/dashboard')
      ? 'dashboard'
      : pathname.startsWith('/process')
        ? 'process'
        : null;

  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [pathname]);

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
      activeSection === section ? 'app-nav-link--active' : ''
    }`;

  const logoSrc =
    theme === 'dark' ? '/Logo_Principal_Blanco_Ancho.svg' : '/Logo_Principal.svg';

  return (
    <>
      {isMobileMenuOpen && (
        <div
          className='fixed inset-0 z-40 bg-black/50 md:hidden'
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      <header className='app-header sticky top-0 z-50'>
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
              {sectionCtx ? (
                <UnstyledButton
                  onClick={() => goToSection(isDashboardAdmin ? 'dashboard' : 'process')}
                  aria-label={isDashboardAdmin ? 'Ir al dashboard' : 'Ir a procesos'}
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
                <Link
                  href={isDashboardAdmin ? DASHBOARD_TAB_URL.solicitudes : PROCESS_HUB_URL}
                  aria-label={isDashboardAdmin ? 'Ir al dashboard' : 'Ir a procesos'}
                >
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
              <div className='flex items-center space-x-4'>
                {sectionCtx ? (
                  <>
                    {showDashboardNav && (
                      <button
                        type='button'
                        className={navLinkClass('dashboard')}
                        onClick={() => goToSection('dashboard')}
                      >
                        Dashboard
                      </button>
                    )}
                    <button
                      type='button'
                      className={navLinkClass('process')}
                      onClick={() => goToSection('process')}
                    >
                      Procesos
                    </button>
                  </>
                ) : (
                  <>
                    {showDashboardNav && (
                      <Link
                        href={DASHBOARD_TAB_URL.solicitudes}
                        prefetch
                        className={navLinkClass('dashboard')}
                      >
                        Dashboard
                      </Link>
                    )}
                    <Link href={PROCESS_HUB_URL} prefetch className={navLinkClass('process')}>
                      Procesos
                    </Link>
                  </>
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
                <Menu>
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
                    <Menu.Item onClick={() => signOut({ callbackUrl: '/login' })}>
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
          {sectionCtx ? (
            <>
              {showDashboardNav && (
                <button
                  type='button'
                  className={`block w-full text-left text-base font-medium ${navLinkClass('dashboard')}`}
                  onClick={() => goToSection('dashboard')}
                >
                  Dashboard
                </button>
              )}
              <button
                type='button'
                className={`block w-full text-left text-base font-medium ${navLinkClass('process')}`}
                onClick={() => goToSection('process')}
              >
                Procesos
              </button>
            </>
          ) : (
            <>
              {showDashboardNav && (
                <Link
                  href={DASHBOARD_TAB_URL.solicitudes}
                  prefetch
                  className={`block px-3 py-2 rounded-md text-base font-medium ${navLinkClass('dashboard')}`}
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  Dashboard
                </Link>
              )}
              <Link
                href={PROCESS_HUB_URL}
                prefetch
                className={`block px-3 py-2 rounded-md text-base font-medium ${navLinkClass('process')}`}
                onClick={() => setIsMobileMenuOpen(false)}
              >
                Procesos
              </Link>
            </>
          )}
        </nav>
      </div>
    </>
  );
}
