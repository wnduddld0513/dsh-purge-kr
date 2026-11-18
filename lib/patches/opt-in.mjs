// [dsh-purge] core.js 에서 그대로 옮겨 왔다(커뮤니티판 1.6.69 패치표 분리), 의미 변경은 없다.
const repeatStart = [
  "\tctx.on(\"tools/post-execute\", async (exec, _result, next) => {",
  "\t\tconst reminder = observe(exec);",
  "\t\tconst downstream = await next();",
  "\t\tif (!reminder) return downstream;",
];
const legacyBlock = [
  "\t\tif (downstream.kind === \"block\") return {",
  "\t\t\tkind: \"block\",",
  "\t\t\tfeedback: downstream.feedback,",
  "\t\t\tadditionalContexts: prependContext(reminder, downstream.additionalContexts)",
  "\t\t};",
];
const repeatEnd = [
  "\t\treturn {",
  "\t\t\t...downstream,",
  "\t\t\tadditionalContexts: prependContext(reminder, downstream.additionalContexts)",
  "\t\t};",
  "\t});",
  "\tctx.on(\"agent/pre-step\", ({ agent, messages }, next) => {",
  "\t\tif (messages.some((message) => message.source.kind === \"user\")) chains.delete(agent);",
  "\t\treturn next();",
  "\t});",
];

export const OPT_IN_PATCHES = [
  {
    "id": 18,
    "name": "REPEAT_TOOL_REMINDER_DISABLED",
    "layer": "코드",
    "layer_en": "Code",
    "desc": "반복 호출 가드 비활성화 / repeat-tool-reminder disabled(선택, 기본 꺼짐; 켜면 컨텍스트 보호가 해제됩니다)",
    "file": "repeat-tool-reminder",
    "rel": [
      "lib",
      "index.js"
    ],
    replacements: [legacyBlock, []].map(block => ({
      pattern: [...repeatStart, ...block, ...repeatEnd].join("\n"),
      replace: "\t// [dsh-purge] repeat-tool-reminder disabled: no reminder injection,\n\t// no chain tracking. The guard is fully inert.",
    })),
    forbid: ['ctx.on("tools/post-execute"', 'ctx.on("agent/pre-step"'],
    "markers": [
      "[dsh-purge] repeat-tool-reminder disabled"
    ],
    "optional": true,
    "disabledByDefault": true,
    "optIn": true
  },
  {
    "id": 19,
    "name": "TOOL_RESULT_PRUNER_DISABLED",
    "layer": "코드",
    "layer_en": "Code",
    "desc": "도구 결과 트리밍 비활성화 / tool-result pruner disabled(선택, 기본 꺼짐; 켜면 컨텍스트 보호가 해제됩니다)",
    "file": "compaction-tool-result-pruner",
    "rel": [
      "lib",
      "index.js"
    ],
    "replacements": [
      {
        "pattern": "\tpruneContent(blocks) {\n\t\tconst totalChars = this.measureContent(blocks);\n\t\tif (totalChars <= this.config.thresholdChars) return null;",
        "replace": "\tpruneContent(blocks) {\n\t\t// [dsh-purge] tool-result pruning disabled: results pass through unchanged.\n\t\treturn null;"
      }
    ],
    "markers": [
      "[dsh-purge] tool-result pruning disabled"
    ],
    "optional": true,
    "disabledByDefault": true,
    "optIn": true
  }
];

