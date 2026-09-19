export const SECURITY_HEADERS_JAVA = `package com.example.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
public class SecurityHeadersFilter extends OncePerRequestFilter {
  @Override
  protected void doFilterInternal(
      HttpServletRequest request, HttpServletResponse response, FilterChain chain)
      throws ServletException, IOException {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    chain.doFilter(request, response);
  }
}
`;

export const CORS_JAVA = `package com.example.security;

import java.util.Arrays;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class CorsConfig implements WebMvcConfigurer {
  @Value("\${ALLOWED_ORIGINS:*}")
  private String allowedOrigins;

  @Override
  public void addCorsMappings(CorsRegistry registry) {
    List<String> origins = Arrays.stream(allowedOrigins.split(",")).map(String::trim).toList();
    registry
        .addMapping("/**")
        .allowedOrigins(origins.toArray(String[]::new))
        .allowedMethods("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS")
        .allowedHeaders("Content-Type", "Authorization")
        .maxAge(86400);
  }
}
`;

export const RATE_LIMIT_JAVA = `package com.example.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
public class RateLimitFilter extends OncePerRequestFilter {
  private static final int WINDOW_SECONDS = 900;
  private static final int MAX_REQUESTS = 100;
  private final Map<String, List<Instant>> hits = new ConcurrentHashMap<>();

  @Override
  protected void doFilterInternal(
      HttpServletRequest request, HttpServletResponse response, FilterChain chain)
      throws ServletException, IOException {
    String key = request.getRemoteAddr();
    Instant now = Instant.now();
    List<Instant> window = new ArrayList<>(hits.getOrDefault(key, List.of()));
    window.removeIf(t -> t.isBefore(now.minusSeconds(WINDOW_SECONDS)));
    if (window.size() >= MAX_REQUESTS) {
      response.setStatus(HttpStatus.TOO_MANY_REQUESTS.value());
      return;
    }
    window.add(now);
    hits.put(key, window);
    chain.doFilter(request, response);
  }
}
`;

export const LOGGER_JAVA = `package com.example.logging;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

@Component
public class AppLogger {
  private static final Logger log = LoggerFactory.getLogger(AppLogger.class);

  public void info(String message) {
    log.info(message);
  }

  public void warn(String message) {
    log.warn(message);
  }

  public void error(String message, Throwable error) {
    log.error(message, error);
  }
}
`;

export const SENTRY_INIT_JAVA = `# Add to src/main/resources/application.properties
sentry.dsn=\${SENTRY_DSN}
sentry.traces-sample-rate=0.1
sentry.environment=\${SPRING_PROFILES_ACTIVE:production}
`;

export const HEALTH_CHECK_JAVA = `package com.example.health;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import java.util.Map;

@RestController
public class HealthController {
  @GetMapping("/health")
  public Map<String, Object> health() {
    return Map.of("status", "ok");
  }
}
`;
