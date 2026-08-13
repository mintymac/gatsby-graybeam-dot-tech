---
title: "The Day Email Broke: Namecheap Went Down and I Built a Way Out"
category: "Engineering"
author: McHughson Chambers
date: 2026-08-13
---

This morning, my email provider went down. All day. Not a slow day, not a hiccup. Down.

The provider is Namecheap PrivateEmail, and the outage traces back to a physical cooling-system failure at a PhoenixNAP data center. Namecheap's own website returned a 503 "under maintenance" page while I was trying to figure out what happened. This was not a configuration mistake. It was a building getting too hot.

When email goes down, a business does not pause gracefully. Quotes stop going out. Enrollment documents stop arriving. Client questions sit unanswered. Email is the one system where "we'll fix it later" is not an option, because the person on the other end does not know there is a problem. They just think you went quiet.

So I did what I always do when infrastructure scares me. I built a tool.

## The Tool: switchboard

Switchboard is a small Go CLI that owns the entire email migration journey. The insight behind it is that migrating email is not hard because of any single step. It is hard because of the sequence.

The sequence that matters:

1. Sync every mailbox from the old provider to the new one, while the old provider still has your DNS.
2. Flip the MX, SPF, DKIM, and DMARC records in the right order.
3. Sync again to catch the mail that landed during the cutover window.
4. Verify the new provider is actually receiving mail.

Do that wrong and you lose mail in the gap between old and new. That gap is what keeps people on a failing provider for years. The pain of switching feels worse than the pain of staying.

Switchboard exists to remove the scary part. It is dry-run first. The source mailbox is read-only, always. DNS changes are printed for review before anything is applied. Sync is idempotent, so running it twice is safe, which is exactly how the final delta sync works.

The interesting part is what I learned while building it.

## Most Email Providers Cannot Be Automated

I added an automation field to the provider catalog, because the question of "can an agent set this up" turned out to matter more than price.

The answer surprised me. At the budget tier, almost nobody exposes an API for provisioning. You click through an admin console. Google Workspace and Microsoft 365 have full APIs, but that is enterprise pricing.

The one exception is Migadu. Migadu has a clean REST API for creating domains and mailboxes. It is the only cheap provider where switchboard can automate the entire journey end to end: create the domain, create the mailboxes, print the DNS records, and hand off to the cutover, no human in the loop.

That made Migadu the reference implementation for switchboard's automated path. Not because it is the best provider, but because it is the only one that let me prove the thesis.

## Why Zoho Is the Pick for a Real Business

The recommendation that stuck with me came from [@AdamSzaloczi on X](https://x.com/AdamSzaloczi), who pointed me toward Zoho Mail. He was right.

Zoho is the rare case where the budget option is also the reliable option:

- A contractual 99.9% uptime SLA, which almost nobody at this price offers.
- Enterprise sending infrastructure, so client email actually reaches inboxes.
- A free tier for up to five users, so you can test with your real addresses before paying anything.
- Roughly a dollar per user per month after that.

For a business sending quotes and enrollment documents, deliverability is the number that matters, and Zoho scores at the top of the budget tier. Fastmail is arguably better but costs more. MXroute has excellent deliverability with zero hand-holding. Migadu is the cheapest flat-price option and the only one you can script.

The table that matters:

| If you optimize for | Pick |
|---|---|
| Reliability for the price | Zoho Mail |
| Full API automation | Migadu |
| Flat price, technical users | MXroute |
| Reliability, price no object | Fastmail |

## The Bigger Lesson

A physical cooling failure at a data center is not a bug. It is not something your uptime monitoring would have predicted, and it is not something you could have configured around. It is a reminder that infrastructure is physical before it is software. Somewhere, the thing you depend on is a room with an air conditioner in it.

The only real defense is to make leaving easy. Not because you plan to leave, but because the ability to leave is what makes staying tolerable.

Switchboard is that defense, written down as a tool. It is open source. It is a single static binary. It refuses to touch your source mailbox. And it turns a week of anxiety into a sequence you can run in an afternoon.

The code is at [gitlab.com/graybeam/switchboard](https://gitlab.com/graybeam/switchboard). If your email is fine today, that is the best possible time to know how you would move it.
