# Security policy

The initial 0.1.x series is intended for local integration development. The simulator provides no fiscal authenticity, persistence, access management or tenant hosting guarantees.

Never send real credentials to the demo. Keep GRA keys in server-side environment variables, avoid logging headers or invoice bodies, and use HTTPS for real GRA requests. The mock listens on loopback by default. Explicitly review network exposure before self-hosting.

[Report a vulnerability privately](https://github.com/KingEmma7/gra-evat/security/advisories/new) through GitHub's private reporting form. Include only synthetic reproduction data. If the form is unavailable, open an issue asking for a private channel without describing the vulnerability. Do not publish credentials, personal records or exploit details in a public issue.

Include affected versions, reproduction steps, impact and a suggested fix if available. Maintainers will investigate privately and coordinate a release and advisory. Response times depend on volunteer availability; no service-level guarantee is implied.

## Playground response policy

The Next server sends CSP, frame denial, content-type sniffing protection, a no-referrer policy, and disables camera, microphone and geolocation. Connections are limited to the app origin and the configured mock origin. The static Next bootstrap requires inline scripts; production does not allow eval. This CSP reduces external resource and framing exposure but does not eliminate inline-script injection risk. The public playground remains synthetic mock tooling, and real credentials belong on the integrator's server.
