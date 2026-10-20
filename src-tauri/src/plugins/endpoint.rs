//! The Plugin Endpoint listener (ADR 0031, #586).
//!
//! An external Agent reaches a Plugin the way it reaches any HTTP server:
//! `http://127.0.0.1:<port>/plugin/<pluginId>/`. Rust owns the socket, so Rust
//! enforces the rules once for every Plugin — loopback only, the bound port's
//! own `Host` and `Origin`, a path of a Plugin that is currently serving — and
//! then hands the request to the webview over an IPC channel. The webview
//! answers through commands keyed by the request id minted here.
//!
//! Nothing here decides *which* Plugins serve: the host syncs that set.
//! The socket is bound only while that set is non-empty, so the port is closed
//! on every other machine and while no Plugin holds `serve`.

use std::collections::{HashMap, HashSet};
use std::convert::Infallible;
use std::future::Future;
use std::hash::BuildHasher;
use std::net::Ipv4Addr;
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::task::{Context, Poll};
use std::time::Duration;

use base64::Engine;
use http_body_util::BodyExt;
use hyper::body::{Body as HttpBody, Bytes, Frame, Incoming, SizeHint};
use hyper::header::{
    HeaderMap, HeaderName, HeaderValue, CONTENT_LENGTH, CONTENT_TYPE, HOST, ORIGIN,
};
use hyper::service::service_fn;
use hyper::{Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use serde::Serialize;
use tokio::sync::{mpsc, oneshot, watch};

/// The ports the Plugin Endpoint picks from. Below Linux's ephemeral range
/// (32768-60999) and the IANA/Windows/macOS one (49152-65535), so an Agent's
/// `curl` reaches the app and never some other program's socket.
pub const PORT_RANGE: std::ops::RangeInclusive<u16> = 20000..=32000;

/// How many free ports one bind moves through when the kept one is held. A
/// range this wide is never legitimately full, so a picker that keeps naming
/// taken ports is a bug, not a reason to loop forever.
const PORT_MOVE_LIMIT: usize = 32;

/// A request body larger than this is refused with 413 before reaching a Plugin.
pub const MAX_BODY_BYTES: usize = 4 * 1024 * 1024;

/// How long a Plugin has to answer before the Agent gets 504.
pub const ANSWER_TIMEOUT: Duration = Duration::from_secs(30);

/// How long `shutdown` waits for the accept task to drop the socket: long
/// enough for a scheduled task, short enough never to hang the caller.
const CLOSE_WAIT: Duration = Duration::from_millis(250);

/// One inbound HTTP request, as a Plugin receives it.
///
/// `path` is the full request target including the query, `headers` keeps
/// duplicates and lower-cased names, and `body` is base64 of the raw bytes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct EndpointRequest {
    pub method: String,
    pub path: String,
    pub headers: Vec<(String, String)>,
    pub body: String,
}

/// One request on its way to exactly one Plugin.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EndpointRequestMsg {
    pub request_id: String,
    pub plugin_id: String,
    pub request: EndpointRequest,
}

/// What the host tells the Plugin management store about the listener.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum ListenerState {
    Off,
    Listening { port: u16 },
    Failed { port: u16, reason: String },
}

/// Where an inbound request goes. In the app this is a [`tauri::ipc::Channel`];
/// tests inject an `mpsc` sender, the same seam `watch.rs` uses for its
/// callback.
pub trait RequestSink: Send + Sync + 'static {
    fn deliver(&self, message: EndpointRequestMsg);
}

impl<F> RequestSink for F
where
    F: Fn(EndpointRequestMsg) + Send + Sync + 'static,
{
    fn deliver(&self, message: EndpointRequestMsg) {
        self(message);
    }
}

enum Stage {
    Waiting(oneshot::Sender<AnswerStart>),
    Streaming(mpsc::UnboundedSender<Bytes>),
    /// `end`ed, and kept only until its body drops, so a `chunk` that races
    /// the end still reads as an error rather than as a hung-up client.
    Ended,
}

/// Owns one pending entry: whoever holds it keeps the entry, and dropping it
/// removes the entry unless the answer moved the guard into its body.
struct PendingGuard {
    shared: Arc<Shared>,
    id: u64,
}

impl PendingGuard {
    fn forget(&self) {
        self.shared.forget(self.id);
    }
}

impl Drop for PendingGuard {
    fn drop(&mut self) {
        self.forget();
    }
}

struct AnswerStart {
    status: StatusCode,
    headers: Vec<(HeaderName, HeaderValue)>,
    body: Option<Bytes>,
    chunks: Option<mpsc::UnboundedReceiver<Bytes>>,
}

/// The response body: one buffer with a known length, or chunks of unknown
/// length (hyper then frames with chunked transfer encoding). A chunked body
/// owns the pending entry and ends the stream when the Plugin goes idle.
enum AnswerBody {
    Whole(Option<Bytes>),
    Chunks {
        chunks: mpsc::UnboundedReceiver<Bytes>,
        guard: PendingGuard,
        idle: Duration,
        deadline: Pin<Box<tokio::time::Sleep>>,
    },
}

impl HttpBody for AnswerBody {
    type Data = Bytes;
    type Error = Infallible;

    fn poll_frame(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<Frame<Self::Data>, Self::Error>>> {
        match self.get_mut() {
            AnswerBody::Whole(bytes) => {
                Poll::Ready(bytes.take().map(|bytes| Ok(Frame::data(bytes))))
            }
            AnswerBody::Chunks {
                chunks,
                guard,
                idle,
                deadline,
            } => match chunks.poll_recv(cx) {
                Poll::Ready(Some(bytes)) => {
                    deadline.as_mut().reset(tokio::time::Instant::now() + *idle);
                    Poll::Ready(Some(Ok(Frame::data(bytes))))
                }
                Poll::Ready(None) => Poll::Ready(None),
                Poll::Pending => match deadline.as_mut().poll(cx) {
                    Poll::Ready(()) => {
                        guard.forget();
                        Poll::Ready(None)
                    }
                    Poll::Pending => Poll::Pending,
                },
            },
        }
    }

    fn is_end_stream(&self) -> bool {
        matches!(self, AnswerBody::Whole(bytes) if bytes.is_none())
    }

    fn size_hint(&self) -> SizeHint {
        match self {
            AnswerBody::Whole(Some(bytes)) => SizeHint::with_exact(bytes.len() as u64),
            _ => SizeHint::default(),
        }
    }
}

/// What every task of one listener shares: the bound port, who serves, the
/// requests waiting for an answer, and the way out to the webview.
struct Shared {
    port: u16,
    answer_timeout: Duration,
    serving: RwLock<HashSet<String>>,
    pending: Mutex<HashMap<u64, Stage>>,
    next_id: AtomicU64,
    stop: watch::Sender<bool>,
    /// Swappable: the webview re-sends its Channel on every sync, and a reload
    /// leaves the old one dead.
    sink: RwLock<Arc<dyn RequestSink>>,
    /// Taken by `shutdown` to wait for the accept task to close the socket.
    closed: Mutex<Option<std::sync::mpsc::Receiver<()>>>,
}

impl Shared {
    /// The Plugin that serves `path`, if any: `/plugin/<id>` or
    /// `/plugin/<id>/…`, with `<id>` in the serving set.
    fn plugin_for(&self, path: &str) -> Option<String> {
        let rest = path.strip_prefix("/plugin/")?;
        let id = rest.split('/').next()?;
        if id.is_empty() {
            return None;
        }
        let serving = self.serving.read().ok()?;
        if !serving.contains(id) {
            return None;
        }
        Some(id.to_string())
    }

    fn forget(&self, id: u64) {
        if let Ok(mut pending) = self.pending.lock() {
            pending.remove(&id);
        }
    }

    /// Blocks until the accept task dropped the listening socket, so a bind on
    /// the same port right after `shutdown` cannot race it into `EADDRINUSE`.
    fn await_closed(&self) {
        let closed = self.closed.lock().ok().and_then(|mut closed| closed.take());
        if let Some(closed) = closed {
            let _ = closed.recv_timeout(CLOSE_WAIT);
        }
    }

    #[cfg(test)]
    fn pending_len(&self) -> usize {
        self.pending.lock().map_or(0, |pending| pending.len())
    }

