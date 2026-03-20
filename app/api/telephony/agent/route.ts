import { createClient } from "@/lib/supabase/server";
import { normalizeToE164 } from "@/lib/telephony/phone";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data } = await supabase
    .from("telephony_agents")
    .select("phone_e164")
    .eq("user_id", user.id)
    .maybeSingle();

  return NextResponse.json({ phone_e164: data?.phone_e164 ?? null });
}

export async function PUT(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const raw = body.phone_e164 as string | undefined;
  if (!raw?.trim()) {
    return NextResponse.json(
      { error: "phone_e164 requis (votre mobile pour click-to-call)" },
      { status: 400 }
    );
  }

  const phone_e164 = normalizeToE164(raw.trim());

  const { error } = await supabase.from("telephony_agents").upsert(
    {
      user_id: user.id,
      phone_e164,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, phone_e164 });
}
