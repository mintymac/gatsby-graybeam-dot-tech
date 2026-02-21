---
title: "Blockchain Credential Anchoring: What We Actually Built and Why It Matters"
category: "Engineering"
author: McHughson Chambers
date: 2026-02-21
---

A physician shows up at a hospital for a locum tenens assignment. The hospital asks: "Is your license active?" The physician says yes. The hospital calls the state medical board, waits on hold for 20 minutes, gets transferred twice, and eventually confirms the license is valid. Then they do the same for DEA registration. Then board certification. Then CAQH attestation. Then malpractice insurance.

This process costs $2.50 to $15 per verification query, takes days to weeks, and relies entirely on institutional trust — phone calls, faxes, and proprietary databases that don't talk to each other. Primary Source Verification (PSV) exists because credentials are trivially forgeable. The entire trust chain is: provider says "I have this credential" → credentialing software says "we checked" → hospital says "we trust them." Every link is "trust me."

What if the credential itself carried mathematical proof of its authenticity? Not a PDF. Not an attestation letter. Proof that a specific piece of data existed in a specific form at a specific time, signed by a specific key, recorded on a public ledger that nobody controls.

That's what we built.

## The Problem with Credential Trust

Healthcare credentialing is a paper-based trust system running on digital infrastructure. A credential is only as trustworthy as the institution vouching for it. When CredentialVault stores a provider's medical license, the provider is trusting us to store it accurately. When a hospital queries that credential, they're trusting both us and the provider. Nobody can independently verify that the data hasn't been altered since it was recorded.

This isn't hypothetical. Credential fraud exists. More commonly, credentials get updated and the audit trail is opaque. When did this license status change? Was this expiration date always what it says? Who modified this record and when? Traditional databases can answer these questions — if you trust the database administrator. If you trust the backup policy. If you trust that nobody with production access modified a row.

What we actually want is simpler: **mathematical proof that a piece of data hasn't been tampered with, timestamped by a system that nobody — including us — can manipulate.**

## What We Built

The system has three layers: signing, anchoring, and verification.

### Signing: Prove Who Recorded It

When a credential is created or updated in CredentialVault, the system immediately signs it:

1. **Canonical serialization.** The credential's fields are sorted alphabetically and concatenated into a deterministic string. Same data always produces the same string, regardless of JSON key ordering or database row order.

```
expiration_date=2027-06-30
issue_date=2024-07-01
issuing_body=California Medical Board
license_number=A-123456
...
status=active
type=state_license
```

2. **SHA-256 hash.** The canonical string is hashed to produce a 32-byte fingerprint. Change one character in the credential data and the hash is completely different.

3. **Ed25519 signature.** The hash is signed with the provider's private key. This proves which key produced the signature — and by extension, which provider's credential it represents.

This happens synchronously on every credential write. The `content_hash`, `signature`, and `signed_at` timestamp are stored on the credential record. At this point, we can already verify integrity — re-hash the data, check the signature, confirm it matches. But the timestamp is still our timestamp. We could lie about when it happened.

### Anchoring: Prove When It Happened

This is where the blockchain comes in. After signing, an Oban background worker submits a **0-ALGO self-payment transaction** to Algorand's testnet. The transaction is a payment of zero ALGO from our platform wallet to itself. The interesting part is the **note field**, which carries a JSON payload:

```json
{
  "v": 1,
  "hash": "a1b2c3...",
  "sig": "base64-encoded-signature",
  "ts": "2026-02-21T14:30:00Z",
  "meta": {
    "app": "credentialvault",
    "type": "state_license",
    "provider_id": "uuid-here",
    "credential_id": "uuid-here"
  }
}
```

The hash and signature from step one are now embedded in a public blockchain transaction with an immutable timestamp. Algorand achieves finality in under 4 seconds. Once confirmed, nobody can alter or backdate that record — not us, not an attacker with database access, not anyone.

Cost: approximately $0.0002 per transaction. Network minimum fee only.

### Verification: Prove It's Unchanged

Verification is the point of the whole system. Anyone with the credential data can:

1. Re-serialize the credential fields canonically
2. Re-hash with SHA-256
3. Compare against the stored `content_hash`
4. Verify the Ed25519 signature against the provider's public key
5. Look up the transaction on Algorand's public explorer and confirm the hash matches

No trust required. No API key. No account. The data, the math, and the public ledger are sufficient.

In CredentialVault, verification runs on every credential read. The API response includes an `integrity_status` field — `verified`, `unsigned`, `tampered`, or `invalid_signature` — alongside an `explorer_url` that links directly to the Algorand transaction.

## What We Learned About Algorand

We chose Algorand for practical reasons: sub-second finality, negligible transaction costs, no smart contracts required, and — crucially — it uses Ed25519 natively, which means OTP 27's `:crypto` module speaks the same cryptographic language without external dependencies. Here's what we learned building on it.

