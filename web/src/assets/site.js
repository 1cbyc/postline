// Small progressive enhancements. Everything works without this file.

// Copy the install command.
for (const box of document.querySelectorAll("[data-copy]")) {
  const button = box.querySelector("[data-copy-button]");
  const text = box.querySelector("[data-copy-text]");
  const status = box.querySelector(".copy-status");
  if (!button || !text || !navigator.clipboard) {
    button?.remove();
    continue;
  }
  let reset;
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(text.textContent.trim());
      button.textContent = "Copied";
      if (status) status.textContent = "Install command copied";
    } catch {
      button.textContent = "Press Ctrl+C";
    }
    clearTimeout(reset);
    reset = setTimeout(() => {
      button.textContent = "Copy";
      if (status) status.textContent = "";
    }, 2000);
  });
}

// The guide list is open on wide screens and a collapsed menu on narrow ones.
const docNav = document.querySelector("[data-doc-nav]");
if (docNav) {
  const narrow = window.matchMedia("(max-width: 820px)");
  const sync = () => {
    docNav.open = !narrow.matches;
  };
  sync();
  narrow.addEventListener("change", sync);
}
