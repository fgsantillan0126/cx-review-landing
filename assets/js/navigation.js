
(() => {
  "use strict";

  const header = document.querySelector(".site-header");
  const nav = header?.querySelector(".main-nav");

  if (!header || !nav) return;

  const links = [...nav.querySelectorAll("a")];

  const normalizePath = (path) => {
    return path.replace(/\/+$/, "") || "/";
  };


  // Redirige los enlaces heredados de la sección Nosotros
  // hacia la nueva página institucional.
  links.forEach((link) => {
    try {
      const url = new URL(link.href, window.location.origin);

      if (
        url.hash.toLowerCase() === "#nosotros" &&
        normalizePath(url.pathname) === "/"
      ) {
        link.setAttribute("href", "/nosotros/");
      }

    } catch (_) {
      // No modifica enlaces que no puedan interpretarse.
    }
  });


  const currentPath = normalizePath(window.location.pathname);


  // Identifica el enlace correspondiente a la página actual.
  const currentPageLink = links.find((link) => {
    const url = new URL(link.href, window.location.origin);

    return (
      normalizePath(url.pathname) === currentPath &&
      !url.hash
    );
  });


  // Identifica las secciones vinculadas al menú.
  const sectionLinks = links
    .map((link) => {
      const url = new URL(link.href, window.location.origin);

      let sectionId = link.dataset.section;

      if (
        !sectionId &&
        url.hash &&
        normalizePath(url.pathname) === currentPath
      ) {
        sectionId = decodeURIComponent(url.hash.slice(1));
      }

      if (!sectionId) return null;

      const section = document.getElementById(sectionId);

      if (!section) return null;

      return { link, section };
    })
    .filter(Boolean);


  const setActiveLink = (activeLink, currentType) => {
    links.forEach((link) => {
      if (link === currentPageLink) return;

      link.classList.remove("is-active");

      if (link.getAttribute("aria-current") === "location") {
        link.removeAttribute("aria-current");
      }
    });

    if (!activeLink) return;

    activeLink.classList.add("is-active");
    activeLink.setAttribute("aria-current", currentType);
  };


  if (currentPageLink) {
    currentPageLink.classList.add("is-active");
    currentPageLink.setAttribute("aria-current", "page");
  }


  let updateScheduled = false;

  const updateNavigation = () => {
    updateScheduled = false;

    header.classList.toggle(
      "is-scrolled",
      window.scrollY > 12
    );

    if (!sectionLinks.length) return;

    const triggerPosition =
      header.getBoundingClientRect().height + 20;

    let activeItem = null;

    for (const item of sectionLinks) {
      const rect = item.section.getBoundingClientRect();

      if (
        rect.top <= triggerPosition &&
        rect.bottom > triggerPosition
      ) {
        activeItem = item;
      }
    }

    if (!activeItem) {
      const passedSections = sectionLinks.filter(({ section }) => {
        return section.getBoundingClientRect().top <= triggerPosition;
      });

      activeItem =
        passedSections.length > 0
          ? passedSections[passedSections.length - 1]
          : sectionLinks[0];
    }

    if (activeItem) {
      setActiveLink(activeItem.link, "location");
    }
  };


  const scheduleUpdate = () => {
    if (updateScheduled) return;

    updateScheduled = true;
    window.requestAnimationFrame(updateNavigation);
  };


  window.addEventListener("scroll", scheduleUpdate, {
    passive: true
  });

  window.addEventListener("resize", scheduleUpdate);
  window.addEventListener("load", scheduleUpdate);

  scheduleUpdate();

})();
