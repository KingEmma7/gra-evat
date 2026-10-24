# ADR 0001: Preserve the API contract and use integer monetary arithmetic

Status: accepted. Date: 2026-10-23.

The v8.2 Postman collection contains inconsistencies between tables and examples. Request examples determine path and literal flag spellings; response examples determine the received envelope. Unresolved behavior is isolated and listed in ASSUMPTIONS.md. No credential from the public collection is distributed.

Zod 4.6.6 is the only core runtime dependency. Inferred types and runtime validation come from the same schemas. JSON numeric strings are supported because the source examples use both strings and numbers.

Pesewas are branded safe integers; BigInt rational arithmetic handles tax and quantity multiplication. Safe-range checks stop overflow. The 2026 configuration uses a shared base, effective date, and explicit rounding policy. Display numbers do not feed back into calculations.

The browser demo uses the same Hono app and in-memory store as the Node mock through an injected fetch adapter. This prevents separate mock implementations from diverging. No real API credential is accepted by the public playground.
