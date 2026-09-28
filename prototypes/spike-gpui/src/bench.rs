//! Automated scenarios. Frame times come from GPUI's own frame trace
//! (`gpui::profiler`, `FrameEvent::Present`): `present_end` is when the frame's
//! Metal command buffer / drawable was handed to the platform.

use std::{
    path::PathBuf,
    sync::Arc,
    time::{Duration, Instant},
};

use gpui::profiler::{FrameEvent, FrameTimingCollector};
use gpui_kit::*;
use serde_json::{Value, json};

use crate::{AppView, DiffPane, Launch, ROW_H, load_doc, ws_action};

const SPEED: f32 = 4000.;

struct Frames {
    collector: FrameTimingCollector,
    events: Vec<FrameEvent>,
    /// Times a draw_end stood in for a missing Present.
    fallbacks: usize,
}

impl Frames {
    fn new() -> Self {
        Self { collector: FrameTimingCollector::new(), events: Vec::new(), fallbacks: 0 }
    }
    fn pump(&mut self) {
        self.events.extend(self.collector.collect_unseen());
    }
    fn presents(&mut self, w: WindowId, from: Instant, to: Instant) -> Vec<Instant> {
        self.pump();
        self.events
            .iter()
            .filter_map(|e| match e {
                FrameEvent::Present(p) if p.window_id == w && p.present_end >= from && p.present_end <= to => {
                    Some(p.present_end)
                }
                _ => None,
            })
            .collect()
    }
    fn draws_ms(&mut self, w: WindowId, from: Instant, to: Instant) -> Vec<f64> {
        self.pump();
        self.events
            .iter()
            .filter_map(|e| match e {
                FrameEvent::Draw(d) if d.window_id == w && d.draw_start >= from && d.draw_end <= to => {
                    Some(ms(d.draw_end - d.draw_start))
                }
                _ => None,
            })
            .collect()
    }
    fn first_present_after(&mut self, w: WindowId, t: Instant) -> Option<Instant> {
        self.pump();
        self.events.iter().find_map(|e| match e {
            FrameEvent::Present(p) if p.window_id == w && p.present_start >= t => Some(p.present_end),
            _ => None,
        })
    }
}

fn paints(w: WindowId, from: Instant, to: Instant) -> Vec<Instant> {
    crate::PAINTS.lock().unwrap().iter().filter(|(id, t)| *id == w && *t >= from && *t <= to).map(|x| x.1).collect()
}

fn ms(d: Duration) -> f64 {
    d.as_secs_f64() * 1e3
}

fn pct(sorted: &[f64], p: f64) -> f64 {
    if sorted.is_empty() {
        return f64::NAN;
    }
    let i = ((p / 100.) * (sorted.len() - 1) as f64).round() as usize;
    sorted[i.min(sorted.len() - 1)]
}

fn summary(values: &[f64]) -> Value {
    let mut v = values.to_vec();
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let n = v.len().max(1) as f64;
    json!({
        "count": v.len(),
        "p50": pct(&v, 50.), "p95": pct(&v, 95.), "p99": pct(&v, 99.),
        "max": v.last().copied().unwrap_or(f64::NAN),
        "mean": v.iter().sum::<f64>() / n,
    })
}

fn interval_summary(presents: &[Instant]) -> Value {
    let iv: Vec<f64> = presents.windows(2).map(|w| ms(w[1] - w[0])).collect();
    let mut s = summary(&iv);
    let n = iv.len().max(1) as f64;
    s["pct_over_8_33ms"] = json!(100. * iv.iter().filter(|&&x| x > 8.33).count() as f64 / n);
    s["pct_over_16_7ms"] = json!(100. * iv.iter().filter(|&&x| x > 16.7).count() as f64 / n);
    s
}

