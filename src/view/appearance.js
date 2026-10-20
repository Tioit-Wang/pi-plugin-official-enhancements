/**
 * Theme tokens for the configuration view.
 *
 * A plugin view is a sandboxed page, so it does not receive the host's design
 * tokens directly; it reads the appearance the preload reports and sets
 * `data-base` on `<html>` in the same way the bundled plugins do.
 */

export function applyAppearance(appearance) {
  const reported = appearance?.base;
  const base =
    reported === "light" || reported === "dark"
      ? reported
      : window.matchMedia("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark";
  document.documentElement.dataset.base = base;
  document.documentElement.style.colorScheme = base;
}

/** Subscribe once and resolve the current appearance. */
export function watchAppearance(bridge) {
  const onAppearance = (appearance) => applyAppearance(appearance);
  bridge?.on?.("appearance:changed", onAppearance);
  bridge
    ?.invoke?.("app.getAppearance")
    .then(onAppearance)
    .catch(() => applyAppearance(null));
}
