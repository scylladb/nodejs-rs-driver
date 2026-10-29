import globals from "globals";
import pluginJs from "@eslint/js";
import fs from "fs";
import path from "path";
import tseslint from "typescript-eslint";
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

// Options for no-unused-vars, and for the TS version of the rule:
// - If a value is passed to a function but not used the error is ignored
// - Unused caught errors are reported. Use "catch {" when the error is not needed
// - Values starting with "_" are also ignored
const unusedVarsOptions = { "args": "none", "caughtErrors": "all", "varsIgnorePattern": "^_" };

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
      "no-unused-vars": ["error", unusedVarsOptions],

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
  // The blocks above have no "files" key. Thus, they apply to the .ts files too,
  // because the block below matches them.
  // This preset turns off the core rules that tsc already checks, for example
  // no-undef and no-redeclare. It also turns on prefer-const and prefer-spread.
  tseslint.configs.eslintRecommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      sourceType: "module",
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
    },
    rules: {
      // The core rule does not know about TS types. Use the TS version, with the same options.
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["error", unusedVarsOptions],

      // Check the order of the members in each import, but not the order of the imports
      "sort-imports": ["error", { "ignoreDeclarationSort": true }],

      // The preset turns this rule on. Keep it off, as for the JS files.
      "prefer-rest-params": "off",
    }
  },
];