/// RSS of this process and all its descendants, via `ps`.
pub fn rss_tree() -> Value {
    let out = std::process::Command::new("ps").args(["-A", "-o", "pid=,ppid=,rss=,comm="]).output().unwrap();
    let text = String::from_utf8_lossy(&out.stdout);
    let procs: Vec<(u32, u32, u64, String)> = text
        .lines()
        .filter_map(|l| {
            let mut it = l.split_whitespace();
            let pid = it.next()?.parse().ok()?;
            let ppid = it.next()?.parse().ok()?;
            let rss = it.next()?.parse().ok()?;
            let comm = it.collect::<Vec<_>>().join(" ");
            Some((pid, ppid, rss, comm))
        })
        .collect();
    let me = std::process::id();
    let ps_pid = out_pid_hint(&procs, me);
    let mut tree = vec![me];
    let mut i = 0;
    while i < tree.len() {
        let p = tree[i];
        tree.extend(procs.iter().filter(|x| x.1 == p && Some(x.0) != ps_pid).map(|x| x.0));
        i += 1;
    }
    let mut list = Vec::new();
    let mut total_kb = 0;
    for (pid, _, rss, comm) in procs.iter().filter(|x| tree.contains(&x.0)) {
        total_kb += rss;
        list.push(json!({"pid": pid, "name": comm, "rss_mb": *rss as f64 / 1024.}));
    }
    json!({"total_rss_mb": total_kb as f64 / 1024., "processes": list})
}

/// The `ps` we just spawned is our child; leave it out of the total.
fn out_pid_hint(procs: &[(u32, u32, u64, String)], me: u32) -> Option<u32> {
    procs.iter().find(|x| x.1 == me && x.3.ends_with("ps")).map(|x| x.0)
}

fn results_dir() -> PathBuf {
    std::env::var("SPIKE_RESULTS")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/results")))
}

fn write(scenario: &str, mut v: Value) {
    v["spike"] = json!("gpui");
    v["scenario"] = json!(scenario);
    v["stack"] = json!("gpui-pre 0.3.6 + gpui-kit 0.6.6, release build");
    let ioreg = std::process::Command::new("ioreg").args(["-n", "Root", "-d1"]).output().map(|o| String::from_utf8_lossy(&o.stdout).to_string()).unwrap_or_default();
    let locked = ioreg.contains("\"CGSSessionScreenIsLocked\"=Yes");
    v["screen_locked"] = json!(locked);
    if locked {
        v["warning"] = json!("screen was locked: windows are occluded, macOS/GPUI throttle frames; frame numbers are not meaningful");
    }
    let dir = results_dir();
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join(format!("gpui-{scenario}.json"));
    std::fs::write(&path, serde_json::to_string_pretty(&v).unwrap()).unwrap();
    eprintln!("wrote {}", path.display());
}

struct Ctx {
    main: AnyWindowHandle,
    app: Entity<AppView>,
    frames: Frames,
}

impl Ctx {
    fn pane(&self, cx: &mut AsyncApp) -> Entity<DiffPane> {
        cx.update(|cx| self.app.read(cx).pane.clone())
    }
}

async fn sleep(cx: &mut AsyncApp, d: Duration) {
    cx.background_executor().timer(d).await;
}

/// Waits for `probe.rendered_at` on a pane, then for the frame presenting it.
async fn wait_pane_frame(c: &mut Ctx, w: AnyWindowHandle, pane: &Entity<DiffPane>, cx: &mut AsyncApp) -> (Instant, bool) {
    let (rendered, all_hl) = loop {
        if let Some(r) = cx.update(|cx| {
            let p = &pane.read(cx).probe;
            p.rendered_at.map(|t| (t, p.all_hl))
        }) {
            break r;
        }
        sleep(cx, Duration::from_millis(1)).await;
    };
    (wait_present(c, w, rendered, cx).await, all_hl)
}

async fn wait_present(c: &mut Ctx, w: AnyWindowHandle, after: Instant, cx: &mut AsyncApp) -> Instant {
    for i in 0..3000 {
        if let Some(t) = c.frames.first_present_after(w.window_id(), after) {
            return t;
        }
        // GPUI's profiler drops the Present of frames it considers invisible
        // (drawn before the window was shown, or occluded / screen locked).
        // Fall back to our paint marker; the present follows synchronously.
        if i > 50 {
            if let Some(t) = paints(w.window_id(), after, Instant::now()).first() {
                c.frames.fallbacks += 1;
                return *t;
            }
        }
        sleep(cx, Duration::from_millis(1)).await;
    }
    panic!("no present/paint after {after:?} in {:?}", w.window_id());
}

