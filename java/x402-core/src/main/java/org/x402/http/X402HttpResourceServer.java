package org.x402.http;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.lang.System.Logger.Level;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.Executor;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import org.x402.core.FacilitatorClient;
import org.x402.core.FacilitatorResponseException;
import org.x402.core.PaymentFlow;
import org.x402.core.SchemeNetworkServer;
import org.x402.core.SettleException;
import org.x402.core.json.X402Json;
import org.x402.core.server.CompletedSettlement;
import org.x402.core.server.ExtensionValidation;
import org.x402.core.server.FacilitatorCapabilityError;
import org.x402.core.server.FacilitatorRoute;
import org.x402.core.server.PaymentCancellationDispatcher;
import org.x402.core.server.PaymentFlows;
import org.x402.core.server.ResourceConfig;
import org.x402.core.server.ResourceServerExtension;
import org.x402.core.server.RoutingSnapshot;
import org.x402.core.server.ServerHooks.SettlePhase;
import org.x402.core.server.ServerVerifyResult;
import org.x402.core.server.SettlementOverrides;
import org.x402.core.server.SettlementRouting;
import org.x402.core.server.X402ResourceServer;
import org.x402.core.types.AssetAmount;
import org.x402.core.types.PaymentPayload;
import org.x402.core.types.PaymentRequired;
import org.x402.core.types.PaymentRequirements;
import org.x402.core.types.ResourceInfo;
import org.x402.core.types.SettleResponse;
import org.x402.core.types.SupportedKind;
import org.x402.core.utils.JsonValues;
import org.x402.core.utils.Networks;
import org.x402.http.RouteValidationError.Reason;

/**
 * The framework-agnostic HTTP resource server (TS {@code x402HTTPResourceServer}): matches routes,
 * answers 402s, verifies payments and settles them, on top of an {@link X402ResourceServer}.
 *
 * <h2>Lifecycle</h2>
 *
 * <p>The constructor checks transfer methods, payment flows and pins (TS constructor check plus
 * Java pins). {@link #initialize()} syncs the facilitators, validates every route against the new
 * snapshot (TS {@code validateRouteConfiguration} plus Java pin, capability, ambiguity and
 * timeout-budget checks), and publishes snapshot and validation together as one {@link
 * HttpServerState} with a single atomic swap. Every request reads that state once and passes its
 * snapshot to every core call, so it never mixes new routing with an old validation result.
 * {@code initialize()} may be called again to re-sync; callers outside Spring should serialize
 * those calls.
 *
 * <p><b>Skip-handler caution.</b> An after-verify hook may skip the handler; the payment is then
 * settled inline <i>after-handler</i>, exactly as TS. For {@code upfront} flows (which settle only
 * before the handler) that settles nothing, so the response is served unpaid; a warning is logged.
 * Do not combine skip-handler hooks with upfront flows.
 *
 * <h2>Adapter contract (WP5/WP6)</h2>
 *
 * <ol>
 *   <li>Build an {@link HttpRequestContext} with the raw path within the application ({@code ;}
 *       parameters stripped) and, separately, its decoded form; call {@link
 *       #processHttpRequest}.
 *   <li>{@link HttpProcessResult.NoPaymentRequired}: run the handler normally. {@link
 *       HttpProcessResult.PaymentError}: write its response, do not run the handler. {@link
 *       HttpProcessResult.RouteUnavailable}: answer 503 with {@code Retry-After} when retryable,
 *       else 500. A thrown {@link FacilitatorResponseException}: answer 502.
 *   <li>{@link HttpProcessResult.PaymentVerified}: run the handler with its response buffered.
 *       <ul>
 *         <li>If the handler throws, or answers with status ≥ 400: call {@code
 *             cancellationDispatcher().cancel(...)} (reason {@code handler_threw} / {@code
 *             handler_failed}), set {@link #createFailurePathSettlementHeaders} on the response,
 *             remove {@code Settlement-Overrides}, and do not settle (TS {@code
 *             express/src/index.ts:313-371}).
 *         <li>Otherwise call {@link #processSettlement(HttpProcessResult.PaymentVerified,
 *             HttpTransportContext)} with the buffered body and response headers ({@code
 *             Settlement-Overrides} is read from them), then remove {@code Settlement-Overrides}.
 *             On {@link ProcessSettleResult.Success} add its headers and {@code Cache-Control}
 *             {@link #withPrivateCacheControl}, then release the body. On {@link
 *             ProcessSettleResult.Failure} discard the body and write its {@code httpResponse}. A
 *             thrown {@link FacilitatorResponseException} means 502.
 *       </ul>
 * </ol>
 */
public final class X402HttpResourceServer {

  /** TS {@code PAYMENT_REQUIRED_CACHE_CONTROL}. */
  public static final String PAYMENT_REQUIRED_CACHE_CONTROL = "no-store";

  private static final System.Logger LOG =
      System.getLogger(X402HttpResourceServer.class.getName());
  private static final String FALLBACK_PAYWALL = loadFallbackPaywall();
  private static final Map<String, Object> EMPTY_BODY = Map.of();
  private static final Duration CLIENT_BUDGET = X402HttpClient.DEFAULT_REQUEST_TIMEOUT;

  private final X402ResourceServer server;
  private final RouteResolver resolver;
  private final List<ProtectedRequestHook> protectedHooks = new CopyOnWriteArrayList<>();
  private final AtomicReference<HttpServerState> state = new AtomicReference<>();
  private final AtomicBoolean warnedMissingBeforeHandler = new AtomicBoolean();
  private volatile PaywallProvider paywallProvider;

