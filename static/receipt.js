(() => {
  "use strict";
  document.getElementById("btn-browser-print")?.addEventListener("click", () => window.print());
  document.getElementById("btn-close-print")?.addEventListener("click", () => window.close());
  if (document.body.dataset.autoPrint === "1") {
    const printWhenReady = () => setTimeout(() => { window.focus(); window.print(); }, 450);
    if (document.readyState === "complete") printWhenReady();
    else window.addEventListener("load", printWhenReady, { once: true });
  }
})();
