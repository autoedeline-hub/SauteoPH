import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig(({ command }) => ({
  cloudflare: false,
  tanstackStart: {
    server: { entry: "server" },
  },
  vite: {
    // Legacy ssr.noExternal works alongside the environments API and is
    // what TanStack Start's plugin actually honors in production builds.
    // Without this, packages like h3-v2, @tanstack/*, react, etc. ship as
    // bare-specifier imports — fine locally where node_modules exists,
    // but breaks the Vercel function which only includes dist/server.
    ssr: {
      noExternal: command === "build" ? true : undefined,
    },
    build: {
      rollupOptions: {
        output: {
          inlineDynamicImports: true,
        },
      },
    },
  },
}));
