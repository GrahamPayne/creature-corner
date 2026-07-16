// End-to-end test of the complete Field Guide user flow on /field-guide.
const { test, expect } = require('@playwright/test');

const device = (page) => page.locator('#field-guide-device');
const termInput = (page) => page.locator('.fg-term-input');
const termHistory = (page) => page.locator('.fg-term-history');
const mainScreen = (page) => page.locator('.fg-screen-main');

async function typeCommand(page, cmd) {
  await termInput(page).fill(cmd);
  await termInput(page).press('Enter');
}

async function powerOn(page) {
  await page.locator('.fg-hotspot-power').click();
  await expect(device(page)).toHaveAttribute('data-state', 'mainMenu', { timeout: 5000 });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/field-guide');
});

test('device loads powered off with dark screens and a dead terminal', async ({ page }) => {
  await expect(device(page)).toHaveAttribute('data-state', 'poweredOff');
  await expect(termInput(page)).toBeDisabled();
  await expect(page.locator('.fg-powerlight-on')).not.toHaveClass(/is-visible/);
});

test('complete first user flow: power on -> browse -> record -> home -> power off', async ({ page }) => {
  // 1-5: power on, light, screens, startup text
  await powerOn(page);
  await expect(page.locator('.fg-powerlight-on')).toHaveClass(/is-visible/);
  await expect(termHistory(page)).toContainText('FIELD GUIDE INTERFACE');
  await expect(termHistory(page)).toContainText('TYPE HELP FOR AVAILABLE COMMANDS');
  await expect(mainScreen(page)).toContainText('RECORD CATEGORIES');

  // 6: HELP
  await typeCommand(page, 'HELP');
  await expect(termHistory(page)).toContainText('AVAILABLE INPUTS');

  // 7-8: CREATURES index on the upper screen
  await typeCommand(page, 'CREATURES');
  await expect(device(page)).toHaveAttribute('data-state', 'browsingIndex');
  await expect(mainScreen(page)).toContainText('TEST-CR-001');

  // 9-10: OPEN a record
  await typeCommand(page, 'OPEN TEST-CR-001');
  await expect(device(page)).toHaveAttribute('data-state', 'viewingRecord');
  await expect(mainScreen(page)).toContainText('PROTOTYPE CREATURE RECORD 001');
  await expect(mainScreen(page)).toContainText('RECORD CONTENT HAS NOT YET BEEN ASSIGNED.');

  // 11: NEXT via typed command, then side button
  await typeCommand(page, 'NEXT');
  await expect(mainScreen(page)).toContainText('TEST-CR-002');
  await page.locator('.fg-hotspot-side2').click();
  await expect(mainScreen(page)).toContainText('TEST-CR-003');

  // 12-13: BACK to the index
  await typeCommand(page, 'BACK');
  await expect(device(page)).toHaveAttribute('data-state', 'browsingIndex');

  // 14-15: HOME to the main menu
  await typeCommand(page, 'HOME');
  await expect(device(page)).toHaveAttribute('data-state', 'mainMenu');

  // 16-17: POWER OFF
  await typeCommand(page, 'POWER OFF');
  await expect(device(page)).toHaveAttribute('data-state', 'poweredOff', { timeout: 5000 });
  await expect(termInput(page)).toBeDisabled();
  await expect(page.locator('.fg-powerlight-on')).not.toHaveClass(/is-visible/);
});

test('commands are case-insensitive and aliases work', async ({ page }) => {
  await powerOn(page);
  await typeCommand(page, 'list creatures');
  await expect(device(page)).toHaveAttribute('data-state', 'browsingIndex');
  await typeCommand(page, 'go back');
  await expect(device(page)).toHaveAttribute('data-state', 'mainMenu');
  await typeCommand(page, 'artifact index');
  await expect(mainScreen(page)).toContainText('TEST-AR-001');
});

test('invalid record id gets the controlled refusal', async ({ page }) => {
  await powerOn(page);
  await typeCommand(page, 'OPEN TEST-XX-999');
  await expect(termHistory(page)).toContainText('NO MATCHING RECORD WAS LOCATED.');
});

test('unknown command and chat phrases answer in device voice', async ({ page }) => {
  await powerOn(page);
  await typeCommand(page, 'summon creature');
  await expect(termHistory(page)).toContainText('COMMAND NOT RECOGNIZED.');
  await typeCommand(page, 'are you alive?');
  await expect(termHistory(page)).toContainText('TERM CANNOT BE VERIFIED.');
});

test('physical buttons drive the same navigation as typed commands', async ({ page }) => {
  await powerOn(page);
  await page.locator('.fg-hotspot-btn1').click();
  await expect(device(page)).toHaveAttribute('data-state', 'browsingIndex');
  await expect(mainScreen(page)).toContainText('CREATURE RECORDS');
  await page.locator('.fg-hotspot-btn4').click();
  await expect(device(page)).toHaveAttribute('data-state', 'mainMenu');
  await page.locator('.fg-hotspot-btn2').click();
  await expect(mainScreen(page)).toContainText('TEST-AR-001');
  await page.locator('.fg-hotspot-btn3').click();
  await expect(mainScreen(page)).toContainText('TEST-ME-001');
});

test('controls give no navigation while powered off', async ({ page }) => {
  await page.locator('.fg-hotspot-btn1').click();
  await expect(device(page)).toHaveAttribute('data-state', 'poweredOff');
  await page.locator('.fg-hotspot-side2').click();
  await expect(device(page)).toHaveAttribute('data-state', 'poweredOff');
});

test('CLEAR empties the terminal history', async ({ page }) => {
  await powerOn(page);
  await typeCommand(page, 'HELP');
  await typeCommand(page, 'CLEAR');
  await expect(termHistory(page)).not.toContainText('AVAILABLE INPUTS');
});
