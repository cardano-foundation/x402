package org.x402.spring.cardano;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.x402.mechanisms.cardano.exact.masumi.MasumiDeployment;

/**
 * The Cardano blocks of x402.accounts.* (plan Roles §1a). Bound next to * X402Properties over the same prefix; everything else is ignored here.
 *
 * @param accounts account name → network and Cardano settings
 */
@ConfigurationProperties("x402")
public record X402CardanoProperties(Map<String, CardanoAccount> accounts) {

  /** Normalizes an absent map. */
  public X402CardanoProperties {
    accounts = accounts == null ? Map.of()
        : Collections.unmodifiableMap(new LinkedHashMap<>(accounts));
  }

  /**
   * One account's Cardano view.
   *
   * @param network the account's network
   * @param cardano the Cardano block, may be null
   */
  public record CardanoAccount(String network, Cardano cardano) {}

  /**
   * x402.accounts.<name>.cardano.
   *
   * @param l1Confirmations the confirmation depth (-1..20) → extra.confirmationPolicy
   * @param masumi Masumi seller settings for the account's network
   */
  public record Cardano(Integer l1Confirmations, Masumi masumi) {}

  /**
   * x402.accounts.<name>.cardano.masumi; the settings of a network are the union of its
   * accounts' blocks.
   *
   * @param sellerMnemonic signs Masumi quotes (a CardanoSellerSigner bean wins)
   * @param sellerReturnAddress optional key-credential payout address
   * @param agentIdentifier optional registry asset id
   * @param deployment a non-canonical escrow deployment (required on Preview)
   */
  public record Masumi(String sellerMnemonic, String sellerReturnAddress, String agentIdentifier,
      Deployment deployment) {}

  /**
   * Masumi escrow validator parameters.
   *
   * @param requiredAdmins positive decimal string
   * @param adminVkeys 28-byte hex key hashes, in order
   * @param cooldownPeriod non-negative decimal string (ms)
   */
  public record Deployment(String requiredAdmins, List<String> adminVkeys,
      String cooldownPeriod) {

    /**
     * The mechanism's deployment.
     *
     * @return the deployment
     */
    public MasumiDeployment toMasumi() {
      return new MasumiDeployment(requiredAdmins, adminVkeys == null ? List.of() : adminVkeys,
          cooldownPeriod);
    }
  }
}
