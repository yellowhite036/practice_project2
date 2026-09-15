const fs = require("node:fs/promises");
const path = require("node:path");
const pool = require("./pool");

async function migrate() {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  const directory = path.resolve(__dirname, "../../db/migrations");
  const files = (await fs.readdir(directory)).filter(file => /^\d+_.*\.sql$/.test(file) && !file.endsWith(".down.sql")).sort();
  for (const filename of files) {
    const { rows } = await pool.query("SELECT filename FROM schema_migrations WHERE filename = $1", [filename]);
    if (rows[0]) continue;
    // Initial schema files are still applied by docker-entrypoint-initdb.d for new
    // databases. Only new production-management migrations are safe on an existing DB.
    if (Number(filename.slice(0, 3)) < 3) continue;
    const sql = await fs.readFile(path.join(directory, filename), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations(filename) VALUES ($1)", [filename]);
      await client.query("COMMIT");
      console.log(`[migration] applied ${filename}`);
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
}

migrate().then(() => pool.end()).catch(error => { console.error("Migration failed:", error); process.exitCode = 1; });
