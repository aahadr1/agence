import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";

// Le runtime agent vit désormais sur le VPS (OpenCode + Telegram bridge),
// plus aucune fonction Inngest n'est exposée ici. On garde l'endpoint pour
// rebrancher facilement d'autres jobs background plus tard.
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [],
});
