// Fuzzes every challenge generator. The game hands back what it shows the player; this file works the
// answer out again from that text with its own arithmetic and fails if they disagree.
// Also checks the event plan: the Sky Tower rationing rule over many seeds. Usage: node e2e/fuzz.mjs [rounds]
import { launch, pageUrl } from "./pw.mjs";
const N = +process.argv[2] || 400;
const browser = await launch();
const page = await browser.newPage();
const errors = [];
page.on("pageerror", e => errors.push(e.message));
await page.goto(pageUrl("?debug"));
await page.waitForFunction(() => window.__mm);
const sample = (kind, mode) => page.evaluate(([k, m]) => __mm.sample(k, m), [kind, mode]);
const fails = [];
const fail = (kind, why, data) => { if (fails.length < 40) fails.push({ kind, why, data }); };
const MODES = ["plus", "times", "alg"];

/* ---------- Door codes: evaluate the shown expression or equation */
function toJs(s) {
  return s.replace(/−/g, "-").replace(/×/g, "*").replace(/÷/g, "/").replace(/²/g, "**2").replace(/³/g, "**3")
    .replace(/(\d)\s*x/g, "$1*x").replace(/(\d)\(/g, "$1*(").replace(/\)\(/g, ")*(").replace(/-\s*x/g, "-1*x");
}
function checkCode(q) {
  const t = q.text;
  let m;
  if ((m = t.match(/^(\d+)% of (\d+)$/))) return +m[1] * +m[2] / 100 === q.answer;
  if ((m = t.match(/^(\d+)\/(\d+) of (\d+)$/))) return +m[1] * +m[3] / +m[2] === q.answer;
  if ((m = t.match(/^(\d+) : (\d+) = (\d+) : \?$/))) return +m[1] * q.answer === +m[2] * +m[3];
  if ((m = t.match(/^If x = (−?\d+): (.*)$/))) { const x = +m[1].replace("−", "-"); return Function(`return ${toJs(m[2]).replace(/x/g, `(${x})`)}`)() === q.answer; }
  if (t.includes("=") && t.includes("x")) {
    const [l, r] = t.split("=").map(toJs);
    const f = side => Function("x", `return ${side}`)(q.answer);
    return Math.abs(f(l) - f(r)) < 1e-9;
  }
  const v = Function(`return ${toJs(t).replace(/\(\s*-/g, "(-")}`)();
  return Math.abs(v - q.answer) < 1e-9;
}

/* ---------- Place value: read the clue back into a number */
const PLACE = { thousand: 1000, hundred: 100, ten: 10, one: 1 };
function clueValue(clue) {
  if (/^\d+( \+ \d+)+$/.test(clue)) return clue.split(" + ").reduce((a, x) => a + +x, 0);
  let v = 0; for (const m of clue.matchAll(/(\d) (thousand|hundred|ten|one)(s?)/g)) { if ((m[1] === "1") === (m[3] === "s")) return NaN; v += +m[1] * PLACE[m[2]]; }
  return v;
}

/* ---------- Clock times */
const parseClock = s => { const [h, m] = s.split(":").map(Number); return (h % 12) * 60 + m; };
const parseDur = s => { let m = 0, x; if ((x = s.match(/(\d+) hours?/))) m += 60 * +x[1]; if ((x = s.match(/(\d+) minutes/))) m += +x[1]; return m; };

for (const mode of MODES) {
  for (let i = 0; i < N; i++) {
    const q = await sample("code", mode);
    try { if (!checkCode(q)) fail("code", `answer ${q.answer} doesn't fit "${q.text}"`, q); } catch (e) { fail("code", `couldn't read "${q.text}": ${e.message}`, q); }

    const c = await sample("clonk", mode), v = clueValue(c.clue);
    const hits = c.options.filter(o => o === v).length;
    if (c.options[c.answer] !== v || hits !== 1) fail("clonk", `clue "${c.clue}" = ${v}, options ${c.options}, answer ${c.answer}`, c);
    if (new Set(c.options).size !== c.options.length || c.options.length < 3) fail("clonk", "duplicate or missing bricks", c);

    const w = await sample("wedge", mode);
    if (w.answer * w.b !== w.a * w.slices || w.slices % w.b || w.a < 1 || w.a >= w.b) fail("wedge", `${w.a}/${w.b} of ${w.slices} slices is not ${w.answer}`, w);

    const tr = await sample("train", mode);
    const [s0] = tr.text.match(/leaves at (\d+:\d\d)/).slice(1);
    if (tr.kind === "end") {
      const d = parseDur(tr.text.match(/takes (.*?)\. When/)[1]);
      const want = (parseClock(s0) + d) % 720;
      if (parseClock(tr.options[tr.answer]) !== want) fail("train", `${tr.text} → ${tr.options[tr.answer]}`, tr);
      if (tr.options.filter(o => parseClock(o) === want).length !== 1) fail("train", "two right answers", tr);
    } else {
      const e0 = tr.text.match(/gets there at (\d+:\d\d)/)[1];
      const want = ((parseClock(e0) - parseClock(s0)) + 720) % 720;
      if (parseDur(tr.options[tr.answer]) !== want) fail("train", `${tr.text} → ${tr.options[tr.answer]}`, tr);
      if (tr.options.filter(o => parseDur(o) === want).length !== 1) fail("train", "two right answers", tr);
    }
    if (tr.options.length !== 3) fail("train", "needs 3 choices", tr);

    const r = await sample("register", mode);
    const shown = r.text.includes("$") ? Math.round(+r.text.match(/\$(\d+\.\d\d)/)[1] * 100) : +r.text.match(/(\d+)¢/)[1];
    if (shown !== r.cents) fail("register", `bill shows ${shown}, expects ${r.cents}`, r);
    if (r.fewest) { let n = 0, left = r.cents; for (const c2 of [100, 25, 10, 5, 1]) { n += Math.floor(left / c2); left %= c2; } if (n !== r.fewest) fail("register", `fewest coins for ${r.cents} is ${n}, game says ${r.fewest}`, r); }

    const d = await sample("desk", mode);
    let want;
    if (d.kind === "most" || d.kind === "least") want = `Floor ${d.floors[d.counts.indexOf((d.kind === "most" ? Math.max : Math.min)(...d.counts))]}`;
    else {
      const fl = [...d.text.matchAll(/\d+/g)].map(m => +m[0]), cnt = f => d.counts[d.floors.indexOf(f)];
      want = String(d.kind === "diff" ? cnt(fl[0]) - cnt(fl[1]) : d.kind === "sum" ? cnt(fl[0]) + cnt(fl[1]) : d.counts.reduce((a, x) => a + x, 0));
    }
    if (d.options[d.answer] !== want) fail("desk", `${d.text} → ${d.options[d.answer]}, chart says ${want}`, d);
    if (new Set(d.floors).size !== 4 || new Set(d.options).size !== d.options.length) fail("desk", "duplicate floors or choices", d);
  }
}

/* ---------- Move-In Day rooms: read the wish, then prove it can be built on the grid with our own shape and counting */
function measure(cells, cols, rows) {
  const on = new Set(cells.map(c => c.join(",")));
  if (cells.some(([x, y]) => x < 0 || y < 0 || x >= cols || y >= rows) || on.size !== cells.length) return null;
  let edges = 0; for (const [x, y] of cells) edges += [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]].filter(c => !on.has(c.join(","))).length;
  const reach = new Set([cells[0].join(",")]), todo = [cells[0]];
  while (todo.length) { const [x, y] = todo.pop(); for (const c of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) { const k = c.join(","); if (on.has(k) && !reach.has(k)) { reach.add(k); todo.push(c); } } }
  return { area: on.size, edges, joined: reach.size === on.size };
}
/** Our own room for (area, fence): a w×h box whose fence is 2(w + h), trimmed one square at a time from the bottom-right corner, staying one piece. */
function ourRoom(area, fence, cols, rows) {
  for (let w = 1; w <= cols; w++) for (let h = 1; h <= rows; h++) {
    if (w * h < area || (fence && 2 * (w + h) !== fence)) continue;
    const cells = []; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) cells.push([x, y]);
    // drop squares from the last rows, right to left, but never the left column or the top row
    let drop = w * h - area;
    for (let y = h - 1; y >= 1 && drop; y--) for (let x = w - 1; x >= 1 && drop; x--) { cells.splice(cells.findIndex(c => c[0] === x && c[1] === y), 1); drop--; }
    if (!drop) return cells;
  }
  return null;
}
async function fuzzRooms(mode, hard) {
  const g = await page.evaluate(([m, h]) => __mm.sample("movein", m, h), [mode, hard]);
  const a = +(g.text.match(/with (\d+) squares inside/) || [])[1], f = +((g.text.match(/and (\d+) fence pieces around it/) || [])[1] || 0);
  if (!a || a !== g.area || f !== g.perim) return fail("movein", `wish "${g.text}" doesn't match area ${g.area} fence ${g.perim}`, g);
  if (mode !== "alg" && (a < 6 || a > 24)) fail("movein", `area ${a} is outside 6–24 in ${mode}`, g);
  if (mode === "alg" && (a < 6 || a > 48)) fail("movein", `area ${a} is outside 6–48 in alg`, g);
  if (mode === "plus" && f) fail("movein", "a fence wish in the first level", g);
  if (mode === "alg" && !f) fail("movein", "pre-algebra always asks for the fence too", g);
  if (f % 2) fail("movein", `fence ${f} is odd, no room has that`, g);
  const mine = ourRoom(a, f, g.cols, g.rows), m = mine && measure(mine, g.cols, g.rows);
  if (!m || !m.joined || m.area !== a || (f && m.edges !== f)) return fail("movein", `can't build "${g.text}" on a ${g.cols}×${g.rows} grid`, { g, m });
  const theirs = measure(g.cells, g.cols, g.rows);
  if (!theirs || !theirs.joined || theirs.area !== a || (f && theirs.edges !== f)) fail("movein", `the game's example room doesn't fit "${g.text}"`, { g, theirs });
  // the game's checker agrees with ours: our room passes, one square short fails, two far-apart pieces fail
  const has = (x, y) => mine.some(c => c[0] === x && c[1] === y), cx = g.cols - 1, cy = g.rows - 1;
  const apart = !has(cx, cy) && !has(cx - 1, cy) && !has(cx, cy - 1) ? mine.slice(0, -1).concat([[cx, cy]]) : null;
  const ok = await page.evaluate(([c, g, apart]) => [__mm.checkRoom(c, g).ok, __mm.checkRoom(c.slice(0, -1), g).ok, apart ? __mm.checkRoom(apart, g).ok : false], [mine, g, apart]);
  if (!ok[0] || ok[1] || ok[2]) fail("movein", `game's checker: our room ${ok[0]}, one short ${ok[1]}, two pieces ${ok[2]}`, g);
}
for (const mode of MODES) for (let i = 0; i < N / 4; i++) { await fuzzRooms(mode, i % 2 === 0); }

