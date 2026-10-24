'use client';

import '../lib/browser-validation';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  calculateInvoice,
  GHANA_2026,
  createClient,
  createInvoice,
  parseMoney,
  validateInvoice,
  type GraResponse,
  type Invoice,
} from '@gra-evat/core';
import { createMockFetch } from '@gra-evat/mock';
import QRCode from 'qrcode';
import {
  buildDraft,
  calculationItems,
  initialDraft,
  money,
  newLine,
  preview,
  proportionalDiscount,
  quantityUnits,
  quantityDecimal,
  sampleLines,
  type Draft,
  type DraftLine,
} from '../lib/draft';
import { ApiReference } from './api-reference';
import { CopyButton } from './copy-button';

type Totals = ReturnType<typeof calculateInvoice>;
type Issued = {
  request: Invoice;
  result: GraResponse;
  totals: Totals;
  businessName: string;
  businessTin: string;
};
type Refund = { request: Invoice; result: GraResponse; cancelled: boolean };
type Mode = 'browser' | 'server';
type Scenario = 'normal' | '500' | '429';
const BASE_URL = process.env.NEXT_PUBLIC_GRA_BASE_URL || 'http://localhost:8787';

function safeError(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'The request failed. Check the JSON details and try again.';
}
function serializeError(error: unknown): string {
  if (error instanceof Error)
    return JSON.stringify({ ...error, name: error.name, message: error.message }, null, 2);
  return JSON.stringify(error, null, 2);
}
function requestUrl(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : String(input);
}
function withScenario(fetcher: typeof fetch, scenario: Scenario): typeof fetch {
  return (input, init) => {
    if (scenario === 'normal') return fetcher(input, init);
    const url = new URL(requestUrl(input));
    url.searchParams.set('fail', scenario);
    return fetcher(input instanceof Request ? new Request(url, input) : url, init);
  };
}
function amount(value: number | string): string {
  return money(parseMoney(String(value)));
}
function remainingUnits(item: Invoice['items'][number], refunds: Refund[]): bigint {
  const returned = refunds
    .filter((refund) => !refund.cancelled)
    .reduce(
      (sum, refund) =>
        sum +
        refund.request.items
          .filter((line) => line.itemCode === item.itemCode)
          .reduce((qty, line) => qty + quantityUnits(String(line.quantity)), 0n),
      0n,
    );
  const available = quantityUnits(String(item.quantity)) - returned;
  return available > 0n ? available : 0n;
}
function remaining(item: Invoice['items'][number], refunds: Refund[]): string {
  return quantityDecimal(remainingUnits(item, refunds));
}
function rate(basisPoints: number): string {
  const whole = Math.floor(basisPoints / 100);
  const fraction = String(basisPoints % 100)
    .padStart(2, '0')
    .replace(/0+$/, '');
  return `${whole}${fraction ? `.${fraction}` : ''}%`;
}

