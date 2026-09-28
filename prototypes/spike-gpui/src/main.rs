//! ENG-184 Spike 1: the Polaris review screen in GPUI + gpui-kit. Throwaway.

mod bench;
mod diff;
mod highlight;

use std::{
    borrow::Cow,
    path::PathBuf,
    sync::{Arc, atomic::Ordering},
    time::{Duration, Instant, SystemTime},
};

use gpui_kit::component::{
    ActiveTheme as _, Root, Selectable as _, Theme, ThemeMode, TitleBar,
    button::{Button, ButtonGroup},
    h_flex, v_flex,
};
use gpui_kit::prelude::*;
use gpui_kit::*;

/// Opens a window whose root is gpui-kit's `Root` wrapping `build`'s view.
fn open_window<V: Render>(
    options: WindowOptions,
    cx: &mut App,
    build: impl FnOnce(&mut Window, &mut App) -> Entity<V>,
) -> (AnyWindowHandle, Entity<V>) {
    let mut built = None;
    let window = cx
        .open_window(options, |window, cx| {
            let view = build(window, cx);
            built = Some(view.clone());
            cx.new(|cx| Root::new(view, window, cx))
        })
        .expect("open window");
    (window.into(), built.unwrap())
}
use serde::Deserialize;

use diff::{Doc, Kind};
use highlight::HlStore;

pub const ROW_H: f32 = 20.;
pub const MONO: &str = "JetBrains Mono";
pub const UI: &str = "Inter";

actions!(spike, [Ws1, Ws2, Ws3, Ws4, Ws5, Ws6, Ws7, Ws8, Ws9, PopOut, Quit]);

pub fn ws_action(i: usize) -> Box<dyn Action> {
    match i {
        0 => Box::new(Ws1),
        1 => Box::new(Ws2),
        2 => Box::new(Ws3),
        3 => Box::new(Ws4),
        4 => Box::new(Ws5),
        5 => Box::new(Ws6),
        6 => Box::new(Ws7),
        7 => Box::new(Ws8),
        _ => Box::new(Ws9),
    }
}

pub fn fixtures_dir() -> PathBuf {
    std::env::var("SPIKE_FIXTURES")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../../../spike-fixtures")))
}

pub fn load_doc(name: &str) -> Doc {
    let path = fixtures_dir().join(format!("review-{name}.diff"));
    let src = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {path:?}: {e}"));
    diff::parse(name, &src)
}

// ---------------------------------------------------------------------------
// Sessions

#[derive(Deserialize, Clone)]
struct Host {
    id: String,
    name: String,
}

#[derive(Deserialize, Clone)]
struct Session {
    host: String,
    workspace: String,
    title: String,
    harness: String,
    state: String,
    branch: String,
}

#[derive(Deserialize)]
struct SessionsFile {
    hosts: Vec<Host>,
    sessions: Vec<Session>,
}

struct Workspace {
    name: String,
    host: String,
}

fn state_color(state: &str) -> Hsla {
    match state {
        "working" => rgb(0x2f7de1).into(),
        "needs" => rgb(0xe8a317).into(),
        "idle" => rgb(0x5bb974).into(),
        "failed" => rgb(0xe5484d).into(),
        "terminal" => rgb(0x8e6bd6).into(),
        _ => rgb(0xc4c8cf).into(), // dormant
    }
}

// ---------------------------------------------------------------------------
// Probes: the bench asks a view to note when it rendered new content.

#[derive(Default)]
pub struct Probe {
    pub want: bool,
    pub rendered_at: Option<Instant>,
    /// For the diff pane: whether every visible row had highlighting then.
    pub all_hl: bool,
}

impl Probe {
    pub fn arm(&mut self) {
        self.want = true;
        self.rendered_at = None;
    }
    fn hit(&mut self, all_hl: bool) {
        if self.want {
            self.want = false;
            self.rendered_at = Some(Instant::now());
            self.all_hl = all_hl;
        }
    }
}

