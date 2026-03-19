// DEPRECATED: This route has been replaced by /api/generate-website/generate
// The new system generates all pages in a single AI call
import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "This endpoint has been replaced. Please refresh the page to use the new build system." },
    { status: 410 }
  );
}
