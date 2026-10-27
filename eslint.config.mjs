import globals from "globals";
import pluginJs from "@eslint/js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const libFiles = fs.readdirSync(path.join(__dirname, "lib"), { recursive: true });

// The .gitignore files in lib/ list the outputs of tsc. They also list the outputs of
// removed .ts files. An old build can leave such outputs on disk. Do not lint them.
// Each .gitignore file has only plain file names, with no "/", "!" or glob. A name is
// relative to the directory of its .gitignore file. Thus, add this directory to it.
// Example: "index.js" in lib/auth/.gitignore gives "lib/auth/index.js", not "**/index.js".
const gitignoredFiles = libFiles
  .filter((file) => path.basename(file) === ".gitignore")
  .flatMap((file) => {
    const directory = path.posix.join("lib", path.dirname(file).replaceAll(path.sep, "/"));
    return fs
      .readFileSync(path.join(__dirname, "lib", file), "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("#"))
      .map((name) => `${directory}/${name}`);
  });

// tsc emits a .js file and a .d.ts file next to each .ts source file in lib/.
// Do not lint these outputs. Other .js and .d.ts files in lib/ are source files.
// This list also has the outputs of a new .ts file that no .gitignore file lists yet.
const tscOutputs = libFiles
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
// - Variables whose names start with "_" are ignored. This does not apply to caught errors
const unusedVarsOptions = { "args": "none", "caughtErrors": "all", "varsIgnorePattern": "^_" };

/** @type {import('eslint').Linter.Config[]} */
export default [
  { ignores: [...gitignoredFiles, ...tscOutputs] },
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
];
