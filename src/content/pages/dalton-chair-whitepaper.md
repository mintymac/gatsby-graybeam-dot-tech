---
title: "Dalton Chair Whitepaper: Protocol Specification 1.1"
---

This is the published whitepaper edition of **DCSPEC-1.1**, the draft Dalton
Chair protocol standard. The canonical specification is maintained in the
[GrayPress repository](https://gitlab.com/graybeam/graypress/-/blob/main/docs/dalton-chair-spec.md).
Normative requirements begin below and retain the language and test vectors of
the source specification.

**Version:** 1.1 (DCSPEC-1.1)
**Status:** Draft Standard — GrayBeam
**Reference implementation:** GrayPress (`lib/graypress/dalton_chair*`)
**Independent verifier:** `mix graypress.audit`

---

## Abstract

Dalton Chair is a protocol for verifiable web application integrity: proving
that the code a server serves is byte-identical to the code a known signer
signed. This document is the normative contract. It is written so that an
implementation can be produced — a signing pipeline, a boot verifier, a
client-side verifier, or an independent auditor — without reading the
reference implementation's source code.

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD",
"SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be
interpreted as described in RFC 2119 / RFC 8174.

---

## 1. Introduction

### 1.1 Roles

The protocol distinguishes four roles. Conflating them is the most common
way integrity schemes fail.

- **Signer** — holds the Ed25519 private key and signs manifests at build
  time. The signer SHOULD be isolated from build and production
  infrastructure (air-gapped machine or HSM).
- **Operator** — runs the server that serves the application. The operator
  is *not trusted* by the protocol; the protocol exists because the
  operator may be compromised or coerced.
- **Verifier** — checks the integrity of running or received code. The
  server at boot and the browser at runtime are both verifiers.
- **Auditor** — a verifier with no relationship to the operator, checking
  a live server from outside. Auditors provide the protocol's primary
  security property: public detectability of modification.

**Axiom (the air-gap principle):** a verifier MUST NOT trust the system it
is verifying. Every procedure below is designed around this axiom.

### 1.2 Trust properties

A correct deployment provides:

1. **Tamper evidence** — any post-signing modification of covered artifacts
   is detectable by verifiers.
2. **Signer accountability** — every accepted manifest is bound to a
   specific Ed25519 key.
3. **Public auditability** — third parties can verify a live server without
   cooperation from the operator.

The protocol does not prevent modification; it makes modification
detectable. See Section 12.

---

## 2. The Manifest

The manifest is the single signed artifact. It is a JSON object with
exactly the following fields. All values are JSON strings.

| Field | Required | Description |
|---|---|---|
| `app` | MUST | Application identifier (e.g. `"graypress"`). |
| `version` | MUST | Application version, opaque string. |
| `git_commit` | MUST | Source control commit identifier. `"unknown"` if unavailable. |
| `release_hash` | MUST | Lowercase hex SHA-256 of the server artifact set, per a registered hash profile (Section 5). |
| `crypto_js_hash` | MUST | Lowercase hex SHA-256 of the exact JavaScript bundle bytes served to clients. |
| `signer_public_key` | MUST | Base64 (standard alphabet, with padding) of the 32-byte Ed25519 public key. |
| `signed_at` | MUST | RFC 3339 UTC timestamp. |
| `dalton_chair_version` | MUST | Protocol version. This document: `"1.1"`. |
| `signature` | MUST | Base64 (standard alphabet, with padding) of the 64-byte Ed25519 signature. |

A manifest containing additional fields is not conforming. Parsers
encountering additional top-level fields MUST reject the manifest as
`invalid_manifest` — silent tolerance of extra fields breaks signature
interop between strict and lenient implementations.

### 2.1 Example (informative)

```json
{
  "app": "example-app",
  "version": "1.0.0",
  "git_commit": "0123abc",
  "release_hash": "ebda9aa1…",
  "crypto_js_hash": "5312a064…",
  "signer_public_key": "v0Yo/imbkXscoAAgvjvTzZeFUvQ4Db0khDQ9XBkREkk=",
  "signed_at": "2026-01-01T00:00:00Z",
  "dalton_chair_version": "1.1",
  "signature": "3NpYdRpo…"
}
```

---

## 3. Canonicalization

Signing and verification operate over a canonical byte sequence, never over
the JSON text as stored or transmitted.

1. Remove the `signature` field from the manifest object.
2. Encode the remaining object with **JCS — JSON Canonicalization Scheme,
   RFC 8785**.

The result is the **canonical payload**. Because every manifest value is a
JSON string, any RFC 8785-conforming implementation produces byte-identical
output; there are no number, date, or nesting edge cases in the manifest
data model.

Implementations MUST NOT canonicalize any superset or subset of the
manifest fields. In particular, server status payloads (Section 7.4) add
derived fields (`verified`, `checks`, `signer_pinned`) that are NOT part of
the manifest; verifying a signature over such a payload MUST fail, and
verifiers MUST project the payload to exactly the Section 2 fields first.

---

## 4. Signing and Signature Verification

**Signing.** Given an Ed25519 private key (RFC 8032):

```
signature = Ed25519_sign(private_key, canonical_payload)
manifest.signature = base64(signature)
```

**Verification.** Given a manifest and a set of trusted signer keys:

1. `malformed_manifest` if any required field is absent, `signature` is
   absent, or base64 fields do not decode to the required lengths
   (32-byte public key, 64-byte signature).
2. `untrusted_signer` if the verifier has a pinned signer (Section 6) and
   `signer_public_key` is not equal to it. A verifier with no trusted
   anchor MUST treat the signature check as unauthenticated and MUST NOT
   report the manifest as verified.
3. Compute the canonical payload (Section 3) and
   `Ed25519_verify(public_key, canonical_payload, signature)`.
   Failure yields `invalid_signature`.

Note the ordering: a manifest can have a perfectly valid signature and
still be rejected as `untrusted_signer`. Signature validity and signer
trust are independent checks and MUST be reported independently.

---

## 5. Artifact Hash Profiles

A **hash profile** defines how a class of deployable artifact is reduced to
a single SHA-256. Profiles exist because "the release" and "the bundle" are
framework-specific shapes. The manifest fields `release_hash` and
`crypto_js_hash` are defined generically; their *construction* is
profile-specific.

The invariant every profile MUST satisfy: **build-time and runtime hashing
resolve the same artifact the deployed system actually executes or
serves.** Hashing a file that is not the executed/served one — including a
stale artifact in the same directory — is a profile violation. (This
violation occurred in production in the reference implementation when the
served bundle was selected by directory globbing rather than by the
framework's digest manifest.)

### 5.1 Profile: `beam-release` (for `release_hash`)

Applies to BEAM (Erlang/Elixir) releases.

1. Enumerate files ending in `.beam` in the application's `ebin` directory
   (build time: the release's `ebin`, post any BEAM stripping; runtime: the
   running application's `ebin`).
2. Sort filenames lexicographically (byte order).
3. Compute lowercase-hex SHA-256 of each file's bytes.
4. Concatenate the hex strings in order; compute lowercase-hex SHA-256 of
   the concatenated text.

Build-time hashing MUST occur after all release transformations (e.g.
`strip_beams`) so that build and runtime hash the same bytes.

### 5.2 Profile: `static-bundle` (for `crypto_js_hash`)

1. Resolve the JavaScript bundle the server serves to clients. The
   resolution MUST follow the framework's authoritative digest manifest
   (for Phoenix: `cache_manifest.json`, key `latest["assets/js/app.js"]`),
   not directory enumeration. Fallback enumeration is permitted only when
   no digest manifest exists and MUST be logged.
2. Compute lowercase-hex SHA-256 of the file's bytes.

### 5.3 Profile registry

This document registers `beam-release` and `static-bundle`. New profiles
MAY be defined by implementation communities; profile behavior MUST be
deterministic, documented, and reproducible by third parties.

---

## 6. Trust Anchors

A verifier establishes the expected signer through a **trust anchor**.
Defined mechanisms, in descending strength:

1. **Compile-time pin (first-party servers).** The expected
   `signer_public_key` is embedded in the server artifact at build time.
   Because the artifact hash covers the artifact carrying the pin, the pin
   cannot be altered post-deployment without invalidating the manifest, and
   the manifest cannot be re-signed without the private key. First-party
   boot verifiers SHOULD use this mechanism.
2. **On-chain registry (Section 9).** The expected key and signed hashes
   are read from a public, append-only store independent of the operator.
3. **Well-known publication.** The signer publishes their public key at a
   location they control independently of the operator (e.g. the signer's
   domain, keyserver, or source repository). Suitable for auditors.

A verifier MUST record which anchor it used and MUST NOT silently substitute
one anchor for another.

---

## 7. Verification Procedures

### 7.1 Boot verification (first-party)

On startup, before accepting traffic:

1. Load the manifest co-located with the release (for `beam-release`:
   `priv/dalton_chair.json` inside the application directory). Absence
   yields `no_manifest`; unparseable content yields `invalid_manifest`.
2. Verify the signature per Section 4 against the compile-time pinned
   signer (Section 6.1).
3. Recompute `release_hash` and `crypto_js_hash` per the applicable
   profiles and compare. Mismatches yield `release_hash_mismatch` /
   `crypto_js_hash_mismatch`.
4. Behavior on failure is governed by the operational mode (Section 8).

### 7.2 Client verification (browser)

1. Obtain the expected `crypto_js_hash` from a trust anchor that is not the
   operator — in the current protocol level, this is the hard problem
   documented in Section 12.2. Implementations MAY fetch the operator's
   `/dalton-chair` status as an *advisory* source, but MUST NOT present
   the result as operator-independent verification.
2. Hash the bundle bytes actually received (WebCrypto `digest('SHA-256')`,
   lowercase hex) and compare.
3. On confirmed mismatch, implementations that handle secret key material
   SHOULD refuse to use it and SHOULD surface the failure to the user.

### 7.3 Independent audit

An auditor verifies a live server without trusting it:

1. Fetch `GET {base}/dalton-chair` (the status payload).
2. Fetch the served HTML and extract the digested bundle URL from the
   `<script src>` referencing the application bundle. Asset URLs may carry
   cache-busting query strings; match on the URL path.
3. Fetch the bundle and compute lowercase-hex SHA-256 of its bytes.
4. Project the status payload to the Section 2 manifest fields (Section 3).
5. Verify: signature valid (Section 4); `signer_public_key` equals the
   auditor's trust anchor; bundle hash equals `crypto_js_hash`.
6. The auditor MUST ignore the status payload's self-reported `verified`
   and `checks` fields — they are the operator grading its own homework.
7. The audit MUST produce an unambiguous pass/fail result suitable for
   automation (the reference auditor exits non-zero on failure).

### 7.4 Status endpoint (operator self-report)

Operators MUST expose `GET /dalton-chair` returning the manifest fields
plus derived fields:

- `verified` (boolean) — conjunction of the three checks
- `checks` — per-check booleans: `signature`, `release_hash`,
  `crypto_js_hash`
- `signer_pinned` (boolean) — whether a compile-time pin is active

On failure to load a manifest: `{ "verified": false, "reason": <code> }`.

The derived fields are informational only; Section 7.3 defines how they are
treated by verifiers (they are not).

---

## 8. Operational Modes

- **Strict mode.** Any boot verification failure (including `no_manifest`)
  MUST prevent the server from starting. RECOMMENDED for production.
- **Advisory mode.** Failures are logged and exposed via the status
  endpoint; the server starts. Appropriate for development and test.

The mode MUST be a deliberate deployment decision, not an accidental
default.

---

## 9. On-Chain Registration (Layer 2)

Registration publishes each signed manifest to a public, append-only store
at deploy time. The registry is the trust anchor that makes the operator
unable to silently revise history.

### 9.1 Registry requirements

A conforming registry MUST be: **immutable** (records cannot be altered
without a new publicly visible transaction), **public** (readable by anyone
without permission), and **independent** (not operated by the application
operator).

### 9.2 Record format

- **Key:** `dalton:{app}:{version}` (UTF-8). One record per version;
  successive versions accumulate as the public history.
- **Value:** the manifest (Section 2) as a JSON object. Signature
  verification re-canonicalizes from the fields, so storage formatting is
  not normative.

### 9.3 Registry profile: `algorand-box`

The reference registry uses Algorand application box storage.

- Box name: the Section 9.2 key.
- Box value: the Section 9.2 value.
- Read path (public, no authentication):
  `GET {algod}/v2/applications/{app-id}/box?name=b64:{base64(box-name)}`,
  using the standard padded base64 alphabet (not base64url).
- Registration MUST complete before the new release is activated.

Other chains or transparency logs MAY be registered as additional profiles
if they satisfy Section 9.1.

### 9.4 Client discovery (informative)

Clients and auditors need the registry application identifier and network.
These parameters are not secret, but a client served them by the operator
could be redirected to an attacker-controlled registry application; this is
part of the extension gap (Section 12.2). Auditors SHOULD obtain registry
parameters from an independent trust anchor (Section 6).

---

## 10. Error Vocabulary

Conforming implementations MUST use these reason codes:

| Code | Meaning |
|---|---|
| `no_manifest` | No manifest found at the expected location. |
| `invalid_manifest` | Manifest unparseable, contains additional fields, or uses an unknown protocol version. |
| `malformed_manifest` | Required fields absent or structurally invalid (bad base64, wrong key/signature lengths). |
| `invalid_signature` | Signature does not verify for the manifest's signer. |
| `untrusted_signer` | Signer differs from the verifier's trust anchor. |
| `release_hash_mismatch` | Running artifact set hash differs from manifest. |
| `crypto_js_hash_mismatch` | Served bundle hash differs from manifest. |
| `manifest_unavailable` | Client could not fetch the manifest/status. |
| `no_app_bundle_in_html` | Auditor found no digested bundle in served HTML. |

Implementations MAY define additional codes; additional codes SHOULD be
prefixed to avoid collision (e.g. `x_client_*`).

---

## 11. Versioning

`dalton_chair_version` is an opaque string identifying the manifest format.
This document defines exactly `"1.1"`.

- Verifiers MUST reject manifests with unknown versions (fail closed),
  reporting `invalid_manifest`.
- Changes that alter the signed field set, canonicalization, or signature
  scheme require a new version string. Additive changes to *derived*
  (unsigned) status fields do not.

---

## 12. Security Considerations

### 12.1 Threat model

In scope: silent code modification by the operator or a hosting compromise;
supply-chain substitution of build output; coerced modification (detected,
not prevented). Out of scope: signing key compromise; first-visit trust
(TOFU); browser compromise. See the design document and paper for the full
analysis.

### 12.2 The extension gap

Browser-executed verification code is itself served by the operator and can
be stripped or subverted. Consequently, in-page verification (Section 7.2)
is advisory, and the protocol's primary enforcement in this version is
**independent audit** (Section 7.3) backed by **on-chain registration**
(Section 9). Closing the gap fully requires verification support the
operator cannot subvert (browser-native or extension). Implementations MUST
NOT claim operator-independent verification from in-page checks alone.

### 12.3 Trust on first use

A client's first visit has no established anchor. Anchors established out
of band (Section 6) mitigate this for subsequent verifications.

### 12.4 Key management

The signing key MUST be isolated from build and production systems.
Rotation and revocation are not specified in this version; operators SHOULD
publish rotations through the same trust anchors as the original key.

### 12.5 Reproducibility boundary

Verification proves served code matches signed code. It does not prove the
build output corresponds to a particular source tree; that requires
reproducible builds and is out of scope for this version.

---

## 13. Test Vectors (Normative)

An implementation is conforming if it reproduces these vectors. Keys are
test-only and MUST NOT be used for any real signing.

**Test private key (base64):**
```
j8Hj13myei2armqQTZsbIvtWP5EOth3yE8B67xweDF8=
```

**Test public key (base64):**
```
v0Yo/imbkXscoAAgvjvTzZeFUvQ4Db0khDQ9XBkREkk=
```

**Manifest fields (pre-signature):**
```json
{
  "app": "example-app",
  "version": "1.0.0",
  "git_commit": "0123abc",
  "release_hash": "ebda9aa1677dbd029bd986e3f68f0a1386059b32ab604d127d7047614a54ccb7",
  "crypto_js_hash": "5312a06431420245deee27c571cf4265d174f30e9ba7ddd698e93b375f49fce3",
  "signer_public_key": "v0Yo/imbkXscoAAgvjvTzZeFUvQ4Db0khDQ9XBkREkk=",
  "signed_at": "2026-01-01T00:00:00Z",
  "dalton_chair_version": "1.1"
}
```

**Canonical payload (exact bytes):**
```
{"app":"example-app","crypto_js_hash":"5312a06431420245deee27c571cf4265d174f30e9ba7ddd698e93b375f49fce3","dalton_chair_version":"1.1","git_commit":"0123abc","release_hash":"ebda9aa1677dbd029bd986e3f68f0a1386059b32ab604d127d7047614a54ccb7","signed_at":"2026-01-01T00:00:00Z","signer_public_key":"v0Yo/imbkXscoAAgvjvTzZeFUvQ4Db0khDQ9XBkREkk=","version":"1.0.0"}
```

**Expected signature (base64):**
```
3NpYdRpoFLfnHJ05fjd3wnRcfmplBstdXCto2Kit2yhBsAVl89icJZX13KCrYUhTzispGDlq99e2PZILhAq7BA==
```

**Negative vectors.** Verifying implementations MUST return:

- `invalid_signature` — the manifest above with any single field value
  altered (e.g. `release_hash` set to `"tampered"`).
- `untrusted_signer` — the manifest above verified against any pinned
  signer other than the test public key.
- `malformed_manifest` — the manifest above with `signature` removed.

---

## Appendix A. Reference Implementation (Informative)

- Manifest algebra, hashing, boot verification:
  `lib/graypress/dalton_chair.ex`, `lib/graypress/dalton_chair/manifest.ex`
- Signing pipeline: `mix graypress.sign`
- Independent auditor: `lib/graypress/dalton_chair/audit.ex`,
  `mix graypress.audit`
- Canonicalization: `GraybeamCrypto.JCS` (RFC 8785 subset for the manifest
  value domain)
- Live status endpoint: `https://press.graybeam.tech/dalton-chair`
