// End-to-end smoke test against a running server (desktop + mobile).
// Usage: BASE_URL=http://localhost:3000 APP_PASSWORD=... node tests/e2e/smoke.mjs
// Requires an EMPTY database: it imports the initial dataset through the UI.
import { chromium } from "playwright-core";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const PASSWORD = process.env.APP_PASSWORD;
const SHOTS = process.env.SCREENSHOT_DIR ?? "screenshots";
const executablePath = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const browser = await chromium.launch({ executablePath });
const errors = [];
let step = "";
// isVisible() does not wait; this waits up to 10s for an element before asserting.
const visible = (page, sel) => page.waitForSelector(sel, { timeout: 10_000 }).then(() => true, () => false);
const check = (cond, msg) => {
  if (!cond) throw new Error(`[${step}] ${msg}`);
  console.log(`  ✓ ${msg}`);
};

async function run(name, viewport) {
  console.log(`\n== ${name} ${viewport.width}x${viewport.height}`);
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`${name} console: ${m.text()}`));
  const shot = (n) => page.screenshot({ path: `${SHOTS}/${name}-${n}.png`, fullPage: true });

  step = "login";
  await page.goto(`${BASE}/practice`);
  check(page.url().includes("/login"), "unauthenticated visit redirects to login");
  if (PASSWORD) {
    await page.fill("#password", "wrong-password");
    await page.click("button:has-text('Sign in')");
    await page.waitForSelector("text=Incorrect password");
    check(true, "wrong password rejected");
    await page.fill("#password", PASSWORD);
    await page.click("button:has-text('Sign in')");
    await page.waitForURL(`${BASE}/practice`);
    check(true, "signed in and returned to requested page");
  }
  return { ctx, page, shot };
}

