// UI derived from YuJunZhiXue/dsh-purge 1.1.71 (MIT). See LICENSE.
import { h, useEffect, useState } from "../shared/react.js";
import { useT } from "../shared/locale.js";
import { Pill, HelpTip } from "./primitives.js";
import { apiJson } from "../api/client.js";

export function statusKind(st) {
  if (st === "applied" || st === "already") return "ok";
  if (st === "pending") return "wait";
  if (st === "unmatched") return "bad";
  if (st === "partial") return "bad";
  if (st === "drifted") return "bad";
  if (st === "disabled") return "muted";
  if (st === "na") return "ok";
  if (
    st === "missing_file" ||
    st === "skipped" ||
    st === "unlocated" ||
    st === "off"
  )
    return "miss";
  return "bad";
}

export function statusLabel(st, t) {
  if (st === "applied" || st === "already") return t("status.applied");
  if (st === "off") return t("status.skipped");
  if (st === "pending") return t("status.pending");
  if (st === "unmatched") return t("status.unmatched");
  if (st === "partial") return t("status.partial");
  if (st === "drifted") return t("status.drifted");
  if (st === "disabled") return t("status.disabled");
  if (st === "skipped") return t("status.skipped");
  if (st === "missing_file") return t("skip");
  if (st === "unlocated") return t("status.unlocated");
  if (st === "na") return t("status.na");
  return st || t("unknown");
}

export function shimKind(v) {
  if (v === "patched" || v === "n/a") return "ok";
  if (v === "original") return "wait";
  if (v === "missing" || !v) return "miss";
  return "bad";
}

export const LAYER_GROUP = {
  프롬프트: "prompt",
  코드: "code",
  도구: "tools",
  "0.1.5 호환": "compat",
  "0.2.0 호환": "dsh20",
};

export const GROUP_ORDER = ["prompt", "code", "tools", "compat", "dsh20"];

// 항목을 "누가 관리하는지"로 세 묶음으로 나눈다. 상태 페이지의 스위치와 집계도 이 기준을 따른다.
export const PERMISSION_PATCH_IDS = [
  6, 7, 8, 9, 10, 13, 14, 15, 16, 35, 51, 59, 60, 62,
];
export const CONTEXT_PATCH_IDS = [18, 19];
export const NA_PATCH_IDS = [54, 76, 80];

const PERMISSION_SET = new Set(PERMISSION_PATCH_IDS);
const CONTEXT_SET = new Set(CONTEXT_PATCH_IDS);

export function patchGroupOf(id) {
  const n = Number(id);
  if (PERMISSION_SET.has(n)) return "permission";
  if (CONTEXT_SET.has(n)) return "context";
  return "normal";
}

/**
 * 항목 단위 행. `patch_rows` 만 신뢰한다(서버가 88개 항목을 하나씩 내려준다).
 * `state.patches` 는 "표시 그룹"이라 한 그룹이 여러 항목을 묶고 상태도 하나뿐이다.
 * 이것을 항목 목록으로 쓰면 건수가 모자라고 섞인 상태도 하나로 눌린다(1.7.18 에서 고친 부분).
 */
function rowsFromState(state) {
  if (!state || !state.ai_base) return [];
  const source = Array.isArray(state.patch_rows) ? state.patch_rows : null;
  if (source) {
    return source
      .map((p) => ({
        id: Number(p.id),
        st: p.status || "na",
        layer: p.layer || "",
        name: p.name || "",
      }))
      .filter((r) => r.st && Number.isFinite(r.id));
  }
  const names = state.patch_names || {};
  const statusMap = state.patch_status || {};
  if (Object.keys(statusMap).length) {
    return Object.keys(statusMap)
      .map((id) => ({
        id: Number(id),
        st: statusMap[id],
        layer: "",
        name: names[id] || "",
      }))
      .filter((r) => r.st && Number.isFinite(r.id));
  }
  // 옛 페이로드나 픽스처에는 그룹 표만 남는다. 이때는 그룹 단위로만 보여 주고 축소된 입력임을 분명히 밝힌다.
  return (Array.isArray(state.patches) ? state.patches : [])
    .map((p) => ({
      id: Number(p.id),
      st: p.status || "na",
      layer: p.layer || "",
      name: "",
    }))
    .filter((r) => r.st && Number.isFinite(r.id));
}

