// Where the backend lives. Empty string = same server that serves this page.
// For local dev with a separate backend use: "http://localhost:8000"
const API_BASE = "";
const MAX_FILES = 10;
const MAX_MB = 20;

const drop = document.getElementById("drop");
const input = document.getElementById("file");
const list = document.getElementById("list");
const goBtn = document.getElementById("go");
const clearBtn = document.getElementById("clear");
const errBox = document.getElementById("error");

let items = []; // { id, file, state: "ready"|"busy"|"ok"|"fail", url, msg }
let nextId = 0;
let running = false;

function fmtSize(n) {
  return n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB";
}

function showError(msg) {
  errBox.textContent = msg || "";
  errBox.hidden = !msg;
}

function addFiles(fileList) {
  const problems = [];
  for (const f of fileList) {
    if (!/\.docx$/i.test(f.name)) { problems.push(f.name + " is not a .docx file."); continue; }
    if (f.size > MAX_MB * 1048576) { problems.push(f.name + " is larger than " + MAX_MB + " MB."); continue; }
    if (items.length >= MAX_FILES) { problems.push("You can add up to " + MAX_FILES + " files at a time."); break; }
    items.push({ id: nextId++, file: f, state: "ready" });
  }
  showError(problems.join(" "));
  render();
}

function removeItem(id) {
  const it = items.find(x => x.id === id);
  if (it && it.url) URL.revokeObjectURL(it.url);
  items = items.filter(x => x.id !== id);
  render();
}

function render() {
  list.innerHTML = "";
  for (const it of items) {
    const li = document.createElement("li");

    const icon = document.createElement("span");
    icon.textContent = "📄";
    icon.style.fontSize = "1.3rem";

    const name = document.createElement("span");
    name.className = "name";
    name.textContent = it.file.name;
    name.title = it.file.name;

    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = fmtSize(it.file.size);

    li.append(icon, name, meta);

    if (it.state === "busy") {
      const s = document.createElement("span");
      s.className = "status busy";
      s.innerHTML = '<span class="spin"></span>Converting…';
      li.append(s);
    } else if (it.state === "ok") {
      const a = document.createElement("a");
      a.className = "btn small";
      a.href = it.url;
      a.download = it.file.name.replace(/\.docx$/i, "") + ".pdf";
      a.textContent = "Download PDF";
      li.append(a);
    } else if (it.state === "fail") {
      const s = document.createElement("span");
      s.className = "status fail";
      s.textContent = it.msg || "Failed";
      li.append(s);
    }

    if (!running) {
      const rm = document.createElement("button");
      rm.type = "button";
      rm.className = "rm";
      rm.setAttribute("aria-label", "Remove " + it.file.name);
      rm.textContent = "✕";
      rm.addEventListener("click", () => removeItem(it.id));
      li.append(rm);
    }
    list.append(li);
  }
  const pending = items.some(x => x.state === "ready" || x.state === "fail");
  goBtn.disabled = running || !pending;
  clearBtn.hidden = !items.length;
  clearBtn.disabled = running;
}

async function convertOne(it) {
  it.state = "busy";
  render();
  const body = new FormData();
  body.append("file", it.file);
  try {
    const res = await fetch(API_BASE + "/convert", { method: "POST", body });
    if (!res.ok) {
      let detail = "Conversion failed.";
      try { detail = (await res.json()).detail || detail; } catch (_) {}
      throw new Error(detail);
    }
    const blob = await res.blob();
    it.url = URL.createObjectURL(blob);
    it.state = "ok";
  } catch (e) {
    it.state = "fail";
    it.msg = e instanceof TypeError ? "Can’t reach the server." : e.message;
  }
  render();
}

async function convertAll() {
  running = true;
  showError("");
  render();
  for (const it of items) {
    if (it.state === "ready" || it.state === "fail") await convertOne(it);
  }
  running = false;
  render();
}

// Events
drop.addEventListener("click", () => input.click());
drop.addEventListener("keydown", e => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); }
});
input.addEventListener("change", () => { addFiles(input.files); input.value = ""; });
["dragenter", "dragover"].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", e => addFiles(e.dataTransfer.files));
goBtn.addEventListener("click", convertAll);
clearBtn.addEventListener("click", () => {
  items.forEach(it => it.url && URL.revokeObjectURL(it.url));
  items = [];
  showError("");
  render();
});

// Theme toggle (remembers choice when storage is available)
const root = document.documentElement;
try { const t = localStorage.getItem("theme"); if (t) root.setAttribute("data-theme", t); } catch (_) {}
document.getElementById("theme").addEventListener("click", () => {
  const cur = root.getAttribute("data-theme");
  const dark = cur ? cur === "dark" : matchMedia("(prefers-color-scheme:dark)").matches;
  const next = dark ? "light" : "dark";
  root.setAttribute("data-theme", next);
  try { localStorage.setItem("theme", next); } catch (_) {}
});

render();
