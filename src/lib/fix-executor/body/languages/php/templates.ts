export const SECURITY_HEADERS_PHP = `<?php

namespace App\\Http\\Middleware;

use Closure;
use Illuminate\\Http\\Request;

class SecurityHeaders
{
    public function handle(Request $request, Closure $next)
    {
        $response = $next($request);
        $response->headers->set('X-Content-Type-Options', 'nosniff');
        $response->headers->set('X-Frame-Options', 'DENY');
        $response->headers->set('Referrer-Policy', 'strict-origin-when-cross-origin');
        return $response;
    }
}
`;

export const CORS_PHP = `<?php

namespace App\\Http\\Middleware;

use Closure;
use Illuminate\\Http\\Request;

class CorsMiddleware
{
    public function handle(Request $request, Closure $next)
    {
        if ($request->getMethod() === 'OPTIONS') {
            return response('', 204)->withHeaders($this->headers($request));
        }
        $response = $next($request);
        foreach ($this->headers($request) as $key => $value) {
            $response->headers->set($key, $value);
        }
        return $response;
    }

    private function headers(Request $request): array
    {
        $origin = $request->headers->get('Origin', env('ALLOWED_ORIGINS', '*'));
        return [
            'Access-Control-Allow-Origin' => $origin,
            'Access-Control-Allow-Methods' => 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
            'Access-Control-Allow-Headers' => 'Content-Type, Authorization',
        ];
    }
}
`;

export const RATE_LIMIT_PHP = `<?php

namespace App\\Http\\Middleware;

use Closure;
use Illuminate\\Http\\Request;
use Illuminate\\Support\\Facades\\Cache;

class RateLimitMiddleware
{
    public function handle(Request $request, Closure $next)
    {
        $key = 'rl:' . $request->ip();
        $count = Cache::increment($key);
        Cache::put($key, $count, now()->addMinutes(15));
        if ($count > 100) {
            return response()->json(['error' => 'Too many requests'], 429);
        }
        return $next($request);
    }
}
`;

export const LOGGER_PHP = `<?php

namespace App\\Http\\Middleware;

use Closure;
use Illuminate\\Http\\Request;
use Illuminate\\Support\\Facades\\Log;

class RequestLogger
{
    public function handle(Request $request, Closure $next)
    {
        $started = microtime(true);
        $response = $next($request);
        Log::info($request->method() . ' ' . $request->path(), [
            'duration_ms' => round((microtime(true) - $started) * 1000, 2),
        ]);
        return $response;
    }
}
`;

export const SENTRY_INIT_PHP = `<?php

return [
    'dsn' => env('SENTRY_LARAVEL_DSN', env('SENTRY_DSN')),
    'environment' => env('APP_ENV', 'production'),
    'release' => env('APP_VERSION'),
    'traces_sample_rate' => env('APP_ENV') === 'production' ? 0.1 : 0.0,
    'breadcrumbs' => [
        'logs' => true,
        'sql_queries' => true,
        'queue_info' => true,
    ],
];
`;