    /// Answers every waiting request with `status` and ends every open stream.
    fn fail_pending(&self, status: StatusCode, message: &'static str) {
        let Ok(mut pending) = self.pending.lock() else {
            return;
        };
        let entries: Vec<(u64, Stage)> = pending.drain().collect();
        drop(pending);
        for (_, stage) in entries {
            if let Stage::Waiting(answer) = stage {
                let _ = answer.send(AnswerStart {
                    status,
                    headers: Vec::new(),
                    body: Some(Bytes::from_static(message.as_bytes())),
                    chunks: None,
                });
            }
            // A streaming entry drops its sender here, which ends the body.
        }
    }
}

/// The bound loopback listener. Cheap to clone: every clone drives the same
/// socket. `shutdown` is explicit — a dropped clone does not unbind.
#[derive(Clone)]
pub struct Listener {
    shared: Arc<Shared>,
}

impl Listener {
    /// Binds `127.0.0.1:port` and starts accepting. `port` 0 is a free port,
    /// which tests use; [`Listener::port`] reports what was bound.
    pub fn bind(port: u16, sink: impl RequestSink) -> Result<Self, String> {
        Self::bind_with_timeout(port, ANSWER_TIMEOUT, sink)
    }

    /// [`Listener::bind`] with the answer timeout the tests can shrink.
    pub fn bind_with_timeout(
        port: u16,
        answer_timeout: Duration,
        sink: impl RequestSink,
    ) -> Result<Self, String> {
        let socket = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, port))
            .map_err(|error| format!("cannot bind 127.0.0.1:{port}: {error}"))?;
        socket
            .set_nonblocking(true)
            .map_err(|error| format!("cannot use 127.0.0.1:{port}: {error}"))?;
        let socket = tokio::net::TcpListener::from_std(socket)
            .map_err(|error| format!("cannot listen on 127.0.0.1:{port}: {error}"))?;
        let port = socket
            .local_addr()
            .map_err(|error| format!("cannot read the endpoint address: {error}"))?
            .port();
        let (stop, stopped) = watch::channel(false);
        let (closed, closing) = std::sync::mpsc::channel();
        let shared = Arc::new(Shared {
            port,
            answer_timeout,
            serving: RwLock::new(HashSet::new()),
            pending: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
            stop,
            sink: RwLock::new(Arc::new(sink)),
            closed: Mutex::new(Some(closing)),
        });
        tokio::spawn(accept(Arc::clone(&shared), socket, stopped, closed));
        Ok(Self { shared })
    }

    /// The port actually bound.
    pub fn port(&self) -> u16 {
        self.shared.port
    }

    pub fn state(&self) -> ListenerState {
        ListenerState::Listening { port: self.port() }
    }

    /// Replaces where requests go. The listener outlives a webview reload, so
    /// it must follow the Channel that reload opened.
    pub fn set_sink(&self, sink: impl RequestSink) {
        if let Ok(mut current) = self.shared.sink.write() {
            *current = Arc::new(sink);
        }
    }

    /// Replaces the set of Plugins that serve. An empty set unbinds the port
    /// and fails whatever is pending: no Plugin holds `serve` any more.
    pub fn set_serving(&self, ids: Vec<String>) {
        let ids: HashSet<String> = ids.into_iter().collect();
        if ids.is_empty() {
            self.shutdown();
            return;
        }
        if let Ok(mut serving) = self.shared.serving.write() {
            *serving = ids;
        }
    }

    /// Closes the port, ends every open stream, and answers every waiting
    /// request with 503.
    pub fn shutdown(&self) {
        if let Ok(mut serving) = self.shared.serving.write() {
            serving.clear();
        }
        self.shared.fail_pending(
            StatusCode::SERVICE_UNAVAILABLE,
            "The Plugin Endpoint is off",
        );
        self.shared.stop.send_replace(true);
        self.shared.await_closed();
    }

    /// Answers a waiting request. `body` is base64; `streaming` sends the
    /// status and headers now and leaves the body to [`Listener::chunk`] and
    /// [`Listener::end`].
    pub fn respond(
        &self,
        request_id: &str,
        status: u16,
        headers: Vec<(String, String)>,
        body: Option<&str>,
        streaming: bool,
    ) -> Result<(), String> {
        let id = parse_request_id(request_id)?;
        let status = StatusCode::from_u16(status)
            .map_err(|_| format!("invalid status {status} for request {request_id}"))?;
        let headers = plugin_headers(headers);
        let body = match streaming {
            true => Bytes::new(),
            false => decode_body(body)?,
        };
        let mut pending = self
            .shared
            .pending
            .lock()
            .map_err(|_| "the Plugin Endpoint is unavailable".to_string())?;
        match pending.get(&id) {
            Some(Stage::Waiting(_)) => {}
            Some(Stage::Streaming(_) | Stage::Ended) => {
                return Err(format!("request {request_id} was already answered"));
            }
            None => return Err(format!("unknown request {request_id}")),
        }
        // A streaming answer leaves its chunk channel in the map before the
        // HTTP layer wakes up, so a `chunk` right after `respond` finds it.
        let (chunks, received) = mpsc::unbounded_channel();
        let Some(stage) = pending.get_mut(&id) else {
            return Err(format!("unknown request {request_id}"));
        };
        let Stage::Waiting(answer) = std::mem::replace(stage, Stage::Streaming(chunks)) else {
            return Err(format!("request {request_id} was already answered"));
        };
        let start = AnswerStart {
            status,
            headers,
            body: match streaming {
                true => None,
                false => Some(body),
            },
            chunks: match streaming {
                true => Some(received),
                false => None,
            },
        };
        if streaming {
            return match answer.send(start) {
                Ok(()) => Ok(()),
                Err(_) => {
                    pending.remove(&id);
                    Err(format!("request {request_id} is gone"))
                }
            };
        }
        // A whole answer is finished: nothing may chunk or end it later.
        pending.remove(&id);
        match answer.send(start) {
            Ok(()) => Ok(()),
            Err(_) => Err(format!("request {request_id} is gone")),
        }
    }

    /// Sends one base64 chunk of a streamed answer. `false` once the client
    /// hung up, so the Plugin can stop producing.
    pub fn chunk(&self, request_id: &str, chunk: &str) -> Result<bool, String> {
        let id = parse_request_id(request_id)?;
        let bytes = decode_body(Some(chunk))?;
        let mut pending = self
            .shared
            .pending
            .lock()
            .map_err(|_| "the Plugin Endpoint is unavailable".to_string())?;
        // The body takes its entry with it when the client goes away; no entry
        // means nobody is there to read the chunk.
        let Some(stage) = pending.get_mut(&id) else {
            return Ok(false);
        };
        let Stage::Streaming(chunks) = stage else {
            return Err(format!("request {request_id} is not streaming"));
        };
        if chunks.send(bytes).is_err() {
            pending.remove(&id);
            return Ok(false);
        }
        Ok(true)
    }

    /// Ends a streamed answer. Unknown or already finished requests are an
    /// error: the host must not keep writing to a body nobody reads.
    pub fn end(&self, request_id: &str) -> Result<(), String> {
        let id = parse_request_id(request_id)?;
        let mut pending = self
            .shared
            .pending
            .lock()
            .map_err(|_| "the Plugin Endpoint is unavailable".to_string())?;
        let Some(stage) = pending.get_mut(&id) else {
            return Err(format!("unknown request {request_id}"));
        };
        if matches!(stage, Stage::Waiting(_)) {
            return Err(format!("request {request_id} has no answer yet"));
        }
        // Dropping the sender ends the chunked body; the entry outlives it
        // only until the body drops.
        *stage = Stage::Ended;
        Ok(())
    }

    #[cfg(test)]
    fn pending_len(&self) -> usize {
        self.shared.pending_len()
    }
}

fn parse_request_id(request_id: &str) -> Result<u64, String> {
    request_id
        .parse()
        .map_err(|_| format!("unknown request {request_id}"))
}

fn decode_body(body: Option<&str>) -> Result<Bytes, String> {
    let Some(text) = body else {
        return Ok(Bytes::new());
    };
    if text.is_empty() {
        return Ok(Bytes::new());
    }
    base64::engine::general_purpose::STANDARD
        .decode(text)
        .map(Bytes::from)
        .map_err(|error| format!("body is not base64: {error}"))
}

/// A Plugin's answer headers, minus the ones the HTTP layer owns: a Plugin
/// must not be able to lie about framing or hijack the connection.
fn plugin_headers(headers: Vec<(String, String)>) -> Vec<(HeaderName, HeaderValue)> {
    headers
        .into_iter()
        .filter_map(|(name, value)| {
            let name = HeaderName::from_bytes(name.trim().as_bytes()).ok()?;
            if matches!(
                name.as_str(),
                "content-length" | "transfer-encoding" | "connection" | "host"
            ) {
                return None;
            }
            let value = HeaderValue::from_str(&value).ok()?;
            Some((name, value))
        })
        .collect()
}

