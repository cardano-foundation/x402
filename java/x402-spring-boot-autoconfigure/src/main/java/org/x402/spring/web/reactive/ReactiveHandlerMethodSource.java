package org.x402.spring.web.reactive;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.function.Supplier;
import org.springframework.core.ResolvableType;
import org.springframework.core.annotation.AnnotatedElementUtils;
import org.springframework.http.MediaType;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.reactive.result.method.RequestMappingInfoHandlerMapping;
import org.springframework.web.util.pattern.PathPattern;
import org.x402.spring.offer.HandlerMethodSource;
import reactor.core.publisher.Flux;

/** The WebFlux handler methods (reactive {@link RequestMappingInfoHandlerMapping}s). */
public final class ReactiveHandlerMethodSource implements HandlerMethodSource {

  private static final List<String> STREAMING_TYPES = List.of(
      MediaType.TEXT_EVENT_STREAM_VALUE, MediaType.APPLICATION_NDJSON_VALUE,
      "application/stream+json");

  private final Supplier<List<RequestMappingInfoHandlerMapping>> mappings;

  /**
   * Creates the source.
   *
   * @param mappings the request mappings, read when {@link #mappings()} is called
   */
  public ReactiveHandlerMethodSource(Supplier<List<RequestMappingInfoHandlerMapping>> mappings) {
    this.mappings = mappings;
  }

  @Override
  public List<Mapping> mappings() {
    List<Mapping> out = new ArrayList<>();
    for (RequestMappingInfoHandlerMapping mapping : mappings.get()) {
      mapping.getHandlerMethods().forEach((info, handler) -> {
        Set<String> patterns = new LinkedHashSet<>();
        for (PathPattern p : info.getPatternsCondition().getPatterns()) {
          patterns.add(p.getPatternString());
        }
        Set<String> methods = new LinkedHashSet<>();
        info.getMethodsCondition().getMethods().forEach(m -> methods.add(m.name()));
        out.add(new Mapping(handler, patterns, methods));
      });
    }
    return out;
  }

  @Override
  public boolean isStreaming(HandlerMethod handlerMethod) {
    return isStreamingHandler(handlerMethod);
  }

  /**
   * Whether a WebFlux handler streams: {@code text/event-stream}, NDJSON or {@code
   * application/stream+json} produces, or a {@code Flux<ServerSentEvent>} return type.
   *
   * @param handlerMethod the handler
   * @return {@code true} for a streaming handler
   */
  public static boolean isStreamingHandler(HandlerMethod handlerMethod) {
    ResolvableType type = ResolvableType.forMethodReturnType(handlerMethod.getMethod());
    Class<?> raw = type.resolve(Object.class);
    if (Flux.class.isAssignableFrom(raw)) {
      Class<?> element = type.as(Flux.class).getGeneric(0).resolve();
      if (element != null && ServerSentEvent.class.isAssignableFrom(element)) {
        return true;
      }
    }
    return producesStream(AnnotatedElementUtils.findMergedAnnotation(handlerMethod.getMethod(),
        RequestMapping.class))
        || producesStream(AnnotatedElementUtils.findMergedAnnotation(handlerMethod.getBeanType(),
            RequestMapping.class));
  }

  private static boolean producesStream(RequestMapping mapping) {
    return mapping != null && Arrays.stream(mapping.produces())
        .map(p -> p.toLowerCase(Locale.ROOT))
        .anyMatch(p -> STREAMING_TYPES.stream().anyMatch(p::startsWith));
  }
}
