/**
 * Apply db/schema.sql to the configured database.
 * The schema is written to be idempotent, so "migrating" is simply
 * (re)playing it: `npm run db:migrate`.
 */
const fs = require('fs');
const path = require('path');
const { getPool, closePool } = require('../db/pool');

(async () => {
  const schemaPath = path.join(__dirname, '..', 'db', 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  await getPool().query(sql);
  console.log('Schema applied.');
  await closePool();
})().catch((e) => {
  console.error('Migration failed:', e.message);
  process.exit(1);
});
