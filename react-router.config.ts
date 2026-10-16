import type { Config } from "@react-router/dev/config";

export default {
  ssr: false,
  // Listed explicitly rather than `true`: the catch-all route has no concrete
  // path, so `true` prerenders everything *and* warns about `*` on every
  // build. `/404` is what the host serves on a miss.
  prerender: ["/", "/playground", "/admin", "/404"],
} satisfies Config;
