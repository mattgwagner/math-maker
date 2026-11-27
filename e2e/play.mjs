// Plays the game headless at iPad size: sets up a player, climbs floors 1 to 12 by tapping the door and the
// keypad, jumps to floor 49, takes the ★, then checks the staged ?test= events. Usage: node e2e/play.mjs [shotsDir]
// VW / VH set the viewport (default iPad Air portrait, 820×1180).
import { launch, pageUrl } from "./pw.mjs";
import { mkdirSync } from "node:fs";
const out = process.argv[2] || "/tmp/math-maker-shots";
mkdirSync(out, { recursive: true });
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: +process.env.VW || 820, height: +process.env.VH || 1180 }, deviceScaleFactor: 1 });
const errors = [];
const watch = p => { p.on("pageerror", e => errors.push(e.message)); p.on("console", m => m.type() === "error" && !/fonts\.g/.test(m.text()) && errors.push(m.text())); };
const page = await ctx.newPage(); watch(page);
const ev = f => page.evaluate(f);
const check = (ok, what) => { if (!ok) { console.log("FAIL", what); failed = true; } else console.log("ok  ", what); };
let failed = false;

await page.goto(pageUrl("?debug&speed=4"));
await page.waitForFunction(() => window.__mm);
await page.screenshot({ path: `${out}/0-home.png` });
await page.click("#playBtn");
check(await page.locator("#playersScr h2").textContent() === "Who am I?", "first-time player screen says Who am I?");
await page.click('.levels button[data-l="times"]');
await page.click("#plDone");
await page.waitForSelector("#hud:not([hidden])");

const visible = sel => page.locator(sel).isVisible();
/** Climb one floor: tap the door, answer, pick a room, clear any event screens. */
async function climb(n) {
  await page.waitForFunction(() => !__mm.busy && __mm.doorPos());
  await page.waitForTimeout(150);
  const d = await ev(() => __mm.doorPos());
  await page.mouse.click(d.x, d.y);
  await page.waitForSelector("#ch:not([hidden])");
  const kinds = new Set();
  for (let guard = 0; guard < 40 && await visible("#ch"); guard++) {
    const ch = await ev(() => __mm.ch);
    if (!ch) { await page.waitForTimeout(100); continue; }
    kinds.add(ch.kind);
    if (ch.q && await page.locator(".pad button:not([disabled])").count()) {
      for (const k of String(ch.q.answer).replace("-", "−")) await page.click(`.pad button[data-k="${k}"]`);
      await page.click('.pad button[data-k="ok"]');
    } else await ev(() => __mm.solve());
    await page.waitForTimeout(250);
  }
  await page.waitForSelector("#cardsScr:not([hidden])", { timeout: 15000 });
  if (n === 1) await page.screenshot({ path: `${out}/1-room-cards.png` });
  await page.locator("#cardsScr .cards button").first().click();
  for (let guard = 0; guard < 60; guard++) {
    if (await visible("#eventScr")) { await page.screenshot({ path: `${out}/event-floor-${n}.png` }); await page.click("#evOk"); }
    if (!(await ev(() => __mm.busy))) break;
    await page.waitForTimeout(200);
  }
  await page.waitForFunction(() => !__mm.busy);
  return [...kinds].join("+");
}

for (let n = 1; n <= 12; n++) {
  const kind = await climb(n);
  const built = await ev(() => __mm.state.floors.length);
  check(built === n, `floor ${n} built (${kind})`);
  if (n === 6 || n === 12) await page.screenshot({ path: `${out}/2-floor-${n}.png` });
}
check(await ev(() => Object.keys(__mm.state.met).length > 0), "guests checked in");
check(await ev(() => Object.keys(__mm.state.facts).length > 0), "math facts recorded");

// Jump to 49 and take the star
await ev(() => __mm.setFloor(49));
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/3-floor-49.png` });
await climb(50);
const s = await ev(() => ({ stars: __mm.state.stars, tower: __mm.state.tower, floors: __mm.state.floors.length, done: __mm.state.done.length }));
check(s.stars === 1 && s.done === 1, `★ awarded for tower 1 (stars ${s.stars})`);
check(s.tower === 1 && s.floors === 0, "next tower opened (Lantern Station)");
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/4-lantern-station.png` });

