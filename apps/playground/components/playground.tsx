'use client';

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
import { Icon } from './icon';
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
  const [dataTab, setDataTab] = useState<'request' | 'response' | 'sdk'>('request');
  const [qr, setQr] = useState('');
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
    if (issued?.result.response.qr_code) {
      void QRCode.toDataURL(issued.result.response.qr_code, {
        width: 192,
        margin: 2,
        color: { dark: '#102f24', light: '#ffffff' },
      })
        .then((data) => {
          if (active) setQr(data);
        })
        .catch(() => {
          if (active) setQr('');
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
      setDataTab('response');
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
  const selectedCode =
    dataTab === 'request' ? requestJson : dataTab === 'response' ? responseJson : snippet;

  return (
    <>
      <a className="skip-link" href="#builder">
        Skip to invoice builder
      </a>
      <header className="site-header">
        <div className="shell header-inner">
          <a className="wordmark" href="#" aria-label="gra-evat home">
            <span className="brand-mark" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
            </span>
            gra<span className="wordmark-divider">/</span>evat
            <span className="open-source-tag">OPEN SOURCE</span>
          </a>
          <nav aria-label="Main navigation">
            <a href="#builder" className="nav-active">
              Playground
            </a>
            <a href="#integration">Integration</a>
            <a
              href="https://documenter.getpostman.com/view/29809098/2sBXVeGCzK"
              target="_blank"
              rel="noreferrer"
            >
              GRA API docs <Icon name="external" size={13} />
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </nav>
          <span className="api-version">
            API v8.2 <span>·</span> 2026 rules
          </span>
        </div>
      </header>
      <main className="shell">
        <section className="hero" aria-labelledby="hero-title">
          <div>
            <div className="eyebrow">
              <span className="tiny-star" aria-hidden="true">
                ✳
              </span>{' '}
              THE INVOICE LAB <span className="eyebrow-line" />
            </div>
            <h1 id="hero-title">
              Your first E-VAT invoice.
              <br />
              <span>Without the wait.</span>
            </h1>
            <p>
              Build an invoice. See every levy. Get a mock receipt.
              <br className="desktop-break" /> A small, open toolkit for developers building in
              Ghana.
            </p>
          </div>
          <aside className="hero-note">
            <div className="ghana-stripe" aria-hidden="true">
              <i />
              <i />
              <i />
            </div>
            <span className="mono micro">MADE FOR THE BUILD</span>
            <p>
              From your first line item
              <br />
              to your first integration.
            </p>
            <span className="hero-note-bottom">Typed SDK. Local mock. One playground.</span>
          </aside>
        </section>
        <section
          className={`environment ${mockStatus === 'down' ? 'environment-down' : ''}`}
          aria-label="Mock environment"
        >
          <div className="environment-description">
            <span className={`status-light ${mockStatus}`} aria-hidden="true" />
            <div>
              <strong>
                {mockStatus === 'checking'
                  ? 'Checking mock'
                  : mockStatus === 'down'
                    ? 'Local mock is unreachable'
                    : mode === 'browser'
                      ? 'In-browser mock is ready'
                      : 'Local mock is connected'}
              </strong>
              <p>
                {mode === 'browser'
                  ? 'Runs entirely in this browser. No sandbox credentials needed.'
                  : mockStatus === 'down'
                    ? 'Start it with: pnpm --filter @gra-evat/mock start'
                    : BASE_URL}
              </p>
            </div>
          </div>
          <label className="mode-select">
            <span className="sr-only">Mock connection</span>
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
          <span className="mock-label">MOCK ONLY</span>
        </section>
        <div className="workspace-grid">
          <form
            id="builder"
            noValidate
            onSubmit={(event) => void submit(event)}
            className="builder-column"
            aria-busy={pending}
          >
            <div className="section-heading">
              <div>
                <span className="step-label">01 / COMPOSE</span>
                <h2>Invoice builder</h2>
              </div>
              <button
                type="button"
                className="button button-quiet"
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
                Load sample invoice <Icon name="arrow" size={16} />
              </button>
            </div>
            <p id="builder-help" className="form-description">
              Amounts are in Ghana cedis. Taxes use the rules effective 1 January 2026.
            </p>
            <fieldset className="card form-card" disabled={pending}>
              <legend className="sr-only">Business and invoice details</legend>
              <div className="card-title">
                <h3>Business details</h3>
                <span className="muted-small">Your mock receipt identity</span>
              </div>
              <div className="field-grid business-grid">
                <label>
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
              <div className="field-grid thirds">
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
                <label>
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
              <p className="field-note">
                Business identity stays in the receipt view. The API identifies the issuer through
                its credentials.
              </p>
              <div className="card-divider" />
              <div className="card-title">
                <h3>Customer</h3>
                <span className="muted-small">Optional for a cash sale</span>
              </div>
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
                A blank customer uses the documented cash customer TIN, C0000000000.
              </p>
            </fieldset>
            <fieldset className="card items-card" disabled={pending}>
              <legend className="sr-only">Line items and pricing</legend>
              <div className="card-title">
                <h3>
                  Line items{' '}
                  <span className="count-badge">
                    {draft.items.length.toString().padStart(2, '0')}
                  </span>
                </h3>
                <span className="currency-badge">GHS</span>
              </div>
              {!draft.items.length ? (
                <div className="empty-items">
                  <span className="empty-icon" aria-hidden="true">
                    <Icon name="plus" size={26} />
                  </span>
                  <h4>A good invoice starts with one item.</h4>
                  <p>
                    Add what you sold, or load our sample to see
                    <br className="desktop-break" /> the complete flow in a few clicks.
                  </p>
                  <button
                    type="button"
                    className="button button-outlined"
                    onClick={() => field('items', [newLine(1)])}
                  >
                    <Icon name="plus" size={16} />
                    Add first item
                  </button>
                </div>
              ) : (
                <div className="line-items">
                  {draft.items.map((item, index) => (
                    <div className="line-item" key={item.id}>
                      <div className="line-item-top">
                        <span className="line-number">
                          ITEM {String(index + 1).padStart(2, '0')}
                        </span>
                        <div className="line-actions">
                          <button
                            type="button"
                            className="icon-button"
                            aria-label={`Move item ${index + 1} up`}
                            disabled={index === 0}
                            onClick={() => moveLine(index, -1)}
                          >
                            <Icon name="up" size={15} />
                          </button>
                          <button
                            type="button"
                            className="icon-button"
                            aria-label={`Move item ${index + 1} down`}
                            disabled={index === draft.items.length - 1}
                            onClick={() => moveLine(index, 1)}
                          >
                            <Icon name="down" size={15} />
                          </button>
                          <button
                            type="button"
                            className="icon-button delete-button"
                            aria-label={`Remove item ${index + 1}`}
                            onClick={() =>
                              field(
                                'items',
                                draft.items.filter((line) => line.id !== item.id),
                              )
                            }
                          >
                            <Icon name="trash" size={15} />
                          </button>
                        </div>
                      </div>
                      <div className="field-grid item-description">
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
                            placeholder="What did you sell?"
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
                            onChange={(event) => lineField(item.id, 'quantity', event.target.value)}
                            aria-label={`Item ${index + 1} quantity`}
                            aria-describedby={describedBy}
                            inputMode="decimal"
                            required
                          />
                        </label>
                        <label>
                          Unit price · GHS
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
                          Line discount · GHS
                          <input
                            value={item.discount}
                            onChange={(event) => lineField(item.id, 'discount', event.target.value)}
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
                        Exempt / zero rated <span className="mono">EXM</span>
                      </label>
                      <div className="line-result">
                        <span>Line total, including tax</span>
                        <strong>{money(totals?.lines[index]?.total ?? 0)}</strong>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {draft.items.length > 0 && (
                <button
                  type="button"
                  className="button add-item-button"
                  disabled={draft.items.length >= 1000}
                  onClick={() =>
                    field('items', [...draft.items, newLine(draft.items.length + 1, draft.items)])
                  }
                >
                  <Icon name="plus" size={16} />
                  Add line item
                </button>
              )}
              <div className="pricing-row">
                <div>
                  <h4>Does your price include tax?</h4>
                  <p>The breakdown updates as you type.</p>
                </div>
                <div className="segmented" role="group" aria-label="Price calculation type">
                  <button
                    type="button"
                    aria-pressed={draft.calculationType === 'EXCLUSIVE'}
                    onClick={() => field('calculationType', 'EXCLUSIVE')}
                  >
                    Exclusive
                  </button>
                  <button
                    type="button"
                    aria-pressed={draft.calculationType === 'INCLUSIVE'}
                    onClick={() => field('calculationType', 'INCLUSIVE')}
                  >
                    Inclusive
                  </button>
                </div>
              </div>
            </fieldset>
            <div className="card submit-card">
              <div className="submit-options">
                <label className="scenario-label">
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
                <span className="muted-small">No real invoice is issued.</span>
              </div>
              <button
                type="submit"
                className="button button-primary submit-button"
                disabled={pending || mockStatus === 'down'}
              >
                {pending ? (
                  <>
                    <span className="spinner" aria-hidden="true" />
                    Submitting to mock…
                  </>
                ) : (
                  <>
                    Issue mock invoice <Icon name="arrow" />
                  </>
                )}
              </button>
              <p className="submit-note">A fake signature. A real request shape.</p>
            </div>
          </form>
          <aside className="summary-column" aria-label="Live invoice breakdown">
            <div className="section-heading summary-heading">
              <div>
                <span className="step-label">02 / INSPECT</span>
                <h2>Every pesewa, accounted for.</h2>
              </div>
            </div>
            <section className="card tax-card">
              <div className="tax-card-top">
                <span className="mono micro">LIVE BREAKDOWN</span>
                <span className="live-label">
                  <span aria-hidden="true" />
                  Live
                </span>
              </div>
              <div className="total-preview">
                <span>Invoice total</span>
                <strong>{money(totals?.total ?? 0)}</strong>
                <span className="total-preview-note">
                  {draft.calculationType === 'EXCLUSIVE'
                    ? 'Includes VAT and levies'
                    : 'Tax included in your prices'}
                </span>
              </div>
              <Breakdown totals={totals} />
              <div className="tax-card-foot">
                <Icon name="check-circle" size={15} />
                <p>
                  {rate(GHANA_2026.vatBps)} VAT + {rate(GHANA_2026.nhilBps)} NHIL +{' '}
                  {rate(GHANA_2026.getfundBps)} GETFund.
                  <br />
                  All applied to the same taxable base.
                </p>
              </div>
            </section>
            {totalsState.message && draft.items.length > 0 && (
              <p className="preview-warning" role="status">
                Complete the item values to calculate totals. {totalsState.message}
              </p>
            )}
            <aside className="developer-note">
              <span className="note-symbol" aria-hidden="true">
                ↳
              </span>
              <div>
                <h3>Built for the details.</h3>
                <p>
                  Integer money math. Explicit rounding.
                  <br />
                  Exact request casing. No hidden levies.
                </p>
                <a href="#integration">
                  Inspect the payload <Icon name="arrow" size={14} />
                </a>
              </div>
            </aside>
            <div className="rule-note">
              <span className="mono micro">THE 2026 CHANGE</span>
              <p>
                VAT is no longer charged on top of NHIL and GETFund. The COVID-19 levy is removed.
              </p>
              <a
                href="https://gra.gov.gh/domestic-tax/tax-types/vat/"
                target="_blank"
                rel="noreferrer"
              >
                Read GRA’s official guidance <Icon name="external" size={12} />
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </div>
          </aside>
        </div>
        {error && (
          <div
            id="builder-error"
            className="error-banner"
            role="alert"
            tabIndex={-1}
            ref={errorRef}
          >
            <strong>We couldn’t complete that request.</strong>
            <p>{error}</p>
            {rawError && (
              <details>
                <summary>Raw error response</summary>
                <pre>{rawError}</pre>
              </details>
            )}
          </div>
        )}
        {identityWarning && (
          <p className="warning-banner" role="status">
            {identityWarning}
          </p>
        )}
        {issued && (
          <section
            className="receipt-section"
            aria-labelledby="receipt-title"
            tabIndex={-1}
            ref={receiptRef}
          >
            <div className="section-heading">
              <div>
                <span className="step-label">03 / CHECK THE RESULT</span>
                <h2 id="receipt-title">Your mock receipt is ready.</h2>
              </div>
              <div className="receipt-actions">
                <button
                  type="button"
                  className="button button-outlined"
                  onClick={() => window.print()}
                >
                  <Icon name="print" size={16} />
                  Print receipt
                </button>
                <button
                  type="button"
                  className="button button-primary"
                  disabled={pending}
                  onClick={() => setRefundOpen((current) => !current)}
                >
                  <Icon name="refund" size={16} />
                  Refund this invoice
                </button>
              </div>
            </div>
            <div className="receipt-grid">
              <article className="receipt-paper" aria-label="Mock invoice receipt">
                <div className="receipt-watermark">MOCK RECEIPT · NO TAX VALIDITY</div>
                <div className="receipt-business">
                  <div className="brand-mark receipt-brand" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                    <i />
                  </div>
                  <h3>{issued.businessName}</h3>
                  <p>TIN {issued.businessTin}</p>
                  <p>
                    {issued.request.invoiceNumber} · {issued.request.transactionDate}
                  </p>
                </div>
                <div className="receipt-meta">
                  <span>Customer</span>
                  <strong>{issued.request.businessPartnerName}</strong>
                  <span>Receipt number</span>
                  <strong>{issued.result.response.message.ysdcrecnum}</strong>
                  <span>SDC ID</span>
                  <strong>{issued.result.response.message.ysdcid}</strong>
                </div>
                <table className="receipt-items">
                  <caption className="sr-only">Purchased items</caption>
                  <thead>
                    <tr>
                      <th scope="col">Item</th>
                      <th scope="col">Qty</th>
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
                <Breakdown totals={issued.totals} />
                <div className="receipt-grand-total">
                  <span>Total paid</span>
                  <strong>{money(issued.totals.total)}</strong>
                </div>
                <div className="receipt-qr">
                  {qr ? (
                    <img
                      src={qr}
                      alt="QR code encoding this mock receipt payload. This is a fake receipt, not valid for tax verification."
                      width={128}
                      height={128}
                    />
                  ) : (
                    <p role="status">Preparing mock QR code…</p>
                  )}
                  <div>
                    <strong>FAKE SIGNATURE</strong>
                    <p className="mono">{issued.result.response.message.ysdcregsig}</p>
                    <p>{issued.result.response.message.ysdctime} UTC</p>
                    <p>For integration testing only.</p>
                  </div>
                </div>
              </article>
              <div className="receipt-explainer">
                <span className="success-mark">
                  <Icon name="check" size={20} />
                </span>
                <h3>The round trip works.</h3>
                <p>
                  Your payload passed validation, reached the mock, and came back in the documented
                  GRA response envelope.
                </p>
                <p>
                  This receipt has a fake signature and a mock QR payload. Its numbers have no tax
                  validity.
                </p>
                <div className="receipt-copy-row">
                  <CopyButton value={JSON.stringify(issued.result, null, 2)} />
                  <CopyButton value={snippet} label="Copy SDK snippet" />
                </div>
                <div className="receipt-security">
                  <span className="mono micro">SIGNATURE DETAILS</span>
                  <dl>
                    <dt>Internal data</dt>
                    <dd>{issued.result.response.message.ysdcintdata}</dd>
                    <dt>Machine registration</dt>
                    <dd>{issued.result.response.message.ysdcmrc}</dd>
                    <dt>Transaction status</dt>
                    <dd>{issued.result.response.status}</dd>
                  </dl>
                </div>
              </div>
            </div>
            {refundOpen && (
              <section className="card refund-card" aria-labelledby="refund-title">
                <div className="card-title">
                  <h3 id="refund-title">Choose quantities to refund</h3>
                  <span className="mock-label">MOCK ONLY</span>
                </div>
                <p className="form-description">
                  Refunds reference this invoice. You can return only the quantities still
                  available.
                </p>
                <div className="refund-items">
                  {issued.request.items.map((item, index) => (
                    <div className="refund-item" key={item.itemCode}>
                      <div>
                        <strong>{item.description}</strong>
                        <span className="muted-small">
                          {remaining(item, refunds)} of {String(item.quantity)} available ·{' '}
                          {item.itemCode}
                        </span>
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
                          aria-describedby="refund-help"
                        />
                      </label>
                    </div>
                  ))}
                </div>
                <p id="refund-help" className="field-note">
                  The mock rejects quantities above those originally sold. Refund references are
                  unique per request.
                </p>
                <button
                  type="button"
                  className="button button-primary"
                  onClick={() => void submitRefund()}
                  disabled={pending}
                >
                  {pending ? 'Processing…' : 'Issue partial refund'}
                  <Icon name="refund" size={16} />
                </button>
                <p className="refund-status" role="status" tabIndex={-1} ref={refundStatusRef}>
                  {refundStatus}
                </p>
                {refunds.length > 0 && (
                  <div className="refund-history">
                    <h4>Refund history</h4>
                    {refunds.map((refund) => (
                      <div className="refund-history-item" key={refund.request.reference}>
                        <div>
                          <strong>{refund.request.reference}</strong>
                          <span>
                            {refund.cancelled
                              ? 'Cancelled, quantities restored'
                              : `${refund.request.items.map((item) => `${item.quantity} × ${item.itemCode}`).join(', ')} returned`}
                          </span>
                        </div>
                        {!refund.cancelled && (
                          <button
                            type="button"
                            className="button button-small button-outlined"
                            disabled={pending}
                            onClick={() => void cancelRefund(refund)}
                          >
                            Cancel refund
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}
          </section>
        )}
        <section
          id="integration"
          className="integration-section"
          aria-labelledby="integration-title"
        >
          <div className="section-heading">
            <div>
              <span className="step-label">{issued ? '04' : '03'} / TAKE IT TO YOUR CODE</span>
              <h2 id="integration-title">Nothing behind the curtain.</h2>
            </div>
            <span className="muted-small">The exact payload, response, and SDK call.</span>
          </div>
          <div className="code-panel">
            <div className="code-toolbar">
              <div className="code-tabs" role="group" aria-label="Inspect integration data">
                <button
                  type="button"
                  aria-pressed={dataTab === 'request'}
                  onClick={() => setDataTab('request')}
                >
                  Request JSON
                </button>
                <button
                  type="button"
                  aria-pressed={dataTab === 'response'}
                  onClick={() => setDataTab('response')}
                >
                  Response JSON
                </button>
                <button
                  type="button"
                  aria-pressed={dataTab === 'sdk'}
                  onClick={() => setDataTab('sdk')}
                >
                  <Icon name="code" size={15} />
                  SDK snippet
                </button>
              </div>
              {selectedCode && (
                <CopyButton
                  value={selectedCode}
                  label={dataTab === 'sdk' ? 'Copy SDK snippet' : 'Copy JSON'}
                />
              )}
            </div>
            <div
              className="code-content"
              tabIndex={0}
              aria-label={
                dataTab === 'request'
                  ? 'Request JSON code'
                  : dataTab === 'response'
                    ? 'Response JSON code'
                    : 'SDK snippet code'
              }
            >
              {dataTab === 'request' && !requestState.request ? (
                <div className="code-empty">
                  <span className="code-empty-cursor" aria-hidden="true">
                    ▌
                  </span>
                  <p>
                    Your request will appear here.
                    <br />
                    <span>
                      {draft.items.length
                        ? requestState.message
                        : 'Add a line item or load the sample invoice to get started.'}
                    </span>
                  </p>
                </div>
              ) : dataTab === 'response' && !issued ? (
                <div className="code-empty">
                  <span className="code-empty-cursor" aria-hidden="true">
                    ▌
                  </span>
                  <p>
                    Waiting for your first response.
                    <br />
                    <span>Issue a mock invoice to see the receipt envelope.</span>
                  </p>
                </div>
              ) : (
                <pre>{selectedCode}</pre>
              )}
            </div>
            <div className="code-panel-foot">
              <span>
                <span className="code-dot" />
                POST /vsdc/api/v1/taxpayer/:id/invoice
              </span>
              <span>application/json</span>
            </div>
          </div>
        </section>
        <footer className="site-footer">
          <div className="footer-top">
            <span className="footer-wordmark">gra/evat</span>
            <p>A useful starting point for building in Ghana.</p>
            <a href="#builder">Back to builder ↑</a>
          </div>
          <p>
            Independent, open source software. Not affiliated with GRA. Not tax advice. Verify
            against official GRA documentation.
          </p>
          <span className="mono micro">NO REAL CREDENTIALS. NO REAL INVOICES.</span>
        </footer>
      </main>
    </>
  );
}

function Breakdown({ totals }: { totals: Totals | null }) {
  return (
    <table className="breakdown-table">
      <caption className="sr-only">Invoice levy and VAT breakdown in Ghana cedis</caption>
      <tbody>
        <tr>
          <th scope="row">Net subtotal</th>
          <td>{money(totals?.subtotal ?? 0)}</td>
        </tr>
        <tr>
          <th scope="row">Discounts</th>
          <td>{money(totals?.discountAmount ?? 0)}</td>
        </tr>
        <tr>
          <th scope="row">
            NHIL <span>{rate(GHANA_2026.nhilBps)}</span>
          </th>
          <td>{money(totals?.nhil ?? 0)}</td>
        </tr>
        <tr>
          <th scope="row">
            GETFund <span>{rate(GHANA_2026.getfundBps)}</span>
          </th>
          <td>{money(totals?.getfund ?? 0)}</td>
        </tr>
        <tr className="vat-row">
          <th scope="row">
            VAT <span>{rate(GHANA_2026.vatBps)}</span>
          </th>
          <td>{money(totals?.vat ?? 0)}</td>
        </tr>
      </tbody>
    </table>
  );
}
