#!/usr/bin/env node
/**
 * Lead Enricher Worker
 *
 * Standalone long-running process that enriches leads from Supabase
 * using the 6-step pipeline. No Vercel timeout constraints.
 *
 * Usage:
 *   npx tsx workers/lead-enricher.ts
 *   npx tsx workers/lead-enricher.ts --concurrency 2
 *   npx tsx workers/lead-enricher.ts --org-id <uuid>  (restrict to one org)
 *
 * Requirements:
 *   - SUPABASE_URL in environment (or .env.local)
 *   - SUPABASE_SERVICE_ROLE_KEY in environment (or .env.local)
 *   - GEMINI_API_KEY in environment (or .env.local)
 *   - tsx installed: npm install -D tsx
 *   - dotenv: npm install dotenv (already a dep in Next.js)
 */

import path from "path";
import { readFileSync } from "fs";

// Load .env.local before importing anything that reads env vars

function loadEnvFile(filePath: string) {
  try {
    const content = readFileSync(filePath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    // file not found — skip
  }
}

loadEnvFile(path.resolve(process.cwd(), ".env.local"));
loadEnvFile(path.resolve(process.cwd(), ".env"));

import { createClient } from "@supabase/supabase-js";
import { runSixStepEnrichment, type LeadResult, type OnStepComplete } from "../lib/lead-agent/index";
import { computeLeadScore } from "../lib/lead-agent/enrichment/lead-scorer";

// ---------------------------------------------------------------------------
// Supabase client
// ---------------------------------------------------------------------------

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error(
    "[Worker] ✗ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set. Check .env.local"
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const concurrency = parseInt(
  args[args.indexOf("--concurrency") + 1] || "1",
  10
) || 1;
const orgIdFilter = args[args.indexOf("--org-id") + 1] || null;

// ---------------------------------------------------------------------------
// Worker state
// ---------------------------------------------------------------------------

let shuttingDown = false;
let activeCount = 0;

process.on("SIGINT", () => {
  console.log("\n[Worker] SIGINT received — finishing current leads then exiting...");
  shuttingDown = true;
  if (activeCount === 0) process.exit(0);
});

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

async function pollNextPendingLead(): Promise<Record<string, unknown> | null> {
  let query = supabase
    .from("leads")
    .select("*")
    .eq("enrichment_status", "pending")
    .order("created_at", { ascending: true })
    .limit(1);

  if (orgIdFilter) query = query.eq("org_id", orgIdFilter);

  const { data, error } = await query.maybeSingle();
  if (error) {
    console.error("[Worker] Poll error:", error.message);
    return null;
  }
  return data ?? null;
}

async function markEnriching(leadId: string): Promise<void> {
  await supabase
    .from("leads")
    .update({ enrichment_status: "enriching", enrichment_step: "starting" })
    .eq("id", leadId);
}

async function markFailed(leadId: string, errorMsg: string): Promise<void> {
  await supabase
    .from("leads")
    .update({
      enrichment_status: "failed",
      enrichment_step: "failed",
      enrichment_data: { error: errorMsg },
    })
    .eq("id", leadId);
}

async function markCompleted(leadId: string, lead: LeadResult): Promise<void> {
  await supabase
    .from("leads")
    .update({
      // Core fields
      phone: lead.phone,
      email: lead.email,
      address: lead.address,
      description: lead.description,
      has_website: lead.has_website,
      website_url: lead.website_url,
      website_quality: lead.website_quality,
      website_score: lead.website_score,
      has_https: lead.has_https,
      has_booking: lead.has_booking,
      has_chatbot: lead.has_chatbot,
      has_meta_ads: lead.has_meta_ads,
      meta_ads_count: lead.meta_ads_count,
      facebook_url: lead.facebook_url,
      instagram_url: lead.instagram_url,
      follower_count: lead.follower_count,
      // Owner / legal
      owner_name: lead.owner_name,
      owner_phone: lead.owner_phone,
      owner_email: lead.owner_email,
      owner_role: lead.owner_role,
      linkedin_url: lead.linkedin_url,
      siren: lead.siren,
      company_type: lead.company_type,
      creation_date: lead.creation_date,
      employee_count: lead.employee_count,
      revenue_bracket: lead.revenue_bracket,
      // Pipeline / analysis
      potential_score: lead.potential_score,
      prospect_analysis: lead.prospect_analysis ?? null,
      targeted_offer: lead.targeted_offer ?? null,
      identified_need: lead.identified_need ?? null,
      priority_score: lead.priority_score ?? "cold",
      // Status
      enrichment_status: "completed",
      enrichment_step: "done",
      enrichment_data: lead.enrichment_data || {},
      updated_at: new Date().toISOString(),
    })
    .eq("id", leadId);
}

// ---------------------------------------------------------------------------
// Step-save callback — persists partial results after each step
// ---------------------------------------------------------------------------

function makeOnStepComplete(leadId: string): OnStepComplete {
  return async (stepName, partial) => {
    const update: Record<string, unknown> = {
      enrichment_step: stepName,
      updated_at: new Date().toISOString(),
    };

    // Map partial LeadResult fields to DB columns
    const fieldMap: Record<string, string> = {
      has_website: "has_website",
      website_url: "website_url",
      website_quality: "website_quality",
      website_score: "website_score",
      has_https: "has_https",
      has_booking: "has_booking",
      has_chatbot: "has_chatbot",
      owner_name: "owner_name",
      owner_role: "owner_role",
      owner_phone: "owner_phone",
      owner_email: "owner_email",
      linkedin_url: "linkedin_url",
      siren: "siren",
      company_type: "company_type",
      creation_date: "creation_date",
      employee_count: "employee_count",
      revenue_bracket: "revenue_bracket",
      address: "address",
      phone: "phone",
      email: "email",
      facebook_url: "facebook_url",
      instagram_url: "instagram_url",
      follower_count: "follower_count",
      has_meta_ads: "has_meta_ads",
      meta_ads_count: "meta_ads_count",
      description: "description",
      potential_score: "potential_score",
      prospect_analysis: "prospect_analysis",
      targeted_offer: "targeted_offer",
      identified_need: "identified_need",
      priority_score: "priority_score",
      enrichment_data: "enrichment_data",
    };

    for (const [key, col] of Object.entries(fieldMap)) {
      if (key in partial && (partial as Record<string, unknown>)[key] !== undefined) {
        update[col] = (partial as Record<string, unknown>)[key];
      }
    }

    const { error } = await supabase.from("leads").update(update).eq("id", leadId);
    if (error) {
      console.error(`[Worker] Step save error (${stepName}):`, error.message);
    } else {
      console.log(`[Worker] ✓ Saved step: ${stepName}`);
    }
  };
}

// ---------------------------------------------------------------------------
// Process a single lead
// ---------------------------------------------------------------------------

async function processLead(dbLead: Record<string, unknown>): Promise<void> {
  const leadId = dbLead.id as string;
  const businessName = dbLead.business_name as string;
  const location = (dbLead.location as string) || "";

  console.log(`\n${"═".repeat(60)}`);
  console.log(`[Worker] Processing: ${businessName} (${location})`);
  console.log(`[Worker] Lead ID: ${leadId}`);
  console.log(`${"═".repeat(60)}`);

  await markEnriching(leadId);

  const lead: LeadResult = {
    business_name: businessName,
    description: (dbLead.description as string) || null,
    address: (dbLead.address as string) || null,
    phone: (dbLead.phone as string) || null,
    email: (dbLead.email as string) || null,
    rating: (dbLead.rating as string) || null,
    review_count: (dbLead.review_count as string) || null,
    review_highlights: (dbLead.review_highlights as string[]) || [],
    has_website: (dbLead.has_website as boolean) || false,
    website_url: (dbLead.website_url as string) || null,
    google_maps_url: (dbLead.google_maps_url as string) || null,
    facebook_url: (dbLead.facebook_url as string) || null,
    instagram_url: (dbLead.instagram_url as string) || null,
    owner_name: (dbLead.owner_name as string) || null,
    owner_phone: (dbLead.owner_phone as string) || null,
    owner_email: (dbLead.owner_email as string) || null,
    owner_role: (dbLead.owner_role as string) || null,
    linkedin_url: (dbLead.linkedin_url as string) || null,
    siren: (dbLead.siren as string) || null,
    company_type: (dbLead.company_type as string) || null,
    creation_date: (dbLead.creation_date as string) || null,
    revenue_bracket: (dbLead.revenue_bracket as string) || null,
    employee_count: (dbLead.employee_count as string) || null,
    follower_count: (dbLead.follower_count as number) || null,
    website_quality: (dbLead.website_quality as string) || null,
    website_score: (dbLead.website_score as number) || null,
    has_https: (dbLead.has_https as boolean) ?? null,
    has_booking: (dbLead.has_booking as boolean) ?? null,
    has_chatbot: (dbLead.has_chatbot as boolean) ?? null,
    has_meta_ads: (dbLead.has_meta_ads as boolean) ?? null,
    meta_ads_count: (dbLead.meta_ads_count as number) ?? null,
    potential_score: (dbLead.potential_score as number) || null,
    source: (dbLead.source as string) || "Google Maps",
    enrichment_data: (dbLead.enrichment_data as Record<string, unknown>) || {},
    niche: (dbLead.niche as string) || null,
  };

  const onStepComplete = makeOnStepComplete(leadId);

  try {
    const enriched = await runSixStepEnrichment(lead, location, console.log, onStepComplete);
    await markCompleted(leadId, enriched);
    console.log(`[Worker] ✓ Completed: ${businessName} | score=${enriched.potential_score ?? "—"}/100 | priority=${enriched.priority_score ?? "—"}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[Worker] ✗ Failed: ${businessName} — ${msg}`);
    await markFailed(leadId, msg);
  }
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function workerLoop(workerId: number): Promise<void> {
  let consecutiveEmpty = 0;

  while (!shuttingDown) {
    const dbLead = await pollNextPendingLead();

    if (!dbLead) {
      consecutiveEmpty++;
      const waitMs = Math.min(5000 * consecutiveEmpty, 30_000);
      if (consecutiveEmpty === 1) {
        console.log(`[Worker ${workerId}] No pending leads — waiting...`);
      }
      await sleep(waitMs);
      continue;
    }

    consecutiveEmpty = 0;
    activeCount++;

    try {
      await processLead(dbLead);
    } finally {
      activeCount--;
      if (shuttingDown && activeCount === 0) {
        console.log("[Worker] All leads done — exiting.");
        process.exit(0);
      }
    }

    // Brief pause between leads
    await sleep(2000);
  }
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

console.log(`
╔══════════════════════════════════════════════════════╗
║          LEAD ENRICHER WORKER                        ║
║  Concurrency : ${String(concurrency).padEnd(3)} workers                       ║
║  Org filter  : ${(orgIdFilter || "all orgs").slice(0, 32).padEnd(36)} ║
║  Press Ctrl+C to stop gracefully                     ║
╚══════════════════════════════════════════════════════╝
`);
console.log(`[Worker] Connecting to Supabase: ${supabaseUrl}`);
console.log(`[Worker] Starting ${concurrency} worker(s)...\n`);

// Launch worker loops
const workers = Array.from({ length: concurrency }, (_, i) => workerLoop(i + 1));
Promise.all(workers).catch((e) => {
  console.error("[Worker] Fatal error:", e);
  process.exit(1);
});
