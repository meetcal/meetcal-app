use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::{Mutex, OnceLock};
use std::task::{Context, Poll};
use std::time::Duration;

use tokio::sync::watch;
use tower_layer::Layer;
use tower_service::Service;

use crate::utils::transport::CONNECT_TIMEOUT;

pub(crate) const POOL_SETTLE: Duration = Duration::from_millis(25);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Gate {
    Cold,
    Connecting,
    Connected,
}

fn connections_made() -> &'static watch::Sender<u64> {
    static MADE: OnceLock<watch::Sender<u64>> = OnceLock::new();
    MADE.get_or_init(|| watch::channel(0).0)
}

fn gate_of(origin: &str) -> watch::Sender<Gate> {
    static GATES: OnceLock<Mutex<HashMap<String, watch::Sender<Gate>>>> = OnceLock::new();
    let mut gates = GATES
        .get_or_init(Mutex::default)
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    gates
        .entry(origin.to_string())
        .or_insert_with(|| watch::channel(Gate::Cold).0)
        .clone()
}

#[derive(Debug)]
pub(crate) struct FirstOnConnection {
    gate: watch::Sender<Gate>,
}

impl FirstOnConnection {
    pub(crate) fn connected(self) {
        self.gate.send_replace(Gate::Connected);
    }
}

impl Drop for FirstOnConnection {
    fn drop(&mut self) {
        self.gate.send_if_modified(|gate| {
            let failed = *gate == Gate::Connecting;
            if failed {
                *gate = Gate::Cold;
            }
            failed
        });
    }
}

pub(crate) async fn wait_for_connection(origin: &str) -> Option<FirstOnConnection> {
    let gate = gate_of(origin);
    let mut watching = gate.subscribe();
    loop {
        let became_first = gate.send_if_modified(|state| {
            let cold = *state == Gate::Cold;
            if cold {
                *state = Gate::Connecting;
            }
            cold
        });
        if became_first {
            tokio::spawn(release_waiters_once_connected(gate.clone()));
            return Some(FirstOnConnection { gate });
        }
        if *watching.borrow_and_update() == Gate::Connected {
            return None;
        }
        if watching.changed().await.is_err() {
            return None;
        }
    }
}

async fn release_waiters_once_connected(gate: watch::Sender<Gate>) {
    let mut made = connections_made().subscribe();
    made.borrow_and_update();
    if let Ok(Ok(())) = tokio::time::timeout(CONNECT_TIMEOUT, made.changed()).await {
        tokio::time::sleep(POOL_SETTLE).await;
        gate.send_if_modified(|state| {
            let connecting = *state == Gate::Connecting;
            if connecting {
                *state = Gate::Connected;
            }
            connecting
        });
    }
}

#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct CountConnections;

impl<S> Layer<S> for CountConnections {
    type Service = Counted<S>;

    fn layer(&self, inner: S) -> Counted<S> {
        Counted(inner)
    }
}

#[derive(Clone, Debug)]
pub(crate) struct Counted<S>(S);

impl<S, R> Service<R> for Counted<S>
where
    S: Service<R>,
    S::Future: Send + 'static,
{
    type Response = S::Response;
    type Error = S::Error;
    type Future = Pin<Box<dyn Future<Output = Result<S::Response, S::Error>> + Send>>;

    fn poll_ready(&mut self, cx: &mut Context<'_>) -> Poll<Result<(), S::Error>> {
        self.0.poll_ready(cx)
    }

    fn call(&mut self, request: R) -> Self::Future {
        let connecting = self.0.call(request);
        Box::pin(async move {
            let connection = connecting.await?;
            connections_made().send_modify(|made| *made += 1);
            Ok(connection)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn origin(test: &str) -> String {
        format!("http://gate-{test}.invalid")
    }

    #[tokio::test]
    async fn the_first_read_goes_and_later_reads_wait_until_it_connects() {
        let origin = origin("connects");
        let first = wait_for_connection(&origin).await;
        assert!(first.is_some());
        let waiting = tokio::spawn({
            let origin = origin.clone();
            async move { wait_for_connection(&origin).await.is_none() }
        });
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert!(!waiting.is_finished());
        connections_made().send_modify(|made| *made += 1);
        let released = tokio::time::timeout(Duration::from_secs(2), waiting)
            .await
            .unwrap()
            .unwrap();
        assert!(released);
        assert!(wait_for_connection(&origin).await.is_none());
        drop(first);
        assert_eq!(*gate_of(&origin).borrow(), Gate::Connected);
    }

    #[tokio::test]
    async fn a_first_read_that_fails_to_connect_hands_the_gate_to_the_next() {
        let origin = origin("fails");
        let first = wait_for_connection(&origin).await;
        let waiting = tokio::spawn({
            let origin = origin.clone();
            async move { wait_for_connection(&origin).await }
        });
        tokio::time::sleep(Duration::from_millis(50)).await;
        drop(first);
        let next = tokio::time::timeout(Duration::from_secs(2), waiting)
            .await
            .unwrap()
            .unwrap();
        assert!(next.is_some(), "the next read did not become the first");
    }

    #[tokio::test]
    async fn an_answer_marks_the_origin_connected() {
        let origin = origin("answered");
        if let Some(first) = wait_for_connection(&origin).await {
            first.connected();
        }
        assert!(wait_for_connection(&origin).await.is_none());
    }
}
