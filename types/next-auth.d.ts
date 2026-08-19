import 'next-auth';
import 'next-auth/jwt';

declare module 'next-auth' {
  interface Session {
    user: {
      id?: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      role?: string;
      /** NIT del proveedor (solo presente cuando role === 'supplier'). */
      nit?: string;
      themePalette?: string;
      colorScheme?: string;
    };
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    role?: string;
    /** NIT del proveedor (solo presente cuando role === 'supplier'). */
    nit?: string;
    themePalette?: string;
    colorScheme?: string;
  }
}
