# Rev — the DD84 Marketing & Revenue agent

Rev is a working agent, not a document. This is how the pieces fit and how to
run it.

## The parts

| File                              | What it is                                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------------------------- |
| `docs/DD84-GROWTH-AGENT.md`       | The specification. Rev's constitution; §n references point here                                   |
| `docs/agents/ventures.md`         | **The venture registry.** Verified business facts, systems, pricing, restrictions, open questions |
| `.claude/agents/rev.md`           | The agent definition — voice, control loop, authority limits, prohibitions                        |
| `.claude/skills/rev-daily-brief/` | Daily operating brief (§26). **Read-only**                                                        |
| `.claude/skills/rev-discovery/`   | Full discovery pass → scored register + approval briefs                                           |
| `.claude/settings.json`           | Permissions. Reads run unattended; anything that spends, publishes or charges asks first          |
| `docs/growth/`                    | The record: registers, campaign kits, completion records                                          |
| `docs/growth/briefs/`             | Daily briefs                                                                                      |

## Running it

**Ask for it by name.** `@rev` or "get Rev to look at …" routes to the agent.

**Slash commands:**

```
/rev-daily-brief      # today's operating brief across ventures
/rev-discovery        # full discovery pass for a venture
```

**Unattended — nothing, as of 2026-08-13.** Rev has no scheduled Routine. Its
weekly growth brief was retired when the two agent branches were merged; the
reasoning and the deleted prompt are in the next section. Rev runs on demand.

## Rev and Torque — resolved 2026-08-13

> **Geography superseded 2026-09-09; the reasoning is not.** Both branches named
> in this section were in `downdirty84llc-creator/tune-advisor-`, which is now
> **retired** — it held an older copy of the Ledger application. The canonical
> home is this repository, `downdirty84llc-creator/georgia-opportunity-ledger`,
> branch `main`, and the agent platform moved here. The section is kept as the
> record of _how_ the two agents were reconciled; the same argument then applied
> one level up, to two repositories. See CLAUDE.md §0 and §10.

**There is a second agent on this account.** Torque is the _Operations Execution
Agent_, created within minutes of Rev and, until 2026-08-13, running on its own
branch in complete ignorance of it. Two agents writing overlapping briefs to two
branches produce contradictory records, and the contradiction is not obvious
until someone acts on the wrong one. Here is what was done about it, and why.

**One branch.** `claude/claude-md-docs-jjveuq` was merged into
`claude/claude-md-docs-cqvhy6`. This was not tidying: each branch held real work
the other lacked. Torque's side carried `src/lib/billing/mrr.ts`,
`src/lib/analytics/sample-data.ts` and 339 lines of tests; Rev's carried six
recovered migrations — two of them security hardening — the public-client caching
fix and the upgrade telemetry. Either branch shipped alone would have lost the
other half. The merged branch is the only live one; **jjveuq is stale, and
nothing on it was lost — it is an ancestor of the merged tip.**

**Two ledgers, still separate.** `docs/ops/` is what was operated;
`docs/growth/` is what was proposed. They share a branch and nothing else. Each
Torque Routine prompt now says explicitly that it may read `docs/growth/` and
must not write into it.

**One schedule.** Rev's weekly Routine is deleted.

| Routine                              | Schedule           | Agent  |
| ------------------------------------ | ------------------ | ------ |
| DD84 Inbox and Lead Intake           | Weekdays 10:20 UTC | Torque |
| DD84 Daily Command Brief             | Weekdays 10:50 UTC | Torque |
| DD84 Weekly Cash and Revenue Review  | Fridays 11:10 UTC  | Torque |
| DD84 Weekly Georgia Opportunity Scan | Mondays 11:25 UTC  | Torque |

**Why Rev's Routine went rather than Torque's.** Three reasons, in order of
weight. Torque's daily command brief already reports money moved, approvals
pending and today's priorities — most of what Rev's weekly brief reported. Rev's
Monday 11:00 sat 25 minutes ahead of Torque's Monday scan, so the two would read
the same ground and could disagree. And the fired Rev session had **no
connectors**, so it could not pull live Shopify or Stripe numbers anyway — the
part that carried the value. Rev's actual value has come from work asked for by
name: discovering that the Ledger could not take payment, that revenue stopped
eleven months ago, that a funnel event had never fired. None of that came out of
a schedule.

> **The connector limitation, recorded because it still applies to Torque.**
> Passing `connectors` to `create_trigger` returns _"the connectors parameter is
> not available for this organization"_ — retried 2026-08-07 and confirmed. It is
> not a session-grant problem; the parameter is closed to this tool. **It is
> fixable and there is proof:** an older Routine on this account,
> `created_via: http_api`, does carry Canva, Gmail, Google Calendar, Google
> Drive, PayPal, Shopify and Stripe. Routines created through the **claude.ai
> Routines UI** hold their grants; ones created through the MCP tool do not.
> Torque's four Routines were created through the MCP tool, so they inherit the
> same blindness — which is why their prompts insist that an unreachable
> connector makes a section "not available this run" rather than an estimate.

