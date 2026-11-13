// Collects upcoming programming contests from several platforms into data/contests.json.
// Runs on a schedule in GitHub Actions (those sites don't allow a web page to read them directly), and the
// Nitya app + Mission Control's coach read the JSON from GitHub Pages. Every source is optional: one failing
// source never blanks the others, and the previous file is kept for any source that failed this run.
import { readFile, writeFile } from "node:fs/promises";
const UA = { "User-Agent": "Mozilla/5.0 (compatible; nitya-contest-calendar/1.0; +https://padmanabh-r-das.github.io/nitya/)" };
const now = Date.now(), horizon = now + 35 * 864e5;
const iso = (ms) => new Date(ms).toISOString();
const keep = (c) => c.start && Date.parse(c.start) > now - 3 * 3600e3 && Date.parse(c.start) < horizon;
async function getJSON(url, opts = {}) { const r = await fetch(url, { ...opts, headers: { ...UA, ...(opts.headers || {}) } }); if (!r.ok) throw new Error(url + " " + r.status); return r.json(); }
const SOURCES = {
  cf: async () => {
    const j = await getJSON("https://codeforces.com/api/contest.list?gym=false");
    return j.result.filter((c) => c.phase === "BEFORE").map((c) => {
      const n = c.name, div = /Div\.?\s*4/i.test(n) ? 4 : /Div\.?\s*3/i.test(n) ? 3 : /Educational/i.test(n) ? "edu" : /Div\.?\s*2/i.test(n) ? 2 : /Div\.?\s*1/i.test(n) ? 1 : "other";
      return { p: "cf", id: "cf" + c.id, name: n, start: iso(c.startTimeSeconds * 1000), dur: Math.round(c.durationSeconds / 60), url: "https://codeforces.com/contests/" + c.id, rated: !/unrated|kotlin/i.test(n), div };
    });
  },
  lc: async () => {
    const j = await getJSON("https://leetcode.com/graphql", { method: "POST", headers: { "Content-Type": "application/json", Referer: "https://leetcode.com/contest/" },
      body: JSON.stringify({ query: "{ upcomingContests { title titleSlug startTime duration } }" }) });
    return (j.data.upcomingContests || []).map((c) => ({ p: "lc", id: "lc-" + c.titleSlug, name: c.title, start: iso(c.startTime * 1000), dur: Math.round(c.duration / 60), url: "https://leetcode.com/contest/" + c.titleSlug, rated: true, div: /biweekly/i.test(c.title) ? "biweekly" : "weekly" }));
  },
  cc: async () => {
    const j = await getJSON("https://www.codechef.com/api/list/contests/all?sort_by=START&sorting_order=asc&offset=0&mode=all");
    return (j.future_contests || []).map((c) => ({ p: "cc", id: "cc-" + c.contest_code, name: c.contest_name, start: new Date(c.contest_start_date_iso).toISOString(), dur: +c.contest_duration || 120, url: "https://www.codechef.com/" + c.contest_code, rated: /rated|starters/i.test(c.contest_name), div: /starters/i.test(c.contest_name) ? "starters" : "other" }));
  },
  ac: async () => {
    const r = await fetch("https://atcoder.jp/contests/?lang=en", { headers: UA }); if (!r.ok) throw new Error("atcoder " + r.status);
    const html = await r.text(), sec = html.split('id="contest-table-upcoming"')[1] || "";
    const body = sec.split("</tbody>")[0] || "", out = [];
    for (const row of body.split("<tr>").slice(1)) {
      const t = (row.match(/<time class='fixtime fixtime-full'>([^<]+)<\/time>/) || row.match(/<time[^>]*>([^<]+)<\/time>/) || [])[1];
      const a = row.match(/<a href="\/contests\/([^"]+)">([^<]+)<\/a>/), d = (row.match(/<td class="text-center">(\d\d):(\d\d)<\/td>/) || []);
      if (!t || !a) continue;
      const start = new Date(t.replace(" ", "T").replace(/\+(\d\d)(\d\d)$/, "+$1:$2")).toISOString();
      out.push({ p: "ac", id: "ac-" + a[1], name: a[2].trim(), start, dur: d.length ? (+d[1]) * 60 + (+d[2]) : 100, url: "https://atcoder.jp/contests/" + a[1], rated: /^abc|^arc|^agc/.test(a[1]), div: a[1].slice(0, 3) });
    }
    return out;
  },
  hr: async () => {
    const j = await getJSON("https://www.hackerrank.com/rest/contests/upcoming?limit=50");
    return (j.models || []).filter((c) => c.epoch_starttime * 1000 > now).map((c) => ({ p: "hr", id: "hr-" + c.slug, name: c.name, start: iso(c.epoch_starttime * 1000), dur: c.epoch_endtime ? Math.round((c.epoch_endtime - c.epoch_starttime) / 60) : 120, url: "https://www.hackerrank.com/contests/" + c.slug, rated: false, div: "other" }));
  }
};
let prev = {}; try { prev = JSON.parse(await readFile("data/contests.json", "utf8")); } catch (e) {}
const out = { v: 1, fetchedAt: iso(now), sources: {}, contests: [] };
for (const [k, fn] of Object.entries(SOURCES)) {
  try { const list = (await fn()).filter(keep); out.sources[k] = { ok: true, n: list.length, at: iso(now) }; out.contests.push(...list); }
  catch (e) { const old = (prev.contests || []).filter((c) => c.p === k).filter(keep); out.sources[k] = { ok: false, n: old.length, at: (prev.sources || {})[k]?.at || null, err: String(e.message || e).slice(0, 120) }; out.contests.push(...old); }
}
out.contests.sort((a, b) => a.start < b.start ? -1 : 1);
// stable file: only rewrite when the contest list itself changed
const sig = (o) => JSON.stringify(o.contests);
if (prev.contests && sig(prev) === sig(out)) { console.log("no change", Object.entries(out.sources).map(([k, v]) => k + ":" + v.n).join(" ")); }
else { await writeFile("data/contests.json", JSON.stringify(out, null, 1) + "\n"); console.log("written", out.contests.length, Object.entries(out.sources).map(([k, v]) => k + ":" + (v.ok ? v.n : "FAIL")).join(" ")); }
