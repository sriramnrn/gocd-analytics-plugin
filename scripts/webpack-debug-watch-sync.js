/*
 * Copyright 2020 ThoughtWorks, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const fs = require("fs");
const path = require("path");
const webpack = require("webpack");
const debugConfig = require("../config/webpack.debug.js");

const PLUGIN_ID = "com.thoughtworks.gocd.analytics";
const WORKSPACE = path.resolve(__dirname, "..");
const WEBPACK_OUTPUT_DIR = path.join(WORKSPACE, "build", "resources", "webpack");

function readArgs(argv) {
  const options = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--once") {
      options.once = true;
    } else if (arg === "--gocd-repo") {
      options.gocdRepo = argv[++i];
    } else if (arg === "--plugin-assets-hash") {
      options.pluginAssetsHash = argv[++i];
    } else if (arg === "--target-dir") {
      options.targetDir = argv[++i];
    }
  }

  return options;
}

function resolveTargetDir(options) {
  const configuredTarget = options.targetDir || process.env.GOCD_PLUGIN_ASSET_CACHE_DIR;

  if (configuredTarget) {
    return path.resolve(configuredTarget);
  }

  const goCdRepo = options.gocdRepo || process.env.GOCD_REPO;
  if (!goCdRepo) {
    throw new Error("Set GOCD_REPO=/path/to/gocd, pass --gocd-repo /path/to/gocd, or set GOCD_PLUGIN_ASSET_CACHE_DIR to the exact plugin asset cache directory.");
  }

  const pluginAssetRoot = path.join(
    path.resolve(goCdRepo),
    "server", "src", "main", "webapp", "WEB-INF", "rails", "public", "assets", "plugins", PLUGIN_ID
  );

  if (!fs.existsSync(pluginAssetRoot)) {
    throw new Error(`GoCD plugin asset root does not exist: ${pluginAssetRoot}. Start GoCD with the jar installed so plugin metadata load extracts assets first.`);
  }

  const configuredHash = options.pluginAssetsHash || process.env.GOCD_PLUGIN_ASSETS_HASH;
  if (configuredHash) {
    return path.join(pluginAssetRoot, configuredHash);
  }

  const hashDirs = fs.readdirSync(pluginAssetRoot, {withFileTypes: true})
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(pluginAssetRoot, entry.name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

  if (hashDirs.length === 0) {
    throw new Error(`No hash directories found under ${pluginAssetRoot}. Trigger GoCD plugin metadata load/reload first.`);
  }

  return hashDirs[0];
}

function copyRecursive(source, target) {
  fs.mkdirSync(target, {recursive: true});

  for (const entry of fs.readdirSync(source, {withFileTypes: true})) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);

    if (entry.isDirectory()) {
      copyRecursive(sourcePath, targetPath);
    } else {
      fs.mkdirSync(path.dirname(targetPath), {recursive: true});
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}

function syncAssets(targetDir) {
  if (!fs.existsSync(targetDir)) {
    throw new Error(`Plugin asset cache directory does not exist: ${targetDir}`);
  }

  copyRecursive(WEBPACK_OUTPUT_DIR, targetDir);
  console.log(`Synced debug assets to ${targetDir}`);
}

function reportStats(stats) {
  console.log(stats.toString({
    all: false,
    assets: true,
    builtAt: true,
    errors: true,
    hash: true,
    timings: true,
    warnings: true
  }));
}

const options = readArgs(process.argv.slice(2));
const targetDir = resolveTargetDir(options);
const config = debugConfig({NODE_ENV: "development"});
config.mode = "development";

fs.rmSync(WEBPACK_OUTPUT_DIR, {recursive: true, force: true});

const compiler = webpack(config);
const callback = (error, stats) => {
  if (error) {
    console.error(error.stack || error);
    process.exitCode = 1;
    return;
  }

  reportStats(stats);

  if (stats.hasErrors()) {
    process.exitCode = 1;
    return;
  }

  try {
    syncAssets(targetDir);
  } catch (syncError) {
    console.error(syncError.stack || syncError);
    process.exitCode = 1;
  }
};

if (options.once) {
  compiler.run((error, stats) => {
    callback(error, stats);
    if (typeof compiler.close === "function") {
      compiler.close(() => {});
    }
  });
} else {
  console.log(`Watching debug assets and syncing to ${targetDir}`);
  compiler.watch({}, callback);
}
