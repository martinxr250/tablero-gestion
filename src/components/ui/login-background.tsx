"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/** Decorative canvas: pointer input stays on the page, never on top of the form. */
export function LoginBackground() {
  const pathname = usePathname();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const page = canvas?.closest("main");
    if (pathname !== "/login" || !canvas || !page) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const motion = window.matchMedia("(prefers-reduced-motion: no-preference) and (hover: hover) and (pointer: fine)");
    let bounds = page.getBoundingClientRect();
    let width = bounds.width;
    let height = bounds.height;
    let dark = document.documentElement.classList.contains("dark");
    let frame = 0;
    let lastTime = 0;
    let time = 0;
    const pointer = { x: width * 0.76, y: height * 0.5, targetX: width * 0.76, targetY: height * 0.5, strength: 0, active: false };

    function draw(delta: number) {
      if (!ctx) return;
      time += delta;
      const ease = 1 - Math.exp(-delta * 7);
      pointer.x += (pointer.targetX - pointer.x) * ease;
      pointer.y += (pointer.targetY - pointer.y) * ease;
      pointer.strength += ((pointer.active ? 1 : 0) - pointer.strength) * ease;
      ctx.clearRect(0, 0, width, height);

      const ink = dark ? "151, 126, 255" : "116, 80, 218";
      const radius = Math.min(width * 0.5, 510);
      const glow = ctx.createRadialGradient(pointer.x, pointer.y, 0, pointer.x, pointer.y, radius);
      glow.addColorStop(0, `rgba(${ink}, ${0.08 + pointer.strength * 0.19})`);
      glow.addColorStop(0.45, `rgba(${ink}, ${0.035 + pointer.strength * 0.08})`);
      glow.addColorStop(1, `rgba(${ink}, 0)`);
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height);

      // Fine flowing filaments bend toward the mouse, then relax back into place.
      for (let line = 0; line < 14; line++) {
        ctx.beginPath();
        for (let step = 0; step <= 64; step++) {
          const x = (step / 64) * (width + 80) - 40;
          const baseY = height * 0.56 + (line - 6.5) * 19;
          let y = baseY + Math.sin(x / Math.max(width, 1) * Math.PI * 2 + time * 0.12 + line * 0.055) * height * 0.13;
          const distance = ((x - pointer.x) ** 2 + (y - pointer.y) ** 2) / (radius * radius * 0.65);
          y += (pointer.y - y) * Math.exp(-distance) * pointer.strength * 0.38;
          if (step === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = `rgba(${ink}, ${(dark ? 0.045 : 0.055) + pointer.strength * 0.045})`;
        ctx.lineWidth = line % 4 === 0 ? 1.2 : 0.65;
        ctx.stroke();
      }
    }

    function animate(now: number) {
      if (now - lastTime >= 1000 / 30) {
        draw(Math.min((now - (lastTime || now)) / 1000, 0.06));
        lastTime = now;
      }
      frame = requestAnimationFrame(animate);
    }

    function syncActivity() {
      cancelAnimationFrame(frame);
      frame = 0;
      lastTime = 0;
      if (motion.matches && !document.hidden) frame = requestAnimationFrame(animate);
      else {
        pointer.active = false;
        pointer.strength = 0;
        draw(0);
      }
    }

    function resize() {
      if (!canvas || !ctx || !page) return;
      bounds = page.getBoundingClientRect();
      width = bounds.width;
      height = bounds.height;
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      pointer.targetX = pointer.x = width * 0.76;
      pointer.targetY = pointer.y = height * 0.5;
      draw(0);
    }

    function move(event: PointerEvent) {
      if (!motion.matches || event.pointerType !== "mouse") return;
      pointer.targetX = event.clientX - bounds.left;
      pointer.targetY = event.clientY - bounds.top;
      pointer.active = true;
    }

    function leave() {
      pointer.active = false;
      pointer.targetX = width * 0.76;
      pointer.targetY = height * 0.5;
    }

    const resizeObserver = new ResizeObserver(resize);
    const themeObserver = new MutationObserver(() => {
      dark = document.documentElement.classList.contains("dark");
      draw(0);
    });
    resizeObserver.observe(page);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    page.addEventListener("pointermove", move, { passive: true });
    page.addEventListener("pointerleave", leave);
    motion.addEventListener("change", syncActivity);
    document.addEventListener("visibilitychange", syncActivity);
    resize();
    syncActivity();

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      themeObserver.disconnect();
      page.removeEventListener("pointermove", move);
      page.removeEventListener("pointerleave", leave);
      motion.removeEventListener("change", syncActivity);
      document.removeEventListener("visibilitychange", syncActivity);
    };
  }, [pathname]);

  if (pathname !== "/login") return null;
  return <canvas ref={canvasRef} className="login-ambient-background" aria-hidden />;
}
