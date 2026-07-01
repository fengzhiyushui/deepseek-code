// Title-bar menu model (pure, i18n via injected t). Each item has an action id the
// TitleBar maps to a handler; `enabled:false` renders greyed out.
export function menuModel(t) {
  return [
    { label: t("menu.file"), items: [
      { id: "file.newFile", label: t("menu.newFile"), enabled: true },
      { id: "file.open", label: t("menu.open"), enabled: true },
      { id: "sep" },
      { id: "file.save", label: t("menu.save"), enabled: true },
      { id: "file.saveAll", label: t("menu.saveAll"), enabled: true }
    ] },
    { label: t("menu.edit"), items: [
      { id: "edit.undo", label: t("menu.undo"), enabled: true },
      { id: "edit.redo", label: t("menu.redo"), enabled: true },
      { id: "sep" },
      { id: "edit.find", label: t("menu.find"), enabled: true }
    ] },
    { label: t("menu.view"), items: [
      { id: "view.explorer", label: t("rail.explorer"), enabled: true },
      { id: "view.search", label: t("rail.search"), enabled: true },
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
