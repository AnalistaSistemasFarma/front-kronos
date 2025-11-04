'use client';

import { useSession, signOut } from 'next-auth/react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { Menu, Avatar, Loader } from '@mantine/core';
import TextLogo from './TextLogo';

export default function Header() {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const isDashboard = pathname === '/dashboard';

  return (
    <header className='sticky top-0   z-50'>
      <div className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8'>
        <div className='flex justify-between items-center h-16'>
          {/* Left: Logo */}
          <div className='flex items-center'>
            <Link href='/dashboard' aria-label='Go to dashboard'>
              <TextLogo size='small' className={`h-12 w-auto ${isDashboard ? '' : ''}`} />
            </Link>
          </div>

          {/* Center: Navbar */}
          <nav className='flex-1 flex justify-center'>
            <div className='flex items-center space-x-4'>
              <Link
                href='/dashboard'
                className={`px-3 py-2 rounded-md text-sm font-medium transition-colors hover:text-blue-600 ${
                  pathname === '/dashboard' ? 'text-blue-600' : 'text-gray-700'
                }`}
              >
                Dashboard
              </Link>
              <Link
                href='/process'
                className='text-gray-700 hover:text-blue-600 px-3 py-2 rounded-md text-sm font-medium transition-colors'
              >
                Procesos
              </Link>
            </div>
          </nav>

          {/* Right: Profile Section */}
          <div className='flex items-center'>
            {status === 'loading' ? (
              <Loader size='sm' />
            ) : session ? (
              <Menu>
                <Menu.Target>
                  <button
                    className='flex items-center space-x-2 hover:bg-gray-100 px-3 py-2 rounded'
                    aria-label='User menu'
                  >
                    <Avatar src={session.user?.image} alt={session.user?.name || 'User'} size='sm'>
                      {!session.user?.image && (session.user?.name?.charAt(0) || 'U')}
                    </Avatar>
                    <span className='hidden sm:block text-sm font-medium'>
                      {session.user?.name || 'User'}
                    </span>
                  </button>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Item onClick={() => signOut({ callbackUrl: '/login' })}>Logout</Menu.Item>
                </Menu.Dropdown>
              </Menu>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
}
