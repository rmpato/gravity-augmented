/* ---------------------------------------------------------------------------
   md.js — a small Markdown renderer, no dependencies.
   Covers exactly what the capsules use: headings, paragraphs, fenced code,
   GFM tables, blockquotes, nested lists, hr, inline code/bold/italic/links,
   and raw <details>/<summary> passthrough.
   --------------------------------------------------------------------------- */

const RX_HEAD = /^(#{1,6})\s+(.*)$/;
const RX_FENCE = /^```(\w*)\s*$/;
const RX_HR = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;
const RX_QUOTE = /^>\s?(.*)$/;
const RX_ULI = /^(\s*)[-*+]\s+(.*)$/;
const RX_OLI = /^(\s*)(\d+)[.)]\s+(.*)$/;
const RX_TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const RX_RAW = /^<\/?(details|summary|div|br|img|p|table|thead|tbody|tr|td|th)\b/i;

function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Inline markdown. Code spans are lifted out first so nothing rewrites them. */
export function inline(src) {
    const spans = [];
    let s = src.replace(/`([^`]+)`/g, (_, code) => {
        spans.push(code);
        return "\u0001" + (spans.length - 1) + "\u0001";
    });

    s = esc(s);

    // images before links — same syntax with a leading !
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img src="$2" alt="$1">');
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, href) => {
        const internal = /README\.md$|^\.\.\/|^docs\//.test(href);
        const attrs = internal ? "" : ' target="_blank" rel="noopener"';
        return `<a href="${href}"${attrs}>${text}</a>`;
    });

    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s.,;:!?)]|$)/g, "$1<em>$2</em>");
    s = s.replace(/(^|\s)_([^_\n]+)_(?=[\s.,;:!?)]|$)/g, "$1<em>$2</em>");
    s = s.replace(/~~([^~]+)~~/g, "<del>$1</del>");

    // restore code spans, escaped
    return s.replace(/\u0001(\d+)\u0001/g, (_, i) => `<code>${esc(spans[+i])}</code>`);
}

function renderTable(rows) {
    // GFM treats \| as a LITERAL pipe, not a column separator — it is the only
    // way to put a pipe inside a table cell, including inside a code span.
    // Splitting naively on "|" tears `curl ... \| sh` in half and shifts every
    // cell after it, dropping the last column off the row. Protect it first,
    // then restore — the same sentinel trick inline() uses for code spans.
    const PIPE = "\u0002";
    const cells = (line) =>
        line
            .replace(/\\\|/g, PIPE)
            .replace(/^\s*\|/, "")
            .replace(/\|\s*$/, "")
            .split("|")
            .map((c) => c.trim().split(PIPE).join("|"));

    const head = cells(rows[0]);
    let html = "<table><thead><tr>";
    head.forEach((h) => (html += `<th>${inline(h)}</th>`));
    html += "</tr></thead><tbody>";
    for (let i = 2; i < rows.length; i++) {
        const cs = cells(rows[i]);
        html += "<tr>";
        for (let c = 0; c < head.length; c++) html += `<td>${inline(cs[c] ?? "")}</td>`;
        html += "</tr>";
    }
    return html + "</tbody></table>";
}

export function render(src) {
    const lines = src.replace(/\r\n?/g, "\n").split("\n");
    const out = [];
    let i = 0;

    // list stack: [{ tag, indent }]
    let stack = [];
    const closeLists = (toIndent = -1) => {
        while (stack.length && stack[stack.length - 1].indent > toIndent) {
            out.push(`</${stack.pop().tag}>`);
        }
    };

    let para = [];
    const flushPara = () => {
        if (para.length) {
            out.push(`<p>${inline(para.join(" "))}</p>`);
            para = [];
        }
    };

    while (i < lines.length) {
        const line = lines[i];

        // --- fenced code -----------------------------------------------------
        const fence = line.match(RX_FENCE);
        if (fence) {
            flushPara();
            closeLists();
            const lang = fence[1] || "";
            const body = [];
            i++;
            while (i < lines.length && !/^```\s*$/.test(lines[i])) body.push(lines[i++]);
            i++; // closing fence
            out.push(
                `<div class="codewrap">` +
                    (lang ? `<span class="lang">${esc(lang)}</span>` : "") +
                    `<button class="copy" type="button">copy</button>` +
                    `<pre><code>${esc(body.join("\n"))}</code></pre></div>`
            );
            continue;
        }

        // --- raw html passthrough (details/summary) --------------------------
        if (RX_RAW.test(line.trim())) {
            flushPara();
            closeLists();
            // <summary> may contain inline markdown after its tags
            out.push(line);
            i++;
            continue;
        }

        // --- blank -----------------------------------------------------------
        if (!line.trim()) {
            flushPara();
            i++;
            continue;
        }

        // --- heading ----------------------------------------------------------
        const h = line.match(RX_HEAD);
        if (h) {
            flushPara();
            closeLists();
            const level = h[1].length;
            const text = inline(h[2]);
            const id = h[2]
                .toLowerCase()
                .replace(/[^\w\s-]/g, "")
                .trim()
                .replace(/\s+/g, "-");
            out.push(`<h${level} id="${id}">${text}</h${level}>`);
            i++;
            continue;
        }

        // --- table ------------------------------------------------------------
        if (line.includes("|") && i + 1 < lines.length && RX_TABLE_SEP.test(lines[i + 1])) {
            flushPara();
            closeLists();
            const rows = [];
            while (i < lines.length && lines[i].includes("|")) rows.push(lines[i++]);
            out.push(renderTable(rows));
            continue;
        }

        // --- hr ---------------------------------------------------------------
        if (RX_HR.test(line)) {
            flushPara();
            closeLists();
            out.push("<hr>");
            i++;
            continue;
        }

        // --- blockquote --------------------------------------------------------
        if (RX_QUOTE.test(line)) {
            flushPara();
            closeLists();
            const body = [];
            while (i < lines.length && RX_QUOTE.test(lines[i])) {
                body.push(lines[i].match(RX_QUOTE)[1]);
                i++;
            }
            out.push(`<blockquote>${render(body.join("\n"))}</blockquote>`);
            continue;
        }

        // --- lists -------------------------------------------------------------
        const ul = line.match(RX_ULI);
        const ol = line.match(RX_OLI);
        if (ul || ol) {
            flushPara();
            const indent = (ul ? ul[1] : ol[1]).length;
            const tag = ul ? "ul" : "ol";
            const text = ul ? ul[2] : ol[3];

            closeLists(indent);
            const top = stack[stack.length - 1];
            if (!top || top.indent < indent) {
                out.push(`<${tag}>`);
                stack.push({ tag, indent });
            } else if (top.tag !== tag) {
                out.push(`</${stack.pop().tag}>`);
                out.push(`<${tag}>`);
                stack.push({ tag, indent });
            }

            // continuation lines belong to this item
            const parts = [text];
            i++;
            while (
                i < lines.length &&
                lines[i].trim() &&
                !RX_ULI.test(lines[i]) &&
                !RX_OLI.test(lines[i]) &&
                !RX_HEAD.test(lines[i]) &&
                !RX_FENCE.test(lines[i]) &&
                !RX_HR.test(lines[i]) &&
                !RX_QUOTE.test(lines[i])
            ) {
                parts.push(lines[i].trim());
                i++;
            }
            out.push(`<li>${inline(parts.join(" "))}</li>`);
            continue;
        }

        // --- paragraph ---------------------------------------------------------
        closeLists();
        para.push(line.trim());
        i++;
    }

    flushPara();
    closeLists();
    return out.join("\n");
}
