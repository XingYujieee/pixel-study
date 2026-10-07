//! 文件监听（风险 4）：notify + 200ms 去抖，交给 `VaultSession::reconcile` 对账并过滤自写入。

use crate::error::{Result, VaultError};
use crate::session::{VaultEvent, VaultSession};
use notify::event::{EventKind, ModifyKind, RenameMode};
use notify::RecursiveMode;
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, RecommendedCache};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

pub struct WatchHandle {
    _debouncer: Debouncer<notify::RecommendedWatcher, RecommendedCache>,
}

pub const DEBOUNCE: Duration = Duration::from_millis(200);

/// 开始监听整个库。每批变化对账后，非空事件列表交给 `sink`（在监听线程中调用）。
pub fn start_watch(
    session: Arc<Mutex<VaultSession>>,
    sink: impl Fn(Vec<VaultEvent>) + Send + 'static,
) -> Result<WatchHandle> {
    let root = session.lock().map_err(|_| VaultError::Watch("状态锁失效".into()))?.vault.root().to_path_buf();
    let s = session.clone();
    let mut debouncer = new_debouncer(DEBOUNCE, None, move |res: DebounceEventResult| {
        let Ok(events) = res else { return };
        let mut paths: Vec<PathBuf> = vec![];
        let mut renames: Vec<(PathBuf, PathBuf)> = vec![];
        for ev in events {
            match ev.event.kind {
                EventKind::Access(_) => {}
                EventKind::Modify(ModifyKind::Name(RenameMode::Both)) if ev.event.paths.len() == 2 => {
                    renames.push((ev.event.paths[0].clone(), ev.event.paths[1].clone()));
                }
                _ => paths.extend(ev.event.paths.iter().cloned()),
            }
        }
        if paths.is_empty() && renames.is_empty() {
            return;
        }
        let out = match s.lock() {
            Ok(mut guard) => guard.reconcile(paths, renames),
            Err(_) => return,
        };
        if !out.is_empty() {
            sink(out);
        }
    })
    .map_err(|e| VaultError::Watch(e.to_string()))?;
    debouncer.watch(&root, RecursiveMode::Recursive).map_err(|e| VaultError::Watch(e.to_string()))?;
    Ok(WatchHandle { _debouncer: debouncer })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::io::SaveOutcome;
    use crate::scope::Vault;
    use std::fs;
    use std::sync::mpsc;

    fn collect(rx: &mpsc::Receiver<Vec<VaultEvent>>, wait: Duration) -> Vec<VaultEvent> {
        let deadline = std::time::Instant::now() + wait;
        let mut all = vec![];
        while let Some(left) = deadline.checked_duration_since(std::time::Instant::now()) {
            match rx.recv_timeout(left) {
                Ok(mut v) => all.append(&mut v),
                Err(_) => break,
            }
        }
        all
    }

    #[test]
    fn real_watcher_reports_external_and_ignores_own_writes() {
        let d = tempfile::tempdir().unwrap();
        fs::write(d.path().join("笔记.md"), "v1").unwrap();
        let mut s = VaultSession::new(Vault::open(d.path()).unwrap());
        s.rescan(100, |_| {}).unwrap();
        let root = s.vault.root().to_path_buf();
        let session = Arc::new(Mutex::new(s));
        let (tx, rx) = mpsc::channel();
        let _h = start_watch(session.clone(), move |ev| {
            let _ = tx.send(ev);
        })
        .unwrap();
        std::thread::sleep(Duration::from_millis(300));

        // 连续自写入 20 次：不应产生任何事件
        for i in 0..20 {
            let mut g = session.lock().unwrap();
            let base = g.read("笔记.md").unwrap().hash;
            assert!(matches!(g.save("笔记.md", &format!("自写 {i}"), Some(&base)).unwrap(), SaveOutcome::Saved { .. }));
        }
        let own = collect(&rx, Duration::from_millis(1200));
        assert!(own.is_empty(), "自写入不应触发事件：{own:?}");

        // 外部修改：应收到 Modified
        fs::write(root.join("笔记.md"), "外部修改").unwrap();
        let ext = collect(&rx, Duration::from_millis(1500));
        assert!(
            ext.iter().any(|e| matches!(e, VaultEvent::Modified { entry, .. } if entry.path == "笔记.md")),
            "{ext:?}"
        );

        // 外部新建与删除
        fs::write(root.join("新建.md"), "x").unwrap();
        let ev = collect(&rx, Duration::from_millis(1500));
        assert!(ev.iter().any(|e| matches!(e, VaultEvent::Created { entry } if entry.path == "新建.md")), "{ev:?}");
        fs::remove_file(root.join("新建.md")).unwrap();
        let ev = collect(&rx, Duration::from_millis(1500));
        assert!(ev.contains(&VaultEvent::Removed { path: "新建.md".into() }), "{ev:?}");
    }
}
