---
title: "A Computer That Watches the School Room: Self-Hosted AI for Homeschool Feedback"
category: "Innovation"
author: McHughson Chambers
date: 2026-08-29
cover: "/images/blog-orin-homeschool-room.png"
draft: false
---

*From Cedar Park, Texas — August 2026*

We homeschool three kids. Like most homeschool parents, our bottleneck was never curriculum. It was **feedback**. I can pick great material. What I cannot do is sit behind three children at once and see, honestly, how the work actually goes: who is stuck, who is drifting, which problem stopped them cold.

So this summer we built a small referee for the school room. It runs on an **Nvidia Jetson Orin Nano Super**, a $249 computer the size of a paperback, and after one full week of daily use I want to share what it does, what it caught, and where we are taking the on-device AI next.

## What the rig is

Three Logitech webcams, one per desk. A speaker. The Orin. That is nearly the whole list.

The Orin is a real AI computer, not a toy. It has a GPU designed to run neural networks locally, which means every model we use — speech to text, text to speech, vision, a small language model — runs **inside our house**. Nothing about our kids, their faces, their voices, or their schoolwork ever leaves the room. For a homeschool family, I think that is the most important sentence in this article.

On a typical school morning the system:

1. **Sees.** A still frame from each desk every five minutes through the morning block, and continuous video when we run a diagnostic.
2. **Hears.** It can speak a math question through the speaker and listen for the answer at the desks, transcribing locally.
3. **Remembers.** Everything lands on our home server: contact sheets, videos, session logs, and a running "difficulty ledger" of exactly which skills tripped up which kid.

## The philosophy part

The hardware is the easy half. The other half is a daily rhythm borrowed from Japanese craft tradition:

- **Kata:** copy the form. Drill the exact skill.
- **Poka-yoke:** mistake-proof the room. Phones live elsewhere. Books open to the right page before anyone sits down.
- **Shokunin:** the 100% gate. You do not advance on 92%. You repeat the level.
- **Kaizen:** one percent better, one small step, every day.
- **Hansei:** end-of-day reflection. What went well, what broke, one change for tomorrow.

The system runs this loop with the kids; the cameras and logs keep me honest about how it is really going. Together they form a loop any engineer would recognize: observe, orient, decide, act. A homeschool parent's OODA circle, running every morning before the breakfast dishes are done.

## What it caught in week one

This is the part that sold me. We ran a 30-minute math diagnostic with the cameras rolling, then let the system analyze itself: frame extraction, stall detection, and transcription of the kids' handwritten worksheets.

**Our oldest (17).** Her linear equations were flawless, eight for eight. But on the factoring sheet she had written, in her own handwriting across the page, *"I forgot how to factor."* No drama, no wrong answers to grade. Just an honest self-report that a worksheet full of empty boxes would never have surfaced. She now gets a factoring refresher built around the FOIL steps she half-remembers, instead of a generic review.

**The middle (11).** Every single answer was correct, 24 out of 24. But the video showed he spent two-thirds of the session motionless, thinking. He computes facts like 12 x 11 from scratch every time. So his problem is not understanding; it is speed. He now does sixty-second fluency sprints where the goal is to beat his own last time, not to beat anyone else.

**The youngest (7).** Finished everything, passed clean. The camera moments that looked like "stuck" were just a seven-year-old resting between problems. The real finding was for us: thirty minutes is past her attention window, so her next diagnostic gets a shorter block. The data corrected *our* design, not hers.

None of these came from a test score. All of them came from watching kindly, at scale, and reading what the kids actually wrote.

## How the decisions get made

The pipeline is worth describing because the architecture generalizes to any "AI watches a physical process" problem:

```
video (3 cameras) -> frames -> motion/stall analysis
                  -> two-model vision pass (local VLM + cloud VLM, arbitrated)
                  -> worksheet transcription -> math verified independently
                  -> human review -> difficulty ledger -> next day's drills
```