export function Playground() {
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [mode, setMode] = useState<Mode>('browser');
  const [scenario, setScenario] = useState<Scenario>('normal');
  const [mockStatus, setMockStatus] = useState<'checking' | 'up' | 'down'>('checking');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [rawError, setRawError] = useState('');
  const [issued, setIssued] = useState<Issued | null>(null);
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundQuantities, setRefundQuantities] = useState<Record<string, string>>({});
  const [refunds, setRefunds] = useState<Refund[]>([]);
  const [refundStatus, setRefundStatus] = useState('');
  const [qr, setQr] = useState('');
  const [qrError, setQrError] = useState(false);
  const [identityWarning, setIdentityWarning] = useState('');
  const identities = useRef(new Map<string, string>());
  const browserFetch = useMemo(() => createMockFetch(), []);
  const fetcher = useMemo(
    () => (mode === 'browser' ? browserFetch : globalThis.fetch.bind(globalThis)),
    [browserFetch, mode],
  );
  const client = useMemo(
    () =>
      createClient({
        baseUrl: BASE_URL,
        credentials: { securityKey: 'mock', taxpayerId: 'C0000000000-001' },
        fetch: withScenario(fetcher, scenario),
        timeoutMs: 3500,
        retries: 0,
      }),
    [fetcher, scenario],
  );
  const receiptRef = useRef<HTMLElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const refundStatusRef = useRef<HTMLParagraphElement>(null);
  const totalsState = useMemo(() => {
    try {
      return { totals: preview(draft), message: '' };
    } catch (problem) {
      return { totals: null, message: safeError(problem) };
    }
  }, [draft]);
  const totals = totalsState.totals;
  const requestState = useMemo(() => {
    try {
      return { request: buildDraft(draft), message: '' };
    } catch (problem) {
      return { request: null, message: safeError(problem) };
    }
  }, [draft]);
  const requestJson = JSON.stringify(requestState.request, null, 2);
  const responseJson = issued ? JSON.stringify(issued.result, null, 2) : '';
  const snippet = `import { createClient } from '@gra-evat/core';\n\nconst client = createClient({\n  baseUrl: 'http://localhost:8787',\n  credentials: {\n    securityKey: 'mock',\n    taxpayerId: 'C0000000000-001',\n  },\n});\n\nconst invoice = ${issued ? JSON.stringify(issued.request, null, 2) : requestJson};\nconst result = await client.invoice(invoice);\nif (!result.ok) throw result.error;\nconsole.log(result.data.response);`;

  useEffect(() => {
    let active = true;
    setMockStatus('checking');
    const healthClient = createClient({
      baseUrl: BASE_URL,
      credentials: { securityKey: 'mock', taxpayerId: 'C0000000000-001' },
      fetch: fetcher,
      timeoutMs: 2000,
      retries: 0,
    });
    void healthClient
      .health()
      .then((result) => {
        if (active) setMockStatus(result.ok ? 'up' : 'down');
      })
      .catch(() => {
        if (active) setMockStatus('down');
      });
    return () => {
      active = false;
    };
  }, [fetcher]);

  useEffect(() => {
    let active = true;
    setQrError(false);
    if (issued?.result.response.qr_code) {
      void QRCode.toDataURL(issued.result.response.qr_code, {
        width: 192,
        margin: 2,
        color: { dark: '#111111', light: '#FAFAF9' },
      })
        .then((data) => {
          if (active) setQr(data);
        })
        .catch(() => {
          if (active) {
            setQr('');
            setQrError(true);
          }
        });
    } else setQr('');
    return () => {
      active = false;
    };
  }, [issued]);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  function field<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setError('');
  }
  function lineField(id: string, key: keyof DraftLine, value: string | boolean) {
    setDraft((current) => ({
      ...current,
      items: current.items.map((line) => (line.id === id ? { ...line, [key]: value } : line)),
    }));
    setError('');
  }
  function moveLine(index: number, direction: -1 | 1) {
    setDraft((current) => {
      const items = [...current.items];
      const selected = items[index];
      const neighbor = items[index + direction];
      if (!selected || !neighbor) return current;
      items[index] = neighbor;
      items[index + direction] = selected;
      return { ...current, items };
    });
  }
  function report(problem: unknown) {
    setError(safeError(problem));
    setRawError(serializeError(problem));
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError('');
    setRawError('');
    setIdentityWarning('');
    if (!draft.items.length) {
      report(new Error('Add at least one line item, or load the sample invoice.'));
      return;
    }
    if (!draft.businessName.trim()) {
      report(new Error('Business name: enter the name to show on the mock receipt.'));
      return;
    }
    if (!/^[A-Z]\d{10}$/.test(draft.businessTin)) {
      report(
        new Error('Business TIN: use one uppercase letter followed by 10 digits, without spaces.'),
      );
      return;
    }
    if (!/^\d{3}$/.test(draft.branch)) {
      report(new Error('Branch: enter a three-digit branch code, for example 001.'));
      return;
    }
    let request: Invoice;
    let calculated: Totals;
    try {
      request = buildDraft(draft);
      const validated = validateInvoice(request);
      if (!validated.ok) {
        report(validated.error);
        return;
      }
      calculated = calculateInvoice(calculationItems(draft.items), draft.calculationType);
    } catch (problem) {
      report(problem);
      return;
    }
    const oldName = identities.current.get(draft.businessTin);
    if (oldName && oldName !== draft.businessName.trim())
      setIdentityWarning(
        `This TIN was previously used as “${oldName}”. Check the business identity before connecting a real system.`,
      );
    identities.current.set(draft.businessTin, draft.businessName.trim());
    setPending(true);
    try {
      const result = await client.invoice(request);
      if (!result.ok) {
        report(result.error);
        return;
      }
      setIssued({
        request,
        result: result.data,
        totals: calculated,
        businessName: draft.businessName,
        businessTin: draft.businessTin,
      });
      setRefunds([]);
      setRefundStatus('');
      setRefundOpen(false);
      setTimeout(() => receiptRef.current?.focus(), 50);
    } catch (problem) {
      report(problem);
    } finally {
      setPending(false);
    }
  }
  async function submitRefund() {
    if (!issued || pending) return;
    setError('');
    setRefundStatus('');
    let request: Invoice;
    try {
      for (const item of issued.request.items) {
        const selected = refundQuantities[item.itemCode];
        if (selected?.startsWith('-'))
          throw new Error(`${item.itemCode}: refund quantity cannot be negative.`);
      }
      const items = issued.request.items
        .filter((item) => quantityUnits(refundQuantities[item.itemCode] || '0') > 0n)
        .map((item) => {
          const quantity = refundQuantities[item.itemCode] || '0';
          if (quantityUnits(quantity) > remainingUnits(item, refunds))
            throw new Error(
              `${item.itemCode}: refund quantity exceeds the remaining sold quantity.`,
            );
          return {
            itemCode: item.itemCode,
            description: item.description,
            quantity,
            unitPrice: parseMoney(String(item.unitPrice)),
            itemCategory: item.itemCategory === 'EXM' ? ('EXM' as const) : ('' as const),
            discountAmount: proportionalDiscount(
              parseMoney(String(item.discountAmount ?? 0)),
              quantity,
              String(item.quantity),
            ),
          };
        });
      if (!items.length)
        throw new Error('Choose a quantity greater than zero for at least one refund item.');
      request = createInvoice({
        invoiceNumber: issued.request.invoiceNumber,
        transactionDate: new Date().toISOString().slice(0, 10),
        userName: issued.request.userName,
        businessPartnerName: issued.request.businessPartnerName,
        businessPartnerTin: issued.request.businessPartnerTin,
        calculationType: issued.request.calculationType,
        items,
        flag: 'PARTIAL_REFUND',
        reference: `RF-${crypto.randomUUID().slice(0, 12)}`,
      });
    } catch (problem) {
      report(problem);
      return;
    }
    setPending(true);
    try {
      const result = await client.partialRefund(request);
      if (!result.ok) {
        report(result.error);
        return;
      }
      setRefunds((current) => [...current, { request, result: result.data, cancelled: false }]);
      setRefundQuantities({});
      setRefundStatus(
        `Refund ${request.reference} issued. Remaining quantities have been updated.`,
      );
      setTimeout(() => refundStatusRef.current?.focus(), 50);
    } catch (problem) {
      report(problem);
    } finally {
      setPending(false);
    }
  }
  async function cancelRefund(refund: Refund) {
    if (!issued || pending) return;
    setPending(true);
    setError('');
    try {
      const result = await client.cancelRefund({
        invoiceNumber: issued.request.invoiceNumber,
        reference: refund.request.reference || '',
        userName: issued.request.userName,
        flag: 'REFUND_CANCELATION',
        transactionDate: new Date().toISOString().slice(0, 10),
        totalAmount: refund.request.totalAmount,
      });
      if (!result.ok) {
        report(result.error);
        return;
      }
      setRefunds((current) =>
        current.map((entry) => (entry === refund ? { ...entry, cancelled: true } : entry)),
      );
      setRefundStatus(
        `Refund ${refund.request.reference} cancelled. Its quantities are available again.`,
      );
      setTimeout(() => refundStatusRef.current?.focus(), 50);
    } catch (problem) {
      report(problem);
    } finally {
      setPending(false);
    }
  }
  const describedBy = error ? 'builder-help builder-error' : 'builder-help';
  return (
    <>
      <a className="skip-link" href="#quickstart">
        Skip to content
      </a>
      <aside className="manual-nav">
        <a href="#quickstart" className="wordmark" aria-label="gra-evat home">
          gra-evat
        </a>
        <p className="muted">Developer manual</p>
        <nav aria-label="Main navigation">
          <a href="#quickstart">Quickstart</a>
          <a href="#builder">Invoice builder</a>
          <a href="#receipt">Receipt and refunds</a>
          <a href="#api-reference">API reference</a>
          <a href="#integration">SDK integration</a>
        </nav>
        <div className="nav-footer">
          <p>
            API v8.2
            <br />
            Tax rules effective 1 January 2026
          </p>
          <a
            href="https://documenter.getpostman.com/view/29809098/2sBXVeGCzK"
            target="_blank"
            rel="noreferrer"
          >
            Official GRA API documentation<span className="sr-only"> (opens in a new tab)</span>
          </a>
        </div>
      </aside>
      <main className="manual-main">
        <div className="manual-content">
          <section id="quickstart" className="manual-section" aria-labelledby="quickstart-title">
            <h1 id="quickstart-title">gra-evat</h1>
            <p>
              TypeScript SDK, local mock server, and browser playground for the Ghana E-VAT API.
            </p>
            <h2>Quickstart</h2>
            <p>
              Use Node 20.19 or later and pnpm 9. From a checkout, install dependencies and start
              both services.
            </p>
            <CodeBlock
              title="Terminal"
              label="Quickstart commands"
              value={'pnpm install\npnpm dev'}
              copyLabel="Copy commands"
            />
            <p>
              The playground runs at <code>http://localhost:3000</code>. The mock runs at{' '}
              <code>http://localhost:8787</code>.
            </p>
            <p>
              <a href="#builder">Load a sample invoice</a>, inspect its taxes, and submit it to the
              mock. The hosted playground works in your browser without a server.
            </p>
            <section className="environment" aria-label="Mock environment">
              <div role="status">
                <strong>
                  {mockStatus === 'checking'
                    ? 'Checking mock connection'
                    : mockStatus === 'down'
                      ? 'Local mock is unreachable'
                      : mode === 'browser'
                        ? 'In-browser mock is ready'
                        : 'Local mock is connected'}
                </strong>
                <p>
                  {mode === 'browser'
                    ? 'Requests run locally in this browser. No credentials are needed.'
                    : mockStatus === 'down'
                      ? 'Start it with: pnpm --filter @gra-evat/mock start'
                      : BASE_URL}
                </p>
              </div>
              <label>
                Mock connection
                <select
                  aria-label="Mock connection"
                  value={mode}
                  disabled={pending}
                  onChange={(event) => {
                    setMode(event.target.value as Mode);
                    setIssued(null);
                    setRefunds([]);
                    setError('');
                  }}
                >
                  <option value="browser">In-browser mock</option>
                  <option value="server">Local server</option>
                </select>
              </label>
              <p className="muted">
                All signatures and receipts produced here are fake. No real tax invoice is issued.
              </p>
            </section>
          </section>

          <section id="builder" className="manual-section" aria-labelledby="builder-title">
            <div className="section-heading">
              <h2 id="builder-title">Invoice builder</h2>
              <button
                type="button"
                className="button"
                disabled={pending}
                onClick={() => {
                  setDraft((current) => ({
                    ...current,
                    invoiceNumber: `INV-${new Date().getUTCFullYear()}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
                    items: sampleLines(),
                  }));
                  setError('');
                }}
              >
                Load sample invoice
              </button>
            </div>
            <p id="builder-help">
              Enter amounts in Ghana cedis. Dates use Africa/Accra, UTC+0. The calculator applies
              the rules effective 1 January 2026.
            </p>
            <form noValidate onSubmit={(event) => void submit(event)} aria-busy={pending}>
              <fieldset className="form-group" disabled={pending}>
                <legend>Business details</legend>
                <div className="field-grid halves">
                  <label className="full-width">
                    Business name
                    <input
                      value={draft.businessName}
                      onChange={(event) => field('businessName', event.target.value)}
                      aria-describedby={describedBy}
                      maxLength={100}
                      autoComplete="organization"
                      required
                    />
                  </label>
                  <label>
                    Business TIN
                    <input
                      value={draft.businessTin}
                      onChange={(event) => field('businessTin', event.target.value)}
                      aria-describedby={describedBy}
                      maxLength={15}
                      spellCheck={false}
                      className="mono"
                      required
                    />
                  </label>
                  <label>
                    Branch
                    <input
                      value={draft.branch}
                      onChange={(event) => field('branch', event.target.value)}
                      aria-describedby={describedBy}
                      className="mono"
                      inputMode="numeric"
                      maxLength={3}
                      required
                    />
                  </label>
                </div>
                <p className="field-note">
                  Business name, TIN, and branch appear on this mock receipt only. GRA identifies
                  the issuer through its credentials.
                </p>
                <div className="field-grid halves">
                  <label>
                    Invoice number
                    <input
                      value={draft.invoiceNumber}
                      onChange={(event) => field('invoiceNumber', event.target.value)}
                      aria-describedby={describedBy}
                      maxLength={100}
                      className="mono"
                      required
                    />
                  </label>
                  <label>
                    Transaction date
                    <input
                      type="date"
                      value={draft.transactionDate}
                      onChange={(event) => field('transactionDate', event.target.value)}
                      aria-describedby={describedBy}
                      required
                    />
                  </label>
                  <label className="full-width">
                    Operator name
                    <input
                      value={draft.userName}
                      onChange={(event) => field('userName', event.target.value)}
                      aria-describedby={describedBy}
                      maxLength={100}
                      required
                    />
                  </label>
                </div>
              </fieldset>
              <fieldset className="form-group" disabled={pending}>
                <legend>Customer</legend>
                <div className="field-grid halves">
                  <label>
                    Customer name
                    <input
                      value={draft.customerName}
                      onChange={(event) => field('customerName', event.target.value)}
                      aria-describedby={describedBy}
                      maxLength={100}
                      placeholder="Cash customer"
                      autoComplete="name"
                    />
                  </label>
                  <label>
                    Customer TIN
                    <input
                      value={draft.customerTin}
                      onChange={(event) => field('customerTin', event.target.value)}
                      aria-describedby={describedBy}
                      maxLength={15}
                      placeholder="C0000000000"
                      spellCheck={false}
                      className="mono"
                    />
                  </label>
                </div>
                <p className="field-note">
                  For a cash sale, blank fields use “Cash customer” and the documented cash customer
                  TIN, C0000000000.
                </p>
              </fieldset>
              <fieldset className="form-group" disabled={pending}>
                <legend>Line items</legend>
                {!draft.items.length ? (
                  <div className="empty-state">
                    <p>No line items.</p>
                    <p className="muted">
                      Add an item or load the sample invoice to calculate taxes.
                    </p>
                    <button
                      type="button"
                      className="button"
                      onClick={() => field('items', [newLine(1)])}
                    >
                      Add first item
                    </button>
                  </div>
                ) : (
                  <div className="line-items">
                    {draft.items.map((item, index) => (
                      <div className="line-item" key={item.id}>
                        <div className="line-item-heading">
                          <h3>Item {index + 1}</h3>
                          <div className="button-row">
                            <button
                              type="button"
                              className="button button-small"
                              aria-label={`Move item ${index + 1} up`}
                              disabled={index === 0}
                              onClick={() => moveLine(index, -1)}
                            >
                              Move up
                            </button>
                            <button
                              type="button"
                              className="button button-small"
                              aria-label={`Move item ${index + 1} down`}
                              disabled={index === draft.items.length - 1}
                              onClick={() => moveLine(index, 1)}
                            >
                              Move down
                            </button>
                            <button
                              type="button"
                              className="button button-small"
                              aria-label={`Remove item ${index + 1}`}
                              onClick={() =>
                                field(
                                  'items',
                                  draft.items.filter((line) => line.id !== item.id),
                                )
                              }
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                        <div className="field-grid halves">
                          <label>
                            Item code
                            <input
                              value={item.code}
                              onChange={(event) => lineField(item.id, 'code', event.target.value)}
                              aria-label={`Item ${index + 1} code`}
                              aria-describedby={describedBy}
                              maxLength={50}
                              spellCheck={false}
                              className="mono"
                              required
                            />
                          </label>
                          <label>
                            Description
                            <input
                              value={item.description}
                              onChange={(event) =>
                                lineField(item.id, 'description', event.target.value)
                              }
                              aria-label={`Item ${index + 1} description`}
                              aria-describedby={describedBy}
                              placeholder="Item description"
                              maxLength={100}
                              required
                            />
                          </label>
                        </div>
                        <div className="field-grid thirds">
                          <label>
                            Quantity
                            <input
                              value={item.quantity}
                              onChange={(event) =>
                                lineField(item.id, 'quantity', event.target.value)
                              }
                              aria-label={`Item ${index + 1} quantity`}
                              aria-describedby={describedBy}
                              inputMode="decimal"
                              required
                            />
                          </label>
                          <label>
                            Unit price, GHS
                            <input
                              value={item.price}
                              onChange={(event) => lineField(item.id, 'price', event.target.value)}
                              aria-label={`Item ${index + 1} unit price`}
                              aria-describedby={describedBy}
                              placeholder="0.00"
                              inputMode="decimal"
                              required
                            />
                          </label>
                          <label>
                            Discount, GHS
                            <input
                              value={item.discount}
                              onChange={(event) =>
                                lineField(item.id, 'discount', event.target.value)
                              }
                              aria-label={`Item ${index + 1} discount`}
                              aria-describedby={describedBy}
                              inputMode="decimal"
                            />
                          </label>
                        </div>
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={item.exempt}
                            onChange={(event) => lineField(item.id, 'exempt', event.target.checked)}
                          />
                          Exempt or zero rated (EXM)
                        </label>
                        <p className="line-total">
                          Line total including tax{' '}
                          <strong>{money(totals?.lines[index]?.total ?? 0)}</strong>
                        </p>
                      </div>
                    ))}
                  </div>
                )}
                {draft.items.length > 0 && (
                  <button
                    type="button"
                    className="button"
                    disabled={draft.items.length >= 1000}
                    onClick={() =>
                      field('items', [...draft.items, newLine(draft.items.length + 1, draft.items)])
                    }
                  >
                    Add line item
                  </button>
                )}
                <div className="pricing-row">
                  <p>Unit prices are</p>
                  <div className="button-row" role="group" aria-label="Price calculation type">
                    <button
                      type="button"
                      className="button"
                      aria-pressed={draft.calculationType === 'EXCLUSIVE'}
                      onClick={() => field('calculationType', 'EXCLUSIVE')}
                    >
                      Exclusive
                    </button>
                    <button
                      type="button"
                      className="button"
                      aria-pressed={draft.calculationType === 'INCLUSIVE'}
                      onClick={() => field('calculationType', 'INCLUSIVE')}
                    >
                      Inclusive
                    </button>
                  </div>
                </div>
              </fieldset>
              <section className="calculation-section" aria-label="Live invoice breakdown">
                <h3>Tax calculation</h3>
                <Breakdown totals={totals} />
                <p className="total-preview">
                  Invoice total <strong>{money(totals?.total ?? 0)}</strong>
                </p>
                <p className="field-note">
                  VAT ({rate(GHANA_2026.vatBps)}), NHIL ({rate(GHANA_2026.nhilBps)}), and GETFund (
                  {rate(GHANA_2026.getfundBps)}) use the same taxable base. Amounts round per line
                  to the nearest pesewa.
                </p>
                {totalsState.message && draft.items.length > 0 && (
                  <p className="validation-message" role="status">
                    Complete the item values to calculate totals. {totalsState.message}
                  </p>
                )}
              </section>
              <div className="submit-section">
                <label>
                  Mock response
                  <select
                    aria-label="Mock response scenario"
                    value={scenario}
                    onChange={(event) => setScenario(event.target.value as Scenario)}
                    disabled={pending}
                  >
                    <option value="normal">Normal response</option>
                    <option value="500">Simulate server error (500)</option>
                    <option value="429">Simulate rate limit (429)</option>
                  </select>
                </label>
                <button
                  type="submit"
                  className="button button-primary"
                  disabled={pending || mockStatus === 'down'}
                >
                  {pending ? 'Submitting to mock…' : 'Issue mock invoice'}
                </button>
                <p className="field-note">
                  The mock stores invoices in memory. Reloading the browser clears browser mode
                  data.
                </p>
              </div>
            </form>
            {error && (
              <div
                id="builder-error"
                className="error-message"
                role="alert"
                tabIndex={-1}
                ref={errorRef}
              >
                <h3>Request failed</h3>
                <p>{error}</p>
                {rawError && (
                  <details>
                    <summary>Raw error response</summary>
                    <pre tabIndex={0} aria-label="Raw error response code">
                      {rawError}
                    </pre>
                  </details>
                )}
              </div>
            )}
            {identityWarning && (
              <p className="validation-message" role="status">
                {identityWarning}
              </p>
            )}
            <details className="draft-json">
              <summary>Inspect draft JSON</summary>
              <CodeBlock
                title="Draft request"
                label="Draft request JSON code"
                value={requestState.request ? requestJson : ''}
                empty={
                  draft.items.length
                    ? requestState.message
                    : 'Add a line item or load the sample invoice.'
                }
              />
            </details>
          </section>

          <section
            id="receipt"
            className="manual-section receipt-section"
            aria-labelledby="receipt-title"
            tabIndex={-1}
            ref={receiptRef}
          >
            <h2 id="receipt-title">Receipt and refunds</h2>
            {!issued ? (
              <div className="empty-state">
                <p>No receipt yet.</p>
                <p className="muted">
                  Submit an invoice from the <a href="#builder">invoice builder</a>. The mock
                  response, receipt, and refund controls will appear here.
                </p>
              </div>
            ) : (
              <>
                <p className="receipt-status" role="status">
                  Invoice accepted by the mock.
                </p>
                <div className="button-row receipt-actions">
                  <button type="button" className="button" onClick={() => window.print()}>
                    Print receipt
                  </button>
                  <button
                    type="button"
                    className="button"
                    disabled={pending}
                    onClick={() => setRefundOpen((current) => !current)}
                  >
                    {refundOpen ? 'Close refund form' : 'Refund this invoice'}
                  </button>
                </div>
                <article className="receipt-paper" aria-label="Mock invoice receipt">
                  <h3>Mock receipt</h3>
                  <p>This receipt has no tax validity.</p>
                  <div className="receipt-business">
                    <h4>{issued.businessName}</h4>
                    <p>TIN {issued.businessTin}</p>
                    <p>
                      {issued.request.invoiceNumber}
                      <br />
                      {issued.request.transactionDate}
                    </p>
                  </div>
                  <dl className="receipt-meta">
                    <dt>Customer</dt>
                    <dd>{issued.request.businessPartnerName}</dd>
                    <dt>Receipt number</dt>
                    <dd>{issued.result.response.message.ysdcrecnum}</dd>
                    <dt>SDC ID</dt>
                    <dd>{issued.result.response.message.ysdcid}</dd>
                    <dt>Stamped at</dt>
                    <dd>{issued.result.response.message.ysdctime} UTC</dd>
                  </dl>
                  <div className="table-scroll" tabIndex={0} aria-label="Receipt items table">
                    <table className="receipt-items">
                      <caption>Items</caption>
                      <thead>
                        <tr>
                          <th scope="col">Description</th>
                          <th scope="col">Quantity</th>
                          <th scope="col">Unit price</th>
                        </tr>
                      </thead>
                      <tbody>
                        {issued.request.items.map((item) => (
                          <tr key={item.itemCode}>
                            <td>{item.description}</td>
                            <td>{String(item.quantity)}</td>
                            <td>{amount(item.unitPrice)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Breakdown totals={issued.totals} />
                  <p className="receipt-grand-total">
                    Total <strong>{money(issued.totals.total)}</strong>
                  </p>
                  <div className="receipt-qr">
                    {qr ? (
                      <img
                        src={qr}
                        alt="QR code encoding this mock receipt payload. This is a fake receipt, not valid for tax verification."
                        width={128}
                        height={128}
                      />
                    ) : (
                      <p role="status">
                        {qrError
                          ? 'The mock QR code could not be generated.'
                          : 'Preparing mock QR code…'}
                      </p>
                    )}
                    <div>
                      <h4>Fake signature</h4>
                      <p className="mono">{issued.result.response.message.ysdcregsig}</p>
                      <p className="muted">For integration testing only.</p>
                    </div>
                  </div>
                  <details className="signature-details">
                    <summary>Signature details</summary>
                    <dl className="receipt-meta">
                      <dt>Internal data</dt>
                      <dd>{issued.result.response.message.ysdcintdata}</dd>
                      <dt>Machine registration</dt>
                      <dd>{issued.result.response.message.ysdcmrc}</dd>
                      <dt>Status</dt>
                      <dd>{issued.result.response.status}</dd>
                    </dl>
                  </details>
                </article>
                {refundOpen && (
                  <section
                    className="refund-section"
                    aria-labelledby="refund-title"
                    aria-busy={pending}
                  >
                    <h3 id="refund-title">Refund quantities</h3>
                    <p>Return only the quantities still available on this invoice.</p>
                    <div className="refund-items">
                      {issued.request.items.map((item, index) => (
                        <div className="refund-item" key={item.itemCode}>
                          <div>
                            <strong>{item.description}</strong>
                            <p className="muted">
                              {remaining(item, refunds)} of {String(item.quantity)} available ·{' '}
                              {item.itemCode}
                            </p>
                          </div>
                          <label>
                            Refund quantity
                            <input
                              aria-label={`Refund item ${index + 1} quantity`}
                              type="number"
                              min="0"
                              max={remaining(item, refunds)}
                              step="any"
                              value={refundQuantities[item.itemCode] || ''}
                              onChange={(event) =>
                                setRefundQuantities((current) => ({
                                  ...current,
                                  [item.itemCode]: event.target.value,
                                }))
                              }
                              disabled={pending}
                              placeholder="0"
                              aria-describedby={error ? 'refund-help builder-error' : 'refund-help'}
                            />
                          </label>
                        </div>
                      ))}
                    </div>
                    <p id="refund-help" className="field-note">
                      Each refund references the original invoice and uses a unique refund
                      reference.
                    </p>
                    <button
                      type="button"
                      className="button button-primary"
                      onClick={() => void submitRefund()}
                      disabled={pending}
                    >
                      {pending ? 'Processing refund…' : 'Issue partial refund'}
                    </button>
                    <p className="refund-status" role="status" tabIndex={-1} ref={refundStatusRef}>
                      {refundStatus}
                    </p>
                    {refunds.length > 0 && (
                      <section className="refund-history" aria-label="Refund history">
                        <h4>Refund history</h4>
                        {refunds.map((refund) => (
                          <div className="refund-history-item" key={refund.request.reference}>
                            <div>
                              <strong className="mono">{refund.request.reference}</strong>
                              <p>
                                {refund.cancelled
                                  ? 'Cancelled. Quantities restored.'
                                  : `${refund.request.items.map((item) => `${item.quantity} × ${item.itemCode}`).join(', ')} returned.`}
                              </p>
                            </div>
                            {!refund.cancelled && (
                              <button
                                type="button"
                                className="button button-small"
                                disabled={pending}
                                onClick={() => void cancelRefund(refund)}
                              >
                                Cancel refund
                              </button>
                            )}
                          </div>
                        ))}
                      </section>
                    )}
                  </section>
                )}
                <h3 className="response-heading">Invoice exchange</h3>
                <p className="muted">
                  These are the exact request and response from the submitted invoice. Editing the
                  draft does not change this record.
                </p>
                <div className="request-response">
                  <CodeBlock
                    title="REQUEST"
                    label="Sent invoice request JSON code"
                    value={JSON.stringify(issued.request, null, 2)}
                  />
                  <CodeBlock
                    title="RESPONSE"
                    label="Invoice response JSON code"
                    value={responseJson}
                  />
                </div>
              </>
            )}
          </section>

          <ApiReference />

          <section id="integration" className="manual-section" aria-labelledby="integration-title">
            <h2 id="integration-title">SDK integration</h2>
            <p>
              The SDK call below sends the submitted invoice, or the current draft if no invoice has
              been submitted. Start the local mock before running it.
            </p>
            <CodeBlock
              title="TypeScript"
              label="SDK snippet code"
              value={issued || requestState.request ? snippet : ''}
              empty="Build an invoice or load the sample to generate an SDK call."
              copyLabel="Copy SDK snippet"
            />
            <p>
              Keep real GRA credentials on your server and load them from environment variables.
              Change the base URL and credentials when GRA grants access. Review the documented
              assumptions before using a live endpoint.
            </p>
            <p>
              <a
                href="https://gra.gov.gh/domestic-tax/tax-types/vat/"
                target="_blank"
                rel="noreferrer"
              >
                Official GRA VAT guidance<span className="sr-only"> (opens in a new tab)</span>
              </a>
            </p>
          </section>
          <footer className="manual-footer">
            <p>
              Independent open source software. Not affiliated with GRA. Not tax advice. Verify
              against official GRA documentation.
            </p>
            <a href="#quickstart">Back to quickstart</a>
          </footer>
        </div>
      </main>
    </>
  );
}

function CodeBlock({
  title,
  label,
  value,
  empty = 'No data yet.',
  copyLabel = 'Copy JSON',
}: {
  title: string;
  label: string;
  value: string;
  empty?: string;
  copyLabel?: string;
}) {
  return (
    <div className="code-block">
      <div className="code-header">
        <span>{title}</span>
        {value && <CopyButton value={value} label={copyLabel} />}
      </div>
      <div className="code-body">
        {value ? (
          <pre tabIndex={0} aria-label={label}>
            {value}
          </pre>
        ) : (
          <p className="muted">{empty}</p>
        )}
      </div>
    </div>
  );
}

function Breakdown({ totals }: { totals: Totals | null }) {
  return (
    <div className="table-scroll" tabIndex={0} aria-label="Tax breakdown table">
      <table className="breakdown-table">
        <caption className="sr-only">Invoice levy and VAT breakdown in Ghana cedis</caption>
        <tbody>
          <tr>
            <th scope="row">Net subtotal</th>
            <td>{money(totals?.subtotal ?? 0)}</td>
          </tr>
          <tr>
            <th scope="row">Discounts included in subtotal</th>
            <td>{money(totals?.discountAmount ?? 0)}</td>
          </tr>
          <tr>
            <th scope="row">NHIL ({rate(GHANA_2026.nhilBps)})</th>
            <td>{money(totals?.nhil ?? 0)}</td>
          </tr>
          <tr>
            <th scope="row">GETFund ({rate(GHANA_2026.getfundBps)})</th>
            <td>{money(totals?.getfund ?? 0)}</td>
          </tr>
          <tr>
            <th scope="row">VAT ({rate(GHANA_2026.vatBps)})</th>
            <td>{money(totals?.vat ?? 0)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
