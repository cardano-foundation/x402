package org.x402.core.types;

/** A route price: a {@link Money} string or an exact {@link AssetAmount} (TS {@code Price}). */
public sealed interface Price permits Money, AssetAmount {}
