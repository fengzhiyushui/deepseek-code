// gui/src/state/themes.js — v1.4.0 十套主题元数据(与 tokens.css 的 [theme="<id>"] 对应)。
export const GUI_THEMES = [
  { id: "paper", name: "宣", group: "light", family: "Flexoki Light" },
  { id: "dawn", name: "曦", group: "light", family: "Rosé Pine Dawn" },
  { id: "latte", name: "瓷", group: "light", family: "Catppuccin Latte" },
  { id: "sumi", name: "墨", group: "dark", family: "Kanagawa Wave" },
  { id: "mocha", name: "檀", group: "dark", family: "Catppuccin Mocha" },
  { id: "moon", name: "霄", group: "dark", family: "Tokyo Night Moon" },
  { id: "nord", name: "峡", group: "dark", family: "Nord" },
  { id: "forest", name: "苔", group: "dark", family: "Everforest" },
  { id: "clay", name: "陶", group: "dark", family: "Gruvbox Material" },
  { id: "rose", name: "黛", group: "dark", family: "Rosé Pine" }
];

export function themeLabel(theme) {
  const found = GUI_THEMES.find((x) => x.id === theme);
  return found ? found.name : "墨";
}
