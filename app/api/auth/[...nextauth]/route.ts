import { PrismaAdapter } from '@next-auth/prisma-adapter';
import bcrypt from 'bcryptjs';
import NextAuth, { AuthOptions, Session, User } from 'next-auth';
import { JWT } from 'next-auth/jwt';
import AzureADProvider from 'next-auth/providers/azure-ad';
import CredentialsProvider from 'next-auth/providers/credentials';
import { prisma } from '../../../../lib/prisma';
import { normalizeNit, SUPPLIER_ROLE } from '../../../../lib/proveedor/isolation';

const azureConfigured =
  Boolean(process.env.AZURE_AD_CLIENT_ID) &&
  process.env.AZURE_AD_CLIENT_ID !== 'your-client-id' &&
  Boolean(process.env.AZURE_AD_CLIENT_SECRET) &&
  process.env.AZURE_AD_CLIENT_SECRET !== 'your-client-secret' &&
  Boolean(process.env.AZURE_AD_TENANT_ID) &&
  process.env.AZURE_AD_TENANT_ID !== 'your-tenant-id';

export const authOptions: AuthOptions = {
  adapter: PrismaAdapter(prisma),
  secret: process.env.NEXTAUTH_SECRET,
  debug: process.env.NODE_ENV === 'development',
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }
        const user = await prisma.user.findUnique({
          where: { email: credentials.email },
        });
        if (!user || !user.password) {
          return null;
        }
        // AISLAMIENTO: un proveedor NUNCA entra por el login interno (correo),
        // aunque tenga correo registrado. El proveedor solo entra por /proveedor/login.
        if (user.role === SUPPLIER_ROLE) {
          return null;
        }
        if (!user.isActive) {
          return null;
        }
        const isPasswordValid = await bcrypt.compare(credentials.password, user.password);
        if (!isPasswordValid) {
          return null;
        }
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
        };
      },
    }),
    // Provider EXCLUSIVO de proveedores: autentica por NIT + contraseña hasheada.
    // Solo autoriza a usuarios con role = 'supplier'; los internos no pueden entrar
    // por aquí (nunca tienen ese rol). El NIT es el identificador del proveedor.
    CredentialsProvider({
      id: 'supplier-nit',
      name: 'proveedor-nit',
      credentials: {
        nit: { label: 'NIT', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const nit = normalizeNit(credentials?.nit);
        if (!nit || !credentials?.password) {
          return null;
        }
        // La columna nit tiene índice único filtrado: a lo sumo un proveedor por NIT.
        const user = await prisma.user.findFirst({
          where: { nit, role: SUPPLIER_ROLE, isActive: true },
        });
        if (!user || !user.password) {
          return null;
        }
        const isPasswordValid = await bcrypt.compare(credentials.password, user.password);
        if (!isPasswordValid) {
          return null;
        }
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
        };
      },
    }),
    ...(azureConfigured
      ? [
          AzureADProvider({
            clientId: process.env.AZURE_AD_CLIENT_ID!,
            clientSecret: process.env.AZURE_AD_CLIENT_SECRET!,
            tenantId: process.env.AZURE_AD_TENANT_ID!,
          }),
        ]
      : []),
  ],
  session: {
    strategy: 'jwt' as const,
  },
  callbacks: {
    async jwt({ token, user }: { token: JWT; user?: User }) {
      const email = (user?.email ?? token.email) as string | undefined;

      if (email) {
        const dbUser = await prisma.user.findUnique({
          where: { email },
          select: { role: true, image: true, themePalette: true, colorScheme: true, nit: true },
        });
        token.email = email;
        token.role = dbUser?.role;
        token.nit = dbUser?.nit ?? undefined;
        token.themePalette = dbUser?.themePalette ?? undefined;
        token.colorScheme = dbUser?.colorScheme ?? undefined;
        if (dbUser?.image) {
          token.image = dbUser.image;
        } else if (user?.image) {
          token.image = user.image;
        }
      }

      return token;
    },
    async session({ session, token }: { session: Session; token: JWT }) {
      if (token && session.user) {
        session.user.id = token.sub;
        session.user.image = token.image as string;
        session.user.role = token.role as string | undefined;
        session.user.nit = token.nit as string | undefined;
        session.user.themePalette = token.themePalette as string | undefined;
        session.user.colorScheme = token.colorScheme as string | undefined;
      }
      return session;
    },
  },
  pages: {
    signIn: '/login',
  },
};

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
