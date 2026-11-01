import { expect, type Browser, type Page } from '@playwright/test';

export const PASSWORD = 'correct-horse-battery';
let counter = 0;
export const uniqueEmail = (name: string) => `${name.toLowerCase()}-${Date.now()}-${counter++}@example.com`;

export async function signUp(page: Page, name: string): Promise<string> {
  const email = uniqueEmail(name);
  await page.goto('/signup');
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
  return email;
}

export async function newUser(browser: Browser, name: string) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const email = await signUp(page, name);
  return { context, page, email };
}

/** Create a project through the API (fast) and open it. */
export async function createProject(page: Page, name: string, snapshot?: unknown): Promise<string> {
  const res = await page.request.post('/api/projects', { data: { name, ...(snapshot ? { snapshot } : {}) }, headers: { origin: new URL(page.url()).origin } });
  expect(res.status()).toBe(201);
  const { id } = (await res.json()) as { id: string };
  await openProject(page, id);
  return id;
}

export async function openProject(page: Page, id: string) {
  await page.goto(`/p/${id}`);
  await expect(page.getByTestId('canvas')).toBeVisible();
}

export const canvas = (page: Page) => page.getByTestId('canvas');
export const variable = (page: Page, name: string) => page.locator('[data-type="variable"]').filter({ has: page.locator('text', { hasText: name }) });
export const links = (page: Page) => page.locator('[data-type="link"]');
export const loops = (page: Page) => page.locator('[data-type="loop"]');

export async function center(page: Page, locator: ReturnType<Page['locator']>) {
  const box = (await locator.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Double-click the canvas at an offset from its top-left and type a variable name. */
export async function addVariable(page: Page, name: string, x: number, y: number) {
  const box = (await canvas(page).boundingBox())!;
  await page.mouse.dblclick(box.x + x, box.y + y);
  const input = page.getByLabel('Variable name').first();
  await expect(input).toBeFocused();
  await input.fill(name);
  await input.press('Enter');
  await expect(variable(page, name)).toHaveCount(1);
}

/** Hover the source variable and drag one of its connector dots onto the target. */
export async function drawLink(page: Page, from: string, to: string) {
  const before = await links(page).count();
  const src = await center(page, variable(page, from));
  await page.mouse.move(src.x, src.y);
  const connector = page.locator('[data-connector] circle[r]').last();
  await expect(connector).toBeVisible();
  const c = await center(page, connector);
  const dst = await center(page, variable(page, to));
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move((c.x + dst.x) / 2, (c.y + dst.y) / 2, { steps: 5 });
  await page.mouse.move(dst.x, dst.y, { steps: 5 });
  await page.mouse.up();
  await expect(links(page)).toHaveCount(before + 1);
}

export async function dragBy(page: Page, from: { x: number; y: number }, dx: number, dy: number) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 4 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 4 });
  await page.mouse.up();
}
