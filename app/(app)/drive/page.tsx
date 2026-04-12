import { DriveClient } from "./drive-client";
import { Suspense } from "react";

export default function DrivePage() {
  return (
    <Suspense fallback={<div className="py-12 text-sm text-muted-foreground">Loading Drive…</div>}>
      <DriveClient />
    </Suspense>
  );
}
