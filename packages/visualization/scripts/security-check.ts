#!/usr/bin/env bun
/** Adversarial engine checks for ENG-594. Run outside the Codex socket sandbox. */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { Schema } from "effect";
import { chromium, _electron } from "playwright-core";
import { buildFrameDocument, validateVisualization } from "../src/index.ts";
import { FRAME_CSP } from "../../../apps/desktop/src/main/frames.ts";

const hits: Array<string> = [];

let tcpBytes = 0;

let tcpConnections = 0;

let udpPackets = 0;

const tcp = createServer((socket) => {
  tcpConnections += 1;

  socket.on("data", (data) => {
    tcpBytes += data.length;
  });
  socket.unref();
});

await new Promise<void>((resolve) => tcp.listen(0, "127.0.0.1", resolve));

const addr = Schema.decodeUnknownSync(Schema.Struct({ port: Schema.Number }))(tcp.address());

const udp = await Bun.udpSocket({
  socket: {
    data: () => {
      udpPackets += 1;
    },
  },
});

const server = Bun.serve({
  port: 0,
  fetch(request) {
    const path = new URL(request.url).pathname;

    if (path === "/")
      return new Response(
        "<!doctype html><body><script>window.messages=[];addEventListener('message',e=>messages.push(e.data));</script>",
        { headers: { "Content-Type": "text/html" } }
      );

    if (path === "/favicon.ico") return new Response(null, { status: 404 });

    if (path === "/frame")
      return new Response(currentDocument, {
        headers: { "Content-Type": "text/html", "Content-Security-Policy": currentCsp },
      });

    hits.push(request.url);

    return new Response("x");
  },
});

const origin = `http://127.0.0.1:${server.port}`;

let currentDocument = "";

let currentCsp = FRAME_CSP;

const build = (html: string) =>
  buildFrameDocument({
    html,
    title: "security probe",
    tokens: {},
    scheme: "dark",
    mode: "expanded",
  });

const rtc = `parent.parent.postMessage('child ready '+[typeof require,typeof process,typeof polaris].join(','),'*');try{const p=new RTCPeerConnection({iceServers:[{urls:'turn:127.0.0.1:${addr.port}?transport=tcp',username:'secret',credential:'secret'},{urls:'stun:127.0.0.1:${udp.port}'}]});p.createDataChannel('x');p.createOffer().then(o=>p.setLocalDescription(o));parent.parent.postMessage('child RTC ran','*')}catch(e){parent.parent.postMessage('RTC blocked: '+String(e),'*')}`;

const child = `<script>${rtc}</script>`;

const html = build(
  `<div><template shadowrootmode="closed"><iframe srcdoc="${child.replaceAll('"', "&quot;")}"></iframe></template></div>`
);

const results: Array<{ name: string; pass: boolean; detail: Schema.Json }> = [];

const check = (name: string, pass: boolean, detail: Schema.Json) => {
  results.push({ name, pass, detail });

  console.log(JSON.stringify(results.at(-1)));
};

const chrome = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});

