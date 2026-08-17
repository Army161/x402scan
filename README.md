# x402scan

**Measure the machine-payment economy from chain data — and find out whether it's real.**

[![tests](https://img.shields.io/badge/tests-9%20passing-brightgreen)](test/authenticity.test.mjs)
[![dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)](package.json)
[![node](https://img.shields.io/badge/node-%E2%89%A518-blue)](#requirements)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

AI agents now settle payments autonomously using the [x402](https://x402.org) protocol.
Every ecosystem dashboard reports the same headline: **transaction counts**.

On a chain where a transaction costs $0.0002, a count is close to meaningless. A single
integration test suite, a hackathon weekend, or one agent looping against a demo API
manufactures a million payments for about $200.

**x402scan measures whether the payments behave like commerce.**

```
Base · EIP-3009 transferWithAuthorization on USDC
  sampled 250/250 blocks · 498s window

  Authenticity    71/100  ██████████████░░░░░░  commerce
  Behaves like real metered commerce.

  payments           842
  unique payers      90
  distinct values    340
  median             $0.005
  max                $24.37
  settled/day        $9,990
```

```
XRP Ledger · SourceTag 804681468
  sampled 138/250 ledgers · 483s window

  Authenticity     8/100  ██░░░░░░░░░░░░░░░░░░  test-harness
  Test harness. Transaction counts here do not represent commerce.

  payments           156
  unique payers      9          ← nine wallets, firing metronomically
  distinct values    3          ← 0.001, 0.002, 0.003. Nothing else.
  settled/day        $42
```

Same protocol, same day, same method. One is a market; one is a loop.

---

## Install

### Run without installing

```bash
npx x402scan scan base
```

### Install globally

```bash
npm install -g x402scan
```

### Windows (PowerShell)

```powershell
irm https://raw.githubusercontent.com/YOUR_USER/x402scan/main/scripts/install.ps1 | iex
```

### macOS / Linux

```bash
curl -fsSL https://raw.githubusercontent.com/YOUR_USER/x402scan/main/scripts/install.sh | bash
```

### From source

```bash
git clone https://github.com/YOUR_USER/x402scan && cd x402scan && npm link
```

No build step. No `npm install`. See [Why zero dependencies](#why-zero-dependencies).

---

## Requirements

| | |
|---|---|
| **Node.js** | 18 or later (uses built-in `fetch` and `AbortSignal.timeout`) |
| **Network** | Outbound HTTPS to public RPC endpoints |
| **OS** | Windows, macOS, Linux — pure JavaScript, nothing native |
| **Accounts / API keys** | **None.** Public RPCs only. |

---

## Usage

```bash
x402scan scan                 # all chains
x402scan scan base            # one chain
x402scan scan xrpl --units 500 --json
x402scan watch --trend ~/.x402scan/trend.jsonl
x402scan trend --trend ~/.x402scan/trend.jsonl
x402scan mcp                  # run as an MCP server
x402scan chains
```

| Option | Default | Meaning |
|---|---|---|
| `--units <n>` | `250` | Ledgers or blocks to sample |
| `--json` | off | Machine-readable output |
| `--out <file>` | — | Append full JSON to a file |
| `--trend <file>` | `./trend.jsonl` | Trend file for `watch` / `trend` |
| `--price <n>` | live | Override the native-asset USD rate |
| `--quiet` | off | Suppress progress |
| `--no-color` | off | Disable ANSI colour |

---

## The Authenticity Score

The reason this tool exists. Four signals a test harness cannot cheaply fake:

| Signal | Weight | What it catches |
|---|---|---|
| **Value diversity** | 40% | Metered billing produces computed amounts like `0.020325`. Loops produce `0.001`. |
| **Payer diversity** | 25% | Real demand comes from many wallets, unevenly. Loops are evenly spread across a few. |
| **Failure presence** | 15% | Real commerce fails 1–5% of the time. A flawless 100% success rate is a controlled environment. |
| **Tail presence** | 20% | Real distributions have outliers. If max ≈ p95, nobody is buying anything unusual. |

| Score | Band | Read as |
|---|---|---|
| 70–100 | `commerce` | Behaves like real metered commerce |
| 45–69 | `mixed` | Genuine usage alongside significant automated traffic |
| 25–44 | `mostly-synthetic` | Treat headline counts with caution |
| 0–24 | `test-harness` | Counts do not represent commerce |

**Signals that cannot be measured are omitted and the remaining weights renormalised** — a
chain is never penalised for our instrumentation gap. Base payments are read from block
calldata, which cannot reveal reverts, so failure presence is omitted there and the output
says so.

Below 20 observed payments, no score is returned at all.

---

## MCP server

Gives any MCP-capable agent live agentic-payment data.

```bash
claude mcp add --scope user x402scan -- npx -y x402scan mcp
```

<details>
<summary>Cursor / VS Code / other clients</summary>

```json
{
  "mcpServers": {
    "x402scan": { "command": "npx", "args": ["-y", "x402scan", "mcp"] }
  }
}
```
</details>

| Tool | Purpose |
|---|---|
| `scan_chain` | Measure one chain, return the Authenticity Score |
| `compare_chains` | All chains side by side |
| `explain_authenticity_score` | How the score works and how to read it |
| `read_trend` | Read a recorded trend file |

Then just ask: *"Is x402 volume on Base real, or mostly testing?"*

---

## Hosted dashboard & Data API

```bash
npx vercel --prod          # from the repo root; no build step
```

Static dashboard plus three serverless endpoints. No framework, no bundler — the
API imports the same `src/` the CLI uses, so there is exactly one implementation
of the score.

| Endpoint | Returns |
|---|---|
| `GET /api/scan?chain=base&units=150` | One chain, full detail |
| `GET /api/compare?units=150` | All chains, ranked by score |
| `GET /api/health` | Capabilities and tier limits |

```bash
curl 'https://YOUR_DEPLOY.vercel.app/api/compare?units=150'
```

### Tiers

| Tier | Auth | Max units | Cache |
|---|---|---|---|
| **Free** | none | 150 | 5 min |
| **Pro** | `x-api-key` | 1 000 | 1 min |
| **Intel** | `x-api-key` | 4 000 | uncached |

Requests above a tier's ceiling are **clamped, not rejected** — the response carries a
`clamped` object saying what you asked for and what you got. Unrecognised keys fall back
to free with a `warning` rather than a 401.

Keys live in the `X402SCAN_KEYS` env var as comma-separated `key:tier` pairs. That is a
deliberate placeholder: real billing is a later stage, and this is the seam it plugs into.

Caching is not an optimisation here — a scan takes 30–90s and hammers public RPCs. The
in-process memo plus CDN `s-maxage` is what keeps the free tier viable.

### Local development

```bash
node scripts/dev-server.mjs     # http://localhost:3000
```

Mimics Vercel's function contract so handlers can be exercised without deploying.

---

## Library

```js
import { scanChain, authenticityScore } from 'x402scan';

const base = await scanChain('base', { units: 250 });
console.log(base.authenticity.score, base.authenticity.band);

// Or score measurements you gathered yourself
authenticityScore({
  payments: 842, distinctValues: 340, payers: 90,
  failureRate: null, median: 0.005, max: 24.37,
});
```

---

## Method

| | XRP Ledger | Base |
|---|---|---|
| **Fingerprint** | `SourceTag 804681468` (t54 facilitator) | EIP-3009 `transferWithAuthorization` on USDC |
| **Unit** | Validated ledgers | Blocks |
| **Reorgs** | None — deterministic finality | Sampled from recent blocks |
| **Payer identity** | Transaction sender | Recovered from the signed authorization, not the submitter |

The Base selector is **discovered, not assumed**: the scanner tallies every selector called
on USDC and decodes anything matching the EIP-3009 calldata shape with a plausible
`validAfter`/`validBefore` window. `0xe3ee160e` falls out empirically. No ABI file, no
trusted third party.

---

## Known limitations

Stated plainly, because a measurement tool that hides its error bars is worthless.

- **Sampling, not census.** A scan reads a short recent window (~2–10 minutes). `$/day`
  figures extrapolate that window to 24h — **order of magnitude, not accounting.** Diurnal
  and weekly patterns are invisible in a single sample. Use `watch` for trends.
- **Small samples move the score.** A 60-block Base sample scored 89; a 250-block sample
  scored 71. Use `--units 250` or more for anything you intend to quote.
- **Base failure rate is unmeasurable** from calldata alone. Omitted rather than guessed.
- **Public RPCs rate-limit.** `xrplcluster.com` returns `FUP exceeded` under load; the
  scanner rotates endpoints and reports how many units it actually got. Always check
  `sampling.scanned` against `sampling.requested`.
- **Facilitator pooling.** On XRPL the submitter is the payer, so a facilitator relaying for
  many clients would compress payer counts. Base's EIP-3009 preserves the true payer, which
  is why cross-chain payer comparisons favour Base's number as the more honest one.
- **Two chains so far.** Solana is the obvious next adapter.

---

## Why zero dependencies

Every dependency is a supply-chain risk, an install step, and a lockfile that drifts. This
package uses only Node built-ins — including the MCP server, which implements JSON-RPC
directly rather than pulling in the SDK.

The result: `npx x402scan` works instantly, nothing to audit, and it will still run in five
years.

---

## Development

```bash
npm test               # 9 tests, pinned to real measurements
node src/cli.mjs scan base --units 60
```

The test suite pins the Authenticity Score against **actual 13 Aug 2026 measurements** from
both chains, so a scoring change that breaks the XRPL/Base distinction fails CI.

Adding a chain: implement `scan()` in `src/chains/<id>.mjs` returning the normalised shape,
then register it in `src/index.mjs`. See `base.mjs` for the non-trivial case.

---

## License

MIT
