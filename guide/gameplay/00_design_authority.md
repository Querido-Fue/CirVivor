# 00. Gameplay Design Authority

## Product statement

Lonely Tower is an action tower-defense roguelite in which the player buys words, composes executable
sentences, and can manipulate both player and hostile actors. The mobile Tower defends a fixed Core
across increasingly complex routed maps. A valid sentence may be strong, weak, profitable,
self-destructive, or absurd; the engine executes the defined result rather than judging intent.

## LOCKED decisions

### G-001 — Literal sandbox execution

- A valid sentence is executed literally.
- The validator checks grammar, type compatibility, world capacity, identity, and transaction safety.
- The validator does not reject a sentence because it is strategically bad.
- Warnings and previews are informational.
- Objects created during an execution do not join that execution's subject snapshot.

### G-002 — Enemy is a normal obtainable Entity Word

- `Enemy` appears in the ordinary word pool and can be purchased from the regular five-offer shop.
- The player decides how to use it.
- `Enemy` may be a Subject and a Payload.
- Player-created enemies are real hostile actors, not temporary fake targets.
- They participate in Gold, wave cleanup, Overtime pressure, targeting, death, and later sentence selection.

### G-003 — The Tower is a damageable actor

- Every living Tower has current HP and maximum HP.
- Tower health and death are GPU-authoritative combat state in GPU World.
- Tower death is permanent for the dead Tower's stat share during the current run.
- There is no automatic reboot that restores lost share.

### G-004 — Tower count zero is not a defeat condition

- The default defeat condition is `Core Integrity <= 0`.
- The game continues with zero living Towers while any valid subject/effect can still act.
- Existing projectiles, structures, effects, or hostile subjects may finish the wave after the last Tower dies.
- A final projectile may kill the last enemy and produce victory with zero Towers alive.

### G-005 — Tower creation dilutes a conserved living stat budget

- All living Towers share the remaining living Tower stat budget.
- Creating Towers does not create free base HP or base Power.
- `The Tower shoots The Tower`, `Enemies shoot The Tower`, and other Tower payload sentences use the same dilution rules.
- A dead Tower's share moves to Lost Share and cannot be returned to Living Share during the run.
- Merge combines only living share and current HP; it does not restore Lost Share.

### G-006 — Subject and payload allegiance are independent

- `The Tower` payload is always Player-aligned.
- `Enemy` payload is always Hostile-aligned.
- Bullet, Fireball, Lightning Bolt, Wall, Mine, and similar neutral payload nouns normally inherit the Subject team.
- Therefore `Enemies shoot Fireballs` creates hostile Fireballs, while `The Tower shoots Enemies` creates hostile enemies.

### G-007 — Enemy attacks normally target Towers

- Hostile projectiles and hostile active attacks default to a living Tower target.
- If no living Tower exists, a hostile targeting policy may fall back to the Core.
- Exact behavior varies by verb, modifier, and EnemyDefinition.

### G-008 — Enemy behavior is data-authored per definition

- Some enemies ignore Towers and move to the Core.
- Some attack Towers while continuing toward the Core.
- Some leave the route and hunt Towers.
- Some prioritize structures.
- Behavior and physical response are separate policies.

### G-009 — Player-created enemies may be a Gold strategy

- A player-created enemy uses ordinary bounty rules unless a future explicit word changes them.
- It is included in hostile counts and Overtime pressure.
- The cost of farming is combat risk, time, skill-slot opportunity, and Core pressure rather than a hidden no-bounty exception.

### G-010 — Overtime closes the farming loop

- The combat timer may expire while enemies remain.
- Remaining enemies keep acting.
- Their aggregate Siege Pressure deals escalating Core damage over time until hostile cleanup completes.
- Player-created enemies contribute exactly like scheduled enemies.

## BASELINE decisions

- Run base Tower Max HP: `30`.
- Run base Tower Power: `10`.
- Core Integrity baseline: `100`.
- `Enemy` initially spawns the basic Corebound enemy definition; specific enemy nouns may be added later.
- All living Towers receive the same movement intent and share one world aim point.
- Camera follows a share-weighted Tower group summary; if no Tower lives it falls back to player-owned subjects, then Core.
- Player/Hostile friendly fire is disabled unless an explicit modifier changes allegiance or damage policy.
- Capacity failure rejects an execution atomically and consumes no cooldown.

## OPEN decisions

See [`09_open_decisions.md`](09_open_decisions.md). Do not invent fallback values for merge travel,
Overtime coefficients, hostile target selection modifiers, actor spawn grace, or save/checkpoint timing.

## Superseded rules

The following older rules are no longer product authority:

- Tower has no HP or death.
- Enemy is only an internal target tag.
- Tower count reaching zero necessarily ends a run.
- Enemy words belong in a separate threat-contract system.
- A low design cap such as four Towers is mandatory.

Historical migration docs may still contain these statements as phase-specific scope limits. They must
not be used to reject current gameplay implementation.
