import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function checkAccessibility(page: Page) {
  const scan = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(
    scan.violations
      .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
      .map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        nodes: violation.nodes.map((node) => ({
          target: node.target,
          reason: node.failureSummary,
        })),
      })),
  ).toEqual([]);
}

async function loadSample(page: Page) {
  await page.getByRole('button', { name: 'Load sample invoice' }).click();
  await expect(page.getByRole('textbox', { name: 'Item 1 description', exact: true })).toHaveValue(
    'Handwoven market basket',
  );
}

test('build an invoice, inspect integer taxes, issue a mock receipt', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('In-browser mock is ready')).toBeVisible();
  await expect(page.getByText('A good invoice starts with one item.')).toBeVisible();
  await checkAccessibility(page);
  await loadSample(page);
  await expect(page.locator('.total-preview strong')).toContainText('330.01');
  await page.getByRole('button', { name: 'Inclusive', exact: true }).click();
  await expect(page.locator('.total-preview strong')).toContainText('275.00');
  await page.getByRole('button', { name: 'Exclusive', exact: true }).click();
  await page.getByRole('button', { name: 'Issue mock invoice', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your mock receipt is ready.' })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Mock invoice receipt' })).toContainText('330.01');
  await expect(
    page.getByRole('img', { name: /QR code encoding this mock receipt/ }),
  ).toHaveAttribute('src', /^data:image\/png/);
  await page.getByRole('button', { name: 'Response JSON', exact: true }).click();
  await expect(page.getByLabel('Response JSON code')).toContainText('ysdcregsig');
  await expect(page.getByLabel('Response JSON code')).toContainText('MOCK');
  await page.getByRole('button', { name: 'SDK snippet', exact: true }).click();
  await expect(page.getByLabel('SDK snippet code')).toContainText('client.invoice(invoice)');
  await checkAccessibility(page);
});

test('fractional refunds preserve exact quantities and cancellation restores them', async ({
  page,
}) => {
  await page.goto('/');
  await loadSample(page);
  await page.getByRole('textbox', { name: 'Item 1 quantity', exact: true }).fill('0.3');
  await page.getByRole('button', { name: 'Issue mock invoice', exact: true }).click();
  await page.getByRole('button', { name: 'Refund this invoice', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Refund item 1 quantity', exact: true }).fill('1');
  await page.getByRole('button', { name: 'Issue partial refund', exact: true }).click();
  await expect(page.locator('#builder-error')).toContainText('exceeds the remaining sold quantity');
  await page.getByRole('spinbutton', { name: 'Refund item 1 quantity', exact: true }).fill('0.1');
  await page.getByRole('button', { name: 'Issue partial refund', exact: true }).click();
  await expect(page.getByText('0.2 of 0.3 available · AC-001')).toBeVisible();
  await expect(page.locator('.refund-status')).toContainText('issued');
  await expect(page.locator('.refund-status')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Cancel refund', exact: true })).toBeFocused();
  await page.getByRole('spinbutton', { name: 'Refund item 1 quantity', exact: true }).fill('0.2');
  await page.getByRole('button', { name: 'Issue partial refund', exact: true }).click();
  await expect(page.getByText('0 of 0.3 available · AC-001')).toBeVisible();
  await checkAccessibility(page);
  await page.getByRole('button', { name: 'Cancel refund', exact: true }).last().click();
  await expect(page.getByText('0.2 of 0.3 available · AC-001')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel refund', exact: true }).click();
  await expect(page.getByText('0.3 of 0.3 available · AC-001')).toBeVisible();
  await expect(page.locator('.refund-status')).toContainText('cancelled');
});

test('mock failures are readable and the builder fits a 320px viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/');
  await loadSample(page);
  await page.getByRole('combobox', { name: 'Mock response scenario' }).selectOption('500');
  await page.getByRole('button', { name: 'Issue mock invoice', exact: true }).click();
  await expect(page.locator('#builder-error')).toContainText('couldn’t complete');
  await page.getByText('Raw error response', { exact: true }).click();
  await expect(page.locator('#builder-error').locator('pre')).toContainText('500');
  await expect(page.getByRole('heading', { name: 'Your mock receipt is ready.' })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await checkAccessibility(page);
  await page.route('http://localhost:8787/**', (route) => route.abort('connectionrefused'));
  await page.getByRole('combobox', { name: 'Mock connection' }).selectOption('server');
  await expect(page.getByText('Local mock is unreachable')).toBeVisible();
  await expect(page.getByText('Start it with: pnpm --filter @gra-evat/mock start')).toBeVisible();
});
