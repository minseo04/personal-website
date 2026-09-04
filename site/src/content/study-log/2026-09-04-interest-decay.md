---
title: Why an interest map has to forget
date: 2026-09-04
summary: Notes from building the weighting function behind the briefings on this site.
topics: [agents, personal tooling, information retrieval]
---

The first version of my interest map just counted mentions. It was useless within a
week: things I had ground through in July outranked what I actually cared about that
morning, because July was long and busy.

The fix is a half-life. Every mention `d` days old contributes `0.5 ^ (d / H)`, and a
topic's weight is the sum over its mentions. With `H = 21` days, a subject I hit hard
last week beats one I asked about twice two months ago, and a topic I have genuinely
dropped decays toward zero without me having to prune anything by hand.

Two things I did not expect:

**Strictness matters more than recall.** The extractor that turns prompts into topics
throws away most prompts — chores like "pull the repo" or "fix this typo" produce
nothing at all. On my first run, 92 of 135 prompts yielded no topic. That felt wrong
until I remembered the asymmetry: a wrong topic pollutes the map permanently, while a
missed one costs nothing, because I will ask about the same subject again if I actually
care.

**Co-occurrence needs the right unit.** I first drew edges between topics appearing in
the same prompt. Since the extractor usually returns at most one topic per prompt, that
produced a graph with no edges at all. Session-level co-occurrence is the honest unit:
things discussed in one sitting genuinely went together in my head.

<!-- TODO: this entry is a real writeup of the tool, but edit it into your own voice. -->
