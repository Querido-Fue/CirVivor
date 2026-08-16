# 04. Input and Control

## R3 current binding (2026-08-16)

The five-slot Sentence input contract is live. The production showcase binds Q to
`The Tower shoots Enemies` and E to `Enemies shoot Enemies`; Shift/Space and the remaining slot stay available
for later loadouts. `InputActionMapper` emits one semantic pressed edge, `SentenceSlotController` maps it to a
slot, and `WordSystem` queues the fixed-boundary activation. Duplicate edges, wrong phase, empty/invalid slot,
cooldown, zero subject, and atomic capacity rejection never fabricate execution or consume cooldown.

## Semantic actions

Physical input is converted before gameplay consumption.

```text
MOVE_VECTOR
PRIMARY_POINTER_FIRE
SKILL_SHIFT
SKILL_SPACE
SKILL_Q
SKILL_E
CAMERA_ZOOM
PAUSE / UI actions
```

LMB is not the same semantic action as Space.

## Tower group control

A single `IPlayerControllable` Tower-group capability receives movement and Aim Point. It broadcasts
movement through a GPU Tower selector rather than enqueuing one CPU command per Tower.

```text
MOVE_VECTOR
→ all alive Player Tower bodies
```

Each Tower resolves attacks from its own authoritative position to the shared Aim Point.

## Sentence controls with zero Towers

Skill availability is based on the compiled Subject selector, not Tower count.

In current R3, Q therefore has zero subjects after Tower death while E remains executable whenever hostile
Enemies exist. `Enemies shoot The Tower` in the examples below is a future Tower Payload sentence, not current
R3 production behavior.

```text
The Tower shoots Fireballs → disabled if no Tower
Fireballs emit Lightning Bolts → enabled if Fireballs exist
Enemies shoot The Tower → enabled if Enemies exist
Walls shoot Bullets → enabled if Walls exist
```

## Camera

Use a bounded GPU Tower-group summary. Never full-read Tower transforms each frame.

Priority baseline:

1. live Tower share-weighted centroid/bounds;
2. other player-owned persistent subjects/structures;
3. Core.

## Context routing

Shop, modal, pause, and status overlays may consume actions before gameplay. Opening a higher context
must not mutate gameplay state or duplicate fixed input edges.
