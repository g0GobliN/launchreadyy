export const SECURITY_HEADERS_KOTLIN = `package com.example.security

import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.stereotype.Component
import org.springframework.web.filter.OncePerRequestFilter

@Component
class SecurityHeadersFilter : OncePerRequestFilter() {
    override fun doFilterInternal(
        request: HttpServletRequest,
        response: HttpServletResponse,
        chain: FilterChain,
    ) {
        response.setHeader("X-Content-Type-Options", "nosniff")
        response.setHeader("X-Frame-Options", "DENY")
        response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin")
        response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        chain.doFilter(request, response)
    }
}
`;

export const CORS_KOTLIN = `package com.example.security

import org.springframework.beans.factory.annotation.Value
import org.springframework.context.annotation.Configuration
import org.springframework.web.servlet.config.annotation.CorsRegistry
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer

@Configuration
class CorsConfig : WebMvcConfigurer {
    @Value("\${ALLOWED_ORIGINS:*}")
    private lateinit var allowedOrigins: String

    override fun addCorsMappings(registry: CorsRegistry) {
        val origins = allowedOrigins.split(",").map { it.trim() }.toTypedArray()
        registry.addMapping("/**")
            .allowedOrigins(*origins)
            .allowedMethods("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS")
            .allowedHeaders("Content-Type", "Authorization")
            .maxAge(86400)
    }
}
`;

export const RATE_LIMIT_KOTLIN = `package com.example.security

import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import java.time.Instant
import java.util.concurrent.ConcurrentHashMap
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Component
import org.springframework.web.filter.OncePerRequestFilter

@Component
class RateLimitFilter : OncePerRequestFilter() {
    private val windowSeconds = 900L
    private val maxRequests = 100
    private val hits = ConcurrentHashMap<String, MutableList<Instant>>()

    override fun doFilterInternal(
        request: HttpServletRequest,
        response: HttpServletResponse,
        chain: FilterChain,
    ) {
        val key = request.remoteAddr
        val now = Instant.now()
        val window = hits.getOrDefault(key, mutableListOf())
        window.removeIf { it.isBefore(now.minusSeconds(windowSeconds)) }
        if (window.size >= maxRequests) {
            response.status = HttpStatus.TOO_MANY_REQUESTS.value()
            return
        }
        window.add(now)
        hits[key] = window
        chain.doFilter(request, response)
    }
}
`;

export const LOGGER_KOTLIN = `package com.example.logging

import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component

@Component
class AppLogger {
    private val log = LoggerFactory.getLogger(AppLogger::class.java)

    fun info(message: String) = log.info(message)

    fun warn(message: String) = log.warn(message)

    fun error(message: String, error: Throwable) = log.error(message, error)
}
`;

export const HEALTH_CHECK_KOTLIN = `package com.example.health

import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RestController

@RestController
class HealthController {
    @GetMapping("/health")
    fun health(): Map<String, Any> = mapOf("status" to "ok")
}
`;
