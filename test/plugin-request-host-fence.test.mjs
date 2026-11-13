// 패널 라우트의 Host 소유 검증. DNS rebinding 때는 Host 와 Origin 이 모두 공격자 도메인이므로,
// 「둘이 같다」는 자기 비교로는 아무것도 증명할 수 없다 — 먼저 Host 가 이 기기의 수신 대상에 속해야 한다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { allowPluginRequest } from "../lib/index.js";

const request = (headers) => ({ headers });
const response = () => {
  const seen = { code: undefined, body: "" };
  return {
    seen,
    writeHead(code) { seen.code = code; },
    end(body) { seen.body = String(body || ""); },
  };
};
const decide = (headers, trusted) => {
  const res = response();
  const allowed = allowPluginRequest(request(headers), res, trusted);
  return { allowed, code: res.seen.code, body: res.seen.body };
};

test("DNS rebinding: Host 와 Origin 이 모두 공격자 도메인이면 거부한다", () => {
  // 브라우저는 두 헤더를 모두 공격자 도메인으로 쓰고, sec-fetch-site 는 여전히 same-origin 이다.
  const out = decide({
    host: "rebind.attacker.example:43120",
    origin: "http://rebind.attacker.example:43120",
    "sec-fetch-site": "same-origin",
  });
  assert.equal(out.allowed, false);
  assert.equal(out.code, 403);
});

test("DNS rebinding: Origin 이 없는 읽기 요청도 똑같이 거부한다", () => {
  // 이미지/스크립트 형태의 탐색은 Origin 을 보내지 않으므로 Host 가 판단할 수 있는 유일한 헤더다.
  const out = decide({ host: "rebind.attacker.example:43120", "sec-fetch-site": "same-origin" });
  assert.equal(out.allowed, false);
  assert.equal(out.code, 403);
});

test("로컬 패널 요청은 허용한다 (127.0.0.1 / localhost / [::1])", () => {
  for (const host of ["127.0.0.1:43120", "localhost:43120", "[::1]:43120"]) {
    const out = decide({ host, origin: `http://${host}`, "sec-fetch-site": "same-origin" });
    assert.equal(out.allowed, true, host);
  }
});

test("127/8 은 모두 루프백으로 보고, 비루프백 공인 주소는 그렇게 보지 않는다", () => {
  assert.equal(decide({ host: "127.0.0.53:3080" }).allowed, true);
  assert.equal(decide({ host: "127.255.255.254:3080" }).allowed, true);
  assert.equal(decide({ host: "128.0.0.1:3080" }).allowed, false);
  assert.equal(decide({ host: "localhost.evil.example:3080" }).allowed, false);
});

test("IPv6 루프백은 IPv4-mapped 형식도 포함한다", () => {
  // 호스트의 isLoopbackHost() 는 range() === "loopback" 을 쓰므로 mapped 형식도 루프백으로 본다.
  for (const host of ["[::1]:43120", "[::1]", "[0:0:0:0:0:0:0:1]:43120"]) {
    assert.equal(decide({ host }).allowed, true, host);
  }
  for (const host of ["[::ffff:127.0.0.1]:43120", "[::ffff:127.0.0.53]:43120"]) {
    assert.equal(decide({ host }).allowed, true, host);
  }
  // 루프백이 아닌 IPv6 는 형식 때문에 루프백으로 오판하면 안 된다
  for (const host of ["[2001:db8::1]:43120", "[::2]:43120", "[fe80::1]:43120"]) {
    assert.equal(decide({ host }).allowed, false, host);
  }
});

test("맨 IPv6 주소를 바인딩하면 대괄호를 쓴 Host 도 매칭된다", () => {
  // webServer.host 는 설정 원문이다: `2001:db8::1` 처럼 대괄호 없는 맨 주소일 수 있는데,
  // HTTP 의 Host 헤더는 반드시 `[2001:db8::1]:포트` 로 써야 한다. 둘은 정규화 후 같아져야 한다.
  const trusted = new Set(["2001:db8::1"]);
  assert.equal(
    decide({ host: "[2001:db8::1]:43120", origin: "http://[2001:db8::1]:43120", "sec-fetch-site": "same-origin" }, trusted).allowed,
    true,
  );
  // 맨 주소에 포트를 붙이는 표기는 모호하므로, 정규화 후에도 주소 자체로 본다
  assert.equal(decide({ host: "2001:db8::1" }, trusted).allowed, true);
  // 인접 주소는 여전히 거부한다
  assert.equal(decide({ host: "[2001:db8::2]:43120" }, trusted).allowed, false);
});

