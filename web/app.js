/* ---------------------------------------------------------------------------
   app.js — the reader.
   Progress lives in .scouter/progress on disk, served by bin/serve, so the
   browser and the `scouter` CLI are always looking at the same file.
   --------------------------------------------------------------------------- */

import { render } from "./md.js";

const THEMES = ["capsule", "goku", "piccolo", "bulma", "majin-buu", "mr-popo", "freezer"];

const LANG_NAMES = { en: "EN", es: "ES" };

const state = {
    capsules: [], power: 0, maxPower: 9000, sagas: [], mainSagas: 5,
    current: null, languages: ["en"],
    lang: localStorage.getItem("ga-lang") || "en",
};
const $ = (sel) => document.querySelector(sel);

/** Prefix a repo-relative doc path with the active language directory. */
const langPath = (p) => (state.lang === "en" ? p : `${state.lang}/${p}`);

/** Localized field with an English fallback: t(capsule, "title"). */
const t = (obj, field) =>
    (state.lang !== "en" && obj[`${field}_${state.lang}`]) || obj[field];

/** UI strings. Everything else comes from the markdown. */
const UI = {
    en: {
        next: "NEXT", nextUp: "Next up", complete: "Mark complete",
        completed: "✔ complete — click to undo", inProgress: "in progress",
        markProgress: "Mark in progress", copyCli: "Copy CLI command",
        search: "Search capsules   /", mainDone: "main arc complete",
        capsules: "capsules", target: "target", loading: "loading…",
        back: "← back to the map", reference: "Reference",
        heroKicker: "27 capsules · 10 bonus · one repo you build yourself",
        heroTitle: "Train under heavier gravity until normal load feels light.",
        heroBody: "GCP essentials to solid intermediate, and system design at scale — one 45-minute capsule at a time. Every lab lands as a commit in your own <code>gravity-chamber</code> repo.",
        allDone: "The main arc is complete.",
        allDoneBody: (p) => `Power level ${p}. The Filler Arc takes you over 9000.`,
        power: "power", notTranslated: "",
    },
    es: {
        next: "SIGUIENTE", nextUp: "Ahora", complete: "Marcar como completa",
        completed: "✔ completa — clic para deshacer", inProgress: "en progreso",
        markProgress: "Marcar en progreso", copyCli: "Copiar comando CLI",
        search: "Buscar cápsulas   /", mainDone: "arco principal",
        capsules: "cápsulas", target: "objetivo", loading: "cargando…",
        back: "← volver al mapa", reference: "Referencia",
        heroKicker: "27 cápsulas · 10 bonus · un repo que construís vos",
        heroTitle: "Entrená con más gravedad hasta que la carga normal se sienta liviana.",
        heroBody: "De lo esencial de GCP a un intermedio sólido, y diseño de sistemas a escala — una cápsula de 45 minutos por vez. Cada lab termina como un commit en tu propio repo <code>gravity-chamber</code>.",
        allDone: "El arco principal está completo.",
        allDoneBody: (p) => `Power level ${p}. El Arco de Relleno te lleva más allá de 9000.`,
        power: "de power", notTranslated: "Todavía no traducido — mostrando el original en inglés.",
    },
};
const ui = () => UI[state.lang] || UI.en;

// --- data -------------------------------------------------------------------

async function loadState() {
    const r = await fetch("/api/state");
    Object.assign(state, await r.json());
}

async function setStatus(id, status) {
    const r = await fetch("/api/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
    });
    if (!r.ok) {
        toast("could not save progress");
        return;
    }
    const before = state.power;
    Object.assign(state, await r.json());
    renderSidebar();
    if (state.power > before) {
        const delta = state.power - before;
        toast(
            state.power >= 9000 && before < 9000
                ? "IT'S OVER 9000!"
                : `+${delta} power level — ${state.power.toLocaleString()}`
        );
    }
}

const byId = (id) => state.capsules.find((c) => c.id === id);

function nextCapsule() {
    return state.capsules.find((c) => !c.bonus && c.status !== "done") || null;
}

// --- chrome -----------------------------------------------------------------

