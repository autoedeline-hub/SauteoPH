// @ts-expect-error - resolved at build time, included via vercel.json includeFiles
import server from "../dist/server/server.js";

export default async function handler(request: Request): Promise<Response> {
  try {
    const ssrResponse = await server.fetch(request, {}, {});
    const buffer = await ssrResponse.arrayBuffer();
    return new Response(buffer, {
      status: ssrResponse.status,
      headers: ssrResponse.headers,
    });
  } catch (error) {
    console.error("[ssr-fn] failed:", error);
    return new Response(
      `SSR error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
      { status: 500, headers: { "content-type": "text/plain" } },
    );
  }
}
