# 09. Open Gameplay Decisions

Do not hard-code these without an explicit decision. Preserve policy seams and use data/config for
prototype values.

| ID | Question | Current baseline / constraint |
| --- | --- | --- |
| O-G04 | Merge execution | staged movement preferred; speed/channel/interruption undecided |
| O-G05 | Actor spawn grace | narrow source-pair grace; exact ticks/pairs data-owned |
| O-G06 | Enemy default spawned by generic `Enemy` word | basic Corebound baseline; exact definition/tier undecided |
| O-G07 | Overtime formula | prototype formula exists; tuning data-owned |
| O-G08 | Early wave end | only when no hostile/pending spawn; inclusion and UX undecided |
| O-G09 | Hostile target tie-break | distance → share → entity ID baseline; modifiers may override |
| O-G10 | Player-created enemy bounty scaling | ordinary bounty baseline; anti-infinite-economy tuning undecided |
| O-G11 | Hostile transient projectile cleanup at Wave Clear | clear by default unless it can spawn actors; exact grace undecided |
| O-G12 | Enemy/Tower Merge generalization | Tower Merge required; other entity-kind conservation rules future work |
| O-G13 | Friendly fire modifiers | baseline disabled; conversion/reflect vocabulary future work |
| O-G15 | Mid-wave authoritative checkpoint | not implemented; safe-boundary restart remains current policy |
| O-G16 | CPU fallback after Tower HP/multi-Tower | no gameplay parity promised yet; unsupported-mode policy needs decision |
| O-G17 | Body pool reserves | persistent/hostile/projectile allocation percentages need stress data |
| O-G18 | Core direct attack model | repeated attack vs arrival damage per EnemyDefinition |

Resolved decisions must move to the owning gameplay document and be removed from this table.
