import type {
  AssetAmount,
  Money,
  MoneyParser,
  Network,
  PaymentRequirements,
  Price,
  SchemeNetworkServer,
  SupportedKind,
} from "@x402/core/types";
import { convertToTokenAmount, numberToDecimalString, parseMoneyString } from "@x402/core/utils";
import {
  CARDANO_ASSET_REGEX,
  getDefaultUsdmAsset,
  isCardanoNetwork,
  SCHEME_EXACT,
  USDM_DEFAULT_DECIMALS,
} from "../../constants";

/**
 * Cardano server-side implementation for the Exact scheme.
 *
 * Performs Money-to-AssetAmount parsing using a registerable parser chain and
 * leaves Cardano-specific extra fields untouched, since most extras are
 * server-supplied (assetTransferMethod, Masumi metadata, script descriptors).
 */
export class ExactCardanoScheme implements SchemeNetworkServer {
  readonly scheme = SCHEME_EXACT;
  private readonly moneyParsers: MoneyParser[] = [];

  /**
   * Registers a custom Money parser. Parsers are tried in registration order;
   * the first non-null result wins. Returns `null` to defer to the next
   * parser.
   *
   * @param parser - The parser to register.
   * @returns This instance for chaining.
   */
  registerMoneyParser(parser: MoneyParser): ExactCardanoScheme {
    this.moneyParsers.push(parser);
    return this;
  }

  /**
   * Converts a price into an AssetAmount. AssetAmount inputs are passed
   * through (after asset validation); Money inputs are parsed via the parser
   * chain falling back to the default USDM conversion.
   *
   * @param price - The price to parse.
   * @param network - The Cardano network identifier.
   * @returns The resolved AssetAmount.
   */
  async parsePrice(price: Price, network: Network): Promise<AssetAmount> {
    if (typeof price === "object" && price !== null && "amount" in price) {
      if (!price.asset) {
        throw new Error(`Asset unit must be specified for AssetAmount on network ${network}`);
      }
      if (!CARDANO_ASSET_REGEX.test(price.asset)) {
        throw new Error(`Invalid Cardano asset unit: ${price.asset}`);
      }
      return { amount: price.amount, asset: price.asset, extra: price.extra ?? {} };
    }

    const decimal = this.parseMoneyToDecimal(price as Money);
    for (const parser of this.moneyParsers) {
      const result = await parser(decimal, network);
      if (result !== null) {
        if (!CARDANO_ASSET_REGEX.test(result.asset)) {
          throw new Error(`Custom money parser returned invalid Cardano asset: ${result.asset}`);
        }
        return result;
      }
    }
    return this.defaultMoneyConversion(decimal, network);
  }

  /**
   * Returns the decimal precision for the supplied asset. Currently we assume
   * USDM/USDC decimals (6) when the asset matches the default; integrators
   * should subclass to provide custom decimals for other tokens.
   *
   * @param _asset - The asset unit string.
   * @param _network - The Cardano network identifier.
   * @returns Decimal precision.
   */
  getAssetDecimals(_asset: string, _network: Network): number {
    void _asset;
    void _network;
    return USDM_DEFAULT_DECIMALS;
  }

  /**
   * Enhances payment requirements before they are returned to the client.
   *
   * The requirements' own `extra` is passed through **unchanged**. A
   * facilitator's `/supported` extra is capability advertisement — which
   * transfer methods, settlement layers and confirmation ranges it can service
   * — and is not payload semantics, so merging it here would be wrong twice
   * over: `PaymentRequirements.extra` selects what the payment *is*, and the
   * Masumi `extra` is a **closed object** whose unknown fields are a rejection.
   * Copying `assetTransferMethods`/`settlementLayers`/`submissionModes` into it
   * would make every Masumi 402 invalid on arrival.
   *
   * @param paymentRequirements - The base payment requirements.
   * @param supportedKind - The matching SupportedKind.
   * @param extensionKeys - The list of facilitator extension keys.
   * @returns Promise resolving to enhanced payment requirements.
   */
  enhancePaymentRequirements(
    paymentRequirements: PaymentRequirements,
    supportedKind: SupportedKind,
    extensionKeys: string[],
  ): Promise<PaymentRequirements> {
    void extensionKeys;
    if (!isCardanoNetwork(supportedKind.network)) {
      throw new Error(`Unsupported Cardano network: ${supportedKind.network}`);
    }
    return Promise.resolve(paymentRequirements);
  }

  /**
   * Parses a Money value (number, or a decimal string with optional `$`) into a
   * decimal number via the shared core parser.
   *
   * @param money - The Money value to parse.
   * @returns The decimal value as a number.
   */
  private parseMoneyToDecimal(money: Money): number {
    if (typeof money === "number") {
      return money;
    }
    return parseMoneyString(money);
  }

  /**
   * Falls back to converting a Money decimal to atomic units on the given
   * network. Honors `getAssetDecimals()` so subclasses that override the
   * hook for non-USDM tokens get correctly scaled atomic amounts.
   *
   * @param amount - The decimal amount.
   * @param network - The Cardano network identifier.
   * @returns The resulting AssetAmount.
   */
  private defaultMoneyConversion(amount: number, network: Network): AssetAmount {
    const asset = getDefaultUsdmAsset(network);
    const decimals = this.getAssetDecimals(asset, network);
    const tokenAmount = convertToTokenAmount(numberToDecimalString(amount), decimals);
    return { amount: tokenAmount, asset, extra: {} };
  }
}
