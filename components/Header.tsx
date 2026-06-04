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

function useAppSectionOptional(): AppSectionContextValue | null {
  return useContext(AppSectionContext);
}

export default function Header() {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const sectionCtx = useAppSectionOptional();
  const { theme, toggleTheme } = useTheme();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

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
    const url = section === 'dashboard' ? DASHBOARD_TAB_URL.solicitudes : PROCESS_HUB_URL;
    if (sectionCtx && isHubInstantSwapRoute(pathname)) {
      sectionCtx.setActiveSection(section);
    } else {
      router.replace(url);
    }
    setIsMobileMenuOpen(false);
  };

  const navLinkClass = (section: AppSection) =>
    `px-3 py-2 rounded-md text-sm font-medium transition-colors ${
      activeSection === section
        ? 'text-blue-600 font-semibold'
        : theme === 'dark'
          ? 'text-white hover:text-blue-400'
          : 'text-gray-700 hover:text-blue-600'
    }`;

  return (
    <>
      {isMobileMenuOpen && (
        <div
          className='fixed inset-0 z-40 bg-white bg-opacity-50 md:hidden'
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      <header className={`sticky top-0 z-50 ${theme === 'dark' ? 'bg-gray-900' : 'bg-white'}`}>
        <div className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8'>
          <div className='flex justify-between items-center h-16'>
            <div className='md:hidden'>
              <ActionIcon
                variant='subtle'
                color='gray'
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                aria-label={isMobileMenuOpen ? 'Close menu' : 'Open menu'}
                aria-expanded={isMobileMenuOpen}
                aria-controls='mobile-menu'
              >
                {isMobileMenuOpen ? <IconX size={20} /> : <IconMenu2 size={20} />}
              </ActionIcon>
            </div>

            <div className='flex items-center '>
              {sectionCtx ? (
                <UnstyledButton
                  onClick={() => goToSection('dashboard')}
                  aria-label='Ir al dashboard'
                >
                  <Image
                    src={
                      theme === 'dark'
                        ? '/Logo_Principal_Blanco_Ancho.svg'
                        : '/Logo_Principal.svg'
                    }
                    alt='Logo'
                    width={1980}
                    height={100}
                    className='h-12 w-auto'
                    priority
                  />
                </UnstyledButton>
              ) : (
                <Link href={DASHBOARD_TAB_URL.solicitudes} aria-label='Go to dashboard'>
                  <Image
                    src={
                      theme === 'dark'
                        ? '/Logo_Principal_Blanco_Ancho.svg'
                        : '/Logo_Principal.svg'
                    }
                    alt='Logo'
                    width={1980}
                    height={100}
                    className='h-12 w-auto'
                    priority
                  />
                </Link>
              )}
            </div>

            <nav className='hidden md:flex flex-1 justify-center'>
              <div className='flex items-center space-x-4'>
                {sectionCtx ? (
                  <>
                    <button
                      type='button'
                      className={navLinkClass('dashboard')}
                      onClick={() => goToSection('dashboard')}
                    >
                      Dashboard
                    </button>
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
                    <Link
                      href={DASHBOARD_TAB_URL.solicitudes}
                      prefetch
                      className={`${
                        theme === 'dark' ? 'text-white' : 'text-gray-700'
                      } hover:text-blue-600 px-3 py-2 rounded-md text-sm font-medium transition-colors`}
                    >
                      Dashboard
                    </Link>
                    <Link
                      href={PROCESS_HUB_URL}
                      prefetch
                      className={`${
                        theme === 'dark' ? 'text-white' : 'text-gray-700'
                      } hover:text-blue-600 px-3 py-2 rounded-md text-sm font-medium transition-colors`}
                    >
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
                title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
              >
                {theme === 'light' ? <IconMoon size={18} /> : <IconSun size={18} />}
              </ActionIcon>
              {status === 'loading' ? (
                <Loader size='sm' />
              ) : session ? (
                <Menu>
                  <Menu.Target>
                    <button
                      className='flex items-center space-x-2 hover:bg-gray-100 px-3 py-2 rounded hover:text-gray-700'
                      aria-label='User menu'
                    >
                      <Avatar
                        src={session.user?.image}
                        alt={session.user?.name || 'User'}
                        size='md'
                        className='object-contain'
                      >
                        {!session.user?.image && (session.user?.name?.charAt(0) || 'U')}
                      </Avatar>
                      <span
                        className={`hidden sm:block text-sm font-medium ${
                          theme === 'dark' ? 'text-white ' : 'text-gray-700'
                        }`}
                      >
                        {session.user?.name || 'User'}
                      </span>
                    </button>
                  </Menu.Target>
                  <Menu.Dropdown>
                    <Menu.Item component={Link} href='/profile'>
                      Perfil
                    </Menu.Item>
                    <Menu.Item onClick={() => signOut({ callbackUrl: '/login' })}>Cerrar Sesión</Menu.Item>
                  </Menu.Dropdown>
                </Menu>
              ) : null}
            </div>
          </div>
        </div>
      </header>

      <div
        id='mobile-menu'
        className={`fixed top-16 left-0 w-full z-50 transform transition-transform duration-300 ease-in-out md:hidden ${
          isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        } ${theme === 'dark' ? 'bg-gray-900' : 'bg-white'} shadow-lg`}
        role='navigation'
        aria-label='Mobile navigation'
      >
        <nav className='px-4 py-4 space-y-2'>
          {sectionCtx ? (
            <>
              <button
                type='button'
                className={`block w-full text-left px-3 py-2 rounded-md text-base font-medium ${navLinkClass('dashboard')}`}
                onClick={() => goToSection('dashboard')}
              >
                Dashboard
              </button>
              <button
                type='button'
                className={`block w-full text-left px-3 py-2 rounded-md text-base font-medium ${navLinkClass('process')}`}
                onClick={() => goToSection('process')}
              >
                Procesos
              </button>
            </>
          ) : (
            <>
              <Link
                href={DASHBOARD_TAB_URL.solicitudes}
                prefetch
                className={`block px-3 py-2 rounded-md text-base font-medium ${
                  theme === 'dark' ? 'text-white hover:bg-gray-800' : 'text-gray-700 hover:bg-gray-100'
                }`}
                onClick={() => setIsMobileMenuOpen(false)}
              >
                Dashboard
              </Link>
              <Link
                href={PROCESS_HUB_URL}
                prefetch
                className={`block px-3 py-2 rounded-md text-base font-medium ${
                  theme === 'dark' ? 'text-white hover:bg-gray-800' : 'text-gray-700 hover:bg-gray-100'
                }`}
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
