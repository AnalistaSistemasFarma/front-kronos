import { getServerSession } from 'next-auth';
import { authOptions } from '../app/api/auth/[...nextauth]/route';
import { PrismaClient } from '../app/generated/prisma';

const prisma = new PrismaClient();

/**
 * Check if user has admin privileges based on role or subprocess access
 * @param userEmail - The email of the user to check
 * @returns Promise<boolean> - True if user has admin privileges
 */
export async function checkAdminPrivileges(userEmail: string): Promise<boolean> {
  if (!userEmail) {
    return false;
  }

  try {
    // First check user role in database
    const user = await prisma.user.findUnique({
      where: { email: userEmail },
      select: { role: true },
    });

    // Check if user has admin or super_user role
    if (user?.role === 'admin' || user?.role === 'super_user') {
      return true;
    }

    // If not admin by role, check subprocess access
    const adminSubprocess = await prisma.subprocessUserCompany.findFirst({
      where: {
        companyUser: {
          user: {
            email: userEmail,
          },
        },
        subprocess: {
          subprocess_url: '/process/administration/users',
        },
      },
    });

    return !!adminSubprocess;
  } catch (error) {
    console.error('Error checking admin privileges:', error);
    return false;
  }
}

/**
 * Get current user session and check if they have admin privileges
 * @returns Promise<{isAdmin: boolean, userEmail: string | null}>
 */
export async function getCurrentUserAdminStatus(): Promise<{
  isAdmin: boolean;
  userEmail: string | null;
}> {
  try {
    const session = await getServerSession(authOptions);
    const userEmail = session?.user?.email || null;

    if (!userEmail) {
      return { isAdmin: false, userEmail: null };
    }

    const isAdmin = await checkAdminPrivileges(userEmail);
    return { isAdmin, userEmail };
  } catch (error) {
    console.error('Error getting current user admin status:', error);
    return { isAdmin: false, userEmail: null };
  }
}

/**
 * Client-side utility to check if user has admin privileges
 * This should be used with caution on client-side and always verified on server-side
 * @param userRole - The role of the user from session
 * @returns boolean - True if user has admin privileges
 */
export function hasAdminRole(userRole?: string): boolean {
  return userRole === 'admin' || userRole === 'super_user';
}
