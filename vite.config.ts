import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  cloudflare: false,
  tanstackStart: {
    server: { entry: "server" },
  },
  vite: {
    environments: {
      ssr: {
        resolve: {
          noExternal: true,
        },
        build: {
          rollupOptions: {
            output: {
              inlineDynamicImports: true,
            },
          },
        },
      },
    },
  },
});
