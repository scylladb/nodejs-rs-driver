import globals from "globals";
import pluginJs from "@eslint/js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// tsc emits a .js file and a .d.ts file next to each .ts source file in lib/.
// Do not lint these outputs. Other .js and .d.ts files in lib/ are source files.
const tscOutputs = fs
  .readdirSync(path.join(__dirname, "lib"), { recursive: true })
  .filter((file) => file.endsWith(".ts") && !file.endsWith(".d.ts"))
  .flatMap((file) => {
    // Example: "auth/provider.ts" gives "lib/auth/provider.js" and "lib/auth/provider.d.ts".
    // readdirSync gives the path relative to lib/, with the separator of the OS.
    // An ESLint pattern uses "/", and it is relative to this config file.
    const tsFile = "lib/" + file.replaceAll(path.sep, "/");
    const withoutExtension = tsFile.slice(0, -".ts".length);
    return [`${withoutExtension}.js`, `${withoutExtension}.d.ts`];
  });

/** @type {import('eslint').Linter.Config[]} */
export default [
  { ignores: tscOutputs },
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
