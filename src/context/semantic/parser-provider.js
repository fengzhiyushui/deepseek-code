export function extensionOf(inputPath) {
  const last = String(inputPath || "").split(/[\\/]/).pop() || "";
  const i = last.lastIndexOf(".");
  return i >= 0 ? last.slice(i).toLowerCase() : "";
}

export function createParserRegistry({ providers = [] } = {}) {
  const list = [...providers];
  return {
    register(provider) { list.push(provider); return provider; },
    providerForExtension(ext) { return list.find((p) => p.supports(ext)) || null; },
    list() { return [...list]; }
  };
}
