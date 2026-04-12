import { requireCrmContext } from "@/lib/crm/api";
import { ensureCrmPipelineForOrg } from "@/lib/crm/service";
import type { ProspectTemperature } from "@/lib/crm/types";
import { NextResponse } from "next/server";

function computeTemperature(
  lastActivityAt: string | null,
  overdueTaskCount: number,
  probability: number
): ProspectTemperature {
  const daysSinceActivity = lastActivityAt
    ? (Date.now() - new Date(lastActivityAt).getTime()) / 86_400_000
    : Infinity;

  if (daysSinceActivity < 3 && overdueTaskCount === 0) return "hot";
  if (daysSinceActivity < 14 || probability >= 70) return "warm";
  return "cold";
}

export async function GET(request: Request) {
  const ctx = await requireCrmContext(request);
  if (!ctx.ok) return ctx.response;

  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const perPage = Math.min(100, Math.max(1, Number(url.searchParams.get("per_page")) || 25));
  const sortBy = url.searchParams.get("sort_by") || "created_at";
  const sortDir = url.searchParams.get("sort_dir") === "asc" ? "asc" : "desc";
  const search = url.searchParams.get("search")?.trim() || "";
  const statusFilter = url.searchParams.getAll("status");
  const stageFilter = url.searchParams.getAll("stage_id");
  const ownerFilter = url.searchParams.get("owner_user_id") || "";
  const sourceFilter = url.searchParams.getAll("source");
  const tagFilter = url.searchParams.getAll("tag");

  try {
    const pipeline = await ensureCrmPipelineForOrg(ctx.supabase, ctx.orgId);

    const { data: stages } = await ctx.supabase
      .from("crm_stages_v2")
      .select("id,name,color,sort_order,pipeline_id")
      .eq("pipeline_id", pipeline.id)
      .order("sort_order", { ascending: true });

    const stageMap = new Map(
      (stages || []).map((s) => [s.id, s])
    );

    let query = ctx.supabase
      .from("crm_opportunities")
      .select("*", { count: "exact" })
      .eq("org_id", ctx.orgId)
      .eq("pipeline_id", pipeline.id);

    if (statusFilter.length > 0) {
      query = query.in("status", statusFilter);
    }
    if (stageFilter.length > 0) {
      query = query.in("stage_id", stageFilter);
    }
    if (ownerFilter) {
      query = query.eq("owner_user_id", ownerFilter);
    }
    if (sourceFilter.length > 0) {
      query = query.in("source", sourceFilter);
    }
    if (tagFilter.length > 0) {
      query = query.overlaps("tags", tagFilter);
    }

    const validSortColumns: Record<string, string> = {
      created_at: "created_at",
      updated_at: "updated_at",
      title: "title",
      amount_cents: "amount_cents",
      probability: "probability",
      expected_close_date: "expected_close_date",
      status: "status",
    };
    const actualSort = validSortColumns[sortBy] || "created_at";
    query = query.order(actualSort, { ascending: sortDir === "asc" });

    const from = (page - 1) * perPage;
    const to = from + perPage - 1;
    query = query.range(from, to);

    const { data: opportunities, count, error: oppErr } = await query;
    if (oppErr) {
      return NextResponse.json({ error: oppErr.message }, { status: 500 });
    }

    const rows = opportunities || [];
    if (rows.length === 0) {
      return NextResponse.json({
        prospects: [],
        total: count || 0,
        page,
        per_page: perPage,
        stages: stages || [],
      });
    }

    const oppIds = rows.map((r) => r.id);
    const accountIds = [...new Set(rows.map((r) => r.account_id).filter(Boolean))] as string[];
    const contactIds = [...new Set(rows.map((r) => r.primary_contact_id).filter(Boolean))] as string[];

    const [accountsRes, contactsRes, activitiesRes, tasksRes] = await Promise.all([
      accountIds.length > 0
        ? ctx.supabase.from("crm_accounts").select("*").in("id", accountIds)
        : Promise.resolve({ data: [] as Record<string, unknown>[], error: null }),
      contactIds.length > 0
        ? ctx.supabase.from("crm_contacts").select("*").in("id", contactIds)
        : Promise.resolve({ data: [] as Record<string, unknown>[], error: null }),
      ctx.supabase
        .from("crm_activities")
        .select("opportunity_id,type,happened_at")
        .eq("org_id", ctx.orgId)
        .in("opportunity_id", oppIds)
        .order("happened_at", { ascending: false }),
      ctx.supabase
        .from("crm_tasks")
        .select("id,opportunity_id,status,due_at")
        .eq("org_id", ctx.orgId)
        .in("opportunity_id", oppIds)
        .in("status", ["todo", "in_progress"]),
    ]);

    const accountMap = new Map(
      ((accountsRes.data as Array<Record<string, unknown>>) || []).map((a) => [a.id as string, a])
    );
    const contactMap = new Map(
      ((contactsRes.data as Array<Record<string, unknown>>) || []).map((c) => [c.id as string, c])
    );

    const latestActivityMap = new Map<string, { happened_at: string; type: string }>();
    for (const act of activitiesRes.data || []) {
      if (act.opportunity_id && !latestActivityMap.has(act.opportunity_id)) {
        latestActivityMap.set(act.opportunity_id, {
          happened_at: act.happened_at,
          type: act.type,
        });
      }
    }

    const now = Date.now();
    const taskStatsMap = new Map<string, { open: number; overdue: number; nextDue: string | null }>();
    for (const task of tasksRes.data || []) {
      if (!task.opportunity_id) continue;
      const prev = taskStatsMap.get(task.opportunity_id) || { open: 0, overdue: 0, nextDue: null };
      prev.open += 1;
      if (task.due_at && new Date(task.due_at).getTime() < now) {
        prev.overdue += 1;
      }
      if (task.due_at && (!prev.nextDue || task.due_at < prev.nextDue)) {
        prev.nextDue = task.due_at;
      }
      taskStatsMap.set(task.opportunity_id, prev);
    }

    let prospects = rows.map((opp) => {
      const stage = stageMap.get(opp.stage_id);
      const account = opp.account_id ? accountMap.get(opp.account_id) : null;
      const contact = opp.primary_contact_id ? contactMap.get(opp.primary_contact_id) : null;
      const latestAct = latestActivityMap.get(opp.id);
      const taskStats = taskStatsMap.get(opp.id) || { open: 0, overdue: 0, nextDue: null };

      return {
        id: opp.id,
        title: opp.title,
        description: opp.description,
        status: opp.status,
        stage_id: opp.stage_id,
        stage_name: stage?.name || "Unknown",
        stage_color: stage?.color || "#64748b",
        stage_sort_order: stage?.sort_order ?? 0,
        amount_cents: opp.amount_cents,
        currency: opp.currency,
        probability: opp.probability,
        expected_close_date: opp.expected_close_date,
        owner_user_id: opp.owner_user_id,
        source: opp.source,
        tags: opp.tags || [],
        created_at: opp.created_at,
        updated_at: opp.updated_at,
        account_name: (account?.name as string) || null,
        account_phone: (account?.phone as string) || null,
        account_email: (account?.email as string) || null,
        account_website: (account?.website_url as string) || null,
        contact_name: (contact?.full_name as string) || null,
        contact_email: (contact?.email as string) || null,
        contact_phone: (contact?.phone as string) || null,
        contact_role: (contact?.role as string) || null,
        contact_linkedin: (contact?.linkedin_url as string) || null,
        last_activity_at: latestAct?.happened_at || null,
        last_activity_type: latestAct?.type || null,
        open_task_count: taskStats.open,
        overdue_task_count: taskStats.overdue,
        next_task_due: taskStats.nextDue,
        temperature: computeTemperature(
          latestAct?.happened_at || null,
          taskStats.overdue,
          opp.probability
        ),
      };
    });

    if (search) {
      const lower = search.toLowerCase();
      prospects = prospects.filter(
        (p) =>
          p.title.toLowerCase().includes(lower) ||
          (p.account_name && p.account_name.toLowerCase().includes(lower)) ||
          (p.contact_name && p.contact_name.toLowerCase().includes(lower)) ||
          (p.contact_email && p.contact_email.toLowerCase().includes(lower)) ||
          (p.account_email && p.account_email.toLowerCase().includes(lower)) ||
          (p.contact_phone && p.contact_phone.includes(search)) ||
          (p.account_phone && p.account_phone.includes(search))
      );
    }

    return NextResponse.json({
      prospects,
      total: count || 0,
      page,
      per_page: perPage,
      stages: stages || [],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to load prospects";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const ctx = await requireCrmContext(request);
  if (!ctx.ok) return ctx.response;

  const body = await request.json();
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  try {
    const pipeline = await ensureCrmPipelineForOrg(ctx.supabase, ctx.orgId);

    let stageId = body.stage_id;
    if (!stageId) {
      const { data: firstStage } = await ctx.supabase
        .from("crm_stages_v2")
        .select("id")
        .eq("pipeline_id", pipeline.id)
        .order("sort_order", { ascending: true })
        .limit(1)
        .maybeSingle();
      stageId = firstStage?.id;
    }
    if (!stageId) {
      return NextResponse.json({ error: "No stages in pipeline" }, { status: 500 });
    }

    let accountId: string | null = null;
    const accountName = typeof body.account_name === "string" ? body.account_name.trim() : "";
    if (accountName) {
      const { data: account, error: accErr } = await ctx.supabase
        .from("crm_accounts")
        .insert({
          org_id: ctx.orgId,
          name: accountName,
          phone: body.account_phone || null,
          email: body.account_email || null,
          website_url: body.account_website || null,
          source: body.source || "manual",
          owner_user_id: ctx.userId,
          created_by: ctx.userId,
        })
        .select("id")
        .single();
      if (!accErr && account) accountId = account.id;
    }

    let contactId: string | null = null;
    const contactName = typeof body.contact_name === "string" ? body.contact_name.trim() : "";
    if (contactName) {
      const { data: contact, error: ctErr } = await ctx.supabase
        .from("crm_contacts")
        .insert({
          org_id: ctx.orgId,
          account_id: accountId,
          full_name: contactName,
          role: body.contact_role || null,
          phone: body.contact_phone || null,
          email: body.contact_email || null,
          linkedin_url: body.contact_linkedin || null,
          owner_user_id: ctx.userId,
          created_by: ctx.userId,
        })
        .select("id")
        .single();
      if (!ctErr && contact) contactId = contact.id;
    }

    const { data: opp, error: oppErr } = await ctx.supabase
      .from("crm_opportunities")
      .insert({
        org_id: ctx.orgId,
        pipeline_id: pipeline.id,
        stage_id: stageId,
        account_id: accountId,
        primary_contact_id: contactId,
        title,
        description: body.description || null,
        owner_user_id: ctx.userId,
        amount_cents: typeof body.amount_cents === "number" ? Math.round(body.amount_cents) : 0,
        currency: body.currency || "EUR",
        probability: typeof body.probability === "number" ? Math.max(0, Math.min(100, body.probability)) : 0,
        expected_close_date: body.expected_close_date || null,
        source: body.source || "manual",
        tags: Array.isArray(body.tags) ? body.tags : [],
        created_by: ctx.userId,
      })
      .select("*")
      .single();

    if (oppErr || !opp) {
      return NextResponse.json({ error: oppErr?.message || "Failed to create prospect" }, { status: 500 });
    }

    await ctx.supabase.from("crm_opportunity_stage_history").insert({
      org_id: ctx.orgId,
      opportunity_id: opp.id,
      pipeline_id: pipeline.id,
      from_stage_id: null,
      to_stage_id: stageId,
      changed_by: ctx.userId,
    });

    await ctx.supabase.from("crm_activities").insert({
      org_id: ctx.orgId,
      opportunity_id: opp.id,
      account_id: accountId,
      contact_id: contactId,
      type: "system",
      body: "Prospect created",
      created_by: ctx.userId,
    });

    return NextResponse.json({ prospect: opp }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to create prospect";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
