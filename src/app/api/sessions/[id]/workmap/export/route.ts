import { workMapToMarkdown } from "@/lib/map/export";
import { workMaps } from "@/lib/store";

// GET: the Work Map as agent-loadable instructions in Markdown.
// ?download=1 sends it as a file.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const map = await workMaps.get(id);
  if (!map) return Response.json({ error: "No Work Map for this session yet" }, { status: 404 });
  const download = new URL(req.url).searchParams.get("download");
  return new Response(workMapToMarkdown(map), {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      ...(download ? { "content-disposition": `attachment; filename="workmap-${id}.md"` } : {}),
    },
  });
}
