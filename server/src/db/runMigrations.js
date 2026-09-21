const fs = require("node:fs/promises");
const path = require("node:path");

async function resolveMigrationDirectory() {
  const candidates = [
    path.resolve(__dirname, "../../db/migrations"),
    path.resolve(__dirname, "../../../db/migrations")
  ];
  for (const directory of candidates) {
    try {
      await fs.access(path.join(directory, "001_create_initial_schema.sql"));
      return directory;
    } catch {
      // Try the next layout: Docker uses /app/db, local development uses ../db.
    }
  }
  throw new Error("Migration directory containing 001_create_initial_schema.sql was not found");
}

async function runMigrations(pool, { includeInitial = false } = {}) {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  const directory = await resolveMigrationDirectory();
  const files = (await fs.readdir(directory))
    .filter(file => /^\d+_.*\.sql$/.test(file) && !file.endsWith(".down.sql"))
    .sort();
  for (const filename of files) {
    const { rows } = await pool.query("SELECT filename FROM schema_migrations WHERE filename = $1", [filename]);
    if (rows[0]) continue;
    if (!includeInitial && Number(filename.slice(0, 3)) < 3) continue;
    const sql = await fs.readFile(path.join(directory, filename), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations(filename) VALUES ($1)", [filename]);
      await client.query("COMMIT");
      console.log(`[migration] applied ${filename}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

module.exports = { runMigrations, resolveMigrationDirectory };
