import { z } from "zod";
import { idSchema, isoDateTimeSchema } from "./common.js";

export const projectSchema = z.object({
  id: idSchema,
  workspace_id: idSchema,
  name: z.string().min(1).max(120),
  url: z.string().url(),
  tagline: z.string().max(120).nullable(),
  description: z.string().min(1),
  target_icp: z.string().min(1),
  competitors: z.array(z.string().min(1)).max(25).default([]),
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema,
});
export type Project = z.infer<typeof projectSchema>;

export const createProjectSchema = projectSchema.pick({
  name: true,
  url: true,
  description: true,
  target_icp: true,
}).extend({
  tagline: z.string().max(120).optional(),
  competitors: z.array(z.string().min(1)).max(25).default([]),
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = createProjectSchema.partial();
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

export const listProjectsInputSchema = z.object({}).strict();

export const listProjectsOutputSchema = z.object({
  projects: z.array(projectSchema),
});
export type ListProjectsOutput = z.infer<typeof listProjectsOutputSchema>;
