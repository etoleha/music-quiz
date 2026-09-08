import { videoMedia } from "../../../../server/video-http";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) { return videoMedia(request, (await context.params).id, true); }
export const HEAD = GET;
