package org.x402.spring.facilitator;

import java.time.Duration;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;
import org.x402.spring.cardano.X402CardanoProperties;

/**
 * x402.facilitator-server.*. Independent of x402.enabled.
 *
 * @param enabled run the facilitator (default false)
 * @param exposeHttp serve /verify, /settle, /supported (default true); false keeps it in-process
 *     (local client, own controllers)
 * @param basePath the endpoint prefix (default /x402); "" or / = root
 * @param cardano the Cardano facilitator
 */
@ConfigurationProperties("x402.facilitator-server")
public record X402FacilitatorServerProperties(
    boolean enabled,
    @DefaultValue("true") boolean exposeHttp,
    @DefaultValue("/x402") String basePath,
    @DefaultValue Cardano cardano) {

  /**
   * The Cardano facilitator.
   *
   * @param acceptMempool accept l1Confirmations: -1 (mempool) payments
   * @param confirmationTimeout how long settle waits for confirmations (default 75 s; keep below
   *     85 s)
   * @param confirmationPoll interval between confirmation checks (default 5 s)
   * @param networks one scheme, backend and optional signer per network
   */
  public record Cardano(
      boolean acceptMempool,
      @DefaultValue("75s") Duration confirmationTimeout,
      @DefaultValue("5s") Duration confirmationPoll,
      List<Network> networks) {

    /** Normalizes an absent list. */
    public Cardano {
      networks = networks == null ? List.of() : List.copyOf(networks);
    }
  }

  /**
   * One Cardano network.
   *
   * @param network the CAIP-2 network
   * @param blockfrost the Blockfrost backend
   * @param mnemonic optional facilitator mnemonic (only shown as an address in /supported);
   *     provider-only without it
   */
  public record Network(String network, X402CardanoProperties.Blockfrost blockfrost,
      String mnemonic) {}
}
