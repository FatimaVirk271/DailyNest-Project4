// config.js - tells the page WHERE the backend lives.
//
// Normal case: the page and the API are served by the same server -> leave it empty.
// If the page is opened from ANOTHER address (e.g. VS Code Live Server on port 5500,
// or a static host) put the backend address here, for example:
//   apiBaseUrl: "https://your-app.containers.snapdeploy.app"
// (The backend then needs that page address in its ALLOWED_ORIGINS setting: this is CORS.)
window.DAILYNEST_CONFIG = { apiBaseUrl: "" };
