// Access the Electron preload bridge; null when running bare in a browser (dev/styling).
export function getApi() {
  return (typeof window !== "undefined" && window.deepseek) ? window.deepseek : null;
}
