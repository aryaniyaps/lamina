import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "public/_pagefind/**",
    "next-env.d.ts",
  ]),
  {
    files: ["content/**/_meta.js"],
    rules: {
      "import/no-anonymous-default-export": "off",
    },
  },
]);

export default eslintConfig;
