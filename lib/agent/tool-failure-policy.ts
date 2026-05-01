export type ToolFailureCategory =
  | "auth_error"
  | "configuration_error"
  | "browser_closed"
  | "browser_resource_exhausted"
  | "validation_failed"
  | "rate_limited"
  | "timeout"
  | "transient"
  | "repeated_identical_call"
  | "unknown";

export interface ToolFailurePolicy {
  category: ToolFailureCategory;
  retryableSameArgs: boolean;
  blockToolForSession: boolean;
  hintFr: string;
}

export function classifyToolFailure(
  message: string,
  toolName: string,
): ToolFailurePolicy {
  const m = message.toLowerCase();
  const nonRetryable = /\[non_retryable\]/i.test(message);

  if (
    m.includes("401") ||
    m.includes("403") ||
    m.includes("api key") ||
    m.includes("api_key") ||
    m.includes("missing_api_key") ||
    m.includes("not set") ||
    m.includes("unauthorized")
  ) {
    const authLike =
      m.includes("401") ||
      m.includes("403") ||
      m.includes("unauthorized") ||
      m.includes("api key") ||
      m.includes("api_key");
    return {
      category: authLike ? "auth_error" : "configuration_error",
      retryableSameArgs: false,
      blockToolForSession:
        toolName === "pappers_search" ||
        toolName === "societe_com_lookup",
      hintFr:
        "Erreur de configuration/authentification : ne relance pas le même outil avec les mêmes paramètres. Note le blocage une fois, puis bascule vers une autre source ou un autre candidat.",
    };
  }

  if (
    m.includes("target page, context or browser has been closed") ||
    (m.includes("browsercontext") && m.includes("closed")) ||
    m.includes("target closed") ||
    m.includes("protocol error") ||
    m.includes("frame has been detached")
  ) {
    return {
      category: "browser_closed",
      retryableSameArgs: true,
      blockToolForSession: false,
      hintFr:
        "Navigateur fermé/crashé : le runtime peut retenter avec Chromium frais. Si l'erreur se répète, réduis les outils navigateur et passe à une source non navigateur ou au candidat suivant.",
    };
  }

  if (
    m.includes("browser_resource_exhausted") ||
    m.includes("no space left") ||
    m.includes("enospc") ||
    m.includes("64mb") ||
    m.includes("resource temporarily unavailable") ||
    m.includes("sigtrap")
  ) {
    return {
      category: "browser_resource_exhausted",
      retryableSameArgs: false,
      blockToolForSession: false,
      hintFr:
        "Ressource navigateur épuisée : ne boucle pas. Sauvegarde l'état, utilise des outils non navigateur ou attends une nouvelle exécution.",
    };
  }

  if (
    m.includes("rate limit") ||
    m.includes("429") ||
    m.includes("quota")
  ) {
    return {
      category: "rate_limited",
      retryableSameArgs: false,
      blockToolForSession: false,
      hintFr:
        "Limite temporaire : ne relance pas immédiatement le même appel. Pivote vers une source alternative ou continue sur d'autres items.",
    };
  }

  if (
    m.includes("validation") ||
    m.includes("fiche refus") ||
    m.includes("no valid rows") ||
    m.includes("missing") ||
    m.includes("requis") ||
    m.includes("required")
  ) {
    return {
      category: "validation_failed",
      retryableSameArgs: false,
      blockToolForSession: false,
      hintFr:
        "Validation échouée : ne réessaie pas identiquement. Lis les champs manquants, complète l'item dans le workset, puis rappelle l'outil avec des données corrigées.",
    };
  }

  if (m.includes("timeout") || m.includes("timed out")) {
    return {
      category: "timeout",
      retryableSameArgs: true,
      blockToolForSession: false,
      hintFr:
        "Timeout : une seule relance ciblée peut se justifier, sinon reformule ou passe au candidat suivant.",
    };
  }

  if (m.includes("repeated_identical_call")) {
    return {
      category: "repeated_identical_call",
      retryableSameArgs: false,
      blockToolForSession: false,
      hintFr:
        "Appel identique répété : change les paramètres, récupère l'état existant, ou passe à une autre stratégie.",
    };
  }

  if (nonRetryable) {
    return {
      category: "configuration_error",
      retryableSameArgs: false,
      blockToolForSession: false,
      hintFr:
        "Erreur non-retryable pour ces paramètres : ne répète pas l'appel identique. Change les données, la source ou l'item avant de réessayer.",
    };
  }

  return {
    category: "unknown",
    retryableSameArgs: true,
    blockToolForSession: false,
    hintFr:
      "Erreur non classée : évite de répéter en boucle. Note l'observation, puis choisis une stratégie qui ajoute de l'information.",
  };
}