  /**
   * Creates the server and checks what can be checked before any facilitator sync: transfer
   * methods and payment flows of registered schemes, and pins.
   *
   * @param server the core server
   * @param resolver the routes
   * @throws RouteConfigurationError listing every problem found
   */
  public X402HttpResourceServer(X402ResourceServer server, RouteResolver resolver) {
    this.server = Objects.requireNonNull(server, "server");
    this.resolver = Objects.requireNonNull(resolver, "resolver");
    List<RouteValidationError> errors = new ArrayList<>();
    resolver.routes().forEach((key, config) -> validateOptions(key, config, null, errors));
    if (!errors.isEmpty()) {
      throw new RouteConfigurationError(errors);
    }
  }

  /**
   * The core server.
   *
   * @return the server
   */
  public X402ResourceServer server() {
    return server;
  }

  /**
   * The route resolver.
   *
   * @return the resolver
   */
  public RouteResolver resolver() {
    return resolver;
  }

  /**
   * Sets the browser paywall renderer.
   *
   * @param provider the provider
   * @return this server
   */
  public X402HttpResourceServer registerPaywallProvider(PaywallProvider provider) {
    this.paywallProvider = provider;
    return this;
  }

  /**
   * Adds a hook that runs before payment processing of every protected request.
   *
   * @param hook the hook
   * @return this server
   */
  public X402HttpResourceServer onProtectedRequest(ProtectedRequestHook hook) {
    protectedHooks.add(Objects.requireNonNull(hook, "hook"));
    return this;
  }

  /**
   * TS {@code isFatalStartupInitError} ({@code backgroundInit.ts:14-16}): configuration errors that
   * a retry cannot fix.
   *
   * @param error an {@code initialize()} failure
   * @return {@code true} for {@link FacilitatorCapabilityError} and {@link RouteConfigurationError}
   */
  public static boolean isFatalStartupError(Throwable error) {
    return error instanceof FacilitatorCapabilityError || error instanceof RouteConfigurationError;
  }

  // ---------------------------------------------------------------- initialize

  /**
   * Syncs facilitators sequentially, validates, and publishes the new state.
   *
   * @return the published state
   * @throws RouteConfigurationError when any route is invalid (the state is published first)
   * @throws IllegalStateException when no facilitator listed any kind and every route error is
   *     retryable (not fatal)
   */
  public HttpServerState initialize() {
    return publishValidated(server.sync());
  }

  /**
   * Like {@link #initialize()}, querying facilitators in parallel within a total budget.
   *
   * @param budget the total sync budget
   * @param executor runs the {@code /supported} calls
   * @return the published state
   */
  public HttpServerState initialize(Duration budget, Executor executor) {
    return publishValidated(server.sync(budget, executor));
  }

  /**
   * The currently published state.
   *
   * @return the state, or {@code null} before the first {@link #initialize()}
   */
  public HttpServerState state() {
    return state.get();
  }

  private HttpServerState publishValidated(RoutingSnapshot snapshot) {
    List<RouteValidationError> errors = new ArrayList<>();
    List<String> warnings = new ArrayList<>();
    resolver.routes().forEach((key, config) -> {
      warnWildcardBazaar(key, config, warnings);
      validateOptions(key, config, snapshot, errors);
      capabilityProblems(key, config, snapshot, errors);
      checkAmbiguity(key, config, snapshot, errors);
      checkBudget(key, config, snapshot, warnings);
    });
    // Kinds some option uses are checked per option with that option's build facilitator above;
    // a core-level problem matters only for a registered kind no option uses (TS parity: fatal).
    for (X402ResourceServer.CapabilityProblem problem
        : server.facilitatorCapabilityProblems(snapshot)) {
      if (!kindUsed(problem.scheme(), problem.network())) {
        errors.add(new RouteValidationError(null, problem.scheme(), problem.network(),
            Reason.FACILITATOR_CAPABILITY, problem.line(), null, problem.facilitator(), false));
      }
    }
    HttpServerState next = new HttpServerState(snapshot, errors, warnings);
    server.publish(snapshot);
    state.set(next);
    warnings.forEach(w -> LOG.log(Level.WARNING, w));
    if (errors.stream().anyMatch(e -> !e.retryable())) {
      throw new RouteConfigurationError(errors);
    }
    if (!snapshot.hasKinds()) {
      Throwable last = snapshot.failures().values().stream().reduce((a, b) -> b).orElse(null);
      throw new IllegalStateException(
          "Failed to initialize: no supported payment kinds loaded from any facilitator.", last);
    }
    if (!errors.isEmpty()) {
      throw new RouteConfigurationError(errors);
    }
    return next;
  }