/// Accepts until `shutdown`, then drops the socket and reports that it did so.
/// A shutdown wins over a racing accept: the port must be closed, not reopened
/// by one more request.
async fn accept(
    shared: Arc<Shared>,
    socket: tokio::net::TcpListener,
    mut stopped: watch::Receiver<bool>,
    closed: std::sync::mpsc::Sender<()>,
) {
    loop {
        tokio::select! {
            biased;
            changed = stopped.changed() => {
                if changed.is_err() || *stopped.borrow() {
                    break;
                }
            }
            accepted = socket.accept() => {
                let Ok((stream, _peer)) = accepted else {
                    continue;
                };
                let shared = Arc::clone(&shared);
                tokio::spawn(async move {
                    let service = service_fn(move |request: Request<Incoming>| {
                        let shared = Arc::clone(&shared);
                        async move { Ok::<_, Infallible>(answer(shared, request).await) }
                    });
                    let _ = hyper::server::conn::http1::Builder::new()
                        .serve_connection(TokioIo::new(stream), service)
                        .await;
                });
            }
        }
    }
    drop(socket);
    let _ = closed.send(());
}

/// One request, checked in the order the design fixes: Host, Origin, path,
/// body size, then the Plugin's answer.
async fn answer(shared: Arc<Shared>, request: Request<Incoming>) -> Response<AnswerBody> {
    let port = shared.port;
    if !host_allowed(request.headers(), port) {
        return plain(
            StatusCode::MISDIRECTED_REQUEST,
            "Host must be 127.0.0.1 or localhost on the Plugin Endpoint port",
        );
    }
    if !origin_allowed(request.headers(), port) {
        return plain(StatusCode::FORBIDDEN, "Origin is not this Plugin Endpoint");
    }
    let Some(plugin_id) = shared.plugin_for(request.uri().path()) else {
        return plain(StatusCode::NOT_FOUND, "No Plugin serves this path");
    };
    let path = request.uri().path_and_query().map_or_else(
        || request.uri().path().to_string(),
        |path| path.as_str().to_string(),
    );
    let method = request.method().as_str().to_string();
    let headers = lower_headers(request.headers());
    let body = match read_body(request.into_body()).await {
        Ok(body) => body,
        Err(BodyError::TooLarge) => {
            return plain(
                StatusCode::PAYLOAD_TOO_LARGE,
                "The request body exceeds 4 MiB",
            );
        }
        Err(BodyError::Malformed) => {
            return plain(StatusCode::BAD_REQUEST, "Malformed request body");
        }
    };

    let id = shared.next_id.fetch_add(1, Ordering::Relaxed);
    let request_id = id.to_string();
    let (answered, answer) = oneshot::channel();
    let guard = {
        let Ok(mut pending) = shared.pending.lock() else {
            return plain(
                StatusCode::INTERNAL_SERVER_ERROR,
                "The Plugin Endpoint is unavailable",
            );
        };
        pending.insert(id, Stage::Waiting(answered));
        PendingGuard {
            shared: Arc::clone(&shared),
            id,
        }
    };
    let sink = shared.sink.read().ok().map(|sink| Arc::clone(&sink));
    let Some(sink) = sink else {
        return plain(
            StatusCode::INTERNAL_SERVER_ERROR,
            "The Plugin Endpoint is unavailable",
        );
    };
    sink.deliver(EndpointRequestMsg {
        request_id: request_id.clone(),
        plugin_id,
        request: EndpointRequest {
            method,
            path,
            headers,
            body: base64::engine::general_purpose::STANDARD.encode(body),
        },
    });

    match tokio::time::timeout(shared.answer_timeout, answer).await {
        Ok(Ok(start)) => start.into_response(guard),
        Ok(Err(_)) => plain(
            StatusCode::SERVICE_UNAVAILABLE,
            "The Plugin Endpoint is off",
        ),
        Err(_) => plain(
            StatusCode::GATEWAY_TIMEOUT,
            "The Plugin did not answer in time",
        ),
    }
}

enum BodyError {
    TooLarge,
    Malformed,
}

/// Reads the body up to [`MAX_BODY_BYTES`]. An oversized one is drained first
/// — up to a hard cap — so a client still writing gets the 413 instead of a
/// connection reset.
async fn read_body(mut incoming: Incoming) -> Result<Vec<u8>, BodyError> {
    let mut body = Vec::new();
    loop {
        match incoming.frame().await {
            Some(Ok(frame)) => {
                let Some(data) = frame.data_ref() else {
                    continue;
                };
                if body.len() + data.len() > MAX_BODY_BYTES {
                    drain(&mut incoming, MAX_BODY_BYTES * 4).await;
                    return Err(BodyError::TooLarge);
                }
                body.extend_from_slice(data);
            }
            Some(Err(_)) => return Err(BodyError::Malformed),
            None => return Ok(body),
        }
    }
}

async fn drain(incoming: &mut Incoming, limit: usize) {
    let mut discarded = 0;
    while let Some(Ok(frame)) = incoming.frame().await {
        discarded += frame.data_ref().map_or(0, Bytes::len);
        if discarded > limit {
            break;
        }
    }
}

impl AnswerStart {
    fn into_response(self, guard: PendingGuard) -> Response<AnswerBody> {
        let status = self.status;
        let body = match self.chunks {
            Some(chunks) => {
                let idle = guard.shared.answer_timeout;
                AnswerBody::Chunks {
                    chunks,
                    guard,
                    idle,
                    deadline: Box::pin(tokio::time::sleep(idle)),
                }
            }
            None => {
                drop(guard);
                AnswerBody::Whole(Some(self.body.unwrap_or_default()))
            }
        };
        let mut response = Response::new(body);
        *response.status_mut() = status;
        for (name, value) in self.headers {
            response.headers_mut().append(name, value);
        }
        if forbids_body(status) {
            *response.body_mut() = AnswerBody::Whole(None);
        } else if let AnswerBody::Whole(Some(bytes)) = response.body() {
            let length = bytes.len() as u64;
            response
                .headers_mut()
                .insert(CONTENT_LENGTH, HeaderValue::from(length));
        }
        response
    }
}

/// RFC 9110: a 1xx, 204, or 304 answer carries neither a body nor a
/// `Content-Length`.
fn forbids_body(status: StatusCode) -> bool {
    status.is_informational() || matches!(status, StatusCode::NO_CONTENT | StatusCode::NOT_MODIFIED)
}

fn plain(status: StatusCode, message: &'static str) -> Response<AnswerBody> {
    let mut response = Response::new(AnswerBody::Whole(Some(Bytes::from_static(
        message.as_bytes(),
    ))));
    *response.status_mut() = status;
    response.headers_mut().insert(
        CONTENT_TYPE,
        HeaderValue::from_static("text/plain; charset=utf-8"),
    );
    response
        .headers_mut()
        .insert(CONTENT_LENGTH, HeaderValue::from(message.len() as u64));
    response
}

/// `Host` must name the loopback name the Agent used, with the bound port: a
/// DNS-rebinding page reaches 127.0.0.1 but sends its own name.
fn host_allowed(headers: &HeaderMap, port: u16) -> bool {
    let Some(host) = headers.get(HOST).and_then(|value| value.to_str().ok()) else {
        return false;
    };
    let host = host.trim();
    host.eq_ignore_ascii_case(&format!("127.0.0.1:{port}"))
        || host.eq_ignore_ascii_case(&format!("localhost:{port}"))
}

/// No `Origin` is a non-browser client (an Agent). A browser sending one must
/// be a page the Endpoint itself served.
fn origin_allowed(headers: &HeaderMap, port: u16) -> bool {
    let Some(origin) = headers.get(ORIGIN) else {
        return true;
    };
    let Ok(origin) = origin.to_str() else {
        return false;
    };
    let origin = origin.trim();
    origin.eq_ignore_ascii_case(&format!("http://127.0.0.1:{port}"))
        || origin.eq_ignore_ascii_case(&format!("http://localhost:{port}"))
}

fn lower_headers(headers: &HeaderMap) -> Vec<(String, String)> {
    headers
        .iter()
        .map(|(name, value)| {
            (
                name.as_str().to_ascii_lowercase(),
                String::from_utf8_lossy(value.as_bytes()).into_owned(),
            )
        })
        .collect()
}

/// Where the next random port comes from. Tests inject their own picker so a
/// move is provable; the app keeps [`random_port`].
type PortPicker = Arc<dyn Fn() -> u16 + Send + Sync>;

/// A port from [`PORT_RANGE`], with no crate: `RandomState` seeds from the OS
/// and advances per value, so a counter and the clock are enough for a port
/// nobody needs to predict.
fn random_port() -> u16 {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let seed = COUNTER.fetch_add(1, Ordering::Relaxed);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_nanos() as u64);
    let hash = std::collections::hash_map::RandomState::new().hash_one((seed, now));
    port_in_range(hash)
}