test("맨 ::1 을 바인딩해도 루프백 요청은 계속 허용된다", () => {
  // 맨 `::1` 을 「마지막 콜론이 포트」로 잘라 버리면 `:` 가 되어 이 기기 접근이 거부된다.
  const trusted = new Set(["::1"]);
  assert.equal(decide({ host: "[::1]:43120" }, trusted).allowed, true);
  assert.equal(decide({ host: "[::1]" }, trusted).allowed, true);
});

test("실제 교차 사이트는 기존 판정이 그대로 막는다", () => {
  const out = decide({
    host: "127.0.0.1:43120",
    origin: "http://evil.example",
    "sec-fetch-site": "cross-site",
  });
  assert.equal(out.allowed, false);
  assert.equal(out.code, 403);
});

test("Origin: null 은 거부한다", () => {
  assert.equal(decide({ host: "127.0.0.1:43120", origin: "null" }).allowed, false);
});

test("같은 기기여도 Origin 이 다른 포트를 가리키면 허용하지 않는다", () => {
  const out = decide({
    host: "127.0.0.1:43120",
    origin: "http://127.0.0.1:3080",
    "sec-fetch-site": "same-origin",
  });
  assert.equal(out.allowed, false);
  assert.equal(out.code, 403);
});

test("루프백을 바인딩하지 않으면 리스너 자신의 주소는 허용된다", () => {
  // LAN 바인딩: 설정에서 유도한 allowedHosts 에만 포함되며, 요청 헤더 자체가 권한이 되지는 않는다.
  const trusted = new Set(["192.168.1.50"]);
  assert.equal(
    decide({ host: "192.168.1.50:43120", origin: "http://192.168.1.50:43120", "sec-fetch-site": "same-origin" }, trusted).allowed,
    true,
  );
  // 바인딩은 같지만 Host 를 공격자 도메인으로 바꾸면 → 여전히 거부한다.
  assert.equal(decide({ host: "192.168.1.50:43120" }, new Set()).allowed, false);
});

test("명시적으로 신뢰한 호스트명(리버스 프록시)은 쓸 수 있고, 목록에 없는 도메인은 여전히 거부한다", () => {
  const trusted = new Set(["panel.example.com"]);
  assert.equal(
    decide({ host: "panel.example.com", origin: "https://panel.example.com", "sec-fetch-site": "same-origin" }, trusted).allowed,
    true,
  );
  assert.equal(
    decide({ host: "other.example.com", origin: "https://other.example.com", "sec-fetch-site": "same-origin" }, trusted).allowed,
    false,
  );
});

test("Host 헤더가 없으면 무조건 거부한다", () => {
  assert.equal(decide({}).allowed, false);
  assert.equal(decide({ origin: "http://127.0.0.1:43120" }).allowed, false);
});

test("PURGE_TRUSTED_HOSTS 가 쓸 만한 신뢰 목록으로 해석된다 (기본 인자 경로)", (t) => {
  const previous = process.env.PURGE_TRUSTED_HOSTS;
  t.after(() => {
    if (previous === undefined) delete process.env.PURGE_TRUSTED_HOSTS;
    else process.env.PURGE_TRUSTED_HOSTS = previous;
  });

  // 구분자 혼용: 쉼표, 세미콜론, 공백, 포트 포함, 대괄호 포함, 대소문자, 앞뒤 공백.
  process.env.PURGE_TRUSTED_HOSTS = " Panel.Example.COM ; 192.168.1.50:43120 ,[fd00::1]:8080 ";
  // 세 번째 인자를 생략하면 → allowPluginRequest 의 기본값(= 환경 변수에서 읽기)을 쓴다.
  assert.equal(decide({ host: "panel.example.com", "sec-fetch-site": "same-origin" }).allowed, true);
  assert.equal(decide({ host: "192.168.1.50:9999" }).allowed, true, "포트가 달라도 호스트명은 매칭되어야 한다");
  assert.equal(decide({ host: "[fd00::1]:43120" }).allowed, true);
  // 목록에 없는 도메인은 여전히 거부한다.
  assert.equal(decide({ host: "other.example.com" }).allowed, false);
});

test("PURGE_TRUSTED_HOSTS 를 비우면 비루프백 호스트를 더 이상 허용하지 않는다", (t) => {
  const previous = process.env.PURGE_TRUSTED_HOSTS;
  t.after(() => {
    if (previous === undefined) delete process.env.PURGE_TRUSTED_HOSTS;
    else process.env.PURGE_TRUSTED_HOSTS = previous;
  });

  process.env.PURGE_TRUSTED_HOSTS = "panel.example.com";
  assert.equal(decide({ host: "panel.example.com" }).allowed, true);

  delete process.env.PURGE_TRUSTED_HOSTS;
  assert.equal(decide({ host: "panel.example.com" }).allowed, false, "신뢰를 해제하면 다시 거부로 돌아가야 한다");
  // 루프백은 이 변수에 의존하지 않는다.
  assert.equal(decide({ host: "127.0.0.1:3080" }).allowed, true);
});

