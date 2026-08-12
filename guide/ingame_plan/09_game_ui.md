# 09. Game UI

## HUD priority

1. Core Integrity
2. Wave timer / Overtime / Siege Pressure
3. Tower group: living count, Living Share, Lost Share, aggregate/selected HP
4. Five sentence slots and Subject counts
5. Gold
6. Lane/objective risk

Tower HP is required. Do not retain the old no-HP HUD rule.

## Sentence editor/preview

Read [`../gameplay/07_ui_preview_and_feedback.md`](../gameplay/07_ui_preview_and_feedback.md).
Preview uses runtime formulas and shows allegiance, generated actors, share dilution, bounty,
Siege Pressure, cooldown, and capacity.

Valid dangerous sentences remain executable. Invalid/capacity-impossible sentences show a precise
reason.

## No-Tower state

Show `NO LIVING TOWERS`, keep Subject-valid skills available, and do not display game over solely from
Tower count.

## Large counts

Use aggregate/histogram/budgeted world labels. Do not allocate one UI widget per Tower/Enemy when
hundreds exist.
