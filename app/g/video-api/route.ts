import { videoApi } from "../../../server/video-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: Request) { return videoApi(request, true); }
export function POST(request: Request) { return videoApi(request, true); }
