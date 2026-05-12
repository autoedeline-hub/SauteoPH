import path from "node:path";
import { pathToFileURL } from "node:url";

const SERVER_URL = pathToFileURL(
  path.join(process.cwd(), "dist", "server", "server.js"),
).href;

type ServerModule = {
  default: { fetch: (req: Request, env: unknown, ctx: unknown) => Promise<Response> | Response };
};

let serverPromise: Promise<ServerModule> | undefined;
function loadServer(): Promise<ServerModule> {
  if (!serverPromise) {
    serverPromise = import(/* @vite-ignore */ SERVER_URL) as Promise<ServerModule>;
  }
  return serverPromise;
}

export default async function handler(request: Request): Promise<Response> {
  try {
    const { default: server } = await loadServer();
    return await server.fetch(request, {}, {});
  } catch (error) {
    console.error("[vercel-fn] failed:", error);
    return new Response(
      `Function error: ${error instanceof Error ? error.message : String(error)}`,
      { status: 500, headers: { "content-type": "text/plain" } },
    );
  }
}
