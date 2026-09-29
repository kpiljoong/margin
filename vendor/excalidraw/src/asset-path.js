// Fonts come from the folder that holds frame.html, never from a CDN
// (Excalidraw reads this when it loads a font). The export source is applied
// when a drawing is saved, see frame.jsx.
window.EXCALIDRAW_ASSET_PATH = new URL('./', location.href).href;
window.EXCALIDRAW_EXPORT_SOURCE = 'https://github.com/kpiljoong/margin';
