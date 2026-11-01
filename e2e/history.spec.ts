import { expect, test } from '@playwright/test';
import {
  addVariable,
  center,
  createProject,
  dragBy,
  drawLink,
  newUser,
  openProject,
  variable,
} from './helpers';

test('the History panel shows who changed what, live, with moves grouped', async ({ browser }) => {
  const lead = await newUser(browser, 'Lena');
  const mate = await newUser(browser, 'Max');
  const id = await createProject(lead.page, 'Tracked');
  const origin = new URL(lead.page.url()).origin;
  await lead.page.request.post(`/api/projects/${id}/members`, {
    data: { email: mate.email, role: 'editor' },
    headers: { origin },
  });
  await openProject(mate.page, id);

  await lead.page.getByRole('tab', { name: 'History' }).click();
  await expect(lead.page.getByText('Nothing has changed yet.')).toBeVisible();

  // Max edits; Lena's panel updates by itself.
  await addVariable(mate.page, 'Births', 400, 300);
  await addVariable(mate.page, 'Population', 750, 300);
  await drawLink(mate.page, 'Births', 'Population');
  await mate.page.keyboard.press('+');
  const history = lead.page.getByRole('list', { name: 'Change history' });
  await expect(history.getByText('set polarity of “Births → Population” to +')).toBeVisible();
  await expect(history.getByText('added variable “Births”')).toBeVisible();

  // Several drags become one grouped entry.
  await mate.page.keyboard.press('Escape');
  await dragBy(mate.page, await center(mate.page, variable(mate.page, 'Births')), 0, 60);
  await dragBy(mate.page, await center(mate.page, variable(mate.page, 'Population')), 0, 60);
  await dragBy(mate.page, await center(mate.page, variable(mate.page, 'Births')), 30, 0);
  await expect(history.getByText('rearranged 2 elements')).toBeVisible();
  await expect(history.getByText(/moved 1 element/)).toHaveCount(0);

  // Renames and colour changes are listed individually.
  await mate.page.mouse.dblclick(
    ...(Object.values(await center(mate.page, variable(mate.page, 'Births'))) as [number, number]),
  );
  await mate.page.getByLabel('Variable name').first().fill('Birth rate');
  await mate.page.keyboard.press('Enter');
  await mate.page.getByRole('tab', { name: 'Design' }).click();
  await mate.page.getByRole('button', { name: 'Color #2563eb' }).first().click();
  await expect(history.getByText('renamed “Births” to “Birth rate”')).toBeVisible();
  await expect(history.getByText('changed text color of “Birth rate”')).toBeVisible();
  await expect(
    history.locator('li', { hasText: 'renamed “Births”' }).getByText('Max', { exact: true }),
  ).toBeVisible();

  // Clicking an entry selects the element on the canvas.
  await lead.page.keyboard.press('Escape');
  await history.getByText('added variable “Population”').click();
  await lead.page.getByRole('tab', { name: 'Design' }).click();
  await expect(lead.page.getByLabel('Variable name')).toHaveValue('Population');

  // Saved versions appear in the timeline.
  await lead.page.request.post(`/api/projects/${id}/versions`, {
    data: { label: 'Workshop end' },
    headers: { origin },
  });
  await lead.page.getByRole('tab', { name: 'History' }).click();
  await expect(history.getByText('Saved version “Workshop end”')).toBeVisible();

  await lead.context.close();
  await mate.context.close();
});
