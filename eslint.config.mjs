import globals from "globals";
import pluginJs from "@eslint/js";
import { includeIgnoreFile } from "@eslint/compat";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('eslint').Linter.Config[]} */
export default [
  // Ignore JS files emitted in-place by tsc (listed in per-directory .gitignore files)
  includeIgnoreFile(path.join(__dirname, "lib", ".gitignore")),
  includeIgnoreFile(path.join(__dirname, "lib", "types", ".gitignore")),
  pluginJs.configs.recommended,
  {
    languageOptions: {
      sourceType: "commonjs",
      globals: {
        ...globals.mocha,
        ...globals.node,
        expect: "readonly",
        assert: "readonly",
      },
    },
    rules: {
      // Check if there is no unused variables
      // If a value is passed to a function but not used the error is ignored
      // Catched but unused errors are also ignored
      // Values starting with "_" are also ignored
      "no-unused-vars": ["error", { "args": "none", "caughtErrors": "none", "varsIgnorePattern": "^_" }],

      // Checks if var is not used
      "no-var": "error",

      //Check if there is a space at the beginning of a comment
      "spaced-comment": "error",

      // Check if variable names are in camelCase
      // Disabled in some of the tests because they are inserting values into the database
      "camelcase": "error",

      "no-constructor-return": "error",
      "no-duplicate-imports": "error",
      "default-case-last": "error",
      "no-eval": "error",
      "no-multi-str": "error",
      "no-throw-literal": "error",
      "sort-imports": "error",
      "no-lonely-if": "error",
      "no-else-return": "error",
      "no-useless-assignment": "error",
    }
  },
];
