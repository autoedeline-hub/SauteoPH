import { execSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const outputDir = path.join(root, ".vercel", "output");
const staticDir = path.join(outputDir, "static");
const funcDir = path.join(outputDir, "functions", "index.func");

console.log("→ cleaning .vercel/output");
rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });

console.log("→ running vite build");
execSync("npm run build", { stdio: "inherit", cwd: root, shell: true });

console.log("→ copying static assets");
mkdirSync(staticDir, { recursive: true });
cpSync(path.join(root, "dist", "client"), staticDir, { recursive: true });

console.log("→ assembling serverless function");
mkdirSync(funcDir, { recursive: true });
cpSync(path.join(root, "dist", "server"), funcDir, { recursive: true });

writeFileSync(
  path.join(funcDir, "index.mjs"),
  `import { Readable } from "node:stream";
import server from "./server.js";

export default async function handler(req, res) {
  try {
    const protocol = req.headers["x-forwarded-proto"] || "https";
    const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost";
    const url = protocol + "://" + host + req.url;

    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (Array.isArray(value)) {
        for (const v of value) headers.append(key, v);
      } else if (typeof value === "string") {
        headers.set(key, value);
      }
    }

    const hasBody = req.method !== "GET" && req.method !== "HEAD";
    const init = {
      method: req.method,
      headers,
    };
    if (hasBody) {
      init.body = Readable.toWeb(req);
      init.duplex = "half";
    }

    const response = await server.fetch(new Request(url, init), {}, {});

    res.statusCode = response.status;
    response.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });

    if (!response.body) {
      res.end();
      return;
    }

    const reader = response.body.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) res.write(value);
    }
    res.end();
  } catch (error) {
    console.error("[ssr] failed:", error);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("content-type", "text/plain; charset=utf-8");
    }
    const detail = error && typeof error === "object" && "stack" in error ? error.stack : String(error);
    res.end("SSR error: " + detail);
  }
}
`,
);

writeFileSync(
  path.join(funcDir, "package.json"),
  JSON.stringify({ type: "module" }, null, 2),
);

writeFileSync(
  path.join(funcDir, ".vc-config.json"),
  JSON.stringify(
    {
      runtime: "nodejs22.x",
      handler: "index.mjs",
      launcherType: "Nodejs",
      shouldAddHelpers: false,
      supportsResponseStreaming: true,
    },
    null,
    2,
  ),
);

writeFileSync(
  path.join(outputDir, "config.json"),
  JSON.stringify(
    {
      version: 3,
      routes: [
        { handle: "filesystem" },
        { src: "/.*", dest: "/index" },
      ],
    },
    null,
    2,
  ),
);

console.log("✓ .vercel/output ready");