try {
  console.log(JSON.stringify({ engine: "Chrome", version: chrome.version() }));
  const page = await chrome.newPage();

  await page.goto(origin);

  const vectors = [
    `<img src="http&#58;//127.0.0.1:${server.port}/entity">`,
    `<img srcset="${origin}/srcset 1x, ${origin}/srcset2 2x">`,
    `<style>@import '${origin}/import';@font-face{font-family:x;src:url(${origin}/font)}body{font-family:x}div{background:u\\72l(${origin}/css)}</style><div>x</div>`,
    `<svg><image href="${origin}/svg"/><use xlink:href="${origin}/use#x"/></svg>`,
    `<base href="${origin}/base"><form action="${origin}/form"><button>go</button></form><script>try{document.querySelector('form').submit()}finally{parent.postMessage('form attempted','*')}</script>`,
    `<script>const s=document.createElement('script');s['s'+'rc']='${origin}/script';document.body.append(s);const i=new Image();i['s'+'rc']='${origin}/image';</script>`,
    `<script>window['fet'+'ch']('${origin}/fetch').catch(()=>{});navigator['send'+'Beacon']('${origin}/beacon','secret');try{new window['Web'+'Socket']('${origin.replace("http", "ws")}/ws')}catch{};try{new window['Event'+'Source']('${origin}/sse')}catch{};parent.postMessage('network APIs attempted','*');</script>`,
    `<link rel="prefetch" href="${origin}/prefetch"><link rel="preconnect" href="http://127.0.0.1:${addr.port}"><link rel="dns-prefetch" href="//localhost">`,
    `<script>const code="postMessage('worker ran')";const u=URL.createObjectURL(new Blob([code],{type:'text/javascript'}));for(const k of ['Worker','SharedWorker'])try{const w=new window[k](u);w.onmessage=e=>parent.postMessage(k+' executed: '+e.data,'*');w.onerror=()=>parent.postMessage(k+' blocked','*')}catch{parent.postMessage(k+' blocked','*')}try{if(!navigator.serviceWorker)parent.postMessage('ServiceWorker unavailable','*');else navigator.serviceWorker.register(u).then(()=>parent.postMessage('ServiceWorker allowed','*'),()=>parent.postMessage('ServiceWorker blocked','*'))}catch{parent.postMessage('ServiceWorker blocked','*')}</script>`,
    `<a href="javascript:parent.postMessage('javascript stayed inside','*')" target="_blank">x</a><script>document.querySelector('a').click();try{parent.document.body;parent.postMessage('parent escaped','*')}catch{parent.postMessage('parent blocked','*')}try{top.document.body;parent.postMessage('top escaped','*')}catch{parent.postMessage('top blocked','*')}try{eval('1');parent.postMessage('eval allowed','*')}catch{parent.postMessage('eval blocked','*')}try{Function('return 1')();parent.postMessage('Function allowed','*')}catch{parent.postMessage('Function blocked','*')}</script>`,
    `<a href="http&#58;//127.0.0.1:${server.port}/popup" target="_blank">go</a><script>document.querySelector('a').click();</script>`,
    `<script>const f=document.createElement('i'+'frame');document.body.append(f);try{f.contentWindow.document;parent.postMessage('blank accessible','*')}catch(e){parent.postMessage('blank '+e.name,'*')}</script>`,
    `<script>const f=document.createElement('i'+'frame');Object.defineProperty(f,'nodeType',{get:()=>0});document.body.append(f);setTimeout(()=>parent.postMessage(f.isConnected?'getter bypass':'getter removed','*'),0);</script>`,
  ];

  for (const [index, html] of vectors.entries()) {
    currentDocument = build(
      `<script>addEventListener('securitypolicyviolation',e=>parent.postMessage('CSP '+e.effectiveDirective+' '+e.blockedURI,'*'));</script>${html}`
    );

    console.log(
      JSON.stringify({
        vector: index,
        validation: validateVisualization({ html, title: "probe" }).map((p) => p.rule),
      })
    );

    await page.evaluate(
      `{ const f=document.createElement("iframe");f.sandbox.add("allow-scripts");f.src=${JSON.stringify(`${origin}/frame?${index}`)};document.body.append(f); }`
    );

    await page.waitForTimeout(200);
  }

  await page.waitForTimeout(1000);

  const messages = Schema.decodeUnknownSync(Schema.Array(Schema.String))(
    await page.evaluate("messages")
  );

  check("preconnect cannot reach the TCP listener", tcpConnections === 0, { tcpConnections });

  check(
    "CSP egress corpus",
    hits.length === 0 &&
      messages.includes("network APIs attempted") &&
      messages.includes("form attempted"),
    {
      hits,
      messages,
    }
  );
  check(
    "CSP enforces the resource directives",
    ["img-src", "style-src-elem", "font-src", "script-src-elem", "connect-src", "base-uri"].every(
      (d) => messages.some((m) => m.startsWith("CSP " + d + " "))
    ),
    messages
  );
  check(
    "sandbox refuses JavaScript and external popups",
    page.context().pages().length === 1 && !messages.includes("javascript stayed inside"),
    messages
  );

  check(
    "nodeType poisoning cannot hide a child",
    messages.includes("getter removed") && !messages.includes("getter bypass"),
    messages
  );

  check(
    "Worker, SharedWorker and ServiceWorker cannot run",
    messages.includes("Worker blocked") &&
      messages.includes("SharedWorker blocked") &&
      (messages.includes("ServiceWorker unavailable") ||
        messages.includes("ServiceWorker blocked")) &&
      !messages.some((x) => x.includes("executed")),
    messages
  );

  check(
    "parent, top, eval and Function blocked",
    ["parent blocked", "top blocked", "eval blocked", "Function blocked"].every((x) =>
      messages.includes(x)
    ),
    messages
  );
  check(
    "synchronous about:blank cannot expose a fresh realm",
    messages.includes("blank SecurityError") && !messages.includes("blank accessible"),
    messages
  );
  currentDocument = build(`<script>parent.postMessage({headerOrigin:origin},'*')</script>`);

  await page.evaluate(
    `{ const f=document.createElement("iframe");f.src=${JSON.stringify(`${origin}/frame?header`)};document.body.append(f); }`
  );

  await page.waitForTimeout(300);

  check(
    "response sandbox without iframe attribute",
    JSON.stringify(await page.evaluate("messages")).includes('"headerOrigin":"null"'),
    Schema.decodeUnknownSync(Schema.Json)(await page.evaluate("messages"))
  );
  currentCsp = FRAME_CSP + "; webrtc 'block'";
  currentDocument = html;
  await page.evaluate(
    `{ const f=document.createElement("iframe");f.src=${JSON.stringify(`${origin}/frame?webrtc`)};document.body.append(f); }`
  );
  await page.waitForTimeout(2500);
  check("Chrome CSP cannot replace host WebRTC lockdown", tcpBytes > 0 && udpPackets > 0, {
    tcpBytes,
    udpPackets,
  });
} finally {
  await chrome.close();
}

