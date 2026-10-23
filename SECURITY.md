# Security policy

The initial 0.1.x series is intended for local integration development. The simulator provides no fiscal authenticity, persistence, access management or tenant hosting guarantees.

Never send real credentials to the demo. Keep GRA keys in server-side environment variables, avoid logging headers or invoice bodies, and use HTTPS for real GRA requests. The mock listens on loopback by default. Explicitly review network exposure before self-hosting.

For a vulnerability, use the repository's private Security Advisory reporting option if enabled. Otherwise contact a maintainer privately using the address or contact method on their repository profile. Do not publish credentials, taxpayer records or an exploit in a public issue. Maintainers should enable private reporting and publish a security contact before the first public release.

Include affected versions, reproduction steps, impact and a suggested fix if available. Maintainers will investigate privately and coordinate a release and advisory. Response times depend on volunteer availability; no service-level guarantee is implied.
