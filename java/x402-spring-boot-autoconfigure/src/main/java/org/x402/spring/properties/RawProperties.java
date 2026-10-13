package org.x402.spring.properties;

import java.util.function.Predicate;
import org.springframework.boot.context.properties.source.ConfigurationProperty;
import org.springframework.boot.context.properties.source.ConfigurationPropertyName;
import org.springframework.boot.context.properties.source.ConfigurationPropertySource;
import org.springframework.boot.context.properties.source.ConfigurationPropertySources;
import org.springframework.boot.context.properties.source.ConfigurationPropertyState;
import org.springframework.core.env.Environment;

/**
 * Detects properties the typed binding ignores, e.g. an offer-level {@code network}: the binder
 * drops unknown fields, so forbidden places are checked against the raw sources.
 */
public final class RawProperties {

  private RawProperties() {}

  /**
   * Presence over an environment's property sources.
   *
   * @param environment the environment
   * @return whether a property, or any property below it, is set
   */
  public static Predicate<String> presence(Environment environment) {
    return presence(ConfigurationPropertySources.get(environment));
  }

  /**
   * Presence over configuration property sources.
   *
   * @param sources the sources
   * @return whether a property, or any property below it, is set
   */
  public static Predicate<String> presence(Iterable<ConfigurationPropertySource> sources) {
    return name -> {
      ConfigurationPropertyName key = ConfigurationPropertyName.adapt(name, '.');
      for (ConfigurationPropertySource source : sources) {
        ConfigurationProperty property = source.getConfigurationProperty(key);
        if (property != null
            || source.containsDescendantOf(key) == ConfigurationPropertyState.PRESENT) {
          return true;
        }
      }
      return false;
    };
  }
}
