'use client';

import { useSession, signOut } from 'next-auth/react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { Menu, Avatar, Loader, ActionIcon } from '@mantine/core';
import { IconMoon, IconSun } from '@tabler/icons-react';
import { useTheme } from './providers';

export default function Header() {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const isDashboard = pathname === '/dashboard';
  const { theme, toggleTheme } = useTheme();

  return (
    <header className={`sticky top-0 z-50 ${theme === 'dark' ? 'bg-gray-900' : 'bg-white'}`}>
      <div className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8'>
        <div className='flex justify-between items-center h-16'>
          {/* Left: Logo */}
          <div className='flex items-center '>
            <Link href='/dashboard' aria-label='Go to dashboard'>
              <Image
                src='/logo.png'
                alt='Logo'
                width={1980}
                height={100}
                className='h-12 w-auto'
                priority
              />
            </Link>
          </div>

          {/* Center: Navbar */}
          <nav className='flex-1 flex justify-center'>
            <div className='flex items-center space-x-4'>
              <Link
                href='/dashboard'
                className={`${
                  theme === 'dark' ? 'text-white' : 'text-gray-700'
                } hover:text-blue-600 px-3 py-2 rounded-md text-sm font-medium transition-colors`}
              >
                Dashboard
              </Link>
              <Link
                href='/process'
                className={`${
                  theme === 'dark' ? 'text-white' : 'text-gray-700'
                } hover:text-blue-600 px-3 py-2 rounded-md text-sm font-medium transition-colors`}
              >
                Procesos
              </Link>
            </div>
          </nav>

          {/* Right: Profile Section */}
          <div className='flex items-center space-x-2'>
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
                    <div className='aspect-square  rounded-full object-cover relative hover:text-gray-700'>
                      <Avatar
                        src={session.user?.image}
                        alt={session.user?.name || 'User'}
                        size='md'
                        className='object-contain'
                      >
                        {!session.user?.image && (session.user?.name?.charAt(0) || 'U')}
                      </Avatar>
                    </div>

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
                  <Menu.Item onClick={() => signOut({ callbackUrl: '/login' })}>
                    Cerrar Sesión
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
}
