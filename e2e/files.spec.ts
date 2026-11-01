import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { addVariable, links, loops, signUp, variable } from './helpers';

const fixture = (name: string) => new URL(`../packages/mdl/test/fixtures/${name}`, import.meta.url).pathname;

test.describe('import, export and versions', () => {
  test('imports a Vensim model and exports it byte-for-byte; exports images and PDF', async ({ page }) => {
    await signUp(page, 'Vera');
    await page.locator('input[type="file"]').setInputFiles(fixture('servitization.mdl'));
    await expect(page).toHaveURL(/\/p\//);
    await expect(page.getByRole('button', { name: 'servitization' })).toBeVisible();
    await expect(page.locator('[data-type="variable"]')).toHaveCount(16);
    await expect(links(page)).toHaveCount(19);
    await expect(loops(page)).toHaveCount(4);
    await expect(page.locator('[data-type="text"]', { hasText: 'TODO' })).toHaveCount(1);

    const download = async (format: RegExp) => {
      await page.keyboard.press('ControlOrMeta+e');
      const dialog = page.getByRole('dialog', { name: 'Export' });
      await dialog.getByRole('button', { name: format }).click();
      const [file] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: /^Download/ }).click()]);
      return file;
    };

    const mdl = await download(/^Vensim$/);
    expect(mdl.suggestedFilename()).toBe('servitization.mdl');
    expect(readFileSync((await mdl.path())!)).toEqual(readFileSync(fixture('servitization.mdl')));

    const png = await download(/^PNG$/);
    const pngBytes = readFileSync((await png.path())!);
    expect(pngBytes.subarray(1, 4).toString()).toBe('PNG');
    expect(pngBytes.length).toBeGreaterThan(20_000);

    const svg = await download(/^SVG$/);
    expect(readFileSync((await svg.path())!, 'utf8')).toContain('Hospital Satisfaction');

    const pdf = await download(/^PDF$/);
    const pdfBytes = readFileSync((await pdf.path())!);
    expect(pdfBytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdfBytes.length).toBeGreaterThan(5_000);

    const json = await download(/^Loopwise$/);
    const data = JSON.parse(readFileSync((await json.path())!, 'utf8'));
    expect(data.format).toBe('cld');
    expect(Object.keys(data.doc.variables)).toHaveLength(16);
  });

  test('warns about styling that Vensim cannot represent', async ({ page }) => {
    await signUp(page, 'Walt');
    await page.locator('input[type="file"]').setInputFiles(fixture('coffee-agroforestry.mdl'));
    await expect(page.locator('[data-type="variable"]')).toHaveCount(22);
    await addVariable(page, 'New idea', 300, 120);
    await page.getByRole('radio', { name: 'Box' }).click();
    await page.keyboard.press('ControlOrMeta+e');
    await page.getByRole('dialog').getByRole('button', { name: /^Vensim$/ }).click();
    await expect(page.getByText('Variable box shapes are not exported to Vensim')).toBeVisible();
  });

  test('saves and restores versions', async ({ page }) => {
    await signUp(page, 'Hedy');
    await page.getByRole('button', { name: 'New project' }).first().click();
    await page.getByLabel('Name').fill('Versioned');
    await page.getByRole('button', { name: 'Create project' }).click();
    await expect(page.getByTestId('canvas')).toBeVisible();
    await addVariable(page, 'Keep me', 500, 300);
    await page.getByRole('button', { name: 'More' }).click();
    await page.getByRole('menuitem', { name: 'Version history' }).click();
    await page.getByLabel('Version name').fill('Good state');
    await page.getByRole('button', { name: 'Save version' }).click();
    await expect(page.getByText('Version saved')).toBeVisible();
    await page.keyboard.press('Escape');

    await addVariable(page, 'Mistake', 800, 300);
    await page.getByRole('button', { name: 'More' }).click();
    await page.getByRole('menuitem', { name: 'Version history' }).click();
    await page.getByRole('button', { name: /Good state/ }).click();
    await expect(page.getByAltText('Version preview')).toBeVisible();
    await page.getByRole('button', { name: 'Restore this version' }).click();
    await expect(variable(page, 'Mistake')).toHaveCount(0);
    await expect(variable(page, 'Keep me')).toHaveCount(1);
  });
});
