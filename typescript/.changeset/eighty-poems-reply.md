---
'@x402/cardano': patch
---

Fix transaction decoder to work with `@emurgo/cardano-serialization-lib-nodejs` v13+. The previous code called `csl.hash_transaction(body)`, a top-level export removed in CSL v13, so consumers on any modern CSL (current stable v15.0.3) hit `TypeError: csl.hash_transaction is not a function` on every real signed transaction. Now uses `FixedTransaction.new_from_body_bytes(...).transaction_hash()`, available since CSL v11, with a runtime fallback so the declared `>=11.5.0` peer-dep range stays honest.
