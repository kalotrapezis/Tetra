// The Windows build: package.json's, with each native module's Windows binary in place of Linux's (scripts/win-deps.sh
// puts sharp's in node_modules). No bundled Java or Python yet, so the map builder says what it is missing.
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
  win: { target: [{ target: 'nsis', arch: ['x64'] }], icon: 'public/icon.png' },
  nsis: { oneClick: false, allowToChangeInstallationDirectory: true, perMachine: false },
  protocols: [{ name: 'Email', schemes: ['mailto'] }],
}