/// Loads a fixture off the main thread and swaps it into `pane`.
/// Returns (ms to first presented frame, parse ms, visible rows highlighted in that frame).
async fn open_in(c: &mut Ctx, w: AnyWindowHandle, pane: &Entity<DiffPane>, name: &str, cx: &mut AsyncApp) -> Value {
    let t0 = Instant::now();
    let n = name.to_string();
    let doc = cx.background_executor().spawn(async move { Arc::new(load_doc(&n)) }).await;
    let parsed = Instant::now();
    let rows = doc.rows.len();
    let files = doc.files.len();
    cx.update(|cx| {
        pane.update(cx, |p, cx| {
            p.set_doc(doc, cx);
            p.probe.arm();
        })
    });
    let (present, all_hl) = wait_pane_frame(c, w, pane, cx).await;
    // Time until the visible rows are highlighted and presented.
    let hl_t = loop {
        let ready = cx.update(|cx| pane.read(cx).probe.rendered_at.is_some() && !pane_missing(pane, cx));
        if ready {
            break Instant::now();
        }
        sleep(cx, Duration::from_millis(1)).await;
    };
    cx.update(|cx| pane.update(cx, |p, cx| {
        p.probe.arm();
        cx.notify();
    }));
    let (hl_present, _) = wait_pane_frame(c, w, pane, cx).await;
    let _ = hl_t;
    json!({
        "fixture": name,
        "rows": rows,
        "files": files,
        "ms_to_first_frame": ms(present - t0),
        "read_parse_ms": ms(parsed - t0),
        "first_frame_fully_highlighted": all_hl,
        "ms_to_highlighted_frame": ms(hl_present - t0),
    })
}

fn pane_missing(pane: &Entity<DiffPane>, cx: &App) -> bool {
    let p = pane.read(cx);
    let y = p.scroll_y();
    let first = (y / ROW_H).floor().max(0.) as usize;
    let last = (first + (p.viewport_h().max(900.) / ROW_H).ceil() as usize + 1).min(p.doc.rows.len());
    (first..last).any(|ix| {
        let f = p.doc.rows[ix].file as usize;
        p.doc.files[f].is_rust && p.hl.get(f).is_none()
    })
}

async fn scroll(c: &mut Ctx, w: AnyWindowHandle, pane: &Entity<DiffPane>, secs: f32, cx: &mut AsyncApp) -> Value {
    // GPUI throttles animation frames of inactive windows to 30 fps; scroll the key window.
    let _ = cx.update_window(w, |_, window, _| window.activate_window());
    sleep(cx, Duration::from_millis(300)).await;
    let active = cx.update_window(w, |_, window, _| window.is_window_active()).unwrap_or(false);
    let start = Instant::now();
    cx.update(|cx| {
        pane.update(cx, |p, cx| {
            p.log.clear();
            p.logging = true;
            p.start_autoscroll(SPEED, Duration::from_secs_f32(secs), cx);
        })
    });
    loop {
        sleep(cx, Duration::from_millis(20)).await;
        if cx.update(|cx| pane.read(cx).auto.as_ref().map(|a| a.done).unwrap_or(true)) {
            break;
        }
    }
    sleep(cx, Duration::from_millis(50)).await;
    let end = Instant::now();
    let (log, y) = cx.update(|cx| {
        pane.update(cx, |p, _| {
            p.logging = false;
            (std::mem::take(&mut p.log), p.scroll_y())
        })
    });
    let presents = c.frames.presents(w.window_id(), start, end);
    let draws = c.frames.draws_ms(w.window_id(), start, end);
    let renders: Vec<Instant> = log.iter().map(|x| x.0).collect();
    json!({
        "window_active": active,
        "duration_s": ms(end - start) / 1e3,
        "scrolled_px": y,
        "px_per_s_target": SPEED,
        "present_intervals_ms": interval_summary(&presents),
        "paint_marker_intervals_ms": interval_summary(&paints(w.window_id(), start, end)),
        "render_callback_intervals_ms": interval_summary(&renders),
        "draw_cpu_ms": summary(&draws),
        "frames_rendered": log.len(),
        "frames_with_unhighlighted_visible_rows": log.iter().filter(|x| !x.1).count(),
    })
}

