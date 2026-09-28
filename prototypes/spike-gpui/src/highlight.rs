//! Background Tree-sitter highlighting of a parsed diff, using gpui-kit's
//! `SyntaxHighlighter` (tree-sitter-rust + gpui-kit's default light theme).
//!
//! Each file's reconstructed old and new sources are parsed once on worker
//! threads. Files nearest the viewport go first (`priority` holds the file the
//! view is looking at). Results are compact per-line spans that index a small
//! per-file style palette.

use std::{
    ops::Range,
    sync::{
        Arc, Mutex, OnceLock,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
    time::Instant,
};

use gpui_kit::HighlightStyle;
use gpui_kit::component::highlighter::{HighlightTheme, SyntaxHighlighter};

use crate::diff::{Doc, Kind};

#[derive(Clone, Copy)]
pub struct Span {
    pub start: u32,
    pub end: u32,
    pub style: u16,
}

pub struct FileHl {
    pub palette: Vec<HighlightStyle>,
    /// Indexed by `row - file.first_row`.
    pub lines: Vec<Vec<Span>>,
}

pub struct HlStore {
    pub files: Vec<OnceLock<Arc<FileHl>>>,
    claimed: Mutex<Vec<bool>>,
    pub priority: AtomicUsize,
    pub cancelled: AtomicBool,
    pub dirty: AtomicBool,
    pub done: AtomicUsize,
    pub started: Instant,
    pub finished_ms: Mutex<Option<f64>>,
}

impl HlStore {
    pub fn get(&self, file: usize) -> Option<&Arc<FileHl>> {
        self.files.get(file).and_then(|f| f.get())
    }
}

pub fn spawn(doc: Arc<Doc>, workers: usize) -> Arc<HlStore> {
    let n = doc.files.len();
    let store = Arc::new(HlStore {
        files: (0..n).map(|_| OnceLock::new()).collect(),
        claimed: Mutex::new(vec![false; n]),
        priority: AtomicUsize::new(0),
        cancelled: AtomicBool::new(false),
        dirty: AtomicBool::new(false),
        done: AtomicUsize::new(0),
        started: Instant::now(),
        finished_ms: Mutex::new(None),
    });
    for i in 0..workers {
        let doc = doc.clone();
        let store = store.clone();
        std::thread::Builder::new()
            .name(format!("hl-{i}"))
            .spawn(move || worker(doc, store))
            .unwrap();
    }
    store
}

fn next_file(store: &HlStore) -> Option<usize> {
    let mut claimed = store.claimed.lock().unwrap();
    let n = claimed.len();
    let p = store.priority.load(Ordering::Relaxed).min(n.saturating_sub(1));
    // Search outward from the viewport, preferring files below it.
    for d in 0..n {
        for ix in [p + d, p.wrapping_sub(d)] {
            if ix < n && !claimed[ix] {
                claimed[ix] = true;
                return Some(ix);
            }
        }
    }
    None
}

fn worker(doc: Arc<Doc>, store: Arc<HlStore>) {
    let theme = HighlightTheme::default_light();
    // One highlighter per worker: building one compiles the Rust queries (~20 ms).
    let mut h = SyntaxHighlighter::new("rust");
    while let Some(ix) = next_file(&store) {
        if store.cancelled.load(Ordering::Relaxed) {
            return;
        }
        let hl = highlight_file(&doc, ix, &theme, &mut h);
        let _ = store.files[ix].set(Arc::new(hl));
        store.dirty.store(true, Ordering::Relaxed);
        let done = store.done.fetch_add(1, Ordering::Relaxed) + 1;
        if done == store.files.len() {
            *store.finished_ms.lock().unwrap() = Some(store.started.elapsed().as_secs_f64() * 1e3);
        }
    }
}

fn side_spans(src: &str, theme: &HighlightTheme, h: &mut SyntaxHighlighter) -> Vec<(Range<usize>, HighlightStyle)> {
    if src.is_empty() {
        return Vec::new();
    }
    let rope = gpui_kit::component::Rope::from_str(src);
    h.update(None, &rope, None);
    h.styles(&(0..src.len()), theme)
}

fn highlight_file(doc: &Doc, ix: usize, theme: &HighlightTheme, h: &mut SyntaxHighlighter) -> FileHl {
    let f = &doc.files[ix];
    let rows = &doc.rows[f.first_row as usize..f.end_row as usize];
    let mut palette: Vec<HighlightStyle> = Vec::new();
    let mut lines: Vec<Vec<Span>> = vec![Vec::new(); rows.len()];
    if !f.is_rust {
        return FileHl { palette, lines };
    }
    let new_spans = side_spans(&f.new_src, theme, h);
    let old_spans = side_spans(&f.old_src, theme, h);
    for (i, row) in rows.iter().enumerate() {
        let spans = match row.kind {
            Kind::Add | Kind::Context => &new_spans,
            Kind::Del => &old_spans,
            _ => continue,
        };
        let ls = row.src_off as usize;
        let le = ls + row.len as usize;
        let mut k = spans.partition_point(|(r, _)| r.end <= ls);
        let out = &mut lines[i];
        while k < spans.len() && spans[k].0.start < le {
            let (r, style) = &spans[k];
            k += 1;
            if *style == HighlightStyle::default() {
                continue;
            }
            let s = r.start.max(ls) - ls;
            let e = r.end.min(le) - ls;
            if s >= e {
                continue;
            }
            let pi = match palette.iter().position(|p| p == style) {
                Some(p) => p,
                None => {
                    palette.push(*style);
                    palette.len() - 1
                }
            };
            out.push(Span { start: s as u32, end: e as u32, style: pi as u16 });
        }
    }
    FileHl { palette, lines }
}
