package org.x402.spring.autoconfigure;

import org.springframework.boot.LazyInitializationExcludeFilter;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.core.env.Environment;
import org.springframework.core.io.ResourceLoader;

/**
 * Runs {@link X402MechanismCheck} at startup, whatever else is enabled: a configured mechanism
 * whose module is missing fails the application instead of leaving it half-working.
 */
@AutoConfiguration
public class X402MechanismCheckAutoConfiguration {

  /** Marker bean; creating it runs the check. */
  public static final class MechanismsChecked {
    private MechanismsChecked() {}
  }

  @Bean
  MechanismsChecked x402MechanismsChecked(Environment environment, ResourceLoader resources) {
    // The application context's class loader, which is the one that loads mechanism classes.
    X402MechanismCheck.check(environment, resources.getClassLoader());
    return new MechanismsChecked();
  }

  /** Keeps the check eager under {@code spring.main.lazy-initialization}. */
  @Bean
  static LazyInitializationExcludeFilter x402MechanismCheckEager() {
    return LazyInitializationExcludeFilter.forBeanTypes(MechanismsChecked.class);
  }
}
