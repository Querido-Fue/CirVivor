# 07. UI Preview and Sandbox Feedback

## Post-R3 implementation status (2026-08-17)

R3 exposes bounded, deep-frozen runtime preview/status data for the five Sentence slots, exact subject/generated
counts, required/available body capacity, hostile result count, bounty potential, Siege Weight, danger warning,
cooldown, Gold, and live/pending hostile participation. Preview and execution share the same selector and actor
payload budget formulas; a danger warning does not disable an otherwise valid execution.

Preview preserves `rawSubjectCount`, `eligibleSubjectCount`, `previewSubjectCount`, `subjectBudget`,
`countExact`, capacity validity, and execution state as separate facts. It never truncates an over-budget raw
count into an executable preview.

This is a presentation seam, not the full Shop/editor/HUD product. The current visible GameScene status renderer
still renders the existing Tower/Core lines. Five-offer Shop cards, Sentence editing, rich preview panels, and
large Tower-group HUD visualization remain future UI work.

## 1. UI principle

The UI explains consequences without censoring valid sentences.

```text
valid + dangerous
→ warning + enabled execute

invalid/capacity impossible
→ precise reason + disabled execute
```

## 2. Sentence preview uses runtime formulas

Preview and runtime must share:

- subject selection count;
- actor creation count;
- Tower share allocation;
- current/max HP redistribution;
- Power redistribution;
- bounty potential;
- Siege Weight and projected Overtime DPS;
- world body/command capacity;
- cooldown and action cost;
- target/allegiance result.

No duplicated UI-only arithmetic.

Current Subject-budget boundary (`budget = 1000`):

| Raw/eligible | Preview/new | Enabled | Reason |
| ---: | ---: | --- | --- |
| 999 | 999 | yes | — |
| 1000 | 1000 | yes | — |
| 1001 | 0 | no | `SUBJECT_BUDGET_EXCEEDED` |

An exact one-short destination capacity disables execution with `DESTINATION_CAPACITY_EXCEEDED`; active
cooldown uses `COOLDOWN_ACTIVE`. A dangerous but otherwise valid result stays enabled.

## 3. Examples

Only the Enemy-payload examples that do not create Towers are current R3 runtime examples. The
`Enemies shoot The Tower` preview remains a future Tower Payload/Tower Share target.

### The Tower shoots Enemies

```text
Subjects: Towers ×4
New Enemies: +4
Resulting Hostiles: 22
Potential Bounty: +8 Gold
Siege Weight: 18 → 22
Projected initial Overtime DPS: 1.4 → 1.6
```

### Enemies shoot The Tower

```text
Subjects: Enemies ×127
New Towers: +127
Total Living Towers: 128
Living Share: 100%
Projected average Max HP: 0.234
Projected average Power: 0.078
Warning: Tower stats will be heavily diluted.
```

The execute control remains enabled if capacity and transaction rules pass.

### Enemies shoot Enemies

```text
Current Enemies: 80
New Enemies: +80
Resulting Enemies: 160
Potential Bounty increase: +160 Gold
Siege Weight: 80 → 160
```

## 4. Tower HUD

Required group summary:

```text
TOWERS: count
LIVING SHARE: percent
LOST SHARE: percent
CORE INTEGRITY
```

Tower health presentation may be:

- compact list for a small count;
- aggregate histogram/health bands for a large count;
- selected/primary Tower details;
- world-space bars only under a visibility/count budget.

Do not render hundreds of full DOM/Canvas labels.

## 5. Tower death feedback

A Tower death must communicate permanent run loss:

```text
TOWER SHARE LOST
12.5% cannot be restored this run.
```

This is separate from ordinary damage and from Core damage.

## 6. Merge preview

```text
Selected Living Share: 75%
Selected Current HP: 16
Result: 1 Tower, Max HP 22.5, Power 7.5, Current HP 16
Lost Share 25% remains lost.
```

## 7. No-Tower state

When living Tower count reaches zero:

- do not show game-over solely for that reason;
- indicate `NO LIVING TOWERS`;
- keep skill slots enabled by actual Subject availability;
- move camera fallback according to policy;
- show Core Integrity as the remaining defeat resource.

## 8. Enemy objective icons

Suggested world/HUD indicators:

- Core icon: Corebound;
- Tower icon: Hunter;
- Core + ranged icon: Harasser;
- Structure icon: Sapper;
- impact marker: Throw/Artillery.

## 9. Capacity feedback

```text
Required bodies: 500
Available bodies: 412
Execution unavailable: atomic world capacity exceeded.
```

Capacity is a technical validity reason. The UI must not quietly create 412 of 500.

## 10. Shop card

R3 provides this ordinary Enemy offer metadata to future Shop UI; it does not implement purchase/reroll/editor
transactions.

Enemy card is an ordinary word offer. Card metadata should explain:

```text
Entity Word
Subject + Payload
Payload team: Hostile
Bounty: definition-based
Counts toward Overtime pressure
```

It must not be styled as a mandatory curse/threat contract unless a separate content system is later
explicitly added.
