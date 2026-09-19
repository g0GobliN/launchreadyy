export const MIDDLEWARE_GO = `package middleware

import (
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

func Chain(h http.Handler, wrappers ...func(http.Handler) http.Handler) http.Handler {
	for i := len(wrappers) - 1; i >= 0; i-- {
		h = wrappers[i](h)
	}
	return h
}

func SecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		next.ServeHTTP(w, r)
	})
}

func CORS(next http.Handler) http.Handler {
	allowed := strings.Split(os.Getenv("ALLOWED_ORIGINS"), ",")
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		}
		_ = allowed
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

export var (
	rateMu   sync.Mutex
	rateHits = map[string][]time.Time{}
)

func RateLimit(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := r.RemoteAddr
		if !allowRate(key) {
			http.Error(w, "Too many requests", http.StatusTooManyRequests)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func allowRate(key string) bool {
	rateMu.Lock()
	defer rateMu.Unlock()
	now := time.Now()
	window := make([]time.Time, 0, len(rateHits[key]))
	for _, t := range rateHits[key] {
		if now.Sub(t) < 15*time.Minute {
			window = append(window, t)
		}
	}
	window = append(window, now)
	rateHits[key] = window
	return len(window) <= 100
}

func RequestLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		log.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(start))
	})
}

func isHTTPS(r *http.Request) bool {
	if proto := r.Header.Get("X-Forwarded-Proto"); proto != "" {
		first := strings.TrimSpace(strings.Split(proto, ",")[0])
		return strings.EqualFold(first, "https")
	}
	return r.TLS != nil
}

func HTTPSRedirect(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !isHTTPS(r) {
			target := "https://" + r.Host + r.URL.RequestURI()
			http.Redirect(w, r, target, http.StatusMovedPermanently)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func secureCookieString(raw string) string {
	parts := strings.Split(raw, ";")
	hasSecure, hasHttpOnly, hasSameSite := false, false, false
	for _, p := range parts[1:] {
		attr := strings.ToLower(strings.TrimSpace(p))
		if attr == "secure" {
			hasSecure = true
		}
		if attr == "httponly" {
			hasHttpOnly = true
		}
		if strings.HasPrefix(attr, "samesite") {
			hasSameSite = true
		}
	}
	if !hasHttpOnly {
		raw += "; HttpOnly"
	}
	if !hasSecure {
		raw += "; Secure"
	}
	if !hasSameSite {
		raw += "; SameSite=Lax"
	}
	return raw
}

type cookieResponseWriter struct {
	http.ResponseWriter
	wroteHeader bool
}

func (w *cookieResponseWriter) fixCookies() {
	cookies := w.Header().Values("Set-Cookie")
	if len(cookies) == 0 {
		return
	}
	w.Header().Del("Set-Cookie")
	for _, c := range cookies {
		w.Header().Add("Set-Cookie", secureCookieString(c))
	}
}

func (w *cookieResponseWriter) WriteHeader(code int) {
	if !w.wroteHeader {
		w.fixCookies()
		w.wroteHeader = true
	}
	w.ResponseWriter.WriteHeader(code)
}

func (w *cookieResponseWriter) Write(b []byte) (int, error) {
	if !w.wroteHeader {
		w.fixCookies()
		w.wroteHeader = true
	}
	return w.ResponseWriter.Write(b)
}

func SecureCookies(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		next.ServeHTTP(&cookieResponseWriter{ResponseWriter: w}, r)
	})
}
`;

