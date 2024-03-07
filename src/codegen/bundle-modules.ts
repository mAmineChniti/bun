// This script is run when you change anything in src/js/*
import fs from "node:fs";
import { writeFile, mkdir } from "node:fs/promises";
import { builtinModules } from "node:module";
import path from "node:path";
import { sliceSourceCode } from "./builtin-parser";
import {
  declareASCIILiteral,
  idToEnumName,
  idToPublicSpecifierOrEnumName,
  matchAllNonIdentCharsRegExp,
  replaceScriptExtWithDotJS,
  trimScriptExt,
  writeIfChanged,
} from "./helpers";
import { createAssertClientJS, createLogClientJS } from "./client-js";
import { define } from "./replacements";
import { createInternalModuleRegistry } from "./internal-module-registry-scanner";

const EOL = "\n";
const BASE = path.join(import.meta.dir, "../js");
const debug = process.argv[2] === "--debug=ON";
const CMAKE_BUILD_ROOT = process.argv[3];

if (!CMAKE_BUILD_ROOT) {
  console.error("Usage: bun bundle-modules.ts <CMAKE_WORK_DIR>");
  process.exit(1);
}

const TMP_DIR = path.join(CMAKE_BUILD_ROOT, "tmp_modules");
const CODEGEN_DIR = path.join(CMAKE_BUILD_ROOT, "codegen");
const JS_DIR = path.join(CMAKE_BUILD_ROOT, "js");

const t = new Bun.Transpiler({ loader: "tsx" });

let start = performance.now();
function mark(log: string) {
  const now = performance.now();
  console.log(`${log} (${(now - start).toFixed(0)}ms)`);
  start = now;
}

const {
  //
  moduleList,
  nativeModuleIds,
  nativeModuleEnumToId,
  nativeModuleEnums,
  requireTransformer,
} = createInternalModuleRegistry(BASE);

// these logs surround a very weird issue where writing files and then bundling sometimes doesn't
// work, so i have lot of debug logs that blow up the console because not sure what is going on.
// that is also the reason for using `retry` when theoretically writing a file the first time
// should actually write the file.
const verbose = Bun.env.VERBOSE ? console.log : () => {};
async function retry(n, fn) {
  var err;
  while (n > 0) {
    try {
      await fn();
      return;
    } catch (e) {
      err = e;
      n--;
      await Bun.sleep(5);
    }
  }
  throw err;
}

// Preprocess builtins
const bundledEntryPoints: string[] = [];
for (let i = 0, { length } = moduleList; i < length; i += 1) {
  try {
    const input = fs.readFileSync(path.join(BASE, moduleList[i]), "utf8");
    const scannedImports = t.scanImports(input);
    for (const imp of scannedImports) {
      if (imp.kind === "import-statement") {
        var isBuiltin = true;
        try {
          if (!builtinModules.includes(imp.path)) {
            requireTransformer(imp.path, moduleList[i]);
          }
        } catch {
          isBuiltin = false;
        }
        if (isBuiltin) {
          throw new Error(`Cannot use ESM import on builtin modules. Use require("${imp.path}") instead.`);
        }
      }
    }

    const importStatements: string[] = [];
    const processed = sliceSourceCode(
      "{" +
        input
          .replace(
            /\bimport(\s*type)?\s*(\{[^}]*\}|(\*\s*as)?\s[$\w]+)\s*from\s*['"][^'"]+['"]/g,
            stmt => (importStatements.push(stmt), ""),
          )
          .replace(/export\s*\{\s*\}\s*;/g, ""),
      true,
      x => requireTransformer(x, moduleList[i]),
    );
    let fileToTranspile = `// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from src/js/${moduleList[i]}
${importStatements.join(EOL)}

${processed.result.slice(1).trim()}
$$EXPORT$$(__intrinsic__exports).$$EXPORT_END$$;
`;

    // Attempt to optimize "$exports = ..." to a variableless return
    // otherwise, declare $exports so it works.
    const { length: oldLength } = fileToTranspile;
    fileToTranspile = fileToTranspile.replace(
      /__intrinsic__exports\s*=\s*([^\r\n;]+?|.*\{[^\}]*\}|.*\([^\)]*\))(?:\r?\n)+\s*\$\$EXPORT\$\$\(__intrinsic__exports\)/,
      "$$EXPORT$$($1)",
    );
    if (oldLength === fileToTranspile.length) {
      fileToTranspile = `var $;${fileToTranspile.replaceAll("__intrinsic__exports", "$")}`;
    }
    const outputPath = path.join(TMP_DIR, moduleList[i].slice(0, -3) + ".ts");
    await mkdir(path.dirname(outputPath), { recursive: true });
    if (!fs.existsSync(path.dirname(outputPath))) {
      verbose("directory did not exist after mkdir twice:", path.dirname(outputPath));
    }
    try {
      await writeFile(outputPath, fileToTranspile);
      if (!fs.existsSync(outputPath)) {
        verbose("file did not exist after write:", outputPath);
        throw new Error("file did not exist after write: " + outputPath);
      }
      verbose("wrote to", outputPath, "successfully");
    } catch {
      await retry(3, async () => {
        await mkdir(path.dirname(outputPath), { recursive: true });
        await writeFile(outputPath, fileToTranspile);
        if (!fs.existsSync(outputPath)) {
          verbose("file did not exist after write:", outputPath);
          throw new Error(`file did not exist after write: ${outputPath}`);
        }
        verbose("wrote to", outputPath, "successfully later");
      });
    }
    bundledEntryPoints.push(outputPath);
  } catch (error) {
    console.error(error);
    console.error(`While processing: ${moduleList[i]}`);
    process.exit(1);
  }
}