async fn random_jumps(c: &mut Ctx, w: AnyWindowHandle, pane: &Entity<DiffPane>, n: usize, cx: &mut AsyncApp) -> Value {
    let mut seed: u64 = 0x9E3779B97F4A7C15;
    let mut lat = Vec::new();
    let mut unhl = 0;
    let max = cx.update(|cx| pane.read(cx).max_scroll());
    let start = Instant::now();
    for _ in 0..n {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        let y = (seed % 1_000_000) as f32 / 1_000_000. * max;
        let t0 = Instant::now();
        cx.update(|cx| {
            pane.update(cx, |p, cx| {
                p.probe.arm();
                p.jump_to(y, cx);
            })
        });
        let (t, all_hl) = wait_pane_frame(c, w, pane, cx).await;
        lat.push(ms(t - t0));
        if !all_hl {
            unhl += 1;
        }
        sleep(cx, Duration::from_millis(150)).await;
    }
    let draws = c.frames.draws_ms(w.window_id(), start, Instant::now());
    json!({
        "jumps": n,
        "jump_to_present_ms": summary(&lat),
        "jumps_first_frame_unhighlighted": unhl,
        "draw_cpu_ms": summary(&draws),
    })
}

pub fn start(scenario: String, launch: Launch, main: AnyWindowHandle, app: Entity<AppView>, cx: &mut App) {
    // The collector starts at the current cursor; the first frame has not been drawn yet.
    let frames = Frames::new();
    // Watchdog: GPUI draws nothing while a window is occluded (locked screen,
    // other Space, covered), so frame waits would hang forever.
    let sc = scenario.clone();
    std::panic::set_hook(Box::new(move |info| {
        eprintln!("{info}");
        write(&sc, json!({ "error": format!("panic: {info}") }));
    }));
    let sc = scenario.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(120));
        write(&sc, json!({ "error": "timed out waiting for frames (window occluded or screen locked?)" }));
        std::process::exit(2);
    });
    cx.spawn(async move |cx: &mut AsyncApp| {
        let mut c = Ctx { main, app, frames };
        let mut v = run(&scenario, &launch, &mut c, cx).await;
        v["present_fallbacks_to_draw_end"] = json!(c.frames.fallbacks);
        write(&scenario, v);
        cx.update(|cx| cx.quit());
    })
    .detach();
}

