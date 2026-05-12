// @ts-expect-error - resolved at build time, included via vercel.json includeFiles
import server from "../dist/server/server.js";

export default async function handler(request: Request): Promise<Response> {
  try {
    return await server.fetch(request, {}, {});
  } catch (error) {
    console.error("[ssr-fn] failed:", error);
    return new Response(
      `SSR error: ${error instanceof Error ? error.stack ?? error.message : String(error)}`,
      { status: 500, headers: { "content-type": "text/plain" } },
    );
  }
}