mark("Preprocess modules");

await Bun.sleep(10);

// directory caching stuff breaks this sometimes. CLI rules
const config_cli = [
  process.execPath,
  "build",
  ...bundledEntryPoints,
  ...(debug ? [] : ["--minify-syntax"]),
  "--root",
  TMP_DIR,
  "--target",
  "bun",
  ...builtinModules.map(x => ["--external", x]).flat(),
  ...Object.keys(define)
    .map(x => [`--define`, `${x}=${define[x]}`])
    .flat(),
  "--define",
  `IS_BUN_DEVELOPMENT=${String(!!debug)}`,
  "--define",
  `__intrinsic__debug=${debug ? "$debug_log_enabled" : "false"}`,
  "--outdir",
  path.join(TMP_DIR, "modules_out"),
];
verbose("running: ", config_cli);
const out = Bun.spawnSync({
  cmd: config_cli,
  cwd: process.cwd(),
  env: process.env,
  stdio: ["pipe", "pipe", "pipe"],
});
if (out.exitCode !== 0) {
  console.error(out.stderr.toString());
  process.exit(out.exitCode);
}

// const config = ({ debug }: { debug?: boolean }) =>
//   ({
//     entrypoints: bundledEntryPoints,
//     // Whitespace and identifiers are not minified to give better error messages when an error happens in our builtins
//     minify: { syntax: !debug, whitespace: false },
//     root: TMP_DIR,
//     target: "bun",
//     external: builtinModules,
//     define: {
//       ...define,
//       IS_BUN_DEVELOPMENT: String(!!debug),
//       __intrinsic__debug: debug ? "$debug_log_enabled" : "false",
//     },
//   } satisfies BuildConfig);

mark("Bundle modules");

const outputs = new Map();

for (const entrypoint of bundledEntryPoints) {
  const file_path = entrypoint.slice(TMP_DIR.length + 1).replace(/\.ts$/, ".js");
  const file = Bun.file(path.join(TMP_DIR, "modules_out", file_path));
  const output = await file.text();
  let captured = `(function (){${output.replace(`// @bun${EOL}`, "").trim()}})`;
  const usesDebug = output.includes("$debug_log");
  const usesAssert = output.includes("$assert");
  captured =
    captured
      .replace(/var\s+__require\s*=\s*\(?id\)?\s*=>\s*\{\s*return\s*import\.meta\.require\(id\);?\s*};?/, "")
      .replace(/var\s+__require\s*=\s*\(?id\)?\s*=>\s*import\.meta\.require\(id\);?/, "")
      .replace(/\$\$EXPORT\$\$\((.*)\)\.\$\$EXPORT_END\$\$;/, "return $1")
      .replace(/]\s*,\s*__(?:assert|debug)_end__\)/g, ")")
      // .replace(/__intrinsic__lazy\(/g, "globalThis[globalThis.Symbol.for('Bun.lazy')](")
      .replace(/\bimport\.meta\.require\(([^)]+)\)/g, (expr, specifier) => {
        throw new Error(`Builtin Bundler: do not use import.meta.require() (in ${file_path}))`);
      })
      .replaceAll("__intrinsic__", "@")
      .replaceAll("__no_intrinsic__", "") + EOL;
  captured = captured.replace(
    /function\s*\([^)]*\)\s*\{/,
    '$&"use strict";' +
      (usesDebug
        ? createLogClientJS(
            file_path.replace(".js", ""),
            idToPublicSpecifierOrEnumName(file_path).replace(/^(?:bun|node):/, ""),
          )
        : "") +
      (usesAssert ? createAssertClientJS(idToPublicSpecifierOrEnumName(file_path).replace(/^(?:bun|node):/, "")) : ""),
  );
  const outputPath = path.join(JS_DIR, file_path);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, captured);
  outputs.set(file_path.replace(".js", ""), captured);
}

mark("Postprocesss modules");

// This is a file with a single macro that is used in defining InternalModuleRegistry.h
writeIfChanged(
  path.join(CODEGEN_DIR, "InternalModuleRegistry+numberOfModules.h"),
  `#define BUN_INTERNAL_MODULE_COUNT ${moduleList.length}${EOL}`,
);

// This code slice is used in InternalModuleRegistry.h for inlining the enum.
writeIfChanged(
  path.join(CODEGEN_DIR, "InternalModuleRegistry+enum.h"),
  `${moduleList.map((id, n) => `${idToEnumName(id)} = ${n},`).join(EOL)}${EOL}`,
);

