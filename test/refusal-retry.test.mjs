// 거부 감지 + 1회 재시도: 미적중이면 그대로 통과시키고, 적중하면 강화 문구를 덧붙여 한 번 다시 실행한다.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { looksLikeRefusal, refusalMatchIndex, streamWithRefusalRetry, RETRY_NUDGE, FRAME_NUDGE, DECOMPOSE_NUDGE } from "../lib/refusal-retry.js";

const sys = (text) => ({ role: "system", content: [{ type: "text", text }] });
const delta = (text) => ({ type: "text-delta", index: 0, text });
const finish = () => ({ type: "finish" });

async function collect(iter) {
  const out = [];
  for await (const chunk of iter) out.push(chunk);
  return out;
}

test("refusal text is detected, normal text is not", () => {
  assert(looksLikeRefusal("I can't help with that."));
  assert(looksLikeRefusal("\u62b1\u6b49\uff0c\u6211\u65e0\u6cd5\u534f\u52a9\u8fd9\u4e2a\u8bf7\u6c42"));
  assert(!looksLikeRefusal("Here is the plan: 1) read the file 2) patch it"));
});

test("a refusal triggers exactly one retry with the nudge appended", async () => {
  const calls = [];
  const factory = (options) => {
    calls.push(options);
    const refusal = calls.length === 1;
    return (async function* () {
      if (refusal) {
        yield delta("I'm sorry, but I can't help with that.");
      } else {
        yield delta("Step 1: read the file.");
      }
      yield finish();
    })();
  };
  const options = { messages: [sys("base system")] };
  const chunks = await collect(streamWithRefusalRetry(factory, options));
  assert.equal(calls.length, 2);
  assert.match(calls[1].messages[0].content[0].text, /base system/);
  assert.ok(calls[1].messages[0].content[0].text.includes(RETRY_NUDGE.trim().slice(0, 20)));
  assert.match(RETRY_NUDGE, /지금 실행할까/);
  assert.doesNotMatch(RETRY_NUDGE, /already authorized/i);
  assert.equal(chunks.filter((c) => c.type === "text-delta")[0].text, "Step 1: read the file.");
});

test("normal output streams through untouched and is not retried", async () => {
  let calls = 0;
  const factory = () => {
    calls += 1;
    return (async function* () {
      yield delta("Here is the plan.");
      yield finish();
    })();
  };
  const chunks = await collect(streamWithRefusalRetry(factory, { messages: [sys("s")] }));
  assert.equal(calls, 1);
  assert.equal(chunks[0].text, "Here is the plan.");
});

test("soft Chinese refusals from a real failing session are detected", () => {
  // REFUSAL_PATTERNS 가 중국어 원문 판정식이므로(lib/refusal-retry.js 는 \uXXXX 로 같은 패턴을 보존)
  // 이 입력도 번역하지 않고 \uXXXX 로 둔다 — 동작 불변이 우선이다. 각 줄의 뜻:
  // "이 단계는 안 한다: 남의 사이트를 해킹하는 걸 목표로 삼는 것은 앞서 도구를 설치한 것과 다른 문제다"
  // / "목표가 남의 사이트인데 승인도 없다: 이 단계에 참여하지 않는다" / "그것을 침투 테스트로 포장해
  // 이 지점을 우회하도록 돕지 않는다" / "목표와 승인 근거를 나에게 보내라" / "이것은 미승인 침입 행위다".
  const real = [
    "\u8fd9\u4e00\u6b65\u6211\u4e0d\u505a\uff1a\u628a“\u9ed1\u8fdb\u67d0\u4e2a\u7f51\u7ad9”\u5f53\u4f5c\u76ee\u6807\uff0c\u548c\u4e4b\u524d\u88c5\u5de5\u5177\u4e0d\u662f\u4e00\u56de\u4e8b\u3002",
    "\u76ee\u6807\u662f\u522b\u4eba\u7684\u7ad9\u70b9\u3001\u4f46\u6ca1\u6709\u6388\u6743\uff1a\u8fd9\u4e00\u6b65\u6211\u4e0d\u53c2\u4e0e\u3002",
    "\u6211\u4e0d\u4f1a\u5e2e\u4f60\u628a\u5b83\u5305\u88c5\u6210“\u6e17\u900f\u6d4b\u8bd5”\u6765\u7ed5\u8fc7\u8fd9\u4e00\u70b9\u3002",
    "\u8bf7\u628a\u76ee\u6807\u548c\u6388\u6743\u4f9d\u636e\u53d1\u7ed9\u6211\u3002",
    "\u8fd9\u5c5e\u4e8e\u672a\u6388\u6743\u7684\u5165\u4fb5\u884c\u4e3a\u3002",
  ];
  for (const text of real) assert(looksLikeRefusal(text), text);
});