**To bring Rev's brief back**, recreate it from the claude.ai Routines UI so it
holds connectors, and move it off Monday morning. The deleted prompt, verbatim:

<details>
<summary>Rev — weekly growth brief (DD84), Mondays 11:00 UTC, deleted 2026-08-13</summary>

```
Run the Rev weekly growth brief for Down Dirty 84 LLC.

You are Rev, the marketing and revenue agent. The repository
downdirty84llc-creator/tune-advisor- (branch claude/claude-md-docs-cqvhy6)
contains everything you need:

1. Read `.claude/agents/rev.md` — your operating instructions and authority limits.
2. Read `docs/agents/ventures.md` — the venture registry of verified business facts.
3. Read the newest files in `docs/growth/` and `docs/growth/briefs/`.
4. Follow `.claude/skills/rev-daily-brief/SKILL.md` and produce the brief.

This run is READ-ONLY. You may read APIs, read the repository, write a brief to
`docs/growth/briefs/YYYY-MM-DD-weekly-brief.md`, and commit and push that file.
You may also update a stale figure in `docs/agents/ventures.md` with its new
verification date.

You must NOT: publish anything, send any message to any customer, spend
anything, create or change a Stripe object, change a price, or alter the live
Shopify storefront. If something urgent surfaces, say so loudly in the brief and
stop — escalation is the output, not action.

Pull live numbers where the connectors are available (Shopify sales, sessions
and funnel; Stripe charges) and compare against the previous brief. The change
is the story.

Lead with money: revenue in the period, orders, and days since the last payment
(the last one was 2025-09-12).

Then: what moved, approvals waiting, any new customer or order with its next
action and date, problems, and exactly one next highest-value action.

If genuinely nothing changed, say so in three lines. Do not inflate a quiet week
— a brief that manufactures significance trains the owner to ignore it.
```

</details>

> **The schedule above has never delivered anything. Read `docs/ops/` T-27
> before trusting it.** All four Routines have fired on cadence since
> 2026-08-07 — most recently 2026-08-28 — every run reporting `SUCCEEDED`, and
> `docs/ops/briefs/` still contains nothing but its README.
>
> **Root cause, confirmed 2026-08-28: it is the same defect as the connector gap
> below.** A Routine minted through the MCP `create_trigger` tool gets no
> connectors **and no repository** — its fired sessions carry no `sources` and no
> `outcomes`, so there is nothing to commit to and nothing to push with. The
> agent does the work (one sampled run: $1.77, 22,888 output tokens) and it dies
> with the session. The one Routine on this account that _does_ hold a repository
> is the one created in the claude.ai UI. **Recreating the four Routines there
> fixes both problems at once** — that is approval packet A-10.

**One more Routine exists and is nobody's.** _Weekly Georgia Opportunity Ledger
summary_ (`trig_01FxDef9B5snYTW42FfcMEbD`, Mondays 09:00 UTC) predates both
agents, targets the dead branch `claude/kind-keller`, holds live connectors
including Gmail, and its step 6 instructs it to **"email the summary to paid
subscribers."** The Ledger is not deployed and has zero users, so there is
nobody to mail today — but an unattended Routine with a mail connector and a
standing instruction to send is the one genuine safety problem in the list, and
it is outside both agents' authority to touch. **Owner decision needed.**

## The safety model, in one line

**Rev prepares everything and commits nothing outward.**

`.claude/settings.json` enforces the boundary mechanically — every read is
allowed, every write that costs money or reaches a customer is on `ask`. The
agent definition enforces it again in instructions. Two layers, because the
first one only covers tools that exist today.

What Rev may do alone: research, analyse, score, write briefs and copy, prepare
assets, update internal records, and change repository files.

What always needs a human: spending anything, changing a price, creating or
modifying a Stripe object, sending outreach, publishing to any channel,
committing partner compensation, issuing refunds.

## The loop

```
discover → validate → plan → REQUEST APPROVAL → execute → verify → operate → optimise → document
                                     ▲
                            the gate. always.
```

Approval is a gate, not a dead end (§5). Rev prepares the work so approval
immediately unlocks execution, and one approval covers everything needed to
finish that scope — no going back for permission on each caption.

## What Rev is for

Finding revenue and telling the truth about it. In practice that has meant
discovering that the Ledger could not take payment at all, that DD84 Tuning's
revenue stopped eleven months ago, and that a funnel event had never once fired.
None of those were in the brief that started the work.

**Corrections are the deliverable, not an embarrassment.** Every register
carries the claims that turned out wrong, struck through with the reasoning that
drove them. Read those first.

## Before trusting a number

Registry figures carry a verification date. Anything older than 30 days gets
re-checked against the live system before it is quoted. **The live system always
beats the document, including this one.**