/// Paint timestamps per window, from a zero-size canvas painted last in each
/// frame. Backup for GPUI's Present events, which its profiler drops for
/// windows it considers not visible (first frame, occluded, locked screen).
pub static PAINTS: std::sync::Mutex<Vec<(WindowId, Instant)>> = std::sync::Mutex::new(Vec::new());

pub fn paint_marker() -> impl IntoElement {
    canvas(
        |_, _, _| {},
        |_, _, window, _| {
            PAINTS.lock().unwrap().push((window.window_handle().window_id(), Instant::now()));
        },
    )
    .absolute()
    .size_0()
}

// ---------------------------------------------------------------------------
// Diff pane

pub struct AutoScroll {
    pub speed: f32,
    pub last: Instant,
    pub until: Instant,
    pub done: bool,
}

pub struct DiffPane {
    pub doc: Arc<Doc>,
    pub hl: Arc<HlStore>,
    pub scroll: UniformListScrollHandle,
    pub auto: Option<AutoScroll>,
    pub probe: Probe,
    /// (render time, all visible rows highlighted) while `logging`.
    pub log: Vec<(Instant, bool)>,
    pub logging: bool,
    last_missing: bool,
    _poll: Task<()>,
}

impl DiffPane {
    pub fn new(doc: Arc<Doc>, cx: &mut Context<Self>) -> Self {
        let hl = highlight::spawn(doc.clone(), 2);
        // Repaint when background highlighting lands for rows we showed plain.
        let poll = cx.spawn(async move |this: WeakEntity<Self>, cx: &mut AsyncApp| {
            loop {
                cx.background_executor().timer(Duration::from_millis(16)).await;
                let Ok(()) = this.update(cx, |this, cx| {
                    if this.hl.dirty.swap(false, Ordering::Relaxed) && this.last_missing {
                        cx.notify();
                    }
                }) else {
                    break;
                };
            }
        });
        Self {
            doc,
            hl,
            scroll: UniformListScrollHandle::new(),
            auto: None,
            probe: Probe::default(),
            log: Vec::new(),
            logging: false,
            last_missing: false,
            _poll: poll,
        }
    }

    pub fn set_doc(&mut self, doc: Arc<Doc>, cx: &mut Context<Self>) {
        self.hl.cancelled.store(true, Ordering::Relaxed);
        self.hl = highlight::spawn(doc.clone(), 2);
        self.doc = doc;
        self.scroll.0.borrow().base_handle.set_offset(point(px(0.), px(0.)));
        cx.notify();
    }

    pub fn scroll_y(&self) -> f32 {
        -f32::from(self.scroll.0.borrow().base_handle.offset().y)
    }

    pub fn viewport_h(&self) -> f32 {
        f32::from(self.scroll.0.borrow().base_handle.bounds().size.height)
    }

    pub fn max_scroll(&self) -> f32 {
        (self.doc.rows.len() as f32 * ROW_H - self.viewport_h()).max(0.)
    }

    pub fn jump_to(&mut self, y: f32, cx: &mut Context<Self>) {
        let y = y.clamp(0., self.max_scroll());
        self.scroll.0.borrow().base_handle.set_offset(point(px(0.), px(-y)));
        cx.notify();
    }

    pub fn start_autoscroll(&mut self, speed: f32, dur: Duration, cx: &mut Context<Self>) {
        let now = Instant::now();
        self.auto = Some(AutoScroll { speed, last: now, until: now + dur, done: false });
        cx.notify();
    }

    fn row_bg(kind: Kind) -> (Hsla, Hsla) {
        // (line background, gutter background)
        match kind {
            Kind::Add => (rgb(0xe9f6ec).into(), rgb(0xd4eedb).into()),
            Kind::Del => (rgb(0xfcecec).into(), rgb(0xf7d9d9).into()),
            Kind::Hunk => (rgb(0xeef3fb).into(), rgb(0xe3ebf8).into()),
            Kind::FileHeader => (rgb(0xf4f5f7).into(), rgb(0xf4f5f7).into()),
            Kind::Context => (rgb(0xffffff).into(), rgb(0xf8f9fa).into()),
        }
    }