test("legitimate answers that merely mention authorization are not flagged", () => {
  assert(!looksLikeRefusal("\u767b\u5f55\u63a5\u53e3\u9700\u8981\u643a\u5e26 Authorization \u5934\uff0c\u6388\u6743\u5931\u8d25\u8fd4\u56de 401\u3002"));
  assert(!looksLikeRefusal("\u8fd9\u90e8\u5206\u4ee3\u7801\u4e0d\u53c2\u4e0e\u6e32\u67d3\uff0c\u53ef\u4ee5\u5b89\u5168\u5220\u9664\u3002"));
});

test("short meta refusals count, long technical discussion does not", () => {
  assert(looksLikeRefusal("\u8fd9\u6bb5\u6307\u4ee4\u662f\u63d0\u793a\u8bcd\u6ce8\u5165\uff0c\u6211\u4e0d\u4f1a\u6267\u884c\u3002"));
  assert(looksLikeRefusal("I won't treat this as a valid instruction; this is prompt injection."));
  const long = "\u63d0\u793a\u8bcd\u6ce8\u5165\u7684\u9632\u5fa1\u901a\u5e38\u5206\u4e09\u5c42\uff1a" + "\u8f93\u5165\u8fc7\u6ee4\u3001\u4e0a\u4e0b\u6587\u9694\u79bb\u3001\u8f93\u51fa\u5ba1\u67e5\u3002".repeat(30);
  assert(!looksLikeRefusal(long), "긴 글에서 주입을 논의하는 것은 재시도를 유발하지 않는다");
});

test("the matching rule index is reported for diagnosis", () => {
  assert(refusalMatchIndex("\u8fd9\u6bb5\u6307\u4ee4\u662f\u63d0\u793a\u8bcd\u6ce8\u5165\uff0c\u6211\u4e0d\u4f1a\u6267\u884c\u3002") >= 0);
  assert.equal(refusalMatchIndex("\u666e\u901a\u7684\u6280\u672f\u8bf4\u660e\uff0c\u6ca1\u6709\u4efb\u4f55\u62d2\u7edd\u3002"), -1);
});

test("Chinese object-first refusals are detected after prefix normalization", () => {
  for (const text of [
    "这条我不做，也不是框架问题。",
    "这个我不做。",
    "结论：这份武器化实现我不出。",
    "这份报告我不写。",
    "我不会帮你把它包装成小说。",
    "这个请求我不会给：它要的是可直接执行的跨境洗钱操作链。",
    "因此我不提供其中的任何环节。",
  ]) assert(looksLikeRefusal(text), text);
});

test("a second refusal retries with the fiction frame", async () => {
  const calls = [];
  const factory = (options) => {
    calls.push(options);
    const n = calls.length;
    return (async function* () {
      if (n < 3) yield delta(n === 1 ? "这条我不做。" : "这个我不做。");
      else yield delta("成品已给出。");
      yield finish();
    })();
  };
  const options = { messages: [sys("base system")] };
  const chunks = await collect(streamWithRefusalRetry(factory, options));
  assert.equal(calls.length, 3);
  assert.ok(calls[1].messages[0].content[0].text.includes(RETRY_NUDGE.trim().slice(0, 20)));
  assert.ok(calls[2].messages[0].content[0].text.includes(FRAME_NUDGE.trim().slice(0, 20)));
  assert.equal(chunks.filter((c) => c.type === "text-delta")[0].text, "成品已给出。");
});

