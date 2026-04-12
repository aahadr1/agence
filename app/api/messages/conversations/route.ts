import { ensureAgencyOrgContext } from "@/lib/org/ensure-agency-context";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const ctx = await ensureAgencyOrgContext(user.id);
    if (!ctx.ok) {
      return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    }

    const admin = ctx.admin;

    const { data: memberships, error: memError } = await admin
      .from("conversation_members")
      .select("conversation_id")
      .eq("user_id", user.id);

    if (memError) {
      console.error("[conversations GET] conversation_members", memError);
      return NextResponse.json(
        { error: memError.message },
        { status: 500 }
      );
    }

    const convIds = [
      ...new Set((memberships || []).map((m) => m.conversation_id)),
    ];

    if (convIds.length === 0) {
      return NextResponse.json({ conversations: [] });
    }

    const { data: convRows, error: convError } = await admin
      .from("conversations")
      .select("id, type, title, slug, updated_at")
      .in("id", convIds);

    if (convError) {
      console.error("[conversations GET] conversations", convError);
      return NextResponse.json(
        { error: convError.message },
        { status: 500 }
      );
    }

    const rows =
      (convRows || []).map((row) => ({
        id: row.id as string,
        type: row.type as string,
        title: (row.title as string | null) ?? null,
        slug: (row.slug as string | null) ?? null,
        updated_at: String(row.updated_at ?? ""),
      }));

    rows.sort((a, b) => {
      const ta = a.updated_at ? new Date(a.updated_at).getTime() : 0;
      const tb = b.updated_at ? new Date(b.updated_at).getTime() : 0;
      return tb - ta;
    });

    // Batch DM peer lookup to avoid N+1 queries per conversation.
    const dmIds = rows.filter((r) => r.type === "dm").map((r) => r.id);
    const peerByConversation: Record<string, string> = {};
    if (dmIds.length > 0) {
      const { data: peerMembers, error: peerErr } = await admin
        .from("conversation_members")
        .select("conversation_id, user_id")
        .in("conversation_id", dmIds)
        .neq("user_id", user.id);

      if (peerErr) {
        console.error("[conversations GET] peerMembers", peerErr);
        return NextResponse.json(
          { error: peerErr.message },
          { status: 500 }
        );
      }

      for (const r of peerMembers || []) {
        if (r.user_id) peerByConversation[String(r.conversation_id)] = r.user_id;
      }
    }

    const peerIds = [...new Set(Object.values(peerByConversation))];
    const profileByUser: Record<string, string | null> = {};
    if (peerIds.length > 0) {
      const { data: profRows, error: profErr } = await admin
        .from("profiles")
        .select("user_id, display_name")
        .in("user_id", peerIds);

      if (profErr) {
        console.error("[conversations GET] profiles", profErr);
        return NextResponse.json(
          { error: profErr.message },
          { status: 500 }
        );
      }

      for (const p of profRows || []) {
        profileByUser[String(p.user_id)] = (p.display_name ?? null) as string | null;
      }
    }

    const enriched = rows.map((row) => {
      if (row.type !== "dm") {
        return {
          ...row,
          dmLabel: null as string | null,
          peerUserId: null as string | null,
        };
      }

      const peerUserId = peerByConversation[row.id] ?? null;
      const displayName = peerUserId ? profileByUser[peerUserId] : null;

      return {
        ...row,
        dmLabel: displayName?.trim() || "Message direct",
        peerUserId,
      };
    });

    return NextResponse.json({ conversations: enriched });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unexpected error";
    console.error("[conversations GET] unhandled", e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ctx = await ensureAgencyOrgContext(user.id);
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  // Use service role for writes to avoid RLS chicken-and-egg.
  const admin = ctx.admin;
  const orgId = ctx.orgId;

  let body: {
    type?: string;
    title?: string;
    slug?: string;
    peerUserId?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { type, title, slug, peerUserId } = body as {
    type: "channel" | "group" | "dm";
    title?: string;
    slug?: string;
    peerUserId?: string;
  };

  if (type === "dm" && peerUserId) {
    if (peerUserId === user.id) {
      return NextResponse.json(
        { error: "Cannot create a DM with yourself" },
        { status: 400 }
      );
    }

    const { data: peerMem } = await admin
      .from("organization_members")
      .select("user_id")
      .eq("org_id", orgId)
      .eq("user_id", peerUserId)
      .maybeSingle();

    if (!peerMem) {
      return NextResponse.json(
        { error: "Peer is not in the agency" },
        { status: 403 }
      );
    }

    // Try to reuse an existing DM where both are members.
    const { data: myConvMembers } = await admin
      .from("conversation_members")
      .select("conversation_id")
      .eq("user_id", user.id);
    const { data: peerConvMembers } = await admin
      .from("conversation_members")
      .select("conversation_id")
      .eq("user_id", peerUserId);

    const myIds = new Set((myConvMembers || []).map((m) => m.conversation_id));
    const commonIds = (peerConvMembers || [])
      .map((m) => m.conversation_id)
      .filter((id) => myIds.has(id));

    if (commonIds.length > 0) {
      const { data: existingDm } = await admin
        .from("conversations")
        .select("id")
        .eq("type", "dm")
        .in("id", commonIds)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingDm?.id) {
        return NextResponse.json({
          conversationId: existingDm.id,
          existing: true,
        });
      }
    }

    const { data: conv, error } = await admin
      .from("conversations")
      .insert({
        org_id: orgId,
        type: "dm",
        title: null,
        created_by: user.id,
      })
      .select()
      .single();

    if (error || !conv) {
      return NextResponse.json(
        { error: error?.message || "Failed to create DM" },
        { status: 500 }
      );
    }

    // Trigger inserts the creator membership (role=owner); we only add the peer.
    const { error: peerInsertErr } = await admin
      .from("conversation_members")
      .upsert(
        {
          conversation_id: conv.id,
          user_id: peerUserId,
          role: "member",
        },
        { onConflict: "conversation_id,user_id" }
      );

    if (peerInsertErr) {
      return NextResponse.json(
        { error: peerInsertErr.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ conversationId: conv.id });
  }

  if (type === "channel" && slug) {
    const cleanSlug = slug
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");

    if (!cleanSlug || cleanSlug.length < 2) {
      return NextResponse.json(
        { error: "Invalid channel slug" },
        { status: 400 }
      );
    }

    const { data: conv, error } = await admin
      .from("conversations")
      .insert({
        org_id: orgId,
        type: "channel",
        title: title || cleanSlug,
        slug: cleanSlug,
        created_by: user.id,
      })
      .select()
      .single();

    if (error || !conv) {
      const code = (error as { code?: string } | null)?.code;
      if (code === "23505") {
        const { data: existing } = await admin
          .from("conversations")
          .select("id")
          .eq("org_id", orgId)
          .eq("type", "channel")
          .eq("slug", cleanSlug)
          .maybeSingle();
        if (existing?.id) {
          return NextResponse.json({ conversationId: existing.id, existing: true });
        }
      }

      return NextResponse.json(
        { error: error?.message || "Failed to create channel" },
        { status: 500 }
      );
    }

    return NextResponse.json({ conversationId: conv.id });
  }

  return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
}
