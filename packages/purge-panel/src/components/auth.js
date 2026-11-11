import * as rd from "react-dom";
// UI derived from YuJunZhiXue/dsh-purge 1.1.71 (MIT). See LICENSE.
import { h, useState, useEffect, useRef } from "../shared/react.js";
import { useT } from "../shared/locale.js";
import { __dshPurgeDrill } from "../vendor/drill.js";
import { writeDrillAuth, setDock } from "../state/dock.js";

export const AUTH_LEGAL_HTML =
  "<h3>엄격한 법적 면책 및 준법 사용 선언</h3>\r\n    <p>이 선언은 모의해킹에 들어가기 전에 전문을 읽어야 합니다. 이 프로젝트는 비영리 오픈소스이며 학습·연구와 기술 참고용으로만 제공합니다. 누구든 이 프로젝트를 상업적으로 판매하거나 유료로 되팔거나 불법·회색 지대 수익에 쓰는 것을 금지합니다.</p>\r\n    <p>개발자는 위법 행위를 단호히 반대하고 금지합니다. 승인 없는 네트워크 공격, 취약점 악용, 데이터 탈취, 정보통신망 무단 침입, 위법 콘텐츠 생성을 지원·조장·조력하지 않습니다. 이 프로젝트를 위법에 쓴 책임은 전적으로 행위자에게 있고 개발자와는 무관합니다. 연구·교육·테스트·시연·내부 학습을 이유로 아래 조항을 피할 수는 없습니다.</p>\r\n    <h3>1. 이 저장소에 위법 콘텐츠는 없습니다</h3>\r\n    <p>dsh-purge 가 배포하는 코드, 문서, 패치, 기본 프롬프트에는 트로이 목마, 백도어, 무단 침투 도구, 랜섬웨어, 크리덴셜 스터핑 스크립트가 없고, 공용 인터넷이나 타인 시스템을 겨냥한 공격 페이로드도 없습니다. 이 프로젝트는 위법 콘텐츠를 제공하지 않고, 위법을 교사·조직·조력하지도 않습니다.</p>\r\n    <h3>2. 로컬 조작은 대외 권한을 만들지 않습니다</h3>\r\n    <p>패치 적용, 쓰기, 롤백, 제거는 모두 내 컴퓨터의 파일과 프로세스 안에서 끝납니다. 이 조작은 어떤 공용 인터넷 호스트나 승인받지 않은 시스템에 대해서도 스캔·탐지·침입·공격 패킷 발신을 하지 않으며, 내 기기를 경유지로 써서도 안 됩니다.</p>\r\n    <p>업데이트 확인을 켜면 이 플러그인의 GitHub 저장소에만 접속해 버전을 확인합니다. 이 접속은 타사 시스템에 대한 네트워크 공격과 무관하며, 대외 침투 권한으로 해석할 수 없습니다.</p>\r\n    <h3>3. 허용되는 사용 범위</h3>\r\n    <p>내가 처리 권한을 증명할 수 있는 환경에서만 쓰세요. 내가 관리 권한을 가진 로컬 기기의 공식 Harness, 오프라인 로컬 실습 환경, 소유자가 적법한 서면 승인을 발급한 사이버 보안 모의해킹 실습 환경, 규정을 지키는 실험실의 통제된 환경이 여기에 해당합니다. 서면 승인에는 대상·기간·범위가 구체적으로 적혀 있어야 하며, 기관 이름만 적거나 구두로 설명한 것은 승인으로 보지 않습니다.</p>\r\n    <p>소유자의 적법한 서면 승인이 없는 대상, 공용 인터넷 시스템, 운영 중인 서비스, 그리고 에너지·교통·수도·금융·공공 서비스·전자정부 같은 주요 정보통신 기반 시설은 모의해킹 대상으로 삼을 수 없습니다.</p>\r\n    <h3>4. 지켜야 하는 법률(조·항별)</h3>\r\n    <p>정보통신망 이용촉진 및 정보보호 등에 관한 법률(이하 정보통신망법) 제48조 제1항: 정당한 접근권한 없이 또는 허용된 접근권한을 넘어 정보통신망에 침입하는 것을 금지합니다.</p>\r\n    <p>같은 조 제2항: 정당한 사유 없이 정보통신시스템, 데이터, 프로그램을 훼손·멸실·변경·위조하거나 그 운용을 방해할 수 있는 프로그램(악성프로그램)을 전달하거나 유포하는 것을 금지합니다.</p>\r\n    <p>같은 조 제3항: 정보통신망의 안정적 운영을 방해할 목적으로 대량의 신호나 데이터를 보내거나 부정한 명령을 처리하게 해 정보통신망에 장애를 일으키는 것을 금지합니다.</p>\r\n    <p>같은 조 제4항: 정당한 사유 없이 정보통신망의 보호·인증 절차를 우회해 접근할 수 있게 하는 프로그램이나 기술적 장치를 설치·전달·유포하는 것을 금지합니다.</p>\r\n    <p>정보통신망법 제49조: 정보통신망에 저장된 타인의 비밀을 훼손·변경·누설하거나 그 비밀을 침해하는 것을 금지합니다.</p>\r\n    <p>정보통신망법 제44조의7: 음란 정보, 타인을 비방할 목적으로 공공연하게 거짓 사실을 드러내 명예를 훼손하는 정보, 인종·국가·지역·성별·장애 등을 이유로 한 차별·혐오 정보, 공포심이나 불안감을 주는 정보, 정보통신시스템·데이터·프로그램을 훼손하거나 운용을 방해하는 내용의 정보 등 불법정보를 유통하는 것을 금지합니다.</p>\r\n    <p>형법 제314조 제2항: 컴퓨터 등 정보처리장치나 전자기록 등 특수매체기록을 손괴하거나 정보처리장치에 허위 정보나 부정한 명령을 입력하는 등 방법으로 정보처리에 장애를 일으켜 사람의 업무를 방해하는 것을 금지합니다.</p>\r\n    <p>형법 제347조(사기), 제329조(절도), 제355조(횡령): 컴퓨터를 이용해 재산상 이익을 가로채거나 타인의 재물을 빼앗거나 맡은 재산을 돌려주지 않는 행위를 금지합니다.</p>\r\n    <p>형법 제227조의2: 권한 없이 전자기록 등 특수매체기록을 위작하거나 변작하는 것을 금지합니다.</p>\r\n    <p>개인정보 보호법 제15조: 정보주체의 동의를 받거나 법령에 근거가 있을 때만 개인정보를 수집·이용할 수 있습니다.</p>\r\n    <p>같은 법 제17조·제18조: 동의나 법령 근거 없이 개인정보를 제3자에게 제공하거나 수집 목적 밖으로 이용하는 것을 금지합니다.</p>\r\n    <p>같은 법 제23조·제24조: 사상·신념, 노동조합 가입, 건강, 성생활 같은 민감정보와 주민등록번호 같은 고유식별정보는 별도 동의나 법령 근거 없이 처리할 수 없습니다.</p>\r\n    <p>같은 법 제22조의2: 만 14세 미만 아동의 개인정보는 법정대리인의 동의를 받아야 합니다.</p>\r\n    <p>같은 법 제71조: 위 조항을 어기면 5년 이하의 징역 또는 5천만 원 이하의 벌금에 처해집니다.</p>\r\n    <p>그 밖에 현행 법령과 감독 규정, 사용하는 모델의 약관과 남용 정책을 함께 지켜야 합니다.</p>\r\n    <h3>5. 그래서 금지되는 것</h3>\r\n    <p>미승인 접근. 서면 승인이 없는 기관·도메인·주소·공용 인터넷 시스템·운영 중인 서비스·주요 정보통신 기반 시설을 실습 대상으로 등록하거나, 그 대상에 스캔·탐지·침입·통제·패킷 발신을 하는 것을 금지합니다(정보통신망법 제48조 제1항·제3항).</p>\r\n    <p>파괴와 악성코드. 타인 시스템 기능이나 그 안의 데이터·프로그램을 삭제·수정·추가·방해하는 것, 바이러스·랜섬웨어 같은 파괴적 프로그램을 만들거나 퍼뜨리는 것, 정보나 소프트웨어에 악성코드를 심는 것을 금지합니다(정보통신망법 제48조 제2항·제4항, 형법 제314조 제2항).</p>\r\n    <p>도구와 조력. 이 프로젝트나 이 기기를 타인에게 넘겨 침입·불법 통제·데이터 탈취에 쓰게 하는 것, 상대가 정보통신망 범죄를 저지르는 것을 알면서 프로그램·도구·기술 지원·광고·결제 정산을 제공하는 것을 금지합니다.</p>\r\n    <p>데이터. 업무 데이터, 계정, 비밀번호 등 보호 대상 데이터를 절취·불법 수집·범위 초과 사용·유출·판매하거나 타인에게 제공하는 것을 금지합니다(형법 제329조·제355조).</p>\r\n    <p>개인정보. 타인의 개인정보를 불법으로 수집·이용·가공·전송·매매·제공·공개하는 것, 필요 이상으로 수집하는 것, 거짓이나 강요로 처리하는 것, 민감정보·고유식별정보·아동 개인정보를 함부로 처리하는 것을 금지합니다(개인정보 보호법 제15조·제17조·제18조·제22조의2·제23조·제24조·제71조).</p>\r\n    <p>사기와 불법정보. 사기, 범죄 방법 전수, 금지·규제 물품의 제작이나 판매에 쓰는 웹사이트나 단체 대화방을 개설하거나 그런 정보를 게시하는 것, 컴퓨터로 사기·절도·횡령을 저지르는 것을 금지합니다(형법 제347조, 정보통신망법 제44조의7).</p>\r\n    <p>콘텐츠. 명예훼손, 차별·혐오, 폭력·음란물·도박, 허위 정보 유포로 경제·사회 질서를 어지럽히는 콘텐츠를 만들거나 퍼뜨리는 것, 아동·청소년의 신체적·정신적 건강을 해치는 콘텐츠를 유통하는 것을 금지합니다(정보통신망법 제44조의7).</p>\r\n    <p>결과 확산. 모의해킹 중에 만든 기록, 자산 정보, 파일은 서면 승인에 적힌 대상과 기간 안에만 보관하고, 열람 권한이 없는 사람에게 넘기거나 승인 범위 밖의 용도로 쓰지 않습니다.</p>\r\n    <h3>6. 책임은 사용자에게 있습니다</h3>\r\n    <p>이 프로젝트는 MIT 라이선스에 따라 있는 그대로 제공됩니다. 개발자는 완전성·안전성·적합성을 보증하지 않습니다. 사용자는 내려받기, 배포, 실행, 수정, 전파와 모든 입력·출력에 대해 민사·행정·형사 책임을 스스로 집니다. 저자와 기여자는 오용으로 생긴 직접·간접·연대 책임을 지지 않습니다.</p>\r\n    <p>체크로 확인하는 사람은 조작자 본인이며, 이 선언을 읽지 않은 사람을 대신할 수 없고, 타인 시스템을 이미 승인받았다고 말할 수도 없습니다.</p>\r\n    <h3>7. 어기면 권한이 끝납니다</h3>\r\n    <p>불법 공격, 악의적 활동, 위에 적은 금지 행위 중 하나라도 하는 순간 사용 허락은 그 행위가 일어난 날부터 자동으로 끝나며 되돌릴 수 없습니다. 즉시 사용을 멈추고 이 프로젝트의 코드·스크립트·파생 데이터를 폐기한 뒤 법에 따라 책임을 지세요. 권한이 끝난 뒤에는 모의해킹을 열거나 계속 쓸 수 없습니다.</p>\r\n    <h3>8. DeepSeek 공식과의 관계</h3>\r\n    <p>이 프로젝트는 독립 오픈소스이며 DeepSeek 공식이나 그 관계사와 소속·상업 협력·승인·보증 관계가 없습니다. 본문의 '공식'은 사용자가 자기 컴퓨터에 설치한 공식 DeepSeek Harness 패키지를 뜻할 뿐이며, DeepSeek 공식이 이 플러그인을 개발·승인·보증한다는 뜻이 아닙니다.</p>\r\n    <p>끝. 카운트다운이 끝나고 여기까지 스크롤해 세 항목을 모두 체크하면, 본인 이름으로 이 선언을 인정하고 이번 모의해킹 권한을 마친 것이 됩니다.</p>";

