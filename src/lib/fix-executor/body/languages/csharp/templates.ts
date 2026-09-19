export const SECURITY_HEADERS_CSHARP = `namespace App.Middleware;

public class SecurityHeadersMiddleware
{
    private readonly RequestDelegate _next;

    public SecurityHeadersMiddleware(RequestDelegate next) => _next = next;

    public async Task InvokeAsync(HttpContext context)
    {
        context.Response.Headers["X-Content-Type-Options"] = "nosniff";
        context.Response.Headers["X-Frame-Options"] = "DENY";
        context.Response.Headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
        context.Response.Headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()";
        await _next(context);
    }
}
`;

export const CORS_CSHARP = `namespace App.Middleware;

public class CorsMiddleware
{
    private readonly RequestDelegate _next;
    private readonly string[] _allowedOrigins;

    public CorsMiddleware(RequestDelegate next, IConfiguration config)
    {
        _next = next;
        _allowedOrigins = (config["ALLOWED_ORIGINS"] ?? "*").Split(',', StringSplitOptions.TrimEntries);
    }

    public async Task InvokeAsync(HttpContext context)
    {
        var origin = context.Request.Headers.Origin.ToString();
        if (!string.IsNullOrEmpty(origin) && (_allowedOrigins.Contains("*") || _allowedOrigins.Contains(origin)))
        {
            context.Response.Headers["Access-Control-Allow-Origin"] = origin;
            context.Response.Headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS";
            context.Response.Headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization";
        }
        if (context.Request.Method == HttpMethods.Options)
        {
            context.Response.StatusCode = StatusCodes.Status204NoContent;
            return;
        }
        await _next(context);
    }
}
`;

export const RATE_LIMIT_CSHARP = `namespace App.Middleware;

public class RateLimitMiddleware
{
    private readonly RequestDelegate _next;
    private static readonly Dictionary<string, List<DateTime>> Hits = new();
    private const int WindowSeconds = 900;
    private const int MaxRequests = 100;

    public RateLimitMiddleware(RequestDelegate next) => _next = next;

    public async Task InvokeAsync(HttpContext context)
    {
        var key = context.Connection.RemoteIpAddress?.ToString() ?? "unknown";
        var now = DateTime.UtcNow;
        lock (Hits)
        {
            if (!Hits.TryGetValue(key, out var window)) window = Hits[key] = new List<DateTime>();
            window.RemoveAll(t => (now - t).TotalSeconds > WindowSeconds);
            if (window.Count >= MaxRequests)
            {
                context.Response.StatusCode = StatusCodes.Status429TooManyRequests;
                return;
            }
            window.Add(now);
        }
        await _next(context);
    }
}
`;

export const LOGGER_CSHARP = `namespace App.Middleware;

public class RequestLoggerMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<RequestLoggerMiddleware> _logger;

    public RequestLoggerMiddleware(RequestDelegate next, ILogger<RequestLoggerMiddleware> logger)
    {
        _next = next;
        _logger = logger;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        var started = DateTime.UtcNow;
        await _next(context);
        var duration = (DateTime.UtcNow - started).TotalMilliseconds;
        _logger.LogInformation("{Method} {Path} {Status} {Duration}ms",
            context.Request.Method, context.Request.Path, context.Response.StatusCode, duration);
    }
}
`;

export const SENTRY_INIT_CSHARP = `{
  "Sentry": {
    "Dsn": "\${SENTRY_DSN}",
    "TracesSampleRate": 0.1,
    "Environment": "production"
  }
}
`;