/// Maps a hash onto [`PORT_RANGE`]. The range is narrower than a `u16`, so a
/// modulo is all the spread a port needs.
fn port_in_range(hash: u64) -> u16 {
    let size = u64::from(*PORT_RANGE.end() - *PORT_RANGE.start()) + 1;
    PORT_RANGE.start() + (hash % size) as u16
}

/// The file that keeps the chosen port across launches. No path keeps the
/// port for this run only, which is what tests and a device with no app data
/// folder get.
struct KeptPort {
    path: Option<PathBuf>,
}

impl KeptPort {
    fn new(path: PathBuf) -> Self {
        Self { path: Some(path) }
    }

    fn in_memory() -> Self {
        Self { path: None }
    }

    /// The port a previous launch kept. A missing, unreadable, garbage, or
    /// out-of-range file reads as no port at all: picking fresh is safer than
    /// trusting a value this app never wrote.
    fn load(&self) -> Option<u16> {
        let text = std::fs::read_to_string(self.path.as_ref()?).ok()?;
        let port = text.trim().parse::<u16>().ok()?;
        PORT_RANGE.contains(&port).then_some(port)
    }

    /// Writes the port for the next launch. A read-only folder returns the
    /// error for the caller to log: this run still serves, it just moves on
    /// the next one.
    fn save(&self, port: u16) -> Result<(), String> {
        let Some(path) = self.path.as_ref() else {
            return Ok(());
        };
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("cannot create {}: {error}", parent.display()))?;
        }
        std::fs::write(path, port.to_string())
            .map_err(|error| format!("cannot write {}: {error}", path.display()))
    }
}

/// A sink shared across the bind attempts: a collision retries with the same
/// sink, which each attempt would otherwise take by value.
#[derive(Clone)]
struct SharedSink(Arc<dyn RequestSink>);

impl RequestSink for SharedSink {
    fn deliver(&self, message: EndpointRequestMsg) {
        self.0.deliver(message);
    }
}

/// The listener behind `plugin_endpoint_*`, plus the set of Plugins that serve.
/// The commands are thin wrappers over this, so the state machine is testable
/// without a Tauri app.
pub struct EndpointState {
    /// Serialises [`EndpointState::sync`]. The slot check and the bind it may
    /// trigger are one step: two syncs that both saw an empty slot would bind
    /// twice, and the second would move off the port the first listener still
    /// holds, overwrite the slot, and leave that first listener serving.
    sync_lock: Mutex<()>,
    /// The port this run keeps, loaded from [`KeptPort`] on first use.
    port: Mutex<Option<u16>>,
    kept: KeptPort,
    pick_port: PortPicker,
    /// `None` uses [`ANSWER_TIMEOUT`]; tests shrink it.
    answer_timeout: Option<Duration>,
    listener: Mutex<Option<Listener>>,
}

impl Default for EndpointState {
    /// No file, so the port is picked for this run only.
    fn default() -> Self {
        Self {
            sync_lock: Mutex::new(()),
            port: Mutex::new(None),
            kept: KeptPort::in_memory(),
            pick_port: Arc::new(random_port),
            answer_timeout: None,
            listener: Mutex::new(None),
        }
    }
}

impl EndpointState {
    /// Keeps one port in `path` across launches (ADR 0031), so an address an
    /// author pasted into an Agent still works after a restart.
    pub fn new(path: PathBuf) -> Self {
        Self {
            kept: KeptPort::new(path),
            ..Self::default()
        }
    }

    #[cfg(test)]
    fn for_tests(
        path: PathBuf,
        answer_timeout: Duration,
        pick_port: impl Fn() -> u16 + Send + Sync + 'static,
    ) -> Self {
        Self {
            answer_timeout: Some(answer_timeout),
            pick_port: Arc::new(pick_port),
            ..Self::new(path)
        }
    }

    fn slot(&self) -> std::sync::MutexGuard<'_, Option<Listener>> {
        // A poisoned slot still holds the listener: there is nothing to undo.
        self.listener
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// The port this run keeps, loaded from the file on first use. A poisoned
    /// lock still holds it: there is nothing to undo.
    fn kept_port(&self) -> Option<u16> {
        let mut port = self
            .port
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if port.is_none() {
            *port = self.kept.load();
        }
        *port
    }

    fn pick(&self) -> u16 {
        (*self.pick_port)()
    }

    /// A port this bind has not tried yet. The picker is injectable, so a bug
    /// in it must not hang the bind: after as many misses as moves it gives up.
    fn untried(&self, tried: &[u16]) -> Option<u16> {
        for _ in 0..PORT_MOVE_LIMIT {
            let port = self.pick();
            if !tried.contains(&port) {
                return Some(port);
            }
        }
        None
    }

    fn bind_once(&self, port: u16, sink: impl RequestSink) -> Result<Listener, String> {
        match self.answer_timeout {
            Some(timeout) => Listener::bind_with_timeout(port, timeout, sink),
            None => Listener::bind(port, sink),
        }
    }

    /// Makes `port` the one this run keeps, and writes it for the next launch
    /// when the file did not already hold it (or was missing).
    fn keep(&self, port: u16, stored: Option<u16>) {
        *self
            .port
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(port);
        if stored == Some(port) {
            return;
        }
        if let Err(error) = self.kept.save(port) {
            eprintln!("Plugin Endpoint port not kept for the next launch: {error}");
        }
    }

    /// Binds while some Plugin serves, unbinds when none does, and otherwise
    /// replaces the set *and* the sink: a webview reload opens a fresh Channel,
    /// and later requests must reach that one. The port is the kept one; when
    /// something else holds it, the Endpoint moves to a free port in
    /// [`PORT_RANGE`] and keeps that one (ADR 0031).
    pub fn sync(&self, ids: Vec<String>, sink: impl RequestSink) -> ListenerState {
        let _sync = self
            .sync_lock
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if ids.is_empty() {
            let listener = self.slot().take();
            if let Some(listener) = listener {
                listener.shutdown();
            }
            return ListenerState::Off;
        }
        if let Some(listener) = self.slot().clone() {
            listener.set_sink(sink);
            listener.set_serving(ids);
            return listener.state();
        }
        self.bind(ids, sink)
    }

    /// Binds the kept port, or moves to a free one in [`PORT_RANGE`] when
    /// something else holds it, and keeps whatever bound. Every later bind in
    /// this run starts from the kept port again.
    fn bind(&self, ids: Vec<String>, sink: impl RequestSink) -> ListenerState {
        let sink = SharedSink(Arc::new(sink));
        // What the file says now: a save that failed last time is retried.
        let stored = self.kept.load();
        let first = self.kept_port().unwrap_or_else(|| self.pick());
        let mut tried = vec![first];
        let mut bound = self.bind_once(first, sink.clone());
        let first_error = bound.as_ref().err().cloned();

        while bound.is_err() && tried.len() <= PORT_MOVE_LIMIT {
            let Some(port) = self.untried(&tried) else {
                break;
            };
            tried.push(port);
            bound = self.bind_once(port, sink.clone());
        }

        match bound {
            Ok(listener) => {
                let port = listener.port();
                listener.set_serving(ids);
                let state = listener.state();
                *self.slot() = Some(listener);
                self.keep(port, stored);
                state
            }
            Err(_) => ListenerState::Failed {
                port: first,
                reason: first_error.unwrap_or_default(),
            },
        }
    }

    pub fn respond(
        &self,
        request_id: &str,
        status: u16,
        headers: Vec<(String, String)>,
        body: Option<&str>,
        streaming: bool,
    ) -> Result<(), String> {
        self.listener()?
            .respond(request_id, status, headers, body, streaming)
    }

    pub fn chunk(&self, request_id: &str, chunk: &str) -> Result<bool, String> {
        self.listener()?.chunk(request_id, chunk)
    }

    pub fn end(&self, request_id: &str) -> Result<(), String> {
        self.listener()?.end(request_id)
    }

    fn listener(&self) -> Result<Listener, String> {
        self.slot()
            .clone()
            .ok_or_else(|| "the Plugin Endpoint is not listening".to_string())
    }

    #[cfg(test)]
    fn pending_len(&self) -> usize {
        self.listener().map_or(0, |listener| listener.pending_len())
    }
}

/// The Tauri side of the sink: every request becomes one IPC message.
struct ChannelSink(tauri::ipc::Channel<EndpointRequestMsg>);

impl RequestSink for ChannelSink {
    fn deliver(&self, message: EndpointRequestMsg) {
        let _ = self.0.send(message);
    }
}

/// Async on purpose: binding registers the socket with the tokio reactor, which
/// only exists inside [`tauri::async_runtime`].
#[tauri::command]
pub async fn plugin_endpoint_sync(
    state: tauri::State<'_, EndpointState>,
    ids: Vec<String>,
    on_request: tauri::ipc::Channel<EndpointRequestMsg>,
) -> Result<ListenerState, String> {
    Ok(state.sync(ids, ChannelSink(on_request)))
}