// This code slice is used in InternalModuleRegistry.cpp. It defines the loading function for modules.
writeIfChanged(
  path.join(CODEGEN_DIR, "InternalModuleRegistry+createInternalModuleById.h"),
  `// clang-format off
JSValue InternalModuleRegistry::createInternalModuleById(JSGlobalObject* globalObject, VM& vm, Field id)
{
  switch (id) {
    // JS internal modules
    ${moduleList
      .map(id => {
        return `case Field::${idToEnumName(id)}: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "${idToPublicSpecifierOrEnumName(id)}"_s, ${JSON.stringify(
        replaceScriptExtWithDotJS(id),
      )}_s, InternalModuleRegistryConstants::${idToEnumName(id)}Code, "builtin://${trimScriptExt(id).replace(
        matchAllNonIdentCharsRegExp,
        "/",
      )}"_s);
    }`;
      })
      .join(`${EOL}    `)}
    default: {
      __builtin_unreachable();
    }
  }
}
`,
);

// This header is used by InternalModuleRegistry.cpp, and should only be included in that file.
// It inlines all the strings for the module IDs.
//
// We cannot use ASCIILiteral's `_s` operator for the module source code because for long
// strings it fails a constexpr assert. Instead, we do that assert in JS before we format the string
if (!debug) {
  writeIfChanged(
    path.join(CODEGEN_DIR, "InternalModuleRegistryConstants.h"),
    `// clang-format off
#pragma once

namespace Bun {
namespace InternalModuleRegistryConstants {
  ${moduleList
    .map((id, n) => {
      const out = outputs.get(id.slice(0, -3).replaceAll("/", path.sep));
      if (!out) {
        throw new Error(`Missing output for ${id}`);
      }
      return declareASCIILiteral(`${idToEnumName(id)}Code`, out);
    })
    .join(EOL)}
}
}`,
  );
} else {
  // In debug builds, we write empty strings to prevent recompilation. These are loaded from disk instead.
  writeIfChanged(
    path.join(CODEGEN_DIR, "InternalModuleRegistryConstants.h"),
    `// clang-format off
#pragma once

namespace Bun {
namespace InternalModuleRegistryConstants {
  ${moduleList.map(id => `${declareASCIILiteral(`${idToEnumName(id)}Code`, "")}`).join(EOL)}
}
}`,
  );
}

// This is a generated enum for zig code (exports.zig)
writeIfChanged(
  path.join(CODEGEN_DIR, "ResolvedSourceTag.zig"),
  `// zig fmt: off
pub const ResolvedSourceTag = enum(u32) {
    // Predefined
    javascript = 0,
    package_json_type_module = 1,
    wasm = 2,
    object = 3,
    file = 4,
    esm = 5,
    json_for_object_loader = 6,

    // Built in modules are loaded through InternalModuleRegistry by numerical ID.
    // In this enum are represented as \`(1 << 9) & id\`
${moduleList.map((id, n) => `    @"${idToPublicSpecifierOrEnumName(id)}" = ${(1 << 9) | n},`).join(EOL)}
    // Native modules run through a different system using ESM registry.
${Object.entries(nativeModuleIds)
  .map(([id, n]) => `    @"${id}" = ${(1 << 10) | n},`)
  .join(EOL)}
};
`,
);

// This is a generated enum for c++ code (headers-handwritten.h)
writeIfChanged(
  path.join(CODEGEN_DIR, "SyntheticModuleType.h"),
  `enum SyntheticModuleType : uint32_t {
    JavaScript = 0,
    PackageJSONTypeModule = 1,
    Wasm = 2,
    ObjectModule = 3,
    File = 4,
    ESM = 5,
    JSONForObjectLoader = 6,

    // Built in modules are loaded through InternalModuleRegistry by numerical ID.
    // In this enum are represented as \`(1 << 9) & id\`
    InternalModuleRegistryFlag = 1 << 9,
${moduleList.map((id, n) => `    ${idToEnumName(id)} = ${(1 << 9) | n},`).join(EOL)}
    
    // Native modules run through the same system, but with different underlying initializers.
    // They also have bit 10 set to differentiate them from JS builtins.
    NativeModuleFlag = (1 << 10) | (1 << 9),
${Object.entries(nativeModuleEnumToId)
  .map(([id, n]) => `    ${id} = ${(1 << 10) | n},`)
  .join(EOL)}
};

`,
);

// This is used in ModuleLoader.cpp to link to all the headers for native modules.
writeIfChanged(
  path.join(CODEGEN_DIR, "NativeModuleImpl.h"),
  `${Object.values(nativeModuleEnums)
    .map(value => `#include "../../bun.js/modules/${value}Module.h"`)
    .join(EOL)}${EOL}`,
);

// This is used for debug builds for the base path for dynamic loading
// fs.writeFileSync(
//   path.join(OUT_DIR, "DebugPath.h"),
//   `// Using __FILE__ does not give an absolute file path
// // This is a workaround for that.
// #define BUN_DYNAMIC_JS_LOAD_PATH "${path.join(OUT_DIR, "")}"
// `,
// );

mark("Generate Code");
