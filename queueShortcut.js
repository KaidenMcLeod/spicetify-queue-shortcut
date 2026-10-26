// Press the keybind ('Q' by default) to add the hovered song to queue, or
// select multiple songs to add them to queue all at once.
// Change the keybind under the profile menu -> "Add to queue shortcut keybind"
(function queueShortcut() {
  const S = window.Spicetify;
  if (!S?.Mousetrap || !S?.Platform?.PlayerAPI || !S?.Menu || !S?.PopupModal || !S?.LocalStorage) {
    setTimeout(queueShortcut, 300); // Spicetify isn't ready yet, retry shortly
    return;
  }

  const DEFAULT_KEY = "q";
  const STORAGE_KEY = "queueShortcut:key";

  // -- Detect song hovered by mouse --
  const TRACK_URI = /^spotify:(track|episode|local):/;
  const ok = (u) => (typeof u === "string" && TRACK_URI.test(u) ? u : null);

  // Pull the track URI out of React. Spotify 1.3.4+ no longer hands the uri to the
  // row element itself, so this also checks the row's parent components.
  const uriFromReact = (el) => {
    const fiberKey = Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
    if (!fiberKey) return null;

    let fiber = el[fiberKey];
    for (let depth = 0; fiber && depth < 8; depth++, fiber = fiber.return) {
      const p = fiber.memoizedProps ?? fiber.pendingProps;
      const hit = ok(p?.uri) ?? ok(p?.item?.uri) ?? ok(p?.track?.uri) ?? ok(p?.children?.props?.uri);
      if (hit) return hit;
    }

    const search = (obj, depth = 0) => {
      if (!obj || typeof obj !== "object" || depth > 15) return null;
      const hit = ok(obj.uri) ?? ok(obj.item?.uri);
      if (hit) return hit;
      const kids = obj.children ?? obj.props?.children;
      for (const kid of Array.isArray(kids) ? kids : kids ? [kids] : []) {
        const r = search(kid?.props ?? kid, depth + 1);
        if (r) return r;
      }
      return obj.props && obj.props !== obj ? search(obj.props, depth + 1) : null;
    };
    const own = el[fiberKey];
    return search(own.memoizedProps ?? own.pendingProps);
  };

  const uriFromLink = (row) => {
    const href = row.querySelector('a[href*="/track/"], a[href*="/episode/"]')?.getAttribute("href");
    const m = href?.match(/\/(track|episode)\/([A-Za-z0-9]+)/);
    return m ? `spotify:${m[1]}:${m[2]}` : null;
  };

  const uriFromRow = (row) => {
    const inner = row.querySelector(':scope > [role="presentation"]') ?? row;
    return uriFromReact(inner) ?? uriFromReact(row) ?? uriFromLink(row);
  };

  const ROW = '[role="row"][aria-rowindex]';
  const hoveredRow = () => [...document.querySelectorAll(`${ROW}:hover`)].pop() ?? null;
  const selectedRows = () => {
    const scope = document.querySelector("#main-view") ?? document;
    const rows = [...scope.querySelectorAll('[aria-selected="true"]')].map((el) => el.closest(ROW)).filter(Boolean);
    return [...new Set(rows)];
  };

  async function queueUnderCursor() {
    const hovered = hoveredRow();
    const selected = selectedRows();

    let rows = [];
    if (hovered && !selected.includes(hovered)) rows = [hovered];
    else if (selected.length) rows = selected;

    if (!rows.length) {
      S.showNotification("Nothing to queue — hover or select a track first", true);
      return;
    }
    const uris = [...new Set(rows.map(uriFromRow).filter(Boolean))];
    if (!uris.length) {
      S.showNotification("Couldn't work out which track that is", true);
      return;
    }
    await S.Platform.PlayerAPI.addToQueue(uris.map((uri) => ({ uri })));
  }

  // -- Keybind and the menu to change it --
  let currentKey = S.LocalStorage.get(STORAGE_KEY) || DEFAULT_KEY;
  const bindKey = (key) => {
    S.Mousetrap.unbind(currentKey);
    currentKey = key;
    S.Mousetrap.bind(currentKey, () => {
      queueUnderCursor();
      return false; // Swallow the keypress
    });
  };
  bindKey(currentKey);

  // Turn a keydown event into Mousetrap's "ctrl+shift+q" style string
  const KEY_NAMES = {
    Space: "space", Enter: "enter", Backspace: "backspace", Delete: "del", Insert: "ins",
    Home: "home", End: "end", PageUp: "pageup", PageDown: "pagedown",
    ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
    Minus: "-", Equal: "=", Comma: ",", Period: ".", Slash: "/", Semicolon: ";", Quote: "'",
    BracketLeft: "[", BracketRight: "]", Backslash: "\\", Backquote: "`",
  };
  const comboFromEvent = (e) => {
    const c = e.code || "";
    const key =
      KEY_NAMES[c] ??
      (/^Key[A-Z]$/.test(c) ? c[3].toLowerCase()
        : /^(Digit|Numpad)\d$/.test(c) ? c.slice(-1)
        : /^F\d{1,2}$/.test(c) ? c.toLowerCase()
        : null);
    if (!key) return null; // A modifier on its own, or a key Mousetrap can't bind
    const mods = [e.ctrlKey && "ctrl", e.altKey && "alt", e.shiftKey && "shift", e.metaKey && "meta"].filter(Boolean);
    return [...mods, key].join("+");
  };

  const openSettings = () => {
    const box = document.createElement("div");
    box.innerHTML = `
      <p style="margin:0 0 12px">Click the box, then press the key or combination you want.</p>
      <input readonly value="${currentKey}" style="width:100%;box-sizing:border-box;padding:10px;font-size:16px;text-align:center;border-radius:4px;border:1px solid #777;background:transparent;color:inherit">
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
        <button data-reset style="padding:8px 16px;border-radius:20px;border:1px solid #777;background:transparent;color:inherit;cursor:pointer">Reset to Q</button>
        <button data-save style="padding:8px 16px;border-radius:20px;border:0;background:#1ed760;color:#000;font-weight:700;cursor:pointer">Save</button>
      </div>`;
    const input = box.querySelector("input");
    let pending = currentKey;
    input.addEventListener("keydown", (e) => {
      if (e.code === "Escape" || e.code === "Tab") return;
      e.preventDefault();
      e.stopPropagation();
      const combo = comboFromEvent(e);
      if (combo) input.value = pending = combo;
    });
    box.querySelector("[data-reset]").onclick = () => (input.value = pending = DEFAULT_KEY);
    box.querySelector("[data-save]").onclick = () => {
      bindKey(pending);
      S.LocalStorage.set(STORAGE_KEY, pending);
      S.PopupModal.hide();
      S.showNotification(`Queue shortcut set to ${pending}`);
    };
    S.PopupModal.display({ title: "Add to queue shortcut keybind", content: box });
    setTimeout(() => input.focus(), 50);
  };

  new S.Menu.Item("Add to queue shortcut keybind", false, openSettings).register();
})();
