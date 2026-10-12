
    // Runtime marker: added at parse time so the CSS pre-paint hides can apply
    // before first paint (prevents a flash of finished content). It is removed
    // when motion is not allowed or GSAP is missing, keeping the page fully
    // visible as a fallback.
    document.documentElement.classList.add("js");

    document.addEventListener("DOMContentLoaded", () => {
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const gsapOk = !reduceMotion && typeof gsap !== "undefined" && typeof ScrollTrigger !== "undefined";
      if (!gsapOk) document.documentElement.classList.remove("js");

      // ---------- Scroll driver ----------
      // One place that owns window scrolling. CSS `scroll-behavior: smooth`
      // was removed because it makes ScrollTrigger's internal
      // scroll-measure-during-refresh land on the wrong position (every
      // trigger's `start` drifts by the current scroll). This helper keeps a
      // single GSAP tween (or a native jump under reduced motion / no GSAP),
      // and forcibly sets scroll-behavior to "auto" while it runs so a refresh
      // can never be corrupted mid-flight.
      const scroller = {
        tween: null,
        run(target, { smooth = true, onDone = null } = {}) {
          this.cancel();
          const html = document.documentElement;
          const restore = html.style.scrollBehavior;
          html.style.scrollBehavior = "auto";
          const done = () => {
            html.style.scrollBehavior = restore;
            this.tween = null;
            if (onDone) onDone();
          };
          if (!smooth || reduceMotion || typeof gsap === "undefined") {
            window.scrollTo(0, target);
            done();
            return;
          }
          const proxy = { y: window.scrollY };
          this.tween = gsap.to(proxy, {
            y: target,
            duration: 0.65,
            ease: "power2.inOut",
            overwrite: true,
            onUpdate: () => window.scrollTo(0, proxy.y),
            onComplete: done,
          });
        },
        cancel() {
          if (this.tween) {
            this.tween.kill();
            this.tween = null;
          }
        },
      };

      // Same-page anchor links keep their smooth glide through the scroller.
      document.addEventListener("click", (event) => {
        if (event.defaultPrevented) return;
        if (event.button != null && event.button !== 0) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const anchor = event.target.closest('a[href^="#"]');
        if (!anchor) return;
        const href = anchor.getAttribute("href");
        if (href === "#" || href.length < 2) return;
        const section = href === "#top" ? document.body : document.querySelector(href);
        if (!section) return;
        event.preventDefault();
        const targetY = href === "#top" ? 0 : section.getBoundingClientRect().top + window.scrollY;
        scroller.run(targetY, { smooth: !reduceMotion && typeof gsap !== "undefined" });
      });

      // ---------- Copy specifications ----------
      const copyButton = document.getElementById("copySpecs");
      const specData = document.getElementById("specData");
      if (copyButton && specData) {
        copyButton.addEventListener("click", async () => {
          const original = copyButton.textContent;
          const rows = [...specData.children].map((row) => {
            const label = row.querySelector("span").textContent.trim();
            const value = row.querySelector("p").textContent.trim();
            return label + ": " + value;
          });
          const text = "Canon AE-1 — Specifications\n\n" + rows.join("\n");
          try {
            await navigator.clipboard.writeText(text);
            copyButton.textContent = "Copied";
          } catch (error) {
            copyButton.textContent = "Copy unavailable";
          }
          window.setTimeout(() => {
            copyButton.textContent = original;
          }, 1800);
        });
      }

      // ---------- Purchase CTA guard ----------
      const PURCHASE_URL = "";
      const purchaseCta = document.getElementById("purchaseCta");
      const purchaseNote = document.getElementById("purchaseNote");
      if (purchaseCta) {
        if (PURCHASE_URL) {
          purchaseCta.href = PURCHASE_URL;
          purchaseCta.target = "_blank";
          purchaseCta.rel = "noopener noreferrer";
          purchaseCta.removeAttribute("aria-disabled");
          if (purchaseNote) purchaseNote.remove();
        } else {
          purchaseCta.setAttribute("aria-disabled", "true");
          purchaseCta.addEventListener("click", (event) => {
            if (purchaseCta.getAttribute("aria-disabled") === "true") {
              event.preventDefault();
            }
          });
        }
      }

      // ---------- Footer year ----------
      const yearNode = document.getElementById("year");
      if (yearNode) yearNode.textContent = String(new Date().getFullYear());

      // ---------- The line-up controller (shared by cards + 3D) ----------
      // Single source of truth for the active component. Scrolling the sticky
      // deck, clicking a card, and clicking a 3D part all funnel through
      // select()/setCurrent(), so the gold card accent and the 3D highlight can
      // never disagree. Lives outside the GSAP guard so the 3D↔card link keeps
      // working (with instant scroll) under reduced motion.
      const lineup = document.querySelector("[data-lineup]");
      if (lineup) {
        const cards = Array.from(lineup.querySelectorAll("[data-lineup-card]"));
        const counter = document.getElementById("lineupCounter");
        const span = Math.max(cards.length - 1, 0);
        const pad = (n) => String(n + 1).padStart(2, "0");
        const total = String(cards.length).padStart(2, "0");
        const canScroll =
          typeof gsap !== "undefined" && typeof ScrollTrigger !== "undefined" && !reduceMotion;

        let current = -1;
        let suppress = false; // mute card->3D reports while we drive the scroll
        let trigger = null;

        const fire = (index) => {
          const card = cards[index];
          window.dispatchEvent(
            new CustomEvent("ae1:active-change", {
              detail: { index, key: card ? card.dataset.comp : null },
            })
          );
        };

        const setCurrent = (value) => {
          const index = Math.max(0, Math.min(span, value));
          if (index === current) return;
          current = index;
          cards.forEach((card, k) => card.classList.toggle("is-current", k === index));
          if (counter) {
            counter.innerHTML = pad(index) + ' <span class="text-muted">/ ' + total + "</span>";
          }
          if (!suppress) fire(index);
        };

        // Depth: card i starts receding once the deck reaches past it.
        const applyDepth = (progress) => {
          const p = progress * span;
          cards.forEach((card, i) => {
            const d = Math.max(0, Math.min(1, p - i));
            card.style.transform =
              "translateY(" + (-6 * d).toFixed(2) + "px) scale(" + (1 - 0.05 * d).toFixed(4) + ")";
            card.style.opacity = (1 - 0.45 * d).toFixed(3);
          });
        };

        // Average scroll distance between one card parking and the next. Heights
        // are stable under sticky (unlike offsetTop), so this survives refresh.
        const stride = () => {
          if (cards.length < 2) return 200;
          const gap = parseFloat(getComputedStyle(cards[0]).marginBottom) || 0;
          let sum = 0;
          for (let i = 0; i < cards.length - 1; i += 1) sum += cards[i].offsetHeight + gap;
          return sum / span;
        };

        if (canScroll) {
          gsap.registerPlugin(ScrollTrigger);
          trigger = ScrollTrigger.create({
            trigger: lineup,
            start: () => "top " + (parseFloat(getComputedStyle(cards[0]).top) || 0) + "px",
            end: () => "+=" + stride() * span,
            onUpdate: (self) => {
              applyDepth(self.progress);
              setCurrent(Math.round(self.progress * span));
            },
            onRefresh: (self) => {
              applyDepth(self.progress);
              setCurrent(Math.round(self.progress * span));
            },
          });
        }

        // Scroll so card `index` sits at the front of the deck. Because this
        // moves the real scroll position, the ScrollTrigger above stays the
        // single driver and cards + 3D can't desync. The target is derived from
        // the deck's live position (not ScrollTrigger.start, which can lag a
        // layout change), so re-parking is exact.
        const scrollToIndex = (index) => {
          suppress = true;
          fire(index); // highlight the target at once, before the scroll settles

          const stickyTop = parseFloat(getComputedStyle(cards[0]).top) || 0;
          const deckTop = lineup.getBoundingClientRect().top + window.scrollY;
          const target = deckTop - stickyTop + stride() * index;

          scroller.run(target, {
            smooth: canScroll,
            onDone: () => {
              suppress = false;
              setCurrent(index);
              fire(index);
            },
          });
        };

        const select = (index) => scrollToIndex(Math.max(0, Math.min(span, Math.round(index))));

        // A manual scroll interrupts a programmatic one so the two never fight.
        const cancelScroll = () => {
          scroller.cancel();
          suppress = false;
        };
        window.addEventListener("wheel", cancelScroll, { passive: true });
        window.addEventListener("touchmove", cancelScroll, { passive: true });
        window.addEventListener("keydown", (e) => {
          if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].indexOf(e.key) !== -1) {
            cancelScroll();
          }
        });

        cards.forEach((card, i) => card.addEventListener("click", () => select(i)));

        // Selection coming the other way, from the 3D model.
        window.addEventListener("ae1:select-component", (e) => {
          if (e.detail && typeof e.detail.index === "number") select(e.detail.index);
        });

        // Exposed so the 3D viewer can drive and read the same index.
        window.__ae1Lineup = { select, getActive: () => current, cards, scrollTrigger: trigger };

        setCurrent(0);
        window.dispatchEvent(new Event("ae1:lineup-ready"));
      }

      // ---------- GSAP motion ----------
      if (reduceMotion || typeof gsap === "undefined") return;

      gsap.registerPlugin(ScrollTrigger);

      // Scrubbing text reveal: words rise from 0.1 to 1 opacity with scroll
      const scrub = document.querySelector(".scrub-text");
      if (scrub) {
        const words = scrub.textContent.trim().split(/\s+/);
        scrub.innerHTML = words
          .map((word) => "<span class='scrub-word inline-block opacity-[0.12]'>" + word + "</span>")
          .join(" ");
        gsap.to(".scrub-word", {
          opacity: 1,
          ease: "none",
          stagger: 0.08,
          scrollTrigger: {
            trigger: scrub,
            start: "top 78%",
            end: "top 28%",
            scrub: true,
          },
        });
      }

      // Image scale + fade: grow on approach, darken as it scrolls out
      document.querySelectorAll(".media-img").forEach((img) => {
        const baseOpacity = parseFloat(window.getComputedStyle(img).opacity) || 1;

        gsap.fromTo(
          img,
          { "--s": 0.92 },
          {
            "--s": 1,
            ease: "none",
            scrollTrigger: {
              trigger: img,
              start: "top 92%",
              end: "top 55%",
              scrub: true,
            },
          }
        );

        ScrollTrigger.create({
          trigger: img,
          start: "bottom top",
          onEnter: () => gsap.to(img, { opacity: 0.55, duration: 0.4 }),
          onLeaveBack: () => gsap.to(img, { opacity: baseOpacity, duration: 0.4 }),
        });
      });

      // The left column is held with CSS position: sticky (see .split-pin),
      // so no ScrollTrigger pin is needed here. The line-up deck itself is
      // driven by the controller above.

      // ---------- Hero: entrance (once at load) ----------
      // The headline lines rise out of their masks, then the rest of the stage
      // settles in beneath the camera. Restrained: ~1s, opacity + transform.
      const heroSection = document.getElementById("intro");
      if (heroSection) {
        const titleLines = heroSection.querySelectorAll(".hero-line > span");
        const revealItems = heroSection.querySelectorAll(".hero-reveal");
        // The inline end-state (opacity:1, transform:none) must persist so the
        // .js pre-paint hide rule (`.js .hero-reveal { opacity: 0 }`) stays
        // overridden once the intro finishes. No clearProps here.
        gsap.timeline({ defaults: { ease: "power2.out" } })
          .fromTo(titleLines, { yPercent: 112 }, { yPercent: 0, duration: 0.9, stagger: 0.09 }, 0.15)
          .fromTo(
            revealItems,
            { y: 26, opacity: 0 },
            { y: 0, opacity: 1, duration: 0.7, stagger: 0.07 },
            0.15
          );

        // ---------- Hero: scroll handoff ----------
        // Differential planes as the hero leaves: the text column climbs and
        // thins, the product sinks and recedes, the ambient sits almost still.
        // Reverse-scrolling puts the camera back together on screen. Values are
        // tuned down on small screens so the effect never fights touch scroll.
        const bigScreen = window.matchMedia("(min-width: 1024px)").matches;
        const hand = bigScreen ? 1 : 0.55;
        const heroMediaImg = heroSection.querySelector(".hero-media img");
        const heroAmbient = heroSection.querySelector(".hero-ambient");
        gsap.timeline({
          scrollTrigger: { trigger: heroSection, start: "top top", end: "bottom top", scrub: true },
        })
          .to(heroSection.querySelector(".hero-copy"), { yPercent: -16 * hand, opacity: 0, ease: "none" }, 0)
          .to(heroMediaImg, { yPercent: 11 * hand, scale: 0.96, opacity: 0.35, ease: "none" }, 0)
          .to(heroAmbient, { yPercent: 7 * hand, ease: "none" }, 0)
          .to(heroSection.querySelector(".hero-scroll"), { opacity: 0, ease: "none" }, 0);
      }

      // ---------- Overview bento: shutter wipe + tiered rise ----------
      const bentoGrid = document.querySelector("#overview .grid");
      if (bentoGrid) {
        const cells = Array.from(bentoGrid.children).filter((el) => el.matches("article"));
        if (cells.length) {
          gsap.fromTo(cells[0],
            { clipPath: "inset(0 0 100% 0)", opacity: 0.85 },
            {
              clipPath: "inset(0 0 0% 0)",
              opacity: 1,
              duration: 1.1,
              ease: "power3.out",
              scrollTrigger: { trigger: bentoGrid, start: "top 86%", once: true },
            });
          if (cells.length > 1) {
            gsap.from(cells.slice(1), {
              y: 30,
              opacity: 0,
              duration: 0.8,
              ease: "power3.out",
              stagger: 0.09,
              scrollTrigger: { trigger: bentoGrid, start: "top 78%", once: true },
            });
          }
        }
      }

      // ---------- Inline type pills: flash in place ----------
      const pills = document.querySelectorAll(".type-pill");
      if (pills.length) {
        gsap.from(pills, {
          scale: 0.68,
          opacity: 0,
          y: 14,
          rotation: -2,
          duration: 0.6,
          ease: "power3.out",
          stagger: 0.12,
          scrollTrigger: { trigger: pills[0], start: "top 85%", once: true },
        });
      }

      // ---------- Craft: gallery wipes + pinned header settle ----------
      const craftFigures = document.querySelectorAll("#craft figure");
      craftFigures.forEach((f) => {
        const cap = f.querySelector("figcaption");
        gsap.fromTo(f,
          { clipPath: "inset(0 0 100% 0)", y: 24, opacity: 0.55 },
          {
            clipPath: "inset(0 0 0% 0)",
            y: 0,
            opacity: 1,
            duration: 0.9,
            ease: "power3.out",
            scrollTrigger: { trigger: f, start: "top 88%", once: true },
          });
        if (cap) {
          gsap.from(cap, {
            y: 10,
            opacity: 0,
            duration: 0.5,
            delay: 0.4,
            scrollTrigger: { trigger: f, start: "top 82%", once: true },
          });
        }
      });
      const craftPin = document.querySelector("#craft .split-pin");
      if (craftPin) {
        gsap.from(craftPin.children, {
          y: 22,
          opacity: 0,
          duration: 0.8,
          stagger: 0.1,
          ease: "power3.out",
          scrollTrigger: { trigger: craftPin, start: "top 82%", once: true },
        });
      }

      // ---------- Film rack (accordions): panels arrive in a row ----------
      const rackButtons = document.querySelectorAll(".film-rack > button");
      if (rackButtons.length) {
        gsap.from(rackButtons, {
          x: "-100%",
          opacity: 0,
          duration: 0.25,
          ease: "power3.out",
          stagger: 0.08,
        });
      }

      // ---------- Specifications: the table draws itself ----------
      const specTable = document.getElementById("specData");
      if (specTable) {
        gsap.from(specTable.children, {
          y: 16,
          opacity: 0,
          duration: 0.6,
          ease: "power2.out",
          stagger: 0.045,
          scrollTrigger: { trigger: specTable, start: "top 82%", once: true },
        });
      }
      const specsSection = document.getElementById("specs");
      if (specsSection) {
        gsap.from(specsSection.querySelectorAll("h2, #copySpecs"), {
          y: 22,
          opacity: 0,
          duration: 0.8,
          stagger: 0.12,
          ease: "power3.out",
          scrollTrigger: { trigger: specsSection, start: "top 85%", once: true },
        });
      }

      // ---------- CTA: ambient pan + closing line rises ----------
      const acquire = document.getElementById("acquire");
      if (acquire) {
        const ctaPanel = acquire.querySelector(".relative.overflow-hidden");
        const ctaBg = ctaPanel && ctaPanel.querySelector("img");
        if (ctaBg) {
          gsap.fromTo(ctaBg,
            { yPercent: -6, scale: 1.12 },
            {
              yPercent: 6,
              scale: 1.12,
              ease: "none",
              scrollTrigger: { trigger: ctaPanel, start: "top bottom", end: "bottom top", scrub: true },
            });
        }
        if (ctaPanel) {
          gsap.from(ctaPanel.querySelectorAll("h2, p, .flex"), {
            y: 26,
            opacity: 0,
            duration: 0.9,
            stagger: 0.1,
            ease: "power3.out",
            scrollTrigger: { trigger: ctaPanel, start: "top 78%", once: true },
          });
        }
      }

      // ---------- Footer: resolve into place ----------
      const foot = document.querySelector("footer");
      if (foot) {
        gsap.from(foot.children, {
          y: 18,
          opacity: 0,
          duration: 0.7,
          stagger: 0.1,
          ease: "power3.out",
          scrollTrigger: { trigger: foot, start: "top 92%", once: true },
        });
      }

      ScrollTrigger.refresh();

      // Recalculate trigger positions once lazy media finishes loading, so the
      // pinned split holds for the full gallery instead of releasing early.
      let refreshFrame;
      const scheduleRefresh = () => {
        cancelAnimationFrame(refreshFrame);
        refreshFrame = requestAnimationFrame(() => ScrollTrigger.refresh());
      };
      window.addEventListener("load", scheduleRefresh);
      document.querySelectorAll("img").forEach((el) => {
        if (!el.complete) {
          el.addEventListener("load", scheduleRefresh, { once: true });
          el.addEventListener("error", scheduleRefresh, { once: true });
        }
      });
    });
  