/* ---------- Word content: every note and sign, not a sample */
const { NOTES, SIGNS } = await page.evaluate(() => ({ NOTES: __mm.NOTES, SIGNS: __mm.SIGNS }));
for (const n of NOTES) {
  const has = n.lines.map(l => l.toLowerCase().includes(n.key.toLowerCase()));
  if (!has[n.ans] || has.filter(Boolean).length !== 1) fail("note", `"${n.key}" must be in line ${n.ans} only`, n);
}
for (const s of SIGNS) {
  const words = s.right.split(" ");
  if (!words.includes(s.word)) fail("sign", `"${s.word}" isn't in "${s.right}"`, s);
  if (s.zap === s.word || !s.opts.includes(s.word) || !s.opts.includes(s.zap) || new Set(s.opts).size !== 3) fail("sign", "bad options", s);
}
for (let i = 0; i < 60; i++) {
  const g = await sample("sign");
  const fixed = g.words.slice(); fixed[g.zapAt] = g.fix;
  if (fixed.join(" ") !== g.right || g.words.join(" ") === g.right) fail("sign", "fixing the zapped word doesn't give the right sentence", g);
  if (g.words.filter((w, i) => w !== g.right.split(" ")[i]).length !== 1) fail("sign", "more than one word zapped", g);
}

