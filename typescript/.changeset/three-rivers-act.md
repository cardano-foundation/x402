---
'@x402/cardano': major
---
Replace the @emurgo/cardano-serialization-lib-nodejs peer dependency with @harmoniclabs/buildooor for transaction decoding. Buildooor is pure TypeScript (no WASM init step), removing the CSL load cost and shrinking the dependency surface. The optional
peer dependency is now @harmoniclabs/buildooor (>=0.2.0); consumers who installed CSL for @x402/cardano must install buildooor instead.
