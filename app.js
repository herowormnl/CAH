"use strict";
/* Schaamteloos — spellogica en schermen.
   Drie modi:
   - local:  één telefoon die rondgaat
   - room:   iedereen z'n eigen telefoon, samen in één ruimte (rechter leest voor)
   - remote: iedereen z'n eigen telefoon, op afstand (iedereen ziet alles)
   Bij room/remote is de telefoon van de maker de "host": die houdt het spel bij
   en stuurt elke speler alleen wat die mag zien. Verbinding via WebRTC (PeerJS). */

const HAND = 7, MAXP = 10;
const BLANCO = "\u0000blanco";
const KEY_LOCAL = "schaamteloos.v1", KEY_HOST = "schaamteloos.host.v1", KEY_CLIENT = "schaamteloos.client.v1", KEY_ME = "schaamteloos.me.v1";
const PEER_PREFIX = "schaamteloos-nl-";
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ";
const PEERJS_URL = "https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js";
const QR_URL = "https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js";
const PARAMS = new URLSearchParams(location.search);
// Tussenstation (TURN) voor netwerken waar telefoons niet rechtstreeks kunnen verbinden,
// zoals veel mobiele data. Deze sleutel mag in de app staan: hij geeft alleen toegang tot het tussenstation.
const TURN_URL = "https://schaamteloos.metered.live/api/v1/turn/credentials?apiKey=5f3e642195814b83106fd6263b45e30b740e";
const KEY_ICE = "schaamteloos.ice.v1";
const NO_NET = !!window.SCHAAM_NO_NET;

/* ---------- Helpers ---------- */
const $ = s => document.querySelector(s);
const main = $("#main"), bar = $("#bar"), overlay = $("#overlay");
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const rid = (n = 10) => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join("");
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const pickOf = t => (t.match(/___/g) || []).length || 1;
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} }
};
const scripts = {};
function loadScript(url) {
  return scripts[url] || (scripts[url] = new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = url; s.async = true;
    s.onload = res; s.onerror = () => { delete scripts[url]; rej(new Error("script")); };
    document.head.appendChild(s);
  }));
}
function myId() { let id = store.get(KEY_ME); if (!id) { id = rid(12); store.set(KEY_ME, id); } return id; }
const plural = (n, one, more) => n === 1 ? one : more;

