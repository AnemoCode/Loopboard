import { expect, test } from '@playwright/test';
import {
  addVariable,
  canvas,
  center,
  createProject,
  drawLink,
  dragBy,
  links,
  loops,
  signUp,
  variable,
  newUser,
} from './helpers';

test.describe('single-user editing', () => {
  test('builds a feedback loop with polarities, curves it, marks the loop and undoes', async ({
    page,
  }) => {
    await signUp(page, 'Ada');
    await createProject(page, 'Population');
    await expect(page.getByText('This diagram is empty')).toBeVisible();

    await addVariable(page, 'Births', 400, 300);
    await addVariable(page, 'Population', 700, 300);
    await addVariable(page, 'Deaths', 1000, 300);

    // Births -> Population (+) ; Population -> Births (+)  => reinforcing loop
    await drawLink(page, 'Births', 'Population');
    await page.keyboard.press('+');
    await expect(links(page).first().locator('text')).toHaveText('+');
    await drawLink(page, 'Population', 'Births');
    await page.keyboard.press('+');
    // Population -> Deaths (+), Deaths -> Population (–) => balancing loop
    await drawLink(page, 'Population', 'Deaths');
    await page.keyboard.press('+');
    await drawLink(page, 'Deaths', 'Population');
    await page.keyboard.press('-');
    await expect(links(page).last().locator('text')).toHaveText('–');

    // Delay mark on the selected link (two short strokes are added).
    const pathsBefore = await links(page).last().locator('path').count();
    await page.keyboard.press('d');
    await expect(links(page).last().locator('path')).toHaveCount(pathsBefore + 1);

    // Curve the selected link by dragging its midpoint handle.
    const handle = page.locator('[data-handle="curve"]');
    const dBefore = await links(page).last().locator('path').nth(1).getAttribute('d');
    await dragBy(page, await center(page, handle), 0, 80);
    await expect
      .poll(() => links(page).last().locator('path').nth(1).getAttribute('d'))
      .not.toBe(dBefore);
    expect(await links(page).last().locator('path').nth(1).getAttribute('d')).toContain('A');

    // Loop analysis finds both loops; add markers from the panel.
    await page.getByRole('tab', { name: 'Loops' }).click();
    await expect(page.getByText('2 feedback loops: 1 reinforcing, 1 balancing.')).toBeVisible();
    await page.getByRole('button', { name: 'Add marker' }).first().click();
    await page.getByRole('button', { name: 'Add marker' }).first().click();
    await expect(loops(page)).toHaveCount(2);
    expect((await loops(page).locator('text').allTextContents()).sort()).toEqual(['B1', 'R1']);

    // Undo the last two markers, then redo one.
    await page.keyboard.press('Escape');
    await page.keyboard.press('ControlOrMeta+z');
    await expect(loops(page)).toHaveCount(1);
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(loops(page)).toHaveCount(2);
  });

  test('moves, renames, styles, deletes and uses layers, shapes, text and diagrams', async ({
    page,
  }) => {
    await signUp(page, 'Grace');
    await createProject(page, 'Workshop');
    await addVariable(page, 'Trust', 500, 300);
    await addVariable(page, 'Sales', 800, 300);
    await drawLink(page, 'Trust', 'Sales');

    // Move a variable by dragging; the link follows.
    const linkPath = () => links(page).first().locator('path').nth(1).getAttribute('d');
    const before = await linkPath();
    await page.keyboard.press('Escape');
    await dragBy(page, await center(page, variable(page, 'Sales')), 0, 120);
    await expect.poll(linkPath).not.toBe(before);

    // Rename by double-click.
    await page.mouse.dblclick(
      ...(Object.values(await center(page, variable(page, 'Sales'))) as [number, number]),
    );
    const input = page.getByLabel('Variable name').first();
    await input.fill('Revenue');
    await input.press('Enter');
    await expect(variable(page, 'Revenue')).toHaveCount(1);

    // Duplicate names are rejected.
    await page.mouse.dblclick(
      ...(Object.values(await center(page, variable(page, 'Revenue'))) as [number, number]),
    );
    await page.getByLabel('Variable name').first().fill('trust');
    await page.getByLabel('Variable name').first().press('Enter');
    await expect(page.getByText('A variable called “trust” already exists')).toBeVisible();
    await expect(variable(page, 'Revenue')).toHaveCount(1);

    // Style: give the selected variable a box and a color.
    await page.mouse.click(
      ...(Object.values(await center(page, variable(page, 'Revenue'))) as [number, number]),
    );
    await page.getByRole('tab', { name: 'Design' }).click();
    await page.getByRole('radio', { name: 'Box' }).click();
    await expect(variable(page, 'Revenue').locator('rect')).toHaveCount(2); // hit area + box
    await page.getByRole('button', { name: 'Color #dc2626' }).first().click();
    await expect(variable(page, 'Revenue').locator('text')).toHaveAttribute('fill', '#dc2626');

    // Shape tool: draw a boundary; text tool: add a note.
    await page.keyboard.press('Escape');
    await page.keyboard.press('r');
    const box = (await canvas(page).boundingBox())!;
    await dragBy(page, { x: box.x + 300, y: box.y + 520 }, 260, 120);
    await expect(page.locator('[data-type="shape"]')).toHaveCount(1);
    await page.keyboard.press('t');
    await page.mouse.click(box.x + 900, box.y + 600);
    await page.getByLabel('Text content').fill('Customer subsystem');
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(page.locator('[data-type="text"]', { hasText: 'Customer subsystem' })).toHaveCount(
      1,
    );

    // Layers: add a layer, draw on it, hide it.
    await page.getByRole('tab', { name: 'Layers' }).click();
    await page.getByRole('button', { name: 'Add layer' }).click();
    await addVariable(page, 'Hidden idea', 1000, 150);
    await page.getByRole('button', { name: 'Hide layer' }).first().click();
    await expect(variable(page, 'Hidden idea')).toHaveCount(0);
    await page.getByRole('button', { name: 'Show layer' }).first().click();
    await expect(variable(page, 'Hidden idea')).toHaveCount(1);

    // Delete a variable: its links go too.
    await page.mouse.click(
      ...(Object.values(await center(page, variable(page, 'Trust'))) as [number, number]),
    );
    await page.keyboard.press('Delete');
    await expect(variable(page, 'Trust')).toHaveCount(0);
    await expect(links(page)).toHaveCount(0);

    // Diagrams: add a second diagram and switch between them.
    await page.getByRole('button', { name: 'New diagram' }).click();
    await expect(page.getByRole('tab', { name: 'Diagram 2' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByText('This diagram is empty')).toBeVisible();
    await page.getByRole('tab', { name: 'Main' }).click();
    await expect(variable(page, 'Revenue')).toHaveCount(1);
  });

  test('copy/paste, drop-to-create and keyboard navigation', async ({ page }) => {
    await signUp(page, 'Linus');
    await createProject(page, 'Clipboard');
    await addVariable(page, 'Effort', 500, 300);

    // Drag a link from Effort onto empty canvas creates a new linked variable.
    const src = await center(page, variable(page, 'Effort'));
    await page.mouse.move(src.x, src.y);
    const c = await center(page, page.locator('[data-connector] circle[r]').last());
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.mouse.move(c.x + 150, c.y + 100, { steps: 6 });
    await page.mouse.move(c.x + 250, c.y + 150, { steps: 6 });
    await page.mouse.up();
    const input = page.getByLabel('Variable name').first();
    await input.fill('Results');
    await input.press('Enter');
    await expect(variable(page, 'Results')).toHaveCount(1);
    await expect(links(page)).toHaveCount(1);

    // Select all + duplicate → shadows of the same variables (angle brackets) plus a copied link.
    await page.mouse.click(10, 500);
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('ControlOrMeta+d');
    await expect(page.locator('[data-type="variable"] text', { hasText: '<Effort>' })).toHaveCount(
      1,
    );
    await expect(links(page)).toHaveCount(2);

    // Shortcuts dialog
    await page.keyboard.press('Escape');
    await page.keyboard.press('?');
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
  });
});

test('loads without console errors or CSP violations', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    // The anonymous session probe on the sign-up page is an expected 401.
    if (m.type() === 'error' && !m.text().includes('401')) errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await signUp(page, 'Clean');
  await createProject(page, 'Console check');
  await addVariable(page, 'A', 400, 300);
  await page.keyboard.press('ControlOrMeta+e');
  await expect(page.getByRole('dialog', { name: 'Export' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('command palette finds variables across diagrams', async ({ page }) => {
  await signUp(page, 'Pal');
  await createProject(page, 'Palette');
  await addVariable(page, 'Customer satisfaction', 400, 300);
  await page.getByRole('button', { name: 'New diagram' }).click();
  await expect(page.getByRole('tab', { name: 'Diagram 2' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByLabel('Search variables and commands').fill('satisf');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('tab', { name: 'Main' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Variable name')).toHaveValue('Customer satisfaction');
});

test('every template loop comes with its own marker', async ({ browser }) => {
  const { page, context } = await newUser(browser, 'Tina');
  const expected = { 'Engine of Growth': 2, 'Word of Mouth': 2, 'Perceived Quality': 1 };
  for (const [name, count] of Object.entries(expected)) {
    await page.goto('/');
    await page.getByRole('button', { name: 'New project' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'New project' });
    await dialog.getByRole('button', { name: new RegExp(`^${name}`) }).click();
    await dialog.getByRole('button', { name: 'Create project' }).click();
    await expect(canvas(page)).toBeVisible();
    await expect(page.locator('[data-type="loop"]')).toHaveCount(count);
    await page.getByRole('tab', { name: 'Loops' }).click();
    await expect(page.getByRole('button', { name: /^Marked / })).toHaveCount(count);
    await expect(page.getByRole('button', { name: 'Add marker' })).toHaveCount(0);
  }
  await context.close();
});
