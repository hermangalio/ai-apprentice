import { finalizeWorkMap } from "@/lib/map/build";
import { isReadOnly } from "@/lib/map/patch";
import { workMaps } from "@/lib/store";

const fail = (status: number, error: string) => Response.json({ error }, { status });

const finalizing = ((globalThis as Record<string, unknown>).__workMapFinalizes ??= new Map()) as Map<string, Promise<unknown>>;

// POST: merge the debrief transcript into the map. Status becomes "confirmed"
// only if the teach-back was confirmed and no gap is open.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (await isReadOnly(id)) return fail(409, "Fixture sessions are read-only");
  if (!(await workMaps.get(id))) return fail(404, "No Work Map for this session yet. Build the draft first.");
  try {
    let run = finalizing.get(id);
    if (!run) {
      run = finalizeWorkMap(id).finally(() => finalizing.delete(id));
      finalizing.set(id, run);
    }
    return Response.json(await run);
  } catch (err) {
    return fail(500, (err as Error).message);
  }
}
