# The Math Maker

Build a haunted hotel one floor at a time. Every new floor is earned at a locked door: a Door Codes-style code, or a challenge from a guest who checks in from another game. Floor 50 gets a ★ and opens the next tower.

- The whole game is `public/index.html`: Canvas 2D + Web Audio, no image or audio files.
- Preview: `bun server.ts` (127.0.0.1:4852; set `HOST` to reach it from another device).
- Deploy: `npm run deploy` (assets-only Worker on Red Leg Dev). Pushing does not deploy.
- Live: https://math-maker.mattgwagner.workers.dev

## Tests

- `npm run fuzz`: every challenge generator, checked against its own text with independent arithmetic, plus the event plan's rationing rule over 900 seeds.
- `npm run play [shotsDir]`: Playwright at iPad size climbs floors 1 to 12, jumps to 49, takes the ★, finishes the Inkwell into the Starscraper and the Starscraper into the all-built lobby, checks new guests in, then stages every `?test=` event. Needs playwright-core (found in `~/Code/killsaws`) and `/usr/bin/chromium`.
- `npm run check` runs both.

## Debug hooks

- `?debug` exposes `window.__mm`: `state`, `ch`, `setFloor(n)`, `setTower(i)`, `checkIn(guestId)`, `solve()`, `doorPos()`, `sample(kind, level)`.
- `?test=star | journal | guest:<guestId or eventId>` stages that event within seconds (a Door Codes visitor like `guest:andy` stages a plain door they check in after). `?speed=4` speeds up animations.

## Saves

Per player, the Door Codes pattern: `mathmaker.players` holds `{list, cur}` and each player's game is `mathmaker.v1.<id>`. A player picks Grade 1–2, Grade 3–4 or Pre-Algebra codes.
