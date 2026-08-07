/* ESLint, flat config.
 *
 * There was no linting at all. Next 16 removed `next lint`, so this is plain
 * ESLint.
 *
 * eslint-config-next 16 exports native flat-config arrays, so they are spread
 * directly. Do NOT route these through FlatCompat: the eslintrc bridge tries to
 * JSON.stringify the config for schema validation and dies on the React
 * plugin's circular reference — "Converting circular structure to JSON", which
 * reads like a bug in your config rather than the wrong loader.
 *
 * Deliberately introduced at Next's recommended level and no stricter. A
 * codebase this size with no lint history will have many stylistic findings;
 * a strict preset would produce a wall of noise that gets ignored, and a lint
 * step everyone ignores is worse than none. Tighten once CI is green and
 * staying green.
 */
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default [
  {
    // Build output, dependencies and the static export are not authored here,
    // and linting generated bundles yields thousands of useless findings.
    ignores: [
      "node_modules/**",
      ".next/**",
      ".next-export/**",
      "out/**",
      "public/**",
      "next-env.d.ts",
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      // An unused variable usually marks an edit that was started and left
      // half-done. Underscore prefix is the conventional "deliberately unused".
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      // `any` is already widespread here. As an error this would fail the build
      // on day one for code that predates the linter, so it warns: visible in
      // CI, not a blocker.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
];
