# GuiltySpark

> *"I am a genius."* — 343 Guilty Spark, faithfully indexing everything it was told to protect.

GuiltySpark is a local privacy layer that sits between you and LLM providers (Anthropic, OpenAI, etc.). It intercepts your prompts, detects and replaces sensitive data with temporary variable placeholders before the request leaves your machine, sends the sanitized prompt to the LLM, then decodes the response back — swapping placeholders for your original data before returning the result to you.

All detection and classification runs locally via [Ollama](https://ollama.ai). Your sensitive data never leaves your machine.

---

## Table of Contents

- [Why GuiltySpark?](#why-guiltyspark)
- [Core Capabilities](#core-capabilities)
- [How It Works](#how-it-works)
- [Potential Architectures](#potential-architectures)
  - [Architecture A: MCP Server](#architecture-a-mcp-server)
  - [Architecture B: Local HTTP Proxy](#architecture-b-local-http-proxy)
  - [Architecture C: SDK Wrapper](#architecture-c-sdk-wrapper)
  - [Architecture Comparison](#architecture-comparison)
- [Tech Stack](#tech-stack)
- [Privacy Guarantees](#privacy-guarantees)
- [Configuration](#configuration)
- [Threat Model](#threat-model)
- [Project Status](#project-status)

---

## Why GuiltySpark?

LLMs are powerful reasoning engines, but using them means routing your data through third-party APIs. For many real-world tasks — drafting emails, analyzing contracts, summarizing documents, writing code against internal systems — prompts naturally contain:

- Names, emails, phone numbers, physical addresses
- Account numbers, SSNs, credit card numbers
- API keys, passwords, secrets
- Internal company names, project codenames, IP addresses
- Medical or legal information
- Anything else you'd rather not log on someone else's server

Most users either avoid LLMs for sensitive work or paste in the data and hope for the best. GuiltySpark makes a third option viable: use LLMs with full capability on sensitive content, while keeping that content local.

---

## Core Capabilities

### PII Detection via Local Ollama Models

GuiltySpark uses a locally-running Ollama model to detect and classify sensitive entities in your prompt before it goes anywhere. Because detection runs on-device, no data is exfiltrated during analysis — not even the metadata about what was found.

Supported entity categories (configurable):

| Category | Examples |
|---|---|
| `PERSON_NAME` | "John Smith", "Dr. Martinez" |
| `EMAIL` | "john@example.com" |
| `PHONE` | "+1-555-867-5309" |
| `ADDRESS` | "123 Main St, Springfield, IL" |
| `SSN` | "123-45-6789" |
| `CREDIT_CARD` | "4111 1111 1111 1111" |
| `API_KEY` | "sk-...", "Bearer eyJ..." |
| `IP_ADDRESS` | "192.168.1.100" |
| `DATE_OF_BIRTH` | "born January 15, 1980" |
| `COMPANY_INTERNAL` | User-defined sensitive org names |
| `CUSTOM` | User-defined regex or semantic rules |

### Variable Substitution Engine

Detected entities are replaced with deterministic, context-preserving placeholders:

```
Original:  "Draft an NDA between Acme Corp and John Smith (john@acme.com)."
Sanitized: "Draft an NDA between {{COMPANY_0}} and {{PERSON_0}} ({{EMAIL_0}})."
```

The substitution map is held in memory for the duration of the session:

```json
{
  "COMPANY_0": "Acme Corp",
  "PERSON_0": "John Smith",
  "EMAIL_0": "john@acme.com"
}
```

Placeholders are:
- **Type-prefixed** — the LLM understands what kind of entity it's working with
- **Indexed** — multiple entities of the same type get distinct variables
- **Consistent within a session** — the same value always maps to the same variable, so LLM reasoning stays coherent across multi-turn conversations

### Request Interception and Transformation

GuiltySpark intercepts the outbound request before it reaches the LLM API, transforms the message payload (system prompt, user messages, tool results), and forwards the sanitized version. The LLM sees only placeholders.

### Response Decoding

The LLM's response comes back referencing placeholders. GuiltySpark runs a reverse substitution pass, restoring all `{{VAR_N}}` tokens to their original values before returning the response to the user.

```
LLM response:  "Here is a draft NDA between {{COMPANY_0}} and {{PERSON_0}}..."
Decoded:       "Here is a draft NDA between Acme Corp and John Smith..."
```

### MCP Server Integration

GuiltySpark exposes itself as an [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server. This means it can plug directly into Claude Desktop, Cursor, or any MCP-compatible client as a tool layer — no proxy configuration or SDK changes required.

### User-Configurable Privacy Rules

Users control what gets protected:

```yaml
# guiltyspark.config.yaml
protect:
  - PERSON_NAME
  - EMAIL
  - PHONE
  - API_KEY
  - custom:
      - pattern: "Project (Nightingale|Falcon|Atlas)"
        label: CODENAME
      - pattern: "\\b10\\.0\\.\\d+\\.\\d+\\b"
        label: INTERNAL_IP

allow:
  - COMPANY_NAME   # you're OK sending your company's name
  - PUBLIC_URL     # public-facing URLs are fine

passthrough_if_local: true   # skip sanitization for local/self-hosted LLMs
```

### Session-Scoped Variable Maps

Variable maps are ephemeral by default — stored only in process memory for the lifetime of the session and discarded on exit. No substitution history is written to disk unless the user explicitly opts in (e.g., for debugging or auditing purposes).

---

## How It Works

High-level request flow:

```
User Prompt
    │
    ▼
┌─────────────────────────────────────────┐
│              GuiltySpark                │
│                                         │
│  1. Receive prompt                      │
│  2. Run Ollama detection locally        │
│  3. Build / update substitution map     │
│  4. Replace entities with placeholders  │
│  5. Forward sanitized prompt to LLM API │
│                                         │
│  6. Receive LLM response                │
│  7. Reverse-substitute placeholders     │
│  8. Return decoded response to user     │
└─────────────────────────────────────────┘
    │                         ▲
    │ sanitized prompt         │ decoded response
    ▼                         │
LLM Provider API (Anthropic, OpenAI, ...)
```

The Ollama step (2–4) runs entirely on-device and completes before any network call is made.

---

## Potential Architectures

Three viable approaches exist, each with different tradeoffs around compatibility, complexity, and deployment.

---

### Architecture A: MCP Server

GuiltySpark runs as an MCP server. The client (e.g., Claude Desktop) routes its LLM interactions through GuiltySpark as a tool/middleware layer.

**Data Flow:**

```
Claude Desktop (or other MCP client)
    │
    │  MCP protocol (stdio or SSE)
    ▼
GuiltySpark MCP Server
    ├── Ollama (local, entity detection)
    │
    │  Sanitized HTTPS request
    ▼
Anthropic / OpenAI API
    │
    │  Response with placeholders
    ▼
GuiltySpark (reverse substitution)
    │
    │  Decoded response via MCP
    ▼
Claude Desktop
```

**Pros:**
- No system-level proxy configuration — works within existing MCP tooling
- Native integration with Claude Desktop, Cursor, and other MCP-aware clients
- Can expose additional tools (e.g., "what was redacted?", "show substitution map")
- Clean separation of concerns — GuiltySpark is a first-class MCP participant
- Can intercept tool call inputs/outputs, not just chat messages

**Cons:**
- Only works with MCP-compatible clients — doesn't help with curl, raw SDK usage, or web interfaces
- Requires the client to route through GuiltySpark (opt-in per client, not transparent)
- MCP protocol adds a thin layer of overhead vs. direct API calls
- Clients that batch or parallelize requests internally may bypass the MCP layer for some calls

**Best for:** Users already in the Claude Desktop / Cursor / MCP ecosystem who want plug-and-play privacy.

---

### Architecture B: Local HTTP Proxy

GuiltySpark runs as a local HTTP proxy (e.g., on `localhost:8080`). Any HTTP client — SDK, curl, browser extension, desktop app — routes through it by setting standard proxy environment variables or proxy settings.

**Data Flow:**

```
Any HTTP client (SDK, curl, browser, app)
    │
    │  HTTP/HTTPS  →  proxy: localhost:8080
    ▼
GuiltySpark Proxy Server (localhost:8080)
    ├── Ollama (local, entity detection)
    │
    │  HTTPS CONNECT / forwarded request (sanitized)
    ▼
Anthropic / OpenAI API  (api.anthropic.com, api.openai.com, ...)
    │
    │  Response with placeholders
    ▼
GuiltySpark (reverse substitution, response rewrite)
    │
    │  Decoded response
    ▼
HTTP client
```

For HTTPS interception, GuiltySpark acts as a MITM proxy with a locally-trusted self-signed CA certificate (similar to tools like mitmproxy or Charles Proxy). The user installs the CA cert once; all subsequent LLM HTTPS traffic is transparently interceptable.

**Pros:**
- Works with any HTTP client — no SDK changes, no client-side integration required
- Transparent to the application layer; just set `HTTPS_PROXY=localhost:8080`
- Covers curl, Python scripts, Node apps, browser extensions — anything that respects proxy settings
- Can be scoped to specific domains (only intercept `api.anthropic.com`, etc.)

**Cons:**
- Requires installing a local CA certificate (non-trivial for some users, raises trust questions)
- HTTPS MITM is technically complex and easy to get wrong (cert pinning, TLS quirks)
- Proxy settings must be configured per-environment (shell, IDE, app-level)
- Hard to handle clients that pin certificates or use custom TLS stacks
- Higher attack surface: a compromised local proxy is a blanket MITM on LLM traffic

**Best for:** Power users who want system-wide coverage across multiple tools and languages without modifying each application.

---

### Architecture C: SDK Wrapper

GuiltySpark ships as a drop-in SDK wrapper for popular LLM client libraries. Users replace `new Anthropic()` or `new OpenAI()` with `new GuiltySpark({ provider: 'anthropic' })` and get the same API surface with privacy middleware applied.

**Data Flow:**

```
User application code
    │
    │  GuiltySpark SDK (wraps Anthropic/OpenAI SDK)
    ▼
GuiltySpark middleware (in-process)
    ├── Ollama HTTP client (localhost:11434)
    │
    │  HTTPS (sanitized request)
    ▼
Anthropic / OpenAI API
    │
    │  Response with placeholders
    ▼
GuiltySpark middleware (reverse substitution)
    │
    │  Decoded response object
    ▼
User application code
```

**Pros:**
- No proxy, no certificates, no system config — just swap the import
- Privacy logic runs in-process; the wrapper is the full boundary
- Easy to test and reason about — middleware is explicit in the call stack
- Type-safe: wrapping the official SDKs means the same TypeScript types flow through
- Streaming support is naturally contained within the wrapper's response handling

**Cons:**
- Requires code changes — not transparent to existing applications
- Must maintain wrappers for each SDK (Anthropic, OpenAI, Cohere, etc.) as their APIs evolve
- Doesn't help with no-code tools, browser-based interfaces, or curl usage
- In-process Ollama calls add latency within the SDK call, which may affect timeout handling

**Best for:** Developers building new applications or services and want privacy baked into their codebase from the start.

---

### Architecture Comparison

| | MCP Server | Local Proxy | SDK Wrapper |
|---|---|---|---|
| **Setup complexity** | Low | High | Low |
| **Client compatibility** | MCP clients only | Any HTTP client | Supported SDKs only |
| **Code changes required** | None (client config) | None (proxy config) | Yes (import swap) |
| **HTTPS cert required** | No | Yes | No |
| **Streaming support** | Via MCP | Complex | Natural |
| **Tool call coverage** | Full | Full | Full |
| **Multi-language support** | Via MCP protocol | Yes | Per-SDK |
| **Attack surface** | Low | Medium | Low |
| **Best starting point** | Yes | Later | Yes |

**Recommended starting point:** Build Architecture A (MCP Server) first — it has the lowest setup friction, targets the most natural user base (Claude Desktop), and the MCP protocol gives clean hooks for intercepting both messages and tool calls. Architecture C (SDK Wrapper) is a natural second phase for developer adoption. Architecture B (Proxy) is the most powerful but most complex; treat it as a stretch goal.

---

## Tech Stack

### Runtime

- **Node.js** (v20+) with **TypeScript** — strong typing for substitution maps, entity schemas, and MCP protocol types; excellent ecosystem for HTTP and stream handling
- **[Ollama](https://ollama.ai)** — local model inference; GuiltySpark talks to the Ollama REST API (`localhost:11434`). No GPU required for smaller models; `phi3` or `llama3.2:3b` are good candidates for NER tasks at low latency

### Key Dependencies

| Package | Purpose |
|---|---|
| `@anthropic-ai/sdk` | Type definitions and client for Anthropic API passthrough |
| `openai` | Type definitions and client for OpenAI API passthrough |
| `@modelcontextprotocol/sdk` | MCP server implementation |
| `ollama` | Ollama Node.js client (`localhost:11434`) |
| `zod` | Schema validation for config, entity types, substitution maps |
| `hono` or `fastify` | Lightweight HTTP server for proxy architecture |
| `node-forge` or `@peculiar/webcrypto` | TLS/cert handling for proxy architecture |

### Ollama Model Selection

For entity detection, GuiltySpark needs a model that can perform Named Entity Recognition (NER) reliably within a tight latency budget (target: <200ms for typical prompts).

Candidate models:

| Model | Size | NER Quality | Latency | Notes |
|---|---|---|---|---|
| `phi3:mini` | 3.8B | Good | Fast | Best default for most machines |
| `llama3.2:3b` | 3B | Good | Fast | Strong instruction following |
| `mistral:7b` | 7B | Better | Moderate | Better for complex/ambiguous cases |
| `llama3.1:8b` | 8B | Best | Moderate | Most accurate, needs more RAM |

GuiltySpark will send a structured prompt to the local Ollama model asking for entity spans and classifications, then parse the JSON response to build the substitution map.

---

## Privacy Guarantees

### What Stays Local

- The original (unsanitized) prompt — never transmitted to LLM APIs
- The substitution map (variable → original value) — in process memory only
- Entity detection inference — runs entirely within Ollama on-device
- Configuration files — stored locally, never synced

### What Gets Sent to LLM APIs

- The sanitized prompt with placeholders (e.g., `{{PERSON_0}}`, `{{EMAIL_0}}`)
- Standard API metadata (model name, temperature, etc.)
- Nothing that GuiltySpark classifies as sensitive under your configured rules

### What GuiltySpark Does NOT Do

- GuiltySpark does not log prompts, responses, or substitution maps to disk by default
- GuiltySpark does not phone home, send telemetry, or contact any remote service other than your configured LLM provider
- GuiltySpark does not train on your data
- GuiltySpark does not persist sessions across restarts unless you explicitly enable session persistence

### Session Persistence (opt-in)

If you enable `persist_sessions: true` in config, GuiltySpark will write session substitution maps to a local encrypted file so that variable consistency is maintained across app restarts. The encryption key is derived from a user-supplied passphrase; GuiltySpark never stores the key.

---

## Configuration

```yaml
# ~/.config/guiltyspark/config.yaml

ollama:
  host: "http://localhost:11434"
  model: "phi3:mini"          # model used for entity detection
  timeout_ms: 2000            # abort detection if Ollama takes too long

# Protection rules — what to redact
protect:
  categories:
    - PERSON_NAME
    - EMAIL
    - PHONE
    - ADDRESS
    - SSN
    - CREDIT_CARD
    - API_KEY
    - IP_ADDRESS
    - DATE_OF_BIRTH
  custom:
    - label: CODENAME
      pattern: "\\bProject (Nightingale|Falcon|Atlas)\\b"
    - label: INTERNAL_DOMAIN
      pattern: "\\b[a-z0-9-]+\\.internal\\b"

# Categories to explicitly pass through unredacted
allow:
  - PUBLIC_URL

# Session behavior
session:
  persist: false              # set true to persist maps across restarts
  scope: "conversation"       # "conversation" | "request" (reset map per-request)

# Which LLM providers to relay to
providers:
  anthropic:
    enabled: true
    api_key_env: "ANTHROPIC_API_KEY"
  openai:
    enabled: true
    api_key_env: "OPENAI_API_KEY"

# MCP server settings (Architecture A)
mcp:
  enabled: true
  transport: "stdio"          # "stdio" | "sse"
  sse_port: 3000              # only used if transport is "sse"

# Proxy settings (Architecture B)
proxy:
  enabled: false
  port: 8080
  intercept_domains:
    - "api.anthropic.com"
    - "api.openai.com"
  ca_cert_path: "~/.config/guiltyspark/ca.crt"
  ca_key_path: "~/.config/guiltyspark/ca.key"
```

---

## Threat Model

### In Scope (GuiltySpark protects against)

- **Accidental PII leakage** — users pasting sensitive data into prompts without realizing it
- **LLM provider data retention** — providers logging or training on prompts containing sensitive content
- **Passive network interception** — anyone observing the HTTPS stream to the LLM API sees only placeholders
- **LLM provider data breach** — if provider logs are exfiltrated, they contain only sanitized placeholders

### Out of Scope (GuiltySpark does NOT protect against)

- **Compromised local machine** — if your machine is compromised, the in-memory substitution map and the Ollama process are both accessible. GuiltySpark is not a security tool for adversarial local environments.
- **Sensitive data in LLM responses** — if the LLM infers or reconstructs sensitive data from context, GuiltySpark cannot detect or redact that. The substitution approach is effective when the LLM reasons about placeholders rather than their values.
- **Metadata leakage** — prompt length, timing, and request patterns may reveal information. GuiltySpark does not add padding or timing noise.
- **Deliberate exfiltration by the user** — GuiltySpark cannot stop a user from intentionally sending unredacted data.
- **Ollama model errors** — if the local model misses a sensitive entity (false negative), that data will be sent in the clear. Confidence thresholds and fallback regex rules are mitigations, not guarantees.
- **Side-channel attacks** — placeholder names like `PERSON_0` reveal that a person's name was present in the prompt, even if the name itself is redacted.

### Trust Boundaries

```
┌─────────────────────────────────────────────────────┐
│  TRUSTED (local machine)                            │
│                                                     │
│  User  ←→  GuiltySpark  ←→  Ollama                 │
│              ↕ (in-memory substitution map)         │
│         Config files, optional session store        │
└─────────────────────────────────────────────────────┘
                      │
                      │  Sanitized prompts only
                      ▼
┌─────────────────────────────────────────────────────┐
│  UNTRUSTED (external)                               │
│                                                     │
│  Anthropic API / OpenAI API / other LLM providers   │
└─────────────────────────────────────────────────────┘
```

---

## Project Status

This project is in the **design and architecture phase**. The README represents the intended design. No code has been written yet.

Planned milestones:

- [ ] Core substitution engine (entity map, placeholder generation, reverse substitution)
- [ ] Ollama integration for local NER
- [ ] Architecture A: MCP Server implementation
- [ ] Config file parsing and validation
- [ ] Architecture C: SDK Wrapper (Anthropic + OpenAI)
- [ ] Architecture B: Local HTTP Proxy
- [ ] CLI for inspecting sessions and substitution maps
- [ ] Test suite with synthetic PII datasets

---

*Named after 343 Guilty Spark — the Halo monitor tasked with containing what should never be released. Unlike him, this one actually does its job.*
