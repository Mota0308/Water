export const DEV_STAGES = [
  "企劃選材",
  "技術規格單",
  "打版",
  "樣本修改與確認",
  "量產準備",
  "倉存與物流",
  "陳列銷售",
] as const;

export const REP_STAGES = [
  "銷售分析",
  "打版",
  "樣本修改與確認",
  "量產準備",
  "倉存與物流",
  "陳列銷售",
] as const;

export const PRODUCT_CATEGORIES = [
  "成人保暖衣",
  "兒童保暖衣",
  "成人抓毛",
  "兒童抓毛",
  "成人膠衣",
  "兒童膠衣",
  "成人泳裝",
  "兒童泳裝",
  "防曬用品",
  "游水用品",
  "防水袋",
  "其他",
] as const;

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];
export type ProductionProjectType = "dev" | "rep";

export type StageStatus =
  | "未開始"
  | "待處理"
  | "進行中"
  | "待確認"
  | "需要修改"
  | "已完成"
  | "直接下一階段"
  | "不適用";

export const HANDLER_STAGE_STATUSES: StageStatus[] = [
  "進行中",
  "待確認",
  "需要修改",
  "已完成",
  "直接下一階段",
  "不適用",
];

export type ProductionStageView = {
  index: number;
  name: string;
  handlerAccountId: string | null;
  handlerDisplayName: string | null;
  handlerDepartment: string | null;
  status: StageStatus;
  deadline: string | null;
  content: string;
  completedAt: Date | null;
};

export type ProductionProjectView = {
  id: string;
  type: ProductionProjectType;
  code: string;
  name: string;
  category: string;
  description: string;
  ownerAccountId: string | null;
  ownerDisplayName: string | null;
  dueDate: string | null;
  status: string;
  progressPercent: number;
  currentStageName: string | null;
  stages: ProductionStageView[];
  createdAt: Date;
};

export type ProductionTaskView = {
  projectId: string;
  projectCode: string;
  projectName: string;
  stageIndex: number;
  stageName: string;
  status: StageStatus;
  deadline: string | null;
  type: ProductionProjectType;
};

export function stagesForType(type: ProductionProjectType): readonly string[] {
  return type === "dev" ? DEV_STAGES : REP_STAGES;
}

export function isStageDone(status: StageStatus): boolean {
  return (
    status === "已完成" || status === "直接下一階段" || status === "不適用"
  );
}

export function projectProgress(
  stages: { status: StageStatus }[],
): number {
  if (!stages.length) return 0;
  const done = stages.filter((s) => isStageDone(s.status)).length;
  return Math.round((done / stages.length) * 100);
}

export function currentStageIndex(
  stages: { status: StageStatus }[],
): number {
  const idx = stages.findIndex((s) => !isStageDone(s.status));
  return idx === -1 ? stages.length - 1 : idx;
}