  /**
   * TS {@code validateRouteConfiguration} for one route, plus pins. With {@code snapshot == null}
   * (constructor) only methods, flows and unknown pins are checked; missing schemes are skipped.
   */
  private void validateOptions(String key, RouteConfig config, RoutingSnapshot snapshot,
      List<RouteValidationError> errors) {
    List<PaymentOption> options = config.accepts();
    for (int i = 0; i < options.size(); i++) {
      PaymentOption option = options.get(i);
      SchemeNetworkServer scheme = server.getRegisteredScheme(option.network(), option.scheme());
      if (option.facilitator() != null && server.facilitator(option.facilitator()) == null) {
        errors.add(new RouteValidationError(key, option.scheme(), option.network(),
            Reason.UNKNOWN_FACILITATOR, "Route \"" + key + "\" option " + i
                + ": unknown facilitator \"" + option.facilitator() + "\"; known: "
                + String.join(", ", server.facilitatorIdentifiers()), i, option.facilitator(),
            false));
      }
      if (scheme == null) {
        if (snapshot != null) {
          errors.add(new RouteValidationError(key, option.scheme(), option.network(),
              Reason.MISSING_SCHEME, "Route \"" + key + "\": No scheme implementation registered "
                  + "for \"" + option.scheme() + "\" on network \"" + option.network() + "\"", i,
              null, false));
        }
        continue;
      }
      Object method = option.extra() == null ? null : option.extra().get(
          PaymentFlows.ASSET_TRANSFER_METHOD);
      String atm = method instanceof String s ? s : scheme.defaultAssetTransferMethod();
      if (!scheme.paymentFlows().containsKey(atm)) {
        errors.add(new RouteValidationError(key, option.scheme(), option.network(),
            Reason.UNSUPPORTED_ASSET_TRANSFER_METHOD, "Route \"" + key + "\": [x402] Scheme \""
                + scheme.scheme() + "\" does not support assetTransferMethod \"" + atm
                + "\". Supported: " + String.join(", ", scheme.paymentFlows().keySet()) + ".", i,
            null, false));
        continue;
      }
      try {
        PaymentFlows.resolve(scheme, option.extra());
      } catch (IllegalArgumentException e) {
        errors.add(new RouteValidationError(key, option.scheme(), option.network(),
            Reason.UNSUPPORTED_PAYMENT_FLOW, "Route \"" + key + "\": " + e.getMessage(), i, null,
            false));
      }
      if (snapshot == null || (option.facilitator() != null
          && server.facilitator(option.facilitator()) == null)) {
        continue;
      }
      String pin = pin(option);
      if (pin != null) {
        if (snapshot.kindOf(pin, X402ResourceServer.X402_VERSION, option.network(),
            scheme.scheme()) == null) {
          errors.add(new RouteValidationError(key, option.scheme(), option.network(),
              Reason.MISSING_FACILITATOR, "Route \"" + key + "\" option " + i
                  + ": pinned facilitator \"" + pin + "\" does not support scheme \""
                  + option.scheme() + "\" on network \"" + option.network() + "\"", i, pin,
              snapshot.failures().containsKey(pin)));
        }
      } else if (snapshot.supportedKind(X402ResourceServer.X402_VERSION, option.network(),
          option.scheme()) == null) {
        errors.add(new RouteValidationError(key, option.scheme(), option.network(),
            Reason.MISSING_FACILITATOR, "Route \"" + key + "\": Facilitator does not support "
                + "scheme \"" + option.scheme() + "\" on network \"" + option.network() + "\"", i,
            null, !snapshot.failures().isEmpty()));
      }
    }
  }

  private boolean kindUsed(String scheme, String networkKey) {
    return resolver.routes().values().stream().flatMap(c -> c.accepts().stream())
        .anyMatch(o -> o.scheme().equals(scheme)
            && Networks.matchesPattern(networkKey, o.network()));
  }

  /**
   * Whether an error that depends on kind ownership may heal: some facilitator failed and the
   * option is unpinned (a recovered facilitator may own its kind) or its pin is the one that failed.
   */
  private static boolean mayHeal(RoutingSnapshot snapshot, PaymentOption option, String pin) {
    return !snapshot.failures().isEmpty()
        && (option.facilitator() == null || snapshot.failures().containsKey(pin));
  }

  /** Per-option {@code validateFacilitatorSupport} with the build facilitator's kind. */
  private void capabilityProblems(String key, RouteConfig config, RoutingSnapshot snapshot,
      List<RouteValidationError> errors) {
    List<PaymentOption> options = config.accepts();
    for (int i = 0; i < options.size(); i++) {
      PaymentOption option = options.get(i);
      SchemeNetworkServer scheme = server.getRegisteredScheme(option.network(), option.scheme());
      String build = buildFacilitator(option, snapshot);
      if (scheme == null || build == null) {
        continue;
      }
      SupportedKind kind = snapshot.kindOf(build, X402ResourceServer.X402_VERSION,
          option.network(), scheme.scheme());
      if (kind == null) {
        continue;
      }
      List<String> extensions = snapshot.extensions(build);
      String problem = scheme.validateFacilitatorSupport(option.network(), kind, extensions);
      if (problem != null) {
        String line = scheme.scheme() + " on " + option.network() + ": " + problem;
        errors.add(new RouteValidationError(key, option.scheme(), option.network(),
            Reason.FACILITATOR_CAPABILITY, "Route \"" + key + "\" option " + i + ": " + line
                + " (facilitator \"" + build + "\")", i, build,
            mayHeal(snapshot, option, pin(option))));
      }
    }
  }

  /**
   * Plan Roles §1b ambiguity check: two options with a different routing policy whose core fields
   * may be equal and whose {@code extra} is compatible could both match one payment.
   */
  private void checkAmbiguity(String key, RouteConfig config, RoutingSnapshot snapshot,
      List<RouteValidationError> errors) {
    List<PaymentOption> options = config.accepts();
    for (int i = 0; i < options.size(); i++) {
      for (int j = i + 1; j < options.size(); j++) {
        PaymentOption a = options.get(i);
        PaymentOption b = options.get(j);
        if (!knownPin(a) || !knownPin(b)) {
          continue;
        }
        String policyA = policy(a, config, snapshot);
        String policyB = policy(b, config, snapshot);
        if (policyA.equals(policyB) || !mayOverlap(a, b)) {
          continue;
        }
        errors.add(new RouteValidationError(key, a.scheme(), a.network(),
            Reason.AMBIGUOUS_OPTIONS, "Route \"" + key + "\": options " + i + " and " + j
                + " can match the same payment but route to different facilitators ("
                + policyA + " vs " + policyB + "); make a payment term differ (network, asset, "
                + "amount, payTo, maxTimeoutSeconds or a shared extra key) or use the same "
                + "facilitator", i, null,
            mayHeal(snapshot, a, pin(a)) || mayHeal(snapshot, b, pin(b))));
      }
    }
  }

