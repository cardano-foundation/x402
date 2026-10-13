package org.x402.spring.web.servlet;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.function.Supplier;
import org.springframework.core.ResolvableType;
import org.springframework.core.annotation.AnnotatedElementUtils;
import org.springframework.http.HttpEntity;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.mvc.method.RequestMappingInfoHandlerMapping;
import org.springframework.web.servlet.mvc.method.annotation.ResponseBodyEmitter;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;
import org.x402.spring.offer.HandlerMethodSource;

/** The WebMvc handler methods ({@link RequestMappingInfoHandlerMapping}s). */
public final class ServletHandlerMethodSource implements HandlerMethodSource {

  private final Supplier<List<RequestMappingInfoHandlerMapping>> mappings;

  /**
   * Creates the source.
   *
   * @param mappings the request mappings, read when {@link #mappings()} is called
   */
  public ServletHandlerMethodSource(Supplier<List<RequestMappingInfoHandlerMapping>> mappings) {
    this.mappings = mappings;
  }

  @Override
  public List<Mapping> mappings() {
    List<Mapping> out = new ArrayList<>();
    for (RequestMappingInfoHandlerMapping mapping : mappings.get()) {
      mapping.getHandlerMethods().forEach((info, handler) -> {
        Set<String> methods = new LinkedHashSet<>();
        info.getMethodsCondition().getMethods().forEach(m -> methods.add(m.name()));
        out.add(new Mapping(handler, info.getPatternValues(), methods));
      });
    }
    return out;
  }

  @Override
  public boolean isStreaming(HandlerMethod handlerMethod) {
    return isStreamingHandler(handlerMethod);
  }

  /**
   * Whether a WebMvc handler streams: {@code SseEmitter}, {@code ResponseBodyEmitter}, {@code
   * StreamingResponseBody} (also inside {@code ResponseEntity}), or {@code text/event-stream}
   * produces.
   *
   * @param handlerMethod the handler
   * @return {@code true} for a streaming handler
   */
  public static boolean isStreamingHandler(HandlerMethod handlerMethod) {
    Class<?> type = handlerMethod.getReturnType().getParameterType();
    if (streamingType(type)) {
      return true;
    }
    if (HttpEntity.class.isAssignableFrom(type)) {
      Class<?> body = ResolvableType.forMethodReturnType(handlerMethod.getMethod())
          .as(HttpEntity.class).getGeneric(0).resolve();
      if (body != null && streamingType(body)) {
        return true;
      }
    }
    return producesEventStream(
        AnnotatedElementUtils.findMergedAnnotation(handlerMethod.getMethod(), RequestMapping.class))
        || producesEventStream(AnnotatedElementUtils.findMergedAnnotation(
            handlerMethod.getBeanType(), RequestMapping.class));
  }

  private static boolean streamingType(Class<?> type) {
    return ResponseBodyEmitter.class.isAssignableFrom(type)
        || StreamingResponseBody.class.isAssignableFrom(type);
  }

  static boolean producesEventStream(RequestMapping mapping) {
    return mapping != null && Arrays.stream(mapping.produces())
        .anyMatch(p -> p.toLowerCase(java.util.Locale.ROOT).startsWith(MediaType.TEXT_EVENT_STREAM_VALUE));
  }
}