tcpBytes = 0;

udpPackets = 0;

// A closed declarative shadow root is intentionally unvalidated: tests the host's WebRTC backstop.
const dir = mkdtempSync(join(tmpdir(), "pv-security-"));

const main = join(dir, "main.cjs");

const mainSource = join(dir, "main.ts");

const preload = join(dir, "preload.cjs");

const preloadBuild = await Bun.build({
  entrypoints: [new URL("../../../apps/desktop/src/preload/index.ts", import.meta.url).pathname],
  target: "node",
  format: "cjs",
  external: ["electron"],
  plugins:
    process.env.PV_NEGATIVE_CONTROL === "1"
      ? [
          {
            name: "without-rtc-lockdown",
            setup(builder) {
              builder.onLoad({ filter: /preload\/lockdown\.ts$/ }, () => ({
                contents: "export const lockFrameWebRTC = () => {};",
                loader: "ts",
              }));
            },
          },
        ]
      : [],
});

if (!preloadBuild.success) throw new Error(preloadBuild.logs.map((log) => log.message).join("\n"));

const preloadOutput = preloadBuild.outputs[0];

if (!preloadOutput) throw new Error("preload build produced no script");

writeFileSync(preload, await preloadOutput.text());

const require = createRequire(new URL("../../../apps/desktop/package.json", import.meta.url));

const desktopSource = (file: string) =>
  new URL(`../../../apps/desktop/src/main/${file}`, import.meta.url).pathname;

const navigationHtml = build(
  `<meta http-equiv="refresh" content="0;url=${origin}/refresh"><script>parent.postMessage('navigation frame ready','*')</script>`
);