### Msgpack Canonical Encoding Matters

Algorand transactions are encoded in MessagePack (msgpack), a binary serialization format. Algorand requires **strict alphabetical key ordering** — the transaction fields must be sorted by key name before encoding. Standard msgpack libraries don't guarantee ordering, and most explicitly don't preserve it.

We had to build custom canonical encoding:

```elixir
defp encode_canonical_map(sorted_pairs) do
  count = length(sorted_pairs)
  header = if count <= 15, do: <<0x80 + count>>, else: <<0xDE, count::16>>
  body = for {k, v} <- sorted_pairs, into: <<>> do
    Msgpax.pack!(k) <> encode_value(v)
  end
  header <> body
end
```

The fields must appear in this exact order: `fee`, `fv`, `gen`, `gh`, `lv`, `note`, `rcv`, `snd`, `type`. Get one field out of order and the transaction signature is invalid. This isn't documented clearly in Algorand's developer docs — we figured it out from the Go SDK source code and a lot of failed transactions.

### Transaction Structure Is Simple Once You Understand It

A 0-ALGO payment to yourself is the cheapest possible Algorand transaction. The structure:

| Field | Value |
|-------|-------|
| `type` | `"pay"` (payment) |
| `snd` | Platform wallet address |
| `rcv` | Same address (self-payment) |
| `amt` | 0 microAlgos |
| `fee` | Network minimum (~1000 microAlgos) |
| `note` | Your payload (up to 1KB) |
| `fv`/`lv` | Valid round window |
| `gen`/`gh` | Network identifier (testnet) |

No smart contracts. No ABI. No opcodes. No token standards. Just a payment transaction with a note. This is intentional — the simpler the on-chain interaction, the fewer things can go wrong.

### The Signing Prefix Is Everything

Algorand transaction signing requires a domain separation prefix: the raw bytes `"TX"` prepended to the canonical msgpack encoding before signing.

```elixir
message = "TX" <> canonical_msgpack_encode(txn_fields)
signature = :crypto.sign(:eddsa, :none, message, [private_key, :ed25519])
```

Miss the `"TX"` prefix and every signature is silently invalid. The transaction submits successfully but gets rejected during consensus. This cost us several hours of debugging because the error message from the API node was `"transaction already in ledger"` — unhelpful for a signature problem.

### Ed25519 Is Native to Both Elixir and Algorand

This was the biggest architectural win. OTP 27's `:crypto` module supports Ed25519 natively:

```elixir
# Key generation
{pub, priv} = :crypto.generate_key(:eddsa, :ed25519)

# Signing
signature = :crypto.sign(:eddsa, :none, message, [private_key, :ed25519])

# Verification
:crypto.verify(:eddsa, :none, message, signature, [public_key, :ed25519])
```

No NIF bindings. No Rust extensions. No `libsodium` dependency. Pure OTP cryptography that produces signatures Algorand accepts directly. The same key pair works for both our internal credential signing and Algorand transaction signing.

### Algorand Address Encoding Has a Subtle Checksum

An Algorand address is the public key (32 bytes) + a 4-byte checksum, Base32-encoded without padding. The checksum is the **last 4 bytes of SHA-512/256** of the public key — not SHA-256, not SHA-512. SHA-512/256 is a specific FIPS 180-4 variant that OTP 27 doesn't expose directly, so we implemented it from the spec. Get the hash function wrong and the address looks valid but the network rejects it.

### Testnet Is Free and Fast

Algorand's testnet has a faucet for development tokens, public API nodes (we use nodely.dev), and sub-5-second confirmation times. Our background confirmation worker polls every 5 minutes, but transactions are typically confirmed in the first poll after submission. Zero infrastructure cost during development — no nodes to run, no tokens to buy, no accounts to register.

## Honest Assessment: When This Matters and When It Doesn't

### What It Proves

Blockchain anchoring proves that **specific data existed in a specific form at a specific time.** Once a credential's hash is confirmed on Algorand, nobody can:

- **Backdate it.** The blockchain timestamp is independent of our system clock.
- **Alter it silently.** Any change to the credential data produces a different hash. The original hash on-chain becomes evidence of tampering.
- **Deny it existed.** The transaction is on a public ledger with thousands of nodes.

For credential management, this matters. When a hospital asks "was this license recorded as active on February 21st?", the answer isn't "our database says so" — it's "the Algorand blockchain says so, here's the transaction, verify it yourself."

### What It Doesn't Prove

Blockchain anchoring does **not** prove the underlying credential is real. We can prove that CredentialVault recorded "Dr. Smith has an active California medical license, number A-123456, expiring 2027-06-30" at 2:47 PM on February 21, 2026. We cannot prove the California Medical Board actually issued that license.

The chain of trust still starts with a human entering data or an API integration pulling it. The blockchain proves we haven't altered the record since it was created — not that the record was accurate when it was created.

### Where This Gets Powerful

