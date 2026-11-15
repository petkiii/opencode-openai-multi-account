import { Plugin } from "@opencode/plugin";
import { AccountUsage } from "./rpc.js";
import { createUsageService } from "../core/usage-service.js";

export default Plugin.define({
  id: "opencode-openai-multi-account",
  async setup(context) {
    const usage = createUsageService(context, async (credentialID) => {
      await registration.events.emit("updated", { credentialID });
    });
    const registration = await context.rpc.register(AccountUsage, {
      get: (input) => usage.get(input),
    });
    return async () => {
      usage.dispose();
      await registration.dispose();
    };
  },
});
