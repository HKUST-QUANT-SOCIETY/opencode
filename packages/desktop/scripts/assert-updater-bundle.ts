#!/usr/bin/env bun

const bundlePath = process.env.QUANTCODE_MAIN_BUNDLE ?? "./out/main/index.js"
const bundle = await Bun.file(bundlePath).text()

if (!/const quantCodeUpdaterEnabled = (true|false);/.test(bundle)) {
  throw new Error(`updater bundle is missing the compiled QuantCode policy: ${bundlePath}`)
}

if (!/const UPDATER_ENABLED = app\.isPackaged && CHANNEL !== "dev" && quantCodeUpdaterEnabled;/.test(bundle)) {
  throw new Error(`updater bundle does not consume the compiled QuantCode policy: ${bundlePath}`)
}

if (bundle.includes("isQuantCodeUpdaterEnabled")) {
  throw new Error(`updater bundle contains the runtime policy helper; rebuild with the compiled policy: ${bundlePath}`)
}

console.log(`Updater bundle assertion passed: ${bundlePath}`)