function fillHTML(text, answers) {
  let i = 0;
  let html = esc(text).replace(/___/g, (m, off, str) => {
    if (i >= answers.length) return '<span class="blank"></span>';
    const before = str.slice(0, off).replace(/&#39;/g, "'").trim();
    let a = answers[i++];
    a = (before === "" || /[.!?:']$/.test(before)) ? cap(a) : a;
    return `<span class="fill">${esc(a)}</span>`;
  });
  if (!text.includes("___")) html += answers.map(a => `<span class="fill block">${esc(cap(a))}.</span>`).join("");
  return html;
}
function blackCard(text, answers = [], cls = "", footLeft = "Schaamteloos") {
  const p = pickOf(text);
  return `<div class="bcard ${cls}"><div>${fillHTML(text, answers)}</div><div class="foot"><span>${footLeft}</span>${p > 1 ? `<span class="pick">Kies ${p}</span>` : ""}</div></div>`;
}

/* ---------- Spelmotor (gedeeld door alle modi) ---------- */
function blackList(version) { return version === "grof" ? CARDS.normaal.black.concat(CARDS.grof.black) : CARDS.normaal.black.slice(); }
function whiteList(version) {
  const w = version === "grof" ? CARDS.normaal.white.concat(CARDS.grof.white) : CARDS.normaal.white.slice();
  return w.concat(Array(version === "grof" ? 12 : 10).fill(BLANCO));
}
function freshDecks(G) { G.deckB = shuffle(blackList(G.version)); G.deckW = shuffle(whiteList(G.version)); G.discardW = []; }
function drawW(G) {
  if (!G.deckW.length) { G.deckW = shuffle(G.discardW); G.discardW = []; }
  if (!G.deckW.length) G.deckW = shuffle(whiteList(G.version));
  return G.deckW.pop();
}
function drawB(G) { if (!G.deckB.length) G.deckB = shuffle(blackList(G.version)); return G.deckB.pop(); }
function refill(G, p) { while (p.hand.length < HAND) p.hand.push(drawW(G)); }
const active = p => p.connected !== false;
function nextCzar(G) {
  const n = G.players.length, i = G.players.findIndex(p => p.pid === G.czarPid);
  for (let k = 1; k <= n; k++) { const p = G.players[((i + k) % n + n) % n]; if (active(p)) return p.pid; }
  return G.players[0] && G.players[0].pid;
}
function startRound(G) {
  G.round++;
  G.czarPid = nextCzar(G);
  G.players.forEach(p => refill(G, p));
  G.black = drawB(G);
  G.subs = []; G.last = null;
}
function resetScores(G) { G.players.forEach(p => { p.score = 0; G.discardW.push(...p.hand); p.hand = []; }); G.round = 0; G.winnerPid = null; G.last = null; G.subs = []; freshDecks(G); }
function playCards(G, p, idx, blank) {
  const pick = pickOf(G.black);
  if (!Array.isArray(idx) || idx.length !== pick) return false;
  if (new Set(idx).size !== idx.length || idx.some(i => !Number.isInteger(i) || i < 0 || i >= p.hand.length)) return false;
  const text = String(blank || "").trim().slice(0, 80);
  if (idx.some(i => p.hand[i] === BLANCO) && !text) return false;
  const cards = idx.map(i => p.hand[i] === BLANCO ? text : p.hand[i]);
  idx.slice().sort((a, b) => b - a).forEach(i => G.discardW.push(p.hand.splice(i, 1)[0]));
  G.subs.push({ pid: p.pid, name: p.name, cards });
  return true;
}
function award(G, i) {
  const sub = G.subs[i];
  const p = G.players.find(x => x.pid === sub.pid);
  if (p) p.score++;
  G.last = { pid: sub.pid, name: sub.name, cards: sub.cards, black: G.black, subs: G.subs.map(s => ({ pid: s.pid, name: s.name, cards: s.cards })) };
  if (p && p.score >= G.target) G.winnerPid = p.pid;
}

/* ---------- UI-status ---------- */
const UI = {
  screen: "home",          // home | version | localSetup | onlineChoice | hostSetup | join | local | net
  mode: null,              // local | room | remote
  version: "normaal",
  setup: { names: ["", "", ""], target: 5, error: "" },
  online: { name: "", code: "", target: 5, error: "" }
};
let S = null;              // lokaal spel (één telefoon)
let sel = [], selSig = "", blankText = "", judgeSel = null, menuConfirm = false, lastKey = null;

const MODES = {
  local: { name: "Eén telefoon", short: "Eén telefoon" },
  room: { name: "Samen in de kamer", short: "In de kamer" },
  remote: { name: "Online, vanuit huis", short: "Online" }
};
const VERSIONS = { normaal: "Normaal", grof: "Grof 18+" };

/* ---------- Render ---------- */
function render() {
  const v = currentView();
  const chip = headerChip();
  const mb = $("#menuBtn");
  mb.hidden = !chip; if (chip) mb.innerHTML = chip;
  if (v.key && v.key === lastKey) { patchLive(main, v.main); patchLive(bar, v.bar || ""); afterRender(); return; }
  lastKey = v.key || null;
  main.innerHTML = v.main; bar.innerHTML = v.bar || "";
  main.scrollTop = 0;
  afterRender();
}
function patchLive(root, html) {
  const t = document.createElement("template"); t.innerHTML = html;
  t.content.querySelectorAll("[data-live]").forEach(n => { const cur = root.querySelector("#" + n.id); if (cur) cur.replaceWith(n); });
}
function afterRender() {
  const q = $("#qr");
  if (q && !q.dataset.done) drawQR(q);
}
function currentView() {
  switch (UI.screen) {
    case "home": return viewHome();
    case "version": return viewVersion();
    case "localSetup": return viewLocalSetup();
    case "onlineChoice": return viewOnlineChoice();
    case "hostSetup": return viewHostSetup();
    case "join": return viewJoin();
    case "local": return viewLocal();
    case "net": return viewNet();
  }
  return viewHome();
}
function headerChip() {
  if (UI.screen === "local" && S) return `Stand <span class="n">ronde ${S.round}</span>`;
  if (UI.screen === "net" && NET.view) return `<span class="dot${NET.status === "ok" ? "" : " lost"}"></span>${esc(NET.view.code)} <span class="n">${NET.view.round ? "ronde " + NET.view.round : "lobby"}</span>`;
  return "";
}
function go(screen) { if (screen) UI.screen = screen; render(); }

/* ---------- Startschermen ---------- */
function viewHome() {
  const local = store.get(KEY_LOCAL), host = store.get(KEY_HOST), client = store.get(KEY_CLIENT);
  const resumes = [];
  if (local && local.players) resumes.push(`<div class="resume"><div><div class="eyebrow">Eén telefoon · ${VERSIONS[local.version || "normaal"]}</div><strong>Ronde ${local.round} · ${local.players.length} spelers</strong></div><button class="btn accent" type="button" data-act="resumeLocal">Ga verder</button></div>`);
  if (!NO_NET && host && host.code) resumes.push(`<div class="resume"><div><div class="eyebrow">Jouw online spel · ${MODES[host.mode].short}</div><strong>Code ${esc(host.code)} · ${host.players.length} spelers</strong></div><button class="btn accent" type="button" data-act="resumeHost">Hervat</button></div>`);
  else if (!NO_NET && client && client.code) resumes.push(`<div class="resume"><div><div class="eyebrow">Online spel</div><strong>Code ${esc(client.code)} als ${esc(client.name)}</strong></div><button class="btn accent" type="button" data-act="resumeClient">Doe weer mee</button></div>`);
  const netChoice = (m, ic, t, s) => NO_NET ? "" : `<button class="choice" type="button" data-act="mode" data-v="${m}"><span class="ic ${ic}" aria-hidden="true">${ic === "remote" ? "<i></i><b></b><i></i>" : "<i></i><i></i><i></i>"}</span><span><span class="t">${t}</span><span class="s">${s}</span></span></button>`;
  return {
    key: null,
    main: `
    ${resumes.join("")}
    <section class="stack">
      <h1>Het feestspel voor slechte mensen.</h1>
      <p class="lead">Speel je foutste kaart en laat de rechter kiezen. Voor 3 tot 10 spelers.</p>
    </section>
    ${blackCard("Mijn oma zegt dat ___ vroeger allemaal beter was.", ["hagelslag in mijn bed"])}
    <section class="stack">
      <div class="eyebrow">Hoe wil je spelen?</div>
      <div class="choices">
        <button class="choice" type="button" data-act="mode" data-v="local"><span class="ic one" aria-hidden="true"><i></i></span><span><span class="t">Eén telefoon</span><span class="s">Geef de telefoon rond. Werkt overal, ook zonder internet.</span></span></button>
        ${netChoice("room", "room", "Samen in de kamer", "Iedereen speelt op z'n eigen telefoon. De rechter leest voor.")}
        ${netChoice("remote", "remote", "Online, vanuit huis", "Ieder in z'n eigen huis, bijvoorbeeld naast een videogesprek. Iedereen ziet alles op z'n eigen scherm.")}
      </div>
      ${NO_NET ? `<p class="note">Spelen op meerdere telefoons kan in de geïnstalleerde app.</p>` : `<button class="joinlink" type="button" data-act="toJoin">Heb je een code? Doe mee met een spel</button>`}
    </section>
    ${rulesHTML()}`
  };
}
function rulesHTML() {
  return `<details class="rules">
    <summary>Hoe speel je?</summary>
    <ol>
      <li>Elke ronde is iemand de <strong>rechter</strong>. Die leest de zwarte kaart hardop voor.</li>
      <li>De rest kiest stiekem de grappigste witte kaart(en) uit z'n hand. Blanco kaarten vul je zelf in.</li>
      <li>De rechter ziet alle antwoorden anoniem, leest ze voor en kiest een winnaar. Die krijgt een punt.</li>
      <li>De rechter schuift door. Wie als eerste het puntentotaal haalt, wint.</li>
    </ol>
  </details>`;
}
function viewVersion() {
  const next = UI.mode === "local" ? "Daarna vul je de spelers in." : "Daarna krijg je een code om te delen.";
  return {
    key: null,
    main: `
    <button class="back" type="button" data-act="back" data-v="${UI.mode === "local" ? "home" : "onlineChoice"}">← Terug</button>
    <section class="stack">
      <div class="eyebrow">${MODES[UI.mode].name}</div>
      <h1>Hoe fout mag het worden?</h1>
      <p class="lead">${next}</p>
    </section>
    <div class="choices">
      <button class="choice" type="button" data-act="version" data-v="normaal"><span class="ic card" aria-hidden="true"><i></i><i></i></span><span><span class="t">Normaal</span><span class="s">Fout, maar kan nog net op een verjaardag. ${CARDS.normaal.black.length} vragen, ${CARDS.normaal.white.length} antwoorden.</span></span></button>
      <button class="choice dark" type="button" data-act="version" data-v="grof"><span class="ic card" aria-hidden="true"><i></i><i></i></span><span><span class="t">Grof · 18+</span><span class="s">Seks, drank, drugs en zwarte humor. Niet voor de schoonfamilie. Alle normale kaarten plus ${CARDS.grof.black.length + CARDS.grof.white.length} extra grove.</span></span></button>
    </div>`
  };
}
function stepper(id, val) {
  return `<div class="stepper"><button type="button" data-act="tdown" data-v="${id}" aria-label="Minder punten">−</button><output id="${id}">${val}</output><button type="button" data-act="tup" data-v="${id}" aria-label="Meer punten">+</button></div>`;
}
const targetRow = (id, val) => `<section class="setting"><div><div class="t">Punten om te winnen</div><div class="s">Eerste die dit haalt wint</div></div>${stepper(id, val)}</section>`;
const PLACEHOLDERS = ["Sanne", "Daan", "Lotte", "Mo", "Fleur", "Bram", "Noor", "Jesse", "Iris", "Thijs"];
function viewLocalSetup() {
  const st = UI.setup;
  const rows = st.names.map((n, i) => `
    <div class="prow">
      <span class="num">${i + 1}</span>
      <input class="field" id="name-${i}" data-name="${i}" value="${esc(n)}" placeholder="${PLACEHOLDERS[i]}" maxlength="18" autocomplete="off" enterkeyhint="next">
      ${st.names.length > 3 ? `<button class="x" type="button" data-act="rm" data-i="${i}" aria-label="Verwijder speler ${i + 1}">×</button>` : ""}
    </div>`).join("");
  return {
    key: null,
    main: `
    <button class="back" type="button" data-act="back" data-v="version">← Terug</button>
    <section class="stack">
      <div class="tags"><span class="tag">Eén telefoon</span><span class="tag${UI.version === "grof" ? " grof" : ""}">${VERSIONS[UI.version]}</span></div>
      <h2>Wie spelen er mee?</h2>
      <div class="players">${rows}</div>
      ${st.names.length < MAXP ? `<button class="add" type="button" data-act="add">+ Speler toevoegen</button>` : ""}
      ${st.error ? `<p class="err">${esc(st.error)}</p>` : ""}
    </section>
    ${targetRow("target", st.target)}`,
    bar: `<button class="btn" type="button" data-act="startLocal">Start spel</button>`
  };
}
function viewOnlineChoice() {
  return {
    key: null,
    main: `
    <button class="back" type="button" data-act="back" data-v="home">← Terug</button>
    <section class="stack">
      <div class="eyebrow">${MODES[UI.mode].name}</div>
      <h1>${UI.mode === "room" ? "Iedereen z'n eigen telefoon." : "Spelen op afstand."}</h1>
      <p class="lead">${UI.mode === "room"
        ? "Eén iemand maakt het spel en krijgt een code. De rest scant de QR-code of typt de code in."
        : "Eén iemand maakt het spel en stuurt de link of code rond. Handig naast een videogesprek, zodat je elkaar hoort lachen."}</p>
    </section>
    <div class="choices">
      <button class="choice" type="button" data-act="toHost"><span class="ic card" aria-hidden="true"><i></i><i></i></span><span><span class="t">Nieuw spel maken</span><span class="s">Jij kiest de versie en deelt de code. Hou je telefoon aan tijdens het spel.</span></span></button>
      <button class="choice" type="button" data-act="toJoin"><span class="ic ${UI.mode === "room" ? "room" : "remote"}" aria-hidden="true">${UI.mode === "room" ? "<i></i><i></i><i></i>" : "<i></i><b></b><i></i>"}</span><span><span class="t">Meedoen met een code</span><span class="s">Iemand anders heeft het spel al gemaakt.</span></span></button>
    </div>`
  };
}
function viewHostSetup() {
  const o = UI.online;
  return {
    key: null,
    main: `
    <button class="back" type="button" data-act="back" data-v="version">← Terug</button>
    <section class="stack">
      <div class="tags"><span class="tag">${MODES[UI.mode].short}</span><span class="tag${UI.version === "grof" ? " grof" : ""}">${VERSIONS[UI.version]}</span></div>
      <h2>Nieuw spel maken</h2>
      <label class="lbl" for="my-name">Jouw naam</label>
      <input class="field" id="my-name" data-oname="1" value="${esc(o.name)}" placeholder="Bijvoorbeeld Sanne" maxlength="18" autocomplete="nickname" enterkeyhint="done">
      ${o.error ? `<p class="err">${esc(o.error)}</p>` : ""}
    </section>
    ${targetRow("otarget", o.target)}
    <p class="note">Jouw telefoon houdt het spel bij. Laat het scherm aan en de app open tot het spel klaar is.</p>`,
    bar: `<button class="btn" type="button" data-act="createGame">Maak spel</button>`
  };
}
function viewJoin() {
  const o = UI.online;
  return {
    key: null,
    main: `
    <button class="back" type="button" data-act="back" data-v="${UI.mode && UI.mode !== "local" ? "onlineChoice" : "home"}">← Terug</button>
    <section class="stack">
      <h2>Meedoen met een spel</h2>
      <label class="lbl" for="join-code">Spelcode</label>
      <input class="field codefield" id="join-code" data-ocode="1" value="${esc(o.code)}" placeholder="ABCD" maxlength="4" autocomplete="off" autocapitalize="characters" spellcheck="false" enterkeyhint="next">
      <label class="lbl" for="my-name">Jouw naam</label>
      <input class="field" id="my-name" data-oname="1" value="${esc(o.name)}" placeholder="Bijvoorbeeld Daan" maxlength="18" autocomplete="nickname" enterkeyhint="go">
      ${o.error ? `<p class="err">${esc(o.error)}</p>` : ""}
    </section>`,
    bar: `<button class="btn" type="button" data-act="joinGame">Doe mee</button>`
  };
}

/* ---------- Eén telefoon ---------- */
function saveLocal() { S ? store.set(KEY_LOCAL, S) : store.del(KEY_LOCAL); }
function newLocal(names, target, version) {
  S = { mode: "local", version, target, round: 0, czarPid: null, players: names.map((n, i) => ({ pid: "p" + i, name: n, score: 0, hand: [] })), subs: [], queue: [], phase: "intro", last: null, winnerPid: null };
  freshDecks(S);
  S.czarPid = S.players[Math.floor(Math.random() * names.length)].pid;
  const i = S.players.findIndex(p => p.pid === S.czarPid);
  S.czarPid = S.players[(i - 1 + names.length) % names.length].pid; // startRound schuift één door
  localRound();
}
function localRound() {
  startRound(S);
  const n = S.players.length, ci = S.players.findIndex(p => p.pid === S.czarPid);
  S.queue = []; for (let k = 1; k < n; k++) S.queue.push(S.players[(ci + k) % n].pid);
  S.phase = "intro";
  UI.screen = "local"; saveLocal(); render();
}
const lp = pid => S.players.find(p => p.pid === pid);
function viewLocal() {
  const k = `local:${S.phase}:${S.round}:${S.queue[0] || ""}`;
  const czar = lp(S.czarPid);
  switch (S.phase) {
    case "intro": {
      const first = lp(S.queue[0]);
      return { key: k, main: `
        <section class="stack"><div class="eyebrow">Ronde ${S.round}</div><h1>${esc(czar.name)} is de rechter.</h1><p class="lead">${esc(czar.name)}, lees deze kaart hardop voor aan iedereen.</p></section>
        ${blackCard(S.black)}
        ${scoresHTML(S.players, S.target, S.czarPid)}`,
        bar: `<button class="btn" type="button" data-act="lToPass">Voorgelezen · geef aan ${esc(first.name)}</button>` };
    }
    case "pass": {
      const p = lp(S.queue[0]);
      return { key: k, main: passHTML("Geef de telefoon aan", p.name, `Niet spieken, de rest. ${S.subs.length} van ${S.players.length - 1} spelers heeft al gespeeld.`),
        bar: `<button class="btn" type="button" data-act="lToHand">Ik ben ${esc(p.name)} · toon mijn kaarten</button>` };
    }
    case "hand": {
      const p = lp(S.queue[0]);
      return { key: k + ":" + p.hand.join("|"), main: handHTML(p.hand, S.black, `${esc(p.name)} · ${pickLabel(S.black)}`), bar: playBtnHTML() };
    }
    case "passCzar":
      return { key: k, main: passHTML("Alle kaarten liggen erin · geef de telefoon aan de rechter", czar.name, "Lees straks elk antwoord hardop voor. Niemand verraadt welke van hem is."),
        bar: `<button class="btn" type="button" data-act="lToJudge">Ik ben ${esc(czar.name)} · toon de antwoorden</button>` };
    case "judge":
      return { key: k, main: `
        <section class="stack"><div class="eyebrow">${esc(czar.name)} · rechter</div><h2>Lees ze allemaal voor en kies de beste.</h2></section>
        ${judgeListHTML(S.black, S.subs.map(s => s.cards), true)}`,
        bar: judgeBtnHTML() };
    case "result": {
      const over = !!S.winnerPid;
      const next = lp(nextCzar(S));
      return { key: k, main: resultHTML(S.last, S.players, S.target, S.round, false),
        bar: over ? `<button class="btn accent" type="button" data-act="lToOver">Bekijk de eindstand</button>`
                  : `<button class="btn" type="button" data-act="lNext">Volgende ronde · ${esc(next.name)} is rechter</button>` };
    }
    case "over":
      return { key: k, main: overHTML(lp(S.winnerPid).name, S.round, S.players, S.target, S.winnerPid),
        bar: `<button class="btn accent" type="button" data-act="lAgain">Nog een potje, zelfde spelers</button><button class="btn ghost" type="button" data-act="quitLocal">Stoppen</button>` };
  }
}
function localSubmit() {
  const p = lp(S.queue[0]);
  if (!playCards(S, p, sel.slice(), blankText)) return;
  S.queue.shift(); sel = []; blankText = "";
  if (S.queue.length) S.phase = "pass"; else { S.subs = shuffle(S.subs); S.phase = "passCzar"; }
  saveLocal(); render();
}
function localJudge() {
  if (judgeSel === null) return;
  award(S, judgeSel); judgeSel = null; S.phase = "result";
  buzz(); saveLocal(); render();
}

/* ---------- Gedeelde stukken UI ---------- */
function passHTML(eyebrow, name, lead) {
  return `<section class="pass"><div class="stackcards" aria-hidden="true"><i></i><i></i><i></i></div><div class="eyebrow">${eyebrow}</div><div class="who">${esc(name)}</div><p class="lead">${lead}</p></section>`;
}
const pickLabel = black => pickOf(black) > 1 ? `kies ${pickOf(black)} kaarten, in volgorde` : "kies 1 kaart";
function curHand() {
  if (UI.screen === "local") return { hand: lp(S.queue[0]).hand, black: S.black };
  return { hand: NET.view.you.hand, black: NET.view.black };
}
function handHTML(hand, black, eyebrow, extraTop = "") {
  const sig = hand.join("|") + "#" + black;
  if (sig !== selSig) { sel = []; blankText = ""; selSig = sig; }
  const pick = pickOf(black);
  const cards = hand.map((c, i) => {
    const s = sel.indexOf(i), isB = c === BLANCO;
    return `<button type="button" class="wcard${isB ? " blanco" : ""}${s >= 0 ? " sel" : ""}" data-act="card" data-i="${i}" style="animation-delay:${i * 35}ms">${isB ? "Blanco kaart: schrijf je eigen antwoord" : esc(cap(c)) + "."}${s >= 0 && pick > 1 ? `<span class="badge">${s + 1}</span>` : ""}</button>`;
  }).join("");
  const hasB = sel.some(i => hand[i] === BLANCO);
  return `${extraTop}
    <section class="stack"><div class="eyebrow">${eyebrow}</div><div id="preview">${blackCard(black, chosenTexts(hand), "sm")}</div></section>
    <section class="stack" id="blankWrap" ${hasB ? "" : "hidden"}>
      <label class="lbl" for="blank-input">Jouw blanco kaart</label>
      <input class="field" id="blank-input" maxlength="80" placeholder="Typ je eigen antwoord" value="${esc(blankText)}" autocomplete="off">
    </section>
    <section class="hand deal" id="hand">${cards}</section>`;
}
function chosenTexts(hand) { return sel.map(i => hand[i] === BLANCO ? (blankText.trim() || "…") : hand[i]); }
function canPlay() {
  const { hand, black } = curHand();
  if (sel.length !== pickOf(black)) return false;
  if (sel.some(i => hand[i] === BLANCO) && !blankText.trim()) return false;
  return true;
}
function playLabel() {
  const { black } = curHand(), pick = pickOf(black);
  if (sel.length < pick) return pick > 1 ? `Kies nog ${pick - sel.length} ${plural(pick - sel.length, "kaart", "kaarten")}` : "Kies een kaart";
  if (!canPlay()) return "Vul je blanco kaart in";
  return pick > 1 ? "Speel deze kaarten" : "Speel deze kaart";
}
function playBtnHTML() { return `<button class="btn" type="button" id="playBtn" data-act="play" ${canPlay() ? "" : "disabled"}>${playLabel()}</button>`; }
function refreshHand() {
  const { hand, black } = curHand(), pick = pickOf(black);
  document.querySelectorAll("#hand .wcard").forEach(el => {
    const i = +el.dataset.i, s = sel.indexOf(i);
    el.classList.toggle("sel", s >= 0);
    const old = el.querySelector(".badge"); if (old) old.remove();
    if (s >= 0 && pick > 1) el.insertAdjacentHTML("beforeend", `<span class="badge">${s + 1}</span>`);
  });
  refreshPreview();
  $("#blankWrap").hidden = !sel.some(i => hand[i] === BLANCO);
}
function refreshPreview() {
  const { hand, black } = curHand();
  $("#preview").innerHTML = blackCard(black, chosenTexts(hand), "sm");
  const btn = $("#playBtn"); if (btn) { btn.disabled = !canPlay(); btn.textContent = playLabel(); }
}
function judgeListHTML(black, answers, pickable) {
  return `<section class="stack">${answers.map((cards, i) => pickable
    ? `<button type="button" class="bcard sm pickable${judgeSel === i ? " sel" : ""}" data-act="jpick" data-i="${i}"><div>${fillHTML(black, cards)}</div><div class="foot"><span>Antwoord ${i + 1}</span>${judgeSel === i ? '<span class="pick">Gekozen</span>' : ""}</div></button>`
    : blackCard(black, cards, "sm", "Antwoord " + (i + 1))).join("")}</section>`;
}
function judgeBtnHTML() { return `<button class="btn" type="button" id="judgeBtn" data-act="judge" ${judgeSel === null ? "disabled" : ""}>Kies als winnaar</button>`; }
function resultHTML(last, players, target, round, showAll) {
  const others = showAll ? last.subs.filter(s => s.pid !== last.pid) : [];
  return `
    <section class="stack"><div class="eyebrow">Ronde ${round} · winnaar</div><h1>${esc(last.name)} pakt het punt.</h1></section>
    <div class="win-burst">${blackCard(last.black, last.cards, "", esc(last.name))}</div>
    ${others.length ? `<section class="stack"><div class="eyebrow">De rest</div>${others.map(s => blackCard(last.black, s.cards, "sm", esc(s.name))).join("")}</section>` : ""}
    ${scoresHTML(players, target, null, last.pid)}`;
}
function overHTML(name, round, players, target, winnerPid) {
  return `
    <section class="stack win-burst"><div class="eyebrow">Na ${round} ${plural(round, "ronde", "rondes")}</div><h1>${esc(name)} is officieel de meest schaamteloze.</h1><p class="lead">Gefeliciteerd. Denk er even over na wat dit over je zegt.</p></section>
    ${scoresHTML(players, target, null, winnerPid, true)}`;
}
function scoresHTML(players, target, czarPid, hiPid, final) {
  const rows = players.slice().sort((a, b) => b.score - a.score);
  const pips = n => target <= 10 ? Array.from({ length: target }, (_, k) => `<span class="pip${k < n ? " on" : ""}"></span>`).join("") : "";
  return `<section class="stack" id="live-scores" data-live="1">
    <div class="eyebrow">Stand · ${target} ${plural(target, "punt", "punten")} om te winnen</div>
    <ul class="scores">${rows.map(p => `
      <li class="${p.connected === false ? "off" : ""}"><span class="nm">${esc(p.name)}${p.pid === czarPid ? ' <span class="tag">rechter</span>' : ""}${p.pid === hiPid && !final ? ' <span class="tag y">+1</span>' : ""}${p.connected === false ? ' <span class="tag">weg</span>' : ""}</span>
      <span class="pts">${pips(p.score)}<span class="score">${p.score}</span></span></li>`).join("")}
    </ul></section>`;
}
function buzz() { try { navigator.vibrate && navigator.vibrate([30, 40, 60]); } catch (e) {} }

/* ---------- Verbinding ---------- */
// Elke verbinding: { send(obj), onData(fn), onClose(fn), close() }
let icePromise = null;
function iceServers() {
  // Haal de TURN-gegevens op (max. 5 s). Lukt dat niet, dan de laatst bekende of alleen STUN.
  if (icePromise) return icePromise;
  const stun = [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun.relay.metered.ca:80" }];
  icePromise = (async () => {
    if (PARAMS.get("noturn")) return stun;
    try {
      const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 5000);
      const r = await fetch(TURN_URL, { signal: ctl.signal, cache: "no-store" });
      clearTimeout(t);
      if (!r.ok) throw new Error("turn " + r.status);
      const list = await r.json();
      if (!Array.isArray(list) || !list.length) throw new Error("turn leeg");
      store.set(KEY_ICE, { at: Date.now(), list });
      return list;
    } catch (e) {
      icePromise = null; // volgende keer opnieuw proberen
      const old = store.get(KEY_ICE);
      return old && Array.isArray(old.list) ? old.list : stun;
    }
  })();
  return icePromise;
}
const PeerNet = {
  async opts() {
    const o = { debug: 0, config: { iceServers: await iceServers() } };
    if (PARAMS.get("peerhost")) Object.assign(o, { host: PARAMS.get("peerhost"), port: +PARAMS.get("peerport") || 9000, path: PARAMS.get("peerpath") || "/", secure: false });
    return o;
  },
  wrap(c) {
    let onD = () => {}, onC = () => {}, closed = false;
    c.on("data", d => onD(d));
    const fire = () => { if (!closed) { closed = true; onC(); } };
    c.on("close", fire); c.on("error", fire);
    return { send(d) { try { if (c.open) c.send(d); } catch (e) {} }, onData(f) { onD = f; }, onClose(f) { onC = f; }, close() { try { c.close(); } catch (e) {} fire(); } };
  },
  async host(code, onConn) {
    const [, opts] = await Promise.all([loadScript(PEERJS_URL), this.opts()]);
    return new Promise((res, rej) => {
      const peer = new Peer(PEER_PREFIX + code, opts);
      let opened = false;
      const t = setTimeout(() => { if (!opened) { peer.destroy(); rej(new Error("network")); } }, 15000);
      peer.on("open", () => { opened = true; clearTimeout(t); res({ close() { peer.destroy(); } }); });
      peer.on("connection", c => c.on("open", () => onConn(this.wrap(c))));
      peer.on("disconnected", () => { if (!peer.destroyed) setTimeout(() => { try { if (!peer.destroyed) peer.reconnect(); } catch (e) {} }, 1500); });
      peer.on("error", e => { if (!opened) { clearTimeout(t); peer.destroy(); rej(new Error(e.type === "unavailable-id" ? "taken" : "network")); } });
    });
  },
  async join(code) {
    const [, opts] = await Promise.all([loadScript(PEERJS_URL), this.opts()]);
    return new Promise((res, rej) => {
      const peer = new Peer(opts);
      let done = false, signalled = false;
      const fail = m => { if (done) return; done = true; peer.destroy(); rej(new Error(m)); };
      // Server wel bereikt maar geen verbinding met de maker: dan ligt het aan het netwerk.
      const t = setTimeout(() => fail(signalled ? "blocked" : "timeout"), 20000);
      peer.on("open", () => {
        signalled = true;
        const c = peer.connect(PEER_PREFIX + code, { reliable: true, serialization: "json" });
        c.on("open", () => {
          if (done) return; done = true; clearTimeout(t);
          const w = this.wrap(c), oc = w.close;
          w.close = () => { oc(); peer.destroy(); };
          w.onPeerGone = () => {};
          res(w);
        });
      });
      peer.on("error", e => fail(e.type === "peer-unavailable" ? "notfound" : "network"));
    });
  }
};
// Testverbinding tussen tabbladen in dezelfde browser (?net=local)
const LocalNet = {
  mk(ch, me, peer) {
    let onD = () => {}, onC = () => {}, open = true;
    return {
      send(d) { if (open) ch.postMessage({ to: peer, from: me, type: "data", data: JSON.parse(JSON.stringify(d)) }); },
      onData(f) { onD = f; }, onClose(f) { onC = f; },
      close() { if (!open) return; open = false; ch.postMessage({ to: peer, from: me, type: "bye" }); onC(); },
      _data(d) { onD(d); }, _close() { if (open) { open = false; onC(); } }
    };
  },
  async host(code, onConn) {
    const ch = new BroadcastChannel("schaam-" + code), conns = new Map();
    ch.onmessage = e => {
      const m = e.data; if (m.to !== "host") return;
      if (m.type === "hello") { const c = this.mk(ch, "host", m.from); conns.set(m.from, c); ch.postMessage({ to: m.from, from: "host", type: "welcome" }); onConn(c); }
      else if (m.type === "data") conns.get(m.from)?._data(m.data);
      else if (m.type === "bye") { conns.get(m.from)?._close(); conns.delete(m.from); }
    };
    return { close() { conns.forEach(c => c.close()); ch.close(); } };
  },
  join(code) {
    return new Promise((res, rej) => {
      const id = rid(8), ch = new BroadcastChannel("schaam-" + code), c = this.mk(ch, id, "host");
      const t = setTimeout(() => { ch.close(); rej(new Error("notfound")); }, 2500);
      ch.onmessage = e => {
        const m = e.data; if (m.to !== id) return;
        if (m.type === "welcome") { clearTimeout(t); res(c); }
        else if (m.type === "data") c._data(m.data);
        else if (m.type === "bye") c._close();
      };
      ch.postMessage({ to: "host", from: id, type: "hello" });
    });
  }
};
const Transport = PARAMS.get("net") === "local" ? LocalNet : PeerNet;

/* ---------- Online spel ---------- */
const NET = { role: null, code: null, pid: null, name: null, conn: null, server: null, view: null, status: "idle", error: "", lastMsg: 0, timers: [], left: false, retries: 0 };
let HS = null; // host-status
const conns = new Map(); // pid -> verbinding (alleen host)

function netReset() {
  NET.timers.forEach(clearInterval); NET.timers = [];
  if (NET.conn) { const c = NET.conn; NET.conn = null; c.close(); }
  if (NET.server) { NET.server.close(); NET.server = null; }
  conns.forEach(c => c.close()); conns.clear();
  Object.assign(NET, { role: null, code: null, view: null, status: "idle", error: "", left: false, retries: 0 });
  HS = null;
}
function netError(msg) { NET.status = "error"; NET.error = msg; render(); }
function newCode() { return Array.from(crypto.getRandomValues(new Uint8Array(4)), b => CODE_CHARS[b % CODE_CHARS.length]).join(""); }

/* -- Host -- */
async function hostStart(resume) {
  netReset();
  NET.role = "host"; NET.pid = myId(); NET.status = "connecting";
  UI.screen = "net"; render();
  let code = resume ? resume.code : newCode();
  for (let attempt = 0; ; attempt++) {
    try { NET.server = await Transport.host(code, hostOnConn); break; }
    catch (e) {
      if (UI.screen !== "net" || NET.role !== "host") return;
      if (e.message === "taken" && !resume && attempt < 4) { code = newCode(); continue; }
      if (e.message === "taken" && resume && attempt < 8) { NET.error = "Spel wordt hervat…"; await wait(4000); continue; }
      return netError(e.message === "taken" ? "Deze code is nog bezet. Probeer het over een minuut opnieuw." : "Geen verbinding met de spelserver. Controleer je internet en probeer opnieuw.");
    }
  }
  if (resume) { HS = resume; HS.players.forEach(p => { if (p.pid !== NET.pid) p.connected = false; }); }
  else {
    HS = { code, mode: UI.mode, version: UI.version, target: UI.online.target, hostPid: NET.pid, phase: "lobby", round: 0, czarPid: null, subs: [], last: null, winnerPid: null,
      players: [{ pid: NET.pid, name: UI.online.name.trim(), score: 0, hand: [], connected: true, host: true }] };
    freshDecks(HS);
  }
  NET.code = code; NET.status = "ok"; NET.error = "";
  NET.timers.push(setInterval(hostHeartbeat, 4000));
  wake(); hostUpdate();
}
function wait(ms) { return new Promise(r => setTimeout(r, ms)); }
function hostOnConn(conn) {
  let pid = null;
  conn.onData(msg => {
    if (!msg || typeof msg !== "object") return;
    if (!pid) {
      if (msg.t !== "join") return;
      const name = String(msg.name || "").trim().slice(0, 18), id = String(msg.pid || "").slice(0, 40);
      if (!name || !id) return conn.send({ t: "error", msg: "Vul een naam in." });
      if (id === HS.hostPid) return conn.send({ t: "error", msg: "Je bent zelf de host van dit spel op dit toestel." });
      let p = HS.players.find(x => x.pid === id);
      if (!p) {
        const same = HS.players.find(x => x.name.toLowerCase() === name.toLowerCase());
        if (same) return conn.send({ t: "error", msg: `Er speelt al iemand als ${same.name}. Kies een andere naam.` });
        if (HS.players.length >= MAXP) return conn.send({ t: "error", msg: "Dit spel zit vol (10 spelers)." });
        p = { pid: id, name, score: 0, hand: [], connected: true };
        HS.players.push(p);
        if (HS.phase !== "lobby") refill(HS, p);
      }
      pid = id;
      const old = conns.get(pid); if (old && old !== conn) { conns.delete(pid); old.close(); }
      conns.set(pid, conn);
      p.connected = true; p.seen = Date.now();
      hostUpdate();
      return;
    }
    const p = HS.players.find(x => x.pid === pid); if (p) p.seen = Date.now();
    if (msg.t === "pong") { if (p && !p.connected) { p.connected = true; hostUpdate(); } return; }
    hostAction(pid, msg);
  });
  conn.onClose(() => {
    if (pid && conns.get(pid) === conn) {
      conns.delete(pid);
      const p = HS && HS.players.find(x => x.pid === pid);
      if (p) { p.connected = false; hostUpdate(); }
    }
  });
}
function hostHeartbeat() {
  if (!HS) return;
  const now = Date.now(); let changed = false;
  conns.forEach((c, pid) => {
    c.send({ t: "ping" });
    const p = HS.players.find(x => x.pid === pid);
    if (p && p.connected && now - (p.seen || now) > 16000) { p.connected = false; changed = true; conns.delete(pid); c.close(); }
  });
  if (changed) hostUpdate();
}
const hp = pid => HS.players.find(p => p.pid === pid);
const czarAway = () => { const c = hp(HS.czarPid); return !c || !c.connected; };
function canJudge(pid) { return HS.phase === "judge" && (pid === HS.czarPid || (pid === HS.hostPid && czarAway())); }
function hostAction(pid, msg) {
  const p = hp(pid); if (!p) return;
  const isHost = pid === HS.hostPid;
  switch (msg.t) {
    case "play":
      if (HS.phase === "play" && pid !== HS.czarPid && !HS.subs.some(s => s.pid === pid) && playCards(HS, p, msg.idx, msg.blank)) hostUpdate();
      break;
    case "pick":
      if (canJudge(pid) && Number.isInteger(msg.i) && HS.subs[msg.i]) { award(HS, msg.i); HS.phase = "result"; hostUpdate(); }
      break;
    case "next":
      if (HS.phase === "result" && msg.round === HS.round) {
        if (HS.winnerPid) HS.phase = "over"; else { startRound(HS); HS.phase = "play"; }
        hostUpdate();
      }
      break;
    case "start":
      if (isHost && HS.phase === "lobby" && HS.players.filter(active).length >= 3) { resetScores(HS); HS.czarPid = null; startRound(HS); HS.phase = "play"; hostUpdate(); }
      break;
    case "again":
      if (isHost && HS.phase === "over") { resetScores(HS); startRound(HS); HS.phase = "play"; hostUpdate(); }
      break;
    case "target":
      if (isHost && HS.phase === "lobby") { HS.target = Math.max(1, Math.min(20, msg.v | 0)); hostUpdate(); }
      break;
    case "kick":
      if (isHost && msg.pid !== HS.hostPid) { const c = conns.get(msg.pid); if (c) c.send({ t: "kicked" }); removePlayer(msg.pid); }
      break;
    case "leave":
      if (!isHost) removePlayer(pid);
      break;
  }
}
function removePlayer(pid) {
  const i = HS.players.findIndex(p => p.pid === pid); if (i < 0) return;
  const p = HS.players[i];
  HS.discardW.push(...p.hand);
  const wasCzar = HS.czarPid === pid;
  if (wasCzar) HS.czarPid = nextCzar(HS); // opvolger bepalen vóór het weghalen
  HS.players.splice(i, 1);
  const c = conns.get(pid); if (c) { conns.delete(pid); setTimeout(() => c.close(), 300); }
  if (HS.phase === "play" || HS.phase === "judge") {
    if (wasCzar) {
      // Nieuwe rechter en een verse vraag; wie al had ingeleverd krijgt nieuwe kaarten.
      HS.subs = []; HS.players.forEach(o => refill(HS, o));
      HS.black = drawB(HS); HS.phase = "play";
    } else HS.subs = HS.subs.filter(s => s.pid !== pid);
  }
  hostUpdate();
}
function hostAdvance() {
  if (HS.phase === "play") {
    const need = HS.players.filter(p => p.pid !== HS.czarPid && p.connected);
    if (HS.subs.length && need.every(p => HS.subs.some(s => s.pid === p.pid))) { HS.subs = shuffle(HS.subs); HS.phase = "judge"; judgeSel = null; }
  }
}
function viewFor(pid) {
  const me = hp(pid), isCzar = HS.czarPid === pid;
  const sub = HS.subs.find(s => s.pid === pid);
  const showAnswers = HS.phase === "judge" && (canJudge(pid) || HS.mode === "remote");
  return {
    code: HS.code, mode: HS.mode, version: HS.version, target: HS.target, phase: HS.phase, round: HS.round,
    black: HS.black, czarPid: HS.czarPid, hostPid: HS.hostPid, winnerPid: HS.winnerPid, last: HS.last,
    players: HS.players.map(p => ({ pid: p.pid, name: p.name, score: p.score, connected: p.connected, host: !!p.host, submitted: HS.subs.some(s => s.pid === p.pid) })),
    you: { pid, hand: me ? me.hand : [], isCzar, submitted: !!sub, played: sub ? sub.cards : null, isHost: pid === HS.hostPid },
    answers: showAnswers ? HS.subs.map(s => s.cards) : null,
    canJudge: canJudge(pid), czarAway: czarAway()
  };
}
function hostUpdate() {
  if (!HS) return;
  hostAdvance();
  store.set(KEY_HOST, HS);
  conns.forEach((c, pid) => c.send({ t: "view", view: viewFor(pid) }));
  NET.view = viewFor(NET.pid);
  render();
}
function hostStop() {
  conns.forEach(c => c.send({ t: "ended" }));
  store.del(KEY_HOST);
  setTimeout(() => { netReset(); UI.screen = "home"; render(); }, 300);
}

/* -- Speler (client) -- */
async function clientJoin(code, name) {
  netReset();
  Object.assign(NET, { role: "client", code, name, pid: myId(), status: "connecting" });
  UI.screen = "net"; render();
  await clientConnect(true);
}
async function clientConnect(first) {
  if (NET.role !== "client" || NET.left) return;
  try {
    const conn = await Transport.join(NET.code);
    if (NET.role !== "client" || NET.left) { conn.close(); return; }
    NET.conn = conn; NET.lastMsg = Date.now();
    conn.onData(msg => clientOnData(msg));
    conn.onClose(() => { if (NET.conn === conn) { NET.conn = null; clientLost(); } });
    conn.send({ t: "join", pid: NET.pid, name: NET.name });
    if (!NET.timers.length) NET.timers.push(setInterval(() => {
      if (NET.conn && NET.status === "ok" && Date.now() - NET.lastMsg > 14000) { const c = NET.conn; NET.conn = null; c.close(); clientLost(); }
    }, 3000));
  } catch (e) {
    if (NET.role !== "client" || NET.left) return;
    if (first && !NET.view) {
      store.del(KEY_CLIENT);
      return netError(
        e.message === "notfound" ? `Geen spel gevonden met code ${NET.code}. Klopt de code, en staat de app van de maker nog open?`
        : e.message === "blocked" ? "Het spel is gevonden, maar je netwerk blokkeert de verbinding met de maker. Probeer het via wifi of de hotspot van iemand anders."
        : "Geen verbinding met de spelserver. Controleer je internet en probeer opnieuw.");
    }
    clientLost();
  }
}
function clientLost() {
  if (NET.role !== "client" || NET.left) return;
  NET.status = "lost"; NET.retries++;
  render();
  if (NET.retries > 40) return netError("De verbinding met de maker van het spel is verbroken.");
  setTimeout(() => clientConnect(false), Math.min(6000, 1500 + NET.retries * 500));
}
function clientOnData(msg) {
  NET.lastMsg = Date.now();
  if (!msg || typeof msg !== "object") return;
  switch (msg.t) {
    case "ping": NET.conn && NET.conn.send({ t: "pong" }); break;
    case "view":
      NET.view = msg.view; NET.status = "ok"; NET.retries = 0;
      store.set(KEY_CLIENT, { code: NET.code, name: NET.name });
      if (NET.view.phase === "judge" && !NET.view.canJudge) judgeSel = null;
      render(); break;
    case "error":
      NET.left = true; store.del(KEY_CLIENT);
      if (NET.conn) { const c = NET.conn; NET.conn = null; c.close(); }
      NET.view = null; netError(msg.msg); break;
    case "kicked": case "ended":
      NET.left = true; store.del(KEY_CLIENT);
      if (NET.conn) { const c = NET.conn; NET.conn = null; c.close(); }
      NET.view = null; netError(msg.t === "kicked" ? "Je bent uit het spel gehaald." : "De maker heeft het spel gestopt.");
      break;
  }
}
function act(msg) {
  if (NET.role === "host") hostAction(NET.pid, msg);
  else if (NET.conn) NET.conn.send(msg);
}
function leaveNet() {
  if (NET.role === "host") return hostStop();
  NET.left = true;
  if (NET.conn) NET.conn.send({ t: "leave" });
  store.del(KEY_CLIENT);
  setTimeout(() => { netReset(); UI.screen = "home"; render(); }, 250);
}

/* -- Online schermen -- */
function viewNet() {
  if (NET.status === "error") return {
    key: "neterr:" + NET.error,
    main: `<section class="pass"><div class="eyebrow">Dat ging mis</div><h2>${esc(NET.error)}</h2></section>`,
    bar: `${NET.role === "client" && NET.code ? (NET.left
        ? `<button class="btn" type="button" data-act="backToJoin">Andere naam of code</button>`
        : `<button class="btn" type="button" data-act="retryJoin">Opnieuw proberen</button>`) : ""}<button class="btn ghost" type="button" data-act="netHome">Naar het begin</button>`
  };
  if (!NET.view) return {
    key: "netwait",
    main: `<section class="pass"><div class="spinner" aria-hidden="true"></div><div class="eyebrow">${NET.role === "host" ? "Spel aanmaken" : "Verbinden met spel " + esc(NET.code || "")}</div><h2>${NET.error ? esc(NET.error) : "Even geduld…"}</h2></section>`,
    bar: `<button class="btn ghost" type="button" data-act="netHome">Annuleren</button>`
  };
  const v = NET.view, you = v.you, name = pid => (v.players.find(p => p.pid === pid) || {}).name || "Iemand";
  const banner = `<div id="live-banner" data-live="1">${NET.status === "lost" ? `<div class="banner">Verbinding kwijt. Opnieuw verbinden…</div>` : ""}</div>`;
  const base = `net:${v.phase}:${v.round}`;
  const tags = `<div class="tags"><span class="tag">${MODES[v.mode].short}</span><span class="tag${v.version === "grof" ? " grof" : ""}">${VERSIONS[v.version]}</span></div>`;

  if (v.phase === "lobby") {
    const link = joinLink(v.code);
    const n = v.players.filter(p => p.connected !== false).length;
    return {
      key: base,
      main: `${banner}
        <section class="stack">${tags}
          <div class="codebox"><div><div class="eyebrow">Spelcode</div><div class="code">${esc(v.code)}</div></div>${you.isHost ? `<div class="qr" id="qr" aria-label="QR-code om mee te doen"></div>` : ""}</div>
          ${you.isHost ? `<p class="lead">${v.mode === "room" ? "Laat de anderen de QR-code scannen, of de code intypen op hun telefoon." : "Stuur de link naar de anderen, bijvoorbeeld in de groepsapp."}</p>
          <div class="link-row"><input class="field" id="share-link" value="${esc(link)}" readonly aria-label="Link om mee te doen"><button class="btn" type="button" data-act="copyLink">${navigator.share ? "Delen" : "Kopieer"}</button></div>` : `<p class="lead">Je zit erin. Wacht tot ${esc(name(v.hostPid))} het spel start.</p>`}
        </section>
        <section class="stack" id="live-players" data-live="1">
          <div class="eyebrow">Spelers · ${n} van max. ${MAXP}</div>
          <ul class="scores">${v.players.map(p => `<li class="${p.connected === false ? "off" : ""}"><span class="nm">${esc(p.name)}${p.host ? ' <span class="tag">maker</span>' : ""}${p.pid === you.pid ? ' <span class="tag y">jij</span>' : ""}${p.connected === false ? ' <span class="tag">weg</span>' : ""}</span><span>${you.isHost && !p.host ? `<button class="mini-x" type="button" data-act="kick" data-v="${esc(p.pid)}">Verwijder</button>` : ""}</span></li>`).join("")}</ul>
        </section>
        ${you.isHost ? `<div id="live-target" data-live="1">${targetRow("ntarget", v.target)}</div>` : `<p class="note" id="live-target" data-live="1">${v.target} ${plural(v.target, "punt", "punten")} om te winnen</p>`}`,
      bar: `<div id="live-bar" data-live="1" class="stack">${you.isHost
        ? `<button class="btn" type="button" data-act="nStart" ${n >= 3 ? "" : "disabled"}>${n >= 3 ? `Start spel met ${n} spelers` : `Nog ${3 - n} ${plural(3 - n, "speler", "spelers")} nodig`}</button>`
        : `<p class="note">Wachten op ${esc(name(v.hostPid))}…</p>`}</div>`
    };
  }

  const statusList = () => {
    const pending = v.players.filter(p => p.pid !== v.czarPid && !p.submitted && p.connected !== false);
    return `<section class="stack" id="live-status" data-live="1"><div class="eyebrow">${pending.length ? `Wachten op ${pending.length} ${plural(pending.length, "speler", "spelers")}` : "Iedereen is klaar"}</div>
      <div class="status">${v.players.filter(p => p.pid !== v.czarPid).map(p => `<span class="tag${p.submitted ? " done" : ""}">${p.submitted ? "✓ " : ""}${esc(p.name)}${p.connected === false ? " (weg)" : ""}</span>`).join("")}</div></section>`;
  };

  if (v.phase === "play") {
    if (you.isCzar) return {
      key: base + ":czar:" + v.black,
      main: `${banner}
        <section class="stack"><div class="eyebrow">Ronde ${v.round}</div><h1>Jij bent de rechter.</h1>
        <p class="lead">${v.mode === "room" ? "Lees de kaart hardop voor. De anderen kiezen nu hun kaarten." : "Iedereen ziet deze kaart op z'n eigen scherm. Lees hem gerust even voor."}</p></section>
        ${blackCard(v.black)}${statusList()}`
    };
    if (you.submitted) return {
      key: base + ":done:" + v.black,
      main: `${banner}
        <section class="stack"><div class="eyebrow">Ronde ${v.round} · rechter: ${esc(name(v.czarPid))}</div><h2>Ingeleverd. Nu is het wachten.</h2></section>
        ${blackCard(v.black, you.played || [], "sm", "Jouw antwoord")}${statusList()}`
    };
    return {
      key: base + ":hand:" + v.black + you.hand.join("|"),
      main: handHTML(you.hand, v.black, `Ronde ${v.round} · rechter: ${esc(name(v.czarPid))} · ${pickLabel(v.black)}`, banner),
      bar: playBtnHTML()
    };
  }

  if (v.phase === "judge") {
    if (v.canJudge) return {
      key: base + ":judge:" + v.answers.length,
      main: `${banner}<section class="stack"><div class="eyebrow">${you.isCzar ? "Jij bent de rechter" : `${esc(name(v.czarPid))} is weg · jij kiest als maker`}</div><h2>${v.mode === "room" ? "Lees ze allemaal hardop voor en kies de beste." : "Lees ze allemaal voor en kies de beste."}</h2></section>
        ${judgeListHTML(v.black, v.answers, true)}`,
      bar: judgeBtnHTML()
    };
    return {
      key: base + ":wait",
      main: `${banner}<section class="stack"><div class="eyebrow">Ronde ${v.round}</div><h2>${esc(name(v.czarPid))} ${v.answers ? "kiest de winnaar…" : "leest de antwoorden voor en kiest een winnaar."}</h2></section>
        ${v.answers ? judgeListHTML(v.black, v.answers, false) : blackCard(v.black)}`
    };
  }

  if (v.phase === "result") {
    const over = !!v.winnerPid;
    const nextCz = (() => { const ps = v.players, i = ps.findIndex(p => p.pid === v.czarPid); for (let k = 1; k <= ps.length; k++) { const p = ps[((i + k) % ps.length + ps.length) % ps.length]; if (p.connected !== false) return p; } return null; })();
    return {
      key: base + ":res",
      main: `${banner}${resultHTML(v.last, v.players, v.target, v.round, true)}`,
      bar: over ? `<button class="btn accent" type="button" data-act="nNext">Bekijk de eindstand</button>`
                : `<button class="btn" type="button" data-act="nNext">Volgende ronde${nextCz ? ` · ${esc(nextCz.name)} is rechter` : ""}</button>`
    };
  }

  if (v.phase === "over") return {
    key: base + ":over",
    main: `${banner}${overHTML(name(v.winnerPid), v.round, v.players, v.target, v.winnerPid)}`,
    bar: you.isHost ? `<button class="btn accent" type="button" data-act="nAgain">Nog een potje, zelfde spelers</button><button class="btn ghost" type="button" data-act="askLeave">Stop het spel</button>`
                    : `<p class="note">Wachten tot ${esc(name(v.hostPid))} een nieuw potje start…</p><button class="btn ghost" type="button" data-act="askLeave">Verlaat het spel</button>`
  };
  return { key: "?", main: "" };
}
function joinLink(code) {
  const u = new URL(location.href);
  u.search = ""; u.hash = "";
  u.searchParams.set("join", code);
  ["net", "peerhost", "peerport", "peerpath"].forEach(k => PARAMS.get(k) && u.searchParams.set(k, PARAMS.get(k)));
  return u.toString();
}
async function drawQR(el) {
  el.dataset.done = "1";
  try {
    await loadScript(QR_URL);
    const qr = qrcode(0, "M"); qr.addData(joinLink(NET.view.code)); qr.make();
    el.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  } catch (e) { el.remove(); }
}

/* ---------- Menu ---------- */
function openMenu() {
  let body = "";
  if (UI.screen === "local" && S) {
    body = `<div class="row" style="justify-content:space-between"><h2>Ronde ${S.round}</h2><button class="chip-btn" type="button" data-act="closeMenu">Sluiten</button></div>
      ${scoresHTML(S.players, S.target, S.czarPid)}
      ${menuConfirm
        ? `<p><strong>Dit spel stoppen?</strong> De stand gaat verloren.</p><button class="btn danger" type="button" data-act="quitLocal">Ja, stop het spel</button><button class="btn ghost" type="button" data-act="noQuit">Toch niet</button>`
        : `<button class="btn" type="button" data-act="closeMenu">Verder spelen</button><button class="btn ghost" type="button" data-act="askQuit">Stop dit spel</button>`}`;
  } else if (UI.screen === "net" && NET.view) {
    const v = NET.view, host = v.you.isHost;
    body = `<div class="row" style="justify-content:space-between"><h2>Spel ${esc(v.code)}</h2><button class="chip-btn" type="button" data-act="closeMenu">Sluiten</button></div>
      <div class="link-row"><input class="field" id="share-link" value="${esc(joinLink(v.code))}" readonly aria-label="Link om mee te doen"><button class="btn" type="button" data-act="copyLink">${navigator.share ? "Delen" : "Kopieer"}</button></div>
      ${scoresHTML(v.players, v.target, v.phase === "lobby" ? null : v.czarPid)}
      ${host && v.players.some(p => p.connected === false) ? `<div class="stack"><div class="eyebrow">Spelers die weg zijn</div>${v.players.filter(p => p.connected === false).map(p => `<div class="row" style="justify-content:space-between"><span>${esc(p.name)}</span><button class="mini-x" type="button" data-act="kick" data-v="${esc(p.pid)}">Verwijder</button></div>`).join("")}</div>` : ""}
      ${menuConfirm
        ? `<p><strong>${host ? "Het spel stoppen voor iedereen?" : "Het spel verlaten?"}</strong>${host ? " Alle spelers worden eruit gegooid." : " Je kaarten en punten verdwijnen."}</p><button class="btn danger" type="button" data-act="leave">${host ? "Ja, stop het spel" : "Ja, verlaat het spel"}</button><button class="btn ghost" type="button" data-act="noQuit">Toch niet</button>`
        : `<button class="btn" type="button" data-act="closeMenu">Verder spelen</button><button class="btn ghost" type="button" data-act="askQuit">${host ? "Stop het spel voor iedereen" : "Verlaat het spel"}</button>`}`;
  } else return;
  overlay.hidden = false;
  overlay.innerHTML = `<div class="scrim" data-act="scrim"><div class="sheet" role="dialog" aria-label="Stand en menu">${body}</div></div>`;
}
function closeMenu() { overlay.hidden = true; overlay.innerHTML = ""; menuConfirm = false; }

/* ---------- Events ---------- */
document.addEventListener("click", e => {
  const t = e.target.closest("[data-act]");
  if (!t) return;
  const a = t.dataset.act, i = +t.dataset.i, v = t.dataset.v;
  if (a === "scrim") { if (!e.target.closest(".sheet")) closeMenu(); return; }
  switch (a) {
    case "logo": if (UI.screen === "local" || UI.screen === "net") openMenu(); else { UI.online.error = ""; go("home"); } break;
    case "menu": openMenu(); break;
    case "closeMenu": closeMenu(); break;
    case "askQuit": menuConfirm = true; openMenu(); break;
    case "noQuit": menuConfirm = false; openMenu(); break;
    case "back": readInputs(); UI.setup.error = UI.online.error = ""; go(v); break;

    case "mode": UI.mode = v; go(v === "local" ? "version" : "onlineChoice"); break;
    case "version": UI.version = v; go(UI.mode === "local" ? "localSetup" : "hostSetup"); break;
    case "toHost": go("version"); break;
    case "toJoin": UI.online.error = ""; go("join"); break;

    case "add": readInputs(); if (UI.setup.names.length < MAXP) UI.setup.names.push(""); render(); { const el = $("#name-" + (UI.setup.names.length - 1)); el && el.focus(); } break;
    case "rm": readInputs(); UI.setup.names.splice(i, 1); render(); break;
    case "tdown": case "tup": {
      const d = a === "tup" ? 1 : -1;
      if (v === "target") { UI.setup.target = clampT(UI.setup.target + d); $("#target").textContent = UI.setup.target; }
      else if (v === "otarget") { UI.online.target = clampT(UI.online.target + d); $("#otarget").textContent = UI.online.target; }
      else if (v === "ntarget") act({ t: "target", v: clampT(NET.view.target + d) });
      break;
    }
    case "startLocal": startLocal(); break;
    case "resumeLocal": S = store.get(KEY_LOCAL); if (S) { if (!S.version) S.version = "normaal"; UI.screen = "local"; wake(); render(); } break;
    case "quitLocal": closeMenu(); S = null; saveLocal(); go("home"); break;
    case "lToPass": S.phase = "pass"; saveLocal(); render(); break;
    case "lToHand": S.phase = "hand"; saveLocal(); render(); break;
    case "lToJudge": S.phase = "judge"; judgeSel = null; saveLocal(); render(); break;
    case "lNext": localRound(); break;
    case "lToOver": S.phase = "over"; saveLocal(); render(); break;
    case "lAgain": { const names = S.players.map(p => p.name); newLocal(names, S.target, S.version); break; }

    case "card": {
      const { hand, black } = curHand(), pick = pickOf(black);
      const k = sel.indexOf(i);
      if (k >= 0) sel.splice(k, 1);
      else if (pick === 1) sel = [i];
      else if (sel.length < pick) sel.push(i);
      else { sel.shift(); sel.push(i); }
      refreshHand();
      if (hand[i] === BLANCO && sel.includes(i)) { const el = $("#blank-input"); el && el.focus(); }
      break;
    }
    case "play":
      if (!canPlay()) break;
      if (UI.screen === "local") localSubmit();
      else { act({ t: "play", idx: sel.slice(), blank: blankText }); t.disabled = true; t.textContent = "Ingeleverd…"; }
      break;
    case "jpick":
      judgeSel = i;
      document.querySelectorAll(".pickable").forEach(el => {
        const on = +el.dataset.i === i; el.classList.toggle("sel", on);
        el.querySelector(".foot").innerHTML = `<span>Antwoord ${+el.dataset.i + 1}</span>${on ? '<span class="pick">Gekozen</span>' : ""}`;
      });
      $("#judgeBtn").disabled = false;
      break;
    case "judge":
      if (judgeSel === null) break;
      if (UI.screen === "local") localJudge();
      else { act({ t: "pick", i: judgeSel }); judgeSel = null; buzz(); }
      break;

    case "createGame": readInputs(); createGame(); break;
    case "joinGame": readInputs(); joinGame(); break;
    case "resumeHost": { const h = store.get(KEY_HOST); if (h) { UI.mode = h.mode; UI.version = h.version; hostStart(h); } break; }
    case "resumeClient": { const c = store.get(KEY_CLIENT); if (c) clientJoin(c.code, c.name); break; }
    case "retryJoin": clientJoin(NET.code, NET.name); break;
    case "backToJoin": UI.online.code = NET.code || ""; UI.online.name = NET.name || UI.online.name; UI.online.error = ""; netReset(); go("join"); break;
    case "netHome": { const role = NET.role; netReset(); if (role === "host") store.del(KEY_HOST); UI.screen = "home"; render(); break; }
    case "nStart": act({ t: "start" }); break;
    case "nNext": act({ t: "next", round: NET.view.round }); break;
    case "nAgain": act({ t: "again" }); break;
    case "kick": act({ t: "kick", pid: v }); if (!overlay.hidden) setTimeout(openMenu, 50); break;
    case "askLeave": menuConfirm = true; openMenu(); break;
    case "leave": closeMenu(); leaveNet(); break;
    case "copyLink": shareLink(t); break;
  }
});
const clampT = n => Math.max(1, Math.min(20, n));
document.addEventListener("input", e => {
  const el = e.target;
  if (el.dataset.name !== undefined) UI.setup.names[+el.dataset.name] = el.value;
  if (el.dataset.oname) UI.online.name = el.value;
  if (el.dataset.ocode) { el.value = el.value.toUpperCase().replace(/[^A-Z]/g, ""); UI.online.code = el.value; }
  if (el.id === "blank-input") { blankText = el.value; refreshPreview(); }
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape") { closeMenu(); return; }
  if (e.key !== "Enter") return;
  const el = e.target;
  if (el.dataset.name !== undefined) {
    e.preventDefault();
    const next = $("#name-" + (+el.dataset.name + 1));
    if (next) next.focus(); else el.blur();
  } else if (el.dataset.ocode) { e.preventDefault(); const n = $("#my-name"); n && n.focus(); }
  else if (el.dataset.oname) { e.preventDefault(); readInputs(); UI.screen === "join" ? joinGame() : createGame(); }
  else if (el.id === "blank-input") { e.preventDefault(); el.blur(); }
});
function readInputs() {
  document.querySelectorAll("[data-name]").forEach(el => UI.setup.names[+el.dataset.name] = el.value);
  const n = $("#my-name"); if (n) UI.online.name = n.value;
  const c = $("#join-code"); if (c) UI.online.code = c.value.toUpperCase();
}
function startLocal() {
  const names = UI.setup.names.map((n, i) => n.trim() || PLACEHOLDERS[i]);
  if (new Set(names.map(n => n.toLowerCase())).size !== names.length) { UI.setup.error = "Twee spelers hebben dezelfde naam. Maak ze uniek."; return render(); }
  UI.setup.error = ""; UI.setup.names = names.slice();
  wake();
  newLocal(names, UI.setup.target, UI.version);
}
function createGame() {
  if (!UI.online.name.trim()) { UI.online.error = "Vul je naam in."; return render(); }
  UI.online.error = "";
  hostStart(null);
}
function joinGame() {
  const code = UI.online.code.trim().toUpperCase(), name = UI.online.name.trim();
  if (code.length !== 4) { UI.online.error = "Een spelcode heeft 4 letters."; return render(); }
  if (!name) { UI.online.error = "Vul je naam in."; return render(); }
  UI.online.error = "";
  wake();
  clientJoin(code, name);
}
async function shareLink(btn) {
  const link = joinLink(NET.view.code);
  if (navigator.share) { try { await navigator.share({ title: "Schaamteloos", text: `Doe mee met Schaamteloos! Code: ${NET.view.code}`, url: link }); return; } catch (e) { if (e && e.name === "AbortError") return; } }
  try { await navigator.clipboard.writeText(link); btn.textContent = "Gekopieerd"; setTimeout(() => btn.textContent = "Kopieer", 1800); }
  catch (e) { const f = $("#share-link"); if (f) { f.focus(); f.select(); } }
}
async function wake() { try { if ("wakeLock" in navigator) await navigator.wakeLock.request("screen"); } catch (e) {} }
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  if (UI.screen === "local" || UI.screen === "net") wake();
  if (NET.role === "client" && !NET.conn && NET.status === "lost") clientConnect(false);
});

/* ---------- Start ---------- */
function boot(data) {
  if (data && data.S) { S = data.S; UI.screen = "local"; }
  const j = (PARAMS.get("join") || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
  if (j && !NO_NET) {
    UI.online.code = j; UI.screen = "join";
    const c = store.get(KEY_CLIENT); if (c && c.name) UI.online.name = c.name;
    try { const u = new URL(location.href); u.searchParams.delete("join"); history.replaceState(null, "", u.toString()); } catch (e) {}
  }
  render();
}
try { window.claude?.hot?.snapshot?.(() => ({ S: UI.screen === "local" ? S : null })); } catch (e) {}
window.claude?.hot?.ready ? window.claude.hot.ready(boot) : boot(window.claude?.hot?.data ?? {});
if (!NO_NET && "serviceWorker" in navigator && location.protocol.startsWith("http") && !PARAMS.get("net")) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
