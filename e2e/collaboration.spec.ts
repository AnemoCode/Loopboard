import { expect, test, type Page } from '@playwright/test';
import {
  addVariable,
  center,
  createProject,
  drawLink,
  links,
  newUser,
  openProject,
  variable,
} from './helpers';

async function share(page: Page, email: string, role: 'Can edit' | 'Can comment' | 'Can view') {
  await page.getByRole('button', { name: 'Share' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Email address').fill(email);
  await dialog.getByLabel('Role', { exact: true }).selectOption({ label: role });
  await dialog.getByRole('button', { name: 'Invite' }).click();
  await expect(page.getByText(`${email} now has access`)).toBeVisible();
  await page.keyboard.press('Escape');
}

test.describe('real-time collaboration', () => {
  test('editors see each other, their edits, cursors, selections and live drags', async ({
    browser,
  }) => {
    const alice = await newUser(browser, 'Alice');
    const bob = await newUser(browser, 'Bob');
    const id = await createProject(alice.page, 'Team CLD');
    await share(alice.page, bob.email, 'Can edit');
    await openProject(bob.page, id);

    // Presence avatars
    await expect(alice.page.getByRole('button', { name: 'Follow Bob' })).toBeVisible();
    await expect(bob.page.getByRole('button', { name: 'Follow Alice' })).toBeVisible();

    // Edits sync both ways
    await addVariable(alice.page, 'Workload', 450, 300);
    await expect(variable(bob.page, 'Workload')).toHaveCount(1);
    await addVariable(bob.page, 'Burnout', 800, 300);
    await expect(variable(alice.page, 'Burnout')).toHaveCount(1);
    await drawLink(bob.page, 'Workload', 'Burnout');
    await bob.page.keyboard.press('+');
    await expect(links(alice.page).first().locator('text')).toHaveText('+');

    // Remote cursor with name label
    const canvasBox = (await bob.page.getByTestId('canvas').boundingBox())!;
    await bob.page.mouse.move(canvasBox.x + 600, canvasBox.y + 500, { steps: 3 });
    await expect(alice.page.locator('span', { hasText: /^Bob$/ })).toBeVisible();

    // Remote selection outline labelled with the selecting user's name
    await bob.page.mouse.click(
      ...(Object.values(await center(bob.page, variable(bob.page, 'Workload'))) as [
        number,
        number,
      ]),
    );
    await expect(alice.page.locator('svg text', { hasText: /^Bob$/ })).toBeVisible();

    // Live drag: Alice sees Workload move while Bob is still holding the mouse button.
    const readX = () =>
      variable(alice.page, 'Workload').locator('text tspan').first().getAttribute('x');
    const startX = await readX();
    const c = await center(bob.page, variable(bob.page, 'Workload'));
    await bob.page.mouse.move(c.x, c.y);
    await bob.page.mouse.down();
    await bob.page.mouse.move(c.x - 60, c.y + 40, { steps: 6 });
    await bob.page.mouse.move(c.x - 120, c.y + 80, { steps: 6 });
    await expect.poll(readX).not.toBe(startX);
    await bob.page.mouse.up();
    // After the drop both agree on the final position.
    await expect
      .poll(readX)
      .toBe(await variable(bob.page, 'Workload').locator('text tspan').first().getAttribute('x'));

    // Follow mode: clicking Bob's avatar follows his viewport.
    await alice.page.getByRole('button', { name: 'Follow Bob' }).click();
    await expect(alice.page.getByRole('button', { name: 'Stop following Bob' })).toBeVisible();

    await alice.context.close();
    await bob.context.close();
  });

  test('commenters comment but cannot edit; viewers only view; removed members lose access', async ({
    browser,
  }) => {
    const owner = await newUser(browser, 'Owner');
    const commenter = await newUser(browser, 'Carla');
    const viewer = await newUser(browser, 'Victor');
    const id = await createProject(owner.page, 'Reviewed');
    await addVariable(owner.page, 'Quality', 500, 300);
    await share(owner.page, commenter.email, 'Can comment');
    await share(owner.page, viewer.email, 'Can view');

    // Commenter: no editing tools, but can comment.
    await openProject(commenter.page, id);
    await expect(commenter.page.getByRole('button', { name: 'Variable' })).toHaveCount(0);
    await expect(commenter.page.getByText('Can comment')).toBeVisible();
    const before = await commenter.page.locator('[data-type="variable"]').count();
    const box = (await commenter.page.getByTestId('canvas').boundingBox())!;
    await commenter.page.mouse.dblclick(box.x + 800, box.y + 500);
    await expect(commenter.page.getByLabel('Variable name')).toHaveCount(0);
    expect(await commenter.page.locator('[data-type="variable"]').count()).toBe(before);

    await commenter.page.keyboard.press('c');
    await commenter.page.mouse.click(
      ...(Object.values(await center(commenter.page, variable(commenter.page, 'Quality'))) as [
        number,
        number,
      ]),
    );
    await commenter.page.getByLabel('Add a comment…').fill('Should this have a delay?');
    await commenter.page.getByRole('button', { name: 'Send', exact: true }).click();

    // Owner sees the comment pin live and replies.
    const pin = owner.page.getByRole('button', { name: 'Comment by Carla' });
    await expect(pin).toBeVisible();
    await pin.click();
    await expect(owner.page.getByText('Should this have a delay?')).toBeVisible();
    await owner.page.getByLabel('Reply…').fill('Yes, good catch');
    await owner.page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(commenter.page.getByRole('button', { name: 'Comment by Carla' })).toContainText(
      '2',
    );

    // Viewer: read-only, no comment tool either.
    await openProject(viewer.page, id);
    await expect(viewer.page.getByText('Can view')).toBeVisible();
    await expect(viewer.page.getByRole('button', { name: 'Comment', exact: true })).toHaveCount(0);
    await expect(variable(viewer.page, 'Quality')).toHaveCount(1);

    // Owner removes the viewer → their editor shows "No access".
    await owner.page.getByRole('button', { name: 'Share' }).click();
    await owner.page.getByRole('button', { name: 'Remove Victor' }).click();
    await expect(owner.page.getByText('Victor was removed')).toBeVisible();
    await expect(viewer.page.getByText('No access')).toBeVisible({ timeout: 15000 });

    for (const u of [owner, commenter, viewer]) await u.context.close();
  });

  test('joins through an invite link', async ({ browser }) => {
    const owner = await newUser(browser, 'Olga');
    const guest = await newUser(browser, 'Gus');
    const id = await createProject(owner.page, 'Linked');
    const res = await owner.page.request.post(`/api/projects/${id}/links`, {
      data: { role: 'editor' },
      headers: { origin: new URL(owner.page.url()).origin },
    });
    const { token } = (await res.json()) as { token: string };
    await guest.page.goto(`/invite/${token}`);
    await expect(guest.page.getByText('Olga invited you')).toBeVisible();
    await guest.page.getByRole('button', { name: 'Join as Gus' }).click();
    await expect(guest.page).toHaveURL(new RegExp(`/p/${id}`));
    await expect(guest.page.getByRole('button', { name: 'Variable' })).toBeVisible();
    await owner.context.close();
    await guest.context.close();
  });
});
