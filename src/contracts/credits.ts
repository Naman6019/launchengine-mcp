import { z } from "zod";
import { idSchema } from "./common.js";

export const getCreditBalanceInputSchema = z.object({}).strict();

export const getCreditBalanceOutputSchema = z.object({
  workspace_id: idSchema,
  balance: z.number().int().nonnegative(),
  plan: z.enum(["free_trial", "radar", "radar_byok", "launch_pass"]),
});
export type GetCreditBalanceOutput = z.infer<
  typeof getCreditBalanceOutputSchema
>;

/** Cost table (credits per unit) — mirror of the server config, surfaced to agents. */
export const creditCostsSchema = z.object({
  verified_lead_reveal: z.number().int().positive(),
  serp_scan: z.number().int().positive(),
  comparison_page_draft: z.number().int().positive(),
});
export type CreditCosts = z.infer<typeof creditCostsSchema>;

export const DEFAULT_CREDIT_COSTS: CreditCosts = {
  verified_lead_reveal: 5,
  serp_scan: 1,
  comparison_page_draft: 10,
};
