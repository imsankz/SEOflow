#!/usr/bin/env node
/**
 * SeoFlow CLI — entry point for the npm package.
 *
 * Routes every verb through the single dispatcher in run.ts so the
 * published CLI stays in sync with the dev CLI (`npx tsx run.ts <verb>`).
 *
 * Usage:
 *   seoflow init                       Interactive config setup
 *   seoflow status                     Pipeline state + learning summary
 *   seoflow audit [slug | URL]         Run pipeline (or one post / live URL)
 *   seoflow learn                      Show learning insights
 *   seoflow learning export [file]     Export learning bundle
 *   seoflow learning import <file>     Import learning bundle
 *   seoflow generate [flags]           Generate content from keywords/gaps
 *   seoflow publish [--go]             Publish unpublished posts
 *   seoflow cluster <seed>             Semantic topic cluster plan
 *   seoflow brief <keyword>            SEO content brief
 *   seoflow orchestrate <slug>         Orchestrator-based pipeline
 *   seoflow run <slug>                 Alias for orchestrate
 *   seoflow brain                      Brain summary + vault stats
 *   seoflow vault                      Vault summary
 *   seoflow validate                   Check config + environment
 *   seoflow extensions [install|status]  Manage optional extensions
 *   seoflow --help                     Show help
 */

const [node, script, command, ...rest] = process.argv;

const HELP = `
  SeoFlow — AI-powered SEO pipeline

  USAGE
    seoflow <command> [flags]

  COMMANDS
    init                 Interactive config setup
    status               Pipeline state + GSC coverage + learning summary
    audit [slug | URL]   Run pipeline on top posts, one post, or a live URL
    learn                Show learning insights (step effectiveness)
    learning export [f]  Export learning.json + gsc-baselines.json
    learning import <f>  Import a learning bundle
    generate             Generate content from keywords/gaps
    publish [--go]       Publish unpublished posts
    cluster <seed>       Semantic topic cluster plan
    brief <keyword>      SEO content brief
    orchestrate <slug>   Orchestrator-based pipeline (dependency resolution)
    run <slug>           Alias for orchestrate
    brain                Brain summary + vault stats + next actions
    vault                Vault summary
    research             Log research/findings to the vault (never re-research)
    validate             Check config + environment
    extensions           List supported optional extensions
    extensions install <id>  Install an optional extension
    extensions status    Show installed extension state

  FLAGS (audit, generate, publish)
    --slug <slug>        Process only this post
    --dry-run            Preview without writing
    --limit <n>          Max posts to process (default 10)
    --mode <name>        Pipeline mode (audit only): meta|links|images|
                         keywords|neuron|content|review|factcheck|schema|
                         technical|quality|report|all
    --country <name>     Filter by country (generate only)
    --destination <name> Filter by destination/city (generate only)
    --no-audit           Skip auto post-processing after generate
    --go                 Actually publish (publish only)

  EXAMPLES
    seoflow init
    seoflow audit
    seoflow audit my-post-slug
    seoflow audit https://example.com
    seoflow audit --mode keywords --slug my-post
    seoflow audit --dry-run --limit 5
    seoflow generate                         (auto-picks from data/content-gaps.json)
    seoflow generate --country germany --limit 3
    seoflow generate --destination prague --no-audit
    seoflow publish --go
    seoflow cluster "best coffee in berlin"
    seoflow brief "how to pack for europe"
    seoflow brain
    seoflow validate

  Quick test (zero config, zero API keys):
    seoflow audit https://example.com
`;

// Commands that run.ts owns. Everything not in the special-case set
// below is forwarded to run.ts by rewriting process.argv.
const RUN_TS_VERBS = new Set([
  'status', 'audit', 'learn', 'learning', 'generate', 'publish',
  'cluster', 'brief', 'orchestrate', 'run',
  'brain', 'vault', 'research', 'validate',
  // Legacy flag-based invocation: seoflow --dry-run, seoflow --mode meta
  '--dry-run', '--mode', '--slug', '--limit', '--reset-slug',
]);

async function main() {
  if (!command || command === '--help' || command === '-h') {
    console.log(HELP);
    return;
  }

  // init: no config needed, handled locally
  if (command === 'init') {
    const { interactiveInit } = await import('../lib/init');
    await interactiveInit();
    return;
  }

  // extensions: no config needed, handled locally
  if (command === 'extensions') {
    await runExtensions(rest);
    return;
  }

  // Everything else → forward to run.ts.
  // run.ts reads process.argv and expects the verb as argv[2].
  if (RUN_TS_VERBS.has(command) || command.startsWith('--')) {
    process.argv = [node, script, ...[command, ...rest].filter(Boolean)];
    const { runPipeline } = await import('../run');
    await runPipeline();
    return;
  }

  console.error(`Unknown command: ${command}`);
  console.log(HELP);
  process.exit(1);
}

async function runExtensions(args: string[]) {
  const { formatExtensionStatus, getSupportedExtensions, installExtension, getExtensionState } = await import('../lib/extensions');
  const subcommand = args[0];
  const extensionId = args[1];

  if (subcommand === 'install') {
    const result = installExtension(extensionId || '', { rootDir: process.cwd() });
    if (result.status === 'unavailable') {
      console.error(`Unknown extension: ${extensionId}`);
      process.exit(1);
    }
    console.log(`Installed extension: ${result.extensionId}`);
    return;
  }

  if (subcommand === 'status') {
    const state = getExtensionState(process.cwd());
    const entries = Object.entries(state as Record<string, any>);
    if (entries.length === 0) {
      console.log('No extensions installed yet.');
      return;
    }
    for (const [id, extState] of entries) {
      console.log(`${id}: ${(extState as any).status}`);
    }
    return;
  }

  const supported = getSupportedExtensions();
  console.log('Supported optional extensions:');
  for (const ext of supported) {
    console.log(`- ${ext.id}: ${ext.name} — ${ext.description}`);
  }
  console.log('\nInstalled state:');
  for (const line of formatExtensionStatus(process.cwd())) {
    console.log(line);
  }
}

main().catch(e => {
  console.error('Fatal:', e?.message || e);
  process.exit(1);
});