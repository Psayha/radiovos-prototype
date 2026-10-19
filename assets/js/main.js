/* Радио ВОС. Без библиотек. */
(function () {
  "use strict";

  var STREAM_BASE = "http://radiovos.ru:9000/";
  var override = new URLSearchParams(location.search).get("stream");
  if (override && /^https?:\/\//.test(override)) STREAM_BASE = override;
  var CONNECT_TIMEOUT = 15000;
  var QUALITY = { "radiovos-128": "высокое", "radiovos-96": "хорошее", "radiovos-64": "среднее", "radiovos-32": "низкое" };
  var TITLES = {
    "": "Радио ВОС — интернет-радио Всероссийского общества слепых",
    "programma": "Программа передач — Радио ВОС",
    "peredachi": "Передачи — Радио ВОС",
    "anonsy": "Анонсы — Радио ВОС",
    "o-radio": "О радио — Радио ВОС",
    "kontakty": "Контакты — Радио ВОС"
  };

  var root = document.documentElement;
  var $ = function (id) { return document.getElementById(id); };
  var $$ = function (sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); };
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
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
     Время и программа (МСК)
     ========================================================= */
  var schedule = (window.VOS_SCHEDULE || []).map(function (r) {
    var hm = r[0].split(":");
    return { time: r[0], start: +hm[0] * 60 + +hm[1], show: r[1], title: r[2] };
  });
  schedule.forEach(function (it, i) { it.end = i + 1 < schedule.length ? schedule[i + 1].start : 1440; });

  var mskParts = new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  var mskDay = new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", weekday: "long", day: "numeric", month: "long" });
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

  function slotNode(it, state) {
    var li = el("li", "slot" + (state ? " is-" + state : ""));
    if (state === "now") li.setAttribute("aria-current", "true");
    var t = el("time", "slot__time", it.time);
    var body = el("div");
    if (state === "now") body.appendChild(el("span", "slot__now", "Сейчас"));
    body.appendChild(el("p", "slot__show", it.show));
    if (it.title) body.appendChild(el("p", "slot__title", it.title));
    li.appendChild(t);
    li.appendChild(body);
    return li;
  }

  var lastIdx = -1;
  function renderNow() {
    if (!schedule.length) return;
    var idx = currentIndex(mskNow());
    if (idx === lastIdx) return;
    lastIdx = idx;
    var cur = schedule[idx], next = schedule[idx + 1] || schedule[0];
    var title = cur.title || "Прямой эфир";

    $("now-show").textContent = cur.show;
    $("now-title").textContent = title;
    $("now-time").textContent = cur.time + "–" + hhmm(cur.end) + " МСК";
    $("bar-show").textContent = cur.show;
    $("bar-title").textContent = title;
    $("simple-show").textContent = cur.show;
    $("simple-title").textContent = title;
    $$("[data-play]").forEach(function (b) { b.setAttribute("aria-description", cur.show + ". " + title); });

    $("next-time").textContent = next.time;
    $("next-show").textContent = next.show;
    $("next-title").textContent = next.title;

    // Сегодня: текущая и пять следующих
    var today = $("today-list");
    today.innerHTML = "";
    schedule.slice(idx, idx + 5).forEach(function (it, i) { today.appendChild(slotNode(it, i === 0 ? "now" : "")); });

    // Полная программа
    var full = $("full-list");
    full.innerHTML = "";
    schedule.forEach(function (it, i) { full.appendChild(slotNode(it, i < idx ? "past" : i === idx ? "now" : "")); });
    var d = mskDay.format(new Date());
    $("prog-date").textContent = d.charAt(0).toUpperCase() + d.slice(1) + " · МСК";

    renderShows();
    updateMediaSession(cur);
  }

  /* ---------- Передачи ---------- */
  function airTimes(name) {
    return schedule.filter(function (it) { return it.show === name; }).map(function (it) { return it.time; });
  }
  function renderShows() {
    var shows = window.VOS_SHOWS || [];
    $$("[data-shows]").forEach(function (list) {
      var limit = list.dataset.shows === "all" ? shows.length : +list.dataset.shows;
      var full = list.dataset.shows === "all";
      list.innerHTML = "";
      shows.slice(0, limit).forEach(function (s) {
        var li = el("li");
        var tile = el(full ? "article" : "a", "tile");
        tile.dataset.c = s[2];
        if (!full) tile.href = "#/peredachi";
        tile.appendChild(el("h3", null, s[0]));
        if (full) tile.appendChild(el("p", null, s[1]));
        var times = airTimes(s[0]);
        if (times.length) tile.appendChild(el("p", "tile__when", "Сегодня в " + times.join(" и ")));
        li.appendChild(tile);
        list.appendChild(li);
      });
    });
  }

  /* ---------- Анонсы ---------- */
  var dayMonth = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" });
  function renderNews() {
    var news = window.VOS_NEWS || [];
    $$("[data-news]").forEach(function (list) {
      var limit = list.dataset.news === "all" ? news.length : +list.dataset.news;
      list.innerHTML = "";
      news.slice(0, limit).forEach(function (n) {
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
    });
  }

  /* =========================================================
     Разделы: меню меняет правую часть, эфир не прерывается
     ========================================================= */
  function routeName() { return location.hash.replace(/^#\/?/, "").split("/")[0]; }

  function showRoute(userAction) {
    var name = routeName();
    if (!(name in TITLES)) name = "";
    $$(".view").forEach(function (v) { v.hidden = v.dataset.view !== name; });
    $$(".menu a").forEach(function (a) {
      if (a.dataset.route === name) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    document.title = TITLES[name];
    if (userAction) {
      var view = document.querySelector('.view[data-view="' + name + '"]');
      var h1 = view.querySelector("h1");
      var content = $("content");
      if (content.getBoundingClientRect().top < 0 || window.innerWidth < 960) content.scrollIntoView();
      // Фокус на заголовок раздела: диктор сразу прочитает, куда попал человек
      h1.focus({ preventScroll: true });
      if (name === "programma") {
        var now = view.querySelector(".is-now");
        if (now) now.scrollIntoView({ block: "center" });
      }
    }
  }
  window.addEventListener("hashchange", function () { showRoute(true); });

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
      b.setAttribute("aria-pressed", String(s !== "idle"));
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
  range.addEventListener("input", function () {
    volume = +this.value;
    if (muted && volume > 0) setMute(false);
    applyVolume();
    store.set("vos-player", { quality: quality, volume: volume });
  });
  function setMute(v) {
    muted = v;
    muteBtn.setAttribute("aria-pressed", String(v));
    muteBtn.setAttribute("aria-label", v ? "Включить звук" : "Выключить звук");
    applyVolume();
  }
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
  var panel = $("a11y-panel"), a11yBtn = $("a11y-toggle");
  var DEFAULTS = { on: true, scale: 1.25, scheme: "bw", tracking: "0", leading: "1.5", font: "sans", speech: "off", simple: "off" };
  var a11y = store.get("vos-a11y", {});

  function applyA11y() {
    if (a11y.on) {
      root.dataset.scheme = a11y.scheme;
      root.dataset.font = a11y.font;
      root.style.setProperty("--scale", a11y.scale);
      root.style.setProperty("--tracking", a11y.tracking);
      root.style.setProperty("--leading", a11y.leading);
      if (a11y.simple === "on") root.dataset.simple = "";
      else delete root.dataset.simple;
    } else {
      delete root.dataset.simple;
      delete root.dataset.scheme;
      delete root.dataset.font;
      ["--scale", "--tracking", "--leading"].forEach(function (p) { root.style.removeProperty(p); });
      a11y.speech = "off";
    }
    ["scale", "scheme", "tracking", "leading", "font", "speech", "simple"].forEach(function (n) {
      $$('#a11y-panel input[name="' + n + '"]').forEach(function (i) { i.checked = String(a11y[n]) === i.value; });
    });
    a11yBtn.setAttribute("aria-label", a11y.on ? "Настройки для слабовидящих" : "Версия для слабовидящих");
    store.set("vos-a11y", a11y);
  }
  function showPanel(v) {
    panel.hidden = !v;
    a11yBtn.setAttribute("aria-expanded", String(v));
  }
  a11yBtn.addEventListener("click", function () {
    if (!a11y.on) {
      a11y = Object.assign({}, DEFAULTS);
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
    if (i.name === "simple" && i.value === "on") {
      document.querySelector(".play--huge").focus();
      say("Режим одной кнопки");
    }
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

  $("simple-off").addEventListener("click", function () {
    a11y.simple = "off";
    applyA11y();
    document.querySelector(".play--big").focus();
    say("Обычный вид");
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

  function setVolume(v) {
    volume = Math.max(0, Math.min(100, v));
    range.value = volume;
    if (muted && volume > 0) setMute(false);
    applyVolume();
    store.set("vos-player", { quality: quality, volume: volume });
    say("Громкость " + volume + " процентов");
  }

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

  /* ---------- Запуск ---------- */
  if (a11y.on) showPanel(true);
  applyA11y();
  renderNews();
  renderNow();
  showRoute(false);
  setInterval(renderNow, 30000);
})();
