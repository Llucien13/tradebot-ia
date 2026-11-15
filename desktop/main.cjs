const { app, BrowserWindow, dialog } = require("electron");

const LOCAL_APP_URL = "http://127.0.0.1:3088";
const configuredCloudURL = process.env.TRADEBOT_CLOUD_URL?.trim();
let APP_URL = LOCAL_APP_URL;
let invalidCloudURL = false;

if (configuredCloudURL) {
  try {
    const url = new URL(configuredCloudURL);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
      throw new Error("TRADEBOT_CLOUD_URL must be an HTTPS origin or path without credentials, query, or fragment.");
    }
    APP_URL = url.href.replace(/\/+$/, "");
  } catch (error) {
    invalidCloudURL = true;
    dialog.showErrorBox(
      "TradeBot IA",
      error instanceof Error ? error.message : "TRADEBOT_CLOUD_URL is invalid."
    );
  }
}

const APP_ORIGIN = new URL(APP_URL).origin;

function createWindow() {
  const win = new BrowserWindow({
    title: "TradeBot IA",
    width: 1350,
    height: 850,
    minWidth: 950,
    minHeight: 650,
    autoHideMenuBar: true,
    backgroundColor: "#101827",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  win.webContents.on("will-navigate", (event, url) => {
    let origin;
    try { origin = new URL(url).origin; } catch { event.preventDefault(); return; }
    if (origin !== APP_ORIGIN) {
      event.preventDefault();
    }
  });

  win.loadURL(APP_URL).catch(() => {
    dialog.showErrorBox(
      "TradeBot IA",
      configuredCloudURL
        ? "Le site TradeBot IA Cloud configuré est indisponible."
        : "Le serveur local sur le port 3088 est indisponible."
    );
  });
}

app.whenReady().then(() => {
  if (invalidCloudURL) app.quit();
  else createWindow();
});
app.on("window-all-closed", () => app.quit());
