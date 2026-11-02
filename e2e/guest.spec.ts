import { expect, test, type Page } from '@playwright/test';
import { addVariable, createProject, newUser, PASSWORD, uniqueEmail, variable } from './helpers';

/** Create a share link through the Share dialog and return its URL. */
async function createShareLink(page: Page, opts: { guests: boolean; role?: string }) {
  await page.getByRole('button', { name: 'Share' }).click();
  const dialog = page.getByRole('dialog');
  if (opts.role) await dialog.getByLabel('New link role').selectOption({ label: opts.role });
  const box = dialog.getByLabel('No account needed');
  if ((await box.isChecked()) !== opts.guests) await box.click();
  await dialog.getByRole('button', { name: /Create link|New link/ }).click();
  const url = (await dialog.locator('li span.font-mono').last().textContent())!;
  await page.keyboard.press('Escape');
  return url;
}

test.describe('guest access', () => {
  test('a visitor without an account joins with a name, collaborates and later keeps access with an account', async ({
    browser,
  }) => {
    const owner = await newUser(browser, 'Maya');
    await createProject(owner.page, 'Workshop');
    await addVariable(owner.page, 'Trust', 400, 300);
    const url = await createShareLink(owner.page, { guests: true });

    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const guest = await ctx.newPage();
    await guest.goto(url);
    await expect(guest.getByText('Maya invited you to')).toBeVisible();
    await guest.getByLabel('Your name').fill('Jonas');
    await guest.getByRole('button', { name: 'Join as guest' }).click();
    await expect(guest.getByTestId('canvas')).toBeVisible();
    await expect(variable(guest, 'Trust')).toHaveCount(1);

    // Live collaboration both ways.
    await expect(owner.page.getByRole('button', { name: 'Follow Jonas' })).toBeVisible();
    await addVariable(guest, 'Guest idea', 800, 300);
    await expect(variable(owner.page, 'Guest idea')).toHaveCount(1);

    // Guest badge in the member list; guests can't manage sharing.
    await owner.page.getByRole('button', { name: 'Share' }).click();
    await expect(owner.page.getByRole('dialog').getByText('Guest', { exact: true })).toBeVisible();
    await expect(owner.page.getByText('1 guest joined')).toBeVisible();
    await owner.page.keyboard.press('Escape');
    await guest.getByRole('button', { name: 'Share' }).click();
    await expect(guest.getByText("You're a guest.")).toBeVisible();
    await expect(guest.getByRole('button', { name: 'Create link' })).toHaveCount(0);
    await guest.keyboard.press('Escape');

    // The guest creates an account from the account menu and keeps the project.
    await guest.getByRole('button', { name: 'Account menu' }).click();
    await expect(guest.getByText('Guest on this device')).toBeVisible();
    await guest.getByRole('menuitem', { name: 'Create account to keep access' }).click();
    await expect(guest.getByRole('heading', { name: 'Keep your projects' })).toBeVisible();
    await expect(guest.getByLabel('Name')).toHaveValue('Jonas');
    await guest.getByLabel('Email').fill(uniqueEmail('jonas'));
    await guest.getByLabel('Password').fill(PASSWORD);
    await guest.getByRole('button', { name: 'Create account' }).click();
    await expect(guest.getByText('Your projects are now saved to your account.')).toBeVisible();
    await expect(variable(guest, 'Guest idea')).toHaveCount(1);
    await guest.goto('/');
    await expect(guest.getByRole('link', { name: 'Open Workshop' })).toBeVisible();
    await expect(guest.getByRole('button', { name: 'New project' })).toBeVisible();

    await owner.context.close();
    await ctx.close();
  });

  test('revoking a link can remove its guests; links can require accounts', async ({ browser }) => {
    const owner = await newUser(browser, 'Olaf');
    await createProject(owner.page, 'Closed later');
    const url = await createShareLink(owner.page, { guests: true, role: 'Can view' });

    const ctx = await browser.newContext();
    const guest = await ctx.newPage();
    await guest.goto(url);
    await guest.getByLabel('Your name').fill('Visitor');
    await guest.getByRole('button', { name: 'Join as guest' }).click();
    await expect(guest.getByTestId('canvas')).toBeVisible();
    await expect(guest.getByText('Can view', { exact: true })).toBeVisible();
    // Guest dashboard variant.
    await guest.goto('/');
    await expect(guest.getByText('Keep your projects')).toBeVisible();
    // Guests can start their own projects too (see the "start without an account" test).
    await expect(guest.getByRole('button', { name: 'New project' })).toBeVisible();
    await guest.getByRole('link', { name: 'Open Closed later' }).click();
    await expect(guest.getByTestId('canvas')).toBeVisible();

    await owner.page.getByRole('button', { name: 'Share' }).click();
    await owner.page.getByRole('button', { name: 'Revoke link' }).click();
    await expect(
      owner.page.getByLabel('Also remove the 1 guest who joined with this link'),
    ).toBeChecked();
    await owner.page.getByRole('button', { name: 'Revoke link' }).last().click();
    await expect(owner.page.getByText('Link revoked and 1 guest(s) removed')).toBeVisible();
    await expect(guest.getByText('No access')).toBeVisible({ timeout: 15000 });
    await guest.goto(url);
    await expect(guest.getByText('Link not available')).toBeVisible();

    // A link that requires an account offers sign-in only.
    await owner.page.keyboard.press('Escape');
    const closed = await createShareLink(owner.page, { guests: false });
    const ctx2 = await browser.newContext();
    const visitor = await ctx2.newPage();
    await visitor.goto(closed);
    await expect(visitor.getByText('This link requires an account.')).toBeVisible();
    await expect(visitor.getByLabel('Your name')).toHaveCount(0);

    await owner.context.close();
    await ctx.close();
    await ctx2.close();
  });

  test('a visitor starts drawing without an account and signs up when sharing', async ({
    browser,
  }) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto('/');
    await page.getByRole('button', { name: 'Start drawing — no account needed' }).click();

    // Straight into the template picker.
    const dialog = page.getByRole('dialog', { name: 'New project' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Name').fill('My first loop');
    await dialog.getByRole('button', { name: 'Create project' }).click();
    await expect(page.getByTestId('canvas')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Keep your work' })).toBeVisible();
    await addVariable(page, 'Curiosity', 400, 300);

    // Sharing asks for an account.
    await page.getByRole('button', { name: 'Share' }).click();
    await expect(page.getByText('Create a free account to share')).toBeVisible();
    await expect(page.getByRole('button', { name: /Create link|New link/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Create free account' }).click();
    await expect(page.getByRole('heading', { name: 'Keep your projects' })).toBeVisible();
    await page.getByLabel('Name').fill('Sam');
    await page.getByLabel('Email').fill(uniqueEmail('sam'));
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Create account' }).click();

    // Back in the same project, now owned by the account, and sharing works.
    await expect(page.getByText('Your projects are now saved to your account.')).toBeVisible();
    await expect(variable(page, 'Curiosity')).toHaveCount(1);
    await expect(page.getByRole('link', { name: 'Keep your work' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Share' }).click();
    await expect(page.getByRole('button', { name: /Create link|New link/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Open My first loop' })).toBeVisible();

    await ctx.close();
  });
});
