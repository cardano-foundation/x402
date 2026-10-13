package org.x402.spring.facilitator;

import java.time.Clock;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.ObjectProvider;
import org.x402.mechanisms.cardano.CardanoNetworks;
import org.x402.mechanisms.cardano.chain.BlockfrostChainBackend;
import org.x402.mechanisms.cardano.chain.CardanoChainBackend;
import org.x402.mechanisms.cardano.exact.facilitator.CardanoFacilitatorSigner;
import org.x402.mechanisms.cardano.exact.facilitator.ExactCardanoFacilitatorOptions;
import org.x402.mechanisms.cardano.exact.facilitator.ExactCardanoFacilitatorScheme;
import org.x402.mechanisms.cardano.exact.facilitator.SettlementClaimStore;
import org.x402.mechanisms.cardano.exact.masumi.MasumiDeploymentValidator;
import org.x402.mechanisms.cardano.exact.masumi.MasumiRegistryValidator;
import org.x402.spring.X402ConfigurationException;
import org.x402.spring.cardano.NetworkBeans;
import org.x402.spring.cardano.X402CardanoNetworkBeans;

/**
 * The auto-built Cardano facilitator schemes, one per {@code
 * x402.facilitator-server.cardano.networks[]} entry (plan §3a level 6). A custom scheme can wrap
 * {@link #forNetwork(String)} by composition (its {@code verify}/{@code settle} are final,
 * decision 121) and register itself in an {@link X402FacilitatorCustomizer}.
 */
public final class CardanoFacilitatorSchemes {

  private final Map<String, ExactCardanoFacilitatorScheme> schemes = new LinkedHashMap<>();
  private final Map<String, CardanoChainBackend> backends = new LinkedHashMap<>();
  private final Map<String, ExactCardanoFacilitatorOptions> options = new LinkedHashMap<>();

  /**
   * Builds the schemes.
   *
   * @param cardano the Cardano settings
   * @param store the settlement claim store (shared by all networks)
   * @param registry the Masumi registry validator, if any
   * @param deployment the Masumi deployment validator, if any
   * @param clock the clock
   * @param networkBeans the by-network provider, if any
   * @param backendBean a plain backend bean, if any
   * @throws X402ConfigurationException for an incomplete network entry
   */
  public CardanoFacilitatorSchemes(X402FacilitatorServerProperties.Cardano cardano,
      SettlementClaimStore store, MasumiRegistryValidator registry,
      MasumiDeploymentValidator deployment, Clock clock,
      ObjectProvider<X402CardanoNetworkBeans> networkBeans,
      ObjectProvider<CardanoChainBackend> backendBean) {
    List<X402FacilitatorServerProperties.Network> entries = cardano.networks();
    for (int i = 0; i < entries.size(); i++) {
      X402FacilitatorServerProperties.Network entry = entries.get(i);
      String where = "x402.facilitator-server.cardano.networks[" + i + "]";
      String network = entry == null ? null : entry.network();
      if (!CardanoNetworks.isCardanoNetwork(network)) {
        throw new X402ConfigurationException(where + ".network: " + network
            + " is not a Cardano network");
      }
      CardanoChainBackend backend = NetworkBeans.resolve(network, entries.size(), networkBeans,
          b -> b.chainBackend(network), backendBean, "CardanoChainBackend");
      if (backend == null) {
        X402FacilitatorServerProperties.Blockfrost bf = entry.blockfrost();
        String projectId = bf == null ? null : bf.projectId();
        String baseUrl = bf == null || bf.baseUrl() == null || bf.baseUrl().isBlank() ? null
            : bf.baseUrl();
        if ((projectId == null || projectId.isBlank()) && baseUrl == null) {
          throw new X402ConfigurationException(where + ".blockfrost.project-id is required (or "
              + "set blockfrost.base-url, or define a CardanoChainBackend bean)");
        }
        backend = new BlockfrostChainBackend(BlockfrostChainBackend.Config.builder()
            .network(network).projectId(projectId).baseUrl(baseUrl).clock(clock).build());
      }
      CardanoFacilitatorSigner signer = entry.mnemonic() == null || entry.mnemonic().isBlank()
          ? null : CardanoFacilitatorSigner.fromMnemonic(entry.mnemonic(), network);
      ExactCardanoFacilitatorOptions opts = ExactCardanoFacilitatorOptions.builder()
          .settlementStore(store).acceptMempool(cardano.acceptMempool())
          .confirmationTimeout(cardano.confirmationTimeout())
          .confirmationPoll(cardano.confirmationPoll())
          .registryValidator(registry).deploymentValidator(deployment).clock(clock).build();
      backends.put(network, backend);
      options.put(network, opts);
      schemes.put(network, new ExactCardanoFacilitatorScheme(backend, signer, opts));
    }
  }

  /**
   * The configured networks.
   *
   * @return the networks in declaration order
   */
  public List<String> networks() {
    return new ArrayList<>(schemes.keySet());
  }

  /**
   * The auto-built scheme of a network.
   *
   * @param network the network
   * @return the scheme, or {@code null}
   */
  public ExactCardanoFacilitatorScheme forNetwork(String network) {
    return schemes.get(network);
  }

  /**
   * The chain backend of a network.
   *
   * @param network the network
   * @return the backend, or {@code null}
   */
  public CardanoChainBackend backend(String network) {
    return backends.get(network);
  }

  /**
   * The options a network's scheme was built with.
   *
   * @param network the network
   * @return the options, or {@code null}
   */
  public ExactCardanoFacilitatorOptions options(String network) {
    return options.get(network);
  }
}
