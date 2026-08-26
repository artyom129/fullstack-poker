import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  {
    files: ["components/poker-app.tsx"],
    rules: { "react-hooks/set-state-in-effect": "off" },
  },
  {
    files: ["postcss.config.mjs"],
    rules: { "import/no-anonymous-default-export": "off" },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);