function renderSidebar() {
    const pct = Math.min(100, Math.round((state.power / state.maxPower) * 100));
    $("#power-value").textContent = state.power.toLocaleString();
    $("#power-value").classList.toggle("over", state.power > state.maxPower);
    $("#power-meter").style.width = pct + "%";

    const doneMain = state.capsules.filter((c) => !c.bonus && c.status === "done").length;
    const totalMain = state.capsules.filter((c) => !c.bonus).length;
    $("#power-note").textContent = `${doneMain}/${totalMain} ${ui().capsules} · ${ui().target} 9,000`;

    const q = ($("#search").value || "").toLowerCase();
    const nav = $("#nav");
    nav.innerHTML = "";

    state.sagas.forEach((saga) => {
        const caps = state.capsules.filter(
            (c) => c.saga === saga.index &&
                 (!q || (c.id + " " + c.title + " " + t(c, "title")).toLowerCase().includes(q))
        );
        if (!caps.length) return;

        const head = document.createElement("div");
        head.className = "saga-head" + (saga.index > state.mainSagas ? " bonus" : "");
        head.innerHTML = `${t(saga, "name")}<span>${t(saga, "subtitle")}</span>`;
        nav.appendChild(head);

        caps.forEach((c) => {
            const btn = document.createElement("button");
            btn.className = `cap ${c.status}` + (state.current === c.id ? " active" : "");
            btn.innerHTML =
                `<span class="dot"></span>` +
                `<span class="cap-id">${c.id}</span>` +
                `<span class="cap-title">${t(c, "title").replace(/^[^—]*—\s*/, "")}</span>`;
            btn.title = t(c, "title");
            btn.onclick = () => go(c.id);
            nav.appendChild(btn);
        });
    });
}

function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove("show"), 2600);
}

// --- views ------------------------------------------------------------------

function renderHome() {
    state.current = null;
    const next = nextCapsule();
    const main = $("#main");

    const tiles = state.sagas
        .map((s) => {
            const caps = state.capsules.filter((c) => c.saga === s.index);
            if (!caps.length) return "";
            const done = caps.filter((c) => c.status === "done").length;
            return `<button class="tile" data-saga="${s.index}">
        <span class="tile-count">${done}/${caps.length}</span>
        <h3>${t(s, "name")}</h3>
        <p>${t(s, "subtitle")}</p>
        <div class="tile-meter"><i style="width:${(done / caps.length) * 100}%"></i></div>
      </button>`;
        })
        .join("");

    main.innerHTML = `
    <div class="hero">
      <span class="kicker">${ui().heroKicker}</span>
      <h2>${ui().heroTitle}</h2>
      <p>${ui().heroBody}</p>
    </div>

    ${
        next
            ? `<div class="next-card" id="next-card">
                 <div class="num">${next.id}</div>
                 <div>
                   <h3>${t(next, "title")}</h3>
                   <p>${ui().nextUp} · ${t(state.sagas[next.saga], "name")} — ${t(state.sagas[next.saga], "subtitle")}</p>
                 </div>
               </div>`
            : `<div class="next-card"><div class="num">✔</div>
                 <div><h3>${ui().allDone}</h3>
                 <p>${ui().allDoneBody(state.power.toLocaleString())}</p></div></div>`
    }

    <div class="grid">${tiles}</div>

    <div class="panel"><div class="doc" id="home-doc"><p class="loading">${ui().loading}</p></div></div>
  `;

    main.querySelectorAll(".tile").forEach((t) => {
        t.onclick = () => {
            const first = state.capsules.find((c) => c.saga === +t.dataset.saga);
            if (first) go(first.id);
        };
    });
    const nc = $("#next-card");
    if (nc && next) nc.onclick = () => go(next.id);

    loadDoc("docs/how-this-works.md").then((md) => {
        $("#home-doc").innerHTML = render(md);
        wireDoc($("#home-doc"));
    });

    renderSidebar();
    window.scrollTo(0, 0);
}

/** Fetch a doc in the active language, falling back to English if untranslated. */
async function loadDoc(path) {
    if (state.lang !== "en") {
        const t = await fetch("/api/doc/" + langPath(path));
        if (t.ok) return t.text();
        // fall through: this page isn't translated yet
    }
    const r = await fetch("/api/doc/" + path);
    if (!r.ok) throw new Error("not found: " + path);
    return r.text();
}

