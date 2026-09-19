export const MIDDLEWARE_RUST = `use axum::body::Body;
use axum::http::{header, Request, Response, StatusCode};
use axum::middleware::Next;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

static RATE_HITS: Mutex<HashMap<String, Vec<Instant>>> = Mutex::new(HashMap::new());

pub async fn security_headers(req: Request<Body>, next: Next) -> Response<Body> {
    let mut res = next.run(req).await;
    let headers = res.headers_mut();
    headers.insert(header::X_CONTENT_TYPE_OPTIONS, "nosniff".parse().unwrap());
    headers.insert(header::X_FRAME_OPTIONS, "DENY".parse().unwrap());
    headers.insert(header::REFERRER_POLICY, "strict-origin-when-cross-origin".parse().unwrap());
    res
}

pub async fn cors(req: Request<Body>, next: Next) -> Response<Body> {
    if req.method() == axum::http::Method::OPTIONS {
        let mut res = Response::new(Body::empty());
        *res.status_mut() = StatusCode::NO_CONTENT;
        if let Ok(origin) = req.headers().get(header::ORIGIN).unwrap().to_str() {
            res.headers_mut().insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin.parse().unwrap());
        }
        return res;
    }
    next.run(req).await
}

pub async fn rate_limit(req: Request<Body>, next: Next) -> Response<Body> {
    let key = req
        .extensions()
        .get::<std::net::SocketAddr>()
        .map(|a| a.to_string())
        .unwrap_or_else(|| "unknown".into());
    if !allow_rate(&key) {
        return Response::builder()
            .status(StatusCode::TOO_MANY_REQUESTS)
            .body(Body::from(r#"{"error":"Too many requests"}"#))
            .unwrap();
    }
    next.run(req).await
}

fn allow_rate(key: &str) -> bool {
    let mut map = RATE_HITS.lock().unwrap();
    let now = Instant::now();
    let window: Vec<Instant> = map
        .get(key)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|t| now.duration_since(*t) < Duration::from_secs(900))
        .collect();
    let count = window.len() + 1;
    map.insert(key.to_string(), {
        let mut v = window;
        v.push(now);
        v
    });
    count <= 100
}

pub async fn request_logger(req: Request<Body>, next: Next) -> Response<Body> {
    let method = req.method().clone();
    let path = req.uri().path().to_string();
    let started = Instant::now();
    let res = next.run(req).await;
    eprintln!("{} {} {:?}", method, path, started.elapsed());
    res
}
`;

export const MIDDLEWARE_ACTIX_RUST = `use actix_web::{
    body::MessageBody,
    dev::{ServiceRequest, ServiceResponse},
    http::header,
    middleware::Next,
    Error, HttpResponse,
};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

static RATE_HITS: Mutex<HashMap<String, Vec<Instant>>> = Mutex::new(HashMap::new());

pub async fn security_headers(
    req: ServiceRequest,
    next: Next<impl MessageBody>,
) -> Result<ServiceResponse<impl MessageBody>, Error> {
    let mut res = next.call(req).await?;
    res.headers_mut()
        .insert(header::X_CONTENT_TYPE_OPTIONS, "nosniff".parse().unwrap());
    res.headers_mut()
        .insert(header::X_FRAME_OPTIONS, "DENY".parse().unwrap());
    res.headers_mut().insert(
        header::REFERRER_POLICY,
        "strict-origin-when-cross-origin".parse().unwrap(),
    );
    Ok(res)
}

pub async fn cors(
    req: ServiceRequest,
    next: Next<impl MessageBody>,
) -> Result<ServiceResponse<impl MessageBody>, Error> {
    if req.method() == actix_web::http::Method::OPTIONS {
        let mut res = HttpResponse::NoContent().into();
        if let Some(origin) = req.headers().get(header::ORIGIN) {
            res.headers_mut()
                .insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin.clone());
        }
        return Ok(req.into_response(res).map_into_right_body());
    }
    next.call(req).await
}

pub async fn rate_limit(
    req: ServiceRequest,
    next: Next<impl MessageBody>,
) -> Result<ServiceResponse<impl MessageBody>, Error> {
    let key = req
        .connection_info()
        .peer_addr()
        .unwrap_or("unknown")
        .to_string();
    if !allow_rate(&key) {
        return Ok(req.into_response(HttpResponse::TooManyRequests().json(serde_json::json!({"error":"Too many requests"}))).map_into_right_body());
    }
    next.call(req).await
}

fn allow_rate(key: &str) -> bool {
    let mut map = RATE_HITS.lock().unwrap();
    let now = Instant::now();
    let window: Vec<Instant> = map
        .get(key)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|t| now.duration_since(*t) < Duration::from_secs(900))
        .collect();
    let count = window.len() + 1;
    map.insert(key.to_string(), {
        let mut v = window;
        v.push(now);
        v
    });
    count <= 100
}

pub async fn request_logger(
    req: ServiceRequest,
    next: Next<impl MessageBody>,
) -> Result<ServiceResponse<impl MessageBody>, Error> {
    let method = req.method().clone();
    let path = req.path().to_string();
    let started = Instant::now();
    let res = next.call(req).await?;
    eprintln!("{} {} {:?}", method, path, started.elapsed());
    res
}
`;

export const SENTRY_INIT_RUST = `use std::env;

pub fn init() -> sentry::ClientInitGuard {
    sentry::init((
        env::var("SENTRY_DSN").unwrap_or_default(),
        sentry::ClientOptions {
            release: sentry::release_name!(),
            environment: Some(
                env::var("APP_ENV")
                    .unwrap_or_else(|_| "production".into())
                    .into(),
            ),
            traces_sample_rate: 0.1,
            ..Default::default()
        },
    ))
}
`;

export const HEALTH_CHECK_RUST = `use axum::{routing::get, Json, Router};
use serde_json::{json, Value};

pub fn health_routes() -> Router {
  Router::new().route("/health", get(health))
}

async fn health() -> Json<Value> {
  Json(json!({ "status": "ok" }))
}
`;
