(() => {
  "use strict";
  document.getElementById("btn-browser-print").addEventListener("click", () => window.print());
  document.getElementById("btn-close-print").addEventListener("click", () => window.close());
  if (document.body.dataset.autoPrint === "1") {
    window.addEventListener("load", () => setTimeout(() => window.print(), 250), { once: true });
  }
})();
