import { z } from 'zod';
import { DEFAULT_TIN_PATTERN, ENDPOINTS } from './config';
import {
  GraApiError,
  NetworkError,
  TimeoutError,
  ValidationError,
  type GraError,
  type Result,
} from './errors';
import {
  CallbackSchema,
  CancellationSchema,
  GraResponseSchema,
  HealthSchema,
  IdentificationSchema,
  InventoryResponseSchema,
  InventorySchema,
  NoteSchema,
  StatementOfAccountSchema,
  type Invoice,
} from './schemas';
import { validateInvoice, validateSchema, type ValidationOptions } from './validate';

export interface ClientCredentials {
  readonly securityKey: string;
  readonly taxpayerId: string;
}
export interface ClientOptions {
  readonly baseUrl: string;
  readonly credentials: ClientCredentials;
  readonly fetch?: typeof globalThis.fetch;
  readonly timeoutMs?: number;
  /** Retries resend POSTs. Default 0; use callback reconciliation before resending an invoice. */
  readonly retries?: number;
  readonly validation?: ValidationOptions;
}

function validationFailure(
  path: string,
  received: unknown,
  expected: string,
  hint: string,
): ValidationError {
  return new ValidationError([{ path, received, expected, message: `Expected ${expected}`, hint }]);
}

function retryDelay(attempt: number, retryAfter: string | null): number {
  // ASSUMPTION: Bound Retry-After to 60s and exponential backoff to 30s; v8.2 specifies no retry policy.
  if (retryAfter !== null) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 60000);
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.min(Math.max(0, date - Date.now()), 60000);
  }
  return Math.min(250 * 2 ** attempt, 30000) + Math.floor(Math.random() * 100);
}

function errorCode(body: unknown): string {
  if (typeof body === 'object' && body !== null) {
    const code: unknown = Reflect.get(body, 'error');
    if (typeof code === 'string') return code;
  }
  return 'HTTP_ERROR';
}

/** Create a portable fetch client. Each method validates before sending.
 * `throwing` offers the same methods with exceptions instead of result unions.
 * @example
 * ```ts
 * import { createClient } from '@gra-evat/core';
 * const gra = createClient({baseUrl:'http://localhost:8787',credentials:{taxpayerId:'C0000000000-001',securityKey:'mock'}}); const status = await gra.health();
 * ```
 */
