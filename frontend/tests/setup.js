// Setup file loaded before tests — polyfills missing browser APIs in jsdom.
if (typeof window !== "undefined") {
  window.matchMedia = window.matchMedia || function (q) {
    return {
      matches: false,
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    };
  };
}
