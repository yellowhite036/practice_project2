const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log("Navigating to http://localhost:8080/");
  await page.goto('http://localhost:8080/');

  // Login
  console.log("Logging in...");
  await page.fill('#loginUserId', 'ADMIN-TEST');
  await page.click('#loginBtn');
  
  // Wait for login to complete and main screen to appear
  await page.waitForSelector('#mainContent', { state: 'visible' });

  // Create a normal work order: fill in quantity
  console.log("Filling form...");
  await page.fill('#quantityInput', '1');
  
  // Click 4 times as fast as possible
  console.log("Clicking submit button 4 times quickly...");
  
  // We can use page.evaluate to bypass any small delay in Playwright's click
  // and dispatch 4 click events back to back
  await page.evaluate(() => {
    const btn = document.querySelector('#submitWorkOrderBtn');
    
    // We want to record the log output.
    // The frontend logs are added to #logList
    
    // Simulate 4 fast clicks
    btn.click();
    btn.disabled = false; // explicitly re-enable to bypass immediate JS disable for the sake of the fast click simulation
    btn.click();
    btn.disabled = false;
    btn.click();
    btn.disabled = false;
    btn.click();
  });

  // Wait a bit for all requests to finish
  await page.waitForTimeout(2000);

  // Grab the logs
  const logs = await page.evaluate(() => {
    const logElements = document.querySelectorAll('#logList .log-item p');
    return Array.from(logElements).map(el => el.innerText).slice(0, 10);
  });
  
  console.log("--- Frontend Logs ---");
  logs.forEach(l => console.log(l));

  await browser.close();
})();
