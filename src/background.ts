// Toolbar button opens Pit Wall in its own resizable window (or focuses it).
// Right-clicking the button offers the side panel instead.

const BOUNDS_KEY = "windowBounds";
const WINDOW_ID_KEY = "windowId";
const PANEL_MENU_ID = "open-side-panel";

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  chrome.contextMenus.create({ id: PANEL_MENU_ID, title: "Open in side panel", contexts: ["action"] });
});

chrome.action.onClicked.addListener(async () => {
  const { [WINDOW_ID_KEY]: existing } = await chrome.storage.session.get(WINDOW_ID_KEY);
  if (typeof existing === "number") {
    try {
      await chrome.windows.update(existing, { focused: true });
      return;
    } catch {
      // Window was closed
    }
  }
  const { [BOUNDS_KEY]: bounds } = await chrome.storage.local.get(BOUNDS_KEY);
  const win = await chrome.windows.create({
    url: chrome.runtime.getURL("window.html"),
    type: "popup",
    width: 1440,
    height: 900,
    ...(bounds as chrome.windows.UpdateInfo | undefined),
  });
  if (win?.id !== undefined) await chrome.storage.session.set({ [WINDOW_ID_KEY]: win.id });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === PANEL_MENU_ID && tab?.windowId !== undefined) {
    chrome.sidePanel.open({ windowId: tab.windowId });
  }
});

// Remember where the window was so it reopens there
chrome.windows.onBoundsChanged.addListener(async (win) => {
  const { [WINDOW_ID_KEY]: id } = await chrome.storage.session.get(WINDOW_ID_KEY);
  if (win.id !== id) return;
  const { left, top, width, height } = win;
  await chrome.storage.local.set({ [BOUNDS_KEY]: { left, top, width, height } });
});