// ---------------- desktop: full workflow
{
  const { ctx, page, shot } = await run("desktop", { width: 1280, height: 860 });
  step = "empty dashboard";
  await page.goto(`${BASE}/`);
  await page.waitForSelector("main h1");
  const empty = await page.isVisible("text=Your question bank is empty");
  if (empty) {
    await shot("01-empty-dashboard");
    step = "import";
    await page.goto(`${BASE}/import`);
    await page.click("button:has-text('Preview initial dataset')");
    await page.waitForSelector("text=Confirm how the document was read");
    check(await visible(page, "text=192 questions found"), "preview finds 192 questions");
    check(await visible(page, "text=No “Mock test N” headings were found"), "missing mock headings reported as ambiguity");
    check(await page.isDisabled("button:has-text('Import 192 questions')"), "import blocked until interpretation confirmed");
    await page.check("text=Split in order: every");
    await page.fill("input[aria-label='Questions per mock test']", "24");
    await page.waitForSelector("text=Mock 8: #169–192");
    await page.check("text=I have checked how the answers");
    await shot("02-import-preview");
    await page.click("button:has-text('Import 192 questions')");
    await page.waitForSelector("text=Import complete");
    check(await visible(page, "dd:has-text('192')"), "192 questions imported");
    await shot("03-import-report");

    step = "re-import";
    await page.click("button:has-text('Import another file')");
    await page.click("button:has-text('Preview initial dataset')");
    await page.waitForSelector("text=This exact file was already imported");
    check(await visible(page, "text=0 new"), "re-upload shows 0 new questions");
    check(await visible(page, "button:has-text('Import 0 questions')"), "all duplicates rejected by default");
  }

  step = "dashboard";
  await page.goto(`${BASE}/`);
  await page.waitForSelector("text=Questions in bank");
  check(await visible(page, "text=100/192"), "original mock results shown (100/192)");
  await shot("04-dashboard");

  step = "question bank";
  await page.goto(`${BASE}/questions?category=dates`);
  await page.waitForSelector("text=match your filters");
  const dateCount = await page.locator("main ul > li.card").count();
  check(dateCount > 10, `date category lists ${dateCount} questions`);
  await page.goto(`${BASE}/questions?q=Wars+of+the+Roses`);
  await page.waitForSelector("text=2 questions match your filters");
  check((await page.locator("main ul > li.card").count()) === 2, "search finds both Wars of the Roses questions");
  await page.goto(`${BASE}/questions?exam=2`);
  await page.waitForSelector("text=match your filters");
  check(await visible(page, "text=Mock 2 · Q1"), "mock exam 2 numbered from Q1");
  await shot("05-question-bank");

  step = "quick practice";
  await page.goto(`${BASE}/practice?mode=quick`);
  await page.selectOption("#count", "10");
  await page.click("button:has-text('Start')");
  await page.waitForURL(/\/practice\/[0-9a-f-]{36}/);
  for (let i = 0; i < 10; i++) {
    await page.waitForSelector("button:has-text('Check answer'), button:has-text('Show answer')");
    const multi = await visible(page, "text=/Choose \\d/");
    const opts = page.locator("[role=radio], [role=checkbox]");
    await opts.nth(0).click();
    if (multi) await opts.nth(1).click();
    if (i === 0) await page.click("button:has-text('Sure')");
    await page.click("button:has-text('Check answer')");
    await page.waitForSelector("[role=status]:has-text('Correct'), [role=status]:has-text('Incorrect')");
    if (i === 0) await shot("06-practice-feedback");
    await page.click(i === 9 ? "button:has-text('Finish')" : "button:has-text('Next')");
  }
  await page.waitForSelector("text=Quick practice complete");
  check(true, "quick practice session completed");
  await shot("07-practice-summary");

  step = "persistence";
  await page.reload();
  check(await visible(page, "text=Quick practice complete"), "finished session survives a refresh");
  const ctx2 = await browser.newContext({ storageState: await ctx.storageState() });
  const p2 = await ctx2.newPage();
  await p2.goto(`${BASE}/`);
  await p2.waitForSelector("text=Practice accuracy");
  check(await visible(p2, "text=/\\d+ correct · \\d+ incorrect/"), "progress visible in a new browser session");
  const statText = await p2.locator("text=/\\d+ correct · \\d+ incorrect/").first().textContent();
  const [c, w] = statText.match(/\d+/g).map(Number);
  check(c + w === 10, `dashboard counts 10 answers (${c} correct, ${w} incorrect)`);
  await ctx2.close();

  step = "weak areas";
  await page.goto(`${BASE}/practice?mode=weak`);
  await page.click("button:has-text('Start')");
  await page.waitForURL(/\/practice\/[0-9a-f-]{36}/);
  await page.click("summary:has-text('Why this question?')");
  check(await visible(page, "li:has-text('wrong')"), "weak-area question explains why it was chosen");
  await shot("08-weak-areas");
  await page.click("button:has-text('reveal')");
  await page.click("button:has-text(\"I didn't know\")");
  await page.waitForSelector("[role=status]:has-text('Incorrect')");
  check(true, "reveal + self-mark records an answer");

  step = "exam simulation";
  await page.goto(`${BASE}/practice?mode=exam`);
  await page.click("button:has-text('Start')");
  await page.waitForSelector("[role=timer]");
  check(/4[45]:\d\d/.test(await page.locator("[role=timer]").textContent()), "45-minute timer running");
  await page.locator("[role=radio], [role=checkbox]").first().click();
  await shot("09-exam");
  await page.reload();
  await page.waitForSelector("[role=timer]");
  check(await visible(page, "button[aria-label='Question 1, answered']"), "exam answers survive a refresh");
  page.once("dialog", (d) => d.accept());
  await page.click("button:has-text('Submit exam (')");
  await page.waitForSelector("text=Exam simulation complete");
  check(await visible(page, "text=pass mark 18/24"), "exam marked with 18/24 pass mark");

  step = "training";
  for (const kind of ["timeline", "numbers", "names", "matching", "compare", "flashcards"]) {
    await page.goto(`${BASE}/train/${kind}`);
    check(!(await visible(page, "text=Not enough")), `${kind} has data`);
  }
  await page.goto(`${BASE}/train/numbers`);
  await page.fill("#num", "129");
  await page.click("button:has-text('Check')");
  await page.waitForSelector("text=the answer is");
  await shot("10-number-drill");
  await page.goto(`${BASE}/train/timeline`);
  await page.click("button:has-text('Check order')");
  await page.waitForSelector("text=in the right position");
  await shot("11-timeline");

  step = "edit question";
  await page.goto(`${BASE}/questions?q=Scottish+Parliament+have`);
  await page.click("main ul > li.card a");
  await page.waitForSelector("text=Original (as imported)");
  await page.fill("#aid", "129 MSPs — Holyrood");
  await page.click("button:has-text('Save changes')");
  await page.waitForSelector("text=Saved.");
  check(true, "memory aid saved");
  await shot("12-question-detail");

  step = "progress";
  await page.goto(`${BASE}/progress`);
  await page.waitForSelector("text=Accuracy by category");
  check(await visible(page, "text=Mock test 1"), "progress shows per-mock accuracy");
  await shot("13-progress");

  step = "backup";
  await page.goto(`${BASE}/data`);
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("text=Download full backup")]);
  check(/life-in-uk-backup-.*\.json/.test(dl.suggestedFilename()), "backup downloads");
  await ctx.close();
}

// ---------------- mobile: key pages render without horizontal scroll
{
  const { ctx, page, shot } = await run("mobile", { width: 390, height: 844 });
  for (const [path, n] of [["/", "dashboard"], ["/practice", "practice"], ["/questions", "questions"], ["/train/flashcards", "flashcards"], ["/progress", "progress"], ["/import", "import"]]) {
    step = `mobile ${path}`;
    await page.goto(`${BASE}${path}`);
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(overflow <= 1, `${path} fits the screen (overflow ${overflow}px)`);
    await shot(n);
  }
  step = "mobile menu";
  await page.click("button:has-text('Menu')");
  check(await visible(page, "#mobile-nav >> text=Question bank"), "mobile menu opens");
  await page.goto(`${BASE}/practice?mode=quick`);
  await page.click("button:has-text('Start')");
  await page.waitForSelector("button:has-text('Check answer')");
  await page.locator("[role=radio], [role=checkbox]").first().click();
  await page.click("button:has-text('Check answer')");
  await page.waitForSelector("button:has-text('Next')");
  await shot("practice-question");
  await ctx.close();
}

await browser.close();
const relevant = errors.filter((e) => !/Failed to load resource.*(401|409)/.test(e));
if (relevant.length) {
  console.error("\nBrowser errors:\n" + relevant.join("\n"));
  process.exit(1);
}
console.log("\nAll smoke checks passed.");
