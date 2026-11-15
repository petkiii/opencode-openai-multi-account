import { Rpc } from "@opencode/plugin/rpc";
import { z } from "zod";

export const usageSnapshotSchema = z.object({
  fetchedAt: z.string(),
  planType: z.string().optional(),
  windows: z.array(
    z.object({
      label: z.string(),
      windowSeconds: z.number(),
      resetsAt: z.string().optional(),
      percentUsed: z.number().optional(),
    }),
  ),
});

export const usageEntrySchema = z.object({
  credentialID: z.string(),
  snapshot: usageSnapshotSchema.optional(),
  error: z.string().optional(),
});
export type UsageEntry = z.infer<typeof usageEntrySchema>;

export const AccountUsage = Rpc.define({
  id: "opencode-openai-multi-account",
  methods: {
    get: {
      input: z.object({
        credentialIDs: z.array(z.string()),
        refresh: z.boolean(),
      }),
      output: z.array(usageEntrySchema),
    },
  },
  events: {
    updated: { schema: z.object({ credentialID: z.string() }) },
  },
});
