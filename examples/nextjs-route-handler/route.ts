import { createClient } from '@gra-evat/core';

// Copy into app/api/invoices/route.ts in your server-side Next.js project.
// Supply your own application authentication before exposing this handler.
export async function POST(request: Request): Promise<Response> {
  const securityKey = process.env.GRA_SECURITY_KEY;
  const taxpayerId = process.env.GRA_TAXPAYER_ID;
  const baseUrl = process.env.GRA_BASE_URL;
  if (!securityKey || !taxpayerId || !baseUrl) {
    return Response.json({ error: 'Server credentials are not configured' }, { status: 503 });
  }
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return Response.json({ error: 'Body must be JSON' }, { status: 400 });
  }
  const result = await createClient({ baseUrl, credentials: { securityKey, taxpayerId } }).invoice(
    input,
  );
  return Response.json(result, { status: result.ok ? 200 : 422 });
}
