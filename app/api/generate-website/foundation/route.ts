// DEPRECATED: This route has been replaced by /api/generate-website/generate
// Kept as a stub to avoid 404s from old builds in progress
import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "This endpoint has been replaced. Please refresh the page to use the new build system." },
    { status: 410 }
  );
}