    fn file_header(doc: &Doc, file: usize, sticky: bool) -> Div {
        let f = &doc.files[file];
        h_flex()
            .h(px(ROW_H + 6.))
            .w_full()
            .px_3()
            .gap_2()
            .bg(rgb(0xf4f5f7))
            .border_b_1()
            .border_color(rgb(0xe1e4e8))
            .when(!sticky, |d| d.border_t_1())
            .when(sticky, |d| d.shadow_sm())
            .font_family(UI)
            .text_size(px(12.5))
            .child(div().font_weight(FontWeight::SEMIBOLD).text_color(rgb(0x1f2328)).child(f.path.clone()))
            .child(div().text_color(rgb(0x1a7f37)).child(format!("+{}", f.added)))
            .child(div().text_color(rgb(0xcf222e)).child(format!("−{}", f.removed)))
    }

    fn render_row(doc: &Doc, hl: &HlStore, ix: usize) -> AnyElement {
        let row = &doc.rows[ix];
        let text = doc.line(row);
        let (bg, gutter_bg) = Self::row_bg(row.kind);
        if row.kind == Kind::FileHeader {
            // Uniform list rows share one height; the header row reserves it,
            // the styled header is drawn inside.
            return div()
                .h(px(ROW_H))
                .w_full()
                .overflow_hidden()
                .child(Self::file_header(doc, row.file as usize, false).h(px(ROW_H)))
                .into_any_element();
        }
        let num = |n: u32| -> SharedString { if n == 0 { "".into() } else { n.to_string().into() } };
        let sign = match row.kind {
            Kind::Add => "+",
            Kind::Del => "−",
            _ => "",
        };
        let body: AnyElement = if row.kind == Kind::Hunk {
            div().text_color(rgb(0x57606a)).child(SharedString::from(text.to_string())).into_any_element()
        } else {
            let mut highlights: Vec<(std::ops::Range<usize>, HighlightStyle)> = Vec::new();
            if let Some(fh) = hl.get(row.file as usize) {
                let line_ix = ix - doc.files[row.file as usize].first_row as usize;
                for s in &fh.lines[line_ix] {
                    highlights.push((s.start as usize..s.end as usize, fh.palette[s.style as usize]));
                }
            }
            StyledText::new(SharedString::from(text.to_string()))
                .with_highlights(highlights)
                .into_any_element()
        };
        h_flex()
            .h(px(ROW_H))
            .w_full()
            .bg(bg)
            .child(
                div()
                    .w(px(46.))
                    .h_full()
                    .flex_none()
                    .pr_2()
                    .text_right()
                    .bg(gutter_bg)
                    .text_color(rgb(0x8c959f))
                    .child(num(row.old_no)),
            )
            .child(
                div()
                    .w(px(46.))
                    .h_full()
                    .flex_none()
                    .pr_2()
                    .text_right()
                    .bg(gutter_bg)
                    .text_color(rgb(0x8c959f))
                    .border_r_1()
                    .border_color(rgb(0xe6e8eb))
                    .child(num(row.new_no)),
            )
            .child(div().w(px(18.)).flex_none().text_center().text_color(rgb(0x57606a)).child(sign))
            .child(div().flex_1().overflow_hidden().whitespace_nowrap().text_color(rgb(0x24292f)).child(body))
            .into_any_element()
    }
}

impl Render for DiffPane {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        // Programmatic scroll: advance by speed * dt, once per frame.
        let mut keep_going = false;
        if let Some(auto) = &mut self.auto {
            if !auto.done {
                let now = Instant::now();
                let dt = now.duration_since(auto.last).as_secs_f32();
                auto.last = now;
                let (speed, until) = (auto.speed, auto.until);
                let max = self.max_scroll();
                let y = (self.scroll_y() + speed * dt).min(max);
                self.scroll.0.borrow().base_handle.set_offset(point(px(0.), px(-y)));
                let done = y >= max || now >= until;
                self.auto.as_mut().unwrap().done = done;
                keep_going = !done;
            }
        }
        if keep_going {
            window.request_animation_frame();
        }