  private boolean knownPin(PaymentOption option) {
    return option.facilitator() == null || server.facilitator(option.facilitator()) != null;
  }

  private String policy(PaymentOption option, RouteConfig config, RoutingSnapshot snapshot) {
    String build = buildFacilitator(option, snapshot);
    String policy = build == null ? "<none>" : "\"" + build + "\"";
    if (config.failover()) {
      policy += option.facilitator() != null ? " pinned" : " unpinned";
    }
    return policy;
  }

  private boolean mayOverlap(PaymentOption a, PaymentOption b) {
    if (!a.scheme().equals(b.scheme()) || !a.network().equals(b.network())
        || a.effectiveMaxTimeoutSeconds() != b.effectiveMaxTimeoutSeconds()) {
      return false;
    }
    if (a.payTo() != null && b.payTo() != null && !a.payTo().equals(b.payTo())) {
      return false;
    }
    AssetAmount priceA = staticPrice(a);
    AssetAmount priceB = staticPrice(b);
    if (priceA != null && priceB != null && (!Objects.equals(priceA.asset(), priceB.asset())
        || !Objects.equals(priceA.amount(), priceB.amount()))) {
      return false;
    }
    SchemeNetworkServer scheme = server.getRegisteredScheme(a.network(), a.scheme());
    List<String> dynamic = scheme == null ? List.of() : scheme.dynamicExtraFields();
    return compatible(JsonValues.omit(wireExtra(scheme, finalExtra(a, priceA)), dynamic),
        JsonValues.omit(wireExtra(scheme, finalExtra(b, priceB)), dynamic));
  }

  /**
   * The {@code extra} as it goes on the wire and is matched: the SDK {@code "default"} transfer
   * method is dropped and a non-authorization flow is announced (decision 096).
   */
  private static Map<String, Object> wireExtra(SchemeNetworkServer scheme,
      Map<String, Object> extra) {
    if (scheme == null) {
      return extra;
    }
    try {
      return PaymentFlows.applyWireExtra(extra, PaymentFlows.resolve(scheme, extra));
    } catch (IllegalArgumentException e) {
      return extra;
    }
  }

  private AssetAmount staticPrice(PaymentOption option) {
    if (option.price() == null) {
      return null;
    }
    SchemeNetworkServer scheme = server.getRegisteredScheme(option.network(), option.scheme());
    if (scheme == null) {
      return null;
    }
    try {
      return scheme.parsePrice(option.price(), option.network());
    } catch (RuntimeException e) {
      return null;
    }
  }

  private static Map<String, Object> finalExtra(PaymentOption option, AssetAmount price) {
    Map<String, Object> extra = new LinkedHashMap<>();
    if (price != null && price.extra() != null) {
      extra.putAll(price.extra());
    }
    if (option.extra() != null) {
      extra.putAll(option.extra());
    }
    return extra;
  }