export function createClient(options: ClientOptions) {
  let parsedBase: URL;
  try {
    parsedBase = new URL(options.baseUrl);
  } catch {
    throw validationFailure(
      'baseUrl',
      options.baseUrl,
      'absolute HTTP(S) URL',
      'Use http://localhost:8787 for the local mock',
    );
  }
  if (
    !['http:', 'https:'].includes(parsedBase.protocol) ||
    parsedBase.username ||
    parsedBase.password
  ) {
    throw validationFailure(
      'baseUrl',
      options.baseUrl,
      'HTTP(S) URL without embedded credentials',
      'Provide GRA credentials through the credentials object',
    );
  }
  if (!options.credentials.securityKey || !/^[A-Za-z0-9-]+$/.test(options.credentials.taxpayerId)) {
    throw validationFailure(
      'credentials',
      '[redacted]',
      'non-empty securityKey and taxpayerId with letters, digits or hyphens',
      'Set your own GRA credential environment variables',
    );
  }
  const timeoutMs = options.timeoutMs ?? 10000;
  const retries = options.retries ?? 0;
  // ASSUMPTION: A maximum of 10 explicit retries is a local resource safeguard, not a GRA limit.
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > 2147483647 ||
    !Number.isSafeInteger(retries) ||
    retries < 0 ||
    retries > 10
  ) {
    throw validationFailure(
      'clientOptions',
      { timeoutMs, retries },
      'integer timeoutMs from 1 to 2147483647 and integer retries from 0 to 10',
      'Use timeoutMs:10000 and retries:0 initially',
    );
  }
  const fetcher = options.fetch ?? globalThis.fetch;
  if (typeof fetcher !== 'function')
    throw validationFailure(
      'fetch',
      undefined,
      'fetch implementation',
      'Inject fetch on runtimes without a global fetch',
    );
  const basePath = parsedBase.pathname.replace(/\/+$/, '');
  const prefix = `${basePath.endsWith('/vsdc/api/v1/taxpayer') ? basePath : `${basePath}/vsdc/api/v1/taxpayer`}/${encodeURIComponent(options.credentials.taxpayerId)}`;

  async function request<T>(
    path: string,
    method: 'GET' | 'POST',
    schema: z.ZodType<T>,
    body?: unknown,
  ): Promise<Result<T>> {
    const url = new URL(parsedBase);
    url.pathname = `${prefix}/${path}`;
    url.hash = '';
    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let response: Response;
      let payload: unknown;
      let malformed = false;
      try {
        const operation = async (): Promise<{
          response: Response;
          payload: unknown;
          malformed: boolean;
        }> => {
          const result = await fetcher(url.toString(), {
            method,
            headers: {
              security_key: options.credentials.securityKey,
              Accept: 'application/json',
              ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
            },
            signal: controller.signal,
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          });
          const raw = await result.text();
          try {
            return { response: result, payload: JSON.parse(raw) as unknown, malformed: false };
          } catch {
            return { response: result, payload: raw, malformed: true };
          }
        };
        const timeout = new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new TimeoutError(timeoutMs));
          }, timeoutMs);
        });
        ({ response, payload, malformed } = await Promise.race([operation(), timeout]));
      } catch (error) {
        if (timer !== undefined) clearTimeout(timer);
        if (error instanceof TimeoutError || controller.signal.aborted)
          return { ok: false, error: new TimeoutError(timeoutMs) };
        if (attempt < retries) {
          await new Promise((resolve) => setTimeout(resolve, retryDelay(attempt, null)));
          continue;
        }
        return { ok: false, error: new NetworkError('Could not reach the GRA service', error) };
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
      if (!response.ok) {
        if ((response.status === 429 || response.status >= 500) && attempt < retries) {
          await new Promise((resolve) =>
            setTimeout(resolve, retryDelay(attempt, response.headers.get('Retry-After'))),
          );
          continue;
        }
        return { ok: false, error: new GraApiError(response.status, errorCode(payload), payload) };
      }
      if (malformed)
        return {
          ok: false,
          error: new GraApiError(
            response.status,
            'MALFORMED_JSON',
            payload,
            'The service returned malformed JSON',
          ),
        };
      const parsed = schema.safeParse(payload);
      if (!parsed.success)
        return {
          ok: false,
          error: new GraApiError(
            response.status,
            'INVALID_RESPONSE',
            payload,
            'The response does not match the documented JSON shape',
          ),
        };
      return { ok: true, data: parsed.data };
    }
    return { ok: false, error: new NetworkError('Retry budget exhausted') };
  }

  async function invoiceOperation(input: unknown, flag: Invoice['flag']) {
    const validated = validateInvoice(input, options.validation);
    if (!validated.ok) return validated;
    if (validated.data.flag !== flag)
      return {
        ok: false as const,
        error: validationFailure('flag', validated.data.flag, flag, `Set flag to ${flag}`),
      };
    return request(ENDPOINTS.invoice, 'POST', GraResponseSchema, validated.data);
  }

  async function schemaOperation<T, R>(
    input: unknown,
    schema: z.ZodType<T>,
    path: string,
    response: z.ZodType<R>,
  ) {
    const validated = validateSchema(schema, input);
    return validated.ok ? request(path, 'POST', response, validated.data) : validated;
  }

  async function cancellationOperation(
    input: unknown,
    flag: 'REFUND_CANCELATION' | 'PURCHASE_RETURN_CANCELATION',
  ) {
    const validated = validateSchema(CancellationSchema, input);
    if (!validated.ok) return validated;
    if (validated.data.flag !== flag)
      return {
        ok: false as const,
        error: validationFailure(
          'flag',
          validated.data.flag,
          flag,
          `Use the exact documented spelling ${flag}`,
        ),
      };
    // ASSUMPTION: Cancellation response shape is undocumented; retain unknown JSON instead of asserting a success envelope.
    return request(ENDPOINTS.cancellation, 'POST', z.unknown(), validated.data);
  }

  const methods = {
    /** Submit a normal invoice.
     * @example
     * ```ts
     * import { createClient, createInvoice, parseMoney } from '@gra-evat/core';
     * const gra = createClient({baseUrl:'http://localhost:8787',credentials:{taxpayerId:'C0000000000-001',securityKey:'mock'}});
     * const invoice = createInvoice({invoiceNumber:'INV-1',transactionDate:'2026-01-01',userName:'Kofi',businessPartnerName:'Cash customer',businessPartnerTin:'C0000000000',calculationType:'EXCLUSIVE',items:[{itemCode:'SKU-1',description:'Notebook',quantity:1,unitPrice:parseMoney('100')}]});
     * await gra.invoice(invoice);
     * ```
     */
    invoice: (input: unknown) => invoiceOperation(input, 'INVOICE'),
    /** Cancel an entire sale with REFUND.
     * @example
     * ```ts
     * import { createClient, createInvoice, parseMoney } from '@gra-evat/core';
     * const gra = createClient({baseUrl:'http://localhost:8787',credentials:{taxpayerId:'C0000000000-001',securityKey:'mock'}});
     * const invoice = createInvoice({invoiceNumber:'INV-1',transactionDate:'2026-01-01',userName:'Kofi',businessPartnerName:'Cash customer',businessPartnerTin:'C0000000000',calculationType:'EXCLUSIVE',items:[{itemCode:'SKU-1',description:'Notebook',quantity:1,unitPrice:parseMoney('100')}]});
     * await gra.refund({...invoice,flag:'REFUND',reference:'REF-1'});
     * ```
     */
    refund: (input: unknown) => invoiceOperation(input, 'REFUND'),
    /** Refund selected quantities with PARTIAL_REFUND.
     * @example
     * ```ts
     * import { createClient, createInvoice, parseMoney } from '@gra-evat/core';
     * const gra = createClient({baseUrl:'http://localhost:8787',credentials:{taxpayerId:'C0000000000-001',securityKey:'mock'}});
     * const invoice = createInvoice({invoiceNumber:'INV-1',transactionDate:'2026-01-01',userName:'Kofi',businessPartnerName:'Cash customer',businessPartnerTin:'C0000000000',calculationType:'EXCLUSIVE',items:[{itemCode:'SKU-1',description:'Notebook',quantity:1,unitPrice:parseMoney('100')}]});
     * await gra.partialRefund({...invoice,flag:'PARTIAL_REFUND',reference:'REF-2'});
     * ```
     */
    partialRefund: (input: unknown) => invoiceOperation(input, 'PARTIAL_REFUND'),
    /** Register a purchase.
     * @example
     * ```ts
     * import { createClient, createInvoice, parseMoney } from '@gra-evat/core';
     * const gra = createClient({baseUrl:'http://localhost:8787',credentials:{taxpayerId:'C0000000000-001',securityKey:'mock'}});
     * const invoice = createInvoice({invoiceNumber:'INV-1',transactionDate:'2026-01-01',userName:'Kofi',businessPartnerName:'Cash customer',businessPartnerTin:'C0000000000',calculationType:'EXCLUSIVE',items:[{itemCode:'SKU-1',description:'Notebook',quantity:1,unitPrice:parseMoney('100')}]});
     * await gra.purchase({...invoice,flag:'PURCHASE'});
     * ```
     */
    purchase: (input: unknown) => invoiceOperation(input, 'PURCHASE'),
    /** Return a previously registered purchase.
     * @example
     * ```ts
     * import { createClient, createInvoice, parseMoney } from '@gra-evat/core';
     * const gra = createClient({baseUrl:'http://localhost:8787',credentials:{taxpayerId:'C0000000000-001',securityKey:'mock'}});
     * const invoice = createInvoice({invoiceNumber:'INV-1',transactionDate:'2026-01-01',userName:'Kofi',businessPartnerName:'Cash customer',businessPartnerTin:'C0000000000',calculationType:'EXCLUSIVE',items:[{itemCode:'SKU-1',description:'Notebook',quantity:1,unitPrice:parseMoney('100')}]});
     * await gra.purchaseReturn({...invoice,flag:'PURCHASE_RETURN',reference:'PR-1'});
     * ```
     */
    purchaseReturn: (input: unknown) => invoiceOperation(input, 'PURCHASE_RETURN'),
    /** Cancel a prior refund using the documented single-L flag.
     * @example
     * ```ts
     * import { createClient } from '@gra-evat/core';
     * const gra = createClient({baseUrl:'http://localhost:8787',credentials:{taxpayerId:'C0000000000-001',securityKey:'mock'}});
     * await gra.cancelRefund({invoiceNumber:'INV-1',reference:'REF-1',userName:'Kofi',flag:'REFUND_CANCELATION',transactionDate:'2026-01-01',totalAmount:'100.00'});
     * ```
     */
    cancelRefund: (input: unknown) => cancellationOperation(input, 'REFUND_CANCELATION'),
    /** Cancel a purchase return.
     * @example
     * ```ts
     * import { createClient } from '@gra-evat/core';
     * const gra = createClient({baseUrl:'http://localhost:8787',credentials:{taxpayerId:'C0000000000-001',securityKey:'mock'}});
     * const cancellation = {invoiceNumber:'INV-1',reference:'REF-1',userName:'Kofi',flag:'REFUND_CANCELATION',transactionDate:'2026-01-01',totalAmount:'100.00'};
     * await gra.cancelPurchaseReturn({...cancellation,flag:'PURCHASE_RETURN_CANCELATION'});
     * ```
     */
    cancelPurchaseReturn: (input: unknown) =>
      cancellationOperation(input, 'PURCHASE_RETURN_CANCELATION'),
    /** Check the authenticated taxpayer endpoint.
     * @example
     * ```ts
     * import { createClient } from '@gra-evat/core';
     * const gra = createClient({baseUrl:'http://localhost:8787',credentials:{taxpayerId:'C0000000000-001',securityKey:'mock'}});
     * await gra.health(); // {ok:true,data:{status:'UP'}}
     * ```
     */
    health: () => request(ENDPOINTS.health, 'GET', HealthSchema),
    /** Register the documented credit note. Its response is unknown JSON.
     * @example
     * ```ts
     * import { createClient } from '@gra-evat/core';
     * const gra = createClient({baseUrl:'http://localhost:8787',credentials:{taxpayerId:'C0000000000-001',securityKey:'mock'}});
     * const creditNote = {noteNumber:'CN-1',currency:'GHS',exchangeRate:1,noteAmount:100,calculationType:'EXCLUSIVE',businessPartnerName:'Cash customer',businessPartnerTin:'C0000000000',userName:'Kofi',flag:'CREDIT_NOTE',groupReferenceId:'',transactionDate:'2026-01-01',remarks:'CN',noteLineFlag:'INVOICE',noteLines:[{invoiceNumber:'INV-1',invoiceDate:'2026-01-01',invoiceAmount:100}]};
     * await gra.note(creditNote);
     * ```
     */
    note: (input: unknown) => schemaOperation(input, NoteSchema, ENDPOINTS.note, z.unknown()),
    /** Submit an account statement to the exact statment_of_account path.
     * @example
     * ```ts
     * import { createClient } from '@gra-evat/core';
     * const gra = createClient({baseUrl:'http://localhost:8787',credentials:{taxpayerId:'C0000000000-001',securityKey:'mock'}});
     * const statement = {currency:'GHS',exchangeRate:1,totalVat:15,totalAmount:100,totalLevies:5,userName:'Kofi',businessPartnerName:'Cash customer',businessPartnerTin:'C0000000000',groupReferenceId:'GROUP-1',transactionDate:'2026-01-01',calculationType:'EXCLUSIVE',groupInvoiceLines:[{currency:'GHS',exchangeRate:1,calculationType:'EXCLUSIVE',invoiceNumber:'INV-1',flag:'INVOICE',invoiceVat:15,invoiceAmount:100,invoiceLevies:5,transactionDate:'2026-01-01'}]};
     * await gra.statementOfAccount(statement);
     * ```
     */
    statementOfAccount: (input: unknown) =>
      schemaOperation(input, StatementOfAccountSchema, ENDPOINTS.statementOfAccount, z.unknown()),
    /** Query TIN identity. Path is present in response.originalRequest of TinDetails.
     * @example
     * ```ts
     * import { createClient } from '@gra-evat/core';
     * const gra = createClient({baseUrl:'http://localhost:8787',credentials:{taxpayerId:'C0000000000-001',securityKey:'mock'}});
     * await gra.lookupTin('C0000000000');
     * ```
     */
    lookupTin: (tin: string) => {
      const pattern = options.validation?.tinPattern ?? DEFAULT_TIN_PATTERN;
      if (!new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, '')).test(tin))
        return Promise.resolve({
          ok: false as const,
          error: validationFailure(
            'tin',
            tin,
            'TIN matching the configured policy',
            'Remove spaces and check the TIN length',
          ),
        });
      return request(`${ENDPOINTS.tin}/${encodeURIComponent(tin)}`, 'GET', IdentificationSchema);
    },
    /** Query a Ghana Card PIN.
     * @example
     * ```ts
     * import { createClient } from '@gra-evat/core';
     * const gra = createClient({baseUrl:'http://localhost:8787',credentials:{taxpayerId:'C0000000000-001',securityKey:'mock'}});
     * await gra.lookupGhanaCard('GHA-123456789-0');
     * ```
     */
    lookupGhanaCard: (nationalId: string) => {
      if (!/^GHA-\d{9}-\d$/.test(nationalId))
        return Promise.resolve({
          ok: false as const,
          error: validationFailure(
            'nationalId',
            nationalId,
            'GHA-123456789-0 format',
            'Use the exact PIN printed on the Ghana Card',
          ),
        });
      return request(
        `${ENDPOINTS.nationalId}/${encodeURIComponent(nationalId)}`,
        'GET',
        IdentificationSchema,
      );
    },
    /** Upload an inventory snapshot.
     * @example
     * ```ts
     * import { createClient } from '@gra-evat/core';
     * const gra = createClient({baseUrl:'http://localhost:8787',credentials:{taxpayerId:'C0000000000-001',securityKey:'mock'}});
     * await gra.inventory({inventoryDate:'2026-01-01',inventories:[{code:'SKU-1',description:'Book',quantity:1,batchCode:'',unitPrice:'100.00',expiryDate:'2027-01-01'}]});
     * ```
     */
    inventory: (input: unknown) =>
      schemaOperation(input, InventorySchema, ENDPOINTS.inventory, InventoryResponseSchema),
    /** Recover a receipt before resending an uncertain invoice submission.
     * @example
     * ```ts
     * import { createClient } from '@gra-evat/core';
     * const gra = createClient({baseUrl:'http://localhost:8787',credentials:{taxpayerId:'C0000000000-001',securityKey:'mock'}});
     * await gra.callback({invoiceNumber:'INV-1',reference:'',flag:'INVOICE'});
     * ```
     */
    callback: (input: unknown) =>
      schemaOperation(input, CallbackSchema, ENDPOINTS.callback, GraResponseSchema),
  };

  const unwrap =
    <Args extends unknown[], T>(method: (...args: Args) => Promise<Result<T, GraError>>) =>
    async (...args: Args): Promise<T> => {
      const result = await method(...args);
      if (!result.ok) throw result.error;
      return result.data;
    };
  return {
    ...methods,
    throwing: {
      invoice: unwrap(methods.invoice),
      refund: unwrap(methods.refund),
      partialRefund: unwrap(methods.partialRefund),
      purchase: unwrap(methods.purchase),
      purchaseReturn: unwrap(methods.purchaseReturn),
      cancelRefund: unwrap(methods.cancelRefund),
      cancelPurchaseReturn: unwrap(methods.cancelPurchaseReturn),
      health: unwrap(methods.health),
      note: unwrap(methods.note),
      statementOfAccount: unwrap(methods.statementOfAccount),
      lookupTin: unwrap(methods.lookupTin),
      lookupGhanaCard: unwrap(methods.lookupGhanaCard),
      inventory: unwrap(methods.inventory),
      callback: unwrap(methods.callback),
    },
  };
}

export type GraClient = ReturnType<typeof createClient>;
