#! /usr/bin/env node

const execSync = require('child_process').execSync;
const esbuild = require('esbuild');
const fs = require('fs');
const yargs = require('yargs/yargs');
const hideBin = require('yargs/helpers').hideBin;
const util = require('util');
const path = require('path');

const exec = util.promisify(execSync);

const args = yargs(hideBin(process.argv))
  .option('esm', {
    describe: 'Generate esm bundle',
    type: 'boolean',
  })
  .option('cjs', {
    describe: 'Generate cjs bundel',
    type: 'boolean',
  })
  .option('types', {
    describe: 'Generate types',
    type: 'boolean',
  }).argv;

const entryPoints = ['src/index.ts'];

const packageJson = JSON.parse(fs.readFileSync('./package.json', 'utf-8'));
const external = Object.keys({
  ...(packageJson.dependencies || {}),
  ...(packageJson.devDependencies || {}),
  ...(packageJson.peerDependencies || {}),
  ...(packageJson.optionalDependencies || {}),
});

// vscode library is provided by VSCode
external.push('vscode');

const cleanup = () => {
  fs.rmSync('./dist', {recursive: true, force: true});
};

const outDirFromConfig = (configPath) => {
  const config = JSON.parse(fs.readFileSync(configPath, {encoding: 'utf-8'}));
  const outDir = config.compilerOptions.outDir;
  return path.resolve('./config', outDir);
};

const build = async () => {
  // Remove the directory before building or moving files fails on Windows (does not override)
  cleanup();

  try {
    const config = {
      entryPoints,
      bundle: true,
      external,
      platform: 'node',
      treeShaking: true,
    };

    const promises = [];

    // Build ESM
    if (args.esm) {
      const tsconfig = 'configs/tsconfig.esm.json';
      const outdir = outDirFromConfig(tsconfig);
      promises.push(
        esbuild.build({
          ...config,
          outdir,
          format: 'esm',
          tsconfig,
        }),
      );
    }

    // Build CJS
    if (args.cjs) {
      const tsconfig = 'configs/tsconfig.cjs.json';
      const outdir = outDirFromConfig(tsconfig);
      promises.push(
        esbuild.build({
          ...config,
          outdir,
          format: 'cjs',
          tsconfig,
        }),
      );
    }

    // Build types
    if (args.types) {
      const tsconfig = './configs/tsconfig.types.json';
      promises.push(exec(`tsc --project ${tsconfig} && tsc-alias --project ${tsconfig}`));
    }

    await Promise.all(promises);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
};

build();