/* ---------- The event plan */
const plans = await page.evaluate(() => { const out = []; for (let s = 1; s <= 300; s++) for (let t = 0; t < __mm.TOWERS; t++) out.push({ s, t, plan: __mm.makePlan(s * 7919, t), events: __mm.EVENTS, top: __mm.TOP }); return out; });
let total = 0;
for (const { s, t, plan, events, top } of plans) {
  const fs = Object.keys(plan).map(Number).sort((a, b) => a - b);
  total += fs.length;
  for (let i = 0; i < fs.length; i++) {
    if (fs[i] > top - 2) fail("plan", `seed ${s} tower ${t}: event on floor ${fs[i]}, inside the last 2`, plan);
    const fixed = f => f % 12 === 0 || (t === 1 && f % 8 === 0);   // Mortimer's shop; the midnight train on Lantern Station
    if (fixed(fs[i]) || fixed(fs[i] - 1) || fixed(fs[i] + 1)) fail("plan", `seed ${s} tower ${t}: event on floor ${fs[i]}, on or next to a shop/midnight floor`, plan);
    if (i && fs[i] - fs[i - 1] < 4) fail("plan", `seed ${s} tower ${t}: floors ${fs[i - 1]} and ${fs[i]} are in the same 4`, plan);
    if (events[plan[fs[i]]].w[t] <= 0) fail("plan", `seed ${s} tower ${t}: ${plan[fs[i]]} isn't in this tower`, plan);
  }
}
const towers = await page.evaluate(() => __mm.TOWERS);
// Move-In Day shows up in every tower, and never more often than the zapped sign
for (let t = 0; t < towers; t++) {
  const mine = plans.filter(p => p.t === t), count = id => mine.reduce((a, p) => a + Object.values(p.plan).filter(e => e === id).length, 0);
  const mv = count("movein"), sg = count("sign");
  if (!mv) fail("plan", `movein never planned in tower ${t}`, null);
  if (mv > sg * 1.25) fail("plan", `movein (${mv}) is more common than sign (${sg}) in tower ${t}`, null);
  console.log(`plan: tower ${t} movein ${mv}, sign ${sg} over ${mine.length} seeds`);
}
if (!plans.some(p => p.t === 3) || towers < 4) fail("plan", `only ${towers} towers checked`, null);
const again = await page.evaluate(() => JSON.stringify(__mm.makePlan(1234, 1)) === JSON.stringify(__mm.makePlan(1234, 1)));
if (!again) fail("plan", "same seed gave a different plan", null);

await browser.close();
if (errors.length) fails.push(...errors.map(e => ({ kind: "page", why: e })));
console.log(`fuzz: ${N} × ${MODES.length} levels × 7 generators, ${NOTES.length} notes, ${SIGNS.length} signs, ${plans.length} plans (avg ${(total / plans.length).toFixed(1)} events per tower)`);
if (fails.length) { for (const f of fails) console.log("FAIL", f.kind, f.why, f.data ? JSON.stringify(f.data).slice(0, 300) : ""); process.exit(1); }
console.log("fuzz: all answers match their text");