export function patchRowsOf(state) {
  return rowsFromState(state).filter((r) => r.st !== "na");
}

/** "이 쪽에는 해당 없음"까지 포함한 전체 행. 상태 페이지에서 따로 보여 줄 수 있어야 하지만 분모에는 넣지 않는다. */
export function patchRowsAll(state) {
  return rowsFromState(state);
}

function isNaRow(row) {
  return row.st === "na" || row.st === "skipped" || row.st === "missing_file";
}

/** 네 가지 집계: 적용됨 / 적용 대기 / 사용 안 함 / 이 쪽에는 해당 없음. 뒤의 둘은 서로 겹치지 않고 분모에도 넣지 않는다. */
export function patchGroupCounts(rows) {
  const out = { applied: 0, pending: 0, off: 0, na: 0, total: 0, denom: 0 };
  for (const row of rows || []) {
    out.total += 1;
    if (isNaRow(row)) out.na += 1;
    else if (row.st === "disabled") out.off += 1;
    else if (row.st === "applied" || row.st === "already") out.applied += 1;
    else out.pending += 1;
  }
  out.denom = out.total - out.na;
  return out;
}

export function tallyPatches(rows) {
  const out = {
    applied: 0,
    pending: 0,
    unmatched: 0,
    partial: 0,
    drifted: 0,
    disabled: 0,
    skipped: 0,
    total: 0,
  };
  for (const row of rows || []) {
    out.total += 1;
    if (row.st === "applied" || row.st === "already") out.applied += 1;
    else if (row.st === "pending") out.pending += 1;
    else if (row.st === "unmatched") out.unmatched += 1;
    else if (row.st === "partial") out.partial += 1;
    else if (row.st === "drifted") out.drifted += 1;
    else if (row.st === "disabled") out.disabled += 1;
    else out.skipped += 1;
  }
  return out;
}

function Tile({ kind, label, value, title, text }) {
  return h(
    "div",
    { className: "dshpp-tile is-" + kind },
    h(
      "div",
      { className: "dshpp-tile-k" },
      label,
      h(HelpTip, { title, label }, text),
    ),
    h("div", { className: "dshpp-tile-v" }, String(value)),
  );
}

/** 상단 상태 요약: 대표 숫자 하나 + 네 칸 분석 + 진행 막대. */
export function PatchHealth({ state }) {
  const t = useT();
  if (!state || !state.ai_base) return null;
  const counts = patchGroupCounts(patchRowsAll(state));
  const denom = Math.max(counts.denom, 1);
  const pct = (n) => (n / denom) * 100;
  const verdict = counts.pending
    ? t("health.verdict.pending", { n: counts.pending })
    : t("health.verdict.ok");
  return h(
    "div",
    { className: "dshpp-health" },
    h(
      "div",
      { className: "dshpp-health-top" },
      h(
        "b",
        { className: "dshpp-health-big" },
        String(counts.applied),
        h("small", null, " / " + counts.denom + " " + t("health.denomUnit")),
      ),
      h("span", { className: "dshpp-health-verdict" }, verdict),
    ),
    h(
      "div",
      { className: "dshpp-bar", "aria-hidden": "true" },
      h("i", {
        className: "is-ok",
        style: { width: pct(counts.applied) + "%" },
      }),
      h("i", {
        className: "is-wait",
        style: { width: pct(counts.pending) + "%" },
      }),
      h("i", {
        className: "is-off",
        style: { width: pct(counts.off) + "%" },
      }),
    ),
    h(
      "div",
      { className: "dshpp-tiles" },
      h(Tile, {
        kind: "ok",
        label: t("health.applied"),
        value: counts.applied,
        title: t("health.applied"),
        text: t("health.hint.applied"),
      }),
      h(Tile, {
        kind: "wait",
        label: t("health.pending"),
        value: counts.pending,
        title: t("health.pending"),
        text: t("health.hint.pending"),
      }),
      h(Tile, {
        kind: "off",
        label: t("health.off"),
        value: counts.off,
        title: t("health.off"),
        text: t("health.hint.off"),
      }),
      h(Tile, {
        kind: "na",
        label: t("health.na"),
        value: counts.na,
        title: t("health.na"),
        text: t("health.hint.na"),
      }),
    ),
  );
}

