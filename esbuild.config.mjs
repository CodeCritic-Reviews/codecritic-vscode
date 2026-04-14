import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

const extensionCtx = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'out/extension.js',
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  sourcemap: true,
  external: ['vscode'],
};

const webviewCtx = {
  entryPoints: ['src/webview/reviewView.ts'],
  bundle: true,
  outfile: 'out/reviewView.js',
  platform: 'browser',
  target: 'es2022',
  format: 'iife',
  sourcemap: true,
};

async function run() {
  if (watch) {
    const ext = await esbuild.context(extensionCtx);
    const wv = await esbuild.context(webviewCtx);
    await Promise.all([ext.watch(), wv.watch()]);
    console.log('watching…');
  } else {
    await esbuild.build(extensionCtx);
    await esbuild.build(webviewCtx);
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