async fn run(scenario: &str, launch: &Launch, c: &mut Ctx, cx: &mut AsyncApp) -> Value {
    let main = c.main;
    match scenario {
        "cold-start" => {
            let rendered = loop {
                if let Some(t) = cx.update(|cx| c.app.read(cx).probe.rendered_at) {
                    break t;
                }
                sleep(cx, Duration::from_millis(1)).await;
            };
            let first = wait_present(c, main, rendered, cx).await;
            let pane = c.pane(cx);
            loop {
                if !cx.update(|cx| pane_missing(&pane, cx)) {
                    break;
                }
                sleep(cx, Duration::from_millis(1)).await;
            }
            cx.update(|cx| pane.update(cx, |p, cx| {
                p.probe.arm();
                cx.notify();
            }));
            // Bounded: an occluded window never draws the second frame.
            let mut hl = None;
            for _ in 0..5000 {
                if let Some(r) = cx.update(|cx| pane.read(cx).probe.rendered_at) {
                    hl = Some(wait_present(c, main, r, cx).await);
                    break;
                }
                sleep(cx, Duration::from_millis(1)).await;
            }
            let hl_ms = hl.map(|t| launch.proc_to_main_ms + ms(t - launch.main_instant));
            let main_to_first = ms(first - launch.main_instant);
            json!({
                "ms": launch.proc_to_main_ms + main_to_first,
                "process_start_to_main_ms": launch.proc_to_main_ms,
                "main_to_first_frame_ms": main_to_first,
                "ms_to_first_frame_with_visible_rows_highlighted": hl_ms,
                "note": "first frame = sidebar + 10k diff rows painted (diff parsed synchronously before window open); highlighting is async",
            })
        }
        "open-diff" => {
            let pane = c.pane(cx);
            sleep(cx, Duration::from_millis(1000)).await;
            let mut out = Vec::new();
            for name in ["10k", "40k", "290k"] {
                out.push(open_in(c, main, &pane, name, cx).await);
                sleep(cx, Duration::from_millis(1000)).await;
            }
            json!({ "results": out, "note": "t0 = start of file read; parse on background executor; first frame = first present after the pane rendered the new doc" })
        }
        s if s.starts_with("scroll-") => {
            let name = &s["scroll-".len()..];
            let pane = c.pane(cx);
            let open = open_in(c, main, &pane, name, cx).await;
            sleep(cx, Duration::from_millis(1500)).await;
            let scroll = scroll(c, main, &pane, 10., cx).await;
            let mut v = json!({ "fixture": name, "open": open, "scroll": scroll });
            if name == "290k" {
                v["random_jumps"] = random_jumps(c, main, &pane, 20, cx).await;
            }
            v
        }
        "switch" => {
            sleep(cx, Duration::from_millis(1000)).await;
            let mut lat = Vec::new();
            for i in 0..50 {
                let ws = (i + 1) % 9;
                let t0 = Instant::now();
                let _ = cx.update_window(main, |_, window, cx| {
                    c.app.update(cx, |a, _| a.probe.arm());
                    // Same code path as pressing ⌃N: dispatch the bound action.
                    window.dispatch_action(ws_action(ws), cx);
                });
                let mut waited = 0;
                let rendered = loop {
                    if let Some(t) = cx.update(|cx| c.app.read(cx).probe.rendered_at) {
                        break t;
                    }
                    waited += 1;
                    assert!(waited < 3000, "Ws action produced no render (focus not in the view?)");
                    sleep(cx, Duration::from_millis(1)).await;
                };
                let ok = cx.update(|cx| c.app.read(cx).selected == ws);
                assert!(ok, "switch did not apply");
                let t = wait_present(c, main, rendered, cx).await;
                lat.push(ms(t - t0));
                sleep(cx, Duration::from_millis(100)).await;
            }
            json!({ "switches": 50, "input_to_present_ms": summary(&lat) })
        }
        "memory-idle" => {
            sleep(cx, Duration::from_secs(10)).await;
            json!({ "fixture": "10k", "windows": 1, "rss": rss_tree() })
        }
        "memory-heavy" => {
            let pane = c.pane(cx);
            let open_main = open_in(c, main, &pane, "40k", cx).await;
            let doc = cx.background_executor().spawn(async move { Arc::new(load_doc("290k")) }).await;
            let (pw, ppane) = cx.update(|cx| c.app.update(cx, |a, cx| a.pop_out(Some(doc), cx)));
            sleep(cx, Duration::from_millis(1500)).await;
            let s1 = scroll(c, main, &pane, 5., cx).await;
            let s2 = scroll(c, pw, &ppane, 5., cx).await;
            let j = random_jumps(c, pw, &ppane, 10, cx).await;
            sleep(cx, Duration::from_secs(3)).await;
            let hl_done = cx.update(|cx| {
                let a = pane.read(cx).hl.done.load(std::sync::atomic::Ordering::Relaxed);
                let b = ppane.read(cx).hl.done.load(std::sync::atomic::Ordering::Relaxed);
                (a, b)
            });
            json!({
                "main": { "fixture": "40k", "open": open_main, "scroll": s1 },
                "popout": { "fixture": "290k", "scroll": s2, "random_jumps": j },
                "highlighted_files": { "main": hl_done.0, "popout": hl_done.1 },
                "windows": 2,
                "rss": rss_tree(),
            })
        }
        other => panic!("unknown scenario {other}"),
    }
}
