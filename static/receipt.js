(() => {
  "use strict";

  function updateReceiptPageSize() {
    const receipt = document.querySelector(".receipt");
    if (!receipt) return;
    const heightMm = Math.max(100, Math.min(297, Math.ceil(receipt.getBoundingClientRect().height * 25.4 / 96) + 2));
    let pageStyle = document.getElementById("receipt-page-size");
    if (!pageStyle) {
      pageStyle = document.createElement("style");
      pageStyle.id = "receipt-page-size";
      document.head.append(pageStyle);
    }
    pageStyle.textContent = `@page { size: 80mm ${heightMm}mm; margin: 0; }`;
  }

  function browserPrint() {
    updateReceiptPageSize();
    window.focus();
    window.print();
  }

  updateReceiptPageSize();
  window.addEventListener("beforeprint", updateReceiptPageSize);
  document.getElementById("btn-browser-print")?.addEventListener("click", browserPrint);
  document.getElementById("btn-close-print")?.addEventListener("click", () => window.close());
  if (document.body.dataset.autoPrint === "1") {
    const printWhenReady = () => setTimeout(browserPrint, 450);
    if (document.readyState === "complete") printWhenReady();
    else window.addEventListener("load", printWhenReady, { once: true });
  }
})();
