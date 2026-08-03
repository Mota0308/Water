import { isStageDone, type StageStatus } from "@/application/production-domain";

export function stageTagClass(status: StageStatus | string): string {
  switch (status) {
    case "未開始":
      return "tag s-notstart";
    case "待處理":
      return "tag s-pending";
    case "進行中":
      return "tag s-doing";
    case "待確認":
      return "tag s-wait";
    case "需要修改":
      return "tag s-fix";
    case "已完成":
      return "tag s-done";
    case "直接下一階段":
      return "tag s-skip";
    case "不適用":
      return "tag s-na";
    case "暫停":
      return "tag s-paused";
    case "已取消":
      return "tag s-cancelled";
    default:
      return "tag s-notstart";
  }
}

export function StageStatusTag({ status }: { status: StageStatus | string }) {
  return <span className={stageTagClass(status)}>{status}</span>;
}

export function stageNumClass(
  status: StageStatus,
  isCurrent: boolean,
): string {
  if (isStageDone(status)) return "prod-stage-num is-done";
  if (isCurrent) return "prod-stage-num is-current";
  return "prod-stage-num";
}
