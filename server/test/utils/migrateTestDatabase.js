const { runMigrations } = require("../../src/db/runMigrations");

async function migrateTestDatabase(pool) {
  await runMigrations(pool, { includeInitial: true });
}

module.exports = { migrateTestDatabase };
