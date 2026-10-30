/**
 * The frame's runtime core, as script text: messages to and from the app, live theme, inline
 * height, `pv.state`, `pv.openLink`, `pv.bind` and tabs. It runs inside the bootstrap's IIFE.
 */
export const CORE_JS = String.raw`
var root = document.documentElement;
var names = Object.create(null);
config.names.forEach(function (name) { names[name] = true; });
var unsafe = new RegExp(config.unsafe);
var nativeBridge = window.ReactNativeWebView;

function post(message) {
  try {
    if (nativeBridge && typeof nativeBridge.postMessage === "function") {
      nativeBridge.postMessage(JSON.stringify(message));
    } else if (window.parent !== window) {
      window.parent.postMessage(message, "*");
    }
  } catch (error) {}
}

function tokenName(name) {
  name = String(name);
  if (name.indexOf("--") === 0) return name;
  return name.indexOf("pv-") === 0 ? "--" + name : "--pv-" + name;
}

function token(name) {
  return getComputedStyle(root).getPropertyValue(tokenName(name)).trim();
}

var themeListeners = [];

function applyTheme(tokens, scheme) {
  Object.keys(tokens).forEach(function (raw) {
    var name = raw.indexOf("--") === 0 ? raw : "--" + raw;
    var value = typeof tokens[raw] === "string" ? tokens[raw].trim() : "";
    if (!names[name] || !value || value.length > config.max || unsafe.test(value)) return;
    root.style.setProperty(name, value);
  });
  root.style.colorScheme = scheme;
  pv.scheme = scheme;
  themeListeners.forEach(function (listener) {
    try { listener(); } catch (error) { console.error(error); }
  });
  window.dispatchEvent(new CustomEvent("pv:theme", { detail: { scheme: scheme } }));
}

function fromHost(event) {
  if (nativeBridge) return event.source === null || event.source === window;
  return window.parent !== window && event.source === window.parent;
}

function onHostMessage(event) {
  if (!fromHost(event)) return;
  var data = event.data;
  if (typeof data === "string") {
    try { data = JSON.parse(data); } catch (error) { return; }
  }
  if (!data || data.type !== "pv:theme") return;
  if (typeof data.tokens !== "object" || data.tokens === null) return;
  if (data.scheme !== "light" && data.scheme !== "dark") return;
  applyTheme(data.tokens, data.scheme);
}

window.addEventListener("message", onHostMessage);
if (nativeBridge) document.addEventListener("message", onHostMessage);

var lastHeight = -1;
var queued = false;

function measure() {
  var body = document.body;
  if (!body) return 0;
  return Math.ceil(Math.max(body.getBoundingClientRect().height, body.scrollHeight));
}

function report() {
  if (!queued) return;
  queued = false;
  var height = measure();
  if (height === lastHeight) return;
  lastHeight = height;
  post({ type: "pv:height", height: height });
}

function scheduleHeight() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(report);
  // rAF is throttled in offscreen frames; the timer makes sure a height still arrives.
  setTimeout(report, 120);
}

if (config.mode === "inline") {
  var resizes = typeof ResizeObserver === "function" ? new ResizeObserver(scheduleHeight) : null;
  document.addEventListener("DOMContentLoaded", function () {
    if (resizes) resizes.observe(document.body);
    scheduleHeight();
  });
  window.addEventListener("load", scheduleHeight);
}

// The saved state is an envelope: the agent's value beside the kit's own (the selected tabs).
var saved = config.hasState ? config.state : undefined;
var envelope = saved && typeof saved === "object" && saved.pv === 1
  ? { pv: 1, value: saved.value, tabs: saved.tabs || {} }
  : { pv: 1, value: saved, tabs: {} };

function saveState() {
  var copy = JSON.parse(JSON.stringify(envelope));
  post({ type: "pv:state", state: copy });
}

var stateApi = {
  get: function () { return envelope.value; },
  set: function (value) {
    envelope.value = value === undefined ? null : JSON.parse(JSON.stringify(value));
    saveState();
    return envelope.value;
  },
};

function openLink(url) {
  var parsed;
  try { parsed = new URL(String(url)); } catch (error) { return false; }
  if (parsed.protocol !== "https:") return false;
  post({ type: "pv:open-link", url: parsed.href });
  return true;
}

function elements(target) {
  if (typeof target === "string") return Array.prototype.slice.call(document.querySelectorAll(target));
  if (target && typeof target.length === "number" && !target.tagName) return Array.prototype.slice.call(target);
  return target ? [target] : [];
}

function readValue(input) {
  if (input.type === "checkbox") return input.checked;
  if (input.type === "radio") return input.checked ? input.value : undefined;
  if (input.type === "range" || input.type === "number") return input.valueAsNumber;
  return input.value;
}

function showValue(input) {
  var slider = input.closest && input.closest(".pv-slider");
  var output = slider && slider.querySelector("output");
  if (!output || output.hasAttribute("data-manual")) return;
  var text = input.type === "range" || input.type === "number"
    ? Number(input.value).toLocaleString(undefined, { maximumFractionDigits: 6 })
    : input.value;
  output.textContent = (input.dataset.prefix || "") + text + (input.dataset.suffix || "");
}

function showFill(input) {
  if (input.type !== "range") return;
  var min = Number(input.min || 0), max = Number(input.max || 100);
  var share = max > min ? (Number(input.value) - min) / (max - min) : 0;
  input.style.setProperty("--pv-fill", Math.round(share * 1000) / 10 + "%");
}

function bind(target, update) {
  var inputs = elements(target);
  function values() {
    var out = {};
    inputs.forEach(function (input, index) {
      var key = input.name || input.id || String(index);
      var value = readValue(input);
      if (value !== undefined) out[key] = value;
    });
    return out;
  }
  function run() {
    inputs.forEach(showValue);
    inputs.forEach(showFill);
    update(values());
  }
  inputs.forEach(function (input) { input.addEventListener("input", run); });
  run();
  return run;
}

function tabLists() {
  return Array.prototype.slice.call(document.querySelectorAll(".pv-tabs"));
}

function selectTab(tab, quiet) {
  var list = tab.closest(".pv-tabs");
  if (!list) return;
  var tabs = Array.prototype.slice.call(list.querySelectorAll("[role=tab]"));
  tabs.forEach(function (other) {
    var on = other === tab;
    other.setAttribute("aria-selected", String(on));
    other.tabIndex = on ? 0 : -1;
    var id = other.getAttribute("aria-controls");
    var panel = id && document.getElementById(id);
    if (panel) panel.hidden = !on;
  });
  if (!quiet) {
    envelope.tabs[list.id || String(tabLists().indexOf(list))] = tabs.indexOf(tab);
    saveState();
  }
  list.dispatchEvent(new CustomEvent("pv:tab", { bubbles: true, detail: { tab: tab } }));
}

function restoreTabs() {
  tabLists().forEach(function (list, index) {
    var chosen = envelope.tabs[list.id || String(index)];
    var tabs = list.querySelectorAll("[role=tab]");
    if (typeof chosen === "number" && tabs[chosen]) selectTab(tabs[chosen], true);
  });
}

document.addEventListener("DOMContentLoaded", function () {
  restoreTabs();
  document.querySelectorAll("input[type=range]").forEach(showFill);
});

document.addEventListener("input", function (event) {
  if (event.target && event.target.type === "range") showFill(event.target);
});

document.addEventListener("click", function (event) {
  var target = event.target;
  var tab = target.closest && target.closest(".pv-tabs [role=tab]");
  if (tab) selectTab(tab);
  var link = target.closest && target.closest("a[href]");
  var href = link && link.getAttribute("href");
  // A link never navigates the frame: an https one is offered to the user, the rest do nothing.
  if (!href || href.charAt(0) === "#") return;
  event.preventDefault();
  openLink(link.href);
});

document.addEventListener("keydown", function (event) {
  var tab = event.target.closest && event.target.closest(".pv-tabs [role=tab]");
  if (!tab || (event.key !== "ArrowRight" && event.key !== "ArrowLeft")) return;
  var tabs = Array.prototype.slice.call(tab.closest(".pv-tabs").querySelectorAll("[role=tab]"));
  var next = tabs[(tabs.indexOf(tab) + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
  selectTab(next);
  next.focus();
  event.preventDefault();
});

window.addEventListener("error", function (event) {
  // Chrome reports a benign "ResizeObserver loop" as an error; it isn't the agent's.
  if (/ResizeObserver loop/.test(event.message || "")) return;
  if (!document.body || document.querySelector(".pv-error")) return;
  var notice = document.createElement("div");
  notice.className = "pv-error";
  notice.setAttribute("role", "alert");
  notice.textContent = "This visualization hit an error: " + (event.message || "unknown error");
  document.body.appendChild(notice);
});
`;
