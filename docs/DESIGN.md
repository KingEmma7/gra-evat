# Reference manual design

The home page opens with checkout commands. The navigation leads to the invoice builder, receipt and refunds, API reference, and SDK integration. All fourteen operations provide independently copyable request and response examples. The pairs sit side by side on desktop and stack on narrow screens.

## Measured layout

| Property           | Verified value            |
| ------------------ | ------------------------- |
| Background         | #FAFAF9                   |
| Main text          | #111111                   |
| Muted text         | #6B6B6B                   |
| Borders            | #E5E5E3                   |
| Body               | IBM Plex Sans, 16px / 1.6 |
| Font weights       | 400 and 600               |
| Code               | IBM Plex Mono, 400        |
| Desktop navigation | Fixed, 240px              |
| Content width      | Maximum 720px             |
| Layout spacing     | 8px scale                 |
| Numeric styling    | Tabular numerals          |
| Focus              | Visible black outline     |

The two text colors have contrast ratios of 18.08:1 and 5.10:1 against the background. Local font files avoid an external font request. Font copyright notices and licenses are retained in licenses/.

The rendered audit found no marketing hero, eyebrow headings, decorative numbered steps, arrow calls to action, color accents, gradients, glass effects, glow, blobs, pill badges, feature-card grids, testimonials, logo rows, emoji, sparkle icons, stock illustrations or invented metrics. Borders are one pixel and the interface uses no shadows.

## Screenshots

The screenshot set contains 53 real browser captures. It includes every manual view, all fourteen endpoint pairs, empty forms and receipts, copy success, loading, validation, HTTP 500, HTTP 429, network failure, unreachable mock, mobile long text, print, and the missing-page view.

| View             | Desktop                                                   | Mobile                                                           |
| ---------------- | --------------------------------------------------------- | ---------------------------------------------------------------- |
| Quickstart       | [Screenshot](screenshots/desktop-quickstart.png)          | [360px](screenshots/mobile-quickstart.png)                       |
| Empty builder    | [Screenshot](screenshots/desktop-builder-empty-items.png) | [Builder](screenshots/mobile-builder.png)                        |
| Filled builder   | [Screenshot](screenshots/desktop-builder-filled.png)      | [Builder](screenshots/mobile-builder.png)                        |
| Empty receipt    | [Screenshot](screenshots/desktop-receipt-empty.png)       |                                                                  |
| Receipt          | [Screenshot](screenshots/desktop-receipt-paper.png)       | [360px](screenshots/mobile-receipt-paper.png)                    |
| Refunds          | [Screenshot](screenshots/desktop-refund-success.png)      | [Long-text regression](screenshots/mobile-long-text-refunds.png) |
| API reference    | [Screenshot](screenshots/desktop-api-reference.png)       | [360px](screenshots/mobile-api-reference.png)                    |
| SDK integration  | [Screenshot](screenshots/desktop-sdk-integration.png)     |                                                                  |
| Request loading  | [Screenshot](screenshots/desktop-submit-loading.png)      | [360px](screenshots/mobile-submit-loading.png)                   |
| Network error    | [Screenshot](screenshots/desktop-network-error.png)       | [360px](screenshots/mobile-network-error.png)                    |
| Unreachable mock | [Screenshot](screenshots/desktop-mock-unreachable.png)    | [360px](screenshots/mobile-mock-unreachable.png)                 |
| Missing page     | [Screenshot](screenshots/desktop-not-found.png)           | [360px](screenshots/mobile-not-found.png)                        |
| Print            | [Receipt](screenshots/print-receipt.png)                  |                                                                  |

Individual endpoint images are named `endpoint-01-invoice.png` through `endpoint-14-callback.png` in the same folder. Their request and response panels use the same layout component.

## Verification

Six axe scans returned no violations: desktop empty state, desktop receipt and refunds, mobile receipt and refunds, long mobile text, mobile network error, and mobile missing page. The three Playwright smoke flows also check accessibility and the 320px layout. Keyboard checks cover the form, receipt focus, refund submission and cancellation focus.

At 360px, the document width remains 360px with valid 100-character business names, invoice numbers and item descriptions, including an open refund form. The printed two-item receipt measures 875px high within the 1002px available A4 area. Print hides navigation and other sections, and the QR image is 32mm wide.

[DESIGN-AUDIT.json](DESIGN-AUDIT.json) retains the measured layout, loaded fonts, accessibility results and screenshot inventory. These automated checks and visual reviews do not replace a full accessibility certification.
