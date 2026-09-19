export const SECURITY_HEADERS_SYMFONY = `<?php

namespace App\\EventSubscriber;

use Symfony\\Component\\EventDispatcher\\EventSubscriberInterface;
use Symfony\\Component\\HttpKernel\\Event\\ResponseEvent;
use Symfony\\Component\\HttpKernel\\KernelEvents;

class SecurityHeadersSubscriber implements EventSubscriberInterface
{
    public static function getSubscribedEvents(): array
    {
        return [KernelEvents::RESPONSE => 'onResponse'];
    }

    public function onResponse(ResponseEvent $event): void
    {
        if (!$event->isMainRequest()) {
            return;
        }
        $headers = $event->getResponse()->headers;
        $headers->set('X-Content-Type-Options', 'nosniff');
        $headers->set('X-Frame-Options', 'DENY');
        $headers->set('Referrer-Policy', 'strict-origin-when-cross-origin');
    }
}
`;

export const CORS_SYMFONY = `<?php

namespace App\\EventSubscriber;

use Symfony\\Component\\EventDispatcher\\EventSubscriberInterface;
use Symfony\\Component\\HttpFoundation\\Response;
use Symfony\\Component\\HttpKernel\\Event\\RequestEvent;
use Symfony\\Component\\HttpKernel\\Event\\ResponseEvent;
use Symfony\\Component\\HttpKernel\\KernelEvents;

class CorsSubscriber implements EventSubscriberInterface
{
    public static function getSubscribedEvents(): array
    {
        return [
            KernelEvents::REQUEST => ['onRequest', 100],
            KernelEvents::RESPONSE => 'onResponse',
        ];
    }

    public function onRequest(RequestEvent $event): void
    {
        if (!$event->isMainRequest() || $event->getRequest()->getMethod() !== 'OPTIONS') {
            return;
        }
        $event->setResponse(new Response('', Response::HTTP_NO_CONTENT, $this->corsHeaders($event)));
    }

    public function onResponse(ResponseEvent $event): void
    {
        if (!$event->isMainRequest()) {
            return;
        }
        foreach ($this->corsHeaders($event) as $key => $value) {
            $event->getResponse()->headers->set($key, $value);
        }
    }

    private function corsHeaders(object $event): array
    {
        $origin = method_exists($event, 'getRequest')
            ? ($event->getRequest()->headers->get('Origin') ?? $_ENV['ALLOWED_ORIGINS'] ?? '*')
            : '*';
        return [
            'Access-Control-Allow-Origin' => $origin,
            'Access-Control-Allow-Methods' => 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
            'Access-Control-Allow-Headers' => 'Content-Type, Authorization',
        ];
    }
}
`;

export const RATE_LIMIT_SYMFONY = `<?php

namespace App\\EventSubscriber;

use Symfony\\Component\\EventDispatcher\\EventSubscriberInterface;
use Symfony\\Component\\HttpFoundation\\JsonResponse;
use Symfony\\Component\\HttpFoundation\\Response;
use Symfony\\Component\\HttpKernel\\Event\\RequestEvent;
use Symfony\\Component\\HttpKernel\\KernelEvents;

class RateLimitSubscriber implements EventSubscriberInterface
{
    private static array $hits = [];

    public static function getSubscribedEvents(): array
    {
        return [KernelEvents::REQUEST => ['onRequest', 200]];
    }

    public function onRequest(RequestEvent $event): void
    {
        if (!$event->isMainRequest()) {
            return;
        }
        $key = $event->getRequest()->getClientIp() ?? 'unknown';
        $now = time();
        self::$hits[$key] = array_values(array_filter(self::$hits[$key] ?? [], fn ($t) => $now - $t < 900));
        if (count(self::$hits[$key]) >= 100) {
            $event->setResponse(new JsonResponse(['error' => 'Too many requests'], Response::HTTP_TOO_MANY_REQUESTS));
            return;
        }
        self::$hits[$key][] = $now;
    }
}
`;

export const LOGGER_SYMFONY = `<?php

namespace App\\EventSubscriber;

use Psr\\Log\\LoggerInterface;
use Symfony\\Component\\EventDispatcher\\EventSubscriberInterface;
use Symfony\\Component\\HttpKernel\\Event\\TerminateEvent;
use Symfony\\Component\\HttpKernel\\KernelEvents;

class RequestLoggerSubscriber implements EventSubscriberInterface
{
    public function __construct(private LoggerInterface $logger) {}

    public static function getSubscribedEvents(): array
    {
        return [KernelEvents::TERMINATE => 'onTerminate'];
    }

    public function onTerminate(TerminateEvent $event): void
    {
        $req = $event->getRequest();
        $this->logger->info($req->getMethod() . ' ' . $req->getPathInfo());
    }
}
`;

export const HEALTH_CONTROLLER_SYMFONY = `<?php

namespace App\\Controller;

use Symfony\\Component\\HttpFoundation\\JsonResponse;
use Symfony\\Component\\Routing\\Annotation\\Route;

class HealthController
{
    public function index(): JsonResponse
    {
        return new JsonResponse(['status' => 'ok']);
    }
}
`;
