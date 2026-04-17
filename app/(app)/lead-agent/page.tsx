"use client";

import { useAuth } from "@/components/auth/auth-provider";
import { AgentShell } from "@/components/agent/agent-shell";

export default function AgentPage() {
  useAuth();
  return <AgentShell />;
}