/** True when the active language actually has this doc. */
async function hasTranslation(path) {
    if (state.lang === "en") return true;
    const r = await fetch("/api/doc/" + langPath(path), { method: "GET" });
    return r.ok;
}

async function renderCapsule(id) {
    const cap = byId(id);
    if (!cap) return renderHome();

    state.current = id;
    renderSidebar();

    const main = $("#main");
    main.innerHTML = `<div class="panel"><p class="loading">${ui().loading}</p></div>`;
    window.scrollTo(0, 0);

    const docPath = `${cap.dir}/README.md`;
    const translated = await hasTranslation(docPath);

    let md;
    try {
        md = await loadDoc(docPath);
    } catch (e) {
        main.innerHTML = `<div class="panel"><div class="doc">
      <h1>Capsule ${id} — not written yet</h1>
      <p>${t(cap, "title")}</p>
      <p>Expected at <code>${cap.dir}/README.md</code>.</p></div></div>`;
        return;
    }

    const saga = state.sagas[cap.saga];
    const idx = state.capsules.indexOf(cap);
    const prev = state.capsules[idx - 1];
    const nxt = state.capsules[idx + 1];
    const isDone = cap.status === "done";

    main.innerHTML = `
    <div class="crumb">${t(saga, "name")} · ${t(saga, "subtitle")}${cap.points ? ` · ${cap.points} ${ui().power}` : ""}</div>
    ${translated ? "" : `<div class="fallback">${ui().notTranslated}</div>`}
    <div class="panel">
      <div class="doc" id="doc"></div>
      <div class="toolbar">
        <button class="btn ${isDone ? "done-state" : "primary"}" id="btn-done">
          ${isDone ? ui().completed : ui().complete}
        </button>
        <button class="btn ghost" id="btn-wip">${cap.status === "wip" ? ui().inProgress : ui().markProgress}</button>
        <button class="btn ghost" id="btn-cli">${ui().copyCli}</button>
      </div>
      <div class="pager">
        ${prev ? `<button class="btn ghost" data-go="${prev.id}">← ${prev.id} ${short(t(prev, "title"))}</button>` : "<span></span>"}
        ${nxt ? `<button class="btn" data-go="${nxt.id}">${nxt.id} ${short(t(nxt, "title"))} →</button>` : "<span></span>"}
      </div>
    </div>`;

    $("#doc").innerHTML = render(md);
    wireDoc($("#doc"));

    $("#btn-done").onclick = async () => {
        await setStatus(id, byId(id).status === "done" ? "todo" : "done");
        renderCapsule(id);
    };
    $("#btn-wip").onclick = async () => {
        await setStatus(id, byId(id).status === "wip" ? "todo" : "wip");
        renderCapsule(id);
    };
    $("#btn-cli").onclick = () => {
        navigator.clipboard.writeText(`./bin/scouter done ${id}`);
        toast("copied: ./bin/scouter done " + id);
    };
    main.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => go(b.dataset.go)));
}

const short = (t) => t.split("—")[0].trim().slice(0, 22);

/** Rewrite in-repo links to hash routes and wire up copy buttons. */
function wireDoc(root) {
    root.querySelectorAll("a[href]").forEach((a) => {
        const href = a.getAttribute("href");
        const m = href.match(/(?:^|\/)((?:B\d+|\d{2})-[a-z0-9-]+)\/README\.md$/i);
        if (m) {
            const id = m[1].split("-")[0];
            a.setAttribute("href", "#/" + id);
            return;
        }
        const doc = href.match(/(?:^|\/)docs\/([a-z0-9-]+\.md)$/i);
        if (doc) {
            a.setAttribute("href", "#/doc/" + doc[1]);
        }
    });

    root.querySelectorAll(".copy").forEach((btn) => {
        btn.onclick = () => {
            const code = btn.parentElement.querySelector("code");
            navigator.clipboard.writeText(code.textContent);
            btn.textContent = "copied";
            setTimeout(() => (btn.textContent = "copy"), 1400);
        };
    });
}

