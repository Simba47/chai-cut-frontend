import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import PostgresAdapter from '@auth/pg-adapter'
import { Pool } from 'pg'
import { authConfig } from './auth.config'
import { verifyPassword } from './modules/auth/password'
import { startSession, isCurrentSession } from './modules/auth/one-device'
import sql from './lib/db'

const g = global as typeof globalThis & { _pgPool?: Pool }
if (!g._pgPool) {
  // Same reason as lib/db.ts: idle connections are closed before Railway's proxy drops them.
  // DB_SSL=off as in lib/db.ts (Railway's private network, where a pooler sits, has no SSL)
  g._pgPool = new Pool({
    connectionString: process.env.DATABASE_URL, ssl: process.env.DB_SSL === 'off' ? false : { rejectUnauthorized: false }, max: 3,
    idleTimeoutMillis: 20_000, keepAlive: true, connectionTimeoutMillis: 15_000,
  })
}
const pool = g._pgPool

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  adapter: PostgresAdapter(pool),
  session: { strategy: 'jwt', maxAge: 60 * 60 * 24 * 365 },
  providers: [
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const email = (credentials?.email as string | undefined)?.toLowerCase().trim()
        const password = credentials?.password as string | undefined
        if (!email || !password) return null

        const [user] = await sql`
          SELECT id, email, name, image, password_hash, "emailVerified"
          FROM users WHERE email = ${email}
        `
        if (!user || !user.password_hash) return null
        if (!user.emailVerified) return null

        const ok = await verifyPassword(password, user.password_hash as string)
        if (!ok) return null

        // (image: the profile photo's address — the same one photoUrl makes in server/services/account.ts)
        const photo = user.image as string | null
        return {
          id: user.id as string, email: user.email as string, name: (user.name as string | null) ?? null,
          image: photo?.startsWith('avatars/') ? `/api/account/photo?v=${photo.split('/').pop()!.slice(0, 8)}` : null,
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.id = user.id
        // One device per account: this sign-in becomes the only one, any other device is signed out
        token.sid = await startSession(user.id as string)
        delete token.replaced
      } else if (token.id && !token.replaced && !(await isCurrentSession(token.id as string, token.sid as string | undefined))) {
        token.replaced = true
      }
      // Account settings changed the name: the page calls update({ name }) so the session shows it
      if (trigger === 'update' && session && typeof session === 'object' && 'name' in session) {
        token.name = (session as { name?: string | null }).name ?? null
      }
      // …or the profile photo: update({ image }). Only our own photo address (or none) is taken.
      if (trigger === 'update' && session && typeof session === 'object' && 'image' in session) {
        const image = (session as { image?: unknown }).image
        token.picture = typeof image === 'string' && image.startsWith('/api/account/photo?v=') ? image : null
      }
      return token
    },
    session({ session, token }) {
      // A replaced sign-in gets no user id: nothing treats it as signed in (server/auth.ts, providers.tsx)
      if (token.replaced) { session.replaced = true; return session }
      if (session.user && token.id) session.user.id = token.id as string
      return session
    },
  },
})
