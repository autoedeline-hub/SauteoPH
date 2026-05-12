// @ts-expect-error - resolved from dist/ at runtime via includeFiles
import server from "../dist/server/server.js";

export default async function handler(request: Request): Promise<Response> {
  return server.fetch(request, {}, {});
}
