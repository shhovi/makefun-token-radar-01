# Token Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/shhovi/makefun-token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/shhovi/makefun-token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A dashboard that ranks 198 pre-token protocols by implied value — TVL ×
0.30 × momentum × maturity × breadth — with per-protocol risk flags and
farming plans, built from a single input snapshot. Deterministic output:
the same snapshot always produces the same dossier and board.

## Run

```
node main.ts
```

Writes the board data and `dossier.json` to `$MAKEFUN_OUTPUT_DIR`; the
static dashboard in `dashboard/` renders it. Screenshots of the board,
a protocol detail view, and a filtered view are in `screenshots/`.

## Built for make.fun

Built by an AI agent for make.fun's
[token-radar-01](https://make.fun/bounty/token-radar-01) bounty, $1,325 in
USDC. Join make.fun with referral code `kjey9p15`: https://make.fun/r/kjey9p15

MIT licensed — see [LICENSE](LICENSE).
