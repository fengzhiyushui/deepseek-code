// Title-bar menu model (pure, i18n via injected t). Each item has an action id the
// TitleBar maps to a handler; `enabled:false` renders greyed out.
export function menuModel(t) {
  return [
    { label: t("menu.view"), items: [
      { id: "view.home", label: t("rail.home"), enabled: true },
      { id: "view.settings", label: t("rail.settings"), enabled: true },
      { id: "sep" },
      { id: "view.theme", label: t("toggle.theme"), enabled: true },
      { id: "view.lang", label: t("toggle.lang"), enabled: true }
    ] },
    { label: t("menu.help"), items: [
      { id: "help.about", label: t("menu.about"), enabled: true }
    ] }
  ];
}