// Finish the Inkwell: the Starscraper opens next
await ev(() => { __mm.state.done.push({ id: "lantern", floors: [] }); __mm.setTower(2); __mm.setFloor(49); });
await page.waitForTimeout(300);
await climb(50);
const s3 = await ev(() => ({ tower: __mm.state.tower, floors: __mm.state.floors.length, done: __mm.state.done.length, name: document.getElementById("towerName").textContent }));
check(s3.tower === 3 && s3.floors === 0 && s3.done === 3, `finishing tower 3 opens tower 4 (${s3.name})`);
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/5-starscraper.png` });
for (const n of [12, 49]) { await page.evaluate(n => __mm.setFloor(n), n); await page.waitForTimeout(500); await page.screenshot({ path: `${out}/5-starscraper-${n}.png` }); }
// ...and finishing the Starscraper with every tower done goes back to the lobby: all built
await climb(50);
await page.waitForSelector("#home:not([hidden])");
const tag = await page.locator("#homeTag").textContent();
check(/All 4 towers are built/.test(tag), `all towers built: "${tag}"`);
await page.screenshot({ path: `${out}/6-all-built.png` });
await page.click("#playBtn");
await page.waitForSelector("#eventScr:not([hidden]) .levels button");
check(await page.locator("#eventScr .levels button").count() === 4, "build-again lists all 4 towers");
await page.screenshot({ path: `${out}/6-build-again.png` });
await page.click('#eventScr .levels button[data-t="1"]');
await page.waitForSelector("#hud:not([hidden])");
check(await ev(() => __mm.state.tower === 1 && __mm.state.floors.length === 0), "build-again starts the picked tower");

// The save survives a reload, per player
await page.reload(); await page.waitForFunction(() => window.__mm);
check(await ev(() => __mm.state.stars === 3 && __mm.state.tower === 1), "save survives reload");

// The player screen is "Who am I?", opened from the lobby button of the same name
check((await page.locator("#playerBtn").textContent()).trim().endsWith("· Who am I?"), "lobby button shows the player and Who am I?");
await page.click("#playerBtn");
check(await page.locator("#playersScr h2").textContent() === "Who am I?", "player screen heading is Who am I?");
await page.screenshot({ path: `${out}/who-am-i.png` });
await page.click("#plBack");

// Move-In Day at desktop size, by real mouse clicks: a room one square short is a miss, then the right room opens the door
{
  const dctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 });
  const p = await dctx.newPage(); watch(p);
  await p.goto(pageUrl("?debug&speed=4&test=guest:movein"));
  await p.waitForSelector(".roomgrid button");
  const ans = await p.evaluate(() => __mm.ch.answer);
  const wish = await p.locator("#chAsk").textContent();
  check(wish.includes(`${ans.area} squares inside`) && (!ans.perim || wish.includes(`${ans.perim} fence pieces`)), `movein wish shows its numbers: ${wish}`);
  const cell = ([x, y]) => p.locator(`.roomgrid button[data-c="${x},${y}"]`);
  for (const c of ans.cells.slice(0, -1)) await cell(c).click();
  await p.click("#mvDone");
  await p.waitForTimeout(200);
  const wrong = { open: await p.locator("#ch").isVisible(), bad: await p.locator("#chMsg.bad").count(), misses: await p.evaluate(() => __mm.state.misses) };
  check(wrong.open && wrong.bad === 1 && wrong.misses === 1, `a room one square short is a miss (${await p.locator("#chMsg").textContent()})`);
  await p.screenshot({ path: `${out}/movein-wrong.png` });
  await cell(ans.cells.at(-1)).click();
  await p.click("#mvDone");
  let opened = true;
  try { await p.waitForSelector("#cardsScr:not([hidden])", { timeout: 8000 }); } catch { opened = false; }
  check(opened, "the right room opens the door");
  await p.locator("#cardsScr .cards button").first().click();
  await p.waitForFunction(() => !__mm.busy, null, { timeout: 15000 });
  const after = await p.evaluate(() => ({ who: __mm.state.floors.at(-1).guests.find(id => __mm.EVENTS.movein.guest.includes(id)), sticker: !!__mm.state.stickers.movein }));
  check(after.who && !after.sticker, `a Move-In Day friend (${after.who}) moved in, no sticker after a miss`);
  await dctx.close();
}

// A save that finished the first 3 towers (from before the Starscraper) gets it on the next resume
{
  const p = await ctx.newPage(); watch(p);
  await p.goto(pageUrl("?debug&speed=4"));
  await p.waitForFunction(() => window.__mm);
  await p.evaluate(() => { const S = __mm.state; S.done = ["gloomsbury", "lantern", "inkwell"].map(id => ({ id, floors: [] })); __mm.setTower(2); __mm.setFloor(50); __mm.goHome(); });
  await p.click("#playBtn");
  await p.waitForSelector("#hud:not([hidden])");
  check(await p.evaluate(() => __mm.state.tower === 3 && __mm.state.floors.length === 0), "an old all-done save resumes into the Starscraper");
  await p.close();
}

// New guests check in: the sign and note doors bring Comic Cop and Creakwood guests, Door Codes visitors come on a plain door
for (const id of ["rummage", "snipper", "tock", "wick", "andy", "fluff"]) {
  const p = await ctx.newPage(); watch(p);
  await p.goto(pageUrl(`?debug&speed=4&test=guest:${id}`));
  let ok = true;
  try {
    await p.waitForSelector("#ch:not([hidden])", { timeout: 12000 });
    await p.waitForTimeout(500);
    await p.screenshot({ path: `${out}/guest-${id}-door.png` });
    for (let guard = 0; guard < 40 && await p.locator("#ch").isVisible(); guard++) { await p.evaluate(() => __mm.solve()); await p.waitForTimeout(300); }
    await p.waitForSelector("#cardsScr:not([hidden])", { timeout: 15000 });
    await p.locator("#cardsScr .cards button").first().click();
    await p.waitForFunction(() => !__mm.busy, null, { timeout: 15000 });
    await p.waitForTimeout(500);
    await p.screenshot({ path: `${out}/guest-${id}-room.png` });
  } catch (e) { ok = false; console.log(e.message.split("\n")[0]); }
  const met = await p.evaluate(id => !!__mm.state.met[id] && __mm.state.floors.at(-1).guests.includes(id), id);
  check(ok && met, `${id} checks in`);
  await p.close();
}

// Clonk by real taps: a brick that was right last round and wrong this round must not end the door
{
  const p = await ctx.newPage(); watch(p);
  await p.goto(pageUrl("?debug&speed=4&test=guest:clonk"));
  await p.waitForSelector(".bricks button");
  let prev = -1, ok = true;
  for (let round = 0; round < 3; round++) {
    await p.waitForFunction(r => document.querySelectorAll(".bricks button:not([disabled])").length === 4 || r === 0, round);
    const ans = await p.evaluate(() => __mm.ch.answer);
    if (prev >= 0 && prev !== ans) { await p.locator(`.bricks button[data-i="${prev}"]`).click(); await p.waitForTimeout(150); if (await p.locator(".bricks button:not([disabled])").count() === 0) ok = false; }
    await p.locator(`.bricks button[data-i="${ans}"]`).click();
    prev = ans; await p.waitForTimeout(500);
  }
  try { await p.waitForSelector("#cardsScr:not([hidden])", { timeout: 8000 }); } catch { ok = false; }
  check(ok, "Clonk door finishes when tapped through, including a stale brick tap");
  await p.close();
}

// Staged tests
for (const [test, wait] of [["star", "#eventScr:not([hidden])"], ["journal", "#journal:not([hidden])"], ["guest:clonk", "#ch:not([hidden])"], ["guest:wedge", "#ch:not([hidden])"], ["guest:express", "#ch:not([hidden])"], ["guest:grumble", "#ch:not([hidden])"], ...["chase", "note", "sign", "lights", "desk", "register", "train", "movein"].map(k => [`guest:${k}`, "#ch:not([hidden])"])]) {
  const p = await ctx.newPage(); watch(p);
  await p.goto(pageUrl(`?debug&speed=4&test=${test}`));
  let ok = true;
  try { await p.waitForSelector(wait, { timeout: 12000 }); } catch { ok = false; }
  await p.waitForTimeout(600);
  await p.screenshot({ path: `${out}/test-${test.replace(":", "-")}.png` });
  check(ok, `?test=${test} stages its event`);
  await p.close();
}

await browser.close();
check(errors.length === 0, `no page errors${errors.length ? ": " + errors.slice(0, 5).join(" | ") : ""}`);
console.log(`screenshots in ${out}`);
process.exit(failed ? 1 : 0);
