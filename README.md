# Gaslite Analyzer ⚡

> Autonomous YUL gas optimization agent for Mantle L2 smart contracts — runs directly in your GitHub PRs.

[![GitHub App](https://img.shields.io/badge/GitHub-App-blue?logo=github)](https://github.com/apps/gaslite-analyzer)
[![Mantle L2](https://img.shields.io/badge/Mantle-L2-green)](https://mantle.xyz)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## What it does

Every time you open a Pull Request with Solidity changes, Gaslite Analyzer:

1. **Detects** changed `.sol` files automatically
2. **Analyzes** each contract using a RAG pipeline of 30+ Mantle-specific YUL patterns
3. **Generates** optimized code with inline assembly
4. **Posts** a detailed report directly to your PR

No workflow files. No configuration. Just install and go.

---

## Install

[**Install the GitHub App**](https://github.com/apps/gaslite-analyzer) and select the repos you want to enable. That's it.

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
Gaslite App receives webhook from GitHub
        ↓
Changed files fetched via GitHub API
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
