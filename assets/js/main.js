/* Радио ВОС — прототип главной. Без библиотек. */
(function () {
  "use strict";

  /* ---------- Настройки ---------- */
  // Поток Icecast. Пока он отдаётся только по http; когда на сервере
  // появится https (например, через nginx), поменять здесь.
  var STREAM_BASE = "http://radiovos.ru:9000/";
  // Для проверки через другой адрес: ?stream=http://localhost:8090/
  var override = new URLSearchParams(location.search).get("stream");
  if (override && /^https?:\/\//.test(override)) STREAM_BASE = override;
  var CONNECT_TIMEOUT = 15000;
  var QUALITY_NAMES = {
    "radiovos-128": "Высокое",
    "radiovos-96": "Хорошее",
    "radiovos-64": "Среднее",
    "radiovos-32": "Низкое"
  };

  var root = document.documentElement;
  var $ = function (id) { return document.getElementById(id); };

  /* Хранилище: в приватном режиме может быть недоступно — тогда просто не запоминаем */
  var store = {
    get: function (key, fallback) {
      try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch (e) { return fallback; }
    },
    set: function (key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
    }
  };

  /* =========================================================
     Время и программа передач (время московское)
     ========================================================= */
  var schedule = (window.VOS_SCHEDULE || []).map(function (row) {
    var hm = row[0].split(":");
    return { time: row[0], start: +hm[0] * 60 + +hm[1], show: row[1], title: row[2] };
  });
  schedule.forEach(function (item, i) {
    item.end = i + 1 < schedule.length ? schedule[i + 1].start : 24 * 60;
  });

  var mskFormat = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  });
  var mskDate = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow", weekday: "long", day: "numeric", month: "long"
  });

  function mskMinutes() {
    var p = {};
    mskFormat.formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; });
    return +p.hour * 60 + +p.minute + +p.second / 60;
  }

  function currentIndex(min) {
    for (var i = schedule.length - 1; i >= 0; i--) if (schedule[i].start <= min) return i;
    return 0;
  }

  function fmt(min) {
    min = Math.round(min) % (24 * 60);
    var h = Math.floor(min / 60), m = min % 60;
    return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m;
  }

  function minutesWord(n) {
    var a = n % 10, b = n % 100;
    if (a === 1 && b !== 11) return "минута";
    if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return "минуты";
    return "минут";
  }

  var showPast = false;
  var lastIndex = -1;

  function renderSchedule(idx) {
    var list = $("schedule-list");
    if (!list) return;
    list.innerHTML = "";
    schedule.forEach(function (item, i) {
      if (!showPast && i < idx) return;
      var li = document.createElement("li");
      li.className = "slot" + (i < idx ? " is-past" : "") + (i === idx ? " is-now" : "");
      if (i === idx) li.setAttribute("aria-current", "true");

      var time = document.createElement("time");
      time.className = "slot__time";
      time.textContent = item.time;

      var body = document.createElement("div");
      if (i === idx) {
        var badge = document.createElement("span");
        badge.className = "badge-now";
        badge.textContent = "Сейчас в эфире";
        body.appendChild(badge);
      }
      var show = document.createElement("p");
      show.className = "slot__show";
      show.textContent = item.show;
      body.appendChild(show);
      if (item.title) {
        var t = document.createElement("p");
        t.className = "slot__title";
        t.textContent = item.title;
        body.appendChild(t);
      }
      li.appendChild(time);
      li.appendChild(body);
      list.appendChild(li);
    });
  }

  function updateNow() {
    if (!schedule.length) return;
    var min = mskMinutes();
    var idx = currentIndex(min);
    var cur = schedule[idx];
    var next = schedule[idx + 1] || schedule[0];

    $("now-show").textContent = cur.show;
    $("now-title").textContent = cur.title || "Прямой эфир Радио ВОС";
    var left = Math.max(1, Math.ceil(cur.end - min));
    $("now-time").textContent = cur.time + "–" + fmt(cur.end) + " по Москве · осталось " + left + " " + minutesWord(left);
    $("now-progress").style.width = Math.min(100, ((min - cur.start) / (cur.end - cur.start)) * 100) + "%";

    $("next-time").textContent = next.time;
    $("next-show").textContent = next.show;
    $("next-title").textContent = next.title;

    if (idx !== lastIndex) {
      lastIndex = idx;
      renderSchedule(idx);
      updateMediaSession(cur);
    }

    var d = mskDate.format(new Date());
    $("schedule-date").textContent = d.charAt(0).toUpperCase() + d.slice(1) + ". Время московское";
  }

  $("schedule-toggle").addEventListener("click", function () {
    showPast = !showPast;
    this.setAttribute("aria-expanded", String(showPast));
    this.textContent = showPast ? "Скрыть прошедшие передачи" : "Показать прошедшие передачи";
    renderSchedule(lastIndex);
  });

  /* =========================================================
     Плеер прямого эфира
     ========================================================= */
  var audio = null;
  var playBtn = $("play");
  var statusEl = $("player-status");
  var player = $("player");
  var saved = store.get("vos-player", {});
  var quality = saved.quality || "radiovos-128";
  var volume = typeof saved.volume === "number" ? saved.volume : 80;
  var muted = false;
  var connectTimer = null;

  var qInput = document.querySelector('input[name="quality"][value="' + quality + '"]');
  if (qInput) qInput.checked = true;

  function setStatus(html) { statusEl.innerHTML = html; }

  function setPlaying(state) {
    // state: "idle" | "loading" | "playing"
    playBtn.dataset.state = state;
    playBtn.setAttribute("aria-pressed", String(state !== "idle"));
    $("play-label").textContent = state === "idle" ? "Слушать эфир" : "Пауза";
    player.classList.toggle("is-playing", state === "playing");
  }

  function streamUrl() { return STREAM_BASE + quality; }

  function start() {
    if (!audio) {
      audio = new Audio();
      audio.preload = "none";
      audio.addEventListener("playing", function () {
        clearTimeout(connectTimer);
        setPlaying("playing");
        setStatus("Эфир играет. Качество: " + QUALITY_NAMES[quality].toLowerCase() + ".");
      });
      audio.addEventListener("waiting", function () {
        if (playBtn.dataset.state !== "idle") setStatus("Подгружаем звук…");
      });
      audio.addEventListener("error", onError);
    }
    applyVolume();
    audio.src = streamUrl();
    setPlaying("loading");
    setStatus("Подключаемся к эфиру…");
    clearTimeout(connectTimer);
    connectTimer = setTimeout(onError, CONNECT_TIMEOUT);
    var p = audio.play();
    if (p && p.catch) p.catch(onError);
  }

  function stop(message) {
    clearTimeout(connectTimer);
    if (audio) {
      audio.pause();
      // Сбрасываем поток, чтобы после паузы снова слушать живой эфир, а не запись
      audio.removeAttribute("src");
      audio.load();
    }
    setPlaying("idle");
    setStatus(message || "Эфир на паузе.");
  }

  function onError() {
    if (playBtn.dataset.state === "idle") return;
    var blocked = location.protocol === "https:" && STREAM_BASE.indexOf("http:") === 0;
    stop(
      blocked
        ? 'Браузер не пускает поток на эту страницу: эфир пока передаётся без шифрования (http). <a href="' + streamUrl() + '" target="_blank" rel="noopener">Открыть эфир в новой вкладке</a>.'
        : "Не получилось подключиться к эфиру. Проверьте интернет и нажмите «Слушать эфир» ещё раз или выберите низкое качество."
    );
  }

  playBtn.addEventListener("click", function () {
    if (playBtn.dataset.state && playBtn.dataset.state !== "idle") stop();
    else start();
  });

  document.querySelectorAll('input[name="quality"]').forEach(function (input) {
    input.addEventListener("change", function () {
      quality = this.value;
      store.set("vos-player", { quality: quality, volume: volume });
      if (playBtn.dataset.state && playBtn.dataset.state !== "idle") start();
      else setStatus("Выбрано качество: " + QUALITY_NAMES[quality].toLowerCase() + ".");
    });
  });

  /* Громкость */
  var range = $("volume");
  var muteBtn = $("mute");
  range.value = volume;

  function applyVolume() {
    $("volume-out").textContent = volume + "%";
    range.setAttribute("aria-valuetext", volume + " процентов");
    if (audio) {
      audio.volume = volume / 100;
      audio.muted = muted;
    }
  }
  range.addEventListener("input", function () {
    volume = +this.value;
    if (muted && volume > 0) toggleMute(false);
    applyVolume();
    store.set("vos-player", { quality: quality, volume: volume });
  });
  function toggleMute(force) {
    muted = typeof force === "boolean" ? force : !muted;
    muteBtn.setAttribute("aria-pressed", String(muted));
    muteBtn.setAttribute("aria-label", muted ? "Включить звук" : "Выключить звук");
    applyVolume();
  }
  muteBtn.addEventListener("click", function () { toggleMute(); });
  applyVolume();

  /* Подпись на экране блокировки телефона и в системных плеерах */
  function updateMediaSession(cur) {
    if (!("mediaSession" in navigator) || !window.MediaMetadata) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: cur.title ? cur.show + " — " + cur.title : cur.show,
      artist: "Радио ВОС",
      album: "Прямой эфир"
    });
    try {
      navigator.mediaSession.setActionHandler("play", start);
      navigator.mediaSession.setActionHandler("pause", function () { stop(); });
      navigator.mediaSession.setActionHandler("stop", function () { stop(); });
    } catch (e) {}
  }

  /* =========================================================
     Тема: светлая / тёмная
     ========================================================= */
  var themeBtn = $("theme-toggle");
  var darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

  function effectiveTheme() {
    return root.dataset.theme || (darkQuery.matches ? "dark" : "light");
  }
  function syncThemeButton() {
    var dark = effectiveTheme() === "dark";
    themeBtn.setAttribute("aria-pressed", String(dark));
    themeBtn.querySelector("span").textContent = dark ? "Светлая тема" : "Тёмная тема";
    themeBtn.hidden = !!root.dataset.scheme;
  }
  themeBtn.addEventListener("click", function () {
    root.dataset.theme = effectiveTheme() === "dark" ? "light" : "dark";
    var s = store.get("vos-a11y", {});
    s.theme = root.dataset.theme;
    store.set("vos-a11y", s);
    syncThemeButton();
  });
  if (darkQuery.addEventListener) darkQuery.addEventListener("change", syncThemeButton);

  /* =========================================================
     Версия для слабовидящих
     ========================================================= */
  var panel = $("a11y-panel");
  var a11yBtn = $("a11y-toggle");
  var DEFAULTS = { on: true, scale: 1.25, scheme: "bw", tracking: "0", leading: "1.55", font: "sans", speech: "off" };
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
    ["scale", "scheme", "tracking", "leading", "font", "speech"].forEach(function (name) {
      document.querySelectorAll('#a11y-panel input[name="' + name + '"]').forEach(function (input) {
        input.checked = String(a11y[name]) === input.value;
      });
    });
    a11yBtn.lastChild.textContent = a11y.on ? " Настройки для слабовидящих" : " Версия для слабовидящих";
    syncThemeButton();
    store.set("vos-a11y", a11y);
  }

  function showPanel(show) {
    panel.hidden = !show;
    a11yBtn.setAttribute("aria-expanded", String(show));
  }

  a11yBtn.addEventListener("click", function () {
    if (!a11y.on) {
      a11y = Object.assign({}, DEFAULTS, { theme: a11y.theme });
      applyA11y();
      showPanel(true);
      panel.querySelector('input[name="scale"]:checked').focus();
      announce("Версия для слабовидящих включена");
    } else {
      showPanel(panel.hidden);
    }
  });

  panel.addEventListener("change", function (e) {
    var input = e.target;
    if (!input.name) return;
    a11y[input.name] = input.name === "scale" ? +input.value : input.value;
    applyA11y();
    if (input.name === "speech") {
      if (input.value === "on") speak("Озвучка включена. Нажмите на текст или выделите его, чтобы прослушать.");
      else if (window.speechSynthesis) speechSynthesis.cancel();
    }
  });

  $("a11y-off").addEventListener("click", function () {
    a11y = { on: false, theme: a11y.theme };
    if (window.speechSynthesis) speechSynthesis.cancel();
    applyA11y();
    showPanel(false);
    a11yBtn.focus();
    announce("Включена обычная версия сайта");
  });

  /* Короткие объявления для экранного диктора */
  function announce(text) {
    var box = $("sr-announce");
    box.textContent = "";
    setTimeout(function () { box.textContent = text; }, 50);
  }

  /* =========================================================
     Озвучка текста (синтез речи браузера)
     Только для слабовидящих без экранного диктора — по умолчанию выключена.
     ========================================================= */
  var canSpeak = "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
  if (!canSpeak) $("speech-group").hidden = true;

  var ruVoice = null;
  function pickVoice() {
    if (!canSpeak) return;
    var voices = speechSynthesis.getVoices();
    ruVoice = voices.filter(function (v) { return /^ru/i.test(v.lang); })[0] || null;
  }
  if (canSpeak) {
    pickVoice();
    speechSynthesis.onvoiceschanged = pickVoice;
  }

  var speakingEl = null;
  function speak(text, el) {
    if (!canSpeak || !text) return;
    speechSynthesis.cancel();
    if (speakingEl) speakingEl.classList.remove("is-speaking");
    var u = new SpeechSynthesisUtterance(text.replace(/\s+/g, " ").trim());
    u.lang = "ru-RU";
    if (ruVoice) u.voice = ruVoice;
    u.rate = 1;
    if (el) {
      speakingEl = el;
      el.classList.add("is-speaking");
      u.onend = u.onerror = function () { el.classList.remove("is-speaking"); };
    }
    speechSynthesis.speak(u);
  }

  var READABLE = "a, button, label, legend, h1, h2, h3, p, li, dt, dd, time, output";
  function textOf(el) {
    return el.getAttribute("aria-label") || el.innerText || el.textContent || "";
  }
  function speechOn() { return a11y.on && a11y.speech === "on"; }

  document.addEventListener("click", function (e) {
    if (!speechOn()) return;
    var sel = window.getSelection && String(window.getSelection());
    if (sel && sel.trim().length > 1) return; // выделенный текст читаем по mouseup
    var el = e.target.closest(READABLE);
    if (el) speak(textOf(el), el);
  });
  document.addEventListener("focusin", function (e) {
    if (!speechOn() || e.target.matches("body")) return;
    var el = e.target.closest("label") || e.target;
    speak(textOf(el), el);
  });
  document.addEventListener("mouseup", function () {
    if (!speechOn()) return;
    var sel = String(window.getSelection());
    if (sel.trim().length > 1) speak(sel);
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && canSpeak) speechSynthesis.cancel();
  });

  /* =========================================================
     Меню на узких экранах
     ========================================================= */
  var navToggle = document.querySelector(".nav-toggle");
  var nav = $("nav");
  navToggle.addEventListener("click", function () {
    var open = nav.dataset.open !== "true";
    nav.dataset.open = String(open);
    this.setAttribute("aria-expanded", String(open));
  });

  /* ---------- Запуск ---------- */
  if (a11y.on) showPanel(true);
  applyA11y();
  updateNow();
  setInterval(updateNow, 30 * 1000);
})();
