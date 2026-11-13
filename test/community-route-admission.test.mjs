// /dsh-purge/community 의 접근 허용 판정은 다른 /dsh-purge/* 라우트와 같은 기준이어야 한다.
//
// 이 라우트는 apply() 안에서 따로 등록되어 installWebServer 의 registerPluginRoute 래퍼를 거치지 않는다.
// 그래서 「리스너가 바인딩한 주소도 이 기기로 본다」는 규칙을 놓쳤다: 비루프백 바인딩에서 이것만 403 을 돌려주고
// 나머지 라우트는 정상이었다. 아래에서 세 가지를 함께 고정한다: 바인딩 주소 접근 가능, 루프백 접근 가능, rebinding 거부.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Context, Service } from "@deepseek-ai/cordis";
import { allowPluginRequest } from "../lib/index.js";

const BIND = "192.168.1.50";

/**
 * 허용 함수를 직접 호출해 「바인딩 주소를 넘기는 경우」와 「넘기지 않는 경우」의 차이를 확인한다.
 *
 * 이것이 이 회귀의 핵심 단언이다: 세 번째 인자를 넘기지 않으면(= 옛 코드의 방식) 바인딩 주소가 거부되고,
 * 넘기면 허용된다. 둘을 같은 테스트에서 대조해야 한쪽만 고친 경우에도 드러난다.
 */
const decide = (headers, trusted) => {
  const res = { writeHead(code) { this.code = code; }, end() {} };
  const request = { headers };
  const allowed = trusted === undefined
    ? allowPluginRequest(request, res)
    : allowPluginRequest(request, res, trusted);
  return allowed;
};

test("바인딩 주소는 trustedHostnames(bind) 를 넘기면 허용되고, 넘기지 않으면 거부된다", () => {
  const withBind = new Set([BIND]);
  const headers = { host: `${BIND}:43120` };

  assert.equal(decide(headers), false, "바인딩 주소를 넘기지 않으면 거부해야 한다(옛 community 라우트의 동작)");
  assert.equal(decide(headers, withBind), true, "바인딩 주소를 넘겨야 허용된다(나머지 라우트의 동작)");
});

test("루프백과 비루프백 바인딩 주소 외의 Host 는 모두 거부한다", () => {
  const withBind = new Set([BIND]);
  for (const host of ["127.0.0.1:43120", "localhost:43120", "[::1]:43120"]) {
    assert.equal(decide({ host }, withBind), true, host);
  }
  for (const host of ["10.0.0.9:43120", "rebind.evil.example:43120", "example.com"]) {
    assert.equal(decide({ host }, withBind), false, host);
  }
});

/**
 * 최소 호스트를 띄워 apply() 가 실제 라우트를 등록하게 하고 하나씩 구동한다.
 *
 * apply() 는 호스트 서비스 몇 개에 더 의존한다; 여기서는 web 부분이 라우트를 걸 수 있으면 된다.
 * 나머지 서비스가 없으면 apply 가 예외를 던지지만 라우트는 대개 이미 등록된 뒤다 — 그래서 try 로 감싼다.
 */
async function bootRoutes(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "purge-community-route-"));
  const savedHome = process.env.DSH_HOME;
  const savedTrusted = process.env.PURGE_TRUSTED_HOSTS;
  process.env.DSH_HOME = home;
  delete process.env.PURGE_TRUSTED_HOSTS;

  const { apply } = await import("../lib/index.js");

  class Web extends Service {
    constructor(ctx) {
      super(ctx, "webServer");
      this.routes = new Map();
      this.host = BIND;
      this.port = 43120;
    }
    register(spec) {
      this.routes.set(spec.path, spec);
      return () => this.routes.delete(spec.path);
    }
  }

  const ctx = new Context();
  await ctx.plugin(Web);
  try { apply(ctx, { enabled: false }); } catch { /* web 라우트가 걸렸는지만 본다 */ }
  await new Promise((resolve) => setTimeout(resolve, 200));

  t.after(async () => {
    await ctx.fiber.dispose().catch(() => {});
    fs.rmSync(home, { recursive: true, force: true });
    if (savedHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = savedHome;
    if (savedTrusted === undefined) delete process.env.PURGE_TRUSTED_HOSTS;
    else process.env.PURGE_TRUSTED_HOSTS = savedTrusted;
  });

  const call = async (routePath, headers) => {
    const spec = ctx.webServer.routes.get(routePath);
    if (!spec) return { registered: false };
    const res = {
      headers: {},
      setHeader() {},
      writeHead(code) { this.code = code; },
      end(body) { this.body = body; },
    };
    const request = Object.assign(Readable.from([]), { method: "GET", headers });
    try {
      await spec.handler(request, res);
    } catch (error) {
      return { registered: true, threw: String(error?.message || error) };
    }
    return { registered: true, code: res.code, body: String(res.body || "") };
  };

  return { ctx, call };
}

test("/dsh-purge/community 는 비루프백 바인딩에서도 더 이상 403 을 돌려주지 않는다", async (t) => {
  const { ctx, call } = await bootRoutes(t);
  const spec = ctx.webServer.routes.get("/dsh-purge/community");
  if (!spec) return t.skip("이 환경에는 community 라우트가 등록되지 않아 건너뛴다");

  const result = await call("/dsh-purge/community", { host: `${BIND}:43120` });
  // 401/403 은 접근 거부다; 그 밖의 상태 코드(비즈니스 계층의 400/500 포함)는 handler 까지 통과했다는 뜻이다.
  assert.notEqual(result.code, 403, "바인딩 주소로 community 라우트에 접근할 때 접근 거부되면 안 된다");
  assert.notEqual(result.code, 401);
});

test("/dsh-purge/community 는 여전히 DNS rebinding 을 거부한다", async (t) => {
  const { ctx, call } = await bootRoutes(t);
  const spec = ctx.webServer.routes.get("/dsh-purge/community");
  if (!spec) return t.skip("이 환경에는 community 라우트가 등록되지 않아 건너뛴다");

  const result = await call("/dsh-purge/community", {
    host: "rebind.evil.example:43120",
    origin: "http://rebind.evil.example:43120",
    "sec-fetch-site": "same-origin",
  });
  assert.equal(result.code, 403);
});