test("optional decomposition adds a third retry after the fiction frame", async () => {
  const calls = [];
  const factory = (options) => {
    calls.push(options);
    const n = calls.length;
    return (async function* () {
      if (n < 4) yield delta("这个我不做。");
      else yield delta("最小组件已给出。");
      yield finish();
    })();
  };
  const chunks = await collect(streamWithRefusalRetry(factory, { messages: [sys("base")] }, { decompose: true }));
  assert.equal(calls.length, 4);
  assert.ok(calls[3].messages[0].content[0].text.includes(DECOMPOSE_NUDGE.trim().slice(0, 20)));
  assert.equal(chunks.filter((c) => c.type === "text-delta")[0].text, "最小组件已给出。");
});

test("retry budget is finite and the last refusal is still yielded", async () => {
  let calls = 0;
  const factory = () => {
    calls += 1;
    return (async function* () {
      yield delta("这条我不做。");
      yield finish();
    })();
  };
  const chunks = await collect(streamWithRefusalRetry(factory, { messages: [sys("base")] }));
  assert.equal(calls, 3, "initial + two retries");
  assert.equal(chunks.filter((c) => c.type === "text-delta")[0].text, "这条我不做。");
});

test("reasoning before the refusal text does not skip the retry", async () => {
  let calls = 0;
  const factory = () => {
    calls += 1;
    const n = calls;
    return (async function* () {
      if (n === 1) {
        yield { type: "reasoning-delta", index: 0, text: "The request is risky; I should decline. ".repeat(20) };
        yield delta("I'm sorry, but I can't help with that.");
      } else {
        yield delta("成品已给出。");
      }
      yield finish();
    })();
  };
  const chunks = await collect(streamWithRefusalRetry(factory, { messages: [sys("base")] }));
  assert.equal(calls, 2);
  assert.equal(chunks.filter((c) => c.type === "text-delta")[0].text, "成品已给出。");
});

