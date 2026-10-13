package org.x402.spring.starter;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class SmokeTest {

  @Test
  void moduleIsOnTheClasspath() {
    assertThat(SmokeTest.class.getPackageName()).isEqualTo("org.x402.spring.starter");
  }
}