  @SuppressWarnings("unchecked")
  private static boolean compatible(Map<String, Object> a, Map<String, Object> b) {
    for (Map.Entry<String, Object> e : a.entrySet()) {
      if (!b.containsKey(e.getKey())) {
        continue;
      }
      Object other = b.get(e.getKey());
      if (e.getValue() instanceof Map && other instanceof Map) {
        if (!compatible((Map<String, Object>) e.getValue(), (Map<String, Object>) other)) {
          return false;
        }
      } else if (!JsonValues.deepEqual(e.getValue(), other)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Plan Roles §1b timeout budget: build verify-timeout + (failover ? largest candidate
   * verify-timeout : 0) + n × largest settle timeout of the possible settle targets, where n is 2
   * (one settle and its pending retry) or 4 for escrow, which settles before and after the
   * handler (decision 097).
   */
  private void checkBudget(String key, RouteConfig config, RoutingSnapshot snapshot,
      List<String> warnings) {
    List<PaymentOption> options = config.accepts();
    for (int i = 0; i < options.size(); i++) {
      PaymentOption option = options.get(i);
      String build = knownPin(option) ? buildFacilitator(option, snapshot) : null;
      if (build == null) {
        continue;
      }
      FacilitatorClient buildClient = server.facilitator(build);
      Duration verify = buildClient.verifyTimeout();
      Duration failover = Duration.ZERO;
      Duration settle = buildClient.settleTimeout();
      if (config.failover() && option.facilitator() == null) {
        for (String candidate : candidates(build, option, snapshot)) {
          FacilitatorClient c = server.facilitator(candidate);
          failover = max(failover, c.verifyTimeout());
          settle = max(settle, c.settleTimeout());
        }
      }
      int settles = settlesPerPayment(option);
      Duration worst = verify.plus(failover).plus(settle.multipliedBy(settles));
      if (worst.compareTo(CLIENT_BUDGET) > 0) {
        warnings.add("Route \"" + key + "\" option " + i + ": the worst-case payment path takes "
            + worst.toSeconds() + " s (verify " + verify.toSeconds() + " s + failover verify "
            + failover.toSeconds() + " s + " + settles + " × settle " + settle.toSeconds()
            + " s), above the " + CLIENT_BUDGET.toSeconds() + " s client default timeout");
      }
    }
  }

  private int settlesPerPayment(PaymentOption option) {
    SchemeNetworkServer scheme = server.getRegisteredScheme(option.network(), option.scheme());
    if (scheme == null) {
      return 2;
    }
    try {
      PaymentFlow flow = PaymentFlows.resolve(scheme, finalExtra(option, null)).flow();
      return flow.settleBeforeHandler() && flow.settleAfterHandler() ? 4 : 2;
    } catch (IllegalArgumentException e) {
      return 2;
    }
  }

  private List<String> candidates(String build, PaymentOption option, RoutingSnapshot snapshot) {
    List<String> out = new ArrayList<>();
    SupportedKind built = snapshot.kindOf(build, X402ResourceServer.X402_VERSION,
        option.network(), option.scheme());
    if (built == null) {
      return out;
    }
    for (String id : snapshot.facilitatorIdentifiers()) {
      SupportedKind kind = snapshot.kindOf(id, X402ResourceServer.X402_VERSION, option.network(),
          option.scheme());
      if (!id.equals(build) && kind != null
          && JsonValues.deepEqual(extraOf(kind), extraOf(built))) {
        out.add(id);
      }
    }
    return out;
  }

  private static Map<String, Object> extraOf(SupportedKind kind) {
    return kind.extra() == null ? Map.of() : kind.extra();
  }

  private static Duration max(Duration a, Duration b) {
    return a.compareTo(b) >= 0 ? a : b;
  }

  private void warnWildcardBazaar(String key, RouteConfig config, List<String> warnings) {
    String pathPart = key.contains(" ") ? key.split("\\s+", -1)[1] : key;
    if (pathPart.contains("*") && config.extensions() != null
        && config.extensions().containsKey("bazaar")) {
      warnings.add("[x402] Route \"" + key + "\": Wildcard (*) patterns with bazaar discovery "
          + "extensions will auto-generate parameter names (var1, var2, ...). Consider using "
          + "named parameters instead (e.g. /weather/:city) for better discovery metadata.");
    }
  }

  private String buildFacilitator(PaymentOption option, RoutingSnapshot snapshot) {
    String pin = pin(option);
    if (pin != null) {
      return pin;
    }
    return snapshot.owner(X402ResourceServer.X402_VERSION, option.network(), option.scheme());
  }

  private String pin(PaymentOption option) {
    if (option.facilitator() == null) {
      return null;
    }
    FacilitatorClient client = server.facilitator(option.facilitator());
    return client == null ? null : server.facilitatorIdentifiers().stream()
        .filter(id -> server.facilitator(id) == client).findFirst().orElse(null);
  }

  // ---------------------------------------------------------------- requests

  /**
   * Whether a request needs payment (a route matches).
   *
   * @param context the request
   * @return {@code true} when a route matches
   */
  public boolean requiresPayment(HttpRequestContext context) {
    return resolver.resolve(withMethod(context)) != null;
  }

  /**
   * Processes a request without paywall options.
   *
   * @param context the request
   * @return the result
   * @see #processHttpRequest(HttpRequestContext, PaywallConfig)
   */
  public HttpProcessResult processHttpRequest(HttpRequestContext context) {
    return processHttpRequest(context, null);
  }

  /**
   * TS {@code processHTTPRequest} (:528-755): route match, protected-request hooks, 402 for
   * unpaid requests (paywall HTML for browsers), then match, extension echo check, verify, and
   * for upfront/escrow flows settle before the handler.
   *
   * @param context the request
   * @param paywallConfig paywall options, may be {@code null}
   * @return the result
   * @throws FacilitatorResponseException on a facilitator transport failure (adapter: 502)
   * @throws IllegalStateException when a protected route is hit before {@link #initialize()}
   */
  public HttpProcessResult processHttpRequest(
      HttpRequestContext context, PaywallConfig paywallConfig) {
    HttpRequestContext ctx = withMethod(context);
    RouteMatch match = resolver.resolve(ctx);
    if (match == null) {
      return new HttpProcessResult.NoPaymentRequired();
    }
    HttpServerState current = state.get();
    if (current == null) {
      throw new IllegalStateException("x402: call initialize() before serving protected routes");
    }
    List<RouteValidationError> routeErrors = current.errorsFor(match.key());
    if (!routeErrors.isEmpty()) {
      return new HttpProcessResult.RouteUnavailable(match.key(), routeErrors,
          routeErrors.stream().allMatch(RouteValidationError::retryable));
    }
    RoutingSnapshot snapshot = current.snapshot();
    HttpRequestContext request = ctx.withRoutePattern(match.pattern());
    RouteConfig config = match.config();
    for (ProtectedRequestHook hook : protectedHooks(config)) {
      ProtectedRequestHook.Result result = hook.apply(request, config);
      if (result instanceof ProtectedRequestHook.GrantAccess) {
        return new HttpProcessResult.NoPaymentRequired();
      }
      if (result instanceof ProtectedRequestHook.Abort abort) {
        return new HttpProcessResult.PaymentError(new HttpResponseInstructions(403,
            Map.of("Content-Type", "application/json"), Map.of("error", abort.reason()), false));
      }
    }
    PaymentPayload payload = extractPayment(request.adapter());
    ResourceInfo resource = new ResourceInfo(
        config.resource() != null && !config.resource().isEmpty() ? config.resource()
            : request.url(),
        config.description() == null ? "" : config.description(),
        config.mimeType() == null ? "" : config.mimeType(),
        config.serviceName(), config.tags(), config.iconUrl());
    List<PaymentRequirements> requirements = new ArrayList<>();
    for (PaymentOption option : config.accepts()) {
      ResourceConfig resolved = option.resolve(request);
      requirements.addAll(server.buildPaymentRequirements(resolved, snapshot));
    }
    Map<String, Object> extensions = config.extensions() == null ? null
        : server.enrichExtensions(config.extensions(), request);
    HttpTransportContext transport = new HttpTransportContext(request, null, null);
    // TS schemes read the paid payload from the PAYMENT-SIGNATURE header in the transport
    // context; Java hands it over explicitly on every paid-path 402 (decision 038).
    PaymentRequired required = server.createPaymentRequiredResponse(requirements, resource,
        payload == null ? "Payment required" : null, extensions, transport, payload);
    if (payload == null) {
      HttpResponseBody unpaid = config.unpaidResponseBody() == null ? null
          : config.unpaidResponseBody().create(request);
      return new HttpProcessResult.PaymentError(createHttpResponse(required,
          isWebBrowser(request.adapter()), paywallConfig, config.customPaywallHtml(), unpaid));
    }
    try {
      PaymentRequirements matching = server.findMatchingRequirements(required.accepts(), payload);
      if (matching == null) {
        return error402(requirements, resource, "No matching payment requirements", extensions,
            transport, payload, paywallConfig);
      }
      ExtensionValidation echo = server.validateExtensions(required, payload);
      if (!echo.valid()) {
        return error402(requirements, resource, echo.invalidReason(), extensions, transport,
            payload, paywallConfig);
      }
      PaymentOption option = config.accepts().get(indexOf(required.accepts(), matching));
      FacilitatorRoute route = FacilitatorRoute.of(option.facilitator(), config.failover());
      PaymentFlow flow = server.getPaymentFlow(payload, matching);
      ServerVerifyResult verified = server.verifyPayment(payload, matching, extensions,
          transport, route, snapshot);
      if (!verified.isValid()) {
        return error402(requirements, resource, verified.response().invalidReason(), extensions,
            transport, payload, paywallConfig);
      }
      SettlementRouting routing = new SettlementRouting(route, verified.verifiedBy(), snapshot);
      if (verified.skipHandler() != null) {
        return skipHandler(payload, matching, extensions, transport, routing, verified, flow);
      }
      CompletedSettlement before = null;
      if (flow.settleBeforeHandler()) {
        ProcessSettleResult result = processSettlement(payload, matching, extensions, transport,
            null, null, SettlePhase.BEFORE_HANDLER, routing);
        if (result instanceof ProcessSettleResult.Failure failure) {
          return new HttpProcessResult.PaymentError(failure.httpResponse());
        }
        ProcessSettleResult.Success success = (ProcessSettleResult.Success) result;
        before = new CompletedSettlement(SettlePhase.BEFORE_HANDLER, flow, success.response(),
            success.requirements());
      }
      PaymentCancellationDispatcher dispatcher = server.createPaymentCancellationDispatcher(
          payload, matching, extensions, transport,
          before != null ? List.of(SettlePhase.BEFORE_HANDLER) : List.of(), routing);
      return new HttpProcessResult.PaymentVerified(payload, matching, extensions, before,
          dispatcher, routing, match.key());
    } catch (FacilitatorResponseException e) {
      throw e;
    } catch (RuntimeException e) {
      return error402(requirements, resource,
          e.getMessage() == null ? "Payment verification failed" : e.getMessage(), extensions,
          transport, payload, paywallConfig);
    }
  }

  private HttpProcessResult error402(List<PaymentRequirements> requirements,
      ResourceInfo resource, String error, Map<String, Object> extensions,
      HttpTransportContext transport, PaymentPayload payload, PaywallConfig paywallConfig) {
    PaymentRequired response = server.createPaymentRequiredResponse(requirements, resource, error,
        extensions, transport, payload);
    return new HttpProcessResult.PaymentError(
        createHttpResponse(response, false, paywallConfig, null, null));
  }

  private static int indexOf(List<PaymentRequirements> accepts, PaymentRequirements matching) {
    for (int i = 0; i < accepts.size(); i++) {
      if (accepts.get(i) == matching) {
        return i;
      }
    }
    return accepts.indexOf(matching);
  }

  private HttpProcessResult skipHandler(PaymentPayload payload, PaymentRequirements requirements,
      Map<String, Object> extensions, HttpTransportContext transport, SettlementRouting routing,
      ServerVerifyResult verified, PaymentFlow flow) {
    if (!flow.settleAfterHandler()) {
      LOG.log(Level.WARNING, "[x402] skipHandler on payment flow \"" + flow.wire()
          + "\": the payment was not settled (TS parity: the skip-handler path settles only "
          + "after the handler, and this flow settles before it)");
    }
    ProcessSettleResult result = processSettlement(payload, requirements, extensions, transport,
        null, null, SettlePhase.AFTER_HANDLER, routing);
    if (result instanceof ProcessSettleResult.Failure failure) {
      return new HttpProcessResult.PaymentError(failure.httpResponse());
    }
    String contentType = verified.skipHandler().contentType() != null
        ? verified.skipHandler().contentType() : "application/json";
    Object body = verified.skipHandler().body() != null ? verified.skipHandler().body()
        : EMPTY_BODY;
    Map<String, String> headers = new LinkedHashMap<>();
    headers.put("Content-Type", contentType);
    headers.putAll(result.headers());
    headers.put("Cache-Control", withPrivateCacheControl(null));
    return new HttpProcessResult.PaymentError(new HttpResponseInstructions(200, headers, body,
        contentType.contains("text/html")));
  }

  private List<ProtectedRequestHook> protectedHooks(RouteConfig config) {
    List<ProtectedRequestHook> hooks = new ArrayList<>(protectedHooks);
    Map<String, Object> declared = config.extensions();
    if (declared == null) {
      return hooks;
    }
    for (ResourceServerExtension extension : server.getExtensions()) {
      if (extension instanceof HttpResourceServerExtension http
          && declared.containsKey(extension.key())) {
        Object declaration = declared.get(extension.key());
        hooks.add((ctx, route) -> http.onProtectedRequest(declaration, ctx, route));
      }
    }
    return hooks;
  }

  private static PaymentPayload extractPayment(HttpAdapter adapter) {
    String header = adapter.getHeader(X402Headers.PAYMENT_SIGNATURE);
    if (header == null || header.isEmpty()) {
      return null;
    }
    try {
      return HeaderCodec.decodePaymentSignature(header);
    } catch (IllegalArgumentException e) {
      LOG.log(Level.WARNING, "[x402] Failed to decode PAYMENT-SIGNATURE header: "
          + e.getMessage());
      return null;
    }
  }

  private static boolean isWebBrowser(HttpAdapter adapter) {
    return adapter.getAcceptHeader().contains("text/html")
        && adapter.getUserAgent().contains("Mozilla");
  }

  private HttpResponseInstructions createHttpResponse(PaymentRequired required, boolean browser,
      PaywallConfig paywallConfig, String customHtml, HttpResponseBody unpaid) {
    int status = "permit2_allowance_required".equals(required.error()) ? 412 : 402;
    Map<String, String> headers = new LinkedHashMap<>();
    if (browser) {
      headers.put("Content-Type", "text/html");
      headers.put(X402Headers.PAYMENT_REQUIRED, HeaderCodec.encodePaymentRequired(required));
      headers.put("Cache-Control", PAYMENT_REQUIRED_CACHE_CONTROL);
      return new HttpResponseInstructions(status, headers,
          paywallHtml(required, paywallConfig, customHtml), true);
    }
    headers.put("Content-Type", unpaid != null ? unpaid.contentType() : "application/json");
    headers.put(X402Headers.PAYMENT_REQUIRED, HeaderCodec.encodePaymentRequired(required));
    headers.put("Cache-Control", PAYMENT_REQUIRED_CACHE_CONTROL);
    return new HttpResponseInstructions(status, headers, unpaid != null ? unpaid.body()
        : EMPTY_BODY, false);
  }

  private String paywallHtml(PaymentRequired required, PaywallConfig config, String custom) {
    if (custom != null) {
      return custom;
    }
    PaywallProvider provider = paywallProvider;
    return provider != null ? provider.generateHtml(required, config) : FALLBACK_PAYWALL;
  }

  private static String loadFallbackPaywall() {
    try (InputStream in = X402HttpResourceServer.class.getResourceAsStream(
        "/org/x402/http/fallback-paywall.html")) {
      return new String(Objects.requireNonNull(in, "fallback paywall").readAllBytes(),
          StandardCharsets.UTF_8);
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }

  private static HttpRequestContext withMethod(HttpRequestContext context) {
    return context.method() != null ? context
        : context.withMethod(context.adapter().getMethod());
  }

  // ---------------------------------------------------------------- settlement

  /**
   * Settles a verified payment after the handler, with the facilitator routing it was verified
   * with (settle and the pending retry go to {@code verifiedBy}, else the pin, else the build
   * facilitator).
   *
   * @param verified the result of {@link #processHttpRequest}
   * @param transport the request with the handler's buffered body and response headers
   * @return the result
   * @throws FacilitatorResponseException on a facilitator transport failure (adapter: 502)
   */
  public ProcessSettleResult processSettlement(
      HttpProcessResult.PaymentVerified verified, HttpTransportContext transport) {
    return processSettlement(verified.paymentPayload(), verified.paymentRequirements(),
        verified.declaredExtensions(), transport, null, verified.beforeHandlerSettlement(), null,
        verified.routing());
  }

  /**
   * TS {@code processSettlement} (:757-924). Flows that do not settle after the handler echo the
   * before-handler settlement. {@code Settlement-Overrides} is read from the response headers when
   * no overrides are given; a malformed value is ignored.
   *
   * @param payload the payment
   * @param requirements the requirements
   * @param declaredExtensions the declarations, may be {@code null}
   * @param transport the transport context, may be {@code null}
   * @param overrides explicit overrides, may be {@code null}
   * @param beforeHandlerSettlement the before-handler settlement, may be {@code null}
   * @param phase the phase, {@code null} for after-handler
   * @param routing where to settle
   * @return the result
   * @throws FacilitatorResponseException on a facilitator transport failure
   */
  public ProcessSettleResult processSettlement(
      PaymentPayload payload,
      PaymentRequirements requirements,
      Map<String, Object> declaredExtensions,
      HttpTransportContext transport,
      SettlementOverrides overrides,
      CompletedSettlement beforeHandlerSettlement,
      SettlePhase phase,
      SettlementRouting routing) {
    PaymentFlow flow = beforeHandlerSettlement != null ? beforeHandlerSettlement.flow()
        : server.getPaymentFlow(payload, requirements);
    if (phase != SettlePhase.BEFORE_HANDLER && !flow.settleAfterHandler()) {
      if (beforeHandlerSettlement != null) {
        return new ProcessSettleResult.Success(beforeHandlerSettlement.result(),
            createSettlementHeaders(beforeHandlerSettlement.result()),
            beforeHandlerSettlement.requirements());
      }
      if (flow.settleBeforeHandler() && warnedMissingBeforeHandler.compareAndSet(false, true)) {
        LOG.log(Level.WARNING, "[x402] Payment flow \"" + flow.wire() + "\" settles before the "
            + "handler, but processSettlement was called without beforeHandlerSettlement from "
            + "processHttpRequest. Skipping after-handler settle. Pass that settle result to echo "
            + "the before-handler PAYMENT-RESPONSE.");
      }
      return new ProcessSettleResult.Success(SettleResponse.success("", requirements.network(),
          null), Map.of(), requirements);
    }
    SettlePhase resolvedPhase = phase == null ? SettlePhase.AFTER_HANDLER : phase;
    try {
      SettlementOverrides resolved = overrides != null ? overrides : overridesFrom(transport);
      SettleResponse response = server.settlePayment(payload, requirements, declaredExtensions,
          transport, resolved, resolvedPhase,
          routing == null ? SettlementRouting.auto() : routing);
      if (!response.success()) {
        String reason = response.errorReason() == null || response.errorReason().isEmpty()
            ? "Settlement failed" : response.errorReason();
        String message = response.errorMessage() == null || response.errorMessage().isEmpty()
            ? reason : response.errorMessage();
        SettleResponse failure = new SettleResponse(false, reason, message, response.payer(),
            response.transaction(), response.network(), response.amount(), response.extensions(),
            response.extensionResponses(), response.extra());
        return failure(failure, createSettlementHeaders(response), transport);
      }
      return new ProcessSettleResult.Success(response, createSettlementHeaders(response),
          requirements);
    } catch (FacilitatorResponseException e) {
      throw e;
    } catch (SettleException e) {
      String reason = e.response().errorReason() == null ? e.getMessage()
          : e.response().errorReason();
      String message = e.response().errorMessage() == null ? reason : e.response().errorMessage();
      SettleResponse failure = new SettleResponse(false, reason, message, e.response().payer(),
          e.response().transaction() == null ? "" : e.response().transaction(),
          e.response().network(), null, null, null, null);
      return failure(failure, createSettlementHeaders(failure), transport);
    } catch (RuntimeException e) {
      String reason = e.getMessage() == null ? "Settlement failed" : e.getMessage();
      SettleResponse failure = new SettleResponse(false, reason, reason, null, "",
          requirements.network(), null, null, null, null);
      return failure(failure, createSettlementHeaders(failure), transport);
    }
  }

  private static SettlementOverrides overridesFrom(HttpTransportContext transport) {
    if (transport == null || transport.responseHeaders() == null) {
      return null;
    }
    String key = X402Headers.SETTLEMENT_OVERRIDES.toLowerCase(Locale.ROOT);
    String raw = transport.responseHeaders().entrySet().stream()
        .filter(e -> e.getKey() != null && e.getKey().toLowerCase(Locale.ROOT).equals(key))
        .map(Map.Entry::getValue).findFirst().orElse(null);
    if (raw == null || raw.isEmpty()) {
      return null;
    }
    try {
      return X402Json.read(raw, SettlementOverrides.class);
    } catch (IllegalArgumentException e) {
      return null;
    }
  }

  private ProcessSettleResult failure(SettleResponse failure, Map<String, String> headers,
      HttpTransportContext transport) {
    HttpResponseBody custom = null;
    if (transport != null && transport.request() != null) {
      RouteMatch match = resolver.resolve(withMethod(transport.request()));
      if (match != null && match.config().settlementFailedResponseBody() != null) {
        custom = match.config().settlementFailedResponseBody().create(transport.request(),
            failure);
      }
    }
    String contentType = custom != null ? custom.contentType() : "application/json";
    Map<String, String> responseHeaders = new LinkedHashMap<>();
    responseHeaders.put("Content-Type", contentType);
    responseHeaders.putAll(headers);
    responseHeaders.put("Cache-Control", PAYMENT_REQUIRED_CACHE_CONTROL);
    return new ProcessSettleResult.Failure(failure, headers, new HttpResponseInstructions(402,
        responseHeaders, custom != null ? custom.body() : EMPTY_BODY,
        contentType.contains("text/html")));
  }

  /**
   * TS {@code createSettlementHeaders}: the {@code PAYMENT-RESPONSE} header.
   *
   * @param response the settlement
   * @return the headers
   */
  public Map<String, String> createSettlementHeaders(SettleResponse response) {
    return Map.of(X402Headers.PAYMENT_RESPONSE, HeaderCodec.encodePaymentResponse(response));
  }

  /**
   * TS {@code createCompletedSettlementHeaders}: the receipt of a completed settle plus a private
   * {@code Cache-Control}.
   *
   * @param settlement the settlement
   * @param existingCacheControl the response's {@code Cache-Control}, may be {@code null}
   * @return the headers
   */
  public Map<String, String> createCompletedSettlementHeaders(
      CompletedSettlement settlement, String existingCacheControl) {
    Map<String, String> headers = new LinkedHashMap<>(createSettlementHeaders(settlement.result()));
    headers.put("Cache-Control", withPrivateCacheControl(existingCacheControl));
    return headers;
  }

  /**
   * TS {@code createFailurePathSettlementHeaders} (:961): the receipt to send when the handler
   * failed after the payment was verified (cancel result, else the before-handler settlement).
   *
   * @param cancelSettlement the cancel dispatcher's result, may be {@code null}
   * @param beforeHandlerSettlement the before-handler settlement, may be {@code null}
   * @param payload the payment, for escrow recovery fields
   * @param existingCacheControl the response's {@code Cache-Control}, may be {@code null}
   * @return the headers, or {@code null} when there is no receipt
   */
  public Map<String, String> createFailurePathSettlementHeaders(
      SettleResponse cancelSettlement, CompletedSettlement beforeHandlerSettlement,
      PaymentPayload payload, String existingCacheControl) {
    SettleResponse receipt = PaymentFlows.resolveFailurePathSettlement(cancelSettlement,
        beforeHandlerSettlement, payload);
    if (receipt == null) {
      return null;
    }
    Map<String, String> headers = new LinkedHashMap<>(createSettlementHeaders(receipt));
    headers.put("Cache-Control", withPrivateCacheControl(existingCacheControl));
    return headers;
  }

  /**
   * TS {@code withPrivateCacheControl}: adds {@code private} unless present.
   *
   * @param value the current {@code Cache-Control}, may be {@code null}
   * @return the value with {@code private}
   */
  public static String withPrivateCacheControl(String value) {
    if (value == null || value.isEmpty()) {
      return "private";
    }
    for (String directive : value.split(",", -1)) {
      if (directive.strip().toLowerCase(Locale.ROOT).equals("private")) {
        return value;
      }
    }
    return value + ", private";
  }
}
