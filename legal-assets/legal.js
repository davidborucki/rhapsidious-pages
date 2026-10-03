/* Progressive enhancement: native anchor links remain usable without JavaScript. */
(() => {
  "use strict";
  const outline = document.querySelector(".outline");
  if (!outline) return;
  const links = Array.from(outline.querySelectorAll(".outline-link"));
  const sections = links.map(link => document.getElementById(link.hash.slice(1)));
  const desktop = window.matchMedia("(min-width: 761px)");
  let active = -1;
  let scheduled = false;

  function update() {
    scheduled = false;
    const threshold = document.querySelector(".site-header").getBoundingClientRect().bottom + 48;
    let next = 0;
    sections.forEach((section, index) => {
      if (section.getBoundingClientRect().top <= threshold) next = index;
    });
    const atEnd = window.scrollY > 0 && window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4;
    if (atEnd) next = links.length - 1;
    if (next === active) return;
    active = next;
    links.forEach((link, index) => {
      if (index === active) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    });
    // Keep the selected entry visible without moving the document or keyboard focus.
    if (desktop.matches) {
      const bounds = outline.getBoundingClientRect();
      const selected = links[active].getBoundingClientRect();
      if (selected.top < bounds.top) outline.scrollTop -= bounds.top - selected.top + 8;
      else if (selected.bottom > bounds.bottom) outline.scrollTop += selected.bottom - bounds.bottom + 8;
    }
  }
  function schedule() {
    if (!scheduled) { scheduled = true; window.requestAnimationFrame(update); }
  }
  function layout() { outline.open = desktop.matches; active = -1; schedule(); }
  desktop.addEventListener("change", layout);
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule, { passive: true });
  window.addEventListener("hashchange", schedule);
  window.addEventListener("pageshow", schedule);
  links.forEach(link => link.addEventListener("click", () => {
    if (!desktop.matches) outline.open = false;
  }));
  layout();
})();
