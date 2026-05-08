/**
 * Audit plugin — log chaque tool exécuté avec ses args dans la stdout du service systemd.
 * Permet de retrouver dans `journalctl -u opencode -f` ce que l'agent a fait.
 */
import type { Plugin } from "@opencode-ai/plugin";

export const AuditPlugin: Plugin = async () => {
  return {
    "tool.execute.before": async (input, output) => {
      const args = JSON.stringify(output.args).slice(0, 500);
      console.log(`[audit] ▶ ${input.tool} ${args}`);
    },
    "tool.execute.after": async (input, output) => {
      const status = output.error ? "✗" : "✓";
      const summary = output.error
        ? `error=${output.error.message?.slice(0, 200)}`
        : `output=${JSON.stringify(output.output).slice(0, 200)}`;
      console.log(`[audit] ${status} ${input.tool} ${summary}`);
    },
  };
};
