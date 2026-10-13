package org.x402.http;

import java.util.List;

/**
 * Routes cannot be served as configured (TS {@code RouteConfigurationError}); lists every problem.
 * {@link X402HttpResourceServer#isFatalStartupError} treats it as fatal, as TS does. An adapter
 * applying the plan's partial-outage rule checks {@link #onlyAwaitingFacilitators()}.
 */
public class RouteConfigurationError extends IllegalArgumentException {

  private static final long serialVersionUID = 1L;

  private final transient List<RouteValidationError> errors;

  /**
   * Creates the error.
   *
   * @param errors the problems
   */
  public RouteConfigurationError(List<RouteValidationError> errors) {
    super(message(errors));
    this.errors = List.copyOf(errors);
  }

  private static String message(List<RouteValidationError> errors) {
    StringBuilder sb = new StringBuilder("x402 Route Configuration Errors:");
    errors.forEach(e -> sb.append("\n  - ").append(e.message()));
    return sb.toString();
  }

  /**
   * The problems.
   *
   * @return the problems
   */
  public List<RouteValidationError> errors() {
    return errors;
  }

  /**
   * Whether every problem may heal once a failed facilitator answers (plan Roles §1b: start, and
   * answer 503 on the affected routes only).
   *
   * @return {@code true} when all problems are retryable
   */
  public boolean onlyAwaitingFacilitators() {
    return !errors.isEmpty() && errors.stream().allMatch(RouteValidationError::retryable);
  }
}
