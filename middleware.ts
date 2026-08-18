import { NextResponse } from 'next/server';
import { withAuth } from 'next-auth/middleware';
import { isInternalApiPath, isSupplierProtectedPath, SUPPLIER_ROLE } from './lib/proveedor/isolation';

const INTERNAL_PAGES = ['/home', '/dashboard', '/process', '/profile'];

function isInternalPage(pathname: string): boolean {
  return INTERNAL_PAGES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export default withAuth(
  function middleware(req) {
    const { pathname } = req.nextUrl;
    const role = req.nextauth.token?.role;
    const isSupplier = role === SUPPLIER_ROLE;

    if (!isSupplier) return NextResponse.next();

    // AISLAMIENTO DEL ROL: un proveedor NO puede tocar API interna → 403 duro.
    if (isInternalApiPath(pathname)) {
      return NextResponse.json({ error: 'Acceso no permitido' }, { status: 403 });
    }

    // Un proveedor tampoco entra a las páginas internas → lo mandamos a su portal.
    if (isInternalPage(pathname)) {
      return NextResponse.redirect(new URL('/proveedor/portal', req.url));
    }

    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token, req }) => {
        const { pathname } = req.nextUrl;

        // Área EXCLUSIVA de proveedores: exige sesión tipo Proveedor.
        if (isSupplierProtectedPath(pathname)) {
          return token?.role === SUPPLIER_ROLE;
        }

        // Páginas internas protegidas: exigen sesión (comportamiento original).
        if (isInternalPage(pathname)) {
          return !!token;
        }

        // Resto (incluida API interna): dejamos pasar para NO cambiar el
        // comportamiento existente (cada endpoint hace su propia validación); el
        // bloqueo del rol Proveedor se aplica en la función de arriba.
        return true;
      },
    },
    pages: {
      signIn: '/login',
    },
  }
);

export const config = {
  matcher: [
    '/home',
    '/dashboard',
    '/dashboard/:path*',
    '/process',
    '/process/:path*',
    '/profile',
    '/proveedor/portal',
    '/proveedor/portal/:path*',
    '/api/:path*',
  ],
};
