const assert = require("node:assert/strict");
const test = require("node:test");
const { execSync } = require("node:child_process");
const path = require("node:path");

test("Backend should fail to start if environment variables are missing", () => {
  const poolFile = path.join(__dirname, "../src/db/pool.js");
  
  try {
    // Run pool.js in a separate process without environment variables
    execSync(`node "${poolFile}"`, {
      env: { ...process.env, DATABASE_HOST: "" },
      stdio: "pipe"
    });
    assert.fail("Process should have exited with error");
  } catch (error) {
    // error.status should be 1
    assert.equal(error.status, 1);
    
    // Check stderr for the correct message
    const stderr = error.stderr.toString();
    assert.match(stderr, /Missing required environment variable/);
    
    // Check that password is not leaked in stderr
    assert.doesNotMatch(stderr, /test_password/);
    assert.doesNotMatch(stderr, /process\.env\.DATABASE_PASSWORD/);
  }
});
