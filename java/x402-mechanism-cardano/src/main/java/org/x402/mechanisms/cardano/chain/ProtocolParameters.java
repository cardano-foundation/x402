package org.x402.mechanisms.cardano.chain;

import java.math.BigInteger;

/**
 * The live protocol parameters the built-in phase-1 checks need (TS {@code
 * CardanoProtocolParameters}).
 *
 * @param coinsPerUtxoByte min-UTxO lovelace per output byte
 * @param minFeeCoefficient {@code minFeeA}, lovelace per transaction byte
 * @param minFeeConstant {@code minFeeB}, constant lovelace per transaction
 */
public record ProtocolParameters(
    BigInteger coinsPerUtxoByte, BigInteger minFeeCoefficient, BigInteger minFeeConstant) {}
