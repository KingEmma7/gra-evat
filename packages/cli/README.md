# @gra-evat/cli

```sh
gra-evat validate invoice.json
gra-evat calc --price 100 --inclusive
```

Validation failures exit with status 1 and return all discovered field issues with fix hints. Calculator prices are GHS decimal strings, using the SDK's 2026 standard rules and integer arithmetic. `--quantity`, `--discount` and `--exempt` are available. Run `gra-evat --help` for usage.

Not affiliated with GRA. Not tax advice. Verify all fiscal behavior against official GRA documents.
