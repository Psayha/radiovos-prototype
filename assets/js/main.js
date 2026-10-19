/* Радио ВОС. Без библиотек. */
(function () {
  "use strict";

  var STREAM_BASE = "http://radiovos.ru:9000/";
  var params = new URLSearchParams(location.search);
  var override = params.get("stream");
  if (override && /^https?:\/\//.test(override)) STREAM_BASE = override;
  var FORCE_LIVE = params.get("live") === "1";   // показать режим прямого эфира на демонстрации
  var CONNECT_TIMEOUT = 15000;
  var QUALITY = { "radiovos-128": "высокое", "radiovos-96": "хорошее", "radiovos-64": "среднее", "radiovos-32": "низкое" };

  var root = document.documentElement;
  var $ = function (id) { return document.getElementById(id); };
  var $$ = function (sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); };
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function svgEl(tag, attrs) {
    var n = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  var store = {
    get: function (k, d) { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };

  function say(text) {
    var box = $("sr-status");
    box.textContent = "";
    setTimeout(function () { box.textContent = text; }, 60);
  }
  var toastTimer;
  function toast(text) {
    var t = $("toast");
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 6000);
  }

  /* =========================================================
     Шрифт Брайля (русский): номера точек 1–6 для каждой буквы
     ========================================================= */
  var BRAILLE = {
    "а": [1], "б": [1, 2], "в": [2, 4, 5, 6], "г": [1, 2, 4, 5], "д": [1, 4, 5], "е": [1, 5], "ё": [1, 6],
    "ж": [2, 4, 5], "з": [1, 3, 5, 6], "и": [2, 4], "й": [1, 2, 3, 4, 6], "к": [1, 3], "л": [1, 2, 3],
    "м": [1, 3, 4], "н": [1, 3, 4, 5], "о": [1, 3, 5], "п": [1, 2, 3, 4], "р": [1, 2, 3, 5], "с": [2, 3, 4],
    "т": [2, 3, 4, 5], "у": [1, 3, 6], "ф": [1, 2, 4], "х": [1, 2, 5], "ц": [1, 4], "ч": [1, 2, 3, 4, 5],
    "ш": [1, 5, 6], "щ": [1, 3, 4, 6], "ъ": [1, 2, 3, 5, 6], "ы": [2, 3, 4, 6], "ь": [2, 3, 4, 5, 6],
    "э": [2, 4, 6], "ю": [1, 2, 5, 6], "я": [1, 2, 4, 6]
  };
  function brailleCells(text) {
    return text.toLowerCase().split("").map(function (c) {
      if (c === " ") return [];
      return BRAILLE[c] || null;
    }).filter(function (c) { return c !== null; });
  }
  function brailleText(text) {
    return brailleCells(text).map(function (dots) {
      var code = 0x2800;
      dots.forEach(function (d) { code += [0, 1, 2, 4, 8, 16, 32][d]; });
      return String.fromCharCode(code);
    }).join("");
  }
  /* Узор плитки: название передачи точками Брайля, в две строки */
  function brailleArt(text) {
    var cells = brailleCells(text);
    var perRow = cells.length || 1, rows = 1;   // одна строка — как надпись
    var cw = 21, rh = 28, r = 3.6;
    var svg = svgEl("svg", { viewBox: "0 0 " + (perRow * cw) + " " + (rows * rh), class: "tile__art", "aria-hidden": "true", focusable: "false" });
    cells.forEach(function (dots, i) {
      var x0 = (i % perRow) * cw + 5, y0 = Math.floor(i / perRow) * rh + 5;
      for (var d = 1; d <= 6; d++) {
        var on = dots.indexOf(d) !== -1;
        svg.appendChild(svgEl("circle", {
          cx: x0 + (d > 3 ? 9 : 0), cy: y0 + ((d - 1) % 3) * 9,
          r: on ? r : 1.3, class: on ? "on" : "off"
        }));
      }
    });
    return svg;
  }

  /* =========================================================
     Время и программа (МСК)
     ========================================================= */
  var LIVE_WORDS = /прям(ой|ая)\s+(эфир|трансляц)/i;
  var schedule = (window.VOS_SCHEDULE || []).map(function (r) {
    var hm = r[0].split(":");
    return {
      time: r[0], start: +hm[0] * 60 + +hm[1], show: r[1], title: r[2] || "",
      live: !!r[3] || LIVE_WORDS.test(r[1] + " " + (r[2] || ""))
    };
  });
  schedule.forEach(function (it, i) { it.end = i + 1 < schedule.length ? schedule[i + 1].start : 1440; });

  var mskParts = new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  var mskDay = new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", day: "numeric", month: "long" });
  function mskNow() {
    var p = {};
    mskParts.formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; });
    return +p.hour * 60 + +p.minute;
  }
  function hhmm(m) {
    m = m % 1440;
    var h = Math.floor(m / 60), mm = m % 60;
    return (h < 10 ? "0" : "") + h + ":" + (mm < 10 ? "0" : "") + mm;
  }
  function currentIndex(m) {
    for (var i = schedule.length - 1; i >= 0; i--) if (schedule[i].start <= m) return i;
    return 0;
  }
  function plural(n, one, few, many) {
    var a = n % 10, b = n % 100;
    if (a === 1 && b !== 11) return one;
    if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few;
    return many;
  }
  function inWords(min) {
    if (min < 60) return "через " + min + " " + plural(min, "минуту", "минуты", "минут");
    var h = Math.floor(min / 60), m = min % 60;
    return "через " + h + " " + plural(h, "час", "часа", "часов") + (m ? " " + m + " мин" : "");
  }
  function slotNode(it, isNow) {
    var li = el("li", "slot" + (isNow ? " is-now" : ""));
    if (isNow) li.setAttribute("aria-current", "true");
    var top = el("div", "slot__top");
    var t = el("time", "pill", it.time);
    top.appendChild(t);
    if (isNow) top.appendChild(el("span", "pill pill--live", "Сейчас"));
    else if (it.live) top.appendChild(el("span", "pill", "Прямой эфир"));
    li.appendChild(top);
    li.appendChild(el("p", "slot__show", it.show));
    if (it.title) li.appendChild(el("p", "slot__title", it.title));
    return li;
  }

  var lastIdx = -1;
  function renderNow() {
    if (!schedule.length) return;
    var now = mskNow();
    var idx = currentIndex(now);
    var cur = schedule[idx], next = schedule[idx + 1] || schedule[0];

    // «через N минут» обновляем каждый раз, остальное — только при смене передачи
    var left = ((next.start - now) + 1440) % 1440 || 1440;
    $("next-in").textContent = inWords(left);
    if (idx === lastIdx) return;
    lastIdx = idx;

    // Без темы выпуска (например, новости): над названием — «Радио ВОС», крупно — передача
    var label = cur.title ? cur.show : "Радио ВОС";
    var title = cur.title || cur.show;
    $("now-show").textContent = label;
    $("now-title").textContent = title;
    $("now-time").textContent = cur.time + "–" + hhmm(cur.end) + " МСК";
    $("bar-show").textContent = label;
    $("bar-title").textContent = title;
    $("simple-show").textContent = label;
    $("simple-title").textContent = title;
    $$("[data-play]").forEach(function (b) { b.setAttribute("aria-description", cur.title ? cur.show + ". " + title : title); });

    $("next-time").textContent = next.time;
    $("next-show").textContent = next.show;
    $("next-title").textContent = next.title;
    var about = (window.VOS_ABOUT || {})[next.show] || showInfo(next.show);
    $("next-desc").textContent = about;
    $("next-desc").hidden = !about;

    // Звонок в эфир загорается только во время прямого эфира
    var call = $("call");
    var live = cur.live || FORCE_LIVE;
    call.classList.toggle("is-live", live);

    $("today-date").textContent = mskDay.format(new Date()) + " · МСК";
    var today = $("today-list");
    today.innerHTML = "";
    schedule.slice(idx, idx + 5).forEach(function (it, i) { today.appendChild(slotNode(it, i === 0)); });

    var big = $("big-list");
    big.innerHTML = "";
    schedule.slice(idx).forEach(function (it, i) { big.appendChild(slotNode(it, i === 0)); });

    renderShows();
    updateMediaSession(cur);
  }

  /* ---------- Передачи: плитки с узором Брайля ---------- */
  function showInfo(name) {
    var s = (window.VOS_SHOWS || []).filter(function (x) { return x[0] === name; })[0];
    return s ? s[1] : "";
  }
  function airTimes(name) {
    return schedule.filter(function (it) { return it.show === name; }).map(function (it) { return it.time; });
  }
  function renderShows() {
    var list = $("tiles");
    list.innerHTML = "";
    (window.VOS_SHOWS || []).slice(0, 8).forEach(function (s) {
      var li = el("li");
      if (s[0].length > 15) li.className = "is-long";
      var tile = el("article", "tile");
      tile.dataset.c = s[2];
      if (s[3]) {                       // загруженная обложка
        tile.classList.add("has-cover");
        tile.style.setProperty("--cover", "url('" + s[3] + "')");
      }
      tile.appendChild(brailleArt(s[0]));
      tile.appendChild(el("h3", null, s[0]));
      var times = airTimes(s[0]);
      if (times.length) tile.appendChild(el("p", "tile__when", "Сегодня в " + times.join(", ")));
      li.appendChild(tile);
      list.appendChild(li);
    });
  }

  /* ---------- Анонсы ---------- */
  var dayMonth = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" });
  function renderNews() {
    var list = $("cards");
    list.innerHTML = "";
    (window.VOS_NEWS || []).slice(0, 3).forEach(function (n) {
      var li = el("li");
      var card = el("article", "card");
      var meta = el("p", "card__meta");
      var t = el("time", null, dayMonth.format(new Date(n[0] + "T12:00:00")));
      t.setAttribute("datetime", n[0]);
      meta.appendChild(t);
      meta.appendChild(el("span", "card__show", n[1]));
      card.appendChild(meta);
      card.appendChild(el("h3", null, n[2]));
      card.appendChild(el("p", "card__text", n[3]));
      card.appendChild(el("p", "card__air", "В эфире " + n[4]));
      li.appendChild(card);
      list.appendChild(li);
    });
  }

  /* ---------- Меню: переходы по разделам главной ---------- */
  $$("[data-anchor]").forEach(function (a) {
    a.addEventListener("click", function () {
      var target = document.querySelector(a.getAttribute("href"));
      if (target) setTimeout(function () { target.focus({ preventScroll: true }); }, 0);
    });
  });

  /* =========================================================
     Плеер
     ========================================================= */
  var audio = null;
  var plays = $$("[data-play]");
  var cover = $("player");
  var saved = store.get("vos-player", {});
  var quality = QUALITY[saved.quality] ? saved.quality : "radiovos-128";
  var volume = typeof saved.volume === "number" ? saved.volume : 80;
  var muted = false;
  var state = "idle";
  var timer = null;
  var streamBlocked = location.protocol === "https:" && STREAM_BASE.indexOf("http:") === 0;

  $$('input[name="quality"]').forEach(function (i) { i.checked = i.value === quality; });

  function setState(s) {
    state = s;
    plays.forEach(function (b) {
      b.dataset.state = s;
      b.querySelector("[data-play-label]").textContent = s === "idle" ? "Слушать эфир" : "Пауза";
    });
    cover.classList.toggle("is-playing", s === "playing");
    $$("[data-simple-label]").forEach(function (n) { n.textContent = s === "idle" ? "Слушать" : "Пауза"; });
  }
  function url() { return STREAM_BASE + quality; }

  function start() {
    if (streamBlocked) {
      var tab = window.open(url(), "_blank");
      if (tab) { tab.opener = null; say("Эфир открыт в новой вкладке"); }
      else toast("Разрешите всплывающие окна для этого сайта");
      return;
    }
    if (!audio) {
      audio = new Audio();
      audio.preload = "none";
      audio.addEventListener("playing", function () {
        clearTimeout(timer);
        setState("playing");
        say("Эфир играет");
      });
      audio.addEventListener("error", fail);
    }
    applyVolume();
    audio.src = url();
    setState("loading");
    clearTimeout(timer);
    timer = setTimeout(fail, CONNECT_TIMEOUT);
    var p = audio.play();
    if (p && p.catch) p.catch(fail);
  }
  function stop() {
    clearTimeout(timer);
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");   // после паузы — снова живой эфир, а не запись
      audio.load();
    }
    setState("idle");
  }
  function fail() {
    if (state === "idle") return;
    stop();
    toast("Не удалось подключиться к эфиру");
  }
  function toggle() {
    if (state === "idle") start();
    else { stop(); say("Пауза"); }
  }
  plays.forEach(function (b) { b.addEventListener("click", toggle); });

  $$('input[name="quality"]').forEach(function (i) {
    i.addEventListener("change", function () {
      quality = this.value;
      store.set("vos-player", { quality: quality, volume: volume });
      if (state !== "idle") start();
    });
  });

  var range = $("volume"), muteBtn = $("mute");
  range.value = volume;
  function applyVolume() {
    range.setAttribute("aria-valuetext", volume + " процентов");
    if (audio) { audio.volume = volume / 100; audio.muted = muted; }
  }
  function setMute(v) {
    muted = v;
    muteBtn.setAttribute("aria-pressed", String(v));
    applyVolume();
  }
  function setVolume(v) {
    volume = Math.max(0, Math.min(100, v));
    range.value = volume;
    if (muted && volume > 0) setMute(false);
    applyVolume();
    store.set("vos-player", { quality: quality, volume: volume });
    say("Громкость " + volume + " процентов");
  }
  range.addEventListener("input", function () {
    volume = +this.value;
    if (muted && volume > 0) setMute(false);
    applyVolume();
    store.set("vos-player", { quality: quality, volume: volume });
  });
  muteBtn.addEventListener("click", function () { setMute(!muted); });
  applyVolume();

  function updateMediaSession(cur) {
    if (!("mediaSession" in navigator) || !window.MediaMetadata) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: cur.title ? cur.show + " — " + cur.title : cur.show,
      artist: "Радио ВОС"
    });
    try {
      navigator.mediaSession.setActionHandler("play", start);
      navigator.mediaSession.setActionHandler("pause", stop);
      navigator.mediaSession.setActionHandler("stop", stop);
    } catch (e) {}
  }

  /* =========================================================
     Версия для слабовидящих
     ========================================================= */
  var panel = $("a11y-panel"), a11yBtn = $("a11y-toggle"), bigBtn = $("big-toggle");
  var DEFAULTS = { on: true, scale: 1.25, scheme: "bw", tracking: "0", leading: "1.5", font: "sans", speech: "off", simple: "off" };
  var a11y = store.get("vos-a11y", {});

  function applyA11y() {
    if (a11y.on) {
      root.dataset.scheme = a11y.scheme;
      root.dataset.font = a11y.font;
      root.style.setProperty("--scale", a11y.scale);
      root.style.setProperty("--tracking", a11y.tracking);
      root.style.setProperty("--leading", a11y.leading);
    } else {
      delete root.dataset.scheme;
      delete root.dataset.font;
      ["--scale", "--tracking", "--leading"].forEach(function (p) { root.style.removeProperty(p); });
      a11y.speech = "off";
    }
    if (a11y.simple === "on") root.dataset.simple = "";
    else delete root.dataset.simple;
    bigBtn.setAttribute("aria-pressed", String(a11y.simple === "on"));
    ["scale", "scheme", "tracking", "leading", "font", "speech", "simple"].forEach(function (n) {
      $$('#a11y-panel input[name="' + n + '"]').forEach(function (i) { i.checked = String(a11y[n]) === i.value; });
    });
    a11yBtn.querySelector(".topline__long").textContent = a11y.on ? "Настройки для слабовидящих" : "Версия для слабовидящих";
    a11yBtn.querySelector(".topline__short").textContent = a11y.on ? "Настройки" : "Для слабовидящих";
    store.set("vos-a11y", a11y);
  }
  function showPanel(v) {
    panel.hidden = !v;
    a11yBtn.setAttribute("aria-expanded", String(v));
  }
  a11yBtn.addEventListener("click", function () {
    if (!a11y.on) {
      a11y = Object.assign({}, DEFAULTS, { simple: a11y.simple || "off" });
      applyA11y();
      showPanel(true);
      panel.querySelector("input:checked").focus();
      say("Версия для слабовидящих включена");
    } else {
      showPanel(panel.hidden);
    }
  });
  panel.addEventListener("change", function (e) {
    var i = e.target;
    if (!i.name) return;
    a11y[i.name] = i.name === "scale" ? +i.value : i.value;
    applyA11y();
    if (i.name === "simple") setBig(i.value === "on");
    if (i.name === "speech") {
      if (i.value === "on") speak("Озвучка включена");
      else if (canSpeak) speechSynthesis.cancel();
    }
  });
  $("a11y-off").addEventListener("click", function () {
    a11y = { on: false };
    if (canSpeak) speechSynthesis.cancel();
    applyA11y();
    showPanel(false);
    a11yBtn.focus();
    say("Обычная версия сайта");
  });

  /* ---------- Озвучка (синтез речи браузера) ---------- */
  var canSpeak = "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
  if (!canSpeak) $("speech-group").hidden = true;
  var ruVoice = null;
  function pickVoice() { ruVoice = speechSynthesis.getVoices().filter(function (v) { return /^ru/i.test(v.lang); })[0] || null; }
  if (canSpeak) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
  var speaking = null;
  function speak(text, node) {
    if (!canSpeak || !text) return;
    speechSynthesis.cancel();
    if (speaking) speaking.classList.remove("is-speaking");
    var u = new SpeechSynthesisUtterance(text.replace(/\s+/g, " ").trim());
    u.lang = "ru-RU";
    if (ruVoice) u.voice = ruVoice;
    if (node) {
      speaking = node;
      node.classList.add("is-speaking");
      u.onend = u.onerror = function () { node.classList.remove("is-speaking"); };
    }
    speechSynthesis.speak(u);
  }
  var READABLE = "a, button, label, legend, h1, h2, h3, p, li, dt, dd, time, address";
  function textOf(n) {
    var t = n.getAttribute("aria-label") || n.innerText || "";
    var d = n.getAttribute("aria-description");
    return d ? t + ". " + d : t;
  }
  function speechOn() { return a11y.on && a11y.speech === "on"; }
  document.addEventListener("click", function (e) {
    if (!speechOn() || String(window.getSelection()).trim().length > 1) return;
    var n = e.target.closest(READABLE);
    if (n) speak(textOf(n), n);
  });
  document.addEventListener("focusin", function (e) {
    if (!speechOn() || e.target === document.body) return;
    var n = e.target.closest("label") || e.target;
    speak(textOf(n), n);
  });
  document.addEventListener("mouseup", function () {
    if (!speechOn()) return;
    var s = String(window.getSelection()).trim();
    if (s.length > 1) speak(s);
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && canSpeak) speechSynthesis.cancel();
  });

  /* =========================================================
     Крупный интерфейс
     ========================================================= */
  function bigView(name) {
    $$("[data-big-view]").forEach(function (v) { v.hidden = v.dataset.bigView !== name; });
    if (name === "prog") {
      $("big-prog-title").focus();
    } else {
      document.querySelector(".big-tile--play").focus();
    }
  }
  function setBig(on) {
    a11y.simple = on ? "on" : "off";
    applyA11y();
    window.scrollTo(0, 0);
    if (on) { bigView("home"); say("Крупный интерфейс"); }
    else { document.querySelector(".play--big").focus(); say("Обычный сайт"); }
  }
  bigBtn.addEventListener("click", function () { setBig(a11y.simple !== "on"); });
  $("simple-off").addEventListener("click", function () { setBig(false); });
  $$("[data-big-go]").forEach(function (b) {
    b.addEventListener("click", function () { bigView(b.dataset.bigGo); });
  });
  $$("[data-vol]").forEach(function (b) {
    b.addEventListener("click", function () { setVolume(volume + +b.dataset.vol); });
  });

  /* =========================================================
     Горячие клавиши: Alt+Shift — не пересекаются с экранными дикторами
     ========================================================= */
  var keys = $("keys");
  function openKeys(e) {
    if (e) e.preventDefault();
    if (keys.showModal) keys.showModal();
  }
  $$("[data-keys]").forEach(function (b) { b.addEventListener("click", openKeys); });
  document.addEventListener("keydown", function (e) {
    if (!e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey) return;
    switch (e.code) {
      case "KeyP": toggle(); break;
      case "ArrowUp": setVolume(volume + 10); break;
      case "ArrowDown": setVolume(volume - 10); break;
      case "KeyM": setMute(!muted); say(muted ? "Звук выключен" : "Звук включён"); break;
      case "KeyN": say("Сейчас в эфире: " + $("now-show").textContent + ". " + $("now-title").textContent); break;
      case "KeyK": openKeys(); break;
      default: return;
    }
    e.preventDefault();
  });

  /* ---------- Высота шапки и плеера — для отступов и прокрутки к фокусу ---------- */
  var bar = document.querySelector(".bar");
  var topline = document.querySelector(".topline");
  function syncBars() {
    root.style.setProperty("--bar-h", Math.ceil(bar.getBoundingClientRect().height) + "px");
    var sticky = getComputedStyle(topline).position === "sticky";
    root.style.setProperty("--top-h", sticky ? Math.ceil(topline.getBoundingClientRect().height) + "px" : "0px");
  }
  if ("ResizeObserver" in window) { new ResizeObserver(syncBars).observe(bar); new ResizeObserver(syncBars).observe(topline); }

  /* ---------- Запуск ---------- */
  if (a11y.on) showPanel(true);
  applyA11y();
  syncBars();
  renderNews();
  renderNow();
  setInterval(renderNow, 30000);
})();
