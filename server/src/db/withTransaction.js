/**
 * withTransaction(pool, callback)
 *
 * Acquires a client from the pool, begins a transaction, runs the callback
 * with that client, commits on success, or rolls back on error.
 * Always releases the client back to the pool.
 *
 * @param {import('pg').Pool} pool
 * @param {(client: import('pg').PoolClient) => Promise<T>} callback
 * @returns {Promise<T>}
 */
async function withTransaction(pool, callback) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

module.exports = withTransaction;
