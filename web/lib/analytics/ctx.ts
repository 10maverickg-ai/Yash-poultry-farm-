// The context every farm screen uses: the engine context plus the realistic-target model learned from the farm's own records.
import { buildCtx, type Ctx, type EngineInput } from "./engine";
import { attachRealistic } from "./realistic";
import type { RealisticModel } from "./realisticTypes";

export function buildFarmCtx(input: EngineInput): { ctx: Ctx; model: RealisticModel; history: RealisticModel[] } {
  const ctx = buildCtx(input);
  const { model, history } = attachRealistic(ctx);
  return { ctx, model, history };
}
