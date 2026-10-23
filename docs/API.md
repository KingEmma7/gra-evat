# API contract and traceability

Source: [GRA E-VAT API v8.2](https://documenter.getpostman.com/view/29809098/2sBXVeGCzK), collection `9154d680-6787-40f7-9627-f625e0b9a803`, published 8 January 2026, retrieved 23 October 2026. The collection was fetched through the public documenter collection endpoint. Public example security keys are deliberately excluded from this repository.

All requests use `security_key` and JSON. POST requests send `Content-Type: application/json`; the client asks for `Accept: application/json`. The SDK baseUrl accepts the API origin or origin plus `/vsdc/api/v1/taxpayer`. Credentials supply the taxpayer identifier separately.

## Documented operations

| Method | Path                                                                        | Request flag                  | Postman example  |
| ------ | --------------------------------------------------------------------------- | ----------------------------- | ---------------- |
| POST   | `/vsdc/api/v1/taxpayer/{taxpayerId}/invoice`                                | `INVOICE`                     | INVOICE          |
| POST   | `/vsdc/api/v1/taxpayer/{taxpayerId}/invoice`                                | `REFUND`                      | FULL REFUND      |
| POST   | `/vsdc/api/v1/taxpayer/{taxpayerId}/invoice`                                | `PARTIAL_REFUND`              | PARTIAL REFUND   |
| POST   | `/vsdc/api/v1/taxpayer/{taxpayerId}/cancellation`                           | `REFUND_CANCELATION`          | JSON             |
| POST   | `/vsdc/api/v1/taxpayer/{taxpayerId}/invoice`                                | `PURCHASE`                    | PURCHASE         |
| POST   | `/vsdc/api/v1/taxpayer/{taxpayerId}/invoice`                                | `PURCHASE_RETURN`             | PURCHASE RETURN  |
| POST   | `/vsdc/api/v1/taxpayer/{taxpayerId}/cancellation`                           | `PURCHASE_RETURN_CANCELATION` | JSON             |
| POST   | `/vsdc/api/v1/taxpayer/{taxpayerId}/note`                                   | `CREDIT_NOTE`                 | JSON             |
| POST   | `/vsdc/api/v1/taxpayer/{taxpayerId}/statment_of_account`                    | ``                            | JSON             |
| GET    | `/vsdc/api/v1/taxpayer/{taxpayerId}/health`                                 | ``                            | HEALTH CHECK     |
| GET    | `/vsdc/api/v1/taxpayer/{taxpayerId}/identification/tin/{identifier}`        | ``                            | TinDetails       |
| GET    | `/vsdc/api/v1/taxpayer/{taxpayerId}/identification/nationalId/{identifier}` | ``                            | GhanaCardDetails |
| POST   | `/vsdc/api/v1/taxpayer/{taxpayerId}/inventory`                              | ``                            | JSON             |
| POST   | `/vsdc/api/v1/taxpayer/{taxpayerId}/invoice/callback`                       | `INVOICE`                     | INVOICE_CALLBACK |

The TIN lookup URL is absent from its top-level request but present in `response.originalRequest.url`. No path had to be invented. Cancellation flags and `statment_of_account` retain the source's spelling. `PARTIAL_REFUND` receipts show `flag: "REFUND"` in the example response. Credit note is the only supplied note enum, even though the folder mentions debit notes.

## SDK methods

`createClient` exposes `invoice`, `refund`, `partialRefund`, `purchase`, `purchaseReturn`, `cancelRefund`, `cancelPurchaseReturn`, `health`, `note`, `statementOfAccount`, `lookupTin`, `lookupGhanaCard`, `inventory`, and `callback`. The same methods under `client.throwing` throw typed errors. Each regular method resolves to `{ok:true,data}` or `{ok:false,error}`.

The convenience `createInvoice` builder calculates standard and `EXM` invoices from pesewas. Raw operation methods accept unknown JSON, validate it, and retain documented wire names. `InvoiceSchema`, `CancellationSchema`, `NoteSchema`, `StatementOfAccountSchema`, `InventorySchema`, and `CallbackSchema` export the exact executable schema constraints.

## Invoice fields

The tag table and INVOICE/PURCHASE/REFUND/PARTIAL REFUND/PURCHASE RETURN examples define:

- `currency`
- `exchangeRate`
- `invoiceNumber`
- `totalLevy`
- `userName`
- `flag`
- `calculationType`
- `totalVat`
- `transactionDate`
- `totalAmount`
- `totalExciseAmount`
- `businessPartnerName`
- `businessPartnerTin`
- `saleType`
- `discountType`
- `taxType`
- `discountAmount`
- `reference`
- `groupReferenceId`
- `purchaseOrderReference`
- `voucherAmount` (refund/error examples and tag table)

Line fields in the same examples and tag table:

- `batchCode`
- `description`
- `discountAmount`
- `exciseAmount`
- `expireDate`
- `itemCategory`
- `itemCode`
- `levyAmountA`
- `levyAmountB`
- `levyAmountC`
- `levyAmountD`
- `levyAmountE`
- `quantity`
- `unitPrice`

Table constraints: invoice number 100 characters; username 100; partner name 100; partner TIN 15; item code 50; item description 100; batch code 100; group reference 50; refund reference 50. Limits not provided for other objects are local safety policies and appear in ASSUMPTIONS.md.

Enums: currency `GHS | USD | EUR | GBP`; calculation `INCLUSIVE | EXCLUSIVE`; sale `NORMAL | EXPORT`; discount `GENERAL | SELECTIVE`; item category `"" | CST | TRSM | EXM | RNT | EXC_PLASTIC`. `taxType: STANDARD` appears only in request examples. All flag and category values are case-sensitive.

`totalAmount` is the sum of extended unit prices regardless of calculation mode. `totalLevy` sums A through E. `totalVat` holds invoice VAT. There is no documented per-line VAT field. There are no seller name, branch or customer phone fields in the invoice request. BusinessIdentity and Customer are local metadata types and are never serialized as invented wire fields.

## Other requests

- Cancellation: `invoiceNumber`, `reference`, `userName`, `flag`, `transactionDate`, `totalAmount`.
- Note: `noteNumber`, `currency`, `exchangeRate`, `noteAmount`, `calculationType`, `businessPartnerName`, `businessPartnerTin`, `userName`, `flag`, `groupReferenceId`, `transactionDate`, `remarks`, `noteLineFlag`, `noteLines`. Lines contain `invoiceNumber`, `invoiceDate`, `invoiceAmount`.
- Account statement: `currency`, `exchangeRate`, `totalVat`, `totalAmount`, `totalLevies`, `userName`, `businessPartnerName`, `businessPartnerTin`, `groupReferenceId`, `transactionDate`, `calculationType`, `groupInvoiceLines`. Lines contain `currency`, `exchangeRate`, `calculationType`, `invoiceNumber`, optional `reference`, `flag`, `invoiceVat`, `invoiceAmount`, `invoiceLevies`, `transactionDate`.
- Inventory: `inventories` and `inventoryDate`. Lines contain `code`, `description`, `quantity`, `batchCode`, `unitPrice`, `expiryDate`.
- Callback: `reference`, `invoiceNumber`, `flag`.

## Responses

Invoice, refund, purchase, return and callback responses use:

```ts
{
  response: {
    distributor_tin: string;
    message: {
      num: string;
      ysdcid: string;
      ysdcrecnum: string;
      ysdcintdata: string;
      ysdcregsig: string;
      ysdcmrc: string;
      ysdcmrctim: string;
      ysdctime: string;
      flag: string;
      ysdcitems: string;
    }
    qr_code: string;
    status: 'SUCCESS';
  }
}
```

Use `ysdcmrctim`, as received in examples. The table's `ysdcmrctime` is inconsistent with those examples. Purchase and purchase-return examples have empty signature, internal data and QR strings. Response timestamps use `YYYY/MM/DD HH:mm:ss`. Request examples use date-only `YYYY-MM-DD` and UTC ISO timestamps; the SDK preserves submitted strings.

Health returns `{status:"UP"}`. Inventory returns `{status:"SUCCESS"}`. Identity lookup returns `{status:"SUCCESS",data:{tin,type,name,sector,address}}`. Documented errors use `{timestamp,status,error}`. Forbidden is HTTP 403 with body status 901; duplicate invoice is HTTP 400. The SDK retains HTTP status and raw body, with `body.error` as its error code. There is no documented separate field-path property in the server error envelope; validation field paths are local SDK diagnostics.

Cancellation, note and statement responses have no examples. The client therefore returns unknown JSON for those operations; the mock uses the explicitly named `AssumedAcknowledgementSchema` only. See ASSUMPTIONS.md before relying on them.
