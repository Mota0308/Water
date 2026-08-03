import {
  FIXED_UNITS,
  type FixedUnit,
} from "@/application/store-work-flow-app";
import type { UnitHandlerOption } from "@/app/work/unit-handler-fields";
import { getStoreWorkFlowApp } from "@/infrastructure/app";

export async function loadHandlersByUnit(sessionId: string) {
  const app = await getStoreWorkFlowApp();
  const handlersByUnit: Partial<Record<FixedUnit, UnitHandlerOption[]>> = {};
  for (const unit of FIXED_UNITS) {
    const listed = await app.listUnitPersonalHandlers(sessionId, { unit });
    handlersByUnit[unit] = listed.ok ? listed.handlers : [];
  }
  return handlersByUnit;
}