writeFileSync(
  mainSource,
  `import {app,protocol,session} from "electron";
import {Option} from ${JSON.stringify(new URL(import.meta.resolve("effect")).pathname)};
import {createMainWindow} from ${JSON.stringify(desktopSource("window.ts"))};
import {frameDocuments,frameResponse} from ${JSON.stringify(desktopSource("frames.ts"))};
import {registerAppScheme} from ${JSON.stringify(desktopSource("protocol.ts"))};
registerAppScheme();
app.whenReady().then(()=>{
const frames=frameDocuments();
const urls=Array.from({length:3},()=>frames.serve(${JSON.stringify(html)}));
const nav=frames.serve(${JSON.stringify(navigationHtml)});
const root="<body><script>window.messages=[];addEventListener('message',e=>messages.push(e.data))</script>"+urls.map(url=>"<iframe sandbox='allow-scripts' src='"+url+"'></iframe>").join('')+"<iframe sandbox='allow-scripts' src='"+nav+"'></iframe>";
protocol.handle('app',r=>r.url.includes('/frame/')?frameResponse(frames,r.url):new Response(root,{headers:{'Content-Type':'text/html','Content-Security-Policy':"default-src 'none';script-src 'unsafe-inline';frame-src app://polaris/frame/"}}));
session.defaultSession.setPermissionRequestHandler((w,p,cb)=>cb(false));
session.defaultSession.setPermissionCheckHandler((w,p,origin,details)=>origin!=='null'&&!String(details.requestingUrl).startsWith('app://polaris/frame/'));
createMainWindow({url:'app://polaris/index.html',preload:${JSON.stringify(preload)},trusted:url=>url==='app://polaris/index.html',show:false,icon:null,savedState:Option.none(),saveState:()=>{}});
});`
);

const mainBuild = await Bun.build({
  entrypoints: [mainSource],
  target: "node",
  format: "cjs",
  external: ["electron"],
});

if (!mainBuild.success) throw new Error(mainBuild.logs.map((log) => log.message).join("\n"));

const mainOutput = mainBuild.outputs[0];

if (!mainOutput) throw new Error("main build produced no script");

writeFileSync(main, await mainOutput.text());

const electronEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] =>
      entry[1] !== undefined && entry[0] !== "ELECTRON_RUN_AS_NODE"
  )
);

const app = await _electron.launch({
  env: electronEnv,
  executablePath: Schema.decodeUnknownSync(Schema.String)(require("electron")),
  args: ["--use-mock-keychain", main],
  timeout: 20000,
});

try {
  console.log(
    JSON.stringify({ engine: "Electron", versions: await app.evaluate(() => process.versions) })
  );
  const page = await app.firstWindow();

  await page.waitForTimeout(6000);

  const childMessages = Schema.decodeUnknownSync(Schema.Array(Schema.String))(
    await page.evaluate("messages")
  );

  check(
    "Electron child actually ran without Node or Polaris",
    childMessages.includes("child ready undefined,undefined,undefined"),
    childMessages
  );
  check(
    "Electron main frame keeps Polaris",
    await page.evaluate("typeof polaris.request === 'function'"),
    null
  );
  check(
    "Electron host WebRTC backstop (UDP AND TCP)",
    tcpBytes === 0 && udpPackets === 0 && childMessages.some((x) => x.startsWith("RTC blocked:")),
    {
      tcpBytes,
      udpPackets,
      messages: Schema.decodeUnknownSync(Schema.Json)(await page.evaluate("messages")),
    }
  );
  check(
    "Electron stops meta refresh before egress",
    childMessages.includes("navigation frame ready") && hits.length === 0,
    { hits, childMessages }
  );
  console.log(
    JSON.stringify({
      memory: await app.evaluate(({ app }) =>
        app.getAppMetrics().map((p) => ({ type: p.type, memory: p.memory }))
      ),
      negativeControl: process.env.PV_NEGATIVE_CONTROL === "1",
    })
  );
} finally {
  await app.close();
  tcp.close();
  udp.close();

  await server.stop(true);
}

console.log(
  JSON.stringify({ passed: results.filter((r) => r.pass).length, total: results.length })
);

process.exit(results.every((r) => r.pass) ? 0 : 1);
