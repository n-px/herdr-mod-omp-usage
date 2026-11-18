// Reads omp's own usage ledger (~/.omp/stats.db, table `messages`: one row per model
// reply with its tokens and cost) through the sqlite3 CLI, read-only.

import { exec, home } from "herdr";

export const RANGES = [
  { id: "today", label: "Today", days: 1 },
  { id: "week", label: "Week", days: 7 },
  { id: "month", label: "Month", days: 30 },
  { id: "year", label: "Year", days: 365 },
  { id: "all", label: "All", days: null },
];

export const rangeOf = (id) => RANGES.find((r) => r.id === id) ?? RANGES[0];

const dbPath = () => `${home()}/.omp/stats.db`;

const SUMS = `
  'requests', count(*),
  'sessions', count(distinct session_file),
  'input', coalesce(sum(input_tokens), 0),
  'output', coalesce(sum(output_tokens), 0),
  'cache_read', coalesce(sum(cache_read_tokens), 0),
  'cache_write', coalesce(sum(cache_write_tokens), 0),
  'tokens', coalesce(sum(total_tokens), 0),
  'cost', coalesce(sum(cost_total), 0),
  'unpriced', coalesce(sum(cost_unpriced), 0)`;

// Ranges are rolling and end today: Week is today and the 6 days before it. The start is
// computed by sqlite in the machine's time zone, so days match the ones it groups by.
function sql(range) {
  const back = range.days == null ? null : range.days - 1;
  const since = back == null
    ? "0"
    : `cast(strftime('%s', 'now', 'localtime', 'start of day', '-${back} days', 'utc') as integer) * 1000`;
  const bucket = range.id === "today" ? "%H" : "%Y-%m-%d";
  const local = (fmt) => `strftime('${fmt}', timestamp / 1000, 'unixepoch', 'localtime')`;
  return `
with r(since) as (select ${since}),
     m as (select messages.* from messages, r where timestamp >= r.since)
select json_object(
  'today', date('now', 'localtime'),
  'at', strftime('%H:%M', 'now', 'localtime'),
  'first', (select ${local("%Y-%m-%d")} from m order by timestamp limit 1),
  'total', (select json_object(${SUMS}, 'days', count(distinct ${local("%Y-%m-%d")})) from m),
  'models', (select json_group_array(json(j)) from (
    select json_object('model', model, 'provider', provider, ${SUMS}) j
    from m group by provider, model)),
  'buckets', (select json_group_array(json_object('k', k, 'tokens', tokens, 'cost', cost)) from (
    select ${local(bucket)} k, sum(total_tokens) tokens, sum(cost_total) cost from m group by k))
);`;
}

/** Resolves with { today, at, first, total, models[], buckets[] } or rejects with a readable Error. */
export async function load(range) {
  let r;
  try {
    r = await exec("sqlite3", ["-readonly", dbPath(), sql(range)], { timeout: 20000 });
  } catch (e) {
    throw new Error(`Couldn't run sqlite3: ${e?.message ?? e}`);
  }
  if (r.code !== 0) {
    const why = r.stderr.trim().split("\n")[0] || `sqlite3 exited ${r.code}`;
    throw new Error(/unable to open|no such table/.test(why) ? `No omp usage data at ~/.omp/stats.db (${why})` : why);
  }
  const data = JSON.parse(r.stdout);
  data.models.sort((a, b) => b.cost - a.cost || b.tokens - a.tokens);
  return data;
}

const DAY_MS = 86400000;
// Day keys are walked in UTC so the script's own time zone never matters.
const dayAt = (key, offset) => new Date(Date.parse(`${key}T00:00:00Z`) + offset * DAY_MS).toISOString().slice(0, 10);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const dayLabel = (key, year = false) => `${MONTHS[Number(key.slice(5, 7)) - 1]} ${Number(key.slice(8, 10))}${year ? `, ${key.slice(0, 4)}` : ""}`;

/** Every hour of today, or every day of the range, with what was used in it (zeros included). */
export function timeline(range, data) {
  const used = new Map(data.buckets.map((b) => [b.k, b]));
  const cell = (k, label) => ({ k, label, tokens: used.get(k)?.tokens ?? 0, cost: used.get(k)?.cost ?? 0 });
  if (range.id === "today") {
    return Array.from({ length: 24 }, (_, h) => {
      const k = String(h).padStart(2, "0");
      return cell(k, `${k}:00`);
    });
  }
  const span = Math.round((Date.parse(data.today) - Date.parse(data.first ?? data.today)) / DAY_MS) + 1;
  const count = range.days ?? Math.max(span, 1);
  return Array.from({ length: count }, (_, i) => {
    const k = dayAt(data.today, i - count + 1);
    return cell(k, dayLabel(k, count > 300));
  });
}

/** Brings omp's ledger up to date with its session files: what `omp stats` does before it
 *  prints (incremental, well under a second once it has run before). */
export async function sync() {
  // A window started from the Dock may not have the folder omp was installed to on its PATH.
  const places = ["omp", ...[".bun/bin", ".local/bin", ".npm-global/bin"].map((d) => `${home()}/${d}/omp`), "/opt/homebrew/bin/omp", "/usr/local/bin/omp"];
  let r = null;
  for (const omp of places) {
    r = await exec(omp, ["stats", "--summary"], { timeout: 180000 }).catch(() => null);
    if (r) break;
  }
  if (!r) throw new Error("omp isn't on the PATH or in ~/.bun/bin, ~/.local/bin, Homebrew");
  if (r.code !== 0) throw new Error(r.stderr.trim().split("\n")[0] || `omp stats exited ${r.code}`);
}
