# Gaslite Analyzer ⚡

> Autonomous YUL gas optimization agent for Mantle L2 smart contracts — runs directly in your GitHub PRs.

[![GitHub Marketplace](https://img.shields.io/badge/GitHub-Marketplace-blue?logo=github)](https://github.com/marketplace/actions/gaslite-analyzer)
[![Mantle L2](https://img.shields.io/badge/Mantle-L2-green)](https://mantle.xyz)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## What it does

Every time you open a Pull Request with Solidity changes, Gaslite Analyzer:

1. **Detects** changed `.sol` files automatically
2. **Analyzes** each contract using a RAG pipeline of 30+ Mantle-specific YUL patterns
3. **Generates** optimized code with inline assembly
4. **Posts** a detailed report directly to your PR

No setup beyond adding one workflow file. No local tools required.

---

## Quick Start

**Step 1** — Add the workflow to your Mantle protocol repo at `.github/workflows/gaslite.yml`:

```yaml
name: Gaslite Gas Optimization

on:
  pull_request:
    paths:
      - '**.sol'

jobs:
  gaslite:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
      contents: read

    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 2

      - name: Gaslite Analyzer
        uses: toastx/gaslite-analyzer@v1
        with:
          gaslite-api-url: ${{ secrets.GASLITE_API_URL }}
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

**Step 2** — Add `GASLITE_API_URL` to your repo secrets (Settings → Secrets → Actions)

**Step 3** — Open a PR with any `.sol` changes and Gaslite comments automatically

---

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `gaslite-api-url` | ✅ | — | URL of your Gaslite backend deployment |
| `github-token` | ✅ | `${{ github.token }}` | GitHub token for posting PR comments |
| `gaslite-api-key` | ❌ | `""` | API key for private deployments |
| `min-gas-savings` | ❌ | `100` | Skip files below this gas threshold |
| `fail-on-unoptimized` | ❌ | `false` | Block PR merge if optimizations found |

## Outputs

| Output | Description |
|--------|-------------|
| `optimized-files` | Number of files with optimization opportunities |
| `total-files` | Total Solidity files analyzed |

---

## Configuration Examples

### Block merges until optimized

Turn Gaslite into a required status check — PRs cannot merge until gas is optimized:

```yaml
- uses: toastx/gaslite-analyzer@v1
  with:
    gaslite-api-url: ${{ secrets.GASLITE_API_URL }}
    github-token: ${{ secrets.GITHUB_TOKEN }}
    fail-on-unoptimized: 'true'
    min-gas-savings: '500'
```

### Private deployment with API key

```yaml
- uses: toastx/gaslite-analyzer@v1
  with:
    gaslite-api-url: ${{ secrets.GASLITE_API_URL }}
    gaslite-api-key: ${{ secrets.GASLITE_API_KEY }}
    github-token: ${{ secrets.GITHUB_TOKEN }}
```

---

## What gets optimized

Gaslite applies Mantle-specific YUL patterns sourced from Solady and Solmate:

| Pattern | Gas Saved (Mantle) | Description |
|---------|-------------------|-------------|
| `SLOAD_CACHE_BEFORE_SSTORE` | ~800 gas | Cache storage reads in local variables |
| `SCRATCH_SPACE_SLOT_HASH` | ~200 gas | Use scratch space for slot derivation |
| `CUSTOM_ERROR_4BYTE` | ~200 gas | Replace string reverts with 4-byte selectors |
| `LOG3_INLINE_EMIT` | ~300 gas | Direct event emission without ABI encoding |
| `INFINITE_ALLOWANCE_FAST_PATH` | ~800 gas | Skip allowance decrement for max approvals |
| `STORAGE_HITCHHIKING` | ~2100 gas | Pack owner + metadata in single slot |
| `XOR_OWNER_UPDATE` | ~50 gas | Swap address bits without masking |
| `BRANCHLESS_CLAMP` | ~30 gas | Branch-free min/max operations |
| + 22 more patterns | varies | Full library in [gaslite repo](https://github.com/toastx/gaslite/tree/main/knowledge-base) |

---

## How it works

```
PR opened with .sol changes
        ↓
Action detects changed files via git diff
        ↓
Each file sent to Gaslite /api/optimize
        ↓
solang AST parser detects contract type (ERC20, ERC721, DeFi...)
        ↓
Qdrant vector search retrieves relevant YUL patterns
        ↓
DeepSeek generates optimized Solidity/YUL
        ↓
Formatted report posted as PR comment
```

**Powered by:**
- [Qdrant](https://qdrant.tech) — vector similarity search
- [Turso](https://turso.tech) — pattern metadata storage
- [DeepSeek](https://deepseek.com) — code generation
- [Mantle L2](https://mantle.xyz) — target network

---

## Files automatically skipped

- Test files (`*.t.sol`, `/test/`, `/tests/`)
- Mock contracts (`/mock/`, `Mock*.sol`)
- Pure interfaces

Comments are **updated in-place** on re-runs — no duplicate comments on each push.

---

## Self-hosting the backend

```bash
git clone https://github.com/toastx/gaslite
cd gaslite

# Configure environment
cp .env.example .env
# Fill in: DEEPSEEK_API_KEY, QDRANT_URL, QDRANT_API_KEY, TURSO_URL, TURSO_TOKEN

# Run
cargo run --release
```

---

## Supported Networks

| Network | Status | Notes |
|---------|--------|-------|
| Mantle L2 | ✅ Native | Mantle-specific gas schedule and opcode costs |
| Ethereum L1 | ✅ Supported | Standard EVM patterns apply |
| Other EVM L2s | ⚠️ Experimental | Gas estimates may vary |

---

## Contributing

Pattern contributions welcome. See the [knowledge base schema](https://github.com/toastx/gaslite/tree/main/knowledge-base) for the JSON format.

---

## License

MIT

---

<sub>Built for the [Mantle Turing Test Hackathon](https://mantle.xyz/hackathon) · [toastx/gaslite](https://github.com/toastx/gaslite)</sub>