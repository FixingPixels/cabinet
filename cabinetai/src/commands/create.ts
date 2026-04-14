import type { Command } from "commander";
import fs from "fs";
import path from "path";
import { log, success, error } from "../lib/log.js";
import { slugify, findCabinetRoot, ensureDir, CABINET_MANIFEST } from "../lib/paths.js";
import { writeCabinetManifest, type CabinetManifest } from "../lib/cabinet-manifest.js";

export function registerCreate(program: Command): void {
  program
    .command("create [name]")
    .description("Create a new cabinet directory")
    .action((name?: string) => {
      const cabinetName = name?.trim();
      if (!cabinetName) {
        error("Please provide a cabinet name. Usage: npx cabinetai create <name>");
        return;
      }
      createCabinet(cabinetName);
    });
}

function createCabinet(name: string): void {
  const slug = slugify(name);
  if (!slug) {
    error(`Invalid cabinet name: "${name}"`);
  }

  const targetDir = path.resolve(process.cwd(), slug);

  if (fs.existsSync(targetDir)) {
    error(`Directory "${slug}" already exists.`);
  }

  // Detect if we're inside an existing cabinet (creating a child)
  const parentCabinetRoot = findCabinetRoot(process.cwd());
  const isChild = parentCabinetRoot !== null;
  const kind = isChild ? "child" : "root";

  log(`Creating ${kind} cabinet "${name}" in ./${slug}/...`);

  // Create directory structure
  ensureDir(targetDir);
  ensureDir(path.join(targetDir, ".agents"));
  ensureDir(path.join(targetDir, ".jobs"));
  ensureDir(path.join(targetDir, ".cabinet-state"));

  // Write .cabinet manifest
  const manifest: CabinetManifest = {
    schemaVersion: 1,
    id: slug,
    name,
    kind,
    version: "0.1.0",
    description: "",
    entry: "index.md",
  };

  if (isChild) {
    manifest.parent = {
      shared_context: [],
    };
    manifest.access = {
      mode: "subtree-plus-parent-brief",
    };
  }

  writeCabinetManifest(targetDir, manifest);

  // Write index.md
  const now = new Date().toISOString();
  const indexContent = [
    "---",
    `title: ${name}`,
    `created: '${now}'`,
    `modified: '${now}'`,
    "tags: []",
    "order: 1",
    "---",
    "",
    `# ${name}`,
    "",
  ].join("\n");

  fs.writeFileSync(path.join(targetDir, "index.md"), indexContent, "utf8");

  success(`Cabinet "${name}" created at ./${slug}/`);

  if (isChild) {
    console.log(`\n  This is a child cabinet of ${parentCabinetRoot}.`);
  }

  console.log(`
  Next steps:

    cd ${slug}
    npx cabinetai run
`);
}