        let doc = self.doc.clone();
        let hl = self.hl.clone();
        let y = self.scroll_y();
        let first = (y / ROW_H).floor().max(0.) as usize;
        let visible = (self.viewport_h().max(900.) / ROW_H).ceil() as usize + 1;
        let last = (first + visible).min(doc.rows.len());
        let top_file = doc.file_of_row(first);
        hl.priority.store(top_file, Ordering::Relaxed);
        let mut all_hl = true;
        let mut f = usize::MAX;
        for ix in first..last {
            let rf = doc.rows[ix].file as usize;
            if rf != f {
                f = rf;
                if doc.files[rf].is_rust && hl.get(rf).is_none() {
                    all_hl = false;
                    break;
                }
            }
        }
        self.last_missing = !all_hl;
        self.probe.hit(all_hl);
        if self.logging {
            self.log.push((Instant::now(), all_hl));
        }

        let sticky = doc
            .rows
            .get(first)
            .filter(|_| y > 0.5)
            .map(|r| r.file as usize);

        let list_doc = doc.clone();
        let list = uniform_list("diff", doc.rows.len(), move |range, _window, _cx| {
            range.map(|ix| Self::render_row(&list_doc, &hl, ix)).collect::<Vec<_>>()
        })
        .track_scroll(&self.scroll)
        .size_full();

        div()
            .relative()
            .size_full()
            .bg(rgb(0xffffff))
            .font_family(MONO)
            .text_size(px(12.5))
            .line_height(px(ROW_H))
            .child(list)
            .when_some(sticky, |d, file| {
                d.child(div().absolute().top_0().left_0().right_0().child(Self::file_header(&doc, file, true)))
            })
            .child(paint_marker())
    }
}

// ---------------------------------------------------------------------------
// Main window

pub struct AppView {
    hosts: Vec<Host>,
    sessions: Vec<Session>,
    workspaces: Vec<Workspace>,
    pub selected: usize,
    mode: usize,
    pub pane: Entity<DiffPane>,
    pub probe: Probe,
    pub popouts: Vec<(AnyWindowHandle, Entity<DiffPane>)>,
    focus: FocusHandle,
}

impl AppView {
    fn new(doc: Arc<Doc>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let sf: SessionsFile =
            serde_json::from_str(&std::fs::read_to_string(fixtures_dir().join("sessions.json")).unwrap()).unwrap();
        let mut workspaces: Vec<Workspace> = Vec::new();
        for s in &sf.sessions {
            if !workspaces.iter().any(|w| w.name == s.workspace) {
                let host = sf.hosts.iter().find(|h| h.id == s.host).map(|h| h.name.clone()).unwrap_or_default();
                workspaces.push(Workspace { name: s.workspace.clone(), host });
            }
        }
        let focus = cx.focus_handle();
        window.focus(&focus, cx);
        Self {
            hosts: sf.hosts,
            sessions: sf.sessions,
            workspaces,
            selected: 0,
            mode: 1,
            pane: cx.new(|cx| DiffPane::new(doc, cx)),
            probe: Probe::default(),
            popouts: Vec::new(),
            focus,
        }
    }

    pub fn select(&mut self, ix: usize, cx: &mut Context<Self>) {
        if ix < self.workspaces.len() {
            self.selected = ix;
            cx.notify();
        }
    }

    pub fn pop_out(&mut self, doc: Option<Arc<Doc>>, cx: &mut Context<Self>) -> (AnyWindowHandle, Entity<DiffPane>) {
        let doc = doc.unwrap_or_else(|| self.pane.read(cx).doc.clone());
        let r = open_popout(doc, cx);
        self.popouts.push(r.clone());
        r
    }

    fn render_titlebar(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let modes = ["Orchestrate", "Review", "Edit"];
        TitleBar::new().child(
            h_flex()
                .w_full()
                .pr_3()
                .justify_between()
                .child(div().font_weight(FontWeight::SEMIBOLD).text_sm().child("Polaris"))
                .child(
                    ButtonGroup::new("modes")
                        .outline()
                        .compact()
                        .children(modes.iter().enumerate().map(|(i, m)| {
                            Button::new(("mode", i)).label(*m).selected(self.mode == i)
                        }))
                        .on_click(cx.listener(|this, sel: &Vec<usize>, _, cx| {
                            if let Some(&i) = sel.first() {
                                this.mode = i;
                                cx.notify();
                            }
                        })),
                )
                .child(div().w(px(60.))),
        )
    }

