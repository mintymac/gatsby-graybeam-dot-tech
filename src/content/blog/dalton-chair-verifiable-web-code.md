---
title: "Dalton Chair: How to Prove a Web App Is Serving the Code That Was Signed"
category: "Engineering"
author: McHughson Chambers
date: 2026-07-26T12:00:00-05:00
cover: "/images/blog-dalton-chair-code-transparency.webp"
---

Imagine opening an encrypted web app. The page says your messages are private. The connection uses HTTPS. The app encrypts each message before sending it.

There is still a hard question:

**Who gave your browser the encryption code?**

The answer is usually the same server you are trying to protect yourself from. If that server is hacked, its operator is forced to cooperate, or its deployment pipeline is compromised, it can send your browser a changed JavaScript file. The new file can look and work exactly like the real app while quietly copying your keys.

HTTPS does not solve this. HTTPS proves that the bytes came from the server named in the certificate. It does not prove that those are the bytes the developer approved.

Dalton Chair is a draft protocol for closing part of that gap. It gives a web release a signed fingerprint, checks the running release against that fingerprint, and lets an outside auditor compare the JavaScript served to users with the JavaScript that was signed.

The goal is not to make tampering impossible. The goal is to make tampering detectable.

## Start with bytes

A program is ultimately a sequence of bytes. Change the source code, rebuild it, and some of those bytes will usually change.

SHA-256 turns any number of bytes into a 32-byte value called a **hash**:

```text
application bytes
       |
       v
    SHA-256
       |
       v
8c72f0...a91b   <- 64 lowercase hexadecimal characters
```

A hash works like a very sensitive fingerprint. The same input always creates the same hash. A one-byte change creates a very different hash. It is also impractical to start with a hash and reconstruct the original program.

A hash can answer one question:

> Are these bytes the same as the bytes that produced this fingerprint?

It cannot answer another important question:

> Who says this is the correct fingerprint?

An attacker who can replace the JavaScript may also be able to replace a plain text file containing its hash. We need a signature.

## A signature connects the hash to a signer

Dalton Chair uses Ed25519 public-key signatures. The signer has two related keys:

- The **private key** creates signatures and must remain secret.
- The **public key** checks signatures and can be shared with everyone.

The private key signs a small JSON document called a manifest. Anyone with the public key can verify that signature. They cannot use the public key to create a new valid signature.

The manifest contains exactly nine fields:

| Field | What it tells us |
| --- | --- |
| `app` | Which application this release belongs to |
| `version` | The application's release label |
| `git_commit` | The source-control commit associated with the build |
| `release_hash` | SHA-256 fingerprint of the server-side release files |
| `crypto_js_hash` | SHA-256 fingerprint of the JavaScript bundle served to browsers |
| `signer_public_key` | The Ed25519 key that claims responsibility for the release |
| `signed_at` | When the manifest was signed, in UTC |
| `dalton_chair_version` | Which protocol rules apply |
| `signature` | The Ed25519 signature over the other eight fields |

Here is the important idea: the signature covers the hashes, version, commit, time, and signer identity together. An attacker cannot change one field without breaking the signature.

## Why the JSON must have one exact form

Two JSON documents can mean the same thing while using different bytes:

```json
{"app":"graypress","version":"1.1.0"}
```

```json
{
  "version": "1.1.0",
  "app": "graypress"
}
```

The spaces and key order differ. A digital signature checks bytes, not meaning, so signing arbitrary JSON text would create compatibility problems.

Dalton Chair uses the JSON Canonicalization Scheme from RFC 8785. Before signing or verifying, an implementation removes the `signature` field, sorts and encodes the remaining fields using one exact set of rules, and signs those canonical bytes.

```text
manifest object
      |
      +-- remove signature
      |
      +-- canonical JSON
      |
      +-- Ed25519 signature
```

This detail sounds small, but it is what lets an Elixir signer, a JavaScript verifier, and an auditor written in another language agree on the same signature.

## Four jobs that must stay separate

The protocol names four roles:

