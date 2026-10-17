#!/usr/bin/env node
/**
 * Rename the plugin package everywhere the harness resolves it by name.
 *
 * Cordis rows, the client module registry and the npm package name must agree:
 * `cordis.patch.yml` inserts a row whose `name` is the package name, and
 * `lib/client.js` registers a module whose `id` must equal that same name.
 * Renaming only package.json therefore installs fine and then fails to load,
 * which is the failure this script exists to prevent.
 *
 * Usage:
 *   node scripts/rename-package.mjs @scope/dsh-preset-switcher
 *   node scripts/rename-package.mjs dsh-preset-switcher-fork
 *
 * Run it from the package root, before `npm publish`. It prints every file it
 * rewrote and refuses to run when a target file is missing.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const next = process.argv[2];
if (typeof next !== 'string' || next.trim() === '') {
  console.error('usage: node scripts/rename-package.mjs <new-package-name>');
  process.exit(2);
}

const NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
if (!NAME.test(next)) {
  console.error(`invalid npm package name: ${next}`);
  process.exit(2);
}
if (next.length > 214) {
  console.error('package name is longer than 214 characters');
  process.exit(2);
}

const root = process.cwd();
/** Read a file as UTF-8 without its BOM; a BOM still parses in npm but breaks JSON.parse. */
function readText(file) {
  const text = readFileSync(join(root, file), 'utf8');
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
const pkg = JSON.parse(readText('package.json'));
const previous = pkg.name;
if (typeof previous !== 'string' || previous === '') {
  console.error('package.json has no name');
  process.exit(1);
}
if (previous === next) {
  console.log(`already named ${next}; nothing to do`);
  process.exit(0);
}

/** One file rewrite: every pattern must match, or the whole run aborts. */
const edits = [
  {
    file: 'package.json',
    apply(text) {
      return text.replace(/"name":\s*"[^"]+"/, `"name": ${JSON.stringify(next)}`);
    },
    expect: 1,
  },
  {
    file: 'cordis.patch.yml',
    apply(text) {
      return text
        // Quote both scalars: a scoped name starts with `@`, which cannot open a
        // plain YAML scalar, so `- id: @scope/name` would fail to parse.
        .replace(/^(\s*- id:\s*).+$/m, (line, prefix) => `${prefix}'${next}'`)
        .replace(/^(\s*name:\s*)'[^']*'$/m, `$1'${next}'`);
    },
    expect: 2,
  },
  {
    file: 'lib/client.js',
    apply(text) {
      return text
        .replace(/id: "[^"]+",/, `id: ${JSON.stringify(next)},`)
        .replace(/exports\.name = "[^"]+";/, `exports.name = ${JSON.stringify(next)};`)
        .replace(/registrant: "[^"]+"/, `registrant: ${JSON.stringify(next)}`)
        .replace(/"dsh-preset-switcher: header action"/, JSON.stringify(`${next}: header action`));
    },
    expect: 4,
  },
  {
    file: 'lib/index.js',
    apply(text) {
      return text
        .replace(/const name = '[^']*';/, `const name = ${JSON.stringify(next).replaceAll('"', "'")};`)
        .replace(/'dsh-preset-switcher: api routes'/, `'${next}: api routes'`);
    },
    expect: 2,
  },
];

const staged = [];
for (const edit of edits) {
  const path = join(root, edit.file);
  let text;
  try {
    text = readText(edit.file);
  } catch (error) {
    console.error(`cannot read ${edit.file}: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
  const updated = edit.apply(text);
  if (updated === text) {
    // Nothing matched in this file: usually the file already carries another
    // name, so abort instead of leaving a half-renamed package behind.
    console.error(`no rewrite applied in ${edit.file}; check its current name and retry`);
    process.exit(1);
  }
  staged.push({ path, updated });
}

for (const { path, updated } of staged) {
  writeFileSync(path, updated, 'utf8');
  console.log(`rewrote ${path.slice(root.length + 1)}`);
}

console.log(`\n${previous} -> ${next}`);
if (next.startsWith('@')) {
  console.log(`publish with: npm publish --access public`);
} else {
  console.log('publish with: npm publish');
}