#[tauri::command]
pub fn plugin_endpoint_respond(
    state: tauri::State<'_, EndpointState>,
    request_id: String,
    status: u16,
    headers: Vec<(String, String)>,
    body: Option<String>,
    streaming: bool,
) -> Result<(), String> {
    state.respond(&request_id, status, headers, body.as_deref(), streaming)
}

#[tauri::command]
pub fn plugin_endpoint_chunk(
    state: tauri::State<'_, EndpointState>,
    request_id: String,
    chunk: String,
) -> Result<bool, String> {
    state.chunk(&request_id, &chunk)
}

#[tauri::command]
pub fn plugin_endpoint_end(
    state: tauri::State<'_, EndpointState>,
    request_id: String,
) -> Result<(), String> {
    state.end(&request_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::sync::mpsc as inbox;

    const PLUGIN: &str = "acme";

    /// The sink the tests read from.
    #[derive(Clone)]
    struct Sink(inbox::UnboundedSender<EndpointRequestMsg>);

    impl RequestSink for Sink {
        fn deliver(&self, message: EndpointRequestMsg) {
            let _ = self.0.send(message);
        }
    }

    /// A private port file under the system temp folder, removed on drop. The
    /// tests run in parallel, so the name carries the process and a counter.
    struct PortFile(PathBuf);

    impl PortFile {
        fn new(name: &str) -> Self {
            static NEXT: AtomicU64 = AtomicU64::new(0);
            let path = std::env::temp_dir().join(format!(
                "maibuk-endpoint-port-{name}-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            let _ = std::fs::remove_file(&path);
            Self(path)
        }

        fn path(&self) -> PathBuf {
            self.0.clone()
        }

        fn write(&self, port: u16) {
            std::fs::write(&self.0, port.to_string()).expect("the port file writes");
        }

        fn read(&self) -> Option<u16> {
            std::fs::read_to_string(&self.0).ok()?.trim().parse().ok()
        }
    }

    impl Drop for PortFile {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }

    /// A picker that walks [`PORT_RANGE`] from a clock-derived start, so
    /// successive calls land on different, mostly free ports.
    fn scanning_picker() -> impl Fn() -> u16 + Send + Sync + 'static {
        let size = u64::from(*PORT_RANGE.end() - *PORT_RANGE.start()) + 1;
        let start = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |elapsed| u64::from(elapsed.subsec_millis()));
        let next = AtomicU64::new(start % size);
        move || {
            let offset = next.fetch_add(1, Ordering::Relaxed) % size;
            PORT_RANGE.start() + offset as u16
        }
    }

    /// A bound endpoint, the queue of what reached its sink, and the port.
    struct Endpoint {
        state: EndpointState,
        sink: Sink,
        inbox: inbox::UnboundedReceiver<EndpointRequestMsg>,
        port: u16,
        /// Kept alive for the endpoint's lifetime: the state may read or write
        /// it again.
        _file: PortFile,
    }

    impl Endpoint {
        async fn serving(ids: &[&str]) -> Self {
            Self::on(Duration::from_secs(5), ids).await
        }

        async fn on(answer_timeout: Duration, ids: &[&str]) -> Self {
            let file = PortFile::new("endpoint");
            let state = EndpointState::for_tests(file.path(), answer_timeout, random_port);
            let (sender, inbox) = inbox::unbounded_channel();
            let sink = Sink(sender);
            let ids: Vec<String> = ids.iter().map(|id| (*id).to_string()).collect();
            let port = match state.sync(ids, sink.clone()) {
                ListenerState::Listening { port } => port,
                other => panic!("expected a bound listener, got {other:?}"),
            };
            Self {
                state,
                sink,
                inbox,
                port,
                _file: file,
            }
        }

        fn host(&self) -> String {
            format!("127.0.0.1:{}", self.port)
        }

        async fn get(&self, path: &str) -> Reply {
            self.send("GET", path, None, None, &[], b"").await
        }

        async fn send(
            &self,
            method: &str,
            path: &str,
            host: Option<&str>,
            origin: Option<&str>,
            headers: &[(&str, &str)],
            body: &[u8],
        ) -> Reply {
            let host = host.map_or_else(|| self.host(), |host| host.to_string());
            let request = raw(method, path, &host, origin, headers, body);
            send_raw(self.port, &request).await
        }

        async fn next(&mut self) -> EndpointRequestMsg {
            tokio::time::timeout(Duration::from_secs(5), self.inbox.recv())
                .await
                .expect("the request must reach the sink")
                .expect("the sink must stay open")
        }
    }

    struct Reply {
        status: u16,
        headers: Vec<(String, String)>,
        body: Vec<u8>,
    }

    impl Reply {
        fn header(&self, name: &str) -> Option<&str> {
            self.headers
                .iter()
                .find(|(header, _)| header == name)
                .map(|(_, value)| value.as_str())
        }
    }

    fn sample_base64(text: &[u8]) -> String {
        base64::engine::general_purpose::STANDARD.encode(text)
    }

    /// The first [`PORT_RANGE`] port that binds, as a live listener and its
    /// port. Binding port 0 hands out an ephemeral port outside the range,
    /// which [`KeptPort::load`] must refuse, so these tests scan from a
    /// clock-derived start instead.
    fn held_port_in_range() -> (std::net::TcpListener, u16) {
        let size = u32::from(*PORT_RANGE.end() - *PORT_RANGE.start()) + 1;
        let start = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |elapsed| elapsed.subsec_nanos() % size);
        for offset in 0..size {
            let port = *PORT_RANGE.start() + ((start + offset) % size) as u16;
            if let Ok(socket) = std::net::TcpListener::bind(("127.0.0.1", port)) {
                return (socket, port);
            }
        }
        panic!("no free port in {PORT_RANGE:?}");
    }

    /// [`held_port_in_range`] with the socket dropped: the port is free, but
    /// still inside the range a kept file accepts.
    fn free_port_in_range() -> u16 {
        let (socket, port) = held_port_in_range();
        drop(socket);
        port
    }

    fn raw(
        method: &str,
        path: &str,
        host: &str,
        origin: Option<&str>,
        headers: &[(&str, &str)],
        body: &[u8],
    ) -> Vec<u8> {
        let mut head = format!("{method} {path} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n");
        if let Some(origin) = origin {
            head.push_str(&format!("Origin: {origin}\r\n"));
        }
        for (name, value) in headers {
            head.push_str(&format!("{name}: {value}\r\n"));
        }
        if !body.is_empty() {
            head.push_str(&format!("Content-Length: {}\r\n", body.len()));
        }
        head.push_str("\r\n");
        let mut request = head.into_bytes();
        request.extend_from_slice(body);
        request
    }

    async fn send_raw(port: u16, request: &[u8]) -> Reply {
        let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", port))
            .await
            .expect("the endpoint must accept");
        stream.write_all(request).await.expect("the request writes");
        let mut bytes = Vec::new();
        stream
            .read_to_end(&mut bytes)
            .await
            .expect("the answer reads");
        parse(&bytes)
    }

    fn parse(bytes: &[u8]) -> Reply {
        let split = bytes
            .windows(4)
            .position(|window| window == b"\r\n\r\n")
            .expect("a response head");
        let head = String::from_utf8_lossy(&bytes[..split]).into_owned();
        let mut lines = head.split("\r\n");
        let status = lines
            .next()
            .and_then(|line| line.split_whitespace().nth(1))
            .and_then(|code| code.parse().ok())
            .expect("a status line");
        let headers: Vec<(String, String)> = lines
            .filter_map(|line| {
                let (name, value) = line.split_once(':')?;
                Some((name.to_ascii_lowercase(), value.trim().to_string()))
            })
            .collect();
        let rest = &bytes[split + 4..];
        let chunked = headers.iter().any(|(name, value)| {
            name == "transfer-encoding" && value.to_ascii_lowercase().contains("chunked")
        });
        Reply {
            status,
            headers,
            body: match chunked {
                true => unchunk(rest),
                false => rest.to_vec(),
            },
        }
    }

    fn unchunk(bytes: &[u8]) -> Vec<u8> {
        let mut body = Vec::new();
        let mut rest = bytes;
        while let Some(end) = rest.windows(2).position(|window| window == b"\r\n") {
            let Some(size) = rest[..end]
                .split(|byte| *byte == b';')
                .next()
                .and_then(|size| std::str::from_utf8(size).ok())
                .and_then(|size| usize::from_str_radix(size.trim(), 16).ok())
            else {
                break;
            };
            rest = &rest[end + 2..];
            if size == 0 {
                break;
            }
            let take = size.min(rest.len());
            body.extend_from_slice(&rest[..take]);
            rest = &rest[(take + 2).min(rest.len())..];
        }
        body
    }

    async fn refused(port: u16) -> bool {
        tokio::net::TcpStream::connect(("127.0.0.1", port))
            .await
            .is_err()
    }

    /// The port closes asynchronously: the accept task has to be scheduled
    /// once after the shutdown signal.
    async fn eventually_refused(port: u16) -> bool {
        for _ in 0..100 {
            if refused(port).await {
                return true;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        false
    }

    /// The webview reads these shapes: a rename here is a protocol break U3/U4
    /// would only find at runtime.
    #[test]
    fn serialises_the_wire_shapes_the_host_expects() {
        let message = EndpointRequestMsg {
            request_id: "7".to_string(),
            plugin_id: "acme".to_string(),
            request: EndpointRequest {
                method: "POST".to_string(),
                path: "/plugin/acme/mcp?x=1".to_string(),
                headers: vec![("host".to_string(), "127.0.0.1:29217".to_string())],
                body: String::new(),
            },
        };
        assert_eq!(
            serde_json::to_value(&message).expect("a request message"),
            serde_json::json!({
                "requestId": "7",
                "pluginId": "acme",
                "request": {
                    "method": "POST",
                    "path": "/plugin/acme/mcp?x=1",
                    "headers": [["host", "127.0.0.1:29217"]],
                    "body": "",
                },
            })
        );
        assert_eq!(
            serde_json::to_value(ListenerState::Off).expect("off"),
            serde_json::json!({ "state": "off" })
        );
        assert_eq!(
            serde_json::to_value(ListenerState::Listening { port: 29217 }).expect("listening"),
            serde_json::json!({ "state": "listening", "port": 29217 })
        );
        assert_eq!(
            serde_json::to_value(ListenerState::Failed {
                port: 29217,
                reason: "in use".to_string(),
            })
            .expect("failed"),
            serde_json::json!({ "state": "failed", "port": 29217, "reason": "in use" })
        );
    }

    #[tokio::test]
    async fn binds_only_while_a_plugin_serves() {
        let port = free_port_in_range();
        let file = PortFile::new("bind-only");
        file.write(port);
        let state = EndpointState::for_tests(file.path(), Duration::from_secs(5), random_port);
        let (sender, _inbox) = inbox::unbounded_channel();
        let sink = Sink(sender);

        // No Plugin serves: nothing listens at all, not a port answering 404.
        assert_eq!(state.sync(Vec::new(), sink.clone()), ListenerState::Off);
        assert!(
            refused(port).await,
            "an empty serving set must not bind the port"
        );

        assert_eq!(
            state.sync(vec![PLUGIN.to_string()], sink.clone()),
            ListenerState::Listening { port }
        );
        assert!(!refused(port).await, "a serving Plugin binds the port");

        // The last Plugin stops serving: the port closes behind it.
        assert_eq!(state.sync(Vec::new(), sink), ListenerState::Off);
        assert!(
            eventually_refused(port).await,
            "the port must close when the last Plugin stops serving"
        );
    }

    #[tokio::test]
    async fn swaps_the_request_sink_on_every_sync() {
        let mut endpoint = Endpoint::serving(&[PLUGIN]).await;
        let port = endpoint.port;
        // A webview reload opens a fresh Channel and syncs again while the
        // listener stays bound: later requests must reach the new Channel.
        let (sender, mut reloaded) = inbox::unbounded_channel();
        assert_eq!(
            endpoint.state.sync(vec![PLUGIN.to_string()], Sink(sender)),
            ListenerState::Listening { port }
        );

        let client = tokio::spawn(async move {
            send_raw(
                port,
                &raw(
                    "GET",
                    "/plugin/acme/mcp",
                    &format!("127.0.0.1:{port}"),
                    None,
                    &[],
                    b"",
                ),
            )
            .await
        });
        let message = tokio::time::timeout(Duration::from_secs(5), reloaded.recv())
            .await
            .expect("the request must reach the new sink")
            .expect("the new sink must stay open");
        endpoint
            .state
            .respond(&message.request_id, 200, Vec::new(), None, false)
            .expect("the answer reaches the request");
        assert_eq!(client.await.expect("the client answers").status, 200);
        assert!(
            endpoint.inbox.try_recv().is_err(),
            "the replaced sink must get nothing"
        );
    }

    #[tokio::test]
    async fn routes_each_request_to_the_plugin_that_serves_it() {
        let mut endpoint = Endpoint::serving(&["acme", "beta"]).await;
        let port = endpoint.port;
        let host = endpoint.host();

        let client = tokio::spawn({
            let host = host.clone();
            async move {
                send_raw(
                    port,
                    &raw(
                        "POST",
                        "/plugin/beta/mcp?x=1",
                        &host,
                        None,
                        &[("X-Test", "one"), ("X-Test", "two")],
                        b"hello",
                    ),
                )
                .await
            }
        });
        let message = endpoint.next().await;
        assert_eq!(message.plugin_id, "beta");
        assert_eq!(message.request.method, "POST");
        assert_eq!(message.request.path, "/plugin/beta/mcp?x=1");
        assert_eq!(message.request.body, sample_base64(b"hello"));
        assert!(message
            .request
            .headers
            .contains(&("x-test".to_string(), "one".to_string())));
        assert!(message
            .request
            .headers
            .contains(&("x-test".to_string(), "two".to_string())));
        assert!(message
            .request
            .headers
            .iter()
            .all(|(name, _)| *name == name.to_ascii_lowercase()));
        endpoint
            .state
            .respond(
                &message.request_id,
                201,
                vec![
                    ("content-type".to_string(), "text/plain".to_string()),
                    ("x-answer".to_string(), "yes".to_string()),
                ],
                Some(&sample_base64(b"world")),
                false,
            )
            .expect("the answer reaches the request");
        let reply = client.await.expect("the client answers");
        assert_eq!(reply.status, 201);
        assert_eq!(reply.body, b"world");
        assert_eq!(reply.header("x-answer"), Some("yes"));
        assert_eq!(reply.header("content-length"), Some("5"));

        let other = tokio::spawn({
            let host = host.clone();
            async move { send_raw(port, &raw("GET", "/plugin/acme", &host, None, &[], b"")).await }
        });
        let message = endpoint.next().await;
        assert_eq!(message.plugin_id, "acme");
        endpoint
            .state
            .respond(&message.request_id, 204, Vec::new(), None, false)
            .expect("the answer reaches the request");
        assert_eq!(other.await.expect("the client answers").status, 204);
        assert!(
            endpoint.inbox.try_recv().is_err(),
            "two Plugins never see each other's requests"
        );
    }

    #[tokio::test]
    async fn answers_a_plugin_that_does_not_serve_with_404() {
        let mut endpoint = Endpoint::serving(&["acme"]).await;
        let reply = endpoint.get("/plugin/beta/mcp").await;
        assert_eq!(reply.status, 404);
        assert!(
            endpoint.inbox.try_recv().is_err(),
            "a Plugin must not see a request for another Plugin"
        );
    }

    #[tokio::test]
    async fn answers_a_foreign_path_with_404() {
        let mut endpoint = Endpoint::serving(&["acme"]).await;
        for path in ["/", "/foo", "/plugins/acme/mcp", "/plugin/", "/plugin"] {
            assert_eq!(endpoint.get(path).await.status, 404, "{path}");
        }
        assert!(endpoint.inbox.try_recv().is_err());
    }

    #[tokio::test]
    async fn rejects_a_foreign_origin_with_403() {
        let mut endpoint = Endpoint::serving(&["acme"]).await;
        let port = endpoint.port;
        let reply = endpoint
            .send(
                "GET",
                "/plugin/acme/mcp",
                None,
                Some(&format!("http://evil.test:{port}")),
                &[],
                b"",
            )
            .await;
        assert_eq!(reply.status, 403);
        // A page on one loopback port is not the page the Endpoint served.
        let reply = endpoint
            .send(
                "GET",
                "/plugin/acme/mcp",
                None,
                Some("http://127.0.0.1:1"),
                &[],
                b"",
            )
            .await;
        assert_eq!(reply.status, 403);
        assert!(endpoint.inbox.try_recv().is_err());
    }

    #[tokio::test]
    async fn accepts_loopback_origins_and_no_origin_at_all() {
        let mut endpoint = Endpoint::serving(&["acme"]).await;
        let port = endpoint.port;
        for origin in [
            Some(format!("http://127.0.0.1:{port}")),
            Some(format!("http://localhost:{port}")),
            None,
        ] {
            let client = tokio::spawn({
                let origin = origin.clone();
                async move {
                    let request = raw(
                        "GET",
                        "/plugin/acme/mcp",
                        &format!("127.0.0.1:{port}"),
                        origin.as_deref(),
                        &[],
                        b"",
                    );
                    send_raw(port, &request).await
                }
            });
            let message = endpoint.next().await;
            endpoint
                .state
                .respond(&message.request_id, 204, Vec::new(), None, false)
                .expect("the answer reaches the request");
            assert_eq!(client.await.expect("the client answers").status, 204);
        }
    }

    #[tokio::test]
    async fn rejects_a_foreign_host_with_421() {
        let mut endpoint = Endpoint::serving(&["acme"]).await;
        let port = endpoint.port;
        let evil = format!("evil.com:{port}");
        let reply = endpoint
            .send("GET", "/plugin/acme/mcp", Some(&evil), None, &[], b"")
            .await;
        assert_eq!(reply.status, 421);
        assert!(endpoint.inbox.try_recv().is_err());

        let client = tokio::spawn(async move {
            send_raw(
                port,
                &raw(
                    "GET",
                    "/plugin/acme/mcp",
                    &format!("localhost:{port}"),
                    None,
                    &[],
                    b"",
                ),
            )
            .await
        });
        let message = endpoint.next().await;
        endpoint
            .state
            .respond(&message.request_id, 200, Vec::new(), None, false)
            .expect("the answer reaches the request");
        assert_eq!(client.await.expect("the client answers").status, 200);
    }

    #[tokio::test]
    async fn streams_an_answer_in_chunks() {
        let mut endpoint = Endpoint::serving(&["acme"]).await;
        let port = endpoint.port;
        let (first_seen, seen) = oneshot::channel();
        let client = tokio::spawn(async move {
            let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", port))
                .await
                .expect("the endpoint must accept");
            stream
                .write_all(&raw(
                    "GET",
                    "/plugin/acme/mcp",
                    &format!("127.0.0.1:{port}"),
                    None,
                    &[],
                    b"",
                ))
                .await
                .expect("the request writes");
            let mut bytes = Vec::new();
            let mut buffer = [0u8; 512];
            let mut seen = Some(first_seen);
            loop {
                let read = stream.read(&mut buffer).await.expect("the answer reads");
                if read == 0 {
                    break;
                }
                bytes.extend_from_slice(&buffer[..read]);
                if String::from_utf8_lossy(&bytes).contains("first") {
                    if let Some(seen) = seen.take() {
                        let _ = seen.send(());
                    }
                }
            }
            bytes
        });

        let message = endpoint.next().await;
        endpoint
            .state
            .respond(
                &message.request_id,
                200,
                vec![("content-type".to_string(), "text/plain".to_string())],
                None,
                true,
            )
            .expect("the stream starts");
        let first = sample_base64(b"first");
        let second = sample_base64(b"second");
        assert!(endpoint.state.chunk(&message.request_id, &first).unwrap());
        tokio::time::timeout(Duration::from_secs(5), seen)
            .await
            .expect("the first chunk must reach the client before the answer ends")
            .expect("the client must still be there");
        assert!(endpoint.state.chunk(&message.request_id, &second).unwrap());
        endpoint
            .state
            .end(&message.request_id)
            .expect("the stream ends");
        assert!(
            endpoint.state.chunk(&message.request_id, &first).is_err(),
            "a finished request accepts no chunks"
        );

        let reply = parse(&client.await.expect("the client answers"));
        assert_eq!(reply.status, 200);
        assert_eq!(reply.header("transfer-encoding"), Some("chunked"));
        assert_eq!(reply.header("content-length"), None);
        assert_eq!(reply.body, b"firstsecond");
    }

    #[tokio::test]
    async fn forgets_a_request_when_the_client_disconnects_before_the_answer() {
        let mut endpoint = Endpoint::serving(&["acme"]).await;
        let port = endpoint.port;
        let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", port))
            .await
            .expect("the endpoint must accept");
        stream
            .write_all(&raw(
                "GET",
                "/plugin/acme/mcp",
                &format!("127.0.0.1:{port}"),
                None,
                &[],
                b"",
            ))
            .await
            .expect("the request writes");
        let _message = endpoint.next().await;
        assert_eq!(
            endpoint.state.pending_len(),
            1,
            "the request waits for an answer"
        );
        drop(stream);

        let mut gone = false;
        for _ in 0..100 {
            if endpoint.state.pending_len() == 0 {
                gone = true;
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        assert!(
            gone,
            "a client that hangs up must not leave a pending entry"
        );
    }

    #[tokio::test]
    async fn forgets_a_stream_when_the_client_hangs_up_mid_stream() {
        let mut endpoint = Endpoint::serving(&["acme"]).await;
        let port = endpoint.port;
        let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", port))
            .await
            .expect("the endpoint must accept");
        stream
            .write_all(&raw(
                "GET",
                "/plugin/acme/mcp",
                &format!("127.0.0.1:{port}"),
                None,
                &[],
                b"",
            ))
            .await
            .expect("the request writes");
        let message = endpoint.next().await;
        endpoint
            .state
            .respond(&message.request_id, 200, Vec::new(), None, true)
            .expect("the stream starts");
        drop(stream);

        let mut gone = false;
        for _ in 0..100 {
            if endpoint.state.pending_len() == 0 {
                gone = true;
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        assert!(
            gone,
            "the streaming body must drop its pending entry when the client hangs up"
        );
        assert!(
            !endpoint
                .state
                .chunk(&message.request_id, &sample_base64(b"chunk"))
                .unwrap_or(false),
            "chunk must report a client that hung up"
        );
    }

    #[tokio::test]
    async fn ends_an_idle_stream_at_the_answer_timeout() {
        let mut endpoint = Endpoint::on(Duration::from_millis(300), &["acme"]).await;
        let port = endpoint.port;
        let client = tokio::spawn(async move {
            send_raw(
                port,
                &raw(
                    "GET",
                    "/plugin/acme/mcp",
                    &format!("127.0.0.1:{port}"),
                    None,
                    &[],
                    b"",
                ),
            )
            .await
        });
        let message = endpoint.next().await;
        endpoint
            .state
            .respond(&message.request_id, 200, Vec::new(), None, true)
            .expect("the stream starts");

        let reply = tokio::time::timeout(Duration::from_secs(5), client)
            .await
            .expect("an idle stream must end")
            .expect("the client answers");
        assert_eq!(reply.status, 200);
        assert!(reply.body.is_empty());
        assert_eq!(
            endpoint.state.pending_len(),
            0,
            "an idle stream must not leave its entry behind"
        );
    }

    #[tokio::test]
    async fn answers_204_without_a_content_length() {
        let mut endpoint = Endpoint::serving(&["acme"]).await;
        let port = endpoint.port;
        let client = tokio::spawn(async move {
            send_raw(
                port,
                &raw(
                    "GET",
                    "/plugin/acme/mcp",
                    &format!("127.0.0.1:{port}"),
                    None,
                    &[],
                    b"",
                ),
            )
            .await
        });
        let message = endpoint.next().await;
        endpoint
            .state
            .respond(&message.request_id, 204, Vec::new(), None, false)
            .expect("the answer reaches the request");
        let reply = client.await.expect("the client answers");
        assert_eq!(reply.status, 204);
        assert_eq!(
            reply.header("content-length"),
            None,
            "RFC 9110 forbids Content-Length on a 204"
        );
        assert!(reply.body.is_empty());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn binds_the_same_port_again_right_after_shutdown() {
        let mut port = 0;
        for _ in 0..20 {
            let listener =
                Listener::bind(port, |_: EndpointRequestMsg| {}).expect("the port is free again");
            port = listener.port();
            tokio::task::yield_now().await;
            listener.shutdown();
        }
    }

    #[tokio::test]
    async fn chunk_reports_a_client_that_hung_up() {
        let mut endpoint = Endpoint::serving(&["acme"]).await;
        let port = endpoint.port;
        let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", port))
            .await
            .expect("the endpoint must accept");
        stream
            .write_all(&raw(
                "GET",
                "/plugin/acme/mcp",
                &format!("127.0.0.1:{port}"),
                None,
                &[],
                b"",
            ))
            .await
            .expect("the request writes");
        let message = endpoint.next().await;
        endpoint
            .state
            .respond(&message.request_id, 200, Vec::new(), None, true)
            .expect("the stream starts");
        drop(stream);

        let chunk = sample_base64(b"chunk");
        let mut delivered = true;
        for _ in 0..100 {
            match endpoint.state.chunk(&message.request_id, &chunk) {
                Ok(true) => tokio::time::sleep(Duration::from_millis(10)).await,
                Ok(false) => {
                    delivered = false;
                    break;
                }
                Err(error) => panic!("{error}"),
            }
        }
        assert!(!delivered, "chunk must report a client that hung up");
    }

    #[tokio::test]
    async fn answers_504_when_the_plugin_never_answers() {
        let mut endpoint = Endpoint::on(Duration::from_millis(150), &["acme"]).await;
        let reply = endpoint.get("/plugin/acme/mcp").await;
        assert_eq!(reply.status, 504);
        let message = endpoint
            .inbox
            .try_recv()
            .expect("the request was delivered");
        assert!(
            endpoint
                .state
                .respond(&message.request_id, 200, Vec::new(), None, false)
                .is_err(),
            "a timed out request accepts no answer"
        );
    }

    #[tokio::test]
    async fn refuses_a_body_over_4_mib_with_413() {
        let mut endpoint = Endpoint::serving(&["acme"]).await;
        let body = vec![b'x'; MAX_BODY_BYTES + 1];
        let reply = endpoint
            .send("POST", "/plugin/acme/upload", None, None, &[], &body)
            .await;
        assert_eq!(reply.status, 413);
        assert!(
            endpoint.inbox.try_recv().is_err(),
            "an oversized body must not reach a Plugin"
        );
    }

    #[tokio::test]
    async fn reports_a_failed_bind_when_the_port_is_taken() {
        let held = std::net::TcpListener::bind(("127.0.0.1", 0)).expect("a held port");
        let port = held.local_addr().expect("the held address").port();
        let (sender, _inbox) = inbox::unbounded_channel();
        assert!(
            Listener::bind(port, Sink(sender.clone())).is_err(),
            "a taken port is a bind error"
        );
        // The picker keeps naming the held port, so every move attempt fails
        // too: the report names the candidate the kept port started with, and
        // the file is left untouched.
        let file = PortFile::new("taken");
        file.write(port);
        let state = EndpointState::for_tests(file.path(), Duration::from_secs(5), move || port);
        match state.sync(vec![PLUGIN.to_string()], Sink(sender)) {
            ListenerState::Failed {
                port: failed,
                reason,
            } => {
                assert_eq!(failed, port);
                assert!(reason.contains(&port.to_string()), "{reason}");
            }
            other => panic!("expected a failed bind, got {other:?}"),
        }
        assert_eq!(file.read(), Some(port), "a failed bind keeps nothing");
    }

    #[tokio::test]
    async fn fails_a_pending_request_with_503_when_the_last_plugin_stops_serving() {
        let mut endpoint = Endpoint::serving(&["acme"]).await;
        let port = endpoint.port;
        let client = tokio::spawn(async move {
            send_raw(
                port,
                &raw(
                    "GET",
                    "/plugin/acme/mcp",
                    &format!("127.0.0.1:{port}"),
                    None,
                    &[],
                    b"",
                ),
            )
            .await
        });
        let _message = endpoint.next().await;
        let sink = endpoint.sink.clone();
        assert_eq!(endpoint.state.sync(Vec::new(), sink), ListenerState::Off);
        assert_eq!(client.await.expect("the client answers").status, 503);
    }

    #[tokio::test]
    async fn kept_port_is_reused() {
        let port = free_port_in_range();
        let file = PortFile::new("kept");
        file.write(port);
        let state = EndpointState::for_tests(file.path(), Duration::from_secs(5), random_port);
        let (sender, _inbox) = inbox::unbounded_channel();

        assert_eq!(
            state.sync(vec![PLUGIN.to_string()], Sink(sender)),
            ListenerState::Listening { port }
        );
        assert!(!refused(port).await, "the kept port listens");
        assert_eq!(file.read(), Some(port), "the kept port stays in the file");
    }

    #[tokio::test]
    async fn held_port_moves_to_a_free_one_in_the_range() {
        // The kept port is in the range and held by another app, which is the
        // collision the move exists for. `_held` keeps it bound all test long.
        let (_held, port) = held_port_in_range();
        let file = PortFile::new("moved");
        file.write(port);
        let state =
            EndpointState::for_tests(file.path(), Duration::from_secs(5), scanning_picker());
        let (sender, _inbox) = inbox::unbounded_channel();

        let moved = match state.sync(vec![PLUGIN.to_string()], Sink(sender)) {
            ListenerState::Listening { port } => port,
            other => panic!("expected a moved listener, got {other:?}"),
        };

        assert_ne!(moved, port, "a held port must be left alone");
        assert!(
            PORT_RANGE.contains(&moved),
            "{moved} is outside {PORT_RANGE:?}"
        );
        assert!(!refused(moved).await, "the moved port listens");
        assert_eq!(file.read(), Some(moved), "the move is kept");
    }

    #[tokio::test]
    async fn moved_port_is_kept_on_next_launch() {
        let (held, port) = held_port_in_range();
        let file = PortFile::new("next-launch");
        file.write(port);

        let first =
            EndpointState::for_tests(file.path(), Duration::from_secs(5), scanning_picker());
        let (sender, _inbox) = inbox::unbounded_channel();
        let moved = match first.sync(vec![PLUGIN.to_string()], Sink(sender)) {
            ListenerState::Listening { port } => port,
            other => panic!("expected a moved listener, got {other:?}"),
        };
        assert_ne!(moved, port);

        // The first launch closes its socket before the next one binds it, and
        // the port it moved away from is free again.
        let (sender, _inbox) = inbox::unbounded_channel();
        assert_eq!(
            first.sync(Vec::new(), Sink(sender)),
            ListenerState::Off,
            "the last Plugin stops serving"
        );
        drop(first);
        drop(held);
        assert!(eventually_refused(moved).await);

        let second =
            EndpointState::for_tests(file.path(), Duration::from_secs(5), scanning_picker());
        let (sender, _inbox) = inbox::unbounded_channel();
        assert_eq!(
            second.sync(vec![PLUGIN.to_string()], Sink(sender)),
            ListenerState::Listening { port: moved },
            "the moved port is what the next launch keeps"
        );
    }

    #[tokio::test]
    async fn first_launch_picks_and_saves_a_port_in_the_range() {
        let file = PortFile::new("first-launch");
        // No file yet: the folders on the way are the save's to create.
        let path = file.path().join("data").join("plugin-endpoint-port");
        let state =
            EndpointState::for_tests(path.clone(), Duration::from_secs(5), scanning_picker());
        let (sender, _inbox) = inbox::unbounded_channel();

        let port = match state.sync(vec![PLUGIN.to_string()], Sink(sender)) {
            ListenerState::Listening { port } => port,
            other => panic!("expected a picked listener, got {other:?}"),
        };

        assert!(
            PORT_RANGE.contains(&port),
            "{port} is outside {PORT_RANGE:?}"
        );
        assert_eq!(
            std::fs::read_to_string(&path).ok(),
            Some(port.to_string()),
            "the picked port is kept"
        );
        let _ = std::fs::remove_dir_all(file.path());
    }

    #[test]
    fn kept_port_load_ignores_garbage_and_out_of_range_values() {
        let file = PortFile::new("load");

        assert_eq!(
            KeptPort::new(file.path()).load(),
            None,
            "a missing file keeps no port"
        );

        for text in ["", "not a port", "0", "999", "40000", "-1", "29217x"] {
            std::fs::write(file.path(), text).expect("the port file writes");
            assert_eq!(KeptPort::new(file.path()).load(), None, "{text:?}");
        }

        let port = *PORT_RANGE.start();
        std::fs::write(file.path(), format!(" {port}\n")).expect("the port file writes");
        assert_eq!(KeptPort::new(file.path()).load(), Some(port));
    }

    /// Two syncs racing on a fresh state must make one listener, not two: the
    /// second used to see the port its sibling had just bound, move off it,
    /// and overwrite the slot while the first listener kept serving.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn concurrent_first_syncs_bind_one_listener() {
        let file = PortFile::new("concurrent");
        let state = Arc::new(EndpointState::for_tests(
            file.path(),
            Duration::from_secs(5),
            random_port,
        ));
        let barrier = Arc::new(std::sync::Barrier::new(2));

        let mut tasks = Vec::new();
        for _ in 0..2 {
            let state = Arc::clone(&state);
            let barrier = Arc::clone(&barrier);
            tasks.push(tokio::task::spawn_blocking(move || {
                let (sender, _inbox) = inbox::unbounded_channel();
                barrier.wait();
                state.sync(vec![PLUGIN.to_string()], Sink(sender))
            }));
        }

        let mut ports = Vec::new();
        for task in tasks {
            match task.await.expect("the sync task runs") {
                ListenerState::Listening { port } => ports.push(port),
                other => panic!("expected a bound listener, got {other:?}"),
            }
        }

        assert_eq!(ports[0], ports[1], "one listener, one port");
        assert_eq!(
            file.read(),
            Some(ports[0]),
            "the kept file holds the bound port"
        );
    }
}