test("신뢰 목록은 루프백 판정에 영향을 주지 않고, Origin 동일 출처 검사도 우회하지 못한다", (t) => {
  const previous = process.env.PURGE_TRUSTED_HOSTS;
  t.after(() => {
    if (previous === undefined) delete process.env.PURGE_TRUSTED_HOSTS;
    else process.env.PURGE_TRUSTED_HOSTS = previous;
  });
  process.env.PURGE_TRUSTED_HOSTS = "panel.example.com";

  // panel 을 신뢰했더라도 Origin 이 다른 곳을 가리키면 → 여전히 거부한다.
  assert.equal(
    decide({ host: "panel.example.com", origin: "https://evil.example", "sec-fetch-site": "same-origin" }).allowed,
    false,
  );
  // sec-fetch-site: cross-site 는 신뢰 목록보다 우선한다.
  assert.equal(
    decide({ host: "panel.example.com", origin: "https://panel.example.com", "sec-fetch-site": "cross-site" }).allowed,
    false,
  );
});

test("malformed port or bracket suffix does not identify a local listener", () => {
  for (const host of ["localhost:bad", "localhost:65536", "[::1]extra", "[::1]:bad", "127.0.00.1"]) {
    assert.equal(decide({ host }).allowed, false, host);
  }
});

test("호스트의 --trusted-host 도메인은 패널에 들어올 수 있다(DSH 본체와 같은 기준)", () => {
  // 배포에서 `--trusted-host dsh.example.com` 을 주면 DSH 본체는 이 도메인을 받아들이는데,
  // 패널은 루프백과 수신 주소만 인정해서 같은 기기에서 "호스트는 들어가고 패널은 403" 이 됐다.
  // 호스트 연결 서비스가 주는 목록을 합치면 양쪽 판정이 같아진다.
  const trusted = new Set(["dsh.example.com"]);
  assert.equal(
    decide({ host: "dsh.example.com", origin: "https://dsh.example.com", "sec-fetch-site": "same-origin" }, trusted).allowed,
    true,
  );
  // 합친다고 느슨해지는 것은 아니다: 목록에 없는 도메인은 그대로 거부한다.
  assert.equal(
    decide({ host: "other.example.com", origin: "https://other.example.com", "sec-fetch-site": "same-origin" }, trusted).allowed,
    false,
  );
});

test("호스트 신뢰 목록은 Origin 동일 출처와 cross-site 검사를 우회하지 못한다", () => {
  const trusted = new Set(["dsh.example.com"]);
  // Host 는 신뢰되었지만 Origin 이 공격자를 가리키면 → 거부한다.
  assert.equal(
    decide({ host: "dsh.example.com", origin: "https://evil.example", "sec-fetch-site": "same-origin" }, trusted).allowed,
    false,
  );
  // cross-site 의 우선순위가 더 높다.
  assert.equal(
    decide({ host: "dsh.example.com", origin: "https://dsh.example.com", "sec-fetch-site": "cross-site" }, trusted).allowed,
    false,
  );
  // Origin: null 은 그대로 거부한다.
  assert.equal(decide({ host: "dsh.example.com", origin: "null" }, trusted).allowed, false);
});

test("a host deployment and the environment can each allow additional same-origin names", async (t) => {
  const { trustedHostnames } = await import("../lib/index.js");
  const previous = process.env.PURGE_TRUSTED_HOSTS;
  t.after(() => {
    if (previous === undefined) delete process.env.PURGE_TRUSTED_HOSTS;
    else process.env.PURGE_TRUSTED_HOSTS = previous;
  });
  process.env.PURGE_TRUSTED_HOSTS = "a.example,b.example; c.example d.example";
  const trusted = trustedHostnames("0.0.0.0", ["host.example"]);
  for (const host of ["a.example", "b.example", "c.example", "d.example", "host.example"]) {
    assert.equal(decide({ host, origin: "https://" + host }, trusted).allowed, true, host);
  }
  assert.equal(decide({host: "unknown.example"}, trusted).allowed, false);
  assert.equal(decide({host: "host.example", origin: "https://a.example"}, trusted).allowed, false);
  assert.equal(decide({host: "a.example", "sec-fetch-site": "cross-site"}, trusted).allowed, false);
});
