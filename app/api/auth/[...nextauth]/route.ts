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

type SessionUserRow = {
  id: string;
  role: string;
  image: string | null;
  themePalette: string | null;
  colorScheme: string | null;
  uiFont: string | null;
  nit: string | null;
};

/**
 * El callback jwt corre en CADA getServerSession (cada API) y antes consultaba [user] siempre.
 * Se guarda la fila por correo unos segundos: rol, tema y foto siguen al día (máx. 60 s de
 * retraso, o inmediato con update()) y la BD deja de recibir una consulta por llamada.
 */
const SESSION_USER_TTL_MS = 60_000;
const sessionUserCache: Map<string, { row: SessionUserRow | undefined; at: number }> =
  ((globalThis as Record<string, unknown>).__kronosSessionUserCache as never) ??
  ((globalThis as Record<string, unknown>).__kronosSessionUserCache = new Map());

async function loadSessionUser(email: string, fresh: boolean): Promise<SessionUserRow | undefined> {
  const key = email.trim().toLowerCase();
  const cached = sessionUserCache.get(key);
  if (!fresh && cached && Date.now() - cached.at < SESSION_USER_TTL_MS) return cached.row;

  const rows = await prisma.$queryRaw<SessionUserRow[]>`
    SELECT TOP 1 id, role, image, themePalette, colorScheme, uiFont, nit
    FROM [user]
    WHERE LOWER(LTRIM(RTRIM(email))) = LOWER(LTRIM(RTRIM(${email})))
  `;
  const row = rows[0];
  sessionUserCache.set(key, { row, at: Date.now() });
  return row;
}

export const authOptions: AuthOptions = {
  adapter: PrismaAdapter(prisma),
  secret: process.env.NEXTAUTH_SECRET,
  debug: process.env.NEXTAUTH_DEBUG === 'true',
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
        const emailInput = credentials.email.trim();
        // Búsqueda case-insensitive (SQL Server): evita fallos por mayúsculas en el correo.
        const rows = await prisma.$queryRaw<
          Array<{
            id: string;
            name: string | null;
            email: string;
            password: string | null;
            role: string;
            isActive: boolean;
            image: string | null;
          }>
        >`
          SELECT TOP 1 id, name, email, password, role, isActive, image
          FROM [user]
          WHERE LOWER(LTRIM(RTRIM(email))) = LOWER(LTRIM(RTRIM(${emailInput})))
        `;
        const user = rows[0];
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
    async jwt({ token, user, trigger }: { token: JWT; user?: User; trigger?: string }) {
      const email = (user?.email ?? token.email) as string | undefined;

      if (email) {
        try {
          // Al iniciar sesión o con update() (cambio de perfil/tema) se lee siempre de la BD;
          // en el resto de llamadas (cada getServerSession) se reutiliza la lectura reciente.
          const fresh = Boolean(user) || trigger === 'update';
          const dbUser = await loadSessionUser(email, fresh);
          token.email = email;
          // Id Kronos (cuid), no el sub de Azure/OIDC.
          if (dbUser?.id) {
            token.kronosUserId = dbUser.id;
            token.sub = dbUser.id;
          }
          token.role = dbUser?.role;
          token.nit = dbUser?.nit ?? undefined;
          token.themePalette = dbUser?.themePalette ?? undefined;
          token.uiFont = dbUser?.uiFont ?? undefined;
          token.colorScheme = dbUser?.colorScheme ?? undefined;
          if (dbUser?.image) {
            token.image = dbUser.image;
          } else if (user?.image) {
            token.image = user.image;
          }
        } catch (err) {
          console.error('[nextauth] jwt callback error:', err);
        }
      }

      return token;
    },
    async session({ session, token }: { session: Session; token: JWT }) {
      if (token && session.user) {
        const kronosId =
          (token.kronosUserId as string | undefined) ||
          (typeof token.sub === 'string' ? token.sub : undefined);
        if (kronosId) session.user.id = kronosId;
        session.user.image = token.image as string;
        session.user.role = token.role as string | undefined;
        session.user.nit = token.nit as string | undefined;
        session.user.themePalette = token.themePalette as string | undefined;
        session.user.uiFont = token.uiFont as string | undefined;
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