async function renderDocPage(file) {
    state.current = null;
    renderSidebar();
    const main = $("#main");
    main.innerHTML = `<div class="panel"><p class="loading">${ui().loading}</p></div>`;
    try {
        const md = await loadDoc("docs/" + file);
        main.innerHTML = `<div class="crumb">${ui().reference}</div>
      <div class="panel"><div class="doc" id="doc"></div>
      <div class="toolbar"><button class="btn ghost" id="home">${ui().back}</button></div></div>`;
        $("#doc").innerHTML = render(md);
        wireDoc($("#doc"));
        $("#home").onclick = () => (location.hash = "");
    } catch {
        main.innerHTML = `<div class="panel"><div class="doc"><h1>Not found</h1><p>docs/${file}</p></div></div>`;
    }
    window.scrollTo(0, 0);
}

// --- routing ----------------------------------------------------------------

function go(id) {
    location.hash = "#/" + id;
}

function route() {
    const h = location.hash.replace(/^#\/?/, "");
    if (!h) return renderHome();
    if (h.startsWith("doc/")) return renderDocPage(h.slice(4));

    const id = h.toUpperCase().startsWith("B") ? h.toUpperCase() : h;
    if (byId(id)) return renderCapsule(id);

    // Not a capsule id. A capsule's own table of contents links to its headings
    // as plain "#section" fragments, and those land here — routing them would
    // throw the reader back to the home page mid-read. Scroll instead.
    const target = document.getElementById(h);
    if (target) return target.scrollIntoView();

    return renderHome();
}

// --- boot -------------------------------------------------------------------

function initLang() {
    const wrap = $("#langs");
    if (!wrap) return;
    wrap.innerHTML = "";
    if (state.languages.length < 2) return; // nothing to toggle to

    state.languages.forEach((l) => {
        const b = document.createElement("button");
        b.className = "chip lang" + (l === state.lang ? " on" : "");
        b.textContent = LANG_NAMES[l] || l.toUpperCase();
        b.title = l === "es" ? "Español (rioplatense)" : "English";
        b.onclick = () => {
            state.lang = l;
            localStorage.setItem("ga-lang", l);
            wrap.querySelectorAll(".chip").forEach((c) => c.classList.remove("on"));
            b.classList.add("on");
            $("#search").placeholder = ui().search;
            document.documentElement.lang = l;
            renderSidebar();
            route(); // re-render the current view in the new language
        };
        wrap.appendChild(b);
    });
}

function initTheme() {
    const saved = localStorage.getItem("ga-theme") || "capsule";
    document.documentElement.setAttribute("data-theme", saved);

    const wrap = $("#themes");
    THEMES.forEach((t) => {
        const b = document.createElement("button");
        b.className = "chip" + (t === saved ? " on" : "");
        b.textContent = t.replace("majin-buu", "buu").replace("mr-popo", "popo");
        b.onclick = () => {
            document.documentElement.setAttribute("data-theme", t);
            localStorage.setItem("ga-theme", t);
            wrap.querySelectorAll(".chip").forEach((c) => c.classList.remove("on"));
            b.classList.add("on");
        };
        wrap.appendChild(b);
    });
}

function initKeys() {
    document.addEventListener("keydown", (e) => {
        if (e.target.tagName === "INPUT" || e.metaKey || e.ctrlKey) {
            if (e.key === "Escape") e.target.blur();
            return;
        }
        if (e.key === "/") {
            e.preventDefault();
            $("#search").focus();
            return;
        }
        if (!state.current) return;
        const i = state.capsules.findIndex((c) => c.id === state.current);
        if ((e.key === "j" || e.key === "ArrowRight") && state.capsules[i + 1]) go(state.capsules[i + 1].id);
        if ((e.key === "k" || e.key === "ArrowLeft") && state.capsules[i - 1]) go(state.capsules[i - 1].id);
        if (e.key === "Escape") location.hash = "";
    });
}

(async function boot() {
    initTheme();
    initKeys();
    await loadState();
    if (!state.languages.includes(state.lang)) state.lang = "en";
    initLang();
    $("#search").placeholder = ui().search;
    document.documentElement.lang = state.lang;
    $("#search").addEventListener("input", renderSidebar);
    $("#brand").onclick = () => (location.hash = "");
    window.addEventListener("hashchange", route);
    route();
})();