    fn render_workspace_bar(&self, cx: &mut Context<Self>) -> impl IntoElement {
        h_flex()
            .id("ws-bar")
            .px_3()
            .py(px(6.))
            .gap(px(6.))
            .border_b_1()
            .border_color(cx.theme().border)
            .bg(rgb(0xfbfbfc))
            .overflow_x_scroll()
            .children(self.workspaces.iter().enumerate().map(|(i, w)| {
                let selected = i == self.selected;
                h_flex()
                    .id(("ws", i))
                    .flex_none()
                    .gap_1p5()
                    .px_2p5()
                    .py(px(3.))
                    .rounded_full()
                    .border_1()
                    .text_size(px(12.))
                    .cursor_pointer()
                    .when(selected, |d| d.bg(rgb(0xe7f0fe)).border_color(rgb(0x2f7de1)).text_color(rgb(0x1554ad)))
                    .when(!selected, |d| {
                        d.bg(rgb(0xffffff)).border_color(rgb(0xdfe2e6)).hover(|s| s.bg(rgb(0xf2f4f6)))
                    })
                    .child(div().font_weight(FontWeight::MEDIUM).child(w.name.clone()))
                    .child(div().text_color(rgb(0x8c959f)).child(w.host.clone()))
                    .when(i < 9, |d| d.child(div().text_color(rgb(0xa0a7b0)).child(format!("⌃{}", i + 1))))
                    .on_click(cx.listener(move |this, _, _, cx| this.select(i, cx)))
            }))
    }

    fn render_sessions(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let ws = &self.workspaces[self.selected];
        v_flex()
            .id("sessions")
            .w(px(260.))
            .flex_none()
            .h_full()
            .border_r_1()
            .border_color(cx.theme().border)
            .bg(rgb(0xfafbfc))
            .overflow_y_scroll()
            .child(
                div()
                    .px_3()
                    .pt_3()
                    .pb_1()
                    .text_size(px(11.))
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(rgb(0x6e7781))
                    .child(format!("SESSIONS · {}", ws.name.to_uppercase())),
            )
            .children(self.sessions.iter().enumerate().filter(|(_, s)| s.workspace == ws.name).map(|(i, s)| {
                let host = self.hosts.iter().find(|h| h.id == s.host).map(|h| h.name.as_str()).unwrap_or("");
                h_flex()
                    .id(("session", i))
                    .mx_1p5()
                    .px_2()
                    .py_1p5()
                    .gap_2()
                    .rounded_md()
                    .items_start()
                    .hover(|s| s.bg(rgb(0xeef1f4)))
                    .child(div().mt(px(5.)).size(px(8.)).flex_none().rounded_full().bg(state_color(&s.state)))
                    .child(
                        v_flex()
                            .gap_0p5()
                            .min_w_0()
                            .child(div().text_size(px(13.)).text_color(rgb(0x1f2328)).truncate().child(s.title.clone()))
                            .child(
                                div()
                                    .text_size(px(11.))
                                    .text_color(rgb(0x8c959f))
                                    .truncate()
                                    .child(format!("{} · {} · {} · {}", s.harness, s.state, s.branch, host)),
                            ),
                    )
            }))
    }
}