The real value emerges when blockchain anchoring combines with **Primary Source Verification**. CredentialVault already integrates with FSMB (Federation of State Medical Boards) for license lookups and OIG LEIE for exclusion checking. When a credential is verified at the source and *then* anchored on-chain, the anchor proves the verification result:

*"We queried FSMB at 14:30 UTC on Feb 21, 2026. The response confirmed license A-123456 is active through June 30, 2027. That response was hashed, signed, and recorded in Algorand transaction TXID-HERE."*

Now a third party can independently confirm: the hash matches, the signature is valid, the transaction timestamp is immutable. This is the **Credential Passport** — a portable, independently-verifiable credential record that any facility can check without trusting CredentialVault.

## Making Vault Reusable: Infrastructure, Not Just a Feature

The blockchain anchoring in CredentialVault isn't custom code. It's built on **Vault**, a standalone Elixir library that handles the entire cryptographic and chain interaction layer. CredentialVault's integration is about 150 lines of code — canonical serialization, a signing call, and an Oban worker. Everything else lives in the library.

### Current Architecture

Vault is a standalone Elixir application with:

- **`Vault.Crypto`** — Pure functions for Ed25519 key generation, signing, verification, SHA-256 hashing, and AES-256-GCM encryption. No database, no state, no side effects.
- **`Vault.Chain.Algorand`** — Transaction construction, canonical msgpack encoding, submission to Algorand's API, confirmation polling.
- **`Vault.Chain.Bitcoin`** — OP_RETURN transaction construction, SegWit P2WPKH signing (BIP143), submission via Mempool.space. Full dual-chain support.
- **`Vault.KeyManager`** — Encrypted key storage (AES-256-GCM with a master key from environment variable).

CredentialVault uses the crypto and chain modules directly:

```elixir
# In CredentialVault's integrity.ex
hash = Vault.Crypto.hash(canonical_data)
signature = Vault.Crypto.sign(hash, private_key, :algorand)

# Later, in the background worker
{:ok, txid} = Vault.Chain.Algorand.anchor(hash, signature, metadata, priv, pub)
```

The integration pattern is clean: CredentialVault owns the domain logic (what a credential is, how to serialize it, when to anchor). Vault owns the cryptographic proof layer (how to hash, sign, anchor, and verify).

### What This Means for Other Projects

Any Phoenix application can add Vault as a dependency and get blockchain anchoring. The pattern is:

1. Define your domain's canonical serialization (how to deterministically represent the data you want to prove)
2. Call `Vault.Crypto.hash/1` and `Vault.Crypto.sign/3` synchronously on write
3. Call `Vault.Chain.Algorand.anchor/5` asynchronously (via Oban or Task)
4. Call `Vault.Crypto.verify/4` on read

Two environment variables (`VAULT_MASTER_KEY` for key encryption, platform private key for chain operations) and you're anchoring data on Algorand.

The use cases extend well beyond healthcare: legal document timestamping, audit log integrity, supply chain provenance records, academic transcript verification, insurance claim anchoring. Anywhere you need to prove "this data existed in this form at this time and hasn't been changed since."

### The Path to a Proper Library

Today, Vault is a git dependency. The path to a hex package is straightforward:

1. Extract `Vault.Crypto` and `Vault.Chain.*` into a standalone package — no Ecto, no SQLite, no Phoenix dependency
2. Let consuming apps bring their own persistence (Ecto, Mnesia, ETS, whatever)
3. Publish as `{:vault, "~> 0.1"}` on Hex

The goal: any Elixir application can add one dependency and get blockchain-anchored data integrity in an afternoon. Not because "blockchain" is a marketing buzzword, but because mathematical proof is better than institutional trust, and the tooling should make that accessible.

## The PDF Analogy

Two days ago, I wrote about [stopping PDF generation](/blog/stop-generating-pdfs) because the format was wrong for the job. Blockchain anchoring is the inverse — adding a technology because it's genuinely the right tool for the problem.

PDFs pretend to be trustworthy by looking official. Blockchain anchors are actually trustworthy because the math checks out. PDFs require you to trust the system that generated them. Blockchain anchors require you to trust SHA-256 and Ed25519 — which, respectively, secure every HTTPS connection on the internet and every SSH key on your laptop.

We're not adding blockchain because it's fashionable. We're adding it because healthcare credentialing is a $2 billion industry built on phone calls and faxes, and the providers caught in the middle deserve better than "trust me."

---

The anchoring system is live in production at [vault.graybeam.tech](https://vault.graybeam.tech). Every credential created or updated is signed immediately and anchored on Algorand's testnet within seconds. The explorer links are in the API response. Verify them yourself — that's the whole point.

---

*Built with Elixir, OTP 27, Algorand testnet, and the conviction that mathematical proof beats institutional trust.*

**Version**: 1.0
**Classification**: Public
**Timestamp**: 2026-02-21T22:00:00Z