function Switch({ on, busy, label, desc, hintTitle, hint, chip, onToggle }) {
  const t = useT();
  return h(
    "div",
    { className: "dshpp-sw" + (on ? " is-on" : "") },
    h(
      "div",
      { className: "dshpp-sw-h" },
      h(
        "div",
        { className: "dshpp-sw-t" },
        label,
        h(HelpTip, { title: hintTitle, label }, hint),
      ),
      h(
        "button",
        {
          type: "button",
          className: "dshpp-track" + (on ? " is-on" : ""),
          role: "switch",
          "aria-checked": on ? "true" : "false",
          "aria-label": label,
          disabled: busy,
          onClick: onToggle,
        },
        h("span", { className: "dshpp-knob" }),
      ),
    ),
    h("p", { className: "dshpp-sw-d" }, desc),
    h(
      "div",
      { className: "dshpp-sw-f" },
      h("span", { className: "dshpp-chip" + (on ? " is-on" : "") }, chip),
      busy ? h("span", { className: "dshpp-chip" }, t("sw.saving")) : null,
    ),
  );
}

/**
 * 항목 그룹 스위치 두 개. tuning 만 바꾸고 호스트에는 쓰지 않는다.
 * 권한 항목을 꺼도 이미 기록한 파일이 곧바로 되돌아가지는 않고 다음 "적용" 때 반영된다. 이건 의도된 동작이다.
 */
