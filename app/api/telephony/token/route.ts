import { createClient } from "@/lib/supabase/server";
import { telephonyEnvReady } from "@/lib/telephony/config";
import { generateClientAccessToken } from "@/lib/telephony/twilio-server";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST() {
  if (!telephonyEnvReady()) {
    return NextResponse.json(
      { error: "Twilio n’est pas configuré (variables d’environnement)." },
      { status: 503 }
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const identity = `user_${user.id}`;
  const token = generateClientAccessToken(identity);

  return NextResponse.json({ token, identity });
}
