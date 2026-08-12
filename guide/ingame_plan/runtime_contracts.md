# Runtime Contracts

## Session ownership

- `GameScene` owns one session `GameSystem`.
- `GameObjectSystem` is the sole endpoint lifecycle/fixed/presentation/draw owner.
- CPU domain owns Core Integrity, Gold, words, TowerGroup/Lost Share, phase/wave/shop/map/run state.
- GPU World owns authoritative actor/projectile transforms, collision, combat HP, death, and large subject execution.

## Fixed outcome contracts

- Exact identity and generation checks precede domain mutation.
- Tower death updates Lost Share exactly once and is not RunFailed.
- Core Integrity zero emits one RunFailed transition.
- Subject snapshot excludes same-execution creations.
- Split/merge/actor batch transactions are atomic.
- Capacity rejection is a normal no-cooldown result, not recovery.
- Protocol/registry/backend desync is recovery.

## Phase contracts

```text
COMBAT → OVERTIME → SETTLEMENT → SHOP
```

Overtime exists only after timer expiry with live/pending hostile actors. Wave clear ignores Tower count.

## Input contracts

One semantic Tower-group controller and one SentenceBoard route commands. Skills remain usable according
to Subject existence when no Tower lives.