export function PatchGroupSwitches({ state, onSaved }) {
  const t = useT();
  const [flags, setFlags] = useState(null);
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState(null);
  useEffect(() => {
    let alive = true;
    apiJson("/dsh-purge/boost")
      .then((d) => {
        if (!alive || !d || !d.ok) return;
        setFlags({
          permissionPatches: d.permissionPatches !== false,
          contextManagement: d.contextManagement === true,
        });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const counts = patchGroupCounts(patchRowsAll(state));
  const rows = patchRowsAll(state);
  const permApplied = rows.filter(
    (r) => patchGroupOf(r.id) === "permission" && r.st === "applied",
  ).length;
  const permPending = rows.filter(
    (r) => patchGroupOf(r.id) === "permission" && r.st === "pending",
  ).length;
  const ctxApplied = rows.filter(
    (r) => patchGroupOf(r.id) === "context" && r.st === "applied",
  ).length;
  const toggle = (key) => {
    if (!flags || busy) return;
    const next = !flags[key];
    setBusy(key);
    setNote(null);
    apiJson("/dsh-purge/boost", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ [key]: next }),
    })
      .then((d) => {
        if (!d || !d.ok) throw new Error((d && d.error) || "save failed");
        setFlags({
          permissionPatches: d.permissionPatches !== false,
          contextManagement: d.contextManagement === true,
        });
        setNote({ kind: "ok", text: t("sw.saved") });
        if (typeof onSaved === "function") onSaved();
      })
      .catch((e) =>
        setNote({ kind: "error", text: t("sw.fail", { error: String(e) }) }),
      )
      .then(() => setBusy(""));
  };
  const permOn = flags ? flags.permissionPatches : true;
  const ctxOn = flags ? flags.contextManagement : false;
  return h(
    "div",
    null,
    h(
      "div",
      { className: "dshpp-switches" },
      h(Switch, {
        on: permOn,
        busy: busy === "permissionPatches",
        label: t("sw.permission"),
        desc: t("sw.permission.desc"),
        hintTitle: t("sw.permission"),
        hint: t("sw.permission.hint"),
        chip: permOn
          ? t("sw.chip.on", {
              n: PERMISSION_PATCH_IDS.length,
              written: permApplied,
              pending: permPending,
            })
          : t("sw.chip.off", { n: PERMISSION_PATCH_IDS.length }),
        onToggle: () => toggle("permissionPatches"),
      }),
      h(Switch, {
        on: ctxOn,
        busy: busy === "contextManagement",
        label: t("sw.context"),
        desc: t("sw.context.desc"),
        hintTitle: t("sw.context"),
        hint: t("sw.context.hint"),
        chip: ctxOn
          ? t("sw.chip.on", {
              n: CONTEXT_PATCH_IDS.length,
              written: ctxApplied,
              pending: CONTEXT_PATCH_IDS.length - ctxApplied,
            })
          : t("sw.chip.off", { n: CONTEXT_PATCH_IDS.length }),
        onToggle: () => toggle("contextManagement"),
      }),
    ),
    note
      ? h(
          "p",
          {
            className:
              "dshpp-sw-note" + (note.kind === "error" ? " is-bad" : ""),
            role: "status",
          },
          note.text,
        )
      : null,
    h("p", { className: "dshpp-sw-hint" }, t("sw.applyHint")),
  );
}

const FILTERS = ["all", "pending", "off", "na"];

/** 항목 상세: 필터 줄 + 그룹 표. 그룹 안에 상태 설명을 남겨 "무엇을 고쳐야 하는지" 바로 보이게 한다. */
export function PatchGroups({ state }) {
  const t = useT();
  const [open, setOpen] = useState({ code: true });
  const [filter, setFilter] = useState("all");
  if (state?.ok === false)
    return h("p", { role: "status" }, t("groups.unreadable"));
  if (!state || !state.patch_status)
    return h("div", { className: "dshpp-skel", style: { height: 120 } });
  const located = !!state.ai_base;
  if (!located) return null;

  const allRows = patchRowsAll(state);
  const counts = patchGroupCounts(allRows);
  const filterCount = {
    all: counts.total,
    pending: counts.pending,
    off: counts.off,
    na: counts.na,
  };
  const kept = allRows.filter((row) => {
    if (filter === "pending")
      return (
        !isNaRow(row) &&
        row.st !== "disabled" &&
        row.st !== "applied" &&
        row.st !== "already"
      );
    if (filter === "off") return row.st === "disabled";
    if (filter === "na") return isNaRow(row);
    return true;
  });

  const grouped = new Map();
  for (const row of kept) {
    const key = LAYER_GROUP[row.layer] || "code";
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }

  return h(
    "div",
    null,
    h(
      "div",
      { className: "dshpp-filter" },
      FILTERS.map((f) =>
        h(
          "button",
          {
            key: f,
            type: "button",
            className: "dshpp-fbtn" + (filter === f ? " is-cur" : ""),
            onClick: () => setFilter(f),
          },
          t("filter." + f),
          h("span", { className: "dshpp-fbtn-n" }, String(filterCount[f])),
        ),
      ),
      h("span", { className: "dshpp-filter-hint" }, t("filter.hint")),
    ),
    GROUP_ORDER.filter((key) => grouped.has(key)).map((key) => {
      const rows = grouped
        .get(key)
        .slice()
        .sort((a, b) => a.id - b.id);
      const tally = tallyPatches(rows);
      const groupCounts = patchGroupCounts(rows);
      const notes = [];
      if (tally.pending)
        notes.push(t("metric.pendingShort", { n: tally.pending }));
      if (tally.unmatched)
        notes.push(t("metric.unmatchedShort", { n: tally.unmatched }));
      if (tally.partial)
        notes.push(t("metric.partialShort", { n: tally.partial }));
      if (tally.drifted)
        notes.push(t("metric.driftedShort", { n: tally.drifted }));
      if (tally.disabled)
        notes.push(t("metric.disabledShort", { n: tally.disabled }));
      // "이 쪽에는 해당 없음"은 상단 숫자와 그룹 머리의 회색 배지로 이미 드러나므로 여기서 "건너뜀 n"을 또 반복하지 않는다.
      const expanded = !!open[key];
      return h(
        "div",
        { key: key, className: "dshpp-group" },
        h(
          "button",
          {
            type: "button",
            className: "dshpp-group-h",
            "aria-expanded": expanded ? "true" : "false",
            onClick: () =>
              setOpen((prev) => Object.assign({}, prev, { [key]: !prev[key] })),
          },
          h("span", { className: "dshpp-caret" }, expanded ? "▾" : "▸"),
          h("strong", null, t("group." + key)),
          h(
            "span",
            { className: "dshpp-count" },
            groupCounts.applied + " / " + (groupCounts.denom || 0),
          ),
          h(
            "span",
            { className: "dshpp-group-chips" },
            groupCounts.applied
              ? h(
                  "span",
                  { className: "dshpp-pill is-ok" },
                  String(groupCounts.applied),
                )
              : null,
            groupCounts.pending
              ? h(
                  "span",
                  { className: "dshpp-pill is-wait" },
                  String(groupCounts.pending),
                )
              : null,
            groupCounts.off
              ? h(
                  "span",
                  { className: "dshpp-pill is-muted" },
                  String(groupCounts.off),
                )
              : null,
            groupCounts.na
              ? h(
                  "span",
                  { className: "dshpp-pill is-miss" },
                  String(groupCounts.na),
                )
              : null,
          ),
        ),
        notes.length
          ? h("p", { className: "dshpp-group-notes" }, notes.join(" · "))
          : null,
        expanded
          ? h(
              "table",
              { className: "dshpp-table" },
              h(
                "thead",
                null,
                h(
                  "tr",
                  null,
                  h("th", null, "#"),
                  h("th", null, t("table.patch")),
                  h("th", null, t("table.status")),
                ),
              ),
              h(
                "tbody",
                null,
                rows.map((r) =>
                  h(
                    "tr",
                    { key: r.id },
                    h("td", { className: "dshpp-id" }, "#" + r.id),
                    h(
                      "td",
                      null,
                      (t("patch." + r.id) !== "patch." + r.id
                        ? t("patch." + r.id)
                        : r.name) || "patch." + r.id,
                      // 시안은 두 줄 구성이다: 이름 + 영문 식별자. 영문은 따로 이름이 있을 때만 한 줄 덧붙인다.
                      r.name && t("patch." + r.id) !== "patch." + r.id
                        ? h("span", { className: "dshpp-row-en" }, r.name)
                        : null,
                      // 이미 적용된 행에는 이유를 다시 붙이지 않는다. 같은 글자가 60줄 반복되면 표만 길어진다.
                      r.st === "applied" || r.st === "already"
                        ? null
                        : h(
                            "span",
                            { className: "dshpp-row-note" },
                            t("hint." + (r.st || "unknown")),
                          ),
                    ),
                    h(
                      "td",
                      null,
                      h(Pill, { value: r.st }),
                      r.st === "partial"
                        ? h(
                            "span",
                            { className: "dshpp-sub" },
                            t("status.partialDetail", {
                              done: (state.patch_files?.[r.id] || []).filter(
                                (f) => f.status === "applied",
                              ).length,
                              total: (state.patch_files?.[r.id] || []).length,
                            }),
                          )
                        : null,
                    ),
                  ),
                ),
              ),
            )
          : null,
      );
    }),
    !grouped.size
      ? h("p", { className: "dshpp-filter-hint" }, t("filter.empty"))
      : null,
  );
}

/** 기록 절차: "적용 클릭 → 직접 다시 열기 → 돌아와서 확인"을 분명히 밝힌다. 플러그인이 대신 재시작하지 않는다. */
export function PatchApplySteps() {
  const t = useT();
  const step = (n, title, desc) =>
    h(
      "div",
      { className: "dshpp-step" },
      h("span", { className: "dshpp-step-no" }, String(n)),
      h("div", null, h("b", null, title), h("span", null, desc)),
    );
  return h(
    "div",
    { className: "dshpp-flow" },
    h("h4", null, t("steps.title")),
    h(
      "div",
      { className: "dshpp-steps" },
      step(1, t("steps.1.t"), t("steps.1.d")),
      step(2, t("steps.2.t"), t("steps.2.d")),
      step(3, t("steps.3.t"), t("steps.3.d")),
    ),
    h("p", { className: "dshpp-flow-foot" }, t("steps.foot")),
  );
}
