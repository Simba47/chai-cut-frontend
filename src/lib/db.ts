import postgres from 'postgres'

const g = global as typeof globalThis & { _sql?: postgres.Sql }

if (!g._sql) {
  g._sql = postgres(process.env.DATABASE_URL!, { ssl: 'require', max: 5 })
}

const sql = g._sql
export default sql
