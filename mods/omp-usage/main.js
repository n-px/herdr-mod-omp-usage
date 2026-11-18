// OMP Usage: what omp (oh-my-pi) consumed in a date range (Today, Week, Month, Year, All):
// tokens, estimated cost, activity over time, the token mix, and which models it went to.
// Opened as a dialog with `mod.open {name: "omp-usage"}`.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, props, closeOverlay, checking } from "herdr";
import { RANGES, rangeOf, load, sync, timeline, dayLabel } from "./data.js";

const I = (name) => `mods/omp-usage/icons/${name}.svg`;
const PAD = 24;
const GAP = 12;
const MIX_W = 300;
const CARD_PAD = 18;
const REFRESH_MS = 2 * 60 * 1000;

// Theme colors are #rrggbb; one that already carries alpha is left alone.
const alpha = (color, aa) => (color?.length === 7 ? color + aa : color);

const group3 = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

function compact(n) {
  if (n < 1000) return String(Math.round(n));
  for (const [size, unit] of [[1e9, "B"], [1e6, "M"], [1e3, "K"]]) {
    if (n < size) continue;
    const v = n / size;
    return `${v >= 100 ? Math.round(v) : v.toFixed(unit === "B" ? 2 : 1)}${unit}`;
  }
  return String(n);
}

function money(n) {
  const cents = Math.round(n * 100);
  return `$${group3(Math.floor(cents / 100))}.${String(cents % 100).padStart(2, "0")}`;
}

function percent(share) {
  if (!(share > 0)) return "0%";
  const p = share * 100;
  if (p < 0.1) return "<0.1%";
  return `${p < 10 ? p.toFixed(1) : Math.round(p)}%`;
}

const plural = (n, word) => `${compact(n)} ${word}${n === 1 ? "" : "s"}`;

export default class OmpUsage extends View {
  init(_props, cx) {
    this.range = rangeOf(localStorage.getItem("range")).id;
    this.cache = {}; // range id -> what the ledger said last
    this.error = null;
    this.syncError = null;
    this.busy = 0;
    if (checking()) return;
    this.refresh(cx, true);
    cx.timer.every(REFRESH_MS, (cx) => this.refresh(cx, true));
  }

  // Shows the ledger as it is at once; with `fresh`, then has omp bring it up to date and reads again.
  refresh(cx, fresh) {
    if (fresh && this.syncing) return;
    if (fresh) this.syncing = true;
    this.busy++;
    cx.notify();
    cx.spawn(async (cx) => {
      await this.read(cx);
      if (fresh) {
        try {
          await sync();
          this.syncError = null;
          // Every range changed, not only the shown one.
          this.cache = { [this.range]: this.cache[this.range] };
        } catch (e) {
          this.syncError = e?.message ?? String(e);
        }
        this.syncing = false;
        await this.read(cx);
      }
      this.busy--;
      cx.notify();
    });
  }

  async read(cx) {
    const id = this.range;
    try {
      this.cache[id] = await load(rangeOf(id));
      this.error = null;
    } catch (e) {
      this.error = e?.message ?? String(e);
    }
    cx.notify();
  }

  pick(id, cx) {
    if (id === this.range) return;
    this.range = id;
    localStorage.setItem("range", id);
    this.refresh(cx, false);
  }

  // ---- pieces -------------------------------------------------------------------------

  card(t) {
    return v_flex().rounded(10).border(1).border_color(t.border).bg(t.background);
  }

  pill(t, text) {
    return div().flex_none().px(8).h(22).rounded(11).border(1).border_color(t.border).flex().items_center()
      .text_size(11.5).text_color(t.foreground).whitespace_nowrap().child(text);
  }

