import { createClient, createServiceClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ listId: string }> }
) {
  const { listId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const serviceClient = await createServiceClient();

  const { data: list } = await serviceClient
    .from("lead_lists")
    .select("name")
    .eq("id", listId)
    .eq("user_id", user.id)
    .single();

  if (!list) return NextResponse.json({ error: "List not found" }, { status: 404 });

  const { data: items } = await serviceClient
    .from("lead_list_items")
    .select("status, notes, contacted_at, lead:leads(*)")
    .eq("list_id", listId)
    .order("added_at", { ascending: false });

  if (!items || items.length === 0) {
    return NextResponse.json({ error: "List is empty" }, { status: 400 });
  }

  // Build CSV
  const headers = [
    "Business Name",
    "Description",
    "Address",
    "Phone",
    "Email",
    "Owner Name",
    "Owner Phone",
    "Owner Email",
    "Owner Role",
    "LinkedIn",
    "SIREN",
    "Company Type",
    "Creation Date",
    "Revenue",
    "Employees",
    "Rating",
    "Reviews",
    "Has Website",
    "Website URL",
    "Website Quality",
    "Website Score",
    "Facebook",
    "Instagram",
    "Followers",
    "Google Maps",
    "Status",
    "Notes",
    "Contacted At",
    "Source",
  ];

  const escape = (val: unknown) => {
    if (val === null || val === undefined) return "";
    const str = String(val);
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const rows = items.map((item) => {
    const l = item.lead as unknown as Record<string, unknown>;
    return [
      l?.business_name,
      l?.description,
      l?.address,
      l?.phone,
      l?.email,
      l?.owner_name,
      l?.owner_phone,
      l?.owner_email,
      l?.owner_role,
      l?.linkedin_url,
      l?.siren,
      l?.company_type,
      l?.creation_date,
      l?.revenue_bracket,
      l?.employee_count,
      l?.rating,
      l?.review_count,
      l?.has_website ? "Yes" : "No",
      l?.website_url,
      l?.website_quality,
      l?.website_score,
      l?.facebook_url,
      l?.instagram_url,
      l?.follower_count,
      l?.google_maps_url,
      item.status,
      item.notes,
      item.contacted_at,
      l?.source,
    ]
      .map(escape)
      .join(",");
  });

  const csv = [headers.join(","), ...rows].join("\n");
  const filename = `${list.name.replace(/[^a-zA-Z0-9]/g, "_")}_leads.csv`;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
