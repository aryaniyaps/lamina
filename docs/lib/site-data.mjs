/** Shared site constants for docs app (site.ts) and llms.txt generation. */
export const SITE = {
  name: "Lamina",
  tagline: "Design how it works.",
  subline: "Know what to build. Iterate faster.",
  description:
    "Transactional product graph for AI coding agents: initialize product knowledge, publish atomic workflow designs, implement from a GraphVersion, and verify through independent Persona Missions.",
  positioning:
    "Transactional product graph that gives AI coding agents product-design and verification capabilities.",
  icp: "Developers using AI coding agents (Cursor, Claude Code, Codex, Gemini, Pi) — not designers or PMs.",
  disambiguation:
    "Lamina (lamina.dev) is an open-source transactional product graph for AI coding agents — not uselamina.ai (creative API for media generation).",
  productSummary:
    "Lamina is an Apache-2.0 transactional product graph. Ladybug stores canonical Resources, Statements, versions, sessions, and Runs; CocoIndex incrementally supplies explicit source Observations through graphd.",
  loop: "/lamina-init → /lamina-design → implement → /lamina-verify → fix",
  commands: ["/lamina-init", "/lamina-design", "/lamina-verify", "/lamina (optional router)"],
  outcomes: [
    "Atomic, versioned product behavior with semantic branch diffs",
    "Independent Missions for every relevant Persona",
    "Epistemically separated intent, observations, simulation, and runtime evidence",
  ],
  whatIsNot: [
    "Not a UI library — never writes app source or picks your component library",
    "Not an app builder — does not generate stack-locked apps like v0 or Lovable",
    "Not a pixel skill — Impeccable and frontend-design polish how it looks; Lamina designs how it works",
  ],
  install: "npm install -g @laminadev/cli@latest && npx skills add aryaniyaps/lamina --all -y",
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
