import { expect, it } from 'vitest';
import { createMockApp } from '../routes';
import diagnostics from './validation-diagnostics.json';

it.each(diagnostics)('preserves $name HTTP validation diagnostics', async (entry) => {
  const response = await createMockApp({ seed: 'compatibility' }).request(
    `/vsdc/api/v1/taxpayer/C0000000000-001/${entry.path}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', security_key: 'mock' },
      body: JSON.stringify(entry.input),
    },
  );
  expect(response.status).toBe(entry.status);
  expect(((await response.json()) as { error: string }).error).toBe(entry.error);
});
