# Blake — ElevenLabs Agent Audit (2026-05-27)

Workstream 4a from the May 26 brief. Goal: identify why Blake sounds artificial + why ~1-minute calls feel latency-bound, then ship a targeted config change.

**Agent ID:** `agent_5001ks3cp069f9rtfz6e81ypgnrd`
**Phone number ID:** `phnum_8001ks3fhbbpe4vadtrdmparejgw`
**Sample size at time of audit:** 121 calls / ~1 min average duration

> ## How to populate the "Current" column
>
> After this PR merges, run:
> ```bash
> curl -s https://acq-automation.mithchell.workers.dev/admin/blake/agent-config | python -m json.tool
> ```
> The `/admin/blake/agent-config` endpoint added in this PR proxies through to ElevenLabs `GET /v1/convai/agents/{agent_id}`. Use its output to fill in the Current column verbatim, then make a follow-up PR that `PATCH /v1/convai/agents/{agent_id}` applies the approved Recommended values.

---

## Audit table

| # | Setting | Current (to fill from `/admin/blake/agent-config`) | Recommended | Reasoning | Risk |
|---|---|---|---|---|---|
| 1 | **LLM backing the agent** | _e.g. `claude-sonnet-4-5` or `gpt-4o`_ | **`gemini-2.0-flash`** (first choice) or **`gpt-4o-mini`** (fallback) | For outbound cold calls, latency >> depth. Gemini 2.0 Flash hits sub-300ms time-to-first-token. Sonnet/GPT-4o run 600–900ms which on Twilio + Multilingual TTS stacks into the 1-2s gaps homeowners read as "robot." | Flash models can be less coherent on long-context tool-use. Mitigate by keeping Blake's prompt under 4K tokens and trusting the post-call Claude extraction to clean up. |
| 2 | **TTS voice id** | _voice_id_ | **Try 3-5 candidates** (see § Voice candidates below) | Adam said "sound less artificial." The single-voice default + Multilingual model is the #1 culprit. Swap to a US-natural voice on the Flash TTS model. | A/B for 1 week before committing. Some voices sound great on test text but fall apart on real call interruptions. |
| 3 | **TTS model** | _e.g. `eleven_multilingual_v2` or `eleven_turbo_v2_5`_ | **`eleven_flash_v2_5`** | Multilingual v2 = 800–1200ms TTS latency. Flash v2.5 is ~75ms (US English only — fine for APG markets). Single biggest lever for the "feels slow" complaint. | Flash is English-only. Not a constraint for APG (NJ/PA/AL). Quality is marginally less expressive but the speed gain dominates. |
| 4 | **ASR / STT language** | _e.g. `en-US` or `auto`_ | **`en-US` locked** | Auto-detect adds 100-200ms first-utterance latency for nothing. We don't have non-English sellers in the pipeline. | None. |
| 5 | **ASR keyword biasing** | _list of biased terms or empty_ | **Add real-estate vocabulary:** `MAO`, `wholesale`, `assignment`, `escrow`, `as-is`, `closing costs`, `liens`, `probate`, `quitclaim`, `lockbox`, plus city names: `Trenton, Newark, Birmingham, Bessemer, Philadelphia, Allentown, Montgomery, Mobile, Hoboken, Camden` | "Bessemer" and "Bessemer Alabama" get transcribed as "Bess Maher Alabama" without bias. Same for "Forestdale" → "force dale." Bad ASR = Claude extraction misses motivation/address. | Bias too aggressively and unrelated words get pulled into matches. Cap at 20 terms. |
| 6 | **Endpointing sensitivity** | _ms threshold for "end of utterance"_ | **800ms** (higher than default 500ms) | Elderly + slow-speaking homeowners pause mid-thought. The Opus self-improvement review flagged "talking over the user / poor turn-taking on slow speakers" as one of 3 top failure modes from the May 26 transcript review. | Higher threshold = slower turn-taking. Trade-off: a brief patient pause is much better than barging in. |
| 7 | **Interruption sensitivity** | _scale 0–1 or named level_ | **Low** (Blake should NOT interrupt) | Per the same Opus review: "Blake interrupts or barges in during pauses, especially with elderly/hesitant users." Aggressive interruption reads as pushy + breaks rapport. | Blake will sometimes finish a sentence even after the seller starts talking. That's the lesser evil. |
| 8 | **Response timeout** | _ms before Blake re-prompts on silence_ | **6000ms** | Default 3000 fires too early — Blake re-asks the question and confuses the seller who was just thinking. | If a call truly stalls, 6s feels long. Mitigated by Blake's "Are you still there?" fallback in the prompt. |
| 9 | **System prompt structure** | _single block, or P/E/T/G/G sections_ | **Keep single block, but trim to ~2,500 tokens** | ElevenLabs' Personality/Environment/Tone/Goal/Guardrails sectioning is mostly cosmetic for one-purpose agents. Current voice-prompt.md is ~3,800 tokens — diminishing returns past ~2,500 for cold-call agents per ElevenLabs' own guidance. | Trimming risks losing edge-case behaviors. Move trimmed content to the Knowledge Base (item #11) so Blake can still reference it. |
| 10 | **Tools — server tools / webhooks** | _8 GHL tools per [elevenlabs-tools-config.md](../../APG-Vault/_system/Blake/elevenlabs-tools-config.md)_ | **Keep all 8 + add real-time `get_prior_call_summary`** | The 8 tools are well-scoped. Add a tool that fetches the contact's most recent Blake call summary mid-call so Blake can self-correct if the Seller File pre-brief was stale. Helps when a seller calls Blake back hours later. | Adds one more outbound HTTP call mid-conversation. Latency cost ~200ms but only fires when Blake explicitly invokes it. |
| 11 | **Knowledge base / RAG** | _enabled / disabled, contents_ | **Enable + load:** APG buy-box (NJ/PA/AL + Birmingham metro), MAO formula = AVM × 0.70 − sqft × $30 − $10k, deal stages (Unqualified / Qualified / LAO / FU 1.5mo / Dead), team contacts (RJ = Rene Fonseca = acquisitions partner) | Without RAG, every detail must live in the system prompt → context window pressure → slower inference. RAG keeps Blake snappy AND lets us update facts without re-deploying the prompt. | RAG retrieval adds 100-200ms per call. Mitigated by warming the cache. |
| 12 | **Post-call webhook HMAC** | _enabled, secret set?_ | **Already wired** (`ELEVENLABS_WEBHOOK_SECRET` is bound in the Worker; `verifySignature()` rejects events older than 5 min) | No change needed. | None. |
| 13 | **Evaluation criteria (ElevenLabs built-in eval)** | _list of criteria, or none_ | **Add these 6 APG-specific criteria:** (1) captured decision-maker name, (2) confirmed property address, (3) identified seller motivation, (4) set callback time, (5) captured mentioned contacts (referrals), (6) handled DNC request cleanly | Free per-call evaluation. Currently we get post-call data only from Claude extraction; adding ElevenLabs eval gives a 2nd signal we can disagree-with for prompt iteration. | None — eval is free and read-only. |
| 14 | **Cost per minute** | _to fill from billing dashboard_ | Target: **$0.20-0.30/min** | Multilingual v2 + Sonnet/GPT-4o stack runs $0.40-0.55/min. Flash v2.5 + Gemini Flash drops to ~$0.20/min. At 121 calls × 1 min = ~$30/mo today; recommended config = ~$13/mo + better quality. | None — recommended is cheaper. |

---

## Voice candidates

5 candidates picked for: less artificial, American/conversational, suitable for cold real-estate outreach. Mido picks one (or A/B-tests two) via the ElevenLabs dashboard's voice library.

| # | Voice ID | Display name | Why it fits | Notes |
|---|---|---|---|---|
| 1 | `nPczCjzI2devNBz1zQrb` | **Brian** | Calm, mature American male, mid-30s. Sounds like a friendly real-estate broker. Not over-energetic (which is the trap most AI voices fall into). | ElevenLabs' #1 trending "narration-male" voice in 2025. Familiar = less robot perception. |
| 2 | `pNInz6obpgDQGcFmaJgB` | **Adam** | Warm, low pitch, conversational. Carries the cadence of a podcast host. People are already trained to hear this voice as "human" because of podcast/audiobook ubiquity. | Risk: too narrator-y for cold calls — works better when Blake stays under 12 words per turn. |
| 3 | `CwhRBWXzGAHq8TQ4Fs17` | **Roger** | Natural American male, slightly rougher edge — sounds less polished, more "guy you'd actually meet at a property." | Best fit if Adam wants Blake to sound like an investor, not a sales rep. |
| 4 | `IKne3meq5aSn9XLyUdCD` | **Charlie** | Casual, mid-energy, distinctive without being weird. Slightly younger feel (late 20s). | Risk: skews younger than the typical APG seller demographic (45-65). Pairs well with "Friendly" SMS variant. |
| 5 | `bIHbv24MWmeRgasZH58o` | **Will** | Confident, mid-30s, even-paced. Sounds like an analyst — useful when Blake quotes the MAO breakdown. | Best fit for the "Professional" SMS variant carryover into voice. |

**Recommendation:** Start with **Brian** as the primary swap. A/B against **Roger** for one week to test "polished vs rough" preference. Avoid Charlie until persona research (workstream 1) confirms a younger-seller subset.

**Adam's voice clone session is still a hard gate.** When Adam records his 30-min sample, that voice becomes the default and we re-evaluate.

---

## Followup PR scope (NOT in this PR)

This PR ships the audit doc + the `/admin/blake/agent-config` read endpoint only. After Mike approves rows, a separate PR will:

1. Add `/admin/blake/agent-config-apply` that PATCHes `/v1/convai/agents/{agent_id}` with the approved diff
2. Add a config-history KV key `vault:blake_agent_config:{date}` so every config change is snapshotted and a rollback is one-curl-away
3. Wire the ElevenLabs eval criteria via the `/v1/convai/agents/{agent_id}/criteria` endpoint
4. Load the knowledge base via `/v1/convai/agents/{agent_id}/knowledge`

## Related

- [`_system/Blake/voice-prompt.md`](../../APG-Vault/_system/Blake/voice-prompt.md) — current voice prompt (v1.3)
- [`_system/Blake/elevenlabs-tools-config.md`](../../APG-Vault/_system/Blake/elevenlabs-tools-config.md) — current 8 in-call tools
- [`_system/Blake/iterations/2026-05-26-analysis.md`](../../APG-Vault/_system/Blake/iterations/2026-05-26-analysis.md) — Opus self-improvement review that drove rows #6 and #7
