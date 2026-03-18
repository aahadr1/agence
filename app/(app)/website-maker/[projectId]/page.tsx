import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .single();

  if (!project) {
    redirect("/website-maker");
  }

  switch (project.status) {
    case "info_gathering":
      redirect(`/website-maker/${projectId}`);
    case "ideation":
      redirect(`/website-maker/${projectId}/ideation`);
    case "selection":
    case "completed":
      redirect(`/website-maker/${projectId}/selection`);
    default:
      redirect("/website-maker");
  }
}