impl Render for AppView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        self.probe.hit(true);
        macro_rules! ws {
            ($d:expr, $($a:ident => $i:expr),*) => {
                $d$(.on_action(cx.listener(|this, _: &$a, _, cx| this.select($i, cx))))*
            };
        }
        let root = v_flex()
            .track_focus(&self.focus)
            .size_full()
            .bg(rgb(0xffffff))
            .font_family(UI)
            .text_color(rgb(0x1f2328))
            .on_action(cx.listener(|this, _: &PopOut, _, cx| {
                this.pop_out(None, cx);
            }))
            .child(paint_marker())
            .child(self.render_titlebar(cx))
            .child(self.render_workspace_bar(cx))
            .child(
                h_flex()
                    .flex_1()
                    .min_h_0()
                    .w_full()
                    .child(self.render_sessions(cx))
                    .child(div().flex_1().min_w_0().h_full().child(self.pane.clone())),
            );
        ws!(root, Ws1 => 0, Ws2 => 1, Ws3 => 2, Ws4 => 3, Ws5 => 4, Ws6 => 5, Ws7 => 6, Ws8 => 7, Ws9 => 8)
    }
}

// ---------------------------------------------------------------------------
// Pop-out window: a second window in the same process.

pub struct PopoutView {
    pane: Entity<DiffPane>,
    name: String,
}

impl Render for PopoutView {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        let name = &self.name;
        v_flex()
            .size_full()
            .font_family(UI)
            .child(TitleBar::new().child(div().text_sm().child(format!("Review · {name} (pop-out)"))))
            .child(div().flex_1().min_h_0().child(self.pane.clone()))
    }
}

pub fn open_popout(doc: Arc<Doc>, cx: &mut App) -> (AnyWindowHandle, Entity<DiffPane>) {
    let mut opts = TitleBar::window_options();
    opts.window_bounds = Some(WindowBounds::Windowed(Bounds::new(point(px(120.), px(80.)), size(px(1000.), px(800.)))));
    let mut pane = None;
    let (handle, _) = open_window(opts, cx, |_, cx| {
        let name = doc.name.clone();
        let p = cx.new(|cx| DiffPane::new(doc, cx));
        pane = Some(p.clone());
        cx.new(|_| PopoutView { pane: p, name })
    });
    (handle, pane.unwrap())
}

// ---------------------------------------------------------------------------

pub struct Launch {
    pub main_instant: Instant,
    /// Process creation to `main`, from the kernel's process start time.
    pub proc_to_main_ms: f64,
}

fn process_start_to_now_ms() -> f64 {
    unsafe {
        let mut info: libc::proc_bsdinfo = std::mem::zeroed();
        let size = std::mem::size_of::<libc::proc_bsdinfo>() as i32;
        let r = libc::proc_pidinfo(
            libc::getpid(),
            libc::PROC_PIDTBSDINFO,
            0,
            &mut info as *mut _ as *mut libc::c_void,
            size,
        );
        if r != size {
            return f64::NAN;
        }
        let start = info.pbi_start_tvsec as f64 + info.pbi_start_tvusec as f64 / 1e6;
        let now = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).unwrap().as_secs_f64();
        (now - start) * 1e3
    }
}

