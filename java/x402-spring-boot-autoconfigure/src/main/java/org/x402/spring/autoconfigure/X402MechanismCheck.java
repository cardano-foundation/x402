package org.x402.spring.autoconfigure;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;
import java.util.function.Predicate;
import java.util.regex.Pattern;
import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.boot.context.properties.source.ConfigurationPropertyName;
import org.springframework.boot.context.properties.source.ConfigurationPropertySource;
import org.springframework.boot.context.properties.source.ConfigurationPropertySources;
import org.springframework.boot.context.properties.source.IterableConfigurationPropertySource;
import org.springframework.core.env.Environment;
import org.springframework.util.ClassUtils;
import org.x402.spring.X402ConfigurationException;

/**
 * Fails startup when configuration names a payment mechanism whose module is not on the
 * classpath. The starter brings no mechanism; an application adds the ones it uses, and a missing
 * one would otherwise start silently: a server whose routes answer 503, a client that can't pay,
 * a facilitator that supports nothing.
 *
 * <p>Reads plain properties only, so it never links against a mechanism's classes.
 */
public final class X402MechanismCheck {

  /**
   * A mechanism the starter knows how to wire.
   *
   * @param name the name in error messages
   * @param artifact the Maven coordinates to add
   * @param probeClass a class of the mechanism module
   * @param network whether a CAIP-2 network belongs to the mechanism
   * @param clientNetworks the property listing the client's networks
   * @param facilitatorNetworks the property listing the facilitator's networks
   */
  record Mechanism(String name, String artifact, String probeClass, Predicate<String> network,
      String clientNetworks, String facilitatorNetworks) {}

  static final List<Mechanism> MECHANISMS = List.of(
      new Mechanism("Cardano", "org.x402:x402-mechanism-cardano",
          "org.x402.mechanisms.cardano.CardanoNetworks",
          n -> n.startsWith("cardano:") || n.startsWith("cip34:"),
          "x402.client.cardano.networks", "x402.facilitator-server.cardano.networks"));

  private static final Pattern ACCOUNT_NETWORK = Pattern.compile("x402\\.accounts\\.[^.]+\\.network");
  private static final Pattern OPTION_NETWORK =
      Pattern.compile("x402\\.routes\\.[^.]+\\.accepts\\[\\d+]\\.network");

  private X402MechanismCheck() {}

  /**
   * Checks the configuration against the classpath.
   *
   * @param environment the application's environment
   * @param classLoader the class loader to probe
   * @throws X402ConfigurationException naming every missing mechanism and where it is configured
   */
  public static void check(Environment environment, ClassLoader classLoader) {
    Binder binder = Binder.get(environment);
    List<String> problems = new ArrayList<>();
    for (Mechanism m : MECHANISMS) {
      if (ClassUtils.isPresent(m.probeClass(), classLoader)) {
        continue;
      }
      List<String> uses = uses(environment, binder, m);
      if (!uses.isEmpty()) {
        problems.add(m.name() + " is configured (" + String.join(", ", uses) + ") but "
            + m.artifact() + " is not on the classpath; add it as a dependency");
      }
    }
    if (!problems.isEmpty()) {
      throw new X402ConfigurationException(String.join("; ", problems));
    }
  }

  private static List<String> uses(Environment environment, Binder binder, Mechanism m) {
    Set<String> uses = new TreeSet<>();
    boolean facilitator = binder.bind("x402.facilitator-server.enabled", Boolean.class)
        .orElse(false);
    // Property names, not typed binding: binding part of an indexed entry fails on its other keys.
    for (String name : propertyNames(environment)) {
      if (ACCOUNT_NETWORK.matcher(name).matches() || OPTION_NETWORK.matcher(name).matches()) {
        String network = binder.bind(name, String.class).orElse(null);
        if (network != null && m.network().test(network.strip())) {
          uses.add(name);
        }
      } else if (name.startsWith(m.clientNetworks() + "[")) {
        uses.add(m.clientNetworks());
      } else if (facilitator && name.startsWith(m.facilitatorNetworks() + "[")) {
        uses.add(m.facilitatorNetworks());
      }
    }
    return new ArrayList<>(uses);
  }

  private static Set<String> propertyNames(Environment environment) {
    Set<String> names = new TreeSet<>();
    for (ConfigurationPropertySource source : ConfigurationPropertySources.get(environment)) {
      if (source instanceof IterableConfigurationPropertySource iterable) {
        iterable.stream().map(ConfigurationPropertyName::toString)
            .filter(n -> n.startsWith("x402.")).forEach(names::add);
      }
    }
    return names;
  }
}
