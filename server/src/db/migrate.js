const pool = require("./pool");
const { runMigrations } = require("./runMigrations");

async function migrate() {
  // Docker initializes 001/002. Existing production databases safely receive 003+.
  await runMigrations(pool);
}

migrate().then(() => pool.end()).catch(error => { console.error("Migration failed:", error); process.exitCode = 1; });
