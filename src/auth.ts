import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import PostgresAdapter from '@auth/pg-adapter'
import { Pool } from 'pg'
import { authConfig } from './auth.config'
import { verifyPassword } from './modules/auth/password'
import sql from './lib/db'

const g = global as typeof globalThis & { _pgPool?: Pool }
if (!g._pgPool) {
  g._pgPool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 3 })
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
          SELECT id, email, name, password_hash, "emailVerified"
          FROM users WHERE email = ${email}
        `
        if (!user || !user.password_hash) return null
        if (!user.emailVerified) return null

        const ok = await verifyPassword(password, user.password_hash as string)
        if (!ok) return null

        return { id: user.id as string, email: user.email as string, name: (user.name as string | null) ?? null }
      },
    }),
  ],
  callbacks: {
    jwt({ token, user, trigger, session }) {
      if (user) token.id = user.id
      // Account settings changed the name: the page calls update({ name }) so the session shows it
      if (trigger === 'update' && session && typeof session === 'object' && 'name' in session) {
        token.name = (session as { name?: string | null }).name ?? null
      }
      return token
    },
    session({ session, token }) {
      if (session.user && token.id) session.user.id = token.id as string
      return session
    },
  },
})
