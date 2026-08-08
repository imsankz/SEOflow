#!/usr/bin/env node
/**
 * Dual publish — publishes the package under BOTH npm names:
 *   1. @imsankz/seoflow  (existing scoped package)
 *   2. seoflow           (canonical short name — makes `npx seoflow` work for everyone)
 *
 * The two names share one version, so `npm version` bumps both.
 *
 * Usage:
 *   npm run publish:both        # build + publish both names (run after `npm login`)
 *   npm run publish:both -- --dry-run
 *
 * Requires: `npm login` once (browser auth). prepublishOnly builds dist/ first.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pkgPath = path.join(root, 'package.json');
const dryRun = process.argv.includes('--dry-run');
// Forward --otp=<code> to npm publish (2FA accounts require a one-time password).
const otpArg = process.argv.find((a) => a.startsWith('--otp='));
const otpSuffix = otpArg ? ` --otp=${otpArg.slice('--otp='.length)}` : '';

const original = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const version = original.version;
// Scoped first (existing users), then the canonical short name.
const names = [...new Set([original.name, 'seoflow'])];

function run(cmd) {
  console.log(`\n$ ${cmd}`);
  if (dryRun) {
    console.log('  (dry-run — skipped)');
    return;
  }
  execSync(cmd, { cwd: root, stdio: 'inherit' });
}

try {
  for (const name of names) {
    if (name !== original.name) {
      const pkg = { ...original, name };
      fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
      console.log(`\n📦 package.json name → ${name}`);
    }
    run(`npm publish --access public${otpSuffix}`);
    console.log(`✅ published ${name}@${version}`);
  }
} finally {
  // Always restore the canonical name in package.json, even on failure.
  fs.writeFileSync(pkgPath, `${JSON.stringify(original, null, 2)}\n`);
  console.log(`\n♻️  restored package.json name → ${original.name}`);
}