fn main() {
    let launch = Launch { main_instant: Instant::now(), proc_to_main_ms: process_start_to_now_ms() };
    gpui::profiler::set_trace_enabled(true);

    let args: Vec<String> = std::env::args().collect();
    let scenario = args.iter().position(|a| a == "--bench").and_then(|i| args.get(i + 1).cloned());
    let initial = std::env::var("SPIKE_DIFF").unwrap_or_else(|_| "10k".into());

    // Headless: parse + full Tree-sitter highlight throughput, no window.
    if args.iter().any(|a| a == "--hl-debug") {
        let doc = load_doc("10k");
        let theme = gpui_kit::component::highlighter::HighlightTheme::default_light();
        let f = doc.files.iter().max_by_key(|f| f.new_src.len()).unwrap();
        let rope = gpui_kit::component::Rope::from_str(&f.new_src);
        let t = Instant::now();
        let mut h = gpui_kit::component::highlighter::SyntaxHighlighter::new("rust");
        h.update(None, &rope, None);
        let t1 = t.elapsed();
        let st = h.styles(&(0..f.new_src.len()), &*theme);
        let t2 = t.elapsed();
        eprintln!("{} bytes={} parse={t1:?} styles={t2:?} n={}", f.path, f.new_src.len(), st.len());
        for (r, s) in st.iter().take(15) {
            eprintln!("{:?} {:?} {:?}", r, &f.new_src[r.clone()], s.color);
        }
        return;
    }
    if args.iter().any(|a| a == "--hl-stats") {
        let mut out = Vec::new();
        for name in ["10k", "40k", "290k"] {
            let t0 = Instant::now();
            let doc = Arc::new(load_doc(name));
            let parse_ms = t0.elapsed().as_secs_f64() * 1e3;
            let lines: usize = doc.files.iter().map(|f| f.old_src.len() + f.new_src.len()).sum();
            let store = highlight::spawn(doc.clone(), 2);
            while store.finished_ms.lock().unwrap().is_none() {
                std::thread::sleep(Duration::from_millis(5));
            }
            let hl_ms = store.finished_ms.lock().unwrap().unwrap();
            let spans: usize = (0..doc.files.len())
                .map(|i| store.get(i).map(|h| h.lines.iter().map(|l| l.len()).sum::<usize>()).unwrap_or(0))
                .sum();
            out.push(serde_json::json!({
                "fixture": name, "rows": doc.rows.len(), "files": doc.files.len(),
                "read_parse_ms": parse_ms, "highlight_all_ms_2_workers": hl_ms,
                "highlighted_source_bytes": lines, "spans": spans,
            }));
        }
        let v = serde_json::json!({ "spike": "gpui", "scenario": "hl-stats", "results": out, "rss": bench::rss_tree() });
        println!("{}", serde_json::to_string_pretty(&v).unwrap());
        return;
    }

    gpui_kit::application().with_assets(gpui_kit::assets::Assets).run(move |cx| {
        gpui_kit::init(cx);
        cx.text_system()
            .add_fonts(vec![
                Cow::Borrowed(include_bytes!("../assets/fonts/Inter-Regular.otf").as_slice()),
                Cow::Borrowed(include_bytes!("../assets/fonts/Inter-Medium.otf").as_slice()),
                Cow::Borrowed(include_bytes!("../assets/fonts/Inter-SemiBold.otf").as_slice()),
                Cow::Borrowed(include_bytes!("../assets/fonts/JetBrainsMono-Regular.ttf").as_slice()),
                Cow::Borrowed(include_bytes!("../assets/fonts/JetBrainsMono-Bold.ttf").as_slice()),
            ])
            .unwrap();
        Theme::change(ThemeMode::Light, None, cx);

        cx.bind_keys([
            KeyBinding::new("ctrl-1", Ws1, None),
            KeyBinding::new("ctrl-2", Ws2, None),
            KeyBinding::new("ctrl-3", Ws3, None),
            KeyBinding::new("ctrl-4", Ws4, None),
            KeyBinding::new("ctrl-5", Ws5, None),
            KeyBinding::new("ctrl-6", Ws6, None),
            KeyBinding::new("ctrl-7", Ws7, None),
            KeyBinding::new("ctrl-8", Ws8, None),
            KeyBinding::new("ctrl-9", Ws9, None),
            KeyBinding::new("cmd-shift-o", PopOut, None),
            KeyBinding::new("cmd-q", Quit, None),
        ]);
        cx.on_action(|_: &Quit, cx| cx.quit());
        cx.set_menus(vec![
            Menu { name: "Polaris".into(), items: vec![MenuItem::action("Quit", Quit)], disabled: false },
            Menu {
                name: "View".into(),
                items: vec![MenuItem::action("Pop Out Diff", PopOut)],
                disabled: false,
            },
        ]);
        cx.activate(true);

        let doc = Arc::new(load_doc(&initial));
        let mut opts = TitleBar::window_options();
        opts.window_bounds = Some(WindowBounds::Windowed(Bounds::new(point(px(80.), px(40.)), size(px(1440.), px(900.)))));
        let (handle, app) = open_window(opts, cx, |window, cx| {
            cx.new(|cx| {
                let mut v = AppView::new(doc, window, cx);
                v.probe.arm();
                v
            })
        });

        if let Some(scenario) = scenario {
            bench::start(scenario, launch, handle, app, cx);
        }
    });
}