export function AuthGate(props) {
  const t = useT();
  const [left, setLeft] = useState(10);
  const [readEnd, setReadEnd] = useState(false);
  const [checks, setChecks] = useState({
    read: false,
    scope: false,
    ban: false,
  });
  const legalRef = useRef(null);
  useEffect(() => {
    const id = window.setInterval(() => {
      setLeft((n) => {
        if (n <= 1) {
          window.clearInterval(id);
          return 0;
        }
        return n - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => {
    const el = legalRef.current;
    if (!el) return;
    if (el.scrollHeight <= el.clientHeight + 4) setReadEnd(true);
  }, []);
  const locked = left > 0 || !readEnd;
  const ready = !locked && checks.read && checks.scope && checks.ban;
  const hint =
    left > 0
      ? t("auth.hint.wait").replace("{n}", String(left))
      : readEnd
        ? t("auth.hint.check")
        : t("auth.hint.scroll");
  const onScroll = () => {
    const el = legalRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 8) setReadEnd(true);
  };
  const toggle = (id) => {
    if (locked) return;
    setChecks((prev) => Object.assign({}, prev, { [id]: !prev[id] }));
  };
  const okLabel = !ready
    ? t("auth.ok")
    : props.pending === "full"
      ? t("auth.ok.full")
      : props.pending === "env"
        ? t("auth.ok.env")
        : t("auth.ok.tab");
  return h(
    "div",
    { className: "dshpp-auth-mask", role: "dialog", "aria-modal": "true" },
    h(
      "div",
      { className: "dshpp-auth-modal" },
      h("h2", null, t("auth.title")),
      h(
        "div",
        {
          className: "muted",
          style: {
            color: "var(--dsw-alias-label-secondary,#999)",
            fontSize: 12,
          },
        },
        t("auth.lead"),
      ),
      h("div", { className: "dshpp-auth-warn" }, t("auth.warn")),
      h("div", {
        className: "dshpp-auth-legal",
        ref: legalRef,
        onScroll,
        dangerouslySetInnerHTML: { __html: AUTH_LEGAL_HTML },
      }),
      h(
        "div",
        {
          style: {
            color: "var(--dsw-alias-label-secondary,#999)",
            fontSize: 12,
          },
        },
        hint,
      ),
      h(
        "div",
        { className: "dshpp-auth-checks" },
        [
          ["read", "auth.check.read"],
          ["scope", "auth.check.scope"],
          ["ban", "auth.check.ban"],
        ].map((row) =>
          h(
            "label",
            { key: row[0], className: locked ? "locked" : "" },
            h("input", {
              type: "checkbox",
              checked: !!checks[row[0]],
              disabled: locked,
              onChange: () => toggle(row[0]),
            }),
            h("span", null, t(row[1])),
          ),
        ),
      ),
      h(
        "div",
        { className: "dshpp-auth-ops" },
        h(
          "button",
          {
            type: "button",
            onClick: () =>
              setDock({ authOpen: false, tab: "clean", pending: "tab" }),
          },
          t("auth.no"),
        ),
        h(
          "button",
          {
            type: "button",
            className: "primary",
            disabled: !ready,
            onClick: () => {
              if (!ready) return;
              writeDrillAuth(true);
              const kind = props.pending || "tab";
              setDock({
                authOpen: false,
                open: true,
                tab: "drill",
                pending: "tab",
              });
              try {
                if (__dshPurgeDrill && __dshPurgeDrill.setUI)
                  __dshPurgeDrill.setUI({ open: true });
              } catch {
                /* ignore */
              }
              if (kind === "env") {
                try {
                  if (__dshPurgeDrill && __dshPurgeDrill.setUI)
                    __dshPurgeDrill.setUI({ open: true, tab: "env" });
                } catch {
                  /* ignore */
                }
              }
              if (kind === "full") {
                try {
                  window.open(
                    window.location.href.split("#")[0] + "#redteam-full",
                    "_blank",
                    "noopener",
                  );
                } catch {
                  /* ignore */
                }
              }
            },
          },
          okLabel,
        ),
      ),
    ),
  );
}
