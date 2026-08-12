# 00. Authority, Decisions, and Scope

## Authority

Current gameplay decisions live in [`../gameplay/`](../gameplay/README.md). This implementation plan
must follow them even when current code has not caught up.

## Locked scope corrections

### A-001 — Tower HP and death are required

- Tower has current/max HP and can die.
- GPU World is the combat authority for Tower HP/death in GPU sessions.
- CPU run domain owns Tower share/Lost Share and consumes exact Tower death once.
- Tower death does not directly fail the run.

### A-002 — Enemy is a normal Entity Word

- Enemy may be purchased in the ordinary word shop.
- Enemy is valid as Subject and Payload.
- Player-created enemies are real hostiles with bounty, AI, wave, and Overtime participation.

### A-003 — Sandbox validity is structural, not strategic

- Self-destructive or economy-oriented sentences are allowed.
- Only grammar, type, exact identity, capacity, transaction, and phase constraints can reject execution.

### A-004 — Core is the default loss resource

- `Core Integrity <= 0` is default defeat.
- zero living Towers is a playable state.

### A-005 — Tower stat conservation

- Tower creation dilutes living Max HP/Power/current HP according to the shared ledger.
- dead share becomes Lost and cannot return during the run.
- Merge combines living values only.

### A-006 — Existing GPU migration is preserved

- Keep the completed mixed GPU World, exact identity, bounded event/readback, source-relative projectile,
  session recovery, and storage-limit contracts.
- The historical migration's no-HP rule was scoped to the migration and is superseded by A-001.
- Do not implement Tower HP by reverting Tower to CPU physics.

## Out of scope for the first gameplay slice

- arbitrary mid-wave full GPU checkpoint;
- all word types and modifiers;
- every actor-kind Merge conservation rule;
- friendly-fire vocabulary;
- swept CCD redesign;
- multiplayer/network synchronization.

## Required first slice

```text
Tower HP/death
Walker Core-only
Hunter Tower-only
Archer route + hostile Bullet
Core direct damage
zero-Tower continuation
Enemy Subject/Payload minimal runtime
Tower share ledger
Tower create/split and Merge transaction
wave timer + Overtime pressure
```
