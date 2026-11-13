// Source archives have no node_modules. Only annotate a missing direct dependency.
try {
  import.meta.resolve("yaml");
} catch (error) {
  if (error.code === "ERR_MODULE_NOT_FOUND") {
    error.message += "\n소스 설치에 yaml 이 없습니다. 플러그인 소스 루트(package-lock.json 이 있는 곳)에서 npm ci --omit=dev --ignore-scripts 를 실행하세요.";
  }
  throw error;
}
export const { parseDocument, isMap, isSeq, isScalar } = await import("yaml");
