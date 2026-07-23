/** Shared site constants for docs app (site.ts) and llms.txt generation. */
export const SITE = {
  name: "Lamina",
  tagline: "Design how it works.",
  subline: "Know what to build. Iterate faster.",
  description:
    "Headless product-design skill for AI coding agents. Invoke with slash commands — /lamina-init, /lamina-design, /lamina-verify — to spec how your app works into a contract your agent implements, then verify your application with parallel persona walks.",
  positioning:
    "Product-design skill for developers who build with AI — know what to build, iterate faster.",
  icp: "Developers using AI coding agents (Cursor, Claude Code, Codex, Gemini, Pi) — not designers or PMs.",
  disambiguation:
    "Lamina (lamina.dev) is an open-source product-design skill for AI coding agents — not uselamina.ai (creative API for media generation).",
  productSummary:
    "Lamina is an open-source skill licensed under Apache-2.0 that designs product behavior before your coding agent ships app source. Run slash commands explicitly — Lamina does not activate passively after install. UI skills dress the app; Lamina designs how it behaves — states, roles, flows, edge cases, and permission matrices.",
  loop: "/lamina-init → /lamina-design → implement → /lamina-verify → fix",
  commands: ["/lamina-init", "/lamina-design", "/lamina-verify", "/lamina (optional router)"],
  outcomes: [
    "Machine-readable contract (`run.json`) your agent implements from `implement.md`",
    "Parallel persona walks that surface product gaps on the live app",
    "Fix loop (`fix.md` → agent fixes → re-verify) until the contract holds",
  ],
  whatIsNot: [
    "Not a UI library — never writes app source or picks your component library",
    "Not an app builder — does not generate stack-locked apps like v0 or Lovable",
    "Not a pixel skill — Impeccable and frontend-design polish how it looks; Lamina designs how it works",
  ],
  install: "npx skills install aryaniyaps/lamina",
  license: "Apache-2.0",
  github: "https://github.com/aryaniyaps/lamina",
  domain: "https://lamina.dev",
  creator: {
    name: "Aryan Iyappan",
    url: "https://aryaniyappan.com",
    socials: [
      "https://x.com/aryaniyaps",
      "https://linkedin.com/in/aryaniyaps",
    ],
  },
};
