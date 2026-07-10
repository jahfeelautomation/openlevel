import { readFileSync } from 'node:fs'
import { Pool } from 'pg'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL required')

const pool = new Pool({ connectionString: url })
const sql = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8')

await pool.query(sql)
console.log('openlevel: schema migrated')
await pool.end()
