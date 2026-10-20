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
use std::net::Ipv4Addr;
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

/// The Plugin Endpoint port. Below every OS ephemeral range, so an Agent's
/// `curl` reaches the app and never some other program's socket.
pub const DEFAULT_PORT: u16 = 29217;

/// A request body larger than this is refused with 413 before reaching a Plugin.
pub const MAX_BODY_BYTES: usize = 4 * 1024 * 1024;

/// How long a Plugin has to answer before the Agent gets 504.
pub const ANSWER_TIMEOUT: Duration = Duration::from_secs(30);

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

/// The state of one request: waiting for `respond`, or streaming chunks.
enum Stage {
    Waiting(oneshot::Sender<AnswerStart>),
    Streaming(mpsc::UnboundedSender<Bytes>),
}

/// The answer a Plugin started: everything the HTTP layer needs, including the
/// open chunk channel for a streamed one.
struct AnswerStart {
    status: StatusCode,
    headers: Vec<(HeaderName, HeaderValue)>,
    /// The whole body of a non-streamed answer.
    body: Option<Bytes>,
    /// Chunks of a streamed answer.
    chunks: Option<mpsc::UnboundedReceiver<Bytes>>,
}

/// The response body: one buffer with a known length, or chunks of unknown
/// length (hyper then frames with chunked transfer encoding).
enum AnswerBody {
    Whole(Option<Bytes>),
    Chunks(mpsc::UnboundedReceiver<Bytes>),
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
            AnswerBody::Chunks(chunks) => chunks
                .poll_recv(cx)
                .map(|chunk| chunk.map(|bytes| Ok(Frame::data(bytes)))),
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

    /// Removes a request nobody can answer any more.
    fn forget(&self, id: u64) {
        if let Ok(mut pending) = self.pending.lock() {
            pending.remove(&id);
        }
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
        let shared = Arc::new(Shared {
            port,
            answer_timeout,
            serving: RwLock::new(HashSet::new()),
            pending: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
            stop,
            sink: RwLock::new(Arc::new(sink)),
        });
        tokio::spawn(accept(Arc::clone(&shared), socket, stopped));
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
            Some(Stage::Streaming(_)) => {
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
        let Some(stage) = pending.get_mut(&id) else {
            return Err(format!("unknown request {request_id}"));
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
        let Some(stage) = pending.get(&id) else {
            return Err(format!("unknown request {request_id}"));
        };
        if matches!(stage, Stage::Waiting(_)) {
            return Err(format!("request {request_id} has no answer yet"));
        }
        // Dropping the sender ends the chunked body.
        pending.remove(&id);
        Ok(())
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

/// Accepts until `shutdown`. A shutdown wins over a racing accept: the port
/// must be closed, not reopened by one more request.
async fn accept(
    shared: Arc<Shared>,
    socket: tokio::net::TcpListener,
    mut stopped: watch::Receiver<bool>,
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
    {
        let Ok(mut pending) = shared.pending.lock() else {
            return plain(
                StatusCode::INTERNAL_SERVER_ERROR,
                "The Plugin Endpoint is unavailable",
            );
        };
        pending.insert(id, Stage::Waiting(answered));
    }
    let sink = shared.sink.read().ok().map(|sink| Arc::clone(&sink));
    let Some(sink) = sink else {
        shared.forget(id);
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
        Ok(Ok(start)) => start.into_response(),
        Ok(Err(_)) => plain(
            StatusCode::SERVICE_UNAVAILABLE,
            "The Plugin Endpoint is off",
        ),
        Err(_) => {
            shared.forget(id);
            plain(
                StatusCode::GATEWAY_TIMEOUT,
                "The Plugin did not answer in time",
            )
        }
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
    fn into_response(self) -> Response<AnswerBody> {
        let mut response = Response::new(match self.chunks {
            Some(chunks) => AnswerBody::Chunks(chunks),
            None => AnswerBody::Whole(Some(self.body.unwrap_or_default())),
        });
        *response.status_mut() = self.status;
        for (name, value) in self.headers {
            response.headers_mut().append(name, value);
        }
        if let AnswerBody::Whole(Some(bytes)) = response.body() {
            let length = bytes.len() as u64;
            response
                .headers_mut()
                .insert(CONTENT_LENGTH, HeaderValue::from(length));
        }
        response
    }
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

/// The listener behind `plugin_endpoint_*`, plus the set of Plugins that serve.
/// The commands are thin wrappers over this, so the state machine is testable
/// without a Tauri app.
pub struct EndpointState {
    port: u16,
    /// `None` uses [`ANSWER_TIMEOUT`]; tests shrink it.
    answer_timeout: Option<Duration>,
    listener: Mutex<Option<Listener>>,
}

impl Default for EndpointState {
    fn default() -> Self {
        Self {
            port: DEFAULT_PORT,
            answer_timeout: None,
            listener: Mutex::new(None),
        }
    }
}

impl EndpointState {
    #[cfg(test)]
    fn for_tests(port: u16, answer_timeout: Duration) -> Self {
        Self {
            port,
            answer_timeout: Some(answer_timeout),
            listener: Mutex::new(None),
        }
    }

    fn slot(&self) -> std::sync::MutexGuard<'_, Option<Listener>> {
        // A poisoned slot still holds the listener: there is nothing to undo.
        self.listener
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Binds while some Plugin serves, unbinds when none does, and otherwise
    /// replaces the set *and* the sink: a webview reload opens a fresh Channel,
    /// and later requests must reach that one. A failed bind is reported once
    /// and never retried: the host logs it and the author fixes the port.
    pub fn sync(&self, ids: Vec<String>, sink: impl RequestSink) -> ListenerState {
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
        let bound = match self.answer_timeout {
            Some(timeout) => Listener::bind_with_timeout(self.port, timeout, sink),
            None => Listener::bind(self.port, sink),
        };
        match bound {
            Ok(listener) => {
                listener.set_serving(ids);
                let state = listener.state();
                *self.slot() = Some(listener);
                state
            }
            Err(reason) => ListenerState::Failed {
                port: self.port,
                reason,
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

    /// A bound endpoint, the queue of what reached its sink, and the port.
    struct Endpoint {
        state: EndpointState,
        sink: Sink,
        inbox: inbox::UnboundedReceiver<EndpointRequestMsg>,
        port: u16,
    }

    impl Endpoint {
        async fn serving(ids: &[&str]) -> Self {
            Self::on(0, Duration::from_secs(5), ids).await
        }

        async fn on(port: u16, answer_timeout: Duration, ids: &[&str]) -> Self {
            let state = EndpointState::for_tests(port, answer_timeout);
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

    fn free_port() -> u16 {
        let socket = std::net::TcpListener::bind(("127.0.0.1", 0)).expect("a free port");
        socket.local_addr().expect("the bound address").port()
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
        let port = free_port();
        let state = EndpointState::for_tests(port, Duration::from_secs(5));
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
        let mut endpoint = Endpoint::on(0, Duration::from_millis(150), &["acme"]).await;
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
        let state = EndpointState::for_tests(port, Duration::from_secs(5));
        match state.sync(vec![PLUGIN.to_string()], Sink(sender)) {
            ListenerState::Failed {
                port: failed,
                reason,
            } => {
                assert_eq!(failed, port);
                assert!(!reason.is_empty());
            }
            other => panic!("expected a failed bind, got {other:?}"),
        }
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
}