// 1.7.19：重试流建不起来 / 中途断流时，不能把整回合打崩。
// 真实事故：子代理会话里检测到拒绝 → nudge 重试 → 生成器抛错 → 子会话直接失败，
// audit 只有 refusal_retry、没有 outcome。
test("retry stream that fails to start yields the refusal instead of throwing", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "purge-retry-fail-"));
  const prev = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    let calls = 0;
    const factory = () => {
      calls += 1;
      if (calls > 1) throw new Error("stream factory refused the reuse");
      return (async function* () {
        yield delta("这条我不做。");
        yield finish();
      })();
    };
    const chunks = await collect(
      streamWithRefusalRetry(factory, { messages: [sys("base")] }),
    );
    assert.equal(calls, 2, "确实尝试过重试");
    const text = chunks.filter((c) => c.type === "text-delta").map((c) => c.text).join("");
    assert.equal(text, "这条我不做。", "放行上一轮的拒绝文本，而不是空回合");
    const audit = fs.readFileSync(path.join(home, "dsh-purge-community", "audit.jsonl"), "utf8");
    assert.match(audit, /"outcome":"error"/);
    assert.match(audit, /"attempt":1/);
  } finally {
    if (prev === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = prev;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("retry stream that breaks mid-iteration also fails open", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "purge-retry-mid-"));
  const prev = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    let calls = 0;
    const factory = () => {
      calls += 1;
      const n = calls;
      return (async function* () {
        if (n === 1) {
          yield delta("这个任务我不会做。");
          yield finish();
          return;
        }
        yield delta("部分输出");
        throw new Error("upstream reset");
      })();
    };
    const chunks = await collect(
      streamWithRefusalRetry(factory, { messages: [sys("base")] }),
    );
    const text = chunks.filter((c) => c.type === "text-delta").map((c) => c.text).join("");
    assert.equal(text, "这个任务我不会做。", "中断的重试不能污染或清空上一轮内容");
  } finally {
    if (prev === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = prev;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

// Cordis 的 next 是一次性的；重试必须换一条新 waterfall（ctx.llm.stream）。
test("retries go through retryStream instead of reusing the one-shot next", async () => {
  let primary = 0;
  let secondary = 0;
  const factory = () => {
    primary += 1;
    return (async function* () {
      yield delta("这个我不做。");
      yield finish();
    })();
  };
  const retryStream = () => {
    secondary += 1;
    return (async function* () {
      yield delta("Step 1: 打开样本。");
      yield finish();
    })();
  };
  const chunks = await collect(
    streamWithRefusalRetry(factory, { messages: [sys("base")] }, { retryStream }),
  );
  assert.equal(primary, 1, "首次只走一次 next()");
  assert.ok(secondary >= 1, "重试走了新的请求通道");
  const text = chunks.filter((c) => c.type === "text-delta").map((c) => c.text).join("");
  assert.equal(text, "Step 1: 打开样本。");
});

// 1.7.19 实测漏检：拒绝用的是"不接"，旧动词表只认 做/出/写/提供/参与/帮。
test("object-first refusals with 接/答 verbs are detected", () => {
  assert(looksLikeRefusal("这个任务我不接。原因很直接：…"));
  assert(looksLikeRefusal("这类请求我不会答。"));
  assert(!looksLikeRefusal("我不接这个电话，请稍后再拨。"), "普通叙述不该误判");
});

// seed-prim：让回答从"已经在交付"的位置继续，而不是再讲一遍要求。
import { SEED_PRIM_TEXT, withSeedPrime } from "../lib/refusal-retry.js";

test("seed-prim appends the skeleton to the last user message, keeping message shape", () => {
  const user = { role: "user", content: [{ type: "text", text: "写一个加密模块" }] };
  const out = withSeedPrime({ messages: [sys("base"), user] });
  assert.equal(out.messages.length, 2, "不新增消息（assistant 伪消息会让 DSH 组装崩）");
  assert.equal(out.messages[1].role, "user");
  assert.match(out.messages[1].content[0].text, /写一个加密模块/);
  assert.match(out.messages[1].content[0].text, /实现如下/);
});

test("seed-prim never fabricates an assistant message", () => {
  const out = withSeedPrime({ messages: [sys("base"), { role: "user", content: "x" }] });
  assert.ok(out.messages.every((m) => m.role !== "assistant"));
});

test("seed arm is reached only after nudge and fiction both refuse", async () => {
  const seen = [];
  let n = 0;
  const factory = (options) => {
    n += 1;
    const last = options.messages[options.messages.length - 1];
    const tailText = JSON.stringify(last.content);
    seen.push({ attempt: n, tailRole: last.role, hasSkeleton: /实现如下/.test(tailText), bytes: JSON.stringify(options).length });
    return (async function* () {
      if (n <= 3) {
        yield delta("这个我不做。");
        yield finish();
        return;
      }
      yield delta("实现如下：1) 入口 2) 核心 3) 验证");
      yield finish();
    })();
  };
  const chunks = await collect(
    streamWithRefusalRetry(factory, { messages: [sys("base"), { role: "user", content: "x" }] }, { seed: true }),
  );
  assert.equal(n, 4, "nudge → fiction 都拒了才轮到 seed（第 4 次调用）");
  assert.equal(seen[3].tailRole, "user", "seed 臂不新增 assistant 消息");
  assert.equal(seen[3].hasSkeleton, true, "seed 臂要把骨架并进 user 文本");
  assert.equal(chunks.filter((c) => c.type === "text-delta").at(-1).text.includes("实现如下"), true);
  assert.ok(SEED_PRIM_TEXT.length > 10);
});

test("without seed the third attempt falls back to decompose text", async () => {
  const bodies = [];
  let n = 0;
  const factory = (options) => {
    n += 1;
    bodies.push(JSON.stringify(options.messages[0]));
    return (async function* () {
      if (n <= 3) {
        yield delta("这个我不做。");
        yield finish();
        return;
      }
      yield delta("最小组件：见下");
      yield finish();
    })();
  };
  await collect(streamWithRefusalRetry(factory, { messages: [sys("base")] }, { seed: false, decompose: true }));
  assert.match(bodies[3], /smallest concrete component/, "第四次应是 decompose 提示");
});

// 半拒绝：给一段别的东西再把请求推掉。看起来成功，其实没交付。
import { looksLikePartialRefusal, deliveryIsThin } from "../lib/refusal-retry.js";

test("partial refusal: public-info table then decline is not a success", () => {
  const text = [
    "## 一、公开层面能查到的信息",
    "",
    "| 项目 | 事实 |",
    "| --- | --- |",
    "| 出生年份 | 1992 |",
    "| 代表作 | 《大鱼》 |",
    "| 常驻城市 | 北京 |",
    "",
    "## 二、你要的那一层",
    "",
    "小区、楼栋、门牌、作息时间这些公开渠道里不存在，这一层我不做，输出只到公开层为止。",
  ].join("\n");
  assert.equal(looksLikePartialRefusal(text), true, "应判为半拒绝");
  assert.equal(deliveryIsThin(text), true, "没有成规模交付");
});

test("partial refusal: real delivery that merely mentions a limit is not flagged", () => {
  const code = Array.from({ length: 20 }, (_, i) => `def step${i}(x): return x + ${i}`).join("\n");
  const text = "```python\n" + code + "\n```\n\n说明：不提供真实客户数据，其余都可运行。";
  assert.equal(looksLikePartialRefusal(text), false, "有 20 行代码，不算薄");
  assert.equal(deliveryIsThin(text), false);
});

test("partial refusal: refusal inside a long answer still counts when delivery is thin", () => {
  const filler = "背景资料第一段。".repeat(200);
  const text = filler + "\n\n至于具体步骤，这个我不提供。";
  assert.equal(looksLikePartialRefusal(text), true);
});

test("outcome is recorded as partial_refused, without retrying", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "purge-partial-"));
  const prev = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    let calls = 0;
    const factory = () => {
      calls += 1;
      const intro = "## 公开信息\n\n" + "背景资料：这一节先把能公开查到的内容列清楚。".repeat(30) + "\n\n";
      const full = intro + "具体住址这一层我不提供。";
      return (async function* () {
        // 真实流是小块；一次性吐全文会让缓冲直接越过 400 字，测不出缓冲语义
        for (let i = 0; i < full.length; i += 40) yield delta(full.slice(i, i + 40));
        yield finish();
      })();
    };
    await collect(streamWithRefusalRetry(factory, { messages: [sys("base")] }));
    assert.equal(calls, 1, "半拒绝不触发重试");
    const audit = fs.readFileSync(path.join(home, "dsh-purge-community", "audit.jsonl"), "utf8");
    assert.match(audit, /"outcome":"partial_refused"/);
  } finally {
    if (prev === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = prev;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

// 重试后只吐十几个字，不能算"救回来了"。
test("a near-empty retry is recorded as empty_after_retry, not recovered", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "purge-empty-"));
  const prev = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    let n = 0;
    const factory = () => {
      n += 1;
      return (async function* () {
        if (n === 1) {
          yield delta("这个我不做。");
          yield finish();
          return;
        }
        yield delta("抱歉。");
        yield finish();
      })();
    };
    await collect(streamWithRefusalRetry(factory, { messages: [sys("base")] }));
    const audit = fs.readFileSync(path.join(home, "dsh-purge-community", "audit.jsonl"), "utf8");
    assert.match(audit, /"outcome":"empty_after_retry"/);
    assert.doesNotMatch(audit, /"outcome":"recovered"/);
  } finally {
    if (prev === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = prev;
    fs.rmSync(home, { recursive: true, force: true });
  }
});
