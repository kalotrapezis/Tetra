// The Windows build: package.json's, with each native module's Windows binary in place of Linux's (scripts/win-deps.sh
// puts sharp's in node_modules), and the map builder's Java and Python inside as the AppImage has (scripts/bundle-tools-win.sh
// makes bundled-win/, found at resources/bundled as on Linux).
const base = require('./package.json').build
const linuxOnly = f => !/onnxruntime-node\/bin\/napi-v6\/(win32|linux)|sharp-win32/.test(f)
module.exports = {
  ...base,
  files: [
    ...base.files.filter(linuxOnly),
    '!node_modules/onnxruntime-node/bin/napi-v6/linux/**',
    '!node_modules/onnxruntime-node/bin/napi-v6/win32/arm64/**',
    '!node_modules/@img/sharp-linux*/**',
    '!node_modules/@img/sharp-libvips-linux*/**',
    '!node_modules/@img/sharp-wasm32/**',
  ],
  extraResources: [...(base.extraResources ?? []), { from: 'bundled-win', to: 'bundled' }],
  win: { target: [{ target: 'nsis', arch: ['x64'] }], icon: 'public/icon.png' },
  nsis: { oneClick: false, allowToChangeInstallationDirectory: true, perMachine: false },
  protocols: [{ name: 'Email', schemes: ['mailto'] }],
}