The two-model pass matters. A single vision model flagged "phone visible" 23 times on a desk where no phone ever appeared. Running a second model and requiring agreement before acting prevented 23 false accusations against a kid who was quietly doing mental arithmetic the whole time. **Any system that grades humans needs an arbitration layer before its verdicts become consequences.**

The worksheet transcription is the sleeper feature. Handwriting off a 720p camera, upscaled and read by a vision model, then checked by ordinary code that verifies the math — that is where the diagnostic gold lives. A parent can see which specific problem types broke which specific kid.

## The part I almost forgot to mention: the AI colleague

Here is the part that surprises people most. The cameras, the models, the pipeline — none of it runs itself. The analysis I described above was done **with an AI agent**: a Hermes agent running on my home GPU fleet, powered by **DeepSeek V4 Flash served locally**, alongside the local Gemma vision model and cloud Gemini when a second opinion is warranted.

I do not mean I click a button and read a report. I mean we work the case together. The agent extracts the frames, runs the motion analysis, and reads the worksheets — then we argue about what it means. It flagged 23 possible phone sightings; I looked at the frames and called them false positives. It transcribed "I forgot how to factor" off a 720p video; we decided together that a self-reported gap is a different thing than a wrong answer. It drafted the refresher worksheets, the ledger entries, the calendar events; I approved, edited, and printed them. The whole diagnostic-to-drills loop closed in about an hour because one of the parties in the conversation never gets tired of re-watching footage.

That is the actual product. Not cameras, not models — **a colleague who has seen every morning session and never forgets a detail**, running on hardware I own. The homeschool rig is the use case; the pattern is an AI partner with perfect recall of everything that happened in the room, one that helps you teach instead of just automating worksheets.

## Where we are taking the on-device AI

Right now the Orin handles capture, audio, and scheduling, and a home server handles the heavier vision passes. The roadmap is to collapse the whole loop onto the Orin itself, because the hardware genuinely supports it:

- **Parakeet-class STT on-device.** Speech-to-text models in the half-billion-parameter range run comfortably on the Orin's GPU. Kids' spoken answers transcribed in the room, no network.
- **A small VLM on-device.** Structured frame analysis (present, on-task, phone visible) does not need a frontier model. Quantized 4B-class vision models handle it; the two-model arbitration can stay local too — one model on the Orin, one on the home server.
- **The quiz brain on-device.** A 4B-12B language model is enough to generate, speak, and grade drill questions. We already run this pattern elsewhere in the house.
- **Neural TTS on-device.** The room's voice, fully offline.

The practical case is threefold: **privacy** (kids' faces and voices never leave the house), **reliability** (the school room works when the internet does not), and **speed** (no round-trips in the middle of a kid's attention window). The Orin's GPU delivers up to 275 TOPS in MAXN mode; a loop of STT + small VLM + small LLM + TTS fits inside that envelope with room to spare. The deep-analysis tier — weekly reviews, long transcripts, narrative video understanding — stays on the home server. The room runs its day; the server runs the week.

## What I would tell another family

**Cost:** roughly $450 to start. Orin Nano Super $249, three used webcams about $25 each, a USB speaker you probably own, and a drive for the recordings. Software is free and open.

**Effort:** the parts took an afternoon. The software took me a few weekends, but I enjoy this stuff. If you do not, start smaller: one camera, one still per hour, and a folder you actually look at on Friday. The discipline of *looking* matters more than the pipeline.

**The rule that keeps it sane:** the computer gathers evidence. The parent makes the calls. Every finding gets confirmed by a human before it becomes an assignment, and the kids know the cameras exist and why. It is not surveillance. It is a lab notebook for learning.

The best feature turned out to be for me. The daily log ends with the kids' own reflections, and hearing a seven-year-old describe a book as "nice but hard" is better assessment data than any quiz I could write.

We are one week in. The room is quieter, the drills are sharper, and Sunday is now the break day by design, not by exhaustion. That feels like a good trade for a $249 computer and three old webcams.

---

*Gear: Nvidia Jetson Orin Nano Super dev kit, 3x Logitech C920, USB audio. Everything runs locally. Questions welcome.*