export const MIDDLEWARE_GIN_GO = `package middleware

import (
	"log"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

export var (
	ginRateMu   sync.Mutex
	ginRateHits = map[string][]time.Time{}
)

func GinSecurityHeaders() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("X-Frame-Options", "DENY")
		c.Header("Referrer-Policy", "strict-origin-when-cross-origin")
		c.Next()
	}
}

func GinCORS() gin.HandlerFunc {
	allowed := strings.Split(os.Getenv("ALLOWED_ORIGINS"), ",")
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		if origin != "" {
			c.Header("Access-Control-Allow-Origin", origin)
			c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			c.Header("Access-Control-Allow-Headers", "Content-Type, Authorization")
		}
		_ = allowed
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	}
}

func GinRateLimit() gin.HandlerFunc {
	return func(c *gin.Context) {
		key := c.ClientIP()
		if !ginAllowRate(key) {
			c.AbortWithStatusJSON(429, gin.H{"error": "Too many requests"})
			return
		}
		c.Next()
	}
}

func ginAllowRate(key string) bool {
	ginRateMu.Lock()
	defer ginRateMu.Unlock()
	now := time.Now()
	window := make([]time.Time, 0, len(ginRateHits[key]))
	for _, t := range ginRateHits[key] {
		if now.Sub(t) < 15*time.Minute {
			window = append(window, t)
		}
	}
	window = append(window, now)
	ginRateHits[key] = window
	return len(window) <= 100
}

func GinRequestLogger() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		log.Printf("%s %s %s", c.Request.Method, c.Request.URL.Path, time.Since(start))
	}
}

func ginIsHTTPS(c *gin.Context) bool {
	if proto := c.GetHeader("X-Forwarded-Proto"); proto != "" {
		first := strings.TrimSpace(strings.Split(proto, ",")[0])
		return strings.EqualFold(first, "https")
	}
	return c.Request.TLS != nil
}

func GinHTTPSRedirect() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !ginIsHTTPS(c) {
			target := "https://" + c.Request.Host + c.Request.URL.RequestURI()
			c.Redirect(301, target)
			c.Abort()
			return
		}
		c.Next()
	}
}

func ginSecureCookieString(raw string) string {
	parts := strings.Split(raw, ";")
	hasSecure, hasHttpOnly, hasSameSite := false, false, false
	for _, p := range parts[1:] {
		attr := strings.ToLower(strings.TrimSpace(p))
		if attr == "secure" {
			hasSecure = true
		}
		if attr == "httponly" {
			hasHttpOnly = true
		}
		if strings.HasPrefix(attr, "samesite") {
			hasSameSite = true
		}
	}
	if !hasHttpOnly {
		raw += "; HttpOnly"
	}
	if !hasSecure {
		raw += "; Secure"
	}
	if !hasSameSite {
		raw += "; SameSite=Lax"
	}
	return raw
}

type ginCookieWriter struct {
	gin.ResponseWriter
	wroteHeader bool
}

func (w *ginCookieWriter) fixCookies() {
	cookies := w.Header().Values("Set-Cookie")
	if len(cookies) == 0 {
		return
	}
	w.Header().Del("Set-Cookie")
	for _, c := range cookies {
		w.Header().Add("Set-Cookie", ginSecureCookieString(c))
	}
}

func (w *ginCookieWriter) WriteHeader(code int) {
	if !w.wroteHeader {
		w.fixCookies()
		w.wroteHeader = true
	}
	w.ResponseWriter.WriteHeader(code)
}

func (w *ginCookieWriter) WriteHeaderNow() {
	if !w.wroteHeader {
		w.fixCookies()
		w.wroteHeader = true
	}
	w.ResponseWriter.WriteHeaderNow()
}

func (w *ginCookieWriter) Write(b []byte) (int, error) {
	if !w.wroteHeader {
		w.fixCookies()
		w.wroteHeader = true
	}
	return w.ResponseWriter.Write(b)
}

func GinSecureCookies() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Writer = &ginCookieWriter{ResponseWriter: c.Writer}
		c.Next()
	}
}
`;

export const SENTRY_INIT_GO = `package sentry

import (
\t"os"

\t"github.com/getsentry/sentry-go"
)

func Init() error {
\treturn sentry.Init(sentry.ClientOptions{
\t\tDsn:              os.Getenv("SENTRY_DSN"),
\t\tEnvironment:      os.Getenv("APP_ENV"),
\t\tRelease:          os.Getenv("APP_VERSION"),
\t\tTracesSampleRate: 0.1,
\t})
}
`;

export const HEALTH_CHECK_GO = `package health

import (
\t"encoding/json"
\t"net/http"
\t"time"
)

export var startTime = time.Now()

// Handler returns a JSON health response.
// Register it: mux.HandleFunc("/health", health.Handler)
func Handler(w http.ResponseWriter, r *http.Request) {
\tw.Header().Set("Content-Type", "application/json")
\tjson.NewEncoder(w).Encode(map[string]any{
\t\t"status": "ok",
\t\t"uptime": time.Since(startTime).String(),
\t})
}
`;
