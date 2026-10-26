// queueShortcut.js — press Q to queue the track under the mouse (or the selected tracks)
(function queueShortcut() {
  if (!Spicetify?.Mousetrap || !Spicetify?.Platform?.PlayerAPI) {
    setTimeout(queueShortcut, 300); // Spicetify isn't ready yet, retry shortly
    return;
  }

  const TRACK_URI = /^spotify:(track|episode|local):/;
  const ok = (u) => (typeof u === "string" && TRACK_URI.test(u) ? u : null);

  // Pull the track URI out of React. Spotify 1.3.4+ no longer hands the uri to the
  // row element itself, so this also checks the row's parent components.
  const uriFromReact = (el) => {
    const fiberKey = Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
    if (!fiberKey) return null;

    // 1. Walk up the component tree a few levels looking for an obvious uri prop
    let fiber = el[fiberKey];
    for (let depth = 0; fiber && depth < 8; depth++, fiber = fiber.return) {
      const p = fiber.memoizedProps ?? fiber.pendingProps;
      const hit = ok(p?.uri) ?? ok(p?.item?.uri) ?? ok(p?.track?.uri) ?? ok(p?.children?.props?.uri);
      if (hit) return hit;
    }

    // 2. Otherwise search the element's own props tree recursively
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

  // Last resort: the title link in playlist / Liked Songs / search rows
  const uriFromLink = (row) => {
    const href = row.querySelector('a[href*="/track/"], a[href*="/episode/"]')?.getAttribute("href");
    const m = href?.match(/\/(track|episode)\/([A-Za-z0-9]+)/);
    return m ? `spotify:${m[1]}:${m[2]}` : null;
  };

  const uriFromRow = (row) => {
    const inner = row.querySelector(':scope > [role="presentation"]') ?? row;
    return uriFromReact(inner) ?? uriFromReact(row) ?? uriFromLink(row);
  };

  // Track rows are [role=row][aria-rowindex] inside a grid; #main-view keeps the sidebar out
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
    if (hovered && !selected.includes(hovered)) rows = [hovered]; // hovering an unselected track → just that one
    else if (selected.length) rows = selected;                     // hovering one of a multi-selection → the lot

    if (!rows.length) {
      Spicetify.showNotification("Nothing to queue — hover or select a track first", true);
      return;
    }
    const uris = [...new Set(rows.map(uriFromRow).filter(Boolean))];
    if (!uris.length) {
      Spicetify.showNotification("Couldn't work out which track that is", true);
      return;
    }
    await Spicetify.Platform.PlayerAPI.addToQueue(uris.map((uri) => ({ uri })));
  }

  Spicetify.Mousetrap.bind("q", () => {
    queueUnderCursor();
    return false; // swallow the keypress
  });
})();