1. The **signer** holds the private key and approves a manifest.
2. The **operator** runs the web server and serves the application.
3. A **verifier** checks hashes and signatures.
4. An **auditor** checks the live server from outside the operator's system.

This separation is the heart of the design. A server saying, "I checked myself and I am safe," is not strong evidence. If an attacker controls the server, they may also control the code that prints that message.

Dalton Chair states the rule directly:

> A verifier must not trust the system it is verifying.

The outside auditor is therefore more important than the server's status page.

## The complete verification path

The protocol works in stages.

### 1. Build and hash

GrayPress builds its production release first. After build transformations are complete, the signing task hashes the compiled BEAM files and the exact digested JavaScript bundle Phoenix will serve.

```bash
MIX_ENV=prod mix release
MIX_ENV=prod mix graypress.sign --key /secure/code_signing.key
```

Hashing after the final build step matters. If signing hashes the unstripped BEAM files but production runs stripped files, an honest deployment will fail verification because the bytes differ.

The JavaScript bundle must also be resolved through Phoenix's asset manifest. Choosing the first file matching `app-*.js` is unsafe because an old bundle may still exist in the same directory.

### 2. Sign the manifest

The signing task creates the manifest, converts it to canonical JSON, signs it with Ed25519, and places it in the release.

The private key should not live on the production server. Ideally, signing happens through a hardware security module or an isolated signing service. Separation limits what an attacker can do after compromising the server.

### 3. Check at boot

Before accepting traffic, a strict GrayPress deployment recomputes its release and JavaScript hashes. It verifies the manifest signature against an expected public key and refuses to start when a check fails.

Boot verification is useful for catching damaged releases, stale assets, and accidental deployment mistakes. It can also catch an attacker who changes covered files without replacing the verifier.

It is not fully independent verification. The boot checker runs inside the release it checks. A complete attacker who can replace the checker and its embedded trust key may be able to make a false release approve itself. We will return to this limit.

### 4. Publish status

