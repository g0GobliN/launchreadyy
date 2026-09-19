/// <reference types="vite/client" />

/** Vite / Wasmpack emit a compiled WebAssembly.Module for `.wasm` imports. */
declare module "*.wasm" {
  const module: WebAssembly.Module;
  export default module;
}
