// Gravity Augmented — arc recap reader.
// Plain script (not a module) so it also works when opened from file://.
// Routes:  #/            hub
//          #/saga/3      one saga
//          #/c/14        one capsule
(function () {
  "use strict";

  var main = document.getElementById("main");
  var side = document.getElementById("side");
  var STORE = "ga-recap-reviewed";

  // --- tiny helpers --------------------------------------------------------

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  // Content strings are trusted (they ship with the repo) and may carry
  // inline HTML such as <code>, <b>, <em>. Arrays become paragraphs.
  function paras(x) {
    if (!x) return "";
    var list = Array.isArray(x) ? x : [x];
    return list.map(function (p) { return /^\s*<(ul|ol|pre|p)\b/.test(p) ? p : "<p>" + p + "</p>"; }).join("");
  }
  function reviewed() {
    try { return JSON.parse(localStorage.getItem(STORE) || "{}"); } catch (e) { return {}; }
  }
  function setReviewed(id, on) {
    var r = reviewed();
    if (on) r[id] = new Date().toISOString().slice(0, 10); else delete r[id];
    try { localStorage.setItem(STORE, JSON.stringify(r)); } catch (e) { /* private mode: fine */ }
  }
  function capsBySaga(n) { return GA.capsules.filter(function (c) { return c.saga === n; }); }
  function capById(id) { return GA.capsules.find(function (c) { return c.id === id; }); }
  function sourceUrl(c) { return GA.repo + "/blob/main/" + c.path + "/README.md"; }
  function mainArc() { return GA.capsules.filter(function (c) { return c.saga <= 5; }); }

  // --- sidebar ---------------------------------------------------------------

  function renderSide(route) {
    var done = reviewed();
    var html = '<h2>The arc</h2>';
    GA.sagas.forEach(function (s) {
      var cur = route.saga === s.n && !route.cap;
      html += '<div class="side-saga"><a href="#/saga/' + s.n + '"' + (cur ? ' aria-current="page"' : "") + ">" +
        "Saga " + s.n + " · " + esc(s.name) + "<small>" + esc(s.theme) + " · " + s.range + "</small></a><ol>";
      capsBySaga(s.n).forEach(function (c) {
        var on = route.cap === c.id;
        html += '<li><a href="#/c/' + c.id + '"' + (on ? ' aria-current="page"' : "") + "><b>" + c.id + "</b><span>" +
          esc(c.name) + "</span>" + (done[c.id] ? '<span class="tick" title="Reviewed">✓</span>' : "") + "</a></li>";
      });
      html += "</ol></div>";
    });
    side.innerHTML = html;
  }

  // --- hub ---------------------------------------------------------------------

  function renderHub() {
    var done = reviewed();
    var html = '<header class="page-head"><p class="eyebrow">Arc recap</p>' +
      '<h1 class="display">Finished a saga? Lock it in.</h1>' +
      '<p class="lede">One page per capsule: the idea in plain words, a diagram of the mechanism, the traps, ' +
      'and a drill to answer from memory. It is a review of what you already built — not a replacement for doing the lab.</p></header>' +
      '<div class="how">' +
      '<div class="card"><b>1 · Recall first</b><span>Before reading a capsule page, say out loud what you remember about it.</span></div>' +
      '<div class="card"><b>2 · Read &amp; look</b><span>Check your version against the big idea and the diagrams. Note what you missed.</span></div>' +
      '<div class="card"><b>3 · Drill</b><span>Answer each drill question before you open it. A wrong answer you committed to teaches more.</span></div>' +
      "</div>";
    html += '<div class="saga-grid">';
    GA.sagas.forEach(function (s) {
      var caps = capsBySaga(s.n);
      var n = caps.filter(function (c) { return done[c.id]; }).length;
      html += '<a class="card saga-card" href="#/saga/' + s.n + '"><span class="num">Saga ' + s.n + " · " + s.range + "</span>" +
        '<h3 class="display">' + esc(s.name) + '</h3><p class="theme">' + esc(s.theme) + "</p><p>" + esc(s.outcome) + "</p>" +
        "<ul>" + caps.map(function (c) {
          return "<li><b>" + c.id + "</b>" + esc(c.name) + (done[c.id] ? ' <span style="color:var(--green);font-weight:800">✓</span>' : "") + "</li>";
        }).join("") + "</ul>" +
        '<p style="margin:10px 0 0;font-size:13px;color:var(--muted);font-weight:700">' + n + " / " + caps.length + " reviewed</p></a>";
    });
    html += "</div>";
    return html;
  }

  // --- saga ----------------------------------------------------------------

  function renderSaga(n) {
    var s = GA.sagas[n];
    if (!s) return notFound();
    var done = reviewed();
    var html = '<header class="page-head"><p class="eyebrow">Saga ' + s.n + " · Capsules " + s.range + "</p>" +
      '<h1 class="display">' + esc(s.name) + " — " + esc(s.theme) + '</h1><p class="lede">' + esc(s.outcome) + ".</p></header>";
    html += '<ol class="cap-list">';
    capsBySaga(n).forEach(function (c) {
      var r = GA.recaps[c.id];
      html += '<li><a class="card cap-row" href="#/c/' + c.id + '"><span class="id">' + c.id + "</span><div>" +
        '<h3 class="display">' + esc(c.name) + "<small>" + esc(c.topic) + "</small></h3>" +
        (r ? "<p>" + r.tagline + "</p>" : '<p style="color:var(--muted)">Recap coming soon.</p>') + "</div>" +
        '<span class="state' + (done[c.id] ? " done" : "") + '">' + (done[c.id] ? "✓ Reviewed" : "Review →") + "</span></a></li>";
    });
    html += "</ol>";
    if (GA.threads[n]) {
      html += '<section class="card saga-thread"><h2 class="display">The thread through this saga</h2><div class="prose">' + paras(GA.threads[n]) + "</div></section>";
    }
    var nav = '<nav class="pager">';
    if (n > 0) nav += '<a class="card" href="#/saga/' + (n - 1) + '"><small>← Previous saga</small><b>' + esc(GA.sagas[n - 1].name) + "</b></a>";
    if (n < GA.sagas.length - 1) nav += '<a class="card next" href="#/saga/' + (n + 1) + '"><small>Next saga →</small><b>' + esc(GA.sagas[n + 1].name) + "</b></a>";
    return html + nav + "</nav>";
  }

  // --- capsule ---------------------------------------------------------------

  function section(title, body) {
    return body ? '<section class="r-section"><h2 class="display">' + title + "</h2>" + body + "</section>" : "";
  }

  function capLink(id) {
    var c = capById(id);
    return c ? '<a href="#/c/' + c.id + '">' + c.id + " · " + esc(c.name) + "</a>" : esc(id);
  }

  function renderCapsule(id) {
    var c = capById(id);
    if (!c || c.saga > 5) return notFound();
    var s = GA.sagas[c.saga];
    var r = GA.recaps[id];
    var html = '<header class="cap-head"><p class="crumbs"><a href="#/">Recap</a> / <a href="#/saga/' + s.n + '">Saga ' + s.n + " · " + esc(s.name) + "</a></p>" +
      '<h1 class="display">' + c.id + " · " + esc(c.name) + "<small>" + esc(c.topic) + "</small></h1>" +
      (r ? '<p class="tagline">' + r.tagline + "</p>" : "") + "</header>";

    if (!r) {
      html += '<div class="card empty"><p>The recap for this capsule hasn\'t been written yet.</p>' +
        '<p><a class="btn" href="' + sourceUrl(c) + '">Read the full capsule on GitHub</a></p></div>';
      return html + pager(c);
    }

    if (r.built) html += section("What you built", '<div class="card built"><p>' + r.built + "</p></div>");
    html += section("The big idea", '<div class="prose">' + paras(r.story) + "</div>");

    if (r.diagrams && r.diagrams.length) {
      html += section("See it", r.diagrams.map(function (d) {
        return '<figure class="card figure">' + (d.title ? "<h3>" + d.title + "</h3>" : "") + '<div class="dg-scroll">' + d.svg + "</div>" +
          (d.caption ? "<figcaption>" + d.caption + "</figcaption>" : "") + "</figure>";
      }).join(""));
    }

    if (r.concepts && r.concepts.length) {
      html += section("Key concepts", '<div class="concepts">' + r.concepts.map(function (k) {
        return '<div class="card concept"><h3>' + k.term + "</h3><p>" + k.plain + "</p>" +
          (k.why ? '<p class="why"><b>Why it matters:</b> ' + k.why + "</p>" : "") + "</div>";
      }).join("") + "</div>");
    }

    if (r.numbers && r.numbers.length) {
      html += section("Numbers worth remembering", '<div class="numbers">' + r.numbers.map(function (x) {
        return '<div class="card number"><div class="v">' + x.value + '</div><div class="l">' + x.label + "</div>" +
          (x.note ? '<div class="n">' + x.note + "</div>" : "") + "</div>";
      }).join("") + "</div>");
    }

    if (r.traps && r.traps.length) {
      html += section("Traps you now know to avoid", '<div class="traps">' + r.traps.map(function (t) {
        return '<div class="card trap"><div class="myth"><span class="tag">The trap</span>' + t.myth +
          '</div><div class="truth"><span class="tag">What you learned</span>' + t.truth + "</div></div>";
      }).join("") + "</div>");
    }

    if (r.gcp && r.gcp.length) {
      html += section("In GCP", '<table class="gcp"><thead><tr><th>Service</th><th>What it does for you here</th></tr></thead><tbody>' +
        r.gcp.map(function (g) { return "<tr><td>" + g.service + "</td><td>" + g.role + "</td></tr>"; }).join("") + "</tbody></table>");
    }

    if (r.takeaways && r.takeaways.length) {
      html += section("Bring it to work", '<ul class="takeaways">' + r.takeaways.map(function (t) { return "<li>" + t + "</li>"; }).join("") + "</ul>");
    }

    if (r.drill && r.drill.length) {
      html += section("Drill — answer before you open",
        '<p class="drill-note">Say your answer out loud first. Then open it and compare.</p><div class="drill">' +
        r.drill.map(function (d) {
          return "<details><summary>" + d.q + '</summary><div class="answer">' + paras(d.a) + "</div></details>";
        }).join("") + "</div>");
    }

    if (r.connects) {
      var back = r.connects.back, fwd = r.connects.forward;
      html += section("How it connects", '<div class="connects">' +
        (back ? '<div class="card"><h3>Builds on</h3><p>' + back + "</p></div>" : "") +
        (fwd ? '<div class="card"><h3>Sets up</h3><p>' + fwd + "</p></div>" : "") + "</div>");
    }

    var isDone = !!reviewed()[id];
    html += '<div class="mark-row"><button class="btn' + (isDone ? " is-done" : "") + '" id="mark" type="button">' +
      (isDone ? "✓ Reviewed" : "Mark as reviewed") + '</button>' +
      '<a class="btn" href="' + sourceUrl(c) + '">Full capsule on GitHub ↗</a>' +
      "<p>Stored only in this browser.</p></div>";
    return html + pager(c);
  }

  function pager(c) {
    var arc = mainArc();
    var i = arc.findIndex(function (x) { return x.id === c.id; });
    var prev = arc[i - 1], next = arc[i + 1];
    var html = '<nav class="pager">';
    if (prev) html += '<a class="card" href="#/c/' + prev.id + '"><small>← ' + prev.id + "</small><b>" + esc(prev.name) + "</b></a>";
    if (next) html += '<a class="card next" href="#/c/' + next.id + '"><small>' + next.id + " →</small><b>" + esc(next.name) + "</b></a>";
    return html + "</nav>";
  }

  function notFound() {
    return '<div class="card empty"><p>Nothing here.</p><p><a class="btn" href="#/">Back to the recap</a></p></div>';
  }

  // --- router ----------------------------------------------------------------

  function parse() {
    var h = location.hash.replace(/^#\/?/, "");
    var m;
    if ((m = h.match(/^saga\/(\d)$/))) return { saga: +m[1] };
    if ((m = h.match(/^c\/(\d\d)$/))) { var c = capById(m[1]); return { cap: m[1], saga: c ? c.saga : null }; }
    return {};
  }

  function render() {
    var route = parse();
    var html, title = "Arc Recap · Gravity Augmented";
    if (route.cap) {
      html = renderCapsule(route.cap);
      var c = capById(route.cap);
      if (c) title = c.id + " · " + c.name + " — Recap";
    } else if (route.saga != null) {
      html = renderSaga(route.saga);
      if (GA.sagas[route.saga]) title = GA.sagas[route.saga].name + " — Recap";
    } else {
      html = renderHub();
    }
    main.innerHTML = html;
    document.title = title;
    renderSide(route);
    side.classList.remove("open");
    window.scrollTo(0, 0);

    var mark = document.getElementById("mark");
    if (mark) mark.addEventListener("click", function () {
      var on = !reviewed()[route.cap];
      setReviewed(route.cap, on);
      mark.classList.toggle("is-done", on);
      mark.textContent = on ? "✓ Reviewed" : "Mark as reviewed";
      renderSide(route);
    });
  }

  document.getElementById("menu-toggle").addEventListener("click", function () { side.classList.toggle("open"); });
  window.addEventListener("hashchange", render);
  render();
})();