GrayPress exposes a status document at [`/dalton-chair`](https://press.graybeam.tech/dalton-chair). It contains the signed manifest plus results from the server's own checks.

Those result fields are useful for operations, but an outside auditor ignores them. The operator does not get to grade its own test.

### 5. Audit from outside

The independent auditor performs its own work:

1. Fetch `/dalton-chair` from the live server.
2. Fetch the site's HTML.
3. Find the digested application bundle named in that HTML.
4. Download that bundle and hash its bytes.
5. Verify the manifest's Ed25519 signature.
6. Check that the manifest signer equals a public key obtained somewhere else.
7. Compare the downloaded bundle hash with `crypto_js_hash`.

GrayPress provides a command for this:

```bash
mix graypress.audit https://press.graybeam.tech \
  --signer-key /independent/code_signing.pub
```

The command exits with a nonzero status when any check fails, so a monitor or CI job can run it automatically.

The audit reduces to three independent statements:

```text
signature is valid
AND signer is the expected signer
AND served bundle matches the signed hash
```

All three are required. A valid signature from an unknown key only proves that *someone* signed the manifest. A trusted signature over the wrong bundle does not prove the live server is correct.

## Where the public record fits

The protocol can register signed manifests in a public, append-only record. The reference profile uses an Algorand application box with a key shaped like:

```text
dalton:{app}:{version}
```

This gives auditors a record outside the web operator's control. The web server cannot quietly rewrite yesterday's manifest without leaving a new public transaction.

The blockchain is not doing the cryptography for Dalton Chair. SHA-256 and Ed25519 already do that. The public record supplies independent publication and history.

A transparency log could provide the same property if it is public, independently operated, and append-only. The security requirement matters more than the brand of storage.

## What Dalton Chair proves

When an independent audit passes, it provides evidence that:

- the downloaded JavaScript matches the hash in the manifest;
- the manifest has a valid Ed25519 signature;
- the signing key matches an independently trusted public key; and
- the signed fields have not changed since signing.

That is meaningful. It turns "trust our server" into a test another party can run.

## What it does not prove

Dalton Chair does not prove that the signed code is good code. A trusted developer can sign a bug or a backdoor.

It does not prove that a source repository produced the release. That requires reproducible builds and signed build provenance.

It does not protect a stolen signing key. An attacker with that key can sign malicious manifests.

It does not protect a compromised browser. The browser controls what the user sees and what code executes.

Most importantly, JavaScript inside the page cannot provide fully independent verification. The operator serves that verifier too and can remove or replace it. A browser extension, browser-native feature, or outside auditor must supply the enforcement the operator cannot change.

The specification calls this the **extension gap**. Naming it is a strength. Security protocols become dangerous when they hide the point where trust returns.

## Review of draft version 1.1

DCSPEC-1.1 has several unusually good properties for a young protocol:

- It defines an exact manifest instead of saying "sign some metadata."
- It uses standard algorithms: SHA-256, Ed25519, RFC 3339, and RFC 8785.
- It includes exact positive and negative test vectors.
- It separates signature validity from signer trust.
- It requires independent auditors to ignore the server's self-reported verdict.
- It states its limits instead of calling detection prevention.

The document is still a draft. Before calling version 1.1 a stable standard, I would tighten six areas.

### 1. Add rollback protection

An operator may be able to serve an old release with an old, valid manifest. Every hash and signature can pass even though users were silently moved backward to a vulnerable version.

The protocol needs a rule for discovering the latest accepted release or enforcing a monotonic sequence number. The current `version` field is an opaque string, so a verifier cannot safely decide whether `2.0` is newer than `10.0-beta`.

### 2. Name hash profiles in the manifest

The spec defines `beam-release` and `static-bundle` profiles, but the manifest stores only the resulting hashes. A verifier needs to know which exact procedure produced each hash.

Adding fields such as `release_hash_profile` and `client_hash_profile`, or binding profiles to a stricter protocol version, would make independent implementations less likely to disagree.

### 3. Break the self-verification circle

The compile-time signer pin lives inside the release being checked. If an attacker can replace the whole release, they may replace the verifier, the pin, and the manifest together.

Strict boot checks remain useful, but the specification should describe them as local consistency checks unless the trust key comes from a protected system outside the release. Independent monitoring is what turns the result into evidence against the operator.

### 4. Define the full release boundary

The `beam-release` profile hashes `.beam` files but does not include filenames, dependency applications, configuration, executable scripts, or files under `priv`. Renaming a file may not affect the current aggregate hash, and important runtime behavior can live outside the application's own `ebin` directory.

A stable profile should state exactly which files are security-relevant and include both each relative path and its content hash in an unambiguous structure.

### 5. Make validation errors consistent

One section treats missing required fields as `malformed_manifest`; another defines that case as `invalid_manifest`. Implementations need one answer so monitoring and test suites agree.

The verification procedure should also say explicitly how to reject malformed timestamps, non-hex hashes, wrong hash lengths, unknown versions, and non-string values.

### 6. Specify registry immutability

An Algorand box is storage. Whether a record can be overwritten depends on the application code controlling that box. The registry profile should define duplicate-version behavior and require the contract or log to reject mutation, not merely promise that the surrounding chain records transactions.

These are fixable protocol questions. None removes the value of signing and independently auditing live code. They mark the difference between a solid reference implementation and a standard that unrelated teams can implement the same way.

## Why this is worth building

Web applications update quickly because users receive code on every visit. That is useful, but it gives the server unusual power. The same system that stores encrypted data can also deliver the program that handles the encryption keys.

Dalton Chair adds a chain of evidence:

```text
developer key
    signs
canonical manifest
    names
release and bundle hashes
    checked against
running server and downloaded JavaScript
    verified by
an independent auditor
```

It is not a silver bullet. It is a clear, testable step from "the server says this code is safe" toward "here are the bytes, signature, trusted key, and public record; check them yourself."

That is what useful security engineering looks like: narrow claims, standard cryptography, independent checks, and enough detail for someone else to prove you wrong.

The full draft is available in the [Dalton Chair Protocol Specification](https://gitlab.com/graybeam/graypress/-/blob/main/docs/dalton-chair-spec.md). GrayPress is the reference implementation.