  rangePicker(t) {
    return h_flex().flex_none().p(3).gap(2).rounded(9).bg(t.raised).border(1).border_color(t.border).items_center()
      .children(RANGES.map((r) => {
        const on = r.id === this.range;
        return div()
          .id(`ou-range-${r.id}`)
          .px(11).h(24).rounded(6).flex().items_center().text_size(12).font_medium().cursor_pointer()
          .text_color(on ? t.foreground : t.muted)
          .when(on, (el) => el.bg(t.background).border(1).border_color(t.border))
          .when(!on, (el) => el.hover((s) => s.text_color(t.foreground)))
          .tooltip(r.days == null ? "Everything omp recorded" : r.days === 1 ? "Since midnight" : `The last ${r.days} days, today included`)
          .on_click((_e, cx) => this.pick(r.id, cx))
          .child(r.label);
      }));
  }

  iconButton(t, id, icon, label, onClick, spinning = false) {
    const glyph = svg(I(icon)).size(14).flex_none().text_color(t.muted);
    return div()
      .id(id).size(28).rounded(7).flex().items_center().justify_center().cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .tooltip(label)
      .on_click((_e, cx) => onClick(cx))
      .child(spinning ? glyph.spin(900) : glyph);
  }

  header(t, data) {
    const range = rangeOf(this.range);
    const overlay = props()?.overlay;
    let span = "";
    if (data) {
      const cells = timeline(range, data);
      span = range.id === "today" ? dayLabel(data.today, true) : `${cells[0].label} – ${dayLabel(data.today, true)}`;
    }
    const status = this.syncing ? "Syncing with omp…" : data ? `Updated ${data.at}` : "";
    return h_flex().flex_none().px(PAD).pt(20).pb(16).gap(GAP).items_center()
      .child(div().size(34).flex_none().rounded(9).bg(t.raised).flex().items_center().justify_center()
        .child(svg("icons/omp.svg").size(18).text_color(t.foreground)))
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(div().text_size(17).font_semibold().text_color(t.foreground).child("OMP Usage"))
        .child(div().text_size(12).text_color(t.muted).truncate().child([span, status].filter(Boolean).join("  ·  "))))
      .child(this.rangePicker(t))
      .child(this.iconButton(t, "ou-refresh", "refresh", "Sync with omp and read again", (cx) => this.refresh(cx, true), this.busy > 0))
      .when(Boolean(overlay), (el) => el.child(this.iconButton(t, "ou-close", "x", "Close", () => closeOverlay(overlay))));
  }

  tile(t, icon, value, label, hint) {
    return h_flex()
      .id(`ou-tile-${icon}`)
      .flex_1().min_w(0).px(16).h(72).gap(14).items_center().rounded(10).border(1).border_color(t.border).bg(t.background)
      .tooltip(hint)
      .child(div().size(38).flex_none().rounded(9).bg(t.raised).flex().items_center().justify_center()
        .child(svg(I(icon)).size(17).text_color(t.muted)))
      .child(v_flex().min_w(0).gap(1)
        .child(div().text_size(20).font_semibold().text_color(t.foreground).whitespace_nowrap().child(value))
        .child(div().text_size(12).text_color(t.muted).truncate().child(label)));
  }

  tiles(t, data, cells) {
    const s = data.total;
    const prompt = s.input + s.cache_read + s.cache_write;
    const hourly = this.range === "today";
    const active = hourly ? cells.filter((c) => c.tokens > 0).length : s.days;
    return h_flex().flex_none().gap(GAP)
      .child(this.tile(t, "zap", compact(s.tokens), "Total tokens", `${group3(s.tokens)} tokens: input, output and cache`))
      .child(this.tile(t, "coins", money(s.cost), "Est. cost", s.unpriced > 0
        ? `What these tokens cost at API prices. ${group3(s.unpriced)} requests had no price and count as $0.`
        : "What these tokens cost at API prices, as omp estimates it"))
      .child(this.tile(t, "calendar", String(active), hourly ? "Active hours" : "Active days", hourly ? "Hours of today with at least one request" : "Days with at least one request"))
      .child(this.tile(t, "database", percent(prompt ? s.cache_read / prompt : 0), "Cache share", "Share of the prompt tokens that were read from cache"));
  }

  activity(t, cells) {
    const hourly = this.range === "today";
    const max = Math.max(0, ...cells.map((c) => c.tokens));
    const best = max > 0 ? cells.find((c) => c.tokens === max) : null;
    const [size, gap] = cells.length <= 31 ? [20, 4] : cells.length <= 120 ? [14, 3] : [10, 3];
    const shade = [t.raised, alpha(t.foreground, "30"), alpha(t.foreground, "60"), alpha(t.foreground, "a0"), t.foreground];
    const level = (c) => (c.tokens > 0 ? Math.min(4, Math.max(1, Math.ceil((c.tokens / max) * 4))) : 0);
    const square = (px, lv) => div().size(px).flex_none().rounded(px > 12 ? 4 : 2).bg(shade[lv])
      .when(lv === 0, (el) => el.border(1).border_color(t.border));
    return this.card(t).flex_1().min_w(0).p(CARD_PAD).gap(14)
      .child(h_flex().gap(8).items_center()
        .child(v_flex().flex_1().min_w(0).gap(2)
          .child(div().text_size(14).font_semibold().text_color(t.foreground).child(hourly ? "Hourly intensity" : "Daily intensity"))
          .child(div().text_size(12).text_color(t.muted).truncate().child(hourly ? "Tokens per hour of today, all models." : "Tokens per day, all models.")))
        .when(Boolean(best), (el) => el.child(this.pill(t, `Best: ${best.label}`))))
      .child(h_flex().w_full().flex_wrap().gap(gap).children(cells.map((c) => square(size, level(c))
        .id(`ou-cell-${c.k}`)
        .tooltip(c.tokens > 0 ? `${c.label}: ${compact(c.tokens)} tokens, ${money(c.cost)}` : `${c.label}: nothing`))))
      .child(h_flex().items_center().justify_between().text_size(11.5).text_color(t.muted)
        .child(div().child(cells[0].label))
        .child(h_flex().gap(8).items_center()
          .child(div().child("Less"))
          .child(h_flex().gap(3).items_center().children(shade.map((_c, lv) => square(9, lv))))
          .child(div().child("More")))
        .child(div().child(cells.at(-1).label)));
  }

  mix(t, s) {
    const parts = [
      { id: "input", label: "New input", value: s.input, color: t.ansi4 ?? t.accent },
      { id: "output", label: "Output", value: s.output, color: t.ansi2 ?? t.working },
      { id: "cache_read", label: "Cache read", value: s.cache_read, color: alpha(t.foreground, "70") },
      { id: "cache_write", label: "Cache write", value: s.cache_write, color: t.ansi3 ?? t.done },
    ];
    const sum = parts.reduce((n, p) => n + p.value, 0);
    return this.card(t).w(MIX_W).flex_none().p(CARD_PAD).gap(14)
      .child(v_flex().gap(2)
        .child(div().text_size(14).font_semibold().text_color(t.foreground).child("Token mix"))
        .child(div().text_size(12).text_color(t.muted).child("Input, output and cache tokens.")))
      // Each part grows by its share; a small one still keeps 3px.
      .child(h_flex().w_full().h(8).gap(2).flex_none().rounded(4)
        .when(sum === 0, (el) => el.bg(t.raised))
        .children(parts.filter((p) => p.value > 0).map((p) => div().h(8).min_w(3).flex_basis(0).flex_grow(p.value / sum).rounded(3).bg(p.color))))
      .child(v_flex().gap(7).text_size(12).children(parts.map((p) => h_flex().gap(8).items_center()
        .child(div().size(8).flex_none().rounded(4).bg(p.color))
        .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(p.label))
        .child(div().flex_none().text_color(t.foreground).child(compact(p.value)))
        .child(div().w(42).flex_none().flex().justify_end().text_color(t.dim).child(percent(sum ? p.value / sum : 0))))));
  }

  modelCard(t, m, total) {
    const byCost = total.cost > 0;
    const share = byCost ? m.cost / total.cost : total.tokens ? m.tokens / total.tokens : 0;
    return this.card(t)
      .id(`ou-model-${m.provider}-${m.model}`)
      .flex_1().min_w(0).p(16).gap(10)
      .tooltip(`${group3(m.input)} input, ${group3(m.output)} output, ${group3(m.cache_read)} cache read, ${group3(m.cache_write)} cache write`)
      .child(h_flex().gap(8).items_center()
        .child(div().min_w(0).truncate().text_size(14).font_semibold().text_color(t.foreground).child(m.model))
        .child(div().flex_none().px(7).h(19).rounded(10).bg(t.raised).flex().items_center().text_size(10.5).text_color(t.muted).whitespace_nowrap().child(m.provider))
        .child(div().flex_1())
        .child(div().flex_none().text_size(12).text_color(t.muted).whitespace_nowrap().child(`${percent(share)} of ${byCost ? "cost" : "tokens"}`)))
      .child(h_flex().gap(8).items_center().text_size(12.5).text_color(t.muted)
        .child(div().w(108).flex_none().whitespace_nowrap().child(`${compact(m.tokens)} tokens`))
        .child(div().flex_1().min_w(0).truncate().child(`${plural(m.sessions, "session")} · ${plural(m.requests, "request")}`))
        .child(div().flex_none().text_color(t.foreground).font_medium().whitespace_nowrap().child(money(m.cost))))
      .child(div().w_full().h(6).flex_none().rounded(3).bg(t.raised)
        .when(share > 0, (el) => el.child(div().h(6).min_w(3).rounded(3).bg(t.foreground).w(`${(share * 100).toFixed(2)}%`))))
      .child(div().text_size(11).text_color(t.dim).truncate()
        .child(`in ${compact(m.input)} · out ${compact(m.output)} · cache ${compact(m.cache_read + m.cache_write)}`));
  }

  models(t, data) {
    const s = data.total;
    const rows = [];
    for (let i = 0; i < data.models.length; i += 2) rows.push(data.models.slice(i, i + 2));
    return v_flex().flex_none().gap(GAP)
      .child(h_flex().items_center().gap(8)
        .child(v_flex().flex_1().min_w(0).gap(2)
          .child(div().text_size(14).font_semibold().text_color(t.foreground).child("Models"))
          .child(div().text_size(12).text_color(t.muted).child(data.models.length
            ? `${plural(data.models.length, "model")}, most expensive first`
            : "No omp usage in this range.")))
        .when(s.requests > 0, (el) => el.child(h_flex().flex_none().px(9).h(24).gap(6).rounded(12).border(1).border_color(t.border).items_center()
          .child(svg(I("activity")).size(12).flex_none().text_color(t.muted))
          .child(div().text_size(11.5).text_color(t.foreground).whitespace_nowrap().child(`${plural(s.sessions, "session")} · ${plural(s.requests, "request")}`)))))
      .children(rows.map((pair) => h_flex().gap(GAP).items_stretch()
        .children(pair.map((m) => this.modelCard(t, m, s)))
        .when(pair.length === 1, (el) => el.child(div().flex_1().min_w(0)))));
  }

  note(t, text, color) {
    return div().flex_none().px(12).py(8).rounded(8).bg(t.raised).text_size(12).text_color(color).child(text);
  }

  render() {
    const t = theme();
    const data = this.cache[this.range] ?? null;
    const body = v_flex().id("ou-body").flex_1().min_h(0).px(PAD).pb(PAD).gap(GAP).overflow_y_scrollbar();
    if (this.error) body.child(this.note(t, this.error, t.blocked));
    if (this.syncError) body.child(this.note(t, `Couldn't sync with omp, so this may be behind: ${this.syncError}`, t.muted));
    if (data) {
      const cells = timeline(rangeOf(this.range), data);
      body
        .child(this.tiles(t, data, cells))
        .child(h_flex().flex_none().gap(GAP).items_stretch()
          .child(this.activity(t, cells))
          .child(this.mix(t, data.total)))
        .child(this.models(t, data));
    } else if (!this.error) {
      body.child(div().py(40).flex().justify_center().text_size(12.5).text_color(t.muted).child("Reading omp usage…"));
    }
    return v_flex()
      .id("ou-root")
      .size_full()
      .bg(t.popover)
      .text_size(13)
      .text_color(t.foreground)
      .child(this.header(t, data))
      .child(body);
  }
}